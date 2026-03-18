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
import { createRealtimeBoardSession } from '../../shared/realtime/board-session.mjs';
import { canUseRealtimeTransport } from '../../shared/realtime/config.mjs';
import { canonicalizeMapPayload, diffMapOps, applyMapOps } from '../../shared/realtime/map-doc.mjs';
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
    canEditCloudBoard as canSharedEditCloudBoard,
    shouldUseRealtimeCloud as shouldSharedUseRealtimeCloud,
    isRealtimeCloudActive as isSharedRealtimeCloudActive
} from '../../shared/js/collab-state.mjs';
import { bindAsyncActionButton } from '../../shared/js/ui-async.mjs';

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
    realtimeSession: null,
    realtimeFallbackActive: false,
    realtimeTextBindings: new Map(),
    activeTextKey: '',
    activeTextLabel: '',
    suppressAutosave: 0
};

const COLLAB_AUTOSAVE_DEBOUNCE_MS = 700;
const COLLAB_AUTOSAVE_RETRY_MS = 250;
const COLLAB_WATCH_TIMEOUT_MS = 7000;
const COLLAB_WATCH_RETRY_MIN_MS = 500;
const COLLAB_WATCH_RETRY_MAX_MS = 4000;
const COLLAB_PRESENCE_HEARTBEAT_MS = 6500;
const COLLAB_PRESENCE_RETRY_MS = 3200;
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

let realtimeTextTools = null;
let realtimeTextToolsPromise = null;

function parseJsonSafe(value) {
    return parseStoredJsonSafe(value, null);
}

async function preloadRealtimeTextTools() {
    if (realtimeTextTools) return realtimeTextTools;
    if (!realtimeTextToolsPromise) {
        realtimeTextToolsPromise = import('../../shared/realtime/y-text-browser.mjs')
            .then(async (module) => {
                if (typeof module.preloadBrowserYTextTools === 'function') {
                    await module.preloadBrowserYTextTools();
                }
                realtimeTextTools = module;
                return module;
            })
            .catch(() => null);
    }
    return realtimeTextToolsPromise;
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

function shouldUseRealtimeCloud() {
    return shouldSharedUseRealtimeCloud(collab, canUseRealtimeTransport());
}

function isRealtimeCloudActive() {
    return isSharedRealtimeCloudActive(collab);
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
    if (!realtimeTextTools?.makeMapTextKey) return '';
    return realtimeTextTools.makeMapTextKey(entityType, entityId, fieldName);
}

function getMapFieldConfig(entityType, fieldName) {
    return MAP_REALTIME_TEXT_FIELDS[String(entityType || '').trim()]?.[String(fieldName || '').trim()] || null;
}

function clearMapRealtimeFieldPresence(options = {}) {
    const shouldNotify = Boolean(options.notify);
    const hadPresence = Boolean(collab.activeTextKey || collab.activeTextLabel);
    collab.activeTextKey = '';
    collab.activeTextLabel = '';
    if (shouldNotify) {
        updateMapCloudPresence().catch(() => {});
    } else if (hadPresence) {
        syncMapRealtimeAwarenessDecorations();
    }
}

function setMapRealtimeFieldPresence(textKey, textLabel) {
    const nextKey = String(textKey || '').trim();
    const nextLabel = String(textLabel || '').trim();
    if (collab.activeTextKey === nextKey && collab.activeTextLabel === nextLabel) return;
    collab.activeTextKey = nextKey;
    collab.activeTextLabel = nextLabel;
    updateMapCloudPresence().catch(() => {});
}

function updateMapPresence(entries = []) {
    const deduped = new Map();
    (Array.isArray(entries) ? entries : []).forEach((row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return;
        deduped.set(userId, {
            userId,
            username: String(row?.username || 'operateur'),
            role: String(row?.role || ''),
            activeNodeId: String(row?.activeNodeId || ''),
            activeNodeName: String(row?.activeNodeName || ''),
            activeTextKey: String(row?.activeTextKey || ''),
            activeTextLabel: String(row?.activeTextLabel || ''),
            mode: String(row?.mode || 'editing'),
            isSelf: userId === String(collab.user?.id || '')
        });
    });
    collab.presence = [...deduped.values()].sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        return String(a.username || '').localeCompare(String(b.username || ''));
    });
    syncMapRealtimeAwarenessDecorations();
}

