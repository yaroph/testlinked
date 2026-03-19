import { resolveRealtimeWsBase } from './config.mjs';
import { RealtimeRoomClient } from './room-client.mjs';
import { valuesEqual } from './utils.mjs';

function shortDebugId(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 18) return text;
    return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function summarizeSnapshot(snapshot = {}) {
    if (snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.nodes)) {
        const nodes = snapshot.nodes;
        const unnamedNodes = nodes.reduce((count, node) => {
            const name = String(node?.name || '').trim();
            return count + (name === '' || name === 'Sans nom' ? 1 : 0);
        }, 0);
        return {
            nodes: nodes.length,
            links: Array.isArray(snapshot.links) ? snapshot.links.length : 0,
            unnamedNodes
        };
    }

    if (snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.groups)) {
        let points = 0;
        let zones = 0;
        let unnamedPoints = 0;
        let unnamedZones = 0;
        snapshot.groups.forEach((group) => {
            const groupPoints = Array.isArray(group?.points) ? group.points : [];
            const groupZones = Array.isArray(group?.zones) ? group.zones : [];
            points += groupPoints.length;
            zones += groupZones.length;
            unnamedPoints += groupPoints.reduce((count, point) => count + (String(point?.name || '').trim() ? 0 : 1), 0);
            unnamedZones += groupZones.reduce((count, zone) => count + (String(zone?.name || '').trim() ? 0 : 1), 0);
        });
        return {
            groups: snapshot.groups.length,
            points,
            zones,
            unnamedPoints,
            unnamedZones,
            tacticalLinks: Array.isArray(snapshot.tacticalLinks) ? snapshot.tacticalLinks.length : 0
        };
    }

    return {};
}

function resolveDebugLogger(debug) {
    if (!debug || typeof debug !== 'object') return null;
    if (typeof debug.log === 'function') return debug;
    return null;
}

function writeDebug(debug, level, event, details = {}) {
    if (!debug) return false;
    const method = typeof debug[level] === 'function'
        ? debug[level].bind(debug)
        : (typeof debug.log === 'function' ? debug.log.bind(debug) : null);
    if (!method) return false;
    method(event, details);
    return true;
}

function joinUrl(base, path) {
    const safeBase = String(base || '').replace(/\/+$/, '');
    const safePath = String(path || '').replace(/^\/+/, '');
    return safeBase && safePath ? `${safeBase}/${safePath}` : safeBase || '';
}

async function requestRealtimeToken(tokenEndpoint, collabToken, boardId, page, debug = null) {
    writeDebug(debug, 'log', 'realtime-token-request', {
        page,
        boardId: shortDebugId(boardId),
        tokenEndpoint
    });
    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-collab-token': String(collabToken || '')
        },
        body: JSON.stringify({
            boardId,
            page
        })
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {}

    if (!response.ok || !data.ok || !data.token) {
        const error = new Error(data.error || `Erreur realtime (${response.status})`);
        error.status = response.status;
        writeDebug(debug, 'error', 'realtime-token-error', {
            page,
            boardId: shortDebugId(boardId),
            status: response.status,
            message: error.message || ''
        });
        throw error;
    }
    writeDebug(debug, 'log', 'realtime-token-ok', {
        page,
        boardId: shortDebugId(boardId),
        status: response.status,
        wsBase: String(data.wsBase || '').trim()
    });
    return data;
}

