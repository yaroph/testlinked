import {
    state,
    getMapData,
    exportToJSON,
    setGroups,
    saveLocalState,
    setLocalPersistenceEnabled,
    isLocalPersistenceEnabled
} from './state.js';
import { renderGroupsList } from './ui-list.js';
import { renderAll } from './render.js';
import {
    customAlert,
    customConfirm,
    customPrompt,
    openModalOverlay,
    closeModalOverlay,
    setModalOverlayDismissHandler
} from './ui-modals.js';
import { escapeHtml } from './utils.js';
import {
    parseJsonSafe as parseStoredJsonSafe,
    readResponseSafe as readCollabResponseSafe,
    endpointHintMessage as getEndpointHintMessage,
    updateBoardQueryParam,
    createStoredCollabStateBridge,
    buildCollabAuthRequester,
    buildCollabBoardRequester,
    stopNamedTimer,
    queueNamedTimer,
    stopRetriableLoop,
    scheduleRetriableLoop
} from '../../shared/js/collab-browser.mjs';
import { createBrowserDebugLogger } from '../../shared/js/browser-debug.mjs';
import {
    MAP_SHARED_SNAPSHOT_STORAGE_KEY,
    clearSharedMapSnapshot,
    writeSharedMapSnapshot
} from '../../shared/js/map-link-contract.mjs';
import {
    normalizeMapBoardPayload as normalizeSharedMapBoardPayload,
    normalizeOptionalMapBoardPayload as normalizeSharedOptionalMapBoardPayload,
    mergeMapBoardPayload as mergeSharedMapBoardPayload
} from '../../shared/js/map-board.mjs';
import {
    isCloudBoardActive as isSharedCloudBoardActive,
    isCloudOwner as isSharedCloudOwner,
    isLocalSaveLocked as isSharedLocalSaveLocked,
    canEditCloudBoard as canSharedEditCloudBoard
} from '../../shared/js/collab-state.mjs';
import { bindAsyncActionButton } from '../../shared/js/ui-async.mjs';
import { clampMapCursorCoord, normalizeMapCursorPresence } from '../../shared/js/collab-cursor-visuals.mjs';
import { clearMapRemoteCursors, syncMapRemoteCursors } from './collab-cursors.js';
import { attachAsyncAutocomplete } from '../../shared/js/async-autocomplete.mjs';

const COLLAB_AUTH_ENDPOINT = '/.netlify/functions/collab-auth';
const COLLAB_BOARD_ENDPOINT = '/.netlify/functions/collab-board';
const COLLAB_SESSION_STORAGE_KEY = 'bniLinkedCollabSession_v1';
const COLLAB_ACTIVE_BOARD_STORAGE_KEY = 'bniLinkedMapActiveBoard_v1';
const MAP_LOCAL_CHANGE_EVENT = 'bni:map-local-change';

const collab = {
    token: '',
    user: null,
    activeBoardId: '',
    activeRole: '',
    activeBoardTitle: '',
    ownerId: '',
    activeBoardUpdatedAt: '',
    pendingBoardId: '',
    autosaveDebounceTimer: null,
    syncTimer: null,
    syncLoopToken: 0,
    syncRetryMs: 0,
    syncLoopRunning: false,
    autosaveListenerBound: false,
    syncInFlight: false,
    lastSavedFingerprint: '',
    shadowData: null,
    saveInFlight: false,
    presence: [],
    presenceTimer: null,
    presenceLoopToken: 0,
    presenceLoopRunning: false,
    presenceRetryMs: 0,
    presenceInFlight: false,
    homePanel: 'cloud',
    homeRenderSeq: 0,
    profileFlash: '',
    activeEditLock: null,
    editLockTimer: null,
    editLockLoopToken: 0,
    editLockLoopRunning: false,
    editLockRetryMs: 0,
    editLockInFlight: false,
    activeTextKey: '',
    activeTextLabel: '',
    activeTextSelectionStart: null,
    activeTextSelectionEnd: null,
    activeTextSelectionDirection: 'none',
    suppressAutosave: 0,
    cursorVisible: false,
    cursorMapX: 50,
    cursorMapY: 50,
    cursorSyncTimer: null,
    cursorLastSentAt: 0
};

export const mapDebugLogger = createBrowserDebugLogger({
    namespace: 'map-diag',
    queryParams: ['debugCloud', 'debugMap', 'debugMapCloud', 'debug'],
    storageKeys: ['BNI_DEBUG_MAP', 'BNI_DEBUG_CLOUD', 'BNI_DEBUG_MAP_CLOUD'],
    windowFlags: ['BNI_DEBUG_MAP', 'BNI_DEBUG_CLOUD']
});

const COLLAB_AUTOSAVE_DEBOUNCE_MS = 1600;
const COLLAB_AUTOSAVE_RETRY_MS = 250;
const COLLAB_WATCH_TIMEOUT_MS = 12000;
const COLLAB_WATCH_RETRY_MIN_MS = 1000;
const COLLAB_WATCH_RETRY_MAX_MS = 8000;
const COLLAB_PRESENCE_HEARTBEAT_MS = 12000;
const COLLAB_PRESENCE_RETRY_MS = 5000;
const COLLAB_CURSOR_REALTIME_MS = 80;
const COLLAB_CURSOR_LEGACY_MS = 180;
const COLLAB_EDIT_LOCK_HEARTBEAT_MS = 20000;
const COLLAB_EDIT_LOCK_RETRY_MS = 5000;
const collabStorage = createStoredCollabStateBridge({
    sessionStorageKey: COLLAB_SESSION_STORAGE_KEY,
    boardStorageKey: COLLAB_ACTIVE_BOARD_STORAGE_KEY,
    extraClearKeys: [MAP_SHARED_SNAPSHOT_STORAGE_KEY]
});
const sharedCollabAuthRequest = buildCollabAuthRequester({
    endpoint: COLLAB_AUTH_ENDPOINT,
    getToken: () => collab.token,
    allowGetFallback: true
});
const sharedCollabBoardRequest = buildCollabBoardRequester({
    endpoint: COLLAB_BOARD_ENDPOINT,
    getToken: () => collab.token
});

const MAP_REALTIME_TEXT_FIELDS = {
    point: {
        name: { label: 'Nom', awarenessId: 'mapAwPointName' },
        type: { label: 'Type', awarenessId: 'mapAwPointType' },
        notes: { label: 'Notes', awarenessId: 'mapAwPointNotes' }
    },
    zone: {
        name: { label: 'Nom zone', awarenessId: 'mapAwZoneName' }
    }
};

function hasOwnField(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function nowDiagMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function elapsedDiagMs(startedAt) {
    return Math.max(0, Math.round((nowDiagMs() - Number(startedAt || 0)) * 10) / 10);
}

function shortDiagId(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 18) return text;
    return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function getMapPayloadSummary(payload = null) {
    const source = payload && typeof payload === 'object' ? payload : getCloudMapPayload();
    const groups = Array.isArray(source?.groups) ? source.groups : [];
    let points = 0;
    let zones = 0;
    let unnamedPoints = 0;
    let unnamedZones = 0;
    groups.forEach((group) => {
        const groupPoints = Array.isArray(group?.points) ? group.points : [];
        const groupZones = Array.isArray(group?.zones) ? group.zones : [];
        points += groupPoints.length;
        zones += groupZones.length;
        unnamedPoints += groupPoints.reduce((count, point) => count + (String(point?.name || '').trim() ? 0 : 1), 0);
        unnamedZones += groupZones.reduce((count, zone) => count + (String(zone?.name || '').trim() ? 0 : 1), 0);
    });
    return {
        groups: groups.length,
        points,
        zones,
        unnamedPoints,
        unnamedZones,
        tacticalLinks: Array.isArray(source?.tacticalLinks) ? source.tacticalLinks.length : 0,
        fileName: String(state.currentFileName || '')
    };
}

function getMapDiagState(extra = {}) {
    return {
        user: collab.user?.username || '',
        hasToken: Boolean(collab.token),
        boardId: shortDiagId(collab.activeBoardId),
        boardTitle: collab.activeBoardTitle || '',
        localPersistenceEnabled: isLocalPersistenceEnabled(),
        workspace: getMapPayloadSummary(),
        ...extra
    };
}

function summarizeMapCloudResponse(action, result = {}) {
    if (action === 'me') {
        return {
            user: result?.user?.username || '',
            hasUser: Boolean(result?.user)
        };
    }
    if (action === 'list_boards') {
        return {
            boardCount: Array.isArray(result?.boards) ? result.boards.length : 0
        };
    }
    if (action === 'watch_board') {
        return {
            changed: Boolean(result?.changed),
            deleted: Boolean(result?.deleted),
            revoked: Boolean(result?.revoked),
            updatedAt: String(result?.updatedAt || ''),
            presenceCount: Array.isArray(result?.presence) ? result.presence.length : 0
        };
    }
    if (action === 'touch_presence' || action === 'clear_presence') {
        return {
            presenceCount: Array.isArray(result?.presence) ? result.presence.length : 0
        };
    }
    if ((action === 'get_board' || action === 'save_board' || action === 'create_board') && result?.board) {
        const payload = result.board.data ? normalizeOptionalMapBoardData(result.board.data) : null;
        return {
            boardId: shortDiagId(result.board.id || ''),
            page: String(result.board.page || ''),
            role: String(result.role || result.board.role || ''),
            title: String(result.board.title || ''),
            workspace: payload ? getMapPayloadSummary(payload) : null,
            mergedConflict: Boolean(result?.mergedConflict)
        };
    }
    return {};
}

if (typeof window !== 'undefined') {
    window.__BNI_MAP_DEBUG__ = mapDebugLogger;
    window.__BNI_MAP_DIAG_STATE__ = () => getMapDiagState();
}

function parseJsonSafe(value) {
    return parseStoredJsonSafe(value, null);
}

async function preloadRealtimeTextTools() {
    return null;
}

async function readResponseSafe(response) {
    return readCollabResponseSafe(response, {});
}

function endpointHintMessage(statusCode, domain) {
    return getEndpointHintMessage(statusCode, domain);
}

function setBoardQueryParam(boardId) {
    updateBoardQueryParam(boardId);
}

function isCloudBoardActive() {
    return isSharedCloudBoardActive(collab);
}

function isCloudOwner() {
    return isSharedCloudOwner(collab);
}

export function isLocalSaveLocked() {
    return isSharedLocalSaveLocked(collab);
}

export function canEditCloudBoard() {
    return canSharedEditCloudBoard(collab);
}

function hasCloudEditRole() {
    const role = String(collab.activeRole || '');
    return role === 'owner' || role === 'editor';
}

export function isCloudBoardReadOnly() {
    return isCloudBoardActive() && !canEditCloudBoard();
}

export function getCloudReadOnlyMessage() {
    if (!isCloudBoardActive()) return '';
    if (collab.activeEditLock?.heldByOther) {
        return getActiveEditLockMessage(collab.activeEditLock);
    }
    if (hasCloudEditRole()) {
        return 'Lecture seule. Clique sur Rafraichir pour reprendre la main.';
    }
    return 'Lecture seule sur ce board.';
}

function showCloudReadOnlyAlert() {
    const message = getCloudReadOnlyMessage() || 'Lecture seule sur ce board.';
    customAlert('CLOUD', message).catch(() => {});
}

export function ensureCloudWriteAccess() {
    if (!isCloudBoardReadOnly()) return true;
    showCloudReadOnlyAlert();
    return false;
}

function shouldUseRealtimeCloud() {
    return false;
}

function isRealtimeCloudActive() {
    return false;
}

function getMapSelectedEntity() {
    if (state.selectedPoint) {
        const group = state.groups[state.selectedPoint.groupIndex];
        const point = group?.points?.[state.selectedPoint.pointIndex] || null;
        if (point) {
            return {
                entityType: 'point',
                entity: point,
                label: String(point.name || '')
            };
        }
    }
    if (state.selectedZone) {
        const group = state.groups[state.selectedZone.groupIndex];
        const zone = group?.zones?.[state.selectedZone.zoneIndex] || null;
        if (zone) {
            return {
                entityType: 'zone',
                entity: zone,
                label: String(zone.name || '')
            };
        }
    }
    return null;
}

function findMapPointById(pointId) {
    const cleanPointId = String(pointId || '').trim();
    if (!cleanPointId) return null;
    for (const group of state.groups) {
        const point = (Array.isArray(group?.points) ? group.points : [])
            .find((entry) => String(entry?.id || '') === cleanPointId);
        if (point) return point;
    }
    return null;
}

function findMapZoneById(zoneId) {
    const cleanZoneId = String(zoneId || '').trim();
    if (!cleanZoneId) return null;
    for (const group of state.groups) {
        const zone = (Array.isArray(group?.zones) ? group.zones : [])
            .find((entry) => String(entry?.id || '') === cleanZoneId);
        if (zone) return zone;
    }
    return null;
}

function getMapRealtimeTextKey(entityType, entityId, fieldName) {
    void entityType;
    void entityId;
    void fieldName;
    return '';
}

function getMapFieldConfig(entityType, fieldName) {
    return MAP_REALTIME_TEXT_FIELDS[String(entityType || '').trim()]?.[String(fieldName || '').trim()] || null;
}

function clearMapRealtimeFieldPresence(options = {}) {
    const shouldNotify = Boolean(options.notify);
    const hadPresence = Boolean(collab.activeTextKey || collab.activeTextLabel);
    collab.activeTextKey = '';
    collab.activeTextLabel = '';
    collab.activeTextSelectionStart = null;
    collab.activeTextSelectionEnd = null;
    collab.activeTextSelectionDirection = 'none';
    if (shouldNotify) {
        updateMapCloudPresence().catch(() => {});
    } else if (hadPresence) {
        syncMapFieldAwarenessDecorations();
    }
}

function setMapRealtimeFieldPresence(textKey, textLabel) {
    const nextKey = String(textKey || '').trim();
    const nextLabel = String(textLabel || '').trim();
    if (collab.activeTextKey === nextKey && collab.activeTextLabel === nextLabel) return;
    collab.activeTextKey = nextKey;
    collab.activeTextLabel = nextLabel;
    collab.activeTextSelectionStart = null;
    collab.activeTextSelectionEnd = null;
    collab.activeTextSelectionDirection = 'none';
    syncMapFieldAwarenessDecorations();
}

function setMapRealtimeFieldSelection(textKey, selection = {}, options = {}) {
    if (String(collab.activeTextKey || '') !== String(textKey || '')) return;
    const nextStart = typeof selection?.selectionStart === 'number' ? selection.selectionStart : null;
    const nextEnd = typeof selection?.selectionEnd === 'number' ? selection.selectionEnd : nextStart;
    const nextDirection = typeof selection?.selectionDirection === 'string' ? selection.selectionDirection : 'none';
    const didChange = collab.activeTextSelectionStart !== nextStart
        || collab.activeTextSelectionEnd !== nextEnd
        || String(collab.activeTextSelectionDirection || 'none') !== nextDirection;
    collab.activeTextSelectionStart = nextStart;
    collab.activeTextSelectionEnd = nextEnd;
    collab.activeTextSelectionDirection = nextDirection;
    if (!didChange || options.notify === false) return;
    syncMapFieldAwarenessDecorations();
}

function clearMapCursorSyncTimer() {
    stopNamedTimer(collab, 'cursorSyncTimer');
}

function updateMapPresence(entries = []) {
    const deduped = new Map();
    (Array.isArray(entries) ? entries : []).forEach((row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return;
        const cursor = normalizeMapCursorPresence(row);
        deduped.set(userId, {
            userId,
            username: String(row?.username || 'operateur'),
            role: String(row?.role || ''),
            activeNodeId: String(row?.activeNodeId || ''),
            activeNodeName: String(row?.activeNodeName || ''),
            activeTextKey: String(row?.activeTextKey || ''),
            activeTextLabel: String(row?.activeTextLabel || ''),
            activeTextSelectionStart: typeof row?.activeTextSelectionStart === 'number' ? row.activeTextSelectionStart : null,
            activeTextSelectionEnd: typeof row?.activeTextSelectionEnd === 'number' ? row.activeTextSelectionEnd : null,
            activeTextSelectionDirection: String(row?.activeTextSelectionDirection || 'none'),
            mode: String(row?.mode || 'editing'),
            cursorVisible: cursor.cursorVisible,
            cursorMapX: cursor.cursorMapX,
            cursorMapY: cursor.cursorMapY,
            isSelf: userId === String(collab.user?.id || '')
        });
    });
    collab.presence = [...deduped.values()].sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        return String(a.username || '').localeCompare(String(b.username || ''));
    });
    syncMapRemoteCursors(collab.presence);
    syncMapFieldAwarenessDecorations();
}