function buildMapPresencePayload(extra = {}) {
    const selected = getMapSelectedEntity();
    return {
        activeNodeId: String(extra.activeNodeId || extra.activePointId || selected?.entity?.id || ''),
        activeNodeName: String(extra.activeNodeName || extra.activeLabel || selected?.label || ''),
        activeTextKey: String(extra.activeTextKey || collab.activeTextKey || ''),
        activeTextLabel: String(extra.activeTextLabel || collab.activeTextLabel || ''),
        mode: String(extra.mode || (canEditCloudBoard() ? 'editing' : 'viewing'))
    };
}

function getMapAwarenessMessage(textKey) {
    if (!textKey) return '';
    const editors = collab.presence.filter((entry) =>
        !entry.isSelf &&
        String(entry.activeTextKey || '') === String(textKey || '')
    );
    if (!editors.length) return '';
    const names = editors.slice(0, 2).map((entry) => entry.username).filter(Boolean);
    if (!names.length) return 'Edition distante en cours';
    if (names.length === 1) return `${names[0]} edite ce champ`;
    return `${names.join(', ')} editent ce champ`;
}

export function syncMapRealtimeAwarenessDecorations() {
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
        const stateKey = role === 'owner' ? 'cloud-lead' : 'cloud-member';
        const label = role === 'owner' ? 'Cloud lead' : 'Cloud membre';
        const meta = collab.activeBoardTitle || collab.activeBoardId || 'Board actif';
        setStatus(label, stateKey, meta);
        return;
    }

    setStatus('Session cloud', 'session', collab.user.username || 'Connecte');
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

function stripMapRealtimeTextFields(payload) {
    const normalized = canonicalizeMapPayload(payload);
    return {
        ...normalized,
        groups: normalized.groups.map((group) => ({
            ...group,
            points: (Array.isArray(group.points) ? group.points : []).map((point) => ({
                ...point,
                name: '',
                type: '',
                notes: ''
            })),
            zones: (Array.isArray(group.zones) ? group.zones : []).map((zone) => ({
                ...zone,
                name: ''
            }))
        }))
    };
}

function diffMapOpsWithoutRealtimeText(previousPayload, nextPayload) {
    return diffMapOps(
        stripMapRealtimeTextFields(previousPayload),
        stripMapRealtimeTextFields(nextPayload)
    );
}

