import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import * as Y from '../../shared/vendor/yjs.mjs';

import collabLib from '../../netlify/lib/collab.js';
import { runRuntimeMaintenance } from '../../shared/ops/runtime-maintenance.mjs';
import { runRealtimeDatabaseBackup } from '../../shared/ops/runtime-backup.mjs';
import {
    buildRealtimeEventsPath,
    buildRealtimeJournalPath,
    formatRealtimeSeqKey,
    parseRealtimeSeqKey
} from '../../shared/ops/realtime-runtime.mjs';
import { canonicalizePointPayload, applyPointOps, preservePointRealtimeTextInOps, stripPointRealtimeTextFields } from '../../shared/realtime/point-doc.mjs';
import { canonicalizeMapPayload, applyMapOps, preserveMapRealtimeTextInOps, stripMapRealtimeTextFields } from '../../shared/realtime/map-doc.mjs';
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
    REALTIME_MSG_OPS_ACK,
    REALTIME_MSG_PRESENCE,
    REALTIME_MSG_SNAPSHOT,
    REALTIME_MSG_SNAPSHOT_REQUEST,
    REALTIME_MSG_Y_SUBSCRIBE,
    REALTIME_MSG_Y_UPDATE,
    REALTIME_PAGE_MAP,
    REALTIME_PAGE_POINT
} from '../../shared/realtime/protocol.mjs';

const require = createRequire(import.meta.url);
const blobStoreLib = require('../../netlify/lib/blob-store.js');
const collabAuthFunction = require('../../netlify/functions/collab-auth.js');
const collabBoardFunction = require('../../netlify/functions/collab-board.js');
const collabRealtimeTokenFunction = require('../../netlify/functions/collab-realtime-token.js');
const alertsFunction = require('../../netlify/functions/alerts.js');
const dbAddFunction = require('../../netlify/functions/db-add.js');
const dbGetFunction = require('../../netlify/functions/db-get.js');
const dbListFunction = require('../../netlify/functions/db-list.js');
const dbDeleteFunction = require('../../netlify/functions/db-delete.js');
const firebaseAdminLib = require('../../netlify/lib/firebase-admin.js');

const {
    STORE_NAME,
    boardKey,
    getStoreClient,
    getRoleForUser,
    canEditBoard,
    nowIso,
    describeStoreClientConfig
} = collabLib;
const { buildStorePath, unwrapBlobValue } = blobStoreLib;
const { getFirebaseDatabase } = firebaseAdminLib;
const {
    appendBoardActivity,
    normalizeBoardActivity,
    summarizeBoardDeltaByPage
} = collabBoardFunction.__test || {};

const PORT = Number(process.env.PORT || 8787);
const REALTIME_SECRET = String(process.env.BNI_REALTIME_SECRET || process.env.REALTIME_SECRET || 'bni-linked-dev-realtime-secret');
const USING_DEFAULT_REALTIME_SECRET = !String(process.env.BNI_REALTIME_SECRET || process.env.REALTIME_SECRET || '').trim();
const MAINTENANCE_SECRET = String(process.env.BNI_MAINTENANCE_SECRET || process.env.MAINTENANCE_SECRET || '').trim();
const ROOM_IDLE_TTL_MS = 120000;
const PERSIST_DEBOUNCE_MS = 450;
const BACKPLANE_EVENT_GRACE_MS = 2000;
const BACKPLANE_EVENT_SCAN_LIMIT = 200;
const JOURNAL_REPLAY_LIMIT = 96;
const LEDGER_BATCH_LIMIT = 64;
const SERVER_ID = `srv_${crypto.randomUUID()}`;
const database = getFirebaseDatabase();

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
    const cleanUserId = String(userId || '').trim();
    const cleanClientId = String(clientId || '').trim();
    const baseKey = `presence/${boardId}/${cleanUserId}`;
    return cleanClientId ? `${baseKey}~${cleanClientId}` : baseKey;
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

function preserveBoardRealtimeTextInOps(page, snapshot, ops) {
    return page === REALTIME_PAGE_MAP
        ? preserveMapRealtimeTextInOps(snapshot, ops)
        : preservePointRealtimeTextInOps(snapshot, ops);
}