function buildMapPresencePayload(extra = {}) {
    const selected = getMapSelectedEntity();
    const cursorVisible = hasOwnField(extra, 'cursorVisible')
        ? Boolean(extra.cursorVisible)
        : Boolean(collab.cursorVisible);
    const cursorMapX = hasOwnField(extra, 'cursorMapX')
        ? clampMapCursorCoord(extra.cursorMapX, collab.cursorMapX || 50)
        : clampMapCursorCoord(collab.cursorMapX, 50);
    const cursorMapY = hasOwnField(extra, 'cursorMapY')
        ? clampMapCursorCoord(extra.cursorMapY, collab.cursorMapY || 50)
        : clampMapCursorCoord(collab.cursorMapY, 50);
    return {
        activeNodeId: String(extra.activeNodeId || extra.activePointId || selected?.entity?.id || ''),
        activeNodeName: String(extra.activeNodeName || extra.activeLabel || selected?.label || ''),
        activeTextKey: String(extra.activeTextKey || collab.activeTextKey || ''),
        activeTextLabel: String(extra.activeTextLabel || collab.activeTextLabel || ''),
        activeTextSelectionStart: hasOwnField(extra, 'activeTextSelectionStart')
            ? (typeof extra.activeTextSelectionStart === 'number' ? extra.activeTextSelectionStart : null)
            : collab.activeTextSelectionStart,
        activeTextSelectionEnd: hasOwnField(extra, 'activeTextSelectionEnd')
            ? (typeof extra.activeTextSelectionEnd === 'number' ? extra.activeTextSelectionEnd : null)
            : collab.activeTextSelectionEnd,
        activeTextSelectionDirection: String(
            extra.activeTextSelectionDirection
            || collab.activeTextSelectionDirection
            || 'none'
        ),
        mode: String(extra.mode || (canEditCloudBoard() ? 'editing' : 'viewing')),
        cursorVisible,
        cursorMapX,
        cursorMapY
    };
}

function formatMapSelectionAwareness(entry = {}) {
    const start = Number.isFinite(Number(entry?.activeTextSelectionStart)) ? Number(entry.activeTextSelectionStart) : null;
    const end = Number.isFinite(Number(entry?.activeTextSelectionEnd)) ? Number(entry.activeTextSelectionEnd) : start;
    if (start === null || end === null) return '';
    if (end > start) {
        return `selection ${start + 1}-${end}`;
    }
    return `curseur ${start + 1}`;
}

function getMapAwarenessMessage(textKey) {
    void textKey;
    return '';
}

export function syncMapFieldAwarenessDecorations() {
    const selected = getMapSelectedEntity();
    Object.entries(MAP_REALTIME_TEXT_FIELDS).forEach(([entityType, fields]) => {
        Object.entries(fields).forEach(([fieldName, config]) => {
            const el = document.getElementById(config.awarenessId);
            if (!el) return;
            const textKey = selected && selected.entityType === entityType
                ? getMapRealtimeTextKey(entityType, selected.entity.id, fieldName)
                : '';
            const message = getMapAwarenessMessage(textKey);
            el.textContent = message;
            el.style.display = message ? 'block' : 'none';
        });
    });
}

function persistCollabState() {
    collabStorage.persist(collab);
}

function clearCollabStorage() {
    collabStorage.clear();
}

function syncSharedMapSnapshot(payload = null) {
    if (!collab.activeBoardId || !payload || !Array.isArray(payload.groups)) {
        clearSharedMapSnapshot();
        return;
    }

    writeSharedMapSnapshot(localStorage, {
        boardId: collab.activeBoardId,
        updatedAt: collab.activeBoardUpdatedAt || '',
        data: payload
    });
}

function hydrateCollabState() {
    collabStorage.hydrate(collab);
    mapDebugLogger.log('hydrate-collab-state', getMapDiagState({
        pendingBoardId: shortDiagId(collab.pendingBoardId),
        storedUser: collab.user?.username || ''
    }));
}

function syncCloudStatus() {
    const statusEl = document.getElementById('cloudStatus');
    const metaEl = document.getElementById('cloudStatusMeta');
    if (!statusEl) return;

    const setStatus = (label, stateKey, meta) => {
        statusEl.textContent = label;
        statusEl.dataset.state = stateKey;
        if (metaEl) {
            metaEl.textContent = meta;
            metaEl.dataset.state = stateKey;
        }
    };

    if (!collab.user) {
        setStatus('Local', 'local', 'Hors ligne');
        return;
    }

    if (collab.activeBoardId) {
        const role = collab.activeRole || 'editor';
        const lockedByOther = isCloudBoardReadOnly();
        const stateKey = lockedByOther ? 'cloud-viewer' : (role === 'owner' ? 'cloud-lead' : 'cloud-member');
        const label = lockedByOther ? 'Cloud lecture' : (role === 'owner' ? 'Cloud lead' : 'Cloud membre');
        const meta = lockedByOther
            ? `${collab.activeBoardTitle || collab.activeBoardId || 'Board actif'} · ${getCloudReadOnlyMessage()}`
            : (collab.activeBoardTitle || collab.activeBoardId || 'Board actif');
        setStatus(label, stateKey, meta);
        return;
    }

    setStatus('Session cloud', 'session', collab.user.username || 'Connecte');
}

function normalizeActiveEditLock(rawLock = null) {
    if (!rawLock || typeof rawLock !== 'object') return null;
    const boardId = String(rawLock.boardId || collab.activeBoardId || '').trim();
    const userId = String(rawLock.userId || '').trim();
    if (!boardId || !userId) return null;
    const username = String(rawLock.username || 'operateur').trim() || 'operateur';
    const isSelf = Boolean(rawLock.isSelf);
    const heldByOther = Boolean(rawLock.heldByOther) || (!isSelf && userId !== String(collab.user?.id || ''));
    return {
        boardId,
        userId,
        username,
        isSelf,
        heldByOther,
        message: String(rawLock.message || (heldByOther ? `${username} modifie deja ce board.` : 'Edition reservee pour toi.')),
        acquiredAt: String(rawLock.acquiredAt || ''),
        lastAt: String(rawLock.lastAt || ''),
        expiresAt: String(rawLock.expiresAt || '')
    };
}

function getActiveEditLockMessage(lock = collab.activeEditLock) {
    if (!lock) return '';
    if (lock.heldByOther) {
        return String(lock.message || `${lock.username || 'Une autre personne'} modifie deja ce board.`);
    }
    if (lock.isSelf) {
        return 'Edition exclusive active';
    }
    return '';
}

function updateActiveEditLock(rawLock = null) {
    collab.activeEditLock = normalizeActiveEditLock(rawLock);
    applyLocalPersistencePolicy();
    syncCloudStatus();
    if (isCloudBoardActive() && (state.selectedPoint || state.selectedZone)) {
        import('./ui-editor.js').then((module) => {
            module.renderEditor?.();
        }).catch(() => {});
    }
    if (!collab.activeEditLock?.isSelf) {
        stopCollabRealtime();
        stopCollabAutosave();
        stopCollabLiveSync();
        stopCollabPresence();
        stopEditLockHeartbeat();
    }
}

function stopEditLockHeartbeat() {
    stopRetriableLoop(collab, {
        timerKey: 'editLockTimer',
        tokenKey: 'editLockLoopToken',
        runningKey: 'editLockLoopRunning',
        retryKey: 'editLockRetryMs',
        inFlightKey: 'editLockInFlight'
    });
}

function scheduleNextEditLockTick(loopToken, delayMs = COLLAB_EDIT_LOCK_HEARTBEAT_MS) {
    return scheduleRetriableLoop(collab, {
        timerKey: 'editLockTimer',
        tokenKey: 'editLockLoopToken'
    }, loopToken, delayMs, () => {
        refreshActiveEditLock(loopToken).catch(() => {});
    });
}