function computeCloudFingerprint() {
    try {
        if (!isCloudBoardActive()) return '';
        const normalized = normalizeSharedMapBoardPayload(getCloudMapPayload());
        const fingerprintPayload = isRealtimeCloudActive()
            ? stripMapRealtimeTextFields(normalized)
            : normalized;
        return JSON.stringify(fingerprintPayload);
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
    stopMapRealtimeText();
    if (!collab.realtimeSession) return;
    try {
        collab.realtimeSession.stop('switch-sync-mode');
    } catch (e) {}
    collab.realtimeSession = null;
    collab.realtimeFallbackActive = false;
}

function stopMapRealtimeText() {
    if (!(collab.realtimeTextBindings instanceof Map) || !collab.realtimeTextBindings.size) {
        clearMapRealtimeFieldPresence({ notify: false });
        return;
    }
    [...collab.realtimeTextBindings.values()].forEach((binding) => {
        try {
            binding.stop();
        } catch (e) {}
    });
    collab.realtimeTextBindings.clear();
    clearMapRealtimeFieldPresence({ notify: false });
}

function setMapRealtimeFieldValue(entityType, entityId, fieldName, nextValue, options = {}) {
    const cleanType = String(entityType || '').trim();
    const cleanField = String(fieldName || '').trim();
    const target = cleanType === 'point'
        ? findMapPointById(entityId)
        : findMapZoneById(entityId);
    if (!target) return false;
    const textValue = String(nextValue || '');
    if (String(target[cleanField] || '') === textValue) return false;
    target[cleanField] = textValue;

    if (cleanType === 'point' && (cleanField === 'name' || cleanField === 'type')) {
        renderGroupsList();
        renderAll();
    } else if (cleanType === 'zone' && cleanField === 'name') {
        renderGroupsList();
        renderAll();
    }

    if (options.local) {
        withoutCloudAutosave(() => saveLocalState());
    }
    syncMapRealtimeAwarenessDecorations();
    return true;
}

function ensureMapRealtimeTextBinding(entityType, entityId, fieldName) {
    const config = getMapFieldConfig(entityType, fieldName);
    const textKey = getMapRealtimeTextKey(entityType, entityId, fieldName);
    if (!config || !textKey || !isRealtimeCloudActive()) return null;
    if (collab.realtimeTextBindings.has(textKey)) {
        return collab.realtimeTextBindings.get(textKey);
    }

    const target = entityType === 'point'
        ? findMapPointById(entityId)
        : findMapZoneById(entityId);
    const binding = realtimeTextTools.createTextFieldYBinding({
        key: textKey,
        initialValue: String(target?.[fieldName] || ''),
        canEdit: () => isRealtimeCloudActive() && canEditCloudBoard(),
        onSendUpdate: (key, update) => {
            if (!collab.realtimeSession) return false;
            return collab.realtimeSession.roomClient.sendTextUpdate(key, update);
        },
        onValueChange: (nextValue, meta = {}) => {
            setMapRealtimeFieldValue(entityType, entityId, fieldName, nextValue, {
                local: meta.origin !== 'remote'
            });
        },
        onFocusChange: (meta = {}) => {
            if (meta.active) {
                setMapRealtimeFieldPresence(textKey, config.label);
                return;
            }
            if (collab.activeTextKey === textKey) {
                clearMapRealtimeFieldPresence({ notify: true });
            }
        }
    });

    collab.realtimeTextBindings.set(textKey, binding);
    collab.realtimeSession.roomClient.subscribeText(textKey);
    return binding;
}

function handleMapRealtimeTextUpdate(payload = {}) {
    const textKey = String(payload.key || '').trim();
    if (!textKey) return;
    const binding = collab.realtimeTextBindings.get(textKey);
    if (!binding) return;
    binding.applyRemoteUpdate(payload.update || '', {
        full: Boolean(payload.full)
    });
    syncMapRealtimeAwarenessDecorations();
}

export function bindMapRealtimeTextField(entityType, entity, fieldName, field) {
    const entityId = String(entity?.id || '').trim();
    if (!entityId || !field || !isRealtimeCloudActive()) return false;
    const binding = ensureMapRealtimeTextBinding(entityType, entityId, fieldName);
    if (!binding) return false;
    binding.attachField(field);
    syncMapRealtimeAwarenessDecorations();
    return true;
}

export function unbindMapRealtimeTextFields() {
    stopMapRealtimeText();
}

export async function updateMapCloudPresence(extra = {}) {
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    const payload = buildMapPresencePayload(extra);

    if (isRealtimeCloudActive()) {
        return collab.realtimeSession.updatePresence(payload);
    }

    try {
        const response = await collabBoardRequest('touch_presence', {
            boardId: collab.activeBoardId,
            ...payload
        });
        updateMapPresence(response?.presence || []);
        return true;
    } catch (e) {
        return false;
    }
}

function startLegacyCloudTransport() {
    stopCollabRealtime();
    collab.realtimeFallbackActive = true;
    startCollabAutosave();
    startCollabLiveSync();
    startCollabPresence();
}

async function activateCloudTransport() {
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        stopCollabRealtime();
        return false;
    }

    if (!shouldUseRealtimeCloud()) {
        startLegacyCloudTransport();
        return false;
    }

    try {
        const started = await startCollabRealtime();
        if (started) return true;
    } catch (e) {}

    startLegacyCloudTransport();
    return false;
}

async function startCollabRealtime() {
    if (!shouldUseRealtimeCloud()) return false;
    stopCollabRealtime();
    stopCollabPresence();
    await preloadRealtimeTextTools().catch(() => null);

    const session = await createRealtimeBoardSession({
        page: 'map',
        boardId: collab.activeBoardId,
        collabToken: collab.token,
        getCurrentSnapshot: () => normalizeMapBoardData(getCloudMapPayload()),
        canonicalizeSnapshot: canonicalizeMapPayload,
        diffOps: diffMapOpsWithoutRealtimeText,
        applyOps: applyMapOps,
        applySnapshot: (snapshot) => {
            applyCloudMapData(snapshot);
            setCloudShadowData(snapshot);
            captureCloudSavedFingerprint();
        },
        onPresence: (presence) => updateMapPresence(presence || []),
        onStatus: () => {},
        onError: () => {},
        onTextUpdate: (payload) => {
            handleMapRealtimeTextUpdate(payload || {});
        },
        onClose: (meta = {}) => {
            if (collab.realtimeSession === session) {
                collab.realtimeSession = null;
            }
            stopMapRealtimeText();
            if (!meta.intentional && isCloudBoardActive()) {
                collab.realtimeFallbackActive = true;
                startCollabAutosave();
                startCollabLiveSync();
                startCollabPresence();
            }
            if (state.selectedPoint || state.selectedZone) {
                import('./ui-editor.js').then((module) => {
                    module.renderEditor?.();
                }).catch(() => {});
            }
        },
        onLocalAccepted: ({ snapshot }) => {
            setCloudShadowData(snapshot);
            collab.lastSavedFingerprint = JSON.stringify(canonicalizeMapPayload(snapshot));
            syncSharedMapSnapshot(snapshot);
        },
        localFlushMs: 90,
        buildPresence: () => {
            return buildMapPresencePayload();
        }
    });

    collab.realtimeSession = session;
    collab.realtimeFallbackActive = false;
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    session.updatePresence();
    syncMapRealtimeAwarenessDecorations();
    return true;
}

