import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import collabLib from '../../netlify/lib/collab.js';
import { canonicalizePointPayload, applyPointOps } from '../../shared/realtime/point-doc.mjs';
import { canonicalizeMapPayload, applyMapOps } from '../../shared/realtime/map-doc.mjs';
import {
    makePointTextKey,
    parsePointTextKey,
    makeMapTextKey,
    parseMapTextKey,
    encodeYState,
    applyYUpdate
} from '../../shared/realtime/y-text.mjs';
import {
    REALTIME_MSG_ERROR,
    REALTIME_MSG_HELLO,
    REALTIME_MSG_HELLO_ACK,
    REALTIME_MSG_OPS,
    REALTIME_MSG_PRESENCE,
    REALTIME_MSG_SNAPSHOT_REQUEST,
    REALTIME_MSG_Y_SUBSCRIBE,
    REALTIME_MSG_Y_UPDATE,
    REALTIME_PAGE_MAP,
    REALTIME_PAGE_POINT
} from '../../shared/realtime/protocol.mjs';

const {
    boardKey,
    getStoreClient,
    getRoleForUser,
    canEditBoard,
    nowIso,
    describeStoreClientConfig
} = collabLib;

const PORT = Number(process.env.PORT || 8787);
const REALTIME_SECRET = String(process.env.BNI_REALTIME_SECRET || process.env.REALTIME_SECRET || 'bni-linked-dev-realtime-secret');
const USING_DEFAULT_REALTIME_SECRET = !String(process.env.BNI_REALTIME_SECRET || process.env.REALTIME_SECRET || '').trim();
const ROOM_IDLE_TTL_MS = 120000;
const PERSIST_DEBOUNCE_MS = 450;

function makeClientId() {
    return `rtc_${crypto.randomUUID()}`;
}

function cloneJson(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return fallback;
    }
}

function presenceStorageKey(boardId, userId, clientId = '') {
    const cleanClientId = String(clientId || '').trim();
    const baseKey = `presence/${boardId}/${userId}`;
    return cleanClientId ? `${baseKey}/${cleanClientId}` : baseKey;
}

function canonicalizeBoardData(page, data) {
    return page === REALTIME_PAGE_MAP
        ? canonicalizeMapPayload(data)
        : canonicalizePointPayload(data);
}

function applyBoardOps(page, snapshot, ops) {
    return page === REALTIME_PAGE_MAP
        ? applyMapOps(snapshot, ops)
        : applyPointOps(snapshot, ops);
}

function valuesEqual(leftValue, rightValue) {
    try {
        return JSON.stringify(leftValue) === JSON.stringify(rightValue);
    } catch (error) {
        return false;
    }
}

function clampPresenceNumber(value, fallback = 0, min = null, max = null) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    let next = num;
    if (Number.isFinite(min) && next < min) next = min;
    if (Number.isFinite(max) && next > max) next = max;
    return next;
}

function readPresenceFlag(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const clean = value.trim().toLowerCase();
        if (!clean) return false;
        if (['0', 'false', 'off', 'no'].includes(clean)) return false;
        return true;
    }
    return Boolean(value);
}

class BoardRoom {
    constructor(store, board, roleResolver) {
        this.store = store;
        this.boardId = String(board.id || '');
        this.page = String(board.page || REALTIME_PAGE_POINT);
        this.snapshot = canonicalizeBoardData(this.page, board.data || {});
        this.clients = new Map();
        this.presence = new Map();
        this.serverSeq = 0;
        this.lastEditedBy = {
            userId: String(board.lastEditedBy?.userId || board.ownerId || ''),
            username: String(board.lastEditedBy?.username || board.ownerName || ''),
            at: String(board.lastEditedBy?.at || board.updatedAt || '')
        };
        this.textDocs = new Map();
        this.persistTimer = null;
        this.cleanupTimer = null;
        this.roleResolver = roleResolver;
    }

    scheduleCleanup(registry) {
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        if (this.clients.size > 0) return;
        this.cleanupTimer = setTimeout(() => {
            if (this.clients.size === 0) {
                registry.delete(this.boardId);
            }
        }, ROOM_IDLE_TTL_MS);
    }

    listPresence() {
        return [...this.presence.values()]
            .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')))
            .map((entry) => cloneJson(entry, entry));
    }