async function refreshActiveEditLock(loopToken = collab.editLockLoopToken, options = {}) {
    const quiet = Boolean(options.quiet);
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    if (collab.editLockLoopToken !== loopToken && !options.force) return false;
    if (!canEditCloudBoard() && !options.allowClaim) return false;
    if (collab.editLockInFlight) return false;

    collab.editLockInFlight = true;
    try {
        const result = await collabBoardRequest('refresh_edit_lock', {
            boardId: collab.activeBoardId
        });
        updateActiveEditLock(result?.editLock || null);
        collab.editLockRetryMs = COLLAB_EDIT_LOCK_RETRY_MS;
        if (collab.editLockLoopToken === loopToken || options.force) {
            scheduleNextEditLockTick(loopToken, COLLAB_EDIT_LOCK_HEARTBEAT_MS);
        }
        return Boolean(result?.ok);
    } catch (e) {
        const lockedByOther = Number(e?.status) === 423 && e?.payload?.editLock;
        if (lockedByOther) {
            updateActiveEditLock(e.payload.editLock);
            if (!quiet) {
                await customAlert('CLOUD', escapeHtml(getActiveEditLockMessage(e.payload.editLock) || 'Lecture seule active.'));
            }
            return false;
        }

        collab.editLockRetryMs = collab.editLockRetryMs
            ? Math.min(COLLAB_EDIT_LOCK_HEARTBEAT_MS, collab.editLockRetryMs * 2)
            : COLLAB_EDIT_LOCK_RETRY_MS;
        if (collab.editLockLoopToken === loopToken || options.force) {
            scheduleNextEditLockTick(loopToken, collab.editLockRetryMs);
        }
        return false;
    } finally {
        collab.editLockInFlight = false;
    }
}

function startEditLockHeartbeat() {
    stopEditLockHeartbeat();
    if (!isCloudBoardActive() || !collab.user || !collab.token || !canEditCloudBoard()) return false;
    const loopToken = collab.editLockLoopToken + 1;
    collab.editLockLoopToken = loopToken;
    collab.editLockLoopRunning = true;
    collab.editLockRetryMs = COLLAB_EDIT_LOCK_RETRY_MS;
    scheduleNextEditLockTick(loopToken, COLLAB_EDIT_LOCK_HEARTBEAT_MS);
    return true;
}

async function releaseActiveEditLock(boardId = collab.activeBoardId) {
    const targetBoardId = String(boardId || '').trim();
    stopEditLockHeartbeat();
    if (!targetBoardId || !collab.token) {
        updateActiveEditLock(null);
        return false;
    }
    try {
        await collabBoardRequest('release_edit_lock', { boardId: targetBoardId });
    } catch (e) {}
    updateActiveEditLock(null);
    return true;
}

function applyLocalPersistencePolicy() {
    if (isLocalSaveLocked()) {
        setLocalPersistenceEnabled(false, { purge: true });
    } else if (!isLocalPersistenceEnabled()) {
        setLocalPersistenceEnabled(true);
    }
}

function updateActiveBoardSummary(summary = null) {
    if (!summary || !summary.id) return;
    collab.activeBoardId = String(summary.id || collab.activeBoardId || '');
    collab.activeRole = String(summary.role || collab.activeRole || '');
    collab.activeBoardTitle = String(summary.title || collab.activeBoardTitle || '');
    collab.ownerId = String(summary.ownerId || collab.ownerId || '');
    collab.activeBoardUpdatedAt = String(summary.updatedAt || collab.activeBoardUpdatedAt || '');
    syncCloudStatus();
    persistCollabState();
}

function cloneJsonSafe(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return fallback;
    }
}

function getCloudMapPayload() {
    return {
        groups: cloneJsonSafe(state.groups || [], []),
        tacticalLinks: cloneJsonSafe(state.tacticalLinks || [], [])
    };
}

function computeCloudFingerprint() {
    try {
        if (!isCloudBoardActive()) return '';
        return JSON.stringify(normalizeSharedMapBoardPayload(getCloudMapPayload()));
    } catch (e) {
        return '';
    }
}

function captureCloudSavedFingerprint() {
    const fp = computeCloudFingerprint();
    collab.lastSavedFingerprint = fp;
    return fp;
}

function hasLocalCloudChanges() {
    if (!isCloudBoardActive()) return false;
    const current = computeCloudFingerprint();
    return Boolean(current) && current !== String(collab.lastSavedFingerprint || '');
}

function withoutCloudAutosave(fn) {
    collab.suppressAutosave += 1;
    try {
        return fn();
    } finally {
        collab.suppressAutosave = Math.max(0, collab.suppressAutosave - 1);
    }
}

function stopCollabRealtime() {
    clearMapCursorSyncTimer();
    stopMapRealtimeText();
}

function stopMapRealtimeText() {
    clearMapRealtimeFieldPresence({ notify: false });
}

function setMapRealtimeFieldValue(entityType, entityId, fieldName, nextValue, options = {}) {
    void entityType;
    void entityId;
    void fieldName;
    void nextValue;
    void options;
    return false;
}

function ensureMapRealtimeTextBinding(entityType, entityId, fieldName) {
    void entityType;
    void entityId;
    void fieldName;
    return null;
}

function handleMapRealtimeTextUpdate(payload = {}) {
    void payload;
}

export function bindMapCloudTextField(entityType, entity, fieldName, field) {
    void entityType;
    void entity;
    void fieldName;
    void field;
    return false;
}

export function unbindMapCloudTextFields() {
    clearMapRealtimeFieldPresence({ notify: false });
}

export async function updateMapCloudPresence(extra = {}) {
    void extra;
    return false;
}

async function flushMapCursorPresence() {
    clearMapCursorSyncTimer();
    return false;
}

function scheduleMapCursorPresenceSync(delayMs = null) {
    void delayMs;
    return false;
}

export function updateMapLiveCursor(mapX, mapY) {
    collab.cursorVisible = true;
    collab.cursorMapX = clampMapCursorCoord(mapX, collab.cursorMapX || 50);
    collab.cursorMapY = clampMapCursorCoord(mapY, collab.cursorMapY || 50);
}

export function clearMapLiveCursor(options = {}) {
    void options;
    collab.cursorVisible = false;
}

function startCheckpointCloudTransport() {
    stopCollabRealtime();
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    updateMapPresence([]);
    ensureCollabAutosaveListener();
    if (canEditCloudBoard()) {
        startCollabAutosave();
        startEditLockHeartbeat();
    } else {
        stopEditLockHeartbeat();
    }
}

async function activateCloudTransport() {
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    stopEditLockHeartbeat();
    mapDebugLogger.log('activate-cloud-transport', getMapDiagState({
        shouldUseRealtime: shouldUseRealtimeCloud()
    }));
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        stopCollabRealtime();
        updateMapPresence([]);
        return false;
    }

    startCheckpointCloudTransport();
    return false;
}

async function startCollabRealtime() {
    stopCollabRealtime();
    return false;
}

function stopCollabAutosave() {
    stopNamedTimer(collab, 'autosaveDebounceTimer');
}

async function flushPendingCloudAutosave(boardId = collab.activeBoardId) {
    const targetBoardId = String(boardId || '').trim();
    if (!targetBoardId) return false;
    if (String(collab.activeBoardId || '') !== targetBoardId) return false;
    if (!canEditCloudBoard()) return false;

    let waitCount = 0;
    while (collab.saveInFlight && waitCount < 20) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        waitCount += 1;
    }

    const hadDebounce = Boolean(collab.autosaveDebounceTimer);
    const hasChanges = hasLocalCloudChanges();
    if (!hadDebounce && !hasChanges) return false;

    stopCollabAutosave();
    return saveActiveCloudBoard({ manual: false, quiet: true, force: true });
}

function queueCloudAutosave(delayMs = COLLAB_AUTOSAVE_DEBOUNCE_MS) {
    if (!isCloudBoardActive() || !canEditCloudBoard()) return;
    stopCollabAutosave();
    queueNamedTimer(collab, 'autosaveDebounceTimer', () => {
        saveActiveCloudBoard({ manual: false, quiet: true }).catch(() => {});
    }, delayMs);
}

function onMapLocalChange() {
    if (collab.suppressAutosave > 0) return;
    if (isCloudBoardActive()) {
        syncSharedMapSnapshot(getCloudMapPayload());
    }
    queueCloudAutosave();
}

function ensureCollabAutosaveListener() {
    if (collab.autosaveListenerBound) return;
    collab.autosaveListenerBound = true;
    window.addEventListener(MAP_LOCAL_CHANGE_EVENT, onMapLocalChange);
}

function startCollabAutosave() {
    ensureCollabAutosaveListener();
    if (!isCloudBoardActive() || !canEditCloudBoard()) {
        stopCollabAutosave();
        return;
    }
    queueCloudAutosave(COLLAB_AUTOSAVE_RETRY_MS);
}

function stopCollabLiveSync() {
    stopRetriableLoop(collab, {
        timerKey: 'syncTimer',
        tokenKey: 'syncLoopToken',
        runningKey: 'syncLoopRunning',
        retryKey: 'syncRetryMs'
    });
}

function stopCollabPresence() {
    clearMapCursorSyncTimer();
    stopRetriableLoop(collab, {
        timerKey: 'presenceTimer',
        tokenKey: 'presenceLoopToken',
        runningKey: 'presenceLoopRunning',
        retryKey: 'presenceRetryMs',
        inFlightKey: 'presenceInFlight'
    });
}

function scheduleNextPresenceTick(loopToken, delayMs = COLLAB_PRESENCE_HEARTBEAT_MS) {
    scheduleRetriableLoop(collab, {
        timerKey: 'presenceTimer',
        tokenKey: 'presenceLoopToken'
    }, loopToken, delayMs, () => {
        touchCollabPresence(loopToken).catch(() => {});
    });
}

async function clearCollabPresence(boardId = collab.activeBoardId) {
    const targetBoardId = String(boardId || '').trim();
    if (!targetBoardId || !collab.token) return;
    try {
        await collabBoardRequest('clear_presence', { boardId: targetBoardId });
    } catch (e) {}
}

async function touchCollabPresence(loopToken = collab.presenceLoopToken, options = {}) {
    if (collab.presenceLoopToken !== loopToken && !options.force) return false;
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    if (!isRealtimeCloudActive()) return false;

    try {
        const sent = await updateMapCloudPresence(options.extra || {});
        return sent;
    } catch (e) {
        throw e;
    }
}

function startCollabPresence() {
    stopCollabPresence();
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        updateMapPresence([]);
        return;
    }
    const loopToken = collab.presenceLoopToken + 1;
    collab.presenceLoopToken = loopToken;
    collab.presenceLoopRunning = true;
    collab.presenceRetryMs = COLLAB_PRESENCE_RETRY_MS;
    if (isRealtimeCloudActive()) {
        touchCollabPresence(loopToken, { force: true }).catch(() => {});
        return;
    }
    touchCollabPresence(loopToken, { force: true }).catch(() => {});
}

function scheduleNextWatchTick(loopToken, delayMs = 0) {
    scheduleRetriableLoop(collab, {
        timerKey: 'syncTimer',
        tokenKey: 'syncLoopToken'
    }, loopToken, delayMs, () => {
        runCollabWatchLoop(loopToken).catch(() => {});
    });
}

async function runCollabWatchLoop(loopToken) {
    if (collab.syncLoopToken !== loopToken) return;
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        collab.syncLoopRunning = false;
        return;
    }

    try {
        const watch = await collabBoardRequest('watch_board', {
            boardId: collab.activeBoardId,
            sinceUpdatedAt: String(collab.activeBoardUpdatedAt || ''),
            timeoutMs: COLLAB_WATCH_TIMEOUT_MS
        });

        if (collab.syncLoopToken !== loopToken) return;
        collab.syncRetryMs = COLLAB_WATCH_RETRY_MIN_MS;
        updateMapPresence(watch?.presence || []);

        if (watch?.deleted || watch?.revoked) {
            setActiveCloudBoardFromSummary(null);
            setBoardQueryParam('');
            collab.syncLoopRunning = false;
            return;
        }

        if (watch?.changed) {
            const watchedUpdatedAt = String(watch.updatedAt || '');
            if (!watchedUpdatedAt || watchedUpdatedAt !== String(collab.activeBoardUpdatedAt || '')) {
                await syncActiveCloudBoard({ quiet: true });
            }
        }

        scheduleNextWatchTick(loopToken, 0);
    } catch (e) {
        if (collab.syncLoopToken !== loopToken) return;
        const status = Number(e?.status || 0);
        if (status === 401 || status === 403 || status === 404) {
            collab.syncLoopRunning = false;
            stopCollabLiveSync();
            return;
        }

        collab.syncRetryMs = collab.syncRetryMs
            ? Math.min(COLLAB_WATCH_RETRY_MAX_MS, collab.syncRetryMs * 2)
            : COLLAB_WATCH_RETRY_MIN_MS;
        scheduleNextWatchTick(loopToken, collab.syncRetryMs);
    }
}