function stopCollabAutosave() {
    stopNamedTimer(collab, 'autosaveDebounceTimer');
}

async function flushPendingCloudAutosave(boardId = collab.activeBoardId) {
    const targetBoardId = String(boardId || '').trim();
    if (!targetBoardId) return false;
    if (String(collab.activeBoardId || '') !== targetBoardId) return false;
    if (!canEditCloudBoard()) return false;
    if (isRealtimeCloudActive()) {
        return collab.realtimeSession.flushLocalChanges();
    }

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
    if (isRealtimeCloudActive()) {
        collab.realtimeSession.scheduleLocalFlush(delayMs);
        return;
    }
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
    if (isRealtimeCloudActive()) return;
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
    const payload = buildMapPresencePayload(options.extra || {});

    if (isRealtimeCloudActive()) {
        return collab.realtimeSession.updatePresence(payload);
    }
    if (collab.presenceInFlight && !options.force) return false;

    collab.presenceInFlight = true;
    try {
        const response = await collabBoardRequest('touch_presence', {
            boardId: collab.activeBoardId,
            ...payload
        });
        updateMapPresence(response?.presence || []);
        scheduleNextPresenceTick(loopToken, COLLAB_PRESENCE_HEARTBEAT_MS);
        return true;
    } catch (e) {
        scheduleNextPresenceTick(loopToken, COLLAB_PRESENCE_RETRY_MS);
        return false;
    } finally {
        collab.presenceInFlight = false;
    }
}

function startCollabPresence() {
    stopCollabPresence();
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        updateMapPresence([]);
        return;
    }
    if (isRealtimeCloudActive()) {
        touchCollabPresence(collab.presenceLoopToken, { force: true }).catch(() => {});
        return;
    }
    const loopToken = collab.presenceLoopToken + 1;
    collab.presenceLoopToken = loopToken;
    scheduleNextPresenceTick(loopToken, 0);
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
        if (!quiet) await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur sync live.'));
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
    return sharedCollabAuthRequest(action, payload);
}

async function collabBoardRequest(action, payload = {}) {
    return sharedCollabBoardRequest(action, payload);
}

function setActiveCloudBoardFromSummary(summary = null) {
    const previousBoardId = String(collab.activeBoardId || '');
    const nextBoardId = summary && summary.id ? String(summary.id || '') : '';
    const boardChanged = previousBoardId !== nextBoardId;
    if (boardChanged || !nextBoardId) {
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
        collab.lastSavedFingerprint = '';
        collab.shadowData = null;
        collab.presence = [];
        clearMapRealtimeFieldPresence({ notify: false });
        syncSharedMapSnapshot(null);
    } else {
        collab.activeBoardId = String(summary.id || '');
        collab.activeRole = String(summary.role || '');
        collab.activeBoardTitle = String(summary.title || '');
        collab.ownerId = String(summary.ownerId || '');
        collab.activeBoardUpdatedAt = String(summary.updatedAt || '');
    }

    if (previousBoardId && previousBoardId !== collab.activeBoardId) {
        clearCollabPresence(previousBoardId).catch(() => {});
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
        state.tacticalLinks = normalized.tacticalLinks;
        setGroups(normalized.groups);
        state.tacticalLinks = normalized.tacticalLinks;
        renderGroupsList();
        renderAll();
        saveLocalState();
        syncSharedMapSnapshot(normalized);
        syncMapRealtimeAwarenessDecorations();
        return normalized;
    });
}

