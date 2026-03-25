export function parseJsonSafe(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

export async function readResponseSafe(response, fallback = {}) {
    try {
        return await response.json();
    } catch (error) {
        return fallback;
    }
}

export function endpointHintMessage(statusCode, domain) {
    if (statusCode === 404 || statusCode === 405) {
        return `${domain} indisponible (${statusCode}). Lance le backend local et le serveur statique du projet.`;
    }
    return '';
}

export function updateBoardQueryParam(boardId, options = {}) {
    const locationObject = options.locationObject || (typeof window !== 'undefined' ? window.location : null);
    const historyObject = options.historyObject || (typeof window !== 'undefined' ? window.history : null);
    if (!locationObject || !historyObject || typeof URL !== 'function') return false;

    try {
        const url = new URL(String(locationObject.href || ''));
        if (boardId) url.searchParams.set('board', boardId);
        else url.searchParams.delete('board');
        historyObject.replaceState({}, '', url.toString());
        return true;
    } catch (error) {
        return false;
    }
}

export function createStoredCollabStateBridge(options = {}) {
    const sessionStorageKey = String(options.sessionStorageKey || '').trim();
    const boardStorageKey = String(options.boardStorageKey || '').trim();
    const extraClearKeys = Array.isArray(options.extraClearKeys) ? options.extraClearKeys : [];

    function hydrate(target, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        if (!target || typeof target !== 'object') return target;
        target.pendingBoardId = '';
        target.token = '';
        target.user = null;
        target.activeBoardId = '';
        target.activeRole = '';
        target.activeBoardTitle = '';
        target.ownerId = '';
        target.activeBoardUpdatedAt = '';

        if (!storage) return target;

        if (sessionStorageKey) {
            const sessionRaw = storage.getItem(sessionStorageKey);
            const parsedSession = parseJsonSafe(sessionRaw || '{}', {});
            target.token = String(parsedSession?.token || '');
            target.user = parsedSession?.user && typeof parsedSession.user === 'object' ? parsedSession.user : null;
        }

        if (boardStorageKey) {
            const boardRaw = storage.getItem(boardStorageKey);
            const parsedBoard = parseJsonSafe(boardRaw || '{}', {});
            target.activeBoardId = String(parsedBoard?.boardId || '');
            target.activeRole = String(parsedBoard?.role || '');
            target.activeBoardTitle = String(parsedBoard?.title || '');
            target.ownerId = String(parsedBoard?.ownerId || '');
            target.activeBoardUpdatedAt = String(parsedBoard?.updatedAt || '');
        }

        return target;
    }

    function persist(source, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        if (!storage || !source || typeof source !== 'object') return false;

        try {
            if (sessionStorageKey) {
                storage.setItem(sessionStorageKey, JSON.stringify({
                    token: String(source.token || ''),
                    user: source.user || null
                }));
            }

            if (boardStorageKey) {
                if (source.activeBoardId) {
                    storage.setItem(boardStorageKey, JSON.stringify({
                        boardId: String(source.activeBoardId || ''),
                        role: String(source.activeRole || ''),
                        title: String(source.activeBoardTitle || ''),
                        ownerId: String(source.ownerId || ''),
                        updatedAt: String(source.activeBoardUpdatedAt || '')
                    }));
                } else {
                    storage.removeItem(boardStorageKey);
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    function clear(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        if (!storage) return false;
        try {
            if (sessionStorageKey) storage.removeItem(sessionStorageKey);
            if (boardStorageKey) storage.removeItem(boardStorageKey);
            extraClearKeys.forEach((key) => {
                const safeKey = String(key || '').trim();
                if (safeKey) storage.removeItem(safeKey);
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    return {
        hydrate,
        persist,
        clear
    };
}

export function stopNamedTimer(target, timerKey) {
    if (!target || !timerKey) return false;
    if (target[timerKey]) {
        clearTimeout(target[timerKey]);
        target[timerKey] = null;
        return true;
    }
    return false;
}

export function queueNamedTimer(target, timerKey, callback, delayMs = 0) {
    if (!target || !timerKey || typeof callback !== 'function') return null;
    stopNamedTimer(target, timerKey);
    target[timerKey] = setTimeout(() => {
        target[timerKey] = null;
        callback();
    }, Math.max(0, Number(delayMs) || 0));
    return target[timerKey];
}

export function stopRetriableLoop(target, options = {}) {
    if (!target || typeof target !== 'object') return;
    const tokenKey = String(options.tokenKey || 'token');
    const timerKey = String(options.timerKey || 'timer');
    const runningKey = String(options.runningKey || 'running');
    const retryKey = String(options.retryKey || 'retryMs');
    const inFlightKey = String(options.inFlightKey || '');

    target[tokenKey] = Number(target[tokenKey] || 0) + 1;
    target[runningKey] = false;
    target[retryKey] = 0;
    if (inFlightKey) target[inFlightKey] = false;
    stopNamedTimer(target, timerKey);
}

export function scheduleRetriableLoop(target, options = {}, loopToken, delayMs = 0, callback = null) {
    if (!target || typeof target !== 'object' || typeof callback !== 'function') return null;
    const tokenKey = String(options.tokenKey || 'token');
    const timerKey = String(options.timerKey || 'timer');
    if (Number(target[tokenKey] || 0) !== Number(loopToken || 0)) return null;

    return queueNamedTimer(target, timerKey, () => {
        callback(loopToken);
    }, delayMs);
}

export function buildCollabAuthRequester(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const getToken = typeof options.getToken === 'function' ? options.getToken : () => '';
    const allowGetFallback = options.allowGetFallback !== false;
    const fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (...args) => fetch(...args);
    const originFactory = typeof options.originFactory === 'function'
        ? options.originFactory
        : () => (typeof window !== 'undefined' ? window.location.origin : '');

    return async function collabAuthRequest(action, payload = {}) {
        const token = String(getToken() || '').trim();
        const postResponse = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'x-collab-token': token } : {})
            },
            body: JSON.stringify({ action, ...payload })
        });

        let response = postResponse;
        let data = await readResponseSafe(postResponse, {});

        if (
            allowGetFallback &&
            response.status === 405 &&
            (action === 'me' || action === 'logout') &&
            (!response.ok || !data.ok)
        ) {
            const url = new URL(endpoint, originFactory() || undefined);
            url.searchParams.set('action', action);
            if (token) url.searchParams.set('token', token);
            response = await fetchImpl(url.toString(), {
                method: 'GET',
                headers: token ? { 'x-collab-token': token } : {}
            });
            data = await readResponseSafe(response, {});
        }

        if (!response.ok || !data.ok) {
            const error = new Error(endpointHintMessage(response.status, 'Auth') || data.error || `Erreur auth (${response.status})`);
            error.status = response.status;
            error.payload = data || {};
            throw error;
        }

        return data;
    };
}

export function buildCollabBoardRequester(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const getToken = typeof options.getToken === 'function' ? options.getToken : () => '';
    const fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (...args) => fetch(...args);

    return async function collabBoardRequest(action, payload = {}) {
        const token = String(getToken() || '').trim();
        if (!token) throw new Error('Session cloud manquante.');

        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-collab-token': token
            },
            body: JSON.stringify({ action, ...payload })
        });

        const data = await readResponseSafe(response, {});
        if (!response.ok || !data.ok) {
            const error = new Error(endpointHintMessage(response.status, 'Cloud') || data.error || `Erreur cloud (${response.status})`);
            error.status = response.status;
            error.payload = data || {};
            throw error;
        }

        return data;
    };
}