    broadcast(type, payload = {}, options = {}) {
        const exceptClientId = String(options.exceptClientId || '');
        const predicate = typeof options.predicate === 'function' ? options.predicate : null;
        const message = JSON.stringify({ type, ...payload });
        this.clients.forEach((clientState) => {
            if (!clientState?.socket || clientState.socket.readyState !== 1) return;
            if (exceptClientId && clientState.clientId === exceptClientId) return;
            if (predicate && !predicate(clientState)) return;
            clientState.socket.send(message);
        });
    }

    sendToClient(clientState, type, payload = {}) {
        if (!clientState?.socket || clientState.socket.readyState !== 1) return false;
        clientState.socket.send(JSON.stringify({ type, ...payload }));
        return true;
    }

    async persistPresenceEntry(clientState, presence = {}) {
        const now = nowIso();
        const cursorVisible = readPresenceFlag(presence.cursorVisible, false);
        const row = {
            boardId: this.boardId,
            userId: clientState.userId,
            username: clientState.username,
            role: clientState.role,
            activeNodeId: String(presence.activeNodeId || presence.activePointId || ''),
            activeNodeName: String(presence.activeNodeName || presence.activeLabel || '').slice(0, 80),
            activeTextKey: String(presence.activeTextKey || ''),
            activeTextLabel: String(presence.activeTextLabel || '').slice(0, 80),
            mode: String(presence.mode || (canEditBoard(clientState.role) ? 'editing' : 'viewing')),
            cursorVisible,
            cursorWorldX: cursorVisible ? clampPresenceNumber(presence.cursorWorldX, 0, -250000, 250000) : 0,
            cursorWorldY: cursorVisible ? clampPresenceNumber(presence.cursorWorldY, 0, -250000, 250000) : 0,
            cursorMapX: cursorVisible ? clampPresenceNumber(presence.cursorMapX, 50, 0, 100) : 50,
            cursorMapY: cursorVisible ? clampPresenceNumber(presence.cursorMapY, 50, 0, 100) : 50,
            lastAt: now
        };
        this.presence.set(clientState.clientId, row);
        await this.store.setJSON(
            presenceStorageKey(this.boardId, clientState.userId, clientState.clientId),
            row
        );
    }

    async clearPresenceEntry(clientState) {
        this.presence.delete(clientState.clientId);
        await this.store.delete(
            presenceStorageKey(this.boardId, clientState.userId, clientState.clientId)
        ).catch(() => {});
    }

    async attachClient(socket, user, role) {
        const clientState = {
            clientId: makeClientId(),
            socket,
            userId: String(user.id || ''),
            username: String(user.username || ''),
            role: String(role || ''),
            textSubscriptions: new Set()
        };
        this.clients.set(clientState.clientId, clientState);
        await this.persistPresenceEntry(clientState, {});
        this.sendToClient(clientState, REALTIME_MSG_HELLO_ACK, {
            clientId: clientState.clientId,
            boardId: this.boardId,
            page: this.page,
            serverSeq: this.serverSeq,
            snapshot: this.snapshot,
            role: clientState.role,
            presence: this.listPresence()
        });
        this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
        return clientState;
    }

    async detachClient(clientState, registry) {
        if (!clientState) return;
        this.clients.delete(clientState.clientId);
        await this.clearPresenceEntry(clientState);
        this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
        this.scheduleCleanup(registry);
    }

    async updatePresence(clientState, presence = {}) {
        await this.persistPresenceEntry(clientState, presence);
        this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
    }

    resolvePointNode(nodeId) {
        if (this.page !== REALTIME_PAGE_POINT) return null;
        const cleanNodeId = String(nodeId || '').trim();
        if (!cleanNodeId) return null;
        return (Array.isArray(this.snapshot?.nodes) ? this.snapshot.nodes : [])
            .find((node) => String(node?.id || '') === cleanNodeId) || null;
    }

    resolveMapEntity(entityType, entityId) {
        if (this.page !== REALTIME_PAGE_MAP) return null;
        const cleanEntityType = String(entityType || '').trim();
        const cleanEntityId = String(entityId || '').trim();
        if (!cleanEntityType || !cleanEntityId) return null;

        if (cleanEntityType === 'group') {
            return (Array.isArray(this.snapshot?.groups) ? this.snapshot.groups : [])
                .find((group) => String(group?.id || '') === cleanEntityId) || null;
        }

        for (const group of (Array.isArray(this.snapshot?.groups) ? this.snapshot.groups : [])) {
            if (cleanEntityType === 'point') {
                const point = (Array.isArray(group?.points) ? group.points : [])
                    .find((entry) => String(entry?.id || '') === cleanEntityId);
                if (point) return point;
            }
            if (cleanEntityType === 'zone') {
                const zone = (Array.isArray(group?.zones) ? group.zones : [])
                    .find((entry) => String(entry?.id || '') === cleanEntityId);
                if (zone) return zone;
            }
        }

        return null;
    }

