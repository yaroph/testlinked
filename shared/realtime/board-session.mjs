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

function sanitizeTextKey(value = '') {
    return String(value || '').trim();
}

function backoffDelay(attempt, baseMs, maxMs) {
    const safeAttempt = Math.max(0, Number(attempt) || 0);
    const rawDelay = Math.min(maxMs, baseMs * (2 ** safeAttempt));
    const jitter = Math.min(750, Math.round(rawDelay * 0.2));
    return rawDelay + Math.floor(Math.random() * (jitter + 1));
}

function shouldTreatConnectErrorAsTerminal(error) {
    const status = Number(error?.status || 0);
    return status === 400 || status === 401 || status === 403 || status === 404;
}

function shouldTreatCloseAsTerminal(meta = {}) {
    const code = Number(meta?.code || 0);
    return code === 4001 || code === 4003 || code === 4004;
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
    const reconnectBaseMs = Math.max(500, Number(options.reconnectBaseMs) || 1000);
    const reconnectMaxMs = Math.max(reconnectBaseMs, Number(options.reconnectMaxMs) || 15000);
    const presenceHeartbeatMs = Math.max(5000, Number(options.presenceHeartbeatMs) || 12000);
    const snapshotRefreshMs = Math.max(15000, Number(options.snapshotRefreshMs) || 120000);
    const buildPresence = typeof options.buildPresence === 'function' ? options.buildPresence : () => ({});
    const debug = resolveDebugLogger(options.debug);

    const tokenBase = String(options.tokenBase || (typeof window !== 'undefined' ? window.location.origin : '')).trim();
    const tokenEndpoint = String(options.tokenEndpoint || '/.netlify/functions/collab-realtime-token').trim();
    if (!page || !boardId || !collabToken || !tokenBase) {
        throw new Error('Configuration realtime incomplete.');
    }

    let committedShadowSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
    let shadowSnapshot = committedShadowSnapshot;
    let flushTimer = null;
    let reconnectTimer = null;
    let presenceTimer = null;
    let snapshotTimer = null;
    let closed = false;
    let manualStop = false;
    let reconnectAttempt = 0;
    let clientSeq = 0;
    let activeClient = null;
    let lastPresencePayload = buildPresence({});
    const textSubscriptions = new Set();

    function clearFlushTimer() {
        if (!flushTimer) return;
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    function clearReconnectTimer() {
        if (!reconnectTimer) return;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    function clearPresenceTimer() {
        if (!presenceTimer) return;
        clearTimeout(presenceTimer);
        presenceTimer = null;
    }

    function clearSnapshotTimer() {
        if (!snapshotTimer) return;
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
    }

    function scheduleSnapshotRefresh(delayMs = snapshotRefreshMs) {
        if (closed || !snapshotRefreshMs) return;
        clearSnapshotTimer();
        snapshotTimer = setTimeout(() => {
            snapshotTimer = null;
            if (closed) return;
            if (activeClient?.isConnected()) {
                activeClient.requestSnapshot();
            }
            scheduleSnapshotRefresh(snapshotRefreshMs);
        }, Math.max(1000, Number(delayMs) || snapshotRefreshMs));
    }

    function schedulePresenceHeartbeat(delayMs = presenceHeartbeatMs) {
        if (closed || !presenceHeartbeatMs) return;
        clearPresenceTimer();
        presenceTimer = setTimeout(() => {
            presenceTimer = null;
            if (closed) return;
            if (activeClient?.isConnected()) {
                roomClientFacade.updatePresence(lastPresencePayload);
            }
            schedulePresenceHeartbeat(presenceHeartbeatMs);
        }, Math.max(1000, Number(delayMs) || presenceHeartbeatMs));
    }

    function replayTextSubscriptions() {
        if (!activeClient || !activeClient.isConnected() || !textSubscriptions.size) return;
        textSubscriptions.forEach((key) => {
            activeClient.subscribeText(key);
        });
    }

    function setRealtimePresencePayload(payload = null) {
        if (!payload || typeof payload !== 'object') {
            lastPresencePayload = {};
            return lastPresencePayload;
        }
        lastPresencePayload = payload;
        return lastPresencePayload;
    }

    function finalizeSessionClose(meta = {}) {
        clearFlushTimer();
        clearReconnectTimer();
        clearPresenceTimer();
        clearSnapshotTimer();
        closed = true;
        activeClient = null;
        onClose({
            ...(meta || {}),
            intentional: Boolean(manualStop)
        });
    }

    function scheduleReconnect(reason = '', details = {}) {
        if (closed || manualStop) return;
        clearReconnectTimer();
        clearPresenceTimer();
        clearSnapshotTimer();
        const delayMs = backoffDelay(reconnectAttempt, reconnectBaseMs, reconnectMaxMs);
        const nextAttempt = reconnectAttempt + 1;
        writeDebug(debug, 'warn', 'realtime-reconnect-scheduled', {
            page,
            boardId: shortDebugId(boardId),
            reason: String(reason || ''),
            attempt: nextAttempt,
            delayMs,
            ...details
        });
        onStatus('connecting', reason ? `${reason} • retry ${nextAttempt}` : `Retry ${nextAttempt}`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectAttempt = nextAttempt;
            connectRealtimeClient({ reconnect: true }).catch((error) => {
                if (shouldTreatConnectErrorAsTerminal(error)) {
                    onError(error);
                    finalizeSessionClose({
                        code: Number(error?.status || 0),
                        reason: error?.message || 'Reconnect terminal error',
                        terminal: true
                    });
                    return;
                }
                onError(error);
                scheduleReconnect(error?.message || 'Reconnect failed');
            });
        }, delayMs);
    }

    const roomClientFacade = {
        isConnected() {
            return Boolean(activeClient?.isConnected());
        },
        requestSnapshot() {
            if (!activeClient) return false;
            activeClient.requestSnapshot();
            return true;
        },
        subscribeText(key) {
            const cleanKey = sanitizeTextKey(key);
            if (!cleanKey) return false;
            textSubscriptions.add(cleanKey);
            if (!activeClient) return false;
            return activeClient.subscribeText(cleanKey);
        },
        sendTextUpdate(key, update) {
            const cleanKey = sanitizeTextKey(key);
            if (!cleanKey || !activeClient) return false;
            return activeClient.sendTextUpdate(cleanKey, update);
        },
        updatePresence(presence = {}) {
            const payload = setRealtimePresencePayload(presence);
            schedulePresenceHeartbeat(presenceHeartbeatMs);
            if (!activeClient) return false;
            return activeClient.updatePresence(payload);
        }
    };

    async function flushLocalChanges() {
        if (closed) return false;
        if (!activeClient || !activeClient.isConnected()) {
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
        const sent = activeClient.sendOps(ops, { clientSeq });
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
        clearFlushTimer();
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushLocalChanges().catch((error) => onError(error));
        }, Math.max(0, Number(delayMs) || localFlushMs));
    }

    function updatePresence(extra = null) {
        if (closed) return false;
        const payload = buildPresence(extra || {});
        return roomClientFacade.updatePresence(payload);
    }

    async function connectRealtimeClient(options = {}) {
        if (closed || manualStop) return false;

        const tokenData = await requestRealtimeToken(
            joinUrl(tokenBase, tokenEndpoint),
            collabToken,
            boardId,
            page,
            debug
        );
        const wsBase = String(options.wsBase || tokenData.wsBase || resolveRealtimeWsBase()).trim();
        if (!wsBase) {
            throw new Error('Configuration realtime incomplete.');
        }

        writeDebug(debug, 'log', 'realtime-session-config', {
            page,
            boardId: shortDebugId(boardId),
            wsBase,
            localFlushMs,
            reconnectAttempt
        });

        const client = new RealtimeRoomClient({
            url: joinUrl(wsBase, '/ws'),
            boardId,
            page,
            token: tokenData.token,
            onSnapshot: (snapshot, meta) => {
                if (activeClient !== client) return;
                const incomingSnapshot = canonicalizeSnapshot(snapshot || {});
                const currentSnapshot = canonicalizeSnapshot(getCurrentSnapshot());
                const hadPendingLocalChanges = !valuesEqual(currentSnapshot, committedShadowSnapshot);
                committedShadowSnapshot = incomingSnapshot;
                shadowSnapshot = incomingSnapshot;
                writeDebug(debug, 'log', 'realtime-snapshot', {
                    page,
                    boardId: shortDebugId(boardId),
                    initial: Boolean(meta?.initial),
                    hadPendingLocalChanges,
                    reason: String(meta?.reason || ''),
                    summary: summarizeSnapshot(incomingSnapshot)
                });
                if (!hadPendingLocalChanges) {
                    applySnapshot(shadowSnapshot, meta || {});
                } else {
                    writeDebug(debug, 'warn', 'realtime-initial-snapshot-delayed', {
                        page,
                        boardId: shortDebugId(boardId),
                        reason: 'pending-local-changes'
                    });
                    scheduleLocalFlush(0);
                }
                if (Array.isArray(meta?.presence)) {
                    onPresence(meta.presence);
                }
                if (meta?.initial) {
                    reconnectAttempt = 0;
                    onStatus('connected', options.reconnect ? 'Reconnected' : 'Connected');
                    replayTextSubscriptions();
                    if (lastPresencePayload && Object.keys(lastPresencePayload).length) {
                        roomClientFacade.updatePresence(lastPresencePayload);
                    }
                    schedulePresenceHeartbeat(presenceHeartbeatMs);
                }
                scheduleSnapshotRefresh(snapshotRefreshMs);
            },
            onRemoteOps: (ops, meta) => {
                if (activeClient !== client) return;
                const isAcknowledgedLocalOps = String(meta?.senderClientId || '') === String(client.clientId || '');
                committedShadowSnapshot = applyOps(committedShadowSnapshot, ops || []);
                if (isAcknowledgedLocalOps) {
                    writeDebug(debug, 'log', 'realtime-local-ops-ack', {
                        page,
                        boardId: shortDebugId(boardId),
                        opCount: Array.isArray(ops) ? ops.length : 0,
                        serverSeq: Number(meta?.serverSeq || 0),
                        clientSeq: Number(meta?.clientSeq || 0)
                    });
                    scheduleSnapshotRefresh(snapshotRefreshMs);
                    return;
                }
                if (flushTimer) {
                    clearFlushTimer();
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
                scheduleSnapshotRefresh(snapshotRefreshMs);
            },
            onPresence: (presence) => {
                if (activeClient !== client) return;
                onPresence(presence);
                scheduleSnapshotRefresh(snapshotRefreshMs);
            },
            onStatus: (status, detail = '') => {
                if (activeClient !== client) return;
                if (status === 'connecting') {
                    onStatus(status, detail);
                    return;
                }
                if (status === 'error') {
                    onStatus(status, detail);
                }
            },
            onError: (error) => {
                if (activeClient !== client) return;
                onError(error);
            },
            onTextUpdate: (payload) => {
                if (activeClient !== client) return;
                onTextUpdate(payload);
                scheduleSnapshotRefresh(snapshotRefreshMs);
            },
            onClose: (meta) => {
                if (activeClient === client) {
                    activeClient = null;
                }
                clearSnapshotTimer();
                writeDebug(debug, 'warn', 'realtime-session-closed', {
                    page,
                    boardId: shortDebugId(boardId),
                    code: Number(meta?.code || 0),
                    reason: String(meta?.reason || ''),
                    intentional: Boolean(manualStop),
                    wasConnected: Boolean(meta?.wasConnected)
                });
                if (closed || manualStop) {
                    finalizeSessionClose({
                        ...(meta || {}),
                        intentional: true
                    });
                    return;
                }
                if (shouldTreatCloseAsTerminal(meta)) {
                    finalizeSessionClose({
                        ...(meta || {}),
                        terminal: true
                    });
                    return;
                }
                scheduleReconnect(meta?.reason || 'Socket closed', {
                    code: Number(meta?.code || 0),
                    wasConnected: Boolean(meta?.wasConnected)
                });
            }
        });

        activeClient = client;
        client.connect();
        return true;
    }

    const session = {
        roomClient: roomClientFacade,
        get shadowSnapshot() {
            return shadowSnapshot;
        },
        isConnected() {
            return roomClientFacade.isConnected();
        },
        requestSnapshot() {
            return roomClientFacade.requestSnapshot();
        },
        subscribeText(key) {
            return roomClientFacade.subscribeText(key);
        },
        sendTextUpdate(key, update) {
            return roomClientFacade.sendTextUpdate(key, update);
        },
        scheduleLocalFlush,
        flushLocalChanges,
        updatePresence,
        stop(reason = 'realtime-stop') {
            manualStop = true;
            clearFlushTimer();
            clearReconnectTimer();
            clearPresenceTimer();
            clearSnapshotTimer();
            if (activeClient) {
                activeClient.disconnect(1000, reason);
            } else {
                finalizeSessionClose({
                    code: 1000,
                    reason,
                    intentional: true
                });
            }
        }
    };

    try {
        await connectRealtimeClient({ reconnect: false });
    } catch (error) {
        if (shouldTreatConnectErrorAsTerminal(error)) {
            throw error;
        }
        throw error;
    }

    return session;
}