function normalizeOptionalMapBoardData(rawData) {
    try {
        return normalizeSharedOptionalMapBoardPayload(rawData);
    } catch (e) {
        return { groups: [], tacticalLinks: [] };
    }
}

function setCloudShadowData(rawData) {
    collab.shadowData = cloneJsonSafe(
        normalizeOptionalMapBoardData(rawData),
        { groups: [], tacticalLinks: [] }
    );
    return collab.shadowData;
}

function mergeMapBoardData(remoteRaw, localRaw, baseRaw = null) {
    return normalizeSharedMapBoardPayload(
        mergeSharedMapBoardPayload(remoteRaw, localRaw, baseRaw)
    );
}

async function syncActiveCloudBoard(options = {}) {
    const quiet = Boolean(options.quiet);
    const allowDuringSave = Boolean(options.allowDuringSave);
    if (isRealtimeCloudActive()) return false;
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    if (collab.syncInFlight) return false;
    if (collab.saveInFlight && !allowDuringSave) return false;

    collab.syncInFlight = true;
    try {
        const result = await collabBoardRequest('get_board', { boardId: collab.activeBoardId });
        if (!result || !result.board || !result.board.data) return false;

        const remoteSummary = {
            id: result.board.id || collab.activeBoardId,
            role: result.role || collab.activeRole,
            title: result.board.title || collab.activeBoardTitle || state.currentFileName || 'Carte cloud',
            ownerId: result.board.ownerId || collab.ownerId || '',
            updatedAt: result.board.updatedAt || collab.activeBoardUpdatedAt || ''
        };

        const remoteUpdatedAt = String(remoteSummary.updatedAt || '');
        const localUpdatedAt = String(collab.activeBoardUpdatedAt || '');
        if (!remoteUpdatedAt || remoteUpdatedAt === localUpdatedAt) return false;

        const localChanged = hasLocalCloudChanges();
        updateActiveBoardSummary(remoteSummary);
        updateMapPresence(result?.presence || []);

        if (localChanged && canEditCloudBoard()) {
            const localSnapshot = getCloudMapPayload();
            const mergedPayload = mergeMapBoardData(result.board.data, localSnapshot, collab.shadowData);
            setCloudShadowData(result.board.data);
            applyCloudMapData(mergedPayload);
            state.currentFileName = remoteSummary.title;
            const mergedSaved = await saveActiveCloudBoard({ manual: false, quiet: true, force: true });
            if (!mergedSaved) return false;
            captureCloudSavedFingerprint();
            return true;
        }

        applyCloudMapData(result.board.data);
        updateMapPresence(result?.presence || []);
        setCloudShadowData(result.board.data);
        state.currentFileName = remoteSummary.title;
        captureCloudSavedFingerprint();
        return true;
    } catch (e) {
        if (!quiet) await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur sync cloud.'));
        return false;
    } finally {
        collab.syncInFlight = false;
    }
}

function startCollabLiveSync() {
    stopCollabLiveSync();
    if (!isCloudBoardActive() || !collab.user || !collab.token) return;
    if (isRealtimeCloudActive()) return;
    const loopToken = collab.syncLoopToken + 1;
    collab.syncLoopToken = loopToken;
    collab.syncLoopRunning = true;
    collab.syncRetryMs = COLLAB_WATCH_RETRY_MIN_MS;
    scheduleNextWatchTick(loopToken, 0);
}

async function collabAuthRequest(action, payload = {}) {
    const startedAt = nowDiagMs();
    mapDebugLogger.log('auth-request', {
        action,
        hasToken: Boolean(collab.token),
        username: action === 'me' || action === 'logout'
            ? (collab.user?.username || '')
            : String(payload?.username || '')
    });
    try {
        const result = await sharedCollabAuthRequest(action, payload);
        mapDebugLogger.log('auth-response', {
            action,
            ok: true,
            durationMs: elapsedDiagMs(startedAt),
            ...summarizeMapCloudResponse(action, result)
        });
        return result;
    } catch (error) {
        mapDebugLogger.error('auth-response', {
            action,
            ok: false,
            durationMs: elapsedDiagMs(startedAt),
            status: Number(error?.status || 0),
            message: error?.message || 'Erreur auth'
        });
        throw error;
    }
}

async function collabBoardRequest(action, payload = {}) {
    const startedAt = nowDiagMs();
    mapDebugLogger.log('board-request', {
        action,
        boardId: shortDiagId(payload?.boardId || collab.activeBoardId),
        hasToken: Boolean(collab.token)
    });
    try {
        const result = await sharedCollabBoardRequest(action, payload);
        mapDebugLogger.log('board-response', {
            action,
            ok: true,
            durationMs: elapsedDiagMs(startedAt),
            ...summarizeMapCloudResponse(action, result)
        });
        return result;
    } catch (error) {
        mapDebugLogger.error('board-response', {
            action,
            ok: false,
            durationMs: elapsedDiagMs(startedAt),
            boardId: shortDiagId(payload?.boardId || collab.activeBoardId),
            status: Number(error?.status || 0),
            message: error?.message || 'Erreur cloud'
        });
        throw error;
    }
}

function setActiveCloudBoardFromSummary(summary = null) {
    const previousBoardId = String(collab.activeBoardId || '');
    const nextBoardId = summary && summary.id ? String(summary.id || '') : '';
    const boardChanged = previousBoardId !== nextBoardId;
    if (boardChanged || !nextBoardId) {
        clearMapCursorSyncTimer();
        clearMapLiveCursor({ broadcast: false, resetPosition: true });
        stopEditLockHeartbeat();
        stopCollabRealtime();
        stopCollabAutosave();
        stopCollabLiveSync();
        stopCollabPresence();
    }
    if (!summary || !summary.id) {
        collab.activeBoardId = '';
        collab.activeRole = '';
        collab.activeBoardTitle = '';
        collab.ownerId = '';
        collab.activeBoardUpdatedAt = '';
        collab.activeEditLock = null;
        collab.lastSavedFingerprint = '';
        collab.shadowData = null;
        collab.presence = [];
        clearMapRemoteCursors();
        clearMapRealtimeFieldPresence({ notify: false });
        syncSharedMapSnapshot(null);
    } else {
        collab.activeBoardId = String(summary.id || '');
        collab.activeRole = String(summary.role || '');
        collab.activeBoardTitle = String(summary.title || '');
        collab.ownerId = String(summary.ownerId || '');
        collab.activeBoardUpdatedAt = String(summary.updatedAt || '');
        if (boardChanged) {
            collab.activeEditLock = null;
        }
    }

    if (previousBoardId && previousBoardId !== collab.activeBoardId) {
        syncSharedMapSnapshot(null);
    }
    applyLocalPersistencePolicy();
    syncCloudStatus();
    persistCollabState();
}

function normalizeMapBoardData(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        throw new Error('Board cloud map invalide.');
    }
    if (!Array.isArray(rawData.groups)) {
        throw new Error('Le board cloud ne contient pas de groupes.');
    }
    return normalizeSharedMapBoardPayload(rawData);
}

function applyCloudMapData(rawData) {
    return withoutCloudAutosave(() => {
        const normalized = normalizeMapBoardData(rawData);
        const summary = getMapPayloadSummary(normalized);
        mapDebugLogger.log('apply-cloud-board-data', getMapDiagState({
            incoming: summary
        }));
        if (summary.unnamedPoints > 0 || summary.unnamedZones > 0) {
            mapDebugLogger.warn('apply-cloud-board-data-unnamed', getMapDiagState({
                incoming: summary
            }));
        }
        state.tacticalLinks = normalized.tacticalLinks;
        setGroups(normalized.groups);
        state.tacticalLinks = normalized.tacticalLinks;
        renderGroupsList();
        renderAll();
        saveLocalState();
        syncSharedMapSnapshot(normalized);
        syncMapFieldAwarenessDecorations();
        return normalized;
    });
}

async function openCloudBoard(boardId, options = {}) {
    const targetId = String(boardId || '').trim();
    if (!targetId) throw new Error('Board cloud invalide.');
    mapDebugLogger.log('open-cloud-board-start', getMapDiagState({
        targetBoardId: shortDiagId(targetId)
    }));

    const result = await collabBoardRequest('get_board', { boardId: targetId });
    if (!result.board || !result.board.data) throw new Error('Board cloud corrompu.');

    const boardPage = String(result.board.page || 'point');
    if (boardPage !== 'map') {
        throw new Error('Ce board appartient au module Reseau, pas a la carte tactique.');
    }

    const summary = {
        id: result.board.id,
        role: result.role || 'editor',
        title: result.board.title || state.currentFileName || 'Carte cloud',
        ownerId: result.board.ownerId || '',
        updatedAt: result.board.updatedAt || ''
    };

    mapDebugLogger.log('open-cloud-board-data', getMapDiagState({
        targetBoardId: shortDiagId(targetId),
        role: summary.role,
        title: summary.title,
        incoming: getMapPayloadSummary(normalizeOptionalMapBoardData(result.board.data))
    }));

    setActiveCloudBoardFromSummary(summary);
    updateActiveEditLock(result?.editLock || null);
    applyCloudMapData(result.board.data);
    updateMapPresence(result.presence || []);
    setCloudShadowData(result.board.data);
    state.currentFileName = summary.title;
    captureCloudSavedFingerprint();
    setBoardQueryParam(summary.id);
    await activateCloudTransport();
    mapDebugLogger.log('open-cloud-board-ready', getMapDiagState({
        targetBoardId: shortDiagId(targetId),
        presenceCount: Array.isArray(result?.presence) ? result.presence.length : 0
    }));

    if (!options.quiet) {
        const lockMessage = isCloudBoardReadOnly()
            ? ` ${getCloudReadOnlyMessage()}`
            : '';
        await customAlert('CLOUD', `☁️ Board ouvert : ${escapeHtml(summary.title)}${escapeHtml(lockMessage)}`);
    }
}

async function refreshActiveCloudBoard(options = {}) {
    const quiet = Boolean(options.quiet);
    if (!isCloudBoardActive()) {
        if (!quiet) await customAlert('CLOUD', 'Aucun board cloud actif.');
        return false;
    }

    await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
    await openCloudBoard(collab.activeBoardId, { quiet: true });

    if (!quiet) {
        await customAlert(
            'CLOUD',
            canEditCloudBoard()
                ? '☁️ Board rafraichi. Edition active.'
                : `☁️ ${escapeHtml(getCloudReadOnlyMessage() || 'Lecture seule sur ce board.')}`
        );
    }
    return true;
}

async function stopEditingCurrentCloudBoard(options = {}) {
    const quiet = Boolean(options.quiet);
    if (!isCloudBoardActive()) {
        if (!quiet) await customAlert('CLOUD', 'Aucun board cloud actif.');
        return false;
    }
    if (!canEditCloudBoard()) {
        if (!quiet) await customAlert('CLOUD', escapeHtml(getCloudReadOnlyMessage() || 'Lecture seule sur ce board.'));
        return false;
    }

    await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    stopCollabRealtime();
    await releaseActiveEditLock(collab.activeBoardId).catch(() => {});
    updateMapPresence([]);

    if (!quiet) {
        await customAlert('CLOUD', '☁️ Edition relachee. Les autres peuvent reprendre la main.');
    }
    return true;
}