async function openCloudBoard(boardId, options = {}) {
    const targetId = String(boardId || '').trim();
    if (!targetId) throw new Error('Board cloud invalide.');

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

    setActiveCloudBoardFromSummary(summary);
    applyCloudMapData(result.board.data);
    updateMapPresence(result.presence || []);
    setCloudShadowData(result.board.data);
    state.currentFileName = summary.title;
    captureCloudSavedFingerprint();
    setBoardQueryParam(summary.id);
    await activateCloudTransport();

    if (!options.quiet) {
        await customAlert('CLOUD', `☁️ Board ouvert : ${escapeHtml(summary.title)}`);
    }
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
        if (manual && !quiet) await customAlert('CLOUD', "Tu n'as pas les droits d'edition cloud.");
        return false;
    }
    if (isRealtimeCloudActive()) {
        const hadChanges = hasLocalCloudChanges();
        if (!hadChanges) {
            if (manual && !quiet) await customAlert('CLOUD', '☁️ Temps reel deja synchronise.');
            return true;
        }

        const flushed = await collab.realtimeSession.flushLocalChanges();
        if (flushed || !hasLocalCloudChanges()) {
            if (manual && !quiet) await customAlert('CLOUD', '☁️ Synchro temps reel envoyee.');
            return true;
        }

        if (manual && !quiet) {
            await customAlert('CLOUD', 'Connexion temps reel en cours. Les modifs restent locales pour le moment.');
        }
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
    try {
        await clearCollabPresence(collab.activeBoardId);
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
    if (!collab.user) return 'Connexion requise';
    return isCloudBoardActive()
        ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} (${escapeHtml(collab.activeRole || '')})`
        : 'Aucun board cloud actif';
}

function renderCloudHomeLoading(localPanel = 'cloud', note = 'Chargement du cloud...') {
    const safePanel = localPanel === 'local' ? 'local' : 'cloud';
    const title = collab.user ? escapeHtml(collab.user.username || 'Session cloud') : 'Session invite';
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
                    <span class="cloud-status-pill">${collab.user ? `Connecte: ${escapeHtml(collab.user.username || '')}` : 'Invite'}</span>
                    <span class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">${syncLabel}</span>
                </div>
            </div>
        `,
        ''
    );

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
            ${localSaveLocked ? '<div class="cloud-local-note">Mode partage: les exports locaux sont bloques pour les membres non lead.</div>' : ''}
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

