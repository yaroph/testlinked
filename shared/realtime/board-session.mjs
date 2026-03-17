import { resolveRealtimeWsBase } from './config.mjs';
import { RealtimeRoomClient } from './room-client.mjs';
import { valuesEqual } from './utils.mjs';

function joinUrl(base, path) {
    const safeBase = String(base || '').replace(/\/+$/, '');
    const safePath = String(path || '').replace(/^\/+/, '');
    return safeBase && safePath ? `${safeBase}/${safePath}` : safeBase || '';
}

async function requestRealtimeToken(tokenEndpoint, collabToken, boardId, page) {
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
        throw error;
    }
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

    const tokenBase = String(options.tokenBase || (typeof window !== 'undefined' ? window.location.origin : '')).trim();
    const tokenEndpoint = String(options.tokenEndpoint || '/.netlify/functions/collab-realtime-token').trim();
    if (!page || !boardId || !collabToken || !tokenBase) {
        throw new Error('Configuration realtime incomplete.');
    }

    const tokenData = await requestRealtimeToken(joinUrl(tokenBase, tokenEndpoint), collabToken, boardId, page);
    const wsBase = String(options.wsBase || tokenData.wsBase || resolveRealtimeWsBase()).trim();
    if (!wsBase) {
        throw new Error('Configuration realtime incomplete.');
    }
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
            if (!(meta?.initial && hadPendingLocalChanges)) {
                applySnapshot(shadowSnapshot, meta || {});
            } else {
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
            onClose({
                ...(meta || {}),
                intentional: manualStop
            });
        }
    });

    async function flushLocalChanges() {
        if (closed) return false;
        if (!roomClient.isConnected()) return false;
        const currentSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
        const ops = diffOps(shadowSnapshot, currentSnapshot);
        if (!Array.isArray(ops) || !ops.length) {
            shadowSnapshot = currentSnapshot;
            return false;
        }
        clientSeq += 1;
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