    normalizeTextKey(key) {
        if (this.page === REALTIME_PAGE_POINT) {
            const parsed = parsePointTextKey(key);
            return parsed ? makePointTextKey(parsed.nodeId, parsed.fieldName) : '';
        }
        if (this.page === REALTIME_PAGE_MAP) {
            const parsed = parseMapTextKey(key);
            return parsed ? makeMapTextKey(parsed.entityType, parsed.entityId, parsed.fieldName) : '';
        }
        return '';
    }

    readTextValue(key) {
        if (this.page === REALTIME_PAGE_POINT) {
            return this.readPointTextValue(key);
        }
        if (this.page === REALTIME_PAGE_MAP) {
            return this.readMapTextValue(key);
        }
        return null;
    }

    writeTextValue(key, value) {
        if (this.page === REALTIME_PAGE_POINT) {
            return this.writePointTextValue(key, value);
        }
        if (this.page === REALTIME_PAGE_MAP) {
            return this.writeMapTextValue(key, value);
        }
        return false;
    }

    readPointTextValue(key) {
        const parsed = parsePointTextKey(key);
        if (!parsed) return null;
        const node = this.resolvePointNode(parsed.nodeId);
        if (!node) return null;
        if (parsed.fieldName === 'description') {
            return String(node.description || node.notes || '');
        }
        return String(node[parsed.fieldName] || '');
    }

    writePointTextValue(key, value) {
        const parsed = parsePointTextKey(key);
        if (!parsed) return false;
        const node = this.resolvePointNode(parsed.nodeId);
        if (!node) return false;
        const nextValue = String(value || '');
        if (parsed.fieldName === 'description') {
            if (String(node.description || '') === nextValue && String(node.notes || '') === nextValue) {
                return false;
            }
            node.description = nextValue;
            node.notes = nextValue;
            return true;
        }
        if (String(node[parsed.fieldName] || '') === nextValue) return false;
        node[parsed.fieldName] = nextValue;
        return true;
    }

    readMapTextValue(key) {
        const parsed = parseMapTextKey(key);
        if (!parsed) return null;
        const entity = this.resolveMapEntity(parsed.entityType, parsed.entityId);
        if (!entity) return null;
        return String(entity[parsed.fieldName] || '');
    }

    writeMapTextValue(key, value) {
        const parsed = parseMapTextKey(key);
        if (!parsed) return false;
        const entity = this.resolveMapEntity(parsed.entityType, parsed.entityId);
        if (!entity) return false;
        const nextValue = String(value || '');
        if (String(entity[parsed.fieldName] || '') === nextValue) return false;
        entity[parsed.fieldName] = nextValue;
        return true;
    }

    syncTextDocsFromSnapshot(origin = null) {
        [...this.textDocs.entries()].forEach(([key, entry]) => {
            const nextValue = this.readTextValue(key);
            if (nextValue === null) {
                this.textDocs.delete(key);
                return;
            }
            if (entry.text.toString() === nextValue) return;
            entry.doc.transact(() => {
                entry.text.delete(0, entry.text.length);
                if (nextValue) entry.text.insert(0, nextValue);
            }, origin || undefined);
        });
    }

    removeTextDocsWithPrefix(prefix) {
        const cleanPrefix = String(prefix || '').trim();
        if (!cleanPrefix) return;
        [...this.textDocs.keys()].forEach((key) => {
            if (String(key || '').startsWith(cleanPrefix)) {
                this.textDocs.delete(key);
            }
        });
    }

    ensureTextDoc(key) {
        const cleanKey = this.normalizeTextKey(key);
        if (!cleanKey) return null;
        if (this.textDocs.has(cleanKey)) return this.textDocs.get(cleanKey);

        const initialValue = this.readTextValue(cleanKey);
        if (initialValue === null) return null;

        const doc = new Y.Doc();
        const text = doc.getText('content');
        if (initialValue) {
            text.insert(0, initialValue);
        }

        const entry = { key: cleanKey, doc, text };
        doc.on('update', (update, origin) => {
            const nextValue = text.toString();
            const didChangeSnapshot = this.writeTextValue(cleanKey, nextValue);
            if (didChangeSnapshot) {
                this.lastEditedBy = {
                    userId: String(origin?.userId || this.lastEditedBy.userId || ''),
                    username: String(origin?.username || this.lastEditedBy.username || ''),
                    at: nowIso()
                };
                this.schedulePersist();
            }

            this.broadcast(REALTIME_MSG_Y_UPDATE, {
                key: cleanKey,
                update: Buffer.from(update).toString('base64'),
                full: false,
                actor: origin?.userId ? {
                    userId: origin.userId,
                    username: origin.username
                } : null
            }, {
                exceptClientId: String(origin?.clientId || ''),
                predicate: (clientState) => clientState.textSubscriptions?.has(cleanKey)
            });
        });

        this.textDocs.set(cleanKey, entry);
        return entry;
    }