export async function saveActiveCloudBoard(options = {}) {
    const manual = Boolean(options.manual);
    const quiet = Boolean(options.quiet);
    const force = Boolean(options.force);

    if (!isCloudBoardActive()) {
        if (manual && !quiet) await customAlert('CLOUD', 'Aucun board cloud actif.');
        return false;
    }

    if (!canEditCloudBoard()) {
        if (manual && !quiet) await customAlert('CLOUD', escapeHtml(getCloudReadOnlyMessage() || "Tu n'as pas les droits d'edition cloud."));
        return false;
    }
    if (collab.saveInFlight) {
        if (!manual) queueCloudAutosave(COLLAB_AUTOSAVE_RETRY_MS);
        return false;
    }
    if (!force && !manual && !hasLocalCloudChanges()) return true;
    collab.saveInFlight = true;

    try {
        const title = (state.currentFileName || collab.activeBoardTitle || 'Carte cloud').trim();
        const payload = normalizeMapBoardData(getCloudMapPayload());
        const localFingerprint = JSON.stringify(payload);
        const result = await collabBoardRequest('save_board', {
            boardId: collab.activeBoardId,
            title,
            data: payload,
            ...(collab.shadowData ? { baseData: cloneJsonSafe(collab.shadowData, null) } : {}),
            ...(collab.activeBoardUpdatedAt ? { expectedUpdatedAt: collab.activeBoardUpdatedAt } : {})
        });

        if (result?.board) {
            collab.activeBoardTitle = String(result.board.title || title);
            collab.activeBoardUpdatedAt = String(result.board.updatedAt || collab.activeBoardUpdatedAt || '');
            updateActiveEditLock(result?.editLock || null);
            startEditLockHeartbeat();
            state.currentFileName = collab.activeBoardTitle;
            persistCollabState();
            syncCloudStatus();

            if (result.board.data) {
                const serverPayload = normalizeMapBoardData(result.board.data);
                const serverFingerprint = JSON.stringify(serverPayload);
                collab.lastSavedFingerprint = serverFingerprint;
                setCloudShadowData(serverPayload);

                if (serverFingerprint !== localFingerprint) {
                    applyCloudMapData(serverPayload);
                } else {
                    syncSharedMapSnapshot(serverPayload);
                }
            } else {
                collab.lastSavedFingerprint = localFingerprint;
                setCloudShadowData(payload);
                syncSharedMapSnapshot(payload);
            }
        }

        if (manual && !quiet) {
            await customAlert(
                'CLOUD',
                result?.mergedConflict ? '☁️ Board cloud sauvegarde avec fusion auto.' : '☁️ Board cloud sauvegarde.'
            );
        }
        return true;
    } catch (e) {
        if (e && Number(e.status) === 423) {
            updateActiveEditLock(e?.payload?.editLock || null);
            if (!quiet) await customAlert('CLOUD', escapeHtml(getCloudReadOnlyMessage() || e.message || 'Edition deja reservee.'));
            return false;
        }
        if (e && Number(e.status) === 409) {
            await syncActiveCloudBoard({ quiet: true, allowDuringSave: true });
            queueCloudAutosave(25);
            if (!quiet) await customAlert('CLOUD', 'Conflit detecte. Sync live appliquee automatiquement.');
            return false;
        }
        if (!quiet) await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
        return false;
    } finally {
        collab.saveInFlight = false;
        if (!manual && hasLocalCloudChanges()) {
            queueCloudAutosave(COLLAB_AUTOSAVE_RETRY_MS);
        }
    }
}

async function createCloudBoardFromCurrent() {
    if (!collab.user) throw new Error('Connexion cloud requise.');

    const defaultTitle = state.currentFileName || `map_${new Date().toISOString().slice(0, 10)}`;
    const titleRaw = await customPrompt(
        'NOUVEAU BOARD CLOUD',
        'Entrez le nom du board cloud :',
        defaultTitle
    );
    if (titleRaw === null) return false;

    const title = String(titleRaw || '').trim() || defaultTitle;
    const payload = normalizeMapBoardData(getCloudMapPayload());
    const result = await collabBoardRequest('create_board', {
        title,
        page: 'map',
        data: payload
    });

    if (!result.board) throw new Error('Creation cloud echouee.');

    setActiveCloudBoardFromSummary({
        id: result.board.id,
        role: result.board.role || 'owner',
        title: result.board.title || title,
        ownerId: result.board.ownerId || collab.user.id,
        updatedAt: result.board.updatedAt || ''
    });
    updateActiveEditLock(result?.editLock || null);

    state.currentFileName = collab.activeBoardTitle;
    setCloudShadowData(result.board.data || payload);
    captureCloudSavedFingerprint();
    syncSharedMapSnapshot(payload);
    setBoardQueryParam(result.board.id);
    await activateCloudTransport();
    return true;
}

async function logoutCollab() {
    stopCollabRealtime();
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    await releaseActiveEditLock(collab.activeBoardId).catch(() => {});
    try {
        if (collab.token) await collabAuthRequest('logout');
    } catch (e) {}

    collab.token = '';
    collab.user = null;
    setActiveCloudBoardFromSummary(null);
    clearCollabStorage();
    setLocalPersistenceEnabled(true);
    setBoardQueryParam('');
    syncCloudStatus();
}

function getCloudModalElements() {
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const contentEl = document.getElementById('modal-content');
    const actionsEl = document.getElementById('modal-actions');
    const inputContainer = document.getElementById('modal-input-container');
    const colorContainer = document.getElementById('modal-color-picker');
    if (!overlay || !titleEl || !contentEl || !actionsEl || !inputContainer || !colorContainer) {
        return null;
    }
    return { overlay, titleEl, contentEl, actionsEl, inputContainer, colorContainer };
}

function openCloudModal(title, contentHtml, actionsHtml) {
    const modal = getCloudModalElements();
    if (!modal) return null;

    openModalOverlay();
    setModalOverlayDismissHandler(() => closeCloudModal());
    modal.titleEl.innerText = title;
    modal.inputContainer.style.display = 'none';
    modal.colorContainer.style.display = 'none';
    modal.contentEl.innerHTML = contentHtml;
    modal.actionsEl.innerHTML = actionsHtml;
    modal.actionsEl.classList.add('cloud-actions');
    return modal;
}

function closeCloudModal(options = {}) {
    const modal = getCloudModalElements();
    if (!modal) return;
    modal.actionsEl.classList.remove('cloud-actions');
    setModalOverlayDismissHandler(null);
    closeModalOverlay(options);
}

function bindCloudActionButton(button, handler) {
    return bindAsyncActionButton(button, handler, { usePointerDown: false });
}