export async function createRealtimeBoardSession(options = {}) {
    const page = String(options.page || '').trim();
    const boardId = String(options.boardId || '').trim();
    const collabToken = String(options.collabToken || '').trim();
    const getCurrentSnapshot = typeof options.getCurrentSnapshot === 'function' ? options.getCurrentSnapshot : () => ({});
    const canonicalizeSnapshot = typeof options.canonicalizeSnapshot === 'function' ? options.canonicalizeSnapshot : (value) => value;
    const diffOps = typeof options.diffOps === 'function' ? options.diffOps : () => [];
    const applyOps = typeof options.applyOps === 'function' ? options.applyOps : (_snapshot, _ops) => _snapshot;
    const applySnapshot = typeof options.applySnapshot === 'function' ? options.applySnapshot : () => {};
    const onPresence = typeof options.onPresence === 'function' ? options.onPresence : () => {};
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    const onClose = typeof options.onClose === 'function' ? options.onClose : () => {};
    const onLocalAccepted = typeof options.onLocalAccepted === 'function' ? options.onLocalAccepted : () => {};
    const onTextUpdate = typeof options.onTextUpdate === 'function' ? options.onTextUpdate : () => {};
    const localFlushMs = Math.max(40, Number(options.localFlushMs) || 140);
    const buildPresence = typeof options.buildPresence === 'function' ? options.buildPresence : () => ({});
    const debug = resolveDebugLogger(options.debug);

    const tokenBase = String(options.tokenBase || (typeof window !== 'undefined' ? window.location.origin : '')).trim();
    const tokenEndpoint = String(options.tokenEndpoint || '/.netlify/functions/collab-realtime-token').trim();
    if (!page || !boardId || !collabToken || !tokenBase) {
        throw new Error('Configuration realtime incomplete.');
    }

    const tokenData = await requestRealtimeToken(joinUrl(tokenBase, tokenEndpoint), collabToken, boardId, page, debug);
    const wsBase = String(options.wsBase || tokenData.wsBase || resolveRealtimeWsBase()).trim();
    if (!wsBase) {
        throw new Error('Configuration realtime incomplete.');
    }
    writeDebug(debug, 'log', 'realtime-session-config', {
        page,
        boardId: shortDebugId(boardId),
        wsBase,
        localFlushMs
    });
    let shadowSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
    let flushTimer = null;
    let closed = false;
    let clientSeq = 0;
    let manualStop = false;

    const roomClient = new RealtimeRoomClient({
        url: joinUrl(wsBase, '/ws'),
        boardId,
        page,
        token: tokenData.token,
        onSnapshot: (snapshot, meta) => {
            const incomingSnapshot = canonicalizeSnapshot(snapshot || {});
            const currentSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
            const hadPendingLocalChanges = !valuesEqual(currentSnapshot, shadowSnapshot);
            shadowSnapshot = incomingSnapshot;
            writeDebug(debug, 'log', 'realtime-snapshot', {
                page,
                boardId: shortDebugId(boardId),
                initial: Boolean(meta?.initial),
                hadPendingLocalChanges,
                summary: summarizeSnapshot(incomingSnapshot)
            });
            if (!(meta?.initial && hadPendingLocalChanges)) {
                applySnapshot(shadowSnapshot, meta || {});
            } else {
                writeDebug(debug, 'warn', 'realtime-initial-snapshot-delayed', {
                    page,
                    boardId: shortDebugId(boardId),
                    reason: 'pending-local-changes'
                });
                scheduleLocalFlush(0);
            }
            onPresence(meta?.presence || []);
        },
        onRemoteOps: (ops, meta) => {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
                flushLocalChanges().catch(() => {});
            }
            shadowSnapshot = applyOps(shadowSnapshot, ops || []);
            writeDebug(debug, 'log', 'realtime-remote-ops', {
                page,
                boardId: shortDebugId(boardId),
                opCount: Array.isArray(ops) ? ops.length : 0,
                serverSeq: Number(meta?.serverSeq || 0),
                senderClientId: shortDebugId(meta?.senderClientId || '')
            });
            applySnapshot(shadowSnapshot, {
                remote: true,
                ...(meta || {})
            });
        },
        onPresence,
        onStatus,
        onError,
        onTextUpdate,
        onClose: (meta) => {
            closed = true;
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            writeDebug(debug, 'warn', 'realtime-session-closed', {
                page,
                boardId: shortDebugId(boardId),
                code: Number(meta?.code || 0),
                reason: String(meta?.reason || ''),
                intentional: Boolean(manualStop),
                wasConnected: Boolean(meta?.wasConnected)
            });
            onClose({
                ...(meta || {}),
                intentional: manualStop
            });
        }
    });

    async function flushLocalChanges() {
        if (closed) return false;
        if (!roomClient.isConnected()) {
            writeDebug(debug, 'warn', 'realtime-flush-skipped', {
                page,
                boardId: shortDebugId(boardId),
                reason: 'not-connected'
            });
            return false;
        }
        const currentSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
        const ops = diffOps(shadowSnapshot, currentSnapshot);
        if (!Array.isArray(ops) || !ops.length) {
            shadowSnapshot = currentSnapshot;
            return false;
        }
        clientSeq += 1;
        writeDebug(debug, 'log', 'realtime-flush-send', {
            page,
            boardId: shortDebugId(boardId),
            clientSeq,
            opCount: ops.length,
            summary: summarizeSnapshot(currentSnapshot)
        });
        const sent = roomClient.sendOps(ops, { clientSeq });
        if (sent) {
            shadowSnapshot = applyOps(shadowSnapshot, ops);
            onLocalAccepted({
                ops,
                snapshot: shadowSnapshot
            });
        }
        return sent;
    }

    function scheduleLocalFlush(delayMs = localFlushMs) {
        if (closed) return;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushLocalChanges().catch((error) => onError(error));
        }, delayMs);
    }

    function updatePresence(extra = null) {
        if (closed) return false;
        return roomClient.updatePresence(buildPresence(extra || {}));
    }

    roomClient.connect();

    return {
        roomClient,
        get shadowSnapshot() {
            return shadowSnapshot;
        },
        isConnected() {
            return roomClient.isConnected();
        },
        scheduleLocalFlush,
        flushLocalChanges,
        updatePresence,
        stop(reason = 'realtime-stop') {
            manualStop = true;
            closed = true;
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            roomClient.disconnect(1000, reason);
        }
    };
}