    async subscribeText(clientState, key) {
        const entry = this.ensureTextDoc(key);
        if (!entry) {
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: 'Champ texte introuvable.' });
            return false;
        }
        clientState.textSubscriptions.add(entry.key);
        this.sendToClient(clientState, REALTIME_MSG_Y_UPDATE, {
            key: entry.key,
            update: encodeYState(entry.doc),
            full: true
        });
        return true;
    }

    async applyTextUpdate(clientState, key, encodedUpdate) {
        if (!canEditBoard(clientState.role)) {
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: 'Board en lecture seule.' });
            return false;
        }
        const entry = this.ensureTextDoc(key);
        if (!entry) {
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: 'Champ texte introuvable.' });
            return false;
        }
        clientState.textSubscriptions.add(entry.key);
        return applyYUpdate(entry.doc, encodedUpdate, {
            clientId: clientState.clientId,
            userId: clientState.userId,
            username: clientState.username
        });
    }

    async persistSnapshot() {
        this.persistTimer = null;
        const board = await this.store.get(boardKey(this.boardId), { type: 'json' });
        if (!board) return;

        board.data = cloneJson(this.snapshot, this.snapshot);
        board.updatedAt = nowIso();
        board.lastEditedBy = {
            userId: this.lastEditedBy.userId,
            username: this.lastEditedBy.username,
            at: board.updatedAt
        };

        await this.store.setJSON(boardKey(this.boardId), board);
    }

    schedulePersist() {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistSnapshot().catch((error) => {
                console.error('[realtime] persist failed', error);
            });
        }, PERSIST_DEBOUNCE_MS);
    }

    async applyClientOps(clientState, ops = []) {
        if (!canEditBoard(clientState.role)) {
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: 'Board en lecture seule.' });
            return false;
        }
        const safeOps = Array.isArray(ops) ? ops.slice(0, 200) : [];
        if (!safeOps.length) return false;

        const nextSnapshot = applyBoardOps(this.page, this.snapshot, safeOps);
        if (valuesEqual(nextSnapshot, this.snapshot)) return false;

        this.snapshot = nextSnapshot;
        this.serverSeq += 1;
        this.lastEditedBy = {
            userId: clientState.userId,
            username: clientState.username,
            at: nowIso()
        };
        this.schedulePersist();
        this.broadcast(REALTIME_MSG_OPS, {
            boardId: this.boardId,
            page: this.page,
            serverSeq: this.serverSeq,
            senderClientId: clientState.clientId,
            actor: {
                userId: clientState.userId,
                username: clientState.username
            },
            ops: safeOps
        }, {
            exceptClientId: clientState.clientId
        });

        if (this.page === REALTIME_PAGE_POINT) {
            safeOps.forEach((operation) => {
                const type = String(operation?.type || '').trim();
                if (type === 'delete_node') {
                    const nodeId = String(operation.id || '').trim();
                    if (!nodeId) return;
                    this.removeTextDocsWithPrefix(`node:${nodeId}:`);
                }
            });
        }

        if (this.page === REALTIME_PAGE_MAP) {
            safeOps.forEach((operation) => {
                const type = String(operation?.type || '').trim();
                if (type === 'delete_group') {
                    const groupId = String(operation.id || '').trim();
                    if (!groupId) return;
                    this.removeTextDocsWithPrefix(`map:group:${groupId}:`);
                }
            });
        }

        this.syncTextDocsFromSnapshot({
            clientId: clientState.clientId,
            userId: clientState.userId,
            username: clientState.username
        });
        return true;
    }
}

const store = getStoreClient();
const rooms = new Map();

async function probeStoreConnectivity() {
    try {
        await store.get('__realtime__/healthcheck', { type: 'json' });
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: String(error?.message || error || 'Store probe failed')
        };
    }
}

async function loadBoard(boardId) {
    if (!boardId) return null;
    return store.get(boardKey(boardId), { type: 'json' });
}