function stripBoardRealtimeText(page, snapshot) {
    return page === REALTIME_PAGE_MAP
        ? stripMapRealtimeTextFields(snapshot)
        : stripPointRealtimeTextFields(snapshot);
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

function readSelectionPosition(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function timeValue(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeServerSeq(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.max(0, Number(fallback) || 0);
    return Math.max(0, Math.floor(parsed));
}

function collabStoreRef(key = '') {
    return database.ref(buildStorePath(STORE_NAME, key));
}

function presenceRef(boardId) {
    return collabStoreRef(`presence/${boardId}`);
}

function eventsRef(boardId) {
    return database.ref(buildRealtimeEventsPath(boardId));
}

function journalRef(boardId) {
    return database.ref(buildRealtimeJournalPath(boardId));
}

function makeReceiptId(clientInstanceId = '', opBatchId = '') {
    const cleanInstanceId = String(clientInstanceId || '').trim();
    const cleanBatchId = String(opBatchId || '').trim();
    if (!cleanInstanceId || !cleanBatchId) return '';
    return `${cleanInstanceId}:${cleanBatchId}`;
}

function normalizeJournalBatch(rawValue = {}) {
    const row = unwrapBlobValue(rawValue) || (rawValue && typeof rawValue === 'object' ? rawValue : null);
    if (!row || typeof row !== 'object') return null;
    const serverSeq = normalizeServerSeq(row.serverSeq, 0);
    const ops = Array.isArray(row.ops) ? cloneJson(row.ops, row.ops) : [];
    if (!serverSeq || !ops.length) return null;
    const senderInstanceId = String(row.senderInstanceId || '').trim();
    const opBatchId = String(row.opBatchId || '').trim();
    return {
        boardId: String(row.boardId || ''),
        page: String(row.page || ''),
        serverSeq,
        clientSeq: Number(row.clientSeq || 0),
        senderClientId: String(row.senderClientId || ''),
        senderInstanceId,
        opBatchId,
        receiptId: makeReceiptId(senderInstanceId, opBatchId),
        actor: row.actor && typeof row.actor === 'object'
            ? {
                userId: String(row.actor.userId || ''),
                username: String(row.actor.username || '')
            }
            : null,
        at: String(row.at || row.createdAt || ''),
        createdAt: String(row.createdAt || row.at || ''),
        createdMs: Number(row.createdMs || 0) || 0,
        acknowledged: Boolean(row.acknowledged),
        ops
    };
}

function normalizeRealtimeLedger(rawValue = null) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const batches = (Array.isArray(raw.batches) ? raw.batches : [])
        .map((entry) => normalizeJournalBatch(entry))
        .filter(Boolean)
        .sort((left, right) => Number(left.serverSeq || 0) - Number(right.serverSeq || 0))
        .slice(-LEDGER_BATCH_LIMIT);
    return { batches };
}

function findLedgerBatch(board, clientInstanceId = '', opBatchId = '') {
    const receiptId = makeReceiptId(clientInstanceId, opBatchId);
    if (!receiptId) return null;
    const ledger = normalizeRealtimeLedger(board?.realtimeLedger);
    return ledger.batches.find((entry) => String(entry.receiptId || '') === receiptId) || null;
}

function rememberLedgerBatch(board, batch) {
    const normalizedBatch = normalizeJournalBatch(batch);
    if (!board || !normalizedBatch) return normalizedBatch;
    const ledger = normalizeRealtimeLedger(board.realtimeLedger);
    const filtered = ledger.batches.filter((entry) =>
        String(entry.receiptId || '') !== String(normalizedBatch.receiptId || '')
        && Number(entry.serverSeq || 0) !== Number(normalizedBatch.serverSeq || 0)
    );
    filtered.push(normalizedBatch);
    filtered.sort((left, right) => Number(left.serverSeq || 0) - Number(right.serverSeq || 0));
    board.realtimeLedger = {
        batches: filtered.slice(-LEDGER_BATCH_LIMIT)
    };
    return normalizedBatch;
}

async function writeJournalBatch(boardId, batch) {
    const normalizedBatch = normalizeJournalBatch({
        ...cloneJson(batch, batch),
        boardId
    });
    if (!normalizedBatch) return false;
    await journalRef(boardId).child(formatRealtimeSeqKey(normalizedBatch.serverSeq)).set({
        ...cloneJson(normalizedBatch, normalizedBatch),
        createdAt: normalizedBatch.createdAt || normalizedBatch.at || nowIso(),
        createdMs: Number(normalizedBatch.createdMs || Date.now())
    });
    return true;
}

async function loadJournalReplay(boardId, fromSeq, toSeq, maxItems = JOURNAL_REPLAY_LIMIT) {
    const startSeq = normalizeServerSeq(fromSeq, 0);
    const endSeq = normalizeServerSeq(toSeq, 0);
    if (!boardId || !startSeq || !endSeq || endSeq < startSeq) {
        return [];
    }
    const snapshot = await journalRef(boardId)
        .orderByKey()
        .startAt(formatRealtimeSeqKey(startSeq))
        .endAt(formatRealtimeSeqKey(endSeq))
        .limitToFirst(Math.max(1, Number(maxItems) || JOURNAL_REPLAY_LIMIT))
        .get()
        .catch(() => null);
    if (!snapshot?.exists()) return [];

    const entries = [];
    Object.entries(snapshot.val() || {}).forEach(([seqKey, row]) => {
        const normalized = normalizeJournalBatch({
            ...(row && typeof row === 'object' ? row : {}),
            serverSeq: parseRealtimeSeqKey(seqKey) || row?.serverSeq
        });
        if (normalized) entries.push(normalized);
    });
    entries.sort((left, right) => Number(left.serverSeq || 0) - Number(right.serverSeq || 0));
    return entries;
}

function normalizePresenceRow(rawValue, fallbackBoardId = '') {
    const row = unwrapBlobValue(rawValue);
    if (!row || typeof row !== 'object' || !row.userId) return null;
    const cursorVisible = readPresenceFlag(row.cursorVisible, false);
    return {
        boardId: String(row.boardId || fallbackBoardId || ''),
        userId: String(row.userId || ''),
        username: String(row.username || ''),
        role: String(row.role || ''),
        activeNodeId: String(row.activeNodeId || row.activePointId || ''),
        activeNodeName: String(row.activeNodeName || row.activeLabel || ''),
        activeTextKey: String(row.activeTextKey || ''),
        activeTextLabel: String(row.activeTextLabel || ''),
        activeTextSelectionStart: readSelectionPosition(row.activeTextSelectionStart, null),
        activeTextSelectionEnd: readSelectionPosition(row.activeTextSelectionEnd, null),
        activeTextSelectionDirection: String(row.activeTextSelectionDirection || 'none'),
        mode: String(row.mode || 'editing'),
        cursorVisible,
        cursorWorldX: cursorVisible ? clampPresenceNumber(row.cursorWorldX, 0, -250000, 250000) : 0,
        cursorWorldY: cursorVisible ? clampPresenceNumber(row.cursorWorldY, 0, -250000, 250000) : 0,
        cursorMapX: cursorVisible ? clampPresenceNumber(row.cursorMapX, 50, 0, 100) : 50,
        cursorMapY: cursorVisible ? clampPresenceNumber(row.cursorMapY, 50, 0, 100) : 50,
        lastAt: String(row.lastAt || '')
    };
}

function collapsePresenceRows(rawValue, boardId) {
    const latestByUser = new Map();
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
    Object.values(source).forEach((entry) => {
        const row = normalizePresenceRow(entry, boardId);
        if (!row) return;
        const previous = latestByUser.get(row.userId);
        if (!previous || timeValue(row.lastAt) >= timeValue(previous.lastAt)) {
            latestByUser.set(row.userId, row);
        }
    });
    return [...latestByUser.values()]
        .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')));
}

async function publishRealtimeEvent(boardId, payload = {}) {
    const nowMs = Date.now();
    const ref = eventsRef(boardId).push();
    await ref.set({
        ...cloneJson(payload, payload),
        boardId: String(boardId || ''),
        serverId: SERVER_ID,
        createdAt: new Date(nowMs).toISOString(),
        createdMs: nowMs
    });
    return ref.key || '';
}

class BoardRoom {
    constructor(store, board, roleResolver) {
        this.store = store;
        this.boardId = String(board.id || '');
        this.page = String(board.page || REALTIME_PAGE_POINT);
        this.snapshot = canonicalizeBoardData(this.page, board.data || {});
        this.clients = new Map();
        this.presence = new Map();
        this.serverSeq = normalizeServerSeq(board.realtimeSeq, 0);
        this.lastEditedBy = {
            userId: String(board.lastEditedBy?.userId || board.ownerId || ''),
            username: String(board.lastEditedBy?.username || board.ownerName || ''),
            at: String(board.lastEditedBy?.at || board.updatedAt || '')
        };
        this.textDocs = new Map();
        this.persistTimer = null;
        this.cleanupTimer = null;
        this.roleResolver = roleResolver;
        this.eventsQuery = null;
        this.eventsStartedAtMs = Date.now();
        this.eventsSeen = [];
        this.eventsSeenSet = new Set();
        this.presenceQuery = null;
        this.backplaneStarted = false;
    }

    scheduleCleanup(registry) {
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        if (this.clients.size > 0) return;
        this.cleanupTimer = setTimeout(() => {
            if (this.clients.size === 0) {
                this.dispose();
                registry.delete(this.boardId);
            }
        }, ROOM_IDLE_TTL_MS);
    }

    rememberEvent(eventId) {
        const cleanEventId = String(eventId || '').trim();
        if (!cleanEventId) return false;
        if (this.eventsSeenSet.has(cleanEventId)) return false;
        this.eventsSeen.push(cleanEventId);
        this.eventsSeenSet.add(cleanEventId);
        while (this.eventsSeen.length > BACKPLANE_EVENT_SCAN_LIMIT * 4) {
            const dropped = this.eventsSeen.shift();
            if (dropped) this.eventsSeenSet.delete(dropped);
        }
        return true;
    }

    dispose() {
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        if (this.eventsQuery) {
            this.eventsQuery.off();
            this.eventsQuery = null;
        }
        if (this.presenceQuery) {
            this.presenceQuery.off();
            this.presenceQuery = null;
        }
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

    sendSnapshot(clientState, options = {}) {
        return this.sendToClient(
            clientState,
            options.initial ? REALTIME_MSG_HELLO_ACK : REALTIME_MSG_SNAPSHOT,
            {
                clientId: clientState.clientId,
                clientInstanceId: clientState.clientInstanceId,
                boardId: this.boardId,
                page: this.page,
                serverSeq: this.serverSeq,
                snapshot: options.resume ? null : this.snapshot,
                role: clientState.role,
                presence: this.listPresence(),
                ...(options.resume ? {
                    resume: true,
                    replay: Array.isArray(options.replay) ? options.replay.map((entry) => cloneJson(entry, entry)) : []
                } : {}),
                ...(options.reason ? { reason: String(options.reason || '') } : {})
            }
        );
    }

    async buildInitialSyncOptions(clientState, handshake = {}) {
        const requestedServerSeq = normalizeServerSeq(handshake.lastServerSeq, 0);
        if (requestedServerSeq > 0 && requestedServerSeq < this.serverSeq) {
            const replay = await loadJournalReplay(
                this.boardId,
                requestedServerSeq + 1,
                this.serverSeq,
                JOURNAL_REPLAY_LIMIT
            );
            const expectedLength = (this.serverSeq - requestedServerSeq);
            const sequentialReplay = replay.length === expectedLength
                && replay.every((entry, index) => Number(entry.serverSeq || 0) === (requestedServerSeq + index + 1));
            if (sequentialReplay && replay.length > 0 && replay.length <= JOURNAL_REPLAY_LIMIT) {
                return {
                    initial: true,
                    resume: true,
                    replay
                };
            }
        }
        return {
            initial: true,
            reason: 'handshake'
        };
    }

    applyJournalBatch(batch, options = {}) {
        const normalizedBatch = normalizeJournalBatch(batch);
        if (!normalizedBatch) return false;
        if (normalizedBatch.serverSeq <= this.serverSeq) return false;
        if (normalizedBatch.serverSeq !== this.serverSeq + 1) return false;

        this.snapshot = applyBoardOps(this.page, this.snapshot, normalizedBatch.ops);
        this.serverSeq = normalizedBatch.serverSeq;
        this.lastEditedBy = {
            userId: String(normalizedBatch.actor?.userId || this.lastEditedBy.userId || ''),
            username: String(normalizedBatch.actor?.username || this.lastEditedBy.username || ''),
            at: String(normalizedBatch.at || nowIso())
        };
        this.syncTextDocsFromSnapshot({
            userId: this.lastEditedBy.userId,
            username: this.lastEditedBy.username,
            backplane: true
        });

        if (options.broadcast !== false) {
            this.broadcast(REALTIME_MSG_OPS, {
                boardId: this.boardId,
                page: this.page,
                serverSeq: this.serverSeq,
                senderClientId: normalizedBatch.senderClientId,
                senderInstanceId: normalizedBatch.senderInstanceId,
                actor: normalizedBatch.actor || null,
                opBatchId: normalizedBatch.opBatchId,
                clientSeq: normalizedBatch.clientSeq,
                ops: normalizedBatch.ops
            });
        }
        return true;
    }

    async replayJournalRange(fromSeq, toSeq) {
        const replay = await loadJournalReplay(this.boardId, fromSeq, toSeq, JOURNAL_REPLAY_LIMIT);
        if (!replay.length) return false;
        let applied = 0;
        for (const batch of replay) {
            const didApply = this.applyJournalBatch(batch, { broadcast: true });
            if (!didApply) {
                return false;
            }
            applied += 1;
        }
        return applied > 0 && this.serverSeq >= normalizeServerSeq(toSeq, 0);
    }

    async ensureBackplane() {
        if (this.backplaneStarted) return;
        this.backplaneStarted = true;
        this.presenceQuery = presenceRef(this.boardId);
        this.presenceQuery.on('value', (snapshot) => {
            this.applyPresenceSnapshot(snapshot.val());
        }, (error) => {
            console.error('[realtime] presence listener failed', this.boardId, error);
        });

        this.eventsQuery = eventsRef(this.boardId)
            .orderByChild('createdMs')
            .startAt(Math.max(0, this.eventsStartedAtMs - BACKPLANE_EVENT_GRACE_MS));
        this.eventsQuery.on('child_added', (snapshot) => {
            this.handleBackplaneEvent(snapshot.key, snapshot.val()).catch((error) => {
                console.error('[realtime] event listener failed', this.boardId, error);
            });
        }, (error) => {
            console.error('[realtime] event subscription failed', this.boardId, error);
        });
    }

    applyPresenceSnapshot(rawValue) {
        const rows = collapsePresenceRows(rawValue, this.boardId);
        const nextPresence = new Map(rows.map((entry) => [String(entry.userId || ''), entry]));
        const previous = JSON.stringify(this.listPresence());
        this.presence = nextPresence;
        const current = JSON.stringify(this.listPresence());
        if (previous !== current) {
            this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
        }
    }

    async handleBackplaneEvent(eventId, rawEvent) {
        if (!this.rememberEvent(eventId)) return;
        const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
        if (String(event.serverId || '') === SERVER_ID) return;
        if (String(event.boardId || '') !== this.boardId) return;

        const eventType = String(event.type || '').trim();
        if (eventType === REALTIME_MSG_OPS) {
            const targetSeq = normalizeServerSeq(event.serverSeq, this.serverSeq);
            if (targetSeq <= this.serverSeq) return;
            if (targetSeq !== this.serverSeq + 1) {
                const replayed = await this.replayJournalRange(this.serverSeq + 1, targetSeq);
                if (replayed) return;
                await this.refreshFromBoard();
                this.broadcast(REALTIME_MSG_SNAPSHOT, {
                    boardId: this.boardId,
                    page: this.page,
                    serverSeq: this.serverSeq,
                    snapshot: this.snapshot,
                    presence: this.listPresence(),
                    reason: 'backplane-refresh'
                });
                return;
            }

            this.applyJournalBatch({
                boardId: this.boardId,
                page: this.page,
                serverSeq: targetSeq,
                senderClientId: String(event.senderClientId || ''),
                senderInstanceId: String(event.senderInstanceId || ''),
                actor: event.actor || null,
                opBatchId: String(event.opBatchId || ''),
                clientSeq: Number(event.clientSeq || 0),
                at: String(event.at || nowIso()),
                ops: Array.isArray(event.ops) ? event.ops : []
            }, {
                broadcast: true
            });
            return;
        }

        if (eventType === REALTIME_MSG_Y_UPDATE) {
            const key = this.normalizeTextKey(event.key || '');
            if (!key) return;
            const entry = this.ensureTextDoc(key);
            if (!entry) return;
            await applyYUpdate(entry.doc, String(event.update || ''), {
                backplane: true,
                clientId: String(event.senderClientId || ''),
                userId: String(event.actor?.userId || ''),
                username: String(event.actor?.username || '')
            }).catch(() => false);
            return;
        }

        if (eventType === REALTIME_MSG_SNAPSHOT) {
            const targetSeq = normalizeServerSeq(event.serverSeq, this.serverSeq);
            if (targetSeq <= this.serverSeq) return;
            const refresh = await this.refreshFromBoard();
            if (!refresh.ok) return;
            this.broadcast(REALTIME_MSG_SNAPSHOT, {
                boardId: this.boardId,
                page: this.page,
                serverSeq: this.serverSeq,
                snapshot: this.snapshot,
                presence: this.listPresence(),
                reason: String(event.reason || 'backplane-snapshot')
            });
        }
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
            activeTextSelectionStart: readSelectionPosition(presence.activeTextSelectionStart, null),
            activeTextSelectionEnd: readSelectionPosition(presence.activeTextSelectionEnd, null),
            activeTextSelectionDirection: String(presence.activeTextSelectionDirection || 'none'),
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

    async attachClient(socket, user, role, handshake = {}) {
        await this.ensureBackplane();
        const clientState = {
            clientId: makeClientId(),
            clientInstanceId: String(handshake.clientInstanceId || makeClientId()).trim(),
            socket,
            userId: String(user.id || ''),
            username: String(user.username || ''),
            role: String(role || ''),
            textSubscriptions: new Set()
        };
        this.clients.set(clientState.clientId, clientState);
        await this.persistPresenceEntry(clientState, {});
        const initialSync = await this.buildInitialSyncOptions(clientState, handshake);
        this.sendSnapshot(clientState, initialSync);
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

    async revokeClient(clientState) {
        if (!clientState) return;
        this.clients.delete(clientState.clientId);
        await this.clearPresenceEntry(clientState);
        this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
        this.scheduleCleanup(rooms);
    }

    async updatePresence(clientState, presence = {}) {
        const access = await this.refreshAccess(clientState);
        if (!access.ok) {
            await this.revokeClient(clientState);
            return { ok: false, access };
        }
        await this.persistPresenceEntry(clientState, presence);
        this.broadcast(REALTIME_MSG_PRESENCE, { presence: this.listPresence() });
        return { ok: true };
    }

    async refreshAccess(clientState, options = {}) {
        const access = await this.roleResolver(this.boardId, clientState.userId);
        if (!access?.ok) return access || { ok: false, status: 404, message: 'Board introuvable.' };
        if (String(access.board?.page || REALTIME_PAGE_POINT) !== this.page) {
            return { ok: false, status: 400, message: 'Page realtime invalide.' };
        }
        clientState.role = String(access.role || clientState.role || '');
        if (options.requireEdit && !canEditBoard(clientState.role)) {
            return { ok: false, status: 403, message: 'Board en lecture seule.' };
        }
        return access;
    }

    async refreshFromBoard(board = null, options = {}) {
        const sourceBoard = board || await this.store.get(boardKey(this.boardId), { type: 'json' });
        if (!sourceBoard) {
            return { ok: false, status: 404, message: 'Board introuvable.' };
        }

        const nextSnapshot = canonicalizeBoardData(this.page, sourceBoard.data || {});
        const nextServerSeq = normalizeServerSeq(sourceBoard.realtimeSeq, this.serverSeq);
        const shouldIgnoreRealtimeText = Boolean(options.ignoreRealtimeText);
        const comparableNextSnapshot = shouldIgnoreRealtimeText
            ? stripBoardRealtimeText(this.page, nextSnapshot)
            : nextSnapshot;
        const comparableCurrentSnapshot = shouldIgnoreRealtimeText
            ? stripBoardRealtimeText(this.page, this.snapshot)
            : this.snapshot;
        if (!valuesEqual(comparableNextSnapshot, comparableCurrentSnapshot)) {
            this.snapshot = nextSnapshot;
            this.syncTextDocsFromSnapshot({
                userId: String(sourceBoard.lastEditedBy?.userId || sourceBoard.ownerId || ''),
                username: String(sourceBoard.lastEditedBy?.username || sourceBoard.ownerName || '')
            });
        }
        this.serverSeq = nextServerSeq;

        this.lastEditedBy = {
            userId: String(sourceBoard.lastEditedBy?.userId || sourceBoard.ownerId || ''),
            username: String(sourceBoard.lastEditedBy?.username || sourceBoard.ownerName || ''),
            at: String(sourceBoard.lastEditedBy?.at || sourceBoard.updatedAt || nowIso())
        };

        return {
            ok: true,
            board: sourceBoard
        };
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
            const isBackplane = Boolean(origin?.backplane);
            const nextValue = text.toString();
            const didChangeSnapshot = this.writeTextValue(cleanKey, nextValue);
            if (didChangeSnapshot) {
                this.lastEditedBy = {
                    userId: String(origin?.userId || this.lastEditedBy.userId || ''),
                    username: String(origin?.username || this.lastEditedBy.username || ''),
                    at: nowIso()
                };
                if (!isBackplane) {
                    this.schedulePersist();
                }
            }

            if (!isBackplane) {
                publishRealtimeEvent(this.boardId, {
                    type: REALTIME_MSG_Y_UPDATE,
                    key: cleanKey,
                    update: Buffer.from(update).toString('base64'),
                    senderClientId: String(origin?.clientId || ''),
                    actor: origin?.userId ? {
                        userId: origin.userId,
                        username: origin.username
                    } : null
                }).catch((error) => {
                    console.error('[realtime] text backplane publish failed', this.boardId, cleanKey, error);
                });
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
        const access = await this.refreshAccess(clientState);
        if (!access.ok) {
            await this.revokeClient(clientState);
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: access.message || 'Acces refuse.' });
            return false;
        }
        await this.refreshFromBoard(access.board, {
            ignoreRealtimeText: true
        });
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
        const access = await this.refreshAccess(clientState, { requireEdit: true });
        if (!access.ok) {
            await this.revokeClient(clientState);
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: access.message || 'Board en lecture seule.' });
            return false;
        }
        await this.refreshFromBoard(access.board, {
            ignoreRealtimeText: true
        });
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

    async transactBoard(updateFn) {
        const ref = collabStoreRef(`${boardKey(this.boardId)}/value`);
        const preloadedBoard = await this.store.get(boardKey(this.boardId), { type: 'json' }).catch(() => null);
        let transactionError = null;
        const result = await ref.transaction((rawBoard) => {
            if (transactionError) return undefined;
            const hasLiveBoardObject = Boolean(
                rawBoard
                && typeof rawBoard === 'object'
                && !Array.isArray(rawBoard)
                && Object.keys(rawBoard).length > 0
            );
            const currentBoard = hasLiveBoardObject
                ? rawBoard
                : (preloadedBoard && typeof preloadedBoard === 'object' ? preloadedBoard : null);
            try {
                const nextBoard = updateFn(
                    currentBoard ? cloneJson(currentBoard, currentBoard) : null,
                    currentBoard
                );
                if (nextBoard === undefined) return undefined;
                return nextBoard;
            } catch (error) {
                transactionError = error;
                return undefined;
            }
        }, undefined, false);
        if (transactionError) throw transactionError;
        return {
            committed: Boolean(result?.committed),
            board: result?.snapshot?.exists() ? cloneJson(result.snapshot.val(), result.snapshot.val()) : null
        };
    }

    async persistSnapshot() {
        this.persistTimer = null;
        const result = await this.transactBoard((board) => {
            if (!board) return undefined;
            const updatedAt = nowIso();
            board.data = cloneJson(this.snapshot, this.snapshot);
            board.updatedAt = updatedAt;
            board.realtimeSeq = normalizeServerSeq(board.realtimeSeq, this.serverSeq) + 1;
            board.lastEditedBy = {
                userId: this.lastEditedBy.userId,
                username: this.lastEditedBy.username,
                at: updatedAt
            };
            return board;
        });
        if (!result.committed || !result.board) return;
        await this.refreshFromBoard(result.board);
        await publishRealtimeEvent(this.boardId, {
            type: REALTIME_MSG_SNAPSHOT,
            serverSeq: this.serverSeq,
            reason: 'text-persist',
            actor: {
                userId: this.lastEditedBy.userId,
                username: this.lastEditedBy.username
            }
        }).catch((error) => {
            console.error('[realtime] snapshot backplane publish failed', this.boardId, error);
        });
    }

    schedulePersist() {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistSnapshot().catch((error) => {
                console.error('[realtime] persist failed', error);
            });
        }, PERSIST_DEBOUNCE_MS);
    }

    async applyClientOps(clientState, ops = [], metadata = {}) {
        const access = await this.refreshAccess(clientState, { requireEdit: true });
        if (!access.ok) {
            await this.revokeClient(clientState);
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: access.message || 'Board en lecture seule.' });
            return false;
        }
        const requestedOps = Array.isArray(ops) ? ops.slice(0, 200) : [];
        if (!requestedOps.length) return false;

        const senderInstanceId = String(metadata?.clientInstanceId || clientState.clientInstanceId || '').trim();
        const opBatchId = String(metadata?.opBatchId || '').trim();
        let blockedError = null;
        let appliedOps = [];
        let deltaSummary = 'modification';
        let duplicateBatch = null;
        let appliedBatch = null;
        const result = await this.transactBoard((board) => {
            if (!board) {
                blockedError = { status: 404, message: 'Board introuvable.' };
                return undefined;
            }
            const liveRole = getRoleForUser(board, clientState.userId);
            if (!canEditBoard(liveRole)) {
                blockedError = { status: 403, message: 'Board en lecture seule.' };
                return undefined;
            }
            if (String(board.page || REALTIME_PAGE_POINT) !== this.page) {
                blockedError = { status: 400, message: 'Page realtime invalide.' };
                return undefined;
            }
            if (senderInstanceId && opBatchId) {
                duplicateBatch = findLedgerBatch(board, senderInstanceId, opBatchId);
                if (duplicateBatch) {
                    return undefined;
                }
            }

            const previousSnapshot = canonicalizeBoardData(this.page, board.data || {});
            const safeOps = preserveBoardRealtimeTextInOps(this.page, previousSnapshot, requestedOps);
            if (!safeOps.length) {
                blockedError = { status: 204, message: 'Aucune operation realtime valide.' };
                return undefined;
            }

            const nextSnapshot = applyBoardOps(this.page, previousSnapshot, safeOps);
            if (valuesEqual(nextSnapshot, previousSnapshot)) {
                blockedError = { status: 204, message: 'Aucun changement realtime.' };
                return undefined;
            }

            const updatedAt = nowIso();
            const nextServerSeq = normalizeServerSeq(board.realtimeSeq, this.serverSeq) + 1;
            board.data = cloneJson(nextSnapshot, nextSnapshot);
            board.updatedAt = updatedAt;
            board.realtimeSeq = nextServerSeq;
            board.lastEditedBy = {
                userId: clientState.userId,
                username: clientState.username,
                at: updatedAt
            };
            if (typeof appendBoardActivity === 'function') {
                deltaSummary = typeof summarizeBoardDeltaByPage === 'function'
                    ? summarizeBoardDeltaByPage(this.page, previousSnapshot, nextSnapshot, { mergedConflict: false })
                    : 'modification temps reel';
                appendBoardActivity(board, { id: clientState.userId, username: clientState.username }, 'save', `a modifie le board (${deltaSummary})`);
            }
            appliedOps = safeOps;
            appliedBatch = rememberLedgerBatch(board, {
                boardId: this.boardId,
                page: this.page,
                serverSeq: nextServerSeq,
                clientSeq: Number(metadata?.clientSeq || 0),
                senderClientId: clientState.clientId,
                senderInstanceId,
                opBatchId,
                actor: {
                    userId: clientState.userId,
                    username: clientState.username
                },
                at: updatedAt,
                createdAt: updatedAt,
                createdMs: Date.now(),
                ops: safeOps
            });
            return board;
        });

        if (blockedError?.status === 403 || blockedError?.status === 404) {
            await this.revokeClient(clientState);
            this.sendToClient(clientState, REALTIME_MSG_ERROR, { message: blockedError.message || 'Acces refuse.' });
            return false;
        }
        if (duplicateBatch) {
            if (normalizeServerSeq(duplicateBatch.serverSeq, 0) > this.serverSeq) {
                const replayed = await this.replayJournalRange(this.serverSeq + 1, duplicateBatch.serverSeq).catch(() => false);
                if (!replayed) {
                    await this.refreshFromBoard();
                }
            }
            this.sendToClient(clientState, REALTIME_MSG_OPS_ACK, {
                boardId: this.boardId,
                page: this.page,
                serverSeq: Number(duplicateBatch.serverSeq || this.serverSeq),
                clientSeq: Number(duplicateBatch.clientSeq || metadata?.clientSeq || 0),
                opBatchId: String(duplicateBatch.opBatchId || opBatchId || ''),
                senderInstanceId: String(duplicateBatch.senderInstanceId || senderInstanceId || ''),
                actor: duplicateBatch.actor || {
                    userId: clientState.userId,
                    username: clientState.username
                },
                ops: Array.isArray(duplicateBatch.ops) ? duplicateBatch.ops : []
            });
            return true;
        }
        if (!result.committed || !result.board || !appliedOps.length) {
            return false;
        }

        await this.refreshFromBoard(result.board);
        if (this.page === REALTIME_PAGE_POINT) {
            appliedOps.forEach((operation) => {
                const type = String(operation?.type || '').trim();
                if (type === 'delete_node') {
                    const nodeId = String(operation.id || '').trim();
                    if (!nodeId) return;
                    this.removeTextDocsWithPrefix(`node:${nodeId}:`);
                }
            });
        }
        if (this.page === REALTIME_PAGE_MAP) {
            appliedOps.forEach((operation) => {
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
        this.sendToClient(clientState, REALTIME_MSG_OPS_ACK, {
            boardId: this.boardId,
            page: this.page,
            serverSeq: this.serverSeq,
            clientSeq: Number(metadata?.clientSeq || 0),
            opBatchId,
            senderInstanceId,
            actor: {
                userId: clientState.userId,
                username: clientState.username
            },
            ops: appliedOps
        });
        this.broadcast(REALTIME_MSG_OPS, {
            boardId: this.boardId,
            page: this.page,
            serverSeq: this.serverSeq,
            senderClientId: clientState.clientId,
            senderInstanceId,
            opBatchId,
            clientSeq: Number(metadata?.clientSeq || 0),
            actor: {
                userId: clientState.userId,
                username: clientState.username
            },
            ops: appliedOps
        }, {
            exceptClientId: clientState.clientId
        });
        if (appliedBatch) {
            await writeJournalBatch(this.boardId, appliedBatch).catch((error) => {
                console.error('[realtime] journal write failed', this.boardId, error);
            });
        }
        await publishRealtimeEvent(this.boardId, {
            type: REALTIME_MSG_OPS,
            serverSeq: this.serverSeq,
            senderClientId: clientState.clientId,
            senderInstanceId,
            opBatchId,
            clientSeq: Number(metadata?.clientSeq || 0),
            actor: {
                userId: clientState.userId,
                username: clientState.username
            },
            activity: typeof normalizeBoardActivity === 'function' ? normalizeBoardActivity(result.board) : [],
            deltaSummary,
            at: String(result.board.updatedAt || nowIso()),
            ops: appliedOps
        }).catch((error) => {
            console.error('[realtime] ops backplane publish failed', this.boardId, error);
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

function collectRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        request.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        request.on('error', reject);
    });
}

function getQueryStringParameters(urlObject) {
    const query = {};
    urlObject.searchParams.forEach((value, key) => {
        query[key] = value;
    });
    return query;
}

function buildServerlessEvent(request, targetUrl, body = '') {
    return {
        httpMethod: String(request.method || 'GET').toUpperCase(),
        headers: { ...(request.headers || {}) },
        body,
        queryStringParameters: getQueryStringParameters(targetUrl),
        path: targetUrl.pathname,
        rawUrl: targetUrl.toString(),
    };
}

function sendJsonResponse(response, statusCode, payload = {}) {
    response.writeHead(Number(statusCode || 200), { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
}

function sendServerlessResponse(response, result = {}) {
    const statusCode = Number(result?.statusCode || 200);
    const headers = result?.headers && typeof result.headers === 'object'
        ? result.headers
        : { 'Content-Type': 'application/json; charset=utf-8' };
    const body = result?.body === undefined || result?.body === null ? '' : String(result.body);
    response.writeHead(statusCode, headers);
    response.end(body);
}

function readHeaderValue(request, name) {
    const target = String(name || '').toLowerCase();
    const headers = request?.headers || {};
    for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() !== target) continue;
        if (Array.isArray(value)) return String(value[0] || '');
        return String(value || '');
    }
    return '';
}

function authorizeAdminRequest(request, targetUrl) {
    if (!MAINTENANCE_SECRET) {
        return {
            ok: false,
            statusCode: 503,
            error: 'Maintenance secret non configure.'
        };
    }

    const providedSecret = String(
        readHeaderValue(request, 'x-bni-maintenance-secret') ||
        targetUrl.searchParams.get('key') ||
        ''
    ).trim();
    if (!providedSecret || providedSecret !== MAINTENANCE_SECRET) {
        return {
            ok: false,
            statusCode: 403,
            error: 'Acces admin refuse.'
        };
    }

    return { ok: true };
}

async function handleAdminRoute(request, response, targetUrl) {
    const cleanPath = String(targetUrl.pathname || '').replace(/\/+$/, '') || '/';
    if (cleanPath !== '/api/admin/maintenance/run' && cleanPath !== '/api/admin/backups/run') {
        return false;
    }

    if (String(request.method || 'GET').toUpperCase() !== 'POST') {
        sendJsonResponse(response, 405, { ok: false, error: 'Method not allowed' });
        return true;
    }

    const access = authorizeAdminRequest(request, targetUrl);
    if (!access.ok) {
        sendJsonResponse(response, access.statusCode, { ok: false, error: access.error });
        return true;
    }

    if (cleanPath === '/api/admin/maintenance/run') {
        const result = await runRuntimeMaintenance({
            presenceTtlMs: process.env.BNI_PRESENCE_TTL_MS,
            sessionMaxIdleMs: process.env.BNI_SESSION_MAX_IDLE_MS,
            exportRetentionDays: process.env.BNI_EXPORT_RETENTION_DAYS,
            realtimeEventRetentionMs: process.env.BNI_REALTIME_EVENT_RETENTION_MS,
            realtimeJournalRetentionMs: process.env.BNI_REALTIME_JOURNAL_RETENTION_MS,
        });
        sendJsonResponse(response, 200, {
            ok: true,
            task: 'maintenance',
            ...result,
        });
        return true;
    }

    const result = await runRealtimeDatabaseBackup({
        bucketName: process.env.BNI_BACKUP_BUCKET,
        prefix: process.env.BNI_BACKUP_PREFIX,
    });
    sendJsonResponse(response, 200, {
        ok: true,
        task: 'backup',
        ...result,
    });
    return true;
}

function resolveServerlessHandler(pathname = '') {
    const cleanPath = String(pathname || '').replace(/\/+$/, '') || '/';
    const routeMap = {
        '/api/collab-auth': collabAuthFunction.handler,
        '/api/collab-board': collabBoardFunction.handler,
        '/api/realtime/token': collabRealtimeTokenFunction.handler,
        '/api/alerts': alertsFunction.handler,
        '/api/db-add': dbAddFunction.handler,
        '/api/db-get': dbGetFunction.handler,
        '/api/db-list': dbListFunction.handler,
        '/api/db-delete': dbDeleteFunction.handler,
        '/.netlify/functions/collab-auth': collabAuthFunction.handler,
        '/.netlify/functions/collab-board': collabBoardFunction.handler,
        '/.netlify/functions/collab-realtime-token': collabRealtimeTokenFunction.handler,
        '/.netlify/functions/alerts': alertsFunction.handler,
        '/.netlify/functions/db-add': dbAddFunction.handler,
        '/.netlify/functions/db-get': dbGetFunction.handler,
        '/.netlify/functions/db-list': dbListFunction.handler,
        '/.netlify/functions/db-delete': dbDeleteFunction.handler,
    };
    return routeMap[cleanPath] || null;
}

async function handleServerlessRoute(handler, request, response, targetUrl) {
    const method = String(request.method || 'GET').toUpperCase();
    const body = method === 'GET' || method === 'HEAD'
        ? ''
        : await collectRequestBody(request);
    const event = buildServerlessEvent(request, targetUrl, body);
    const result = await handler(event);
    sendServerlessResponse(response, result);
}

const server = http.createServer(async (request, response) => {
    const targetUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (targetUrl.pathname === '/health' || targetUrl.pathname === '/api/health') {
        const storeProbe = await probeStoreConnectivity();
        const storeConfig = describeStoreClientConfig();
        const payload = {
            ok: !USING_DEFAULT_REALTIME_SECRET && storeProbe.ok,
            service: 'bni-linked-realtime',
            rooms: rooms.size,
            wsPath: '/ws',
            secretConfigured: !USING_DEFAULT_REALTIME_SECRET,
            maintenanceSecretConfigured: Boolean(MAINTENANCE_SECRET),
            backupBucketConfigured: Boolean(String(process.env.BNI_BACKUP_BUCKET || '').trim()),
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

    if (await handleAdminRoute(request, response, targetUrl)) {
        return;
    }

    const serverlessHandler = resolveServerlessHandler(targetUrl.pathname);
    if (serverlessHandler) {
        try {
            await handleServerlessRoute(serverlessHandler, request, response, targetUrl);
        } catch (error) {
            console.error('[api] route failed', targetUrl.pathname, error);
            response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({
                ok: false,
                error: 'Internal server error'
            }));
        }
        return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
    let clientState = null;
    let room = null;

    function closeWithRealtimeError(message, code = 4003, reason = 'access-lost') {
        socket.send(JSON.stringify({ type: REALTIME_MSG_ERROR, message: String(message || 'Acces refuse.') }));
        socket.close(code, reason);
    }

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
                clientState = await room.attachClient(socket, { id: userId, username }, access.role, {
                    clientInstanceId: String(message.clientInstanceId || '').trim(),
                    lastServerSeq: Number(message.lastServerSeq || 0)
                });
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
            const applied = await room.applyClientOps(clientState, message.ops || [], {
                clientSeq: Number(message.clientSeq || 0),
                clientInstanceId: String(message.clientInstanceId || clientState.clientInstanceId || '').trim(),
                opBatchId: String(message.opBatchId || '').trim(),
                baseServerSeq: Number(message.baseServerSeq || 0)
            });
            if (!applied && socket.readyState === 1 && !room.clients.has(clientState.clientId)) {
                closeWithRealtimeError('Session realtime fermee.', 4003, 'room-missing');
            }
            return;
        }

        if (type === REALTIME_MSG_PRESENCE) {
            const result = await room.updatePresence(clientState, message.presence || {});
            if (result && result.ok === false && result.access && socket.readyState === 1) {
                closeWithRealtimeError(result.access.message || 'Acces refuse.', 4003, 'presence-access-lost');
            }
            return;
        }

        if (type === REALTIME_MSG_Y_SUBSCRIBE) {
            const subscribed = await room.subscribeText(clientState, message.key || '');
            if (!subscribed && socket.readyState === 1 && !room.clients.has(clientState.clientId)) {
                closeWithRealtimeError('Session realtime fermee.', 4003, 'text-access-lost');
            }
            return;
        }

        if (type === REALTIME_MSG_Y_UPDATE) {
            const updated = await room.applyTextUpdate(clientState, message.key || '', message.update || '');
            if (!updated && socket.readyState === 1 && !room.clients.has(clientState.clientId)) {
                closeWithRealtimeError('Session realtime fermee.', 4003, 'text-write-access-lost');
            }
            return;
        }

        if (type === REALTIME_MSG_SNAPSHOT_REQUEST) {
            const access = await room.refreshAccess(clientState);
            if (!access.ok) {
                closeWithRealtimeError(access.message || 'Acces refuse.', 4003, 'snapshot-access-lost');
                return;
            }
            const refresh = await room.refreshFromBoard(access.board);
            if (!refresh.ok) {
                closeWithRealtimeError(refresh.message || 'Board introuvable.', 4004, 'snapshot-board-missing');
                return;
            }
            room.sendSnapshot(clientState, {
                initial: false,
                reason: 'snapshot_request'
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