async function disconnectCurrentCloudBoard(options = {}) {
    const boardId = String(options.boardId || collab.activeBoardId || '').trim();
    if (!boardId) return false;

    const renderHome = Boolean(options.renderHome);
    const quiet = Boolean(options.quiet);
    const nextPanel = String(options.nextPanel || '').trim();
    const preservedTitle = String(collab.activeBoardTitle || state.currentFileName || 'Session locale').trim();

    await flushPendingCloudAutosave(boardId).catch(() => {});
    stopCollabRealtime();
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    await clearCollabPresence(boardId).catch(() => {});

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
                    <input id="cloud-share-username" type="text" placeholder="username" class="cloud-auth-input modal-input-standalone" />
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
    {
    const renderToken = ++collab.homeRenderSeq;
    const localSaveLocked = isLocalSaveLocked();
    const localPanel = collab.homePanel === 'local' ? 'local' : 'cloud';
    const localRows = buildCloudLocalPanelMarkup(localSaveLocked);

    if (!collab.user) {
        const guestCloudPanel = `
            <div class="cloud-local-panel cloud-guest-panel">
                <div class="cloud-guest-layout">
                    <section class="cloud-guest-hero">
                        <div class="cloud-guest-kicker">Mode invite</div>
                        <div class="cloud-guest-title">Cloud verrouille</div>
                        <div class="cloud-guest-copy">Tu gardes toutes les actions locales. Pour creer, ouvrir ou sauvegarder dans le cloud, reconnecte-toi avec ton mot de passe.</div>
                        <div class="cloud-guest-pills">
                            <span class="cloud-guest-pill">Local dispo</span>
                            <span class="cloud-guest-pill">Map</span>
                            <span class="cloud-guest-pill">Connexion requise</span>
                        </div>
                    </section>
                    <div class="modal-tool cloud-auth-shell cloud-auth-shell-inline cloud-auth-shell-guest">
                        <div class="cloud-auth-badge">Cloud</div>
                        <h3 class="cloud-auth-title">Connexion au cloud</h3>
                        <div class="cloud-auth-copy">Entre simplement un identifiant et un mot de passe. Si le compte n existe pas encore, tu peux le creer ici.</div>
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
                        <div class="cloud-auth-hint">Le meme compte fonctionne aussi sur la carte. Sans connexion, tu restes en local.</div>
                    </div>
                </div>
            </div>
        `;
        const panelBody = localPanel === 'local' ? localRows : guestCloudPanel;
        const panelShellClass = localPanel === 'cloud'
            ? 'cloud-column cloud-panel-shell cloud-panel-shell-guest'
            : 'cloud-column cloud-panel-shell';

        openCloudModal(
            'FICHIER',
            `
                <div class="cloud-shell">
                    <div class="cloud-home-head">
                        <div class="cloud-home-heading">
                            <div class="cloud-home-kicker">Fichier</div>
                            <div class="cloud-home-title">Session invite</div>
                        </div>
                        <div class="cloud-home-tab-group">
                            <button type="button" id="cloud-home-tab-cloud" class="cloud-home-tab ${localPanel === 'cloud' ? 'is-active' : ''}">Cloud</button>
                            <button type="button" id="cloud-home-tab-local" class="cloud-home-tab cloud-home-tab-alt ${localPanel === 'local' ? 'is-active' : ''}">Local</button>
                        </div>
                    </div>
                    <div class="${panelShellClass}">${panelBody}</div>
                    <div class="cloud-status-bar">
                        <span class="cloud-status-pill">Invite</span>
                        <span id="cloudModalSyncInfo" class="cloud-status-pill">Connexion requise</span>
                    </div>
                </div>
            `,
            localPanel === 'cloud'
                ? `
                    <button type="button" id="cloud-auth-register" class="btn-modal-cancel cloud-auth-secondary">Creer un compte</button>
                    <button type="button" id="cloud-auth-login" class="btn-modal-confirm cloud-auth-primary">Se connecter</button>
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

        const passInput = document.getElementById('cloud-auth-pass');
        if (passInput) {
            passInput.onkeydown = (event) => {
                if (event.key === 'Enter') {
                    runCloudAuth('login').catch(() => {});
                }
            };
        }
        return;
    }

    let boards = [];
    let cloudErrorMessage = '';
    if (localPanel === 'cloud') {
        renderCloudHomeLoading('cloud', 'Chargement des boards et des droits...');
        await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
        if (renderToken !== collab.homeRenderSeq || collab.homePanel === 'local') return;

        try {
            const res = await collabBoardRequest('list_boards', {});
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
                    <span class="cloud-status-pill">Connecte: ${escapeHtml(collab.user.username || '')}</span>
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
                <button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>
            `
            : `<button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>`
    );

    const saveActiveBtn = document.getElementById('cloud-save-active');
    if (saveActiveBtn && (!isCloudBoardActive() || !canEditCloudBoard())) {
        saveActiveBtn.disabled = true;
        saveActiveBtn.style.opacity = '0.45';
        saveActiveBtn.title = isCloudBoardActive() ? 'Droits insuffisants' : 'Aucun board actif';
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
    return;
    }
    /*

    const localPanel = collab.homePanel === 'local' ? 'local' : 'cloud';

    if (!collab.user) {
        openCloudModal(
            'CLOUD COLLABORATIF',
            `
                <div class="cloud-auth-shell">
                    <div class="cloud-auth-badge">Cloud</div>
                    <h3 class="cloud-auth-title">Connexion au cloud</h3>
                    <div class="cloud-auth-copy">Entre simplement un identifiant et un mot de passe. Si le compte n existe pas encore, tu peux le creer ici.</div>
                    <div class="cloud-auth-grid">
                        <label class="cloud-auth-field">
                            <span class="cloud-auth-label">Identifiant</span>
                            <input id="cloud-auth-user" type="text" placeholder="operateur_nord" class="cloud-auth-input" autocomplete="username" />
                        </label>
                        <label class="cloud-auth-field">
                            <span class="cloud-auth-label">Mot de passe</span>
                            <input id="cloud-auth-pass" type="password" placeholder="Mot de passe" class="cloud-auth-input" autocomplete="current-password" />
                        </label>
                    </div>
                    <div class="cloud-auth-hint">Le meme compte fonctionne aussi sur l interface reseau. Sans connexion, la carte reste en local.</div>
                </div>
            `,
            `
                <button type="button" id="cloud-auth-register" class="btn-modal-cancel cloud-auth-secondary">Creer un compte</button>
                <button type="button" id="cloud-auth-login" class="btn-modal-confirm cloud-auth-primary">Se connecter</button>
            `
        );

        const runAuth = async (action) => {
            const userEl = document.getElementById('cloud-auth-user');
            const passEl = document.getElementById('cloud-auth-pass');
            const username = String(userEl?.value || '').trim();
            const password = String(passEl?.value || '');

            if (!username || !password) {
                await customAlert('AUTH', 'Renseigne l identifiant et le mot de passe.');
                return;
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
            } catch (e) {
                await customAlert('ERREUR AUTH', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        };

        const registerBtn = document.getElementById('cloud-auth-register');
        if (registerBtn) {
            bindCloudActionButton(registerBtn, async () => {
                await runAuth('register');
            });
        }

        const loginBtn = document.getElementById('cloud-auth-login');
        if (loginBtn) {
            bindCloudActionButton(loginBtn, async () => {
                await runAuth('login');
            });
        }

        const passBtn = document.getElementById('cloud-auth-pass');
        if (passBtn) {
            passBtn.onkeydown = (event) => {
                if (event.key === 'Enter') {
                    runAuth('login').catch(() => {});
                }
            };
        }
        return;
    }

    let boards = [];
    if (localPanel === 'cloud') {
        renderCloudHomeLoading('cloud', 'Chargement des boards map...');
        await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
        try {
            const res = await collabBoardRequest('list_boards', {});
            const allBoards = Array.isArray(res.boards) ? res.boards : [];
            boards = allBoards.filter((board) => String(board.page || 'point') === 'map');
        } catch (e) {
            await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            return;
        }
    }

    const localSaveLocked = isLocalSaveLocked();
    const boardRows = boards.map((board) => {
        const active = board.id === collab.activeBoardId;
        const role = String(board.role || '');

        return `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin:6px 0; padding:10px; border:1px solid ${active ? 'rgba(115,251,247,0.45)' : 'rgba(255,255,255,0.08)'}; border-radius:10px; background:${active ? 'rgba(115,251,247,0.08)' : 'rgba(0,0,0,0.2)'};">
                <div style="min-width:0; display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:0.95rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(board.title || 'Sans nom')}</div>
                    <div style="font-size:0.72rem; color:#8b9bb4; text-transform:uppercase;">${escapeHtml(role)} · MAP</div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; flex-shrink:0;">
                    <button type="button" class="mini-btn cloud-open-board" data-board="${escapeHtml(board.id)}">Ouvrir</button>
                    ${role === 'owner' ? `<button type="button" class="mini-btn cloud-manage-board" data-board="${escapeHtml(board.id)}">Gerer</button>` : ''}
                    ${role !== 'owner' ? `<button type="button" class="mini-btn cloud-leave-board" data-board="${escapeHtml(board.id)}">Quitter</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    const localRows = `
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin:6px 0 10px; padding:10px; border:1px solid rgba(115,251,247,0.34); border-radius:10px; background:rgba(115,251,247,0.08);">
            <div style="min-width:0; display:flex; flex-direction:column; gap:4px;">
                <div style="font-size:0.95rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(state.currentFileName || 'Session locale')}</div>
                <div style="font-size:0.72rem; color:#8b9bb4; text-transform:uppercase;">local · map</div>
            </div>
            <div style="align-self:center; padding:6px 10px; border:1px solid rgba(115,251,247,0.18); border-radius:999px; background:rgba(115,251,247,0.08); color:var(--accent-cyan); font-size:0.7rem; letter-spacing:1.2px; text-transform:uppercase; white-space:nowrap;">Actions locales</div>
        </div>
        ${localSaveLocked ? '<div style="margin:0 0 8px; padding:10px 12px; border-radius:10px; border:1px dashed rgba(255, 204, 138, 0.18); background:rgba(3, 10, 24, 0.6); color:#ffd8a4; font-size:0.74rem; line-height:1.45;">Mode partage: les exports locaux sont bloques pour les membres non lead.</div>' : ''}
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
            <button type="button" class="data-hub-card data-hub-card-local" data-local-action="open-file">
                <span class="data-hub-card-title">Ouvrir</span>
                <span class="data-hub-card-meta">JSON</span>
            </button>
            <button type="button" class="data-hub-card data-hub-card-local ${localSaveLocked ? 'is-disabled-visual' : ''}" data-local-action="save-file">
                <span class="data-hub-card-title">Sauvegarder</span>
                <span class="data-hub-card-meta">JSON</span>
            </button>
            <button type="button" class="data-hub-card data-hub-card-local ${localSaveLocked ? 'is-disabled-visual' : ''}" data-local-action="save-text">
                <span class="data-hub-card-title">Copier JSON</span>
                <span class="data-hub-card-meta">Texte</span>
            </button>
            <button type="button" class="data-hub-card data-hub-card-local" data-local-action="merge-file">
                <span class="data-hub-card-title">Fusionner</span>
                <span class="data-hub-card-meta">Fichier</span>
            </button>
            <button type="button" class="data-hub-card data-hub-card-danger" data-local-action="reset-all">
                <span class="data-hub-card-title">Reset</span>
            </button>
        </div>
    `;
    const panelBody = localPanel === 'local'
        ? localRows
        : (boardRows || '<div style="padding:18px 0; color:#8b9bb4;">Aucun board map cloud.</div>');

    openCloudModal(
        'CLOUD COLLABORATIF',
        `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; padding-bottom:10px; border-bottom:2px solid rgba(115,251,247,0.32);">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" id="cloud-home-tab-cloud" class="mini-btn" style="opacity:${localPanel === 'cloud' ? '1' : '0.58'};">Cloud</button>
                    <button type="button" id="cloud-home-tab-local" class="mini-btn" style="opacity:${localPanel === 'local' ? '1' : '0.58'};">Local</button>
                </div>
            </div>
            <div style="max-height:320px; overflow:auto; padding-right:4px;">${panelBody}</div>
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:10px; color:#9bb0c7; font-size:0.82rem;">
                <span>Connecte: ${escapeHtml(collab.user.username || '')}</span>
                <span style="color:${isCloudBoardActive() ? 'var(--accent-cyan)' : '#9bb0c7'};">
                ${isCloudBoardActive() ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} (${escapeHtml(collab.activeRole || '')})` : 'Aucun board cloud actif'}
                </span>
            </div>
        `,
        localPanel === 'cloud'
            ? `
                <button type="button" id="cloud-create-board" class="btn-modal-confirm">Nouveau</button>
                <button type="button" id="cloud-save-active" class="btn-modal-cancel">Sauver</button>
                <button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>
            `
            : `<button type="button" id="cloud-logout" class="btn-modal-cancel">Deconnexion</button>`
    );

    const saveActiveBtn = document.getElementById('cloud-save-active');
    if (saveActiveBtn && (!isCloudBoardActive() || !canEditCloudBoard())) {
        saveActiveBtn.disabled = true;
        saveActiveBtn.style.opacity = '0.45';
        saveActiveBtn.title = isCloudBoardActive() ? 'Droits insuffisants' : 'Aucun board actif';
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

    const logoutBtn = document.getElementById('cloud-logout');
    if (logoutBtn) {
        bindCloudActionButton(logoutBtn, async () => {
            await logoutCollab();
            await renderCloudHome();
        });
    }

    const tabCloud = document.getElementById('cloud-home-tab-cloud');
    if (tabCloud) {
        bindCloudActionButton(tabCloud, async () => {
            collab.homePanel = 'cloud';
            renderCloudHomeLoading('cloud', 'Chargement des boards map...');
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

    Array.from(document.querySelectorAll('[data-local-action]')).forEach((btn) => {
        bindCloudActionButton(btn, async () => {
            const action = btn.getAttribute('data-local-action') || '';

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
                    setActiveCloudBoardFromSummary(null);
                    setBoardQueryParam('');
                }
                await renderCloudHome();
            } catch (e) {
                await customAlert('ERREUR CLOUD', escapeHtml(e.message || 'Erreur inconnue.'));
            }
        });
    });
    */
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

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const boardFromUrl = String(urlParams.get('board') || '').trim();
        if (boardFromUrl) collab.pendingBoardId = boardFromUrl;
    } catch (e) {}

    if (!collab.token) {
        setActiveCloudBoardFromSummary(null);
        return;
    }

    try {
        const me = await collabAuthRequest('me');
        collab.user = me.user || collab.user;
    } catch (e) {
        await logoutCollab();
        return;
    }

    const preferredBoard = collab.pendingBoardId || collab.activeBoardId;
    if (preferredBoard) {
        try {
            await openCloudBoard(preferredBoard, { quiet: true });
        } catch (e) {
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
}