async function resolveBoardAccess(boardId, userId) {
    const board = await loadBoard(boardId);
    if (!board) return { ok: false, status: 404, message: 'Board introuvable.' };
    const role = getRoleForUser(board, userId);
    if (!role) return { ok: false, status: 403, message: 'Acces refuse.' };
    return { ok: true, board, role };
}

async function getOrCreateRoom(board) {
    const boardId = String(board.id || '');
    let room = rooms.get(boardId);
    if (room) return room;
    room = new BoardRoom(store, board, resolveBoardAccess);
    rooms.set(boardId, room);
    return room;
}

function verifyRealtimeToken(token) {
    return jwt.verify(String(token || ''), REALTIME_SECRET, {
        algorithms: ['HS256']
    });
}

function parseJsonSafe(value) {
    try {
        return JSON.parse(String(value || '{}'));
    } catch (error) {
        return null;
    }
}

const server = http.createServer(async (request, response) => {
    if (request.url === '/health') {
        const storeProbe = await probeStoreConnectivity();
        const storeConfig = describeStoreClientConfig();
        const payload = {
            ok: !USING_DEFAULT_REALTIME_SECRET && storeProbe.ok,
            service: 'bni-linked-realtime',
            rooms: rooms.size,
            wsPath: '/ws',
            secretConfigured: !USING_DEFAULT_REALTIME_SECRET,
            store: {
                ...storeConfig,
                reachable: storeProbe.ok
            }
        };
        if (!storeProbe.ok) {
            payload.store.error = storeProbe.error;
        }
        response.writeHead(payload.ok ? 200 : 503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
        return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
    let clientState = null;
    let room = null;

    socket.on('message', async (rawMessage) => {
        const message = parseJsonSafe(rawMessage);
        if (!message) {
            socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: 'JSON invalide.' }));
            return;
        }

        const type = String(message.type || '');
        if (type === REALTIME_MSG_HELLO) {
            try {
                const claims = verifyRealtimeToken(message.token);
                const boardId = String(message.boardId || claims.boardId || '').trim();
                const page = String(message.page || claims.page || '').trim();
                const userId = String(claims.userId || '').trim();
                const username = String(claims.username || '').trim();
                if (!boardId || !page || !userId || !username) {
                    throw new Error('Token realtime invalide.');
                }

                const access = await resolveBoardAccess(boardId, userId);
                if (!access.ok) {
                    socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: access.message }));
                    socket.close(4003, access.message);
                    return;
                }
                if (String(access.board.page || REALTIME_PAGE_POINT) !== page) {
                    socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: 'Page realtime invalide.' }));
                    socket.close(4004, 'page-mismatch');
                    return;
                }

                room = await getOrCreateRoom(access.board);
                clientState = await room.attachClient(socket, { id: userId, username }, access.role);
            } catch (error) {
                socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: error.message || 'Handshake realtime echoue.' }));
                socket.close(4001, 'auth-failed');
            }
            return;
        }

        if (!room || !clientState) {
            socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: 'Handshake realtime requis.' }));
            return;
        }

        if (type === REALTIME_MSG_OPS) {
            await room.applyClientOps(clientState, message.ops || []);
            return;
        }

        if (type === REALTIME_MSG_PRESENCE) {
            await room.updatePresence(clientState, message.presence || {});
            return;
        }

        if (type === REALTIME_MSG_Y_SUBSCRIBE) {
            await room.subscribeText(clientState, message.key || '');
            return;
        }

        if (type === REALTIME_MSG_Y_UPDATE) {
            await room.applyTextUpdate(clientState, message.key || '', message.update || '');
            return;
        }

        if (type === REALTIME_MSG_SNAPSHOT_REQUEST) {
            room.sendToClient(clientState, REALTIME_MSG_HELLO_ACK, {
                clientId: clientState.clientId,
                boardId: room.boardId,
                page: room.page,
                serverSeq: room.serverSeq,
                snapshot: room.snapshot,
                role: clientState.role,
                presence: room.listPresence()
            });
        }
    });

    socket.on('close', () => {
        if (room && clientState) {
            room.detachClient(clientState, rooms).catch((error) => {
                console.error('[realtime] detach failed', error);
            });
        }
    });
});

server.on('upgrade', (request, socket, head) => {
    const targetUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (targetUrl.pathname !== '/ws') {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

server.listen(PORT, () => {
    console.log(`[realtime] listening on http://localhost:${PORT}`);
});