function getCloudModalStatusLabel() {
    if (!collab.user) return 'Mode local';
    return isCloudBoardActive()
        ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} · ${escapeHtml(canEditCloudBoard() ? 'Edition active' : (getCloudReadOnlyMessage() || 'Lecture seule'))}`
        : 'Aucun board cloud actif';
}

function renderCloudHomeLoading(localPanel = 'cloud', note = 'Chargement du cloud...') {
    const safePanel = localPanel === 'local' ? 'local' : 'cloud';
    const title = collab.user ? escapeHtml(collab.user.username || 'Compte cloud') : 'Cloud';
    const syncLabel = getCloudModalStatusLabel();

    openCloudModal(
        'FICHIER',
        `
            <div class="cloud-shell">
                <div class="cloud-home-head">
                    <div class="cloud-home-heading">
                        <div class="cloud-home-kicker">Fichier</div>
                        <div class="cloud-home-title">${title}</div>
                    </div>
                    <div class="cloud-home-tab-group">
                        <button type="button" id="cloud-home-tab-cloud" class="cloud-home-tab ${safePanel === 'cloud' ? 'is-active' : ''}">Cloud</button>
                        <button type="button" id="cloud-home-tab-local" class="cloud-home-tab cloud-home-tab-alt ${safePanel === 'local' ? 'is-active' : ''}">Local</button>
                    </div>
                </div>
                <div class="cloud-column cloud-panel-shell">
                    <div class="cloud-loading-stack">
                        <div class="modal-tool">
                            <h3 class="modal-tool-title">${safePanel === 'cloud' ? 'Cloud' : 'Local'}</h3>
                            <div class="modal-note">${escapeHtml(note)}</div>
                        </div>
                        <div class="cloud-loading-card">
                            <div class="cloud-loading-bar cloud-loading-bar-lg"></div>
                            <div class="cloud-loading-bar"></div>
                            <div class="cloud-loading-bar cloud-loading-bar-sm"></div>
                        </div>
                        <div class="cloud-loading-card">
                            <div class="cloud-loading-bar cloud-loading-bar-lg"></div>
                            <div class="cloud-loading-bar"></div>
                            <div class="cloud-loading-bar cloud-loading-bar-sm"></div>
                        </div>
                    </div>
                </div>
                <div class="cloud-status-bar">
                    <span class="cloud-status-pill">${collab.user ? `Compte: ${escapeHtml(collab.user.username || '')}` : 'Mode local'}</span>
                    <span class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">${syncLabel}</span>
                </div>
            </div>
        `,
        collab.user && safePanel === 'cloud'
            ? `
                <button type="button" id="cloud-refresh-active" class="btn-modal-cancel">Rafraichir</button>
                <button type="button" id="cloud-stop-editing" class="btn-modal-cancel">Arreter de modifier</button>
                <button type="button" id="cloud-open-profile" class="btn-modal-cancel cloud-auth-secondary">Profil</button>
            `
            : ''
    );

    const refreshBtn = document.getElementById('cloud-refresh-active');
    if (refreshBtn) {
        bindCloudActionButton(refreshBtn, async () => {
            await refreshActiveCloudBoard({ quiet: true });
            await renderCloudHome();
        });
        if (!isCloudBoardActive()) {
            refreshBtn.disabled = true;
            refreshBtn.title = 'Aucun board actif';
        }
    }

    const stopEditingBtn = document.getElementById('cloud-stop-editing');
    if (stopEditingBtn) {
        bindCloudActionButton(stopEditingBtn, async () => {
            await stopEditingCurrentCloudBoard({ quiet: true });
            await renderCloudHome();
        });
        if (!isCloudBoardActive() || !canEditCloudBoard()) {
            stopEditingBtn.disabled = true;
            stopEditingBtn.title = isCloudBoardActive() ? (getCloudReadOnlyMessage() || 'Lecture seule sur ce board') : 'Aucun board actif';
        }
    }

    const profileBtn = document.getElementById('cloud-open-profile');
    if (profileBtn) {
        bindCloudActionButton(profileBtn, async () => {
            clearCloudProfileFlash();
            await renderCloudProfile();
        });
    }

    bindCloudHomeTabs();
}

function renderCloudMembersLoading() {
    openCloudModal(
        'GESTION DU BOARD',
        `
            <div class="cloud-manage-shell cloud-manage-loading">
                <div class="cloud-board-manage-head">
                    <div>
                        <h3 class="modal-tool-title">Gestion du board</h3>
                        <div class="modal-note">Chargement des acces et des membres...</div>
                    </div>
                </div>
                <div class="cloud-loading-stack">
                    <div class="cloud-loading-card">
                        <div class="cloud-loading-bar cloud-loading-bar-lg"></div>
                        <div class="cloud-loading-bar"></div>
                        <div class="cloud-loading-bar cloud-loading-bar-sm"></div>
                    </div>
                    <div class="cloud-loading-card">
                        <div class="cloud-loading-bar cloud-loading-bar-lg"></div>
                        <div class="cloud-loading-bar"></div>
                        <div class="cloud-loading-bar cloud-loading-bar-sm"></div>
                    </div>
                </div>
            </div>
        `,
        `
            <button type="button" id="cloud-members-back" class="btn-modal-cancel">Retour</button>
        `
    );

    const backBtn = document.getElementById('cloud-members-back');
    if (backBtn) {
        bindCloudActionButton(backBtn, async () => {
            renderCloudHomeLoading('cloud', 'Retour au tableau cloud...');
            await renderCloudHome();
        });
    }
}

function buildCloudLocalActionCard({ action, title, description = '', disabled = false, variantClass = '' }) {
    const classes = [variantClass, disabled ? 'is-disabled-visual' : '']
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');

    return `
        <button type="button" class="${classes}" data-local-action="${escapeHtml(action)}">
            <span class="data-hub-card-title">${escapeHtml(title)}</span>
            ${description ? `<span class="data-hub-card-meta">${escapeHtml(description)}</span>` : ''}
        </button>
    `;
}

function buildCloudLocalPanelMarkup(localSaveLocked) {
    if (isCloudBoardActive()) {
        return `
            <div class="cloud-board-row cloud-board-row-local is-active">
                <div class="cloud-row-main">
                    <div class="cloud-row-title">${escapeHtml(collab.activeBoardTitle || state.currentFileName || 'Board cloud actif')}</div>
                    <div class="cloud-row-sub">cloud · map</div>
                </div>
                <button type="button" class="cloud-local-badge cloud-local-disconnect-btn" data-local-action="disconnect-board">Se deconnecter</button>
            </div>
            <div class="cloud-local-panel">
                <div class="cloud-local-connected-note">Vous etes actuellement connecte au cloud. Coupe le board avant d ouvrir une session locale.</div>
                <div class="cloud-local-session-grid">
                    ${buildCloudLocalActionCard({
                        action: 'new-local-session',
                        title: 'Nouvelle session locale',
                        description: 'Deconnecte le cloud actif et remet la carte a zero',
                        variantClass: 'data-hub-card cloud-local-action-card'
                    })}
                    ${buildCloudLocalActionCard({
                        action: 'disconnect-open-file',
                        title: 'Ouvrir session locale',
                        description: 'Deconnecte le cloud puis ouvre un fichier JSON',
                        variantClass: 'data-hub-card cloud-local-action-card'
                    })}
                </div>
            </div>
        `;
    }

    return `
        <div class="cloud-board-row cloud-board-row-local is-active">
            <div class="cloud-row-main">
                <div class="cloud-row-title">${escapeHtml(state.currentFileName || 'Session locale')}</div>
                <div class="cloud-row-sub">local · map</div>
            </div>
            <div class="cloud-local-badge">Actions locales</div>
        </div>
        <div class="cloud-local-panel">
            ${localSaveLocked ? '<div class="cloud-local-note">Lecture seule: les exports locaux restent bloques tant que tu n as pas repris la main sur le board.</div>' : ''}
            <div class="cloud-local-action-grid">
                ${buildCloudLocalActionCard({
                    action: 'open-file',
                    title: 'Ouvrir',
                    description: 'Importer un fichier JSON',
                    variantClass: 'data-hub-card cloud-local-action-card data-hub-card-local'
                })}
                ${buildCloudLocalActionCard({
                    action: 'save-file',
                    title: 'Sauvegarder',
                    description: 'Exporter en fichier JSON',
                    disabled: localSaveLocked,
                    variantClass: 'data-hub-card cloud-local-action-card data-hub-card-local'
                })}
                ${buildCloudLocalActionCard({
                    action: 'save-text',
                    title: 'Copier JSON',
                    description: 'Copie brute dans le presse-papier',
                    disabled: localSaveLocked,
                    variantClass: 'data-hub-card cloud-local-action-card data-hub-card-local'
                })}
                ${buildCloudLocalActionCard({
                    action: 'merge-file',
                    title: 'Fusionner',
                    description: 'Fusionner un autre fichier JSON',
                    variantClass: 'data-hub-card cloud-local-action-card data-hub-card-local'
                })}
                ${buildCloudLocalActionCard({
                    action: 'reset-all',
                    title: 'Reset',
                    description: 'Vider la carte locale',
                    variantClass: 'data-hub-card cloud-local-action-card data-hub-card-danger'
                })}
            </div>
        </div>
    `;
}

function bindCloudHomeTabs() {
    const tabCloud = document.getElementById('cloud-home-tab-cloud');
    if (tabCloud) {
        bindCloudActionButton(tabCloud, async () => {
            collab.homePanel = 'cloud';
            if (collab.user) renderCloudHomeLoading('cloud', 'Chargement des boards map...');
            await renderCloudHome();
        });
    }

    const tabLocal = document.getElementById('cloud-home-tab-local');
    if (tabLocal) {
        bindCloudActionButton(tabLocal, async () => {
            collab.homePanel = 'local';
            await renderCloudHome();
        });
    }
}

async function runCloudAuth(action) {
    const userEl = document.getElementById('cloud-auth-user');
    const passEl = document.getElementById('cloud-auth-pass');
    const username = String(userEl?.value || '').trim();
    const password = String(passEl?.value || '');

    if (!username || !password) {
        await customAlert('AUTH', 'Renseigne l identifiant et le mot de passe.');
        return false;
    }

    try {
        const res = await collabAuthRequest(action, { username, password });
        collab.token = String(res.token || '');
        collab.user = res.user || null;
        persistCollabState();
        syncCloudStatus();

        if (collab.pendingBoardId) {
            const pendingId = collab.pendingBoardId;
            collab.pendingBoardId = '';
            try {
                await openCloudBoard(pendingId, { quiet: true });
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || "Impossible d'ouvrir le board."));
            }
        }

        await renderCloudHome();
        return true;
    } catch (e) {
        await customAlert('ERREUR AUTH', escapeHtml(e.message || 'Erreur inconnue.'));
        return false;
    }
}

function clearCloudProfileFlash() {
    collab.profileFlash = '';
}

async function runCloudProfileUpdate() {
    if (!collab.user) return false;

    const nextUsernameInput = document.getElementById('cloud-profile-username');
    const currentPassInput = document.getElementById('cloud-profile-current-pass');
    const nextPassInput = document.getElementById('cloud-profile-next-pass');
    const currentUsername = String(collab.user.username || '').trim();
    const nextUsernameRaw = String(nextUsernameInput?.value || '').trim();
    const currentPassword = String(currentPassInput?.value || '');
    const nextPassword = String(nextPassInput?.value || '');
    const nextUsername = nextUsernameRaw && nextUsernameRaw !== currentUsername ? nextUsernameRaw : '';

    if (!nextUsername && !nextPassword) {
        await customAlert('PROFIL', 'Ajoute un nouvel identifiant ou un nouveau mot de passe.');
        return false;
    }
    if (!currentPassword) {
        await customAlert('PROFIL', 'Entre ton mot de passe actuel.');
        return false;
    }

    clearCloudProfileFlash();
    try {
        const res = await collabAuthRequest('update_profile', {
            currentPassword,
            nextUsername,
            nextPassword,
        });
        collab.user = res.user || collab.user;
        collab.profileFlash = 'Profil mis a jour.';
        persistCollabState();
        syncCloudStatus();
        if (isCloudBoardActive()) {
            updateMapCloudPresence().catch(() => {});
        }
        await renderCloudProfile();
        return true;
    } catch (e) {
        await customAlert('ERREUR AUTH', escapeHtml(e.message || 'Erreur inconnue.'));
        return false;
    }
}

async function renderCloudProfile() {
    if (!collab.user) {
        await renderCloudHome();
        return;
    }

    openCloudModal(
        'PROFIL',
        `
            <div class="cloud-shell">
                <div class="cloud-home-head">
                    <div class="cloud-home-heading">
                        <div class="cloud-home-kicker">Compte cloud</div>
                        <div class="cloud-home-title">Profil</div>
                    </div>
                </div>
                <div class="cloud-column cloud-panel-shell">
                    <div class="modal-tool cloud-auth-shell cloud-profile-shell">
                        <div class="cloud-auth-badge">Profil</div>
                        <h3 class="cloud-auth-title">${escapeHtml(collab.user.username || 'Compte cloud')}</h3>
                        <div class="cloud-auth-copy">Change ton identifiant ou ton mot de passe. Laisse vide ce que tu veux garder.</div>
                        ${collab.profileFlash ? `<div class="cloud-profile-feedback is-success">${escapeHtml(collab.profileFlash)}</div>` : ''}
                        <div class="cloud-profile-current">
                            <span class="cloud-auth-label">Compte actuel</span>
                            <span class="cloud-profile-current-value">${escapeHtml(collab.user.username || '')}</span>
                        </div>
                        <div class="cloud-auth-grid cloud-profile-grid">
                            <label class="cloud-auth-field is-span-all">
                                <span class="cloud-auth-label">Nouvel identifiant</span>
                                <input id="cloud-profile-username" type="text" placeholder="${escapeHtml(collab.user.username || 'nouvel_identifiant')}" class="cloud-auth-input modal-input-standalone" autocomplete="username" />
                            </label>
                            <label class="cloud-auth-field">
                                <span class="cloud-auth-label">Mot de passe actuel</span>
                                <input id="cloud-profile-current-pass" type="password" placeholder="Mot de passe actuel" class="cloud-auth-input modal-input-standalone" autocomplete="current-password" />
                            </label>
                            <label class="cloud-auth-field">
                                <span class="cloud-auth-label">Nouveau mot de passe</span>
                                <input id="cloud-profile-next-pass" type="password" placeholder="Nouveau mot de passe" class="cloud-auth-input modal-input-standalone" autocomplete="new-password" />
                            </label>
                        </div>
                        <div class="cloud-auth-hint">Le meme compte fonctionne sur Point et Map.</div>
                    </div>
                </div>
                <div class="cloud-status-bar">
                    <span class="cloud-status-pill">Compte: ${escapeHtml(collab.user.username || '')}</span>
                    <span class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">${getCloudModalStatusLabel()}</span>
                </div>
            </div>
        `,
        `
            <button type="button" id="cloud-profile-back" class="btn-modal-cancel cloud-auth-secondary">Retour</button>
            <button type="button" id="cloud-profile-save" class="btn-modal-confirm cloud-auth-primary">Enregistrer</button>
        `
    );

    const backBtn = document.getElementById('cloud-profile-back');
    if (backBtn) {
        bindCloudActionButton(backBtn, async () => {
            clearCloudProfileFlash();
            await renderCloudHome();
        });
    }

    const saveBtn = document.getElementById('cloud-profile-save');
    if (saveBtn) {
        bindCloudActionButton(saveBtn, async () => {
            await runCloudProfileUpdate();
        });
    }

    Array.from(document.querySelectorAll('#cloud-profile-username, #cloud-profile-current-pass, #cloud-profile-next-pass')).forEach((field) => {
        field.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runCloudProfileUpdate().catch(() => {});
            }
        };
    });

    document.getElementById('cloud-profile-username')?.focus();
}

async function disconnectCurrentCloudBoard(options = {}) {
    const boardId = String(options.boardId || collab.activeBoardId || '').trim();
    if (!boardId) return false;

    const renderHome = Boolean(options.renderHome);
    const quiet = Boolean(options.quiet);
    const nextPanel = String(options.nextPanel || '').trim();
    const preservedTitle = String(collab.activeBoardTitle || state.currentFileName || 'Session locale').trim();

    await flushPendingCloudAutosave(boardId).catch(() => {});
    await releaseActiveEditLock(boardId).catch(() => {});
    stopCollabRealtime();
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();

    setActiveCloudBoardFromSummary(null);
    setBoardQueryParam('');
    if (nextPanel) collab.homePanel = nextPanel;
    if (preservedTitle) state.currentFileName = preservedTitle;
    saveLocalState();

    if (renderHome) await renderCloudHome();
    if (!quiet) await customAlert('CLOUD', 'Board cloud deconnecte.');
    return true;
}

function bindCloudLocalActions(localSaveLocked) {
    const runLockedLocalAction = async () => {
        await customAlert('ACCES', 'Export local bloque sur ce board cloud.');
    };

    Array.from(document.querySelectorAll('[data-local-action]')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const action = btn.getAttribute('data-local-action') || '';

            if ((action === 'save-file' || action === 'save-text') && localSaveLocked) {
                await runLockedLocalAction();
                return;
            }

            if (action === 'disconnect-board') {
                await disconnectCurrentCloudBoard({ renderHome: true, quiet: true, nextPanel: 'local' });
                return;
            }
            if (action === 'new-local-session') {
                await disconnectCurrentCloudBoard({ quiet: true, nextPanel: 'local' });
                closeCloudModal();
                window.setTimeout(() => {
                    document.getElementById('btnResetMap')?.click();
                }, 40);
                return;
            }
            if (action === 'disconnect-open-file') {
                await disconnectCurrentCloudBoard({ quiet: true, nextPanel: 'local' });
                closeCloudModal();
                triggerFileInput('fileImport');
                return;
            }
            if (action === 'open-file') {
                closeCloudModal();
                triggerFileInput('fileImport');
                return;
            }
            if (action === 'save-file') {
                await saveLocalMapSnapshot();
                return;
            }
            if (action === 'save-text') {
                await copyLocalMapSnapshot();
                return;
            }
            if (action === 'merge-file') {
                closeCloudModal();
                triggerFileInput('fileMerge');
                return;
            }
            if (action === 'reset-all') {
                closeCloudModal();
                window.setTimeout(() => {
                    document.getElementById('btnResetMap')?.click();
                }, 40);
            }
        });
    });
}

function bindCloudBoardListActions() {
    Array.from(document.querySelectorAll('.cloud-open-board')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;

            try {
                await openCloudBoard(boardId, { quiet: false });
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });

    Array.from(document.querySelectorAll('.cloud-manage-board')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;
            await renderCloudMembers(boardId);
        });
    });

    Array.from(document.querySelectorAll('.cloud-leave-board')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;

            const confirmed = await customConfirm('CLOUD', 'Quitter ce board partage ?');
            if (!confirmed) return;

            try {
                await collabBoardRequest('leave_board', { boardId });
                if (boardId === collab.activeBoardId) {
                    await disconnectCurrentCloudBoard({ boardId, quiet: true, nextPanel: 'cloud' });
                }
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });

    Array.from(document.querySelectorAll('.cloud-disconnect-board')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId || boardId !== collab.activeBoardId) return;
            await disconnectCurrentCloudBoard({ boardId, renderHome: true, quiet: true, nextPanel: 'cloud' });
        });
    });

    Array.from(document.querySelectorAll('.cloud-delete-board-inline')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;

            const confirmed = await customConfirm('CLOUD', 'Supprimer ce board cloud ?');
            if (!confirmed) return;

            try {
                await collabBoardRequest('delete_board', { boardId });
                if (String(boardId) === String(collab.activeBoardId)) {
                    await disconnectCurrentCloudBoard({ boardId, quiet: true, nextPanel: 'cloud' });
                }
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });
}

function triggerFileInput(inputId) {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return false;
    try {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return true;
        }
    } catch (e) {}
    try {
        input.click();
        return true;
    } catch (e) {
        return false;
    }
}

function bindCloudMemberAutocomplete(boardId, members = []) {
    const input = document.getElementById('cloud-share-username');
    const resultsEl = document.getElementById('cloud-share-username-results');
    const addBtn = document.getElementById('cloud-share-add');
    if (!(input instanceof HTMLInputElement) || !(resultsEl instanceof HTMLElement)) return;

    const memberUserIds = new Set(
        (Array.isArray(members) ? members : [])
            .map((member) => String(member?.userId || '').trim())
            .filter(Boolean)
    );

    attachAsyncAutocomplete({
        input,
        resultsEl,
        minChars: 1,
        fetchSuggestions: async (query) => {
            const result = await collabBoardRequest('search_users', {
                boardId,
                query,
                limit: 7
            });
            return (Array.isArray(result?.users) ? result.users : [])
                .filter((entry) => !memberUserIds.has(String(entry?.userId || '')));
        },
        renderSuggestion: (entry) => `
            <span class="editor-autocomplete-name">${escapeHtml(String(entry?.username || ''))}</span>
            <span class="editor-autocomplete-type">Utilisateur cloud</span>
        `,
        getSuggestionKey: (entry, index) => String(entry?.userId || entry?.username || index),
        onPick: (entry) => {
            input.value = String(entry?.username || '').trim();
        },
        onSubmit: () => {
            addBtn?.click();
        }
    });
}

async function saveLocalMapSnapshot() {
    if (isLocalSaveLocked()) {
        await customAlert('ACCES', 'Export local bloque sur ce board cloud.');
        return;
    }

    closeCloudModal();
    window.setTimeout(async () => {
        const exported = exportToJSON();
        if (!exported) {
            await customAlert('ACCES', 'Export local bloque sur ce board cloud.');
        }
    }, 40);
}

async function copyLocalMapSnapshot() {
    if (isLocalSaveLocked()) {
        await customAlert('ACCES', 'Export local bloque sur ce board cloud.');
        return;
    }

    try {
        await navigator.clipboard.writeText(JSON.stringify(getMapData(), null, 2));
        closeCloudModal();
        await customAlert('LOCAL', 'JSON copie.');
    } catch (e) {
        await customAlert('ERREUR', 'Impossible de copier le JSON.');
    }
}

async function renderCloudMembers(boardId) {
    renderCloudMembersLoading();
    await flushPendingCloudAutosave(boardId).catch(() => {});

    let result;
    try {
        result = await collabBoardRequest('get_board', { boardId });
    } catch (e) {
        await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
        return;
    }

    if (!result?.board) return;
    const board = result.board;
    const resolvedRole = String(result.role || board.role || collab.activeRole || '').trim();
    if (resolvedRole !== 'owner') {
        await customAlert('CLOUD', 'Seul le lead peut gerer les membres.');
        return;
    }

    const members = Array.isArray(board.members) ? board.members : [];
    const onlineUsers = new Set(Array.isArray(result.onlineUsers) ? result.onlineUsers.map((id) => String(id)) : []);
    const presenceByUser = new Map(
        (Array.isArray(result.presence) ? result.presence : []).map((entry) => [String(entry.userId || ''), entry])
    );
    const shareUrl = `${window.location.origin}${window.location.pathname}?board=${encodeURIComponent(board.id)}`;

    const membersHtml = members.map((member) => {
        const isOwner = member.role === 'owner';
        const presence = presenceByUser.get(String(member.userId || ''));
        const isOnline = onlineUsers.has(String(member.userId || ''));
        const statusLabel = presence
            ? (presence.activeNodeName ? `En ligne · ${presence.activeNodeName}` : 'En ligne sur ce board')
            : (isOnline ? 'En ligne sur le site' : 'Hors ligne');
        return `
            <div class="cloud-member-row">
                <div class="cloud-row-main">
                    <div class="cloud-row-title">${escapeHtml(member.username)}</div>
                    <div class="cloud-row-sub">${escapeHtml(member.role || 'editor')}</div>
                    <div class="cloud-member-status ${isOnline ? 'is-online' : 'is-offline'}">${escapeHtml(statusLabel)}</div>
                </div>
                <div class="cloud-row-actions">
                    ${isOwner ? '' : `<button type="button" class="mini-btn cloud-remove-member" data-user="${escapeHtml(member.userId)}">Retirer</button>`}
                    ${isOwner ? '' : `<button type="button" class="mini-btn cloud-transfer-member" data-user="${escapeHtml(member.userId)}">Donner lead</button>`}
                </div>
            </div>
        `;
    }).join('');

    openCloudModal(
        'GESTION DU BOARD',
        `
            <div class="cloud-manage-shell">
                <div class="cloud-board-manage-head">
                    <div>
                        <h3 class="modal-tool-title">Gestion du board</h3>
                        <div class="modal-note">Board: ${escapeHtml(board.title || 'Sans nom')}</div>
                    </div>
                    <div class="cloud-row-actions">
                        <button type="button" id="cloud-rename-board" class="mini-btn">Renommer</button>
                        <button type="button" id="cloud-delete-board" class="mini-btn">Supprimer</button>
                    </div>
                </div>
                <div class="cloud-inline-form">
                    <div class="editor-autocomplete-field cloud-inline-autocomplete-field">
                        <input id="cloud-share-username" type="text" placeholder="username" class="cloud-auth-input modal-input-standalone" autocomplete="off" spellcheck="false" />
                        <div id="cloud-share-username-results" class="editor-autocomplete-results" hidden></div>
                    </div>
                    <select id="cloud-share-role" class="cloud-auth-input compact-select cloud-inline-select">
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                    </select>
                    <button type="button" id="cloud-share-add" class="mini-btn">Ajouter</button>
                </div>
                <div class="cloud-share-line">
                    <span>Lien partage: <span id="cloud-share-link" class="cloud-share-link">${escapeHtml(shareUrl)}</span></span>
                    <button type="button" id="cloud-copy-link" class="mini-btn">Copier</button>
                </div>
                <div class="cloud-scroll">${membersHtml || '<div class="modal-empty-state">Aucun membre.</div>'}</div>
            </div>
        `,
        `
            <button type="button" id="cloud-members-back" class="btn-modal-cancel">Retour</button>
        `
    );

    const renameBtn = document.getElementById('cloud-rename-board');
    if (renameBtn) {
        bindCloudActionButton(renameBtn, async () => {
            const defaultTitle = String(board.title || 'Board cloud');
            const nextTitleRaw = await customPrompt('RENOMMER BOARD', 'Nouveau nom du board :', defaultTitle);
            if (nextTitleRaw === null) return;

            const nextTitle = String(nextTitleRaw || '').trim();
            if (!nextTitle || nextTitle === defaultTitle) return;

            try {
                await collabBoardRequest('rename_board', { boardId, title: nextTitle });
                if (String(collab.activeBoardId) === String(boardId)) {
                    collab.activeBoardTitle = nextTitle;
                    state.currentFileName = nextTitle;
                    persistCollabState();
                    syncCloudStatus();
                }
                await renderCloudMembers(boardId);
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    }

    const deleteBtn = document.getElementById('cloud-delete-board');
    if (deleteBtn) {
        bindCloudActionButton(deleteBtn, async () => {
            const confirmed = await customConfirm('CLOUD', 'Supprimer ce board cloud ?');
            if (!confirmed) return;

            try {
                await collabBoardRequest('delete_board', { boardId });
                if (String(boardId) === String(collab.activeBoardId)) {
                    await disconnectCurrentCloudBoard({ boardId, quiet: true, nextPanel: 'cloud' });
                }
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    }

    const shareAdd = document.getElementById('cloud-share-add');
    if (shareAdd) {
        bindCloudActionButton(shareAdd, async () => {
            const usernameEl = document.getElementById('cloud-share-username');
            const roleEl = document.getElementById('cloud-share-role');
            const username = String(usernameEl?.value || '').trim();
            const role = String(roleEl?.value || 'editor');

            if (!username) {
                await customAlert('CLOUD', 'Entre un username.');
                return;
            }

            try {
                await collabBoardRequest('share_board', { boardId, username, role });
                await renderCloudMembers(boardId);
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    }
    bindCloudMemberAutocomplete(boardId, members);

    Array.from(document.querySelectorAll('.cloud-remove-member')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const userId = btn.getAttribute('data-user') || '';
            if (!userId) return;

            const confirmed = await customConfirm('CLOUD', 'Retirer ce membre du board ?');
            if (!confirmed) return;

            try {
                await collabBoardRequest('remove_member', { boardId, userId });
                await renderCloudMembers(boardId);
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });

    Array.from(document.querySelectorAll('.cloud-transfer-member')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const userId = btn.getAttribute('data-user') || '';
            if (!userId) return;

            const confirmed = await customConfirm('CLOUD', 'Donner le lead a ce membre ?');
            if (!confirmed) return;

            try {
                await collabBoardRequest('transfer_board', { boardId, userId });
                await openCloudBoard(boardId, { quiet: true });
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });

    const copyLinkBtn = document.getElementById('cloud-copy-link');
    if (copyLinkBtn) {
        bindCloudActionButton(copyLinkBtn, async () => {
            try {
                await navigator.clipboard.writeText(shareUrl);
                await customAlert('CLOUD', 'Lien copie.');
            } catch (e) {
                await customAlert('ERREUR CLOUD', 'Impossible de copier le lien.');
            }
        });
    }

    const backBtn = document.getElementById('cloud-members-back');
    if (backBtn) {
        bindCloudActionButton(backBtn, async () => {
            renderCloudHomeLoading('cloud', 'Retour au tableau cloud...');
            await renderCloudHome();
        });
    }

}

async function renderCloudHome() {
    const renderToken = ++collab.homeRenderSeq;
    const localSaveLocked = isLocalSaveLocked();
    const localPanel = collab.homePanel === 'local' ? 'local' : 'cloud';
    const localRows = buildCloudLocalPanelMarkup(localSaveLocked);

    if (!collab.user) {
        const guestCloudPanel = `
            <div class="cloud-local-panel cloud-guest-panel">
                    <div class="modal-tool cloud-auth-shell cloud-auth-shell-inline cloud-auth-shell-guest">
                        <div class="cloud-auth-badge">Cloud</div>
                        <h3 class="cloud-auth-title">Compte cloud</h3>
                        <div class="cloud-auth-copy">Identifiant + mot de passe. Cree le compte ici si besoin.</div>
                        <div class="cloud-auth-grid">
                            <label class="cloud-auth-field">
                                <span class="cloud-auth-label">Identifiant</span>
                                <input id="cloud-auth-user" type="text" placeholder="operateur_nord" class="cloud-auth-input modal-input-standalone" autocomplete="username" />
                            </label>
                            <label class="cloud-auth-field">
                                <span class="cloud-auth-label">Mot de passe</span>
                                <input id="cloud-auth-pass" type="password" placeholder="Mot de passe" class="cloud-auth-input modal-input-standalone" autocomplete="current-password" />
                            </label>
                        </div>
                        <div class="cloud-auth-hint">Le meme compte fonctionne sur Point et Map.</div>
                    </div>
            </div>
        `;
        const panelBody = localPanel === 'local' ? localRows : guestCloudPanel;

        openCloudModal(
            'FICHIER',
            `
                <div class="cloud-shell">
                    <div class="cloud-home-head">
                        <div class="cloud-home-heading">
                            <div class="cloud-home-kicker">Fichier</div>
                            <div class="cloud-home-title">Cloud</div>
                        </div>
                        <div class="cloud-home-tab-group">
                            <button type="button" id="cloud-home-tab-cloud" class="cloud-home-tab ${localPanel === 'cloud' ? 'is-active' : ''}">Cloud</button>
                            <button type="button" id="cloud-home-tab-local" class="cloud-home-tab cloud-home-tab-alt ${localPanel === 'local' ? 'is-active' : ''}">Local</button>
                        </div>
                    </div>
                    <div class="cloud-column cloud-panel-shell">${panelBody}</div>
                    <div class="cloud-status-bar">
                        <span class="cloud-status-pill">Mode local</span>
                    </div>
                </div>
            `,
            localPanel === 'cloud'
                ? `
                    <button type="button" id="cloud-auth-register" class="btn-modal-cancel cloud-auth-secondary">Creer</button>
                    <button type="button" id="cloud-auth-login" class="btn-modal-confirm cloud-auth-primary">Connexion</button>
                `
                : ''
        );

        bindCloudHomeTabs();
        bindCloudLocalActions(localSaveLocked);

        const registerBtn = document.getElementById('cloud-auth-register');
        if (registerBtn) {
            bindCloudActionButton(registerBtn, async () => {
                await runCloudAuth('register');
            });
        }

        const loginBtn = document.getElementById('cloud-auth-login');
        if (loginBtn) {
            bindCloudActionButton(loginBtn, async () => {
                await runCloudAuth('login');
            });
        }

        Array.from(document.querySelectorAll('#cloud-auth-user, #cloud-auth-pass')).forEach((field) => {
            field.onkeydown = (event) => {
                if (event.key === 'Enter') {
                    runCloudAuth('login').catch(() => {});
                }
            };
        });
        return;
    }

    let boards = [];
    let cloudErrorMessage = '';
    if (localPanel === 'cloud') {
        renderCloudHomeLoading('cloud', 'Chargement des boards et des droits...');
        await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
        if (renderToken !== collab.homeRenderSeq || collab.homePanel === 'local') return;

        try {
            const res = await collabBoardRequest('list_boards', { page: 'map' });
            if (renderToken !== collab.homeRenderSeq || collab.homePanel === 'local') return;
            const allBoards = Array.isArray(res.boards) ? res.boards : [];
            boards = allBoards.filter((board) => String(board.page || 'point') === 'map');
        } catch (e) {
            if (renderToken !== collab.homeRenderSeq) return;
            cloudErrorMessage = escapeHtml(e.message || 'Erreur inconnue.');
        }
    }

    const boardRows = boards.map((board) => {
        const active = String(board.id || '') === String(collab.activeBoardId || '');
        const role = String(board.role || '');

        return `
            <div class="cloud-board-row ${active ? 'is-active' : ''}">
                <div class="cloud-row-main">
                    <div class="cloud-row-title-wrap">
                        <div class="cloud-row-title">${escapeHtml(board.title || 'Sans nom')}</div>
                        ${active ? `
                            <button type="button" class="cloud-connected-pill cloud-disconnect-board" data-board="${escapeHtml(board.id)}">
                                <span class="cloud-connected-pill-label">Connecte</span>
                                <span class="cloud-connected-pill-hover">Deconnexion</span>
                            </button>
                        ` : ''}
                    </div>
                    <div class="cloud-row-sub">${escapeHtml(role)} - MAP</div>
                </div>
                <div class="cloud-row-actions">
                    ${active ? '' : `<button type="button" class="mini-btn cloud-open-board" data-board="${escapeHtml(board.id)}">Ouvrir</button>`}
                    ${role === 'owner' ? `<button type="button" class="mini-btn cloud-manage-board" data-board="${escapeHtml(board.id)}">Gerer</button>` : ''}
                    ${role === 'owner' ? `<button type="button" class="mini-btn danger cloud-delete-board-inline" data-board="${escapeHtml(board.id)}">Supprimer</button>` : ''}
                    ${role !== 'owner' ? `<button type="button" class="mini-btn cloud-leave-board" data-board="${escapeHtml(board.id)}">Quitter</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    const cloudPanelBody = cloudErrorMessage
        ? `<div class="modal-empty-state">Impossible de charger les boards map.<br>${cloudErrorMessage}</div>`
        : (boardRows || '<div class="modal-empty-state">Aucun board map cloud.</div>');
    const panelBody = localPanel === 'local' ? localRows : cloudPanelBody;

    openCloudModal(
        'FICHIER',
        `
            <div class="cloud-shell">
                <div class="cloud-home-head">
                    <div class="cloud-home-heading">
                        <div class="cloud-home-kicker">Fichier</div>
                        <div class="cloud-home-title">${escapeHtml(collab.user.username || 'Session cloud')}</div>
                    </div>
                    <div class="cloud-home-tab-group">
                        <button type="button" id="cloud-home-tab-cloud" class="cloud-home-tab ${localPanel === 'cloud' ? 'is-active' : ''}">Cloud</button>
                        <button type="button" id="cloud-home-tab-local" class="cloud-home-tab cloud-home-tab-alt ${localPanel === 'local' ? 'is-active' : ''}">Local</button>
                    </div>
                </div>
                <div class="cloud-column cloud-panel-shell">${panelBody}</div>
                <div class="cloud-status-bar">
                    <span class="cloud-status-pill">Compte: ${escapeHtml(collab.user.username || '')}</span>
                    <span id="cloudModalSyncInfo" class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">
                        ${getCloudModalStatusLabel()}
                    </span>
                </div>
            </div>
        `,
        localPanel === 'cloud'
            ? `
                <button type="button" id="cloud-create-board" class="btn-modal-confirm">Nouveau</button>
                <button type="button" id="cloud-save-active" class="btn-modal-cancel">Sauvegarder</button>
                <button type="button" id="cloud-refresh-active" class="btn-modal-cancel">Rafraichir</button>
                <button type="button" id="cloud-stop-editing" class="btn-modal-cancel">Arreter de modifier</button>
                <button type="button" id="cloud-open-profile" class="btn-modal-cancel cloud-auth-secondary">Profil</button>
                <button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>
            `
            : `
                <button type="button" id="cloud-open-profile" class="btn-modal-cancel cloud-auth-secondary">Profil</button>
                <button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>
            `
    );

    const saveActiveBtn = document.getElementById('cloud-save-active');
    if (saveActiveBtn && (!isCloudBoardActive() || !canEditCloudBoard())) {
        saveActiveBtn.disabled = true;
        saveActiveBtn.style.opacity = '0.45';
        saveActiveBtn.title = isCloudBoardActive() ? (getCloudReadOnlyMessage() || 'Lecture seule sur ce board') : 'Aucun board actif';
    }

    const refreshBtn = document.getElementById('cloud-refresh-active');
    if (refreshBtn && !isCloudBoardActive()) {
        refreshBtn.disabled = true;
        refreshBtn.style.opacity = '0.45';
        refreshBtn.title = 'Aucun board actif';
    }

    const stopEditingBtn = document.getElementById('cloud-stop-editing');
    if (stopEditingBtn && (!isCloudBoardActive() || !canEditCloudBoard())) {
        stopEditingBtn.disabled = true;
        stopEditingBtn.style.opacity = '0.45';
        stopEditingBtn.title = isCloudBoardActive() ? (getCloudReadOnlyMessage() || 'Lecture seule sur ce board') : 'Aucun board actif';
    }

    const createBtn = document.getElementById('cloud-create-board');
    if (createBtn) {
        bindCloudActionButton(createBtn, async () => {
            try {
                const created = await createCloudBoardFromCurrent();
                if (created) {
                    await customAlert('CLOUD', `Board cree: ${escapeHtml(collab.activeBoardTitle || '')}`);
                }
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    }

    if (saveActiveBtn) {
        bindCloudActionButton(saveActiveBtn, async () => {
            await saveActiveCloudBoard({ manual: true, quiet: false });
            await renderCloudHome();
        });
    }

    if (refreshBtn) {
        bindCloudActionButton(refreshBtn, async () => {
            await refreshActiveCloudBoard({ quiet: true });
            await renderCloudHome();
        });
    }

    if (stopEditingBtn) {
        bindCloudActionButton(stopEditingBtn, async () => {
            await stopEditingCurrentCloudBoard({ quiet: true });
            await renderCloudHome();
        });
    }

    const profileBtn = document.getElementById('cloud-open-profile');
    if (profileBtn) {
        bindCloudActionButton(profileBtn, async () => {
            clearCloudProfileFlash();
            await renderCloudProfile();
        });
    }

    const logoutBtn = document.getElementById('cloud-logout');
    if (logoutBtn) {
        bindCloudActionButton(logoutBtn, async () => {
            await logoutCollab();
            await renderCloudHome();
        });
    }

    bindCloudHomeTabs();
    bindCloudLocalActions(localSaveLocked);
    bindCloudBoardListActions();
}

export function openCloudMenu(initialPanel = '') {
    const modal = getCloudModalElements();
    if (!modal) return;
    collab.homePanel = initialPanel || (collab.user ? 'cloud' : 'local');
    modal.overlay.classList.remove('hidden');
    if (collab.user && collab.homePanel === 'cloud') {
        renderCloudHomeLoading('cloud', 'Chargement des boards map...');
    }
    renderCloudHome().catch(() => {});
}

export function getCloudSaveModalOptions() {
    return {
        cloudActive: isCloudBoardActive(),
        cloudEditable: canEditCloudBoard(),
        localExportLocked: isLocalSaveLocked(),
        boardTitle: collab.activeBoardTitle || collab.activeBoardId || '',
        onSaveCloud: async () => saveActiveCloudBoard({ manual: true, quiet: false })
    };
}

export async function initCloudCollab() {
    hydrateCollabState();
    syncCloudStatus();
    mapDebugLogger.log('init-cloud-collab-start', getMapDiagState());

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const boardFromUrl = String(urlParams.get('board') || '').trim();
        if (boardFromUrl) collab.pendingBoardId = boardFromUrl;
        mapDebugLogger.log('init-cloud-collab-url', getMapDiagState({
            boardFromUrl: shortDiagId(boardFromUrl)
        }));
    } catch (e) {}

    if (!collab.token) {
        setActiveCloudBoardFromSummary(null);
        mapDebugLogger.log('init-cloud-collab-no-token', getMapDiagState());
        return;
    }

    try {
        const me = await collabAuthRequest('me');
        collab.user = me.user || collab.user;
        mapDebugLogger.log('init-cloud-collab-authenticated', getMapDiagState());
    } catch (e) {
        mapDebugLogger.error('init-cloud-collab-auth-failed', getMapDiagState({
            message: e?.message || 'Erreur auth'
        }));
        await logoutCollab();
        return;
    }

    const preferredBoard = collab.pendingBoardId || collab.activeBoardId;
    if (preferredBoard) {
        try {
            await openCloudBoard(preferredBoard, { quiet: true });
            mapDebugLogger.log('init-cloud-collab-opened-board', getMapDiagState({
                preferredBoard: shortDiagId(preferredBoard)
            }));
        } catch (e) {
            mapDebugLogger.error('init-cloud-collab-open-board-failed', getMapDiagState({
                preferredBoard: shortDiagId(preferredBoard),
                message: e?.message || 'Erreur ouverture board'
            }));
            setActiveCloudBoardFromSummary(null);
            setBoardQueryParam('');
        } finally {
            collab.pendingBoardId = '';
        }
    } else {
        applyLocalPersistencePolicy();
    }

    syncCloudStatus();
    persistCollabState();
    mapDebugLogger.log('init-cloud-collab-complete', getMapDiagState());
}
