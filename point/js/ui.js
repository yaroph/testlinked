import { state, saveState, scheduleSave, ensureLinkIds, nodeById, isPerson, isCompany, isGroup, undo, pushHistory, setLocalPersistenceEnabled, isLocalPersistenceEnabled } from './state.js';
import { ensureNode, addLink as logicAddLink, calculatePath, clearPath, calculateHVT, mergeNodes, updatePersonColors } from './logic.js';
import { renderPathfindingSidebar } from './templates.js';
import { restartSim } from './physics.js';
import { draw, updateDegreeCache, resizeCanvas, scheduleDraw } from './render.js';
import { escapeHtml, linkKindEmoji, kindToLabel, clamp, uid, sanitizeNodeColor, normalizePersonStatus, screenToWorld } from './utils.js';
import { TYPES, FILTERS, FILTER_RULES, KINDS, PERSON_STATUS } from './constants.js';
import { injectStyles } from './styles.js';
import { setupCanvasEvents } from './interaction.js';
import { showSettings, showContextMenu, hideContextMenu } from './ui-settings.js';
import { renderEditor } from './ui-editor.js';
import { computeLinkSuggestions, getAllowedKinds } from './intel.js';
import { generateExportData, buildExportFilename, downloadExportData } from './data-transfer.js';
import { openPointAiHub, bindPointQuickActions } from './ui-ai.js';
import { clampFocusDepth, clearFocusMode, setFocusMode, refreshFocusMode } from './focus.js';
import {
    updateBoardQueryParam,
    createStoredCollabStateBridge,
    buildCollabAuthRequester,
    buildCollabBoardRequester,
    stopNamedTimer,
    queueNamedTimer,
    stopRetriableLoop,
    scheduleRetriableLoop
} from '../../shared/js/collab-browser.mjs';
import {
    isCloudBoardActive as isSharedCloudBoardActive,
    isCloudOwner as isSharedCloudOwner,
    isLocalSaveLocked as isSharedLocalSaveLocked,
    canEditCloudBoard as canSharedEditCloudBoard,
    shouldUseRealtimeCloud as shouldSharedUseRealtimeCloud,
    isRealtimeCloudActive as isSharedRealtimeCloudActive
} from '../../shared/js/collab-state.mjs';
import { createRealtimeBoardSession } from '../../shared/realtime/board-session.mjs';
import { canUseRealtimeTransport } from '../../shared/realtime/config.mjs';
import { canonicalizePointPayload, diffPointOpsWithoutRealtimeText, applyPointOps, stripPointRealtimeTextFields } from '../../shared/realtime/point-doc.mjs';
import { findPointSearchMatches } from '../../shared/js/point-search.mjs';
import { bindAsyncActionButton } from '../../shared/js/ui-async.mjs';
import { createBrowserDebugLogger } from '../../shared/js/browser-debug.mjs';
import { clampPointCursorCoord, normalizePointCursorPresence } from '../../shared/js/collab-cursor-visuals.mjs';
import { normalizePointPhysicsSettings } from '../../shared/js/point-physics-settings.mjs';
import { clearPointRemoteCursors, setPointRemoteCursors } from './collab-cursors.js';
import { attachAsyncAutocomplete } from '../../shared/js/async-autocomplete.mjs';

const ui = {
    listCompanies: document.getElementById('listCompanies'),
    listGroups: document.getElementById('listGroups'),
    listPeople: document.getElementById('listPeople'),
    linkLegend: document.getElementById('linkLegend'),
    pathfindingContainer: document.getElementById('pathfinding-ui'),
    centerEmptyState: document.getElementById('centerEmptyState')
};

const bindImmediateActionButton = bindAsyncActionButton;

let modalOverlay = null;
let hvtPanel = null;
let intelPanel = null;
let intelSuggestions = [];
let modalDismissHandler = null;
let modalLastActiveElement = null;
const API_KEY_STORAGE_KEY = 'bniLinkedApiKey';
const COLLAB_AUTH_ENDPOINT = '/.netlify/functions/collab-auth';
const COLLAB_BOARD_ENDPOINT = '/.netlify/functions/collab-board';
const COLLAB_SESSION_STORAGE_KEY = 'bniLinkedCollabSession_v1';
const COLLAB_ACTIVE_BOARD_STORAGE_KEY = 'bniLinkedActiveBoard_v1';
const POINT_LOCAL_CHANGE_EVENT = 'bni:point-local-change';
const ACTION_LOG_STORAGE_KEY = 'bniLinkedActionLog_v1';
const ACTION_LOG_MAX = 80;
const LOCAL_WORKSPACE_BACKUP_KEY = 'bniLinkedPointLocalWorkspace_v1';
const LOCAL_WORKSPACE_HEALTHY_BACKUP_KEY = 'bniLinkedPointHealthyWorkspace_v1';
const LOCAL_WORKSPACE_HEALTH_WARNED_KEY = 'bniLinkedPointWorkspaceHealthWarned_v1';
const COLLAB_NODE_FIELDS = ['name', 'type', 'color', 'manualColor', 'personStatus', 'num', 'accountNumber', 'citizenNumber', 'linkedMapPointId', 'description', 'notes', 'x', 'y', 'fixed'];
const COLLAB_LINK_FIELDS = ['source', 'target', 'kind'];
const COLLAB_PRESENCE_HEARTBEAT_MS = 12000;
const COLLAB_PRESENCE_RETRY_MS = 5000;
const COLLAB_SESSION_HEARTBEAT_MS = 18000;
const COLLAB_SESSION_RETRY_MS = 5000;

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
    saveInFlight: false,
    lastSavedFingerprint: '',
    localChangeSeq: 0,
    lastSavedChangeSeq: 0,
    shadowData: null,
    suppressAutosave: 0,
    presence: [],
    presenceTimer: null,
    presenceLoopToken: 0,
    presenceLoopRunning: false,
    presenceRetryMs: 0,
    presenceInFlight: false,
    syncState: 'idle',
    syncLabel: 'Local',
    sessionTimer: null,
    sessionLoopToken: 0,
    sessionLoopRunning: false,
    sessionRetryMs: 0,
    sessionInFlight: false,
    homePanel: 'cloud',
    realtimeSession: null,
    realtimeFallbackActive: false,
    realtimeTextBindings: new Map(),
    activeTextKey: '',
    activeTextLabel: '',
    homeRenderSeq: 0,
    profileFlash: '',
    cursorVisible: false,
    cursorWorldX: 0,
    cursorWorldY: 0,
    cursorSyncTimer: null,
    cursorLastSentAt: 0
};

const pointDebugLogger = createBrowserDebugLogger({
    namespace: 'point-diag',
    queryParams: ['debugCloud', 'debugPoint', 'debugPointCloud', 'debug'],
    storageKeys: ['BNI_DEBUG_POINT', 'BNI_DEBUG_CLOUD', 'BNI_DEBUG_POINT_CLOUD'],
    windowFlags: ['BNI_DEBUG_POINT', 'BNI_DEBUG_CLOUD']
});

const COLLAB_AUTOSAVE_DEBOUNCE_MS = 1600;
const COLLAB_AUTOSAVE_RETRY_MS = 700;
const COLLAB_WATCH_TIMEOUT_MS = 12000;
const COLLAB_WATCH_RETRY_MIN_MS = 1000;
const COLLAB_WATCH_RETRY_MAX_MS = 8000;
const COLLAB_CURSOR_REALTIME_MS = 80;
const COLLAB_CURSOR_LEGACY_MS = 180;
const collabStorage = createStoredCollabStateBridge({
    sessionStorageKey: COLLAB_SESSION_STORAGE_KEY,
    boardStorageKey: COLLAB_ACTIVE_BOARD_STORAGE_KEY
});
const sharedCollabAuthRequest = buildCollabAuthRequester({
    endpoint: COLLAB_AUTH_ENDPOINT,
    getToken: () => collab.token,
    allowGetFallback: false
});
const sharedCollabBoardRequest = buildCollabBoardRequester({
    endpoint: COLLAB_BOARD_ENDPOINT,
    getToken: () => collab.token
});

let actionLogs = [];
let centerEmptyDismissed = false;
let realtimeTextTools = null;
let realtimeTextToolsPromise = null;

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

function getPointPayloadSummary(payload = null) {
    const source = payload && typeof payload === 'object'
        ? payload
        : {
            nodes: state.nodes,
            links: state.links,
            meta: { projectName: state.projectName }
        };
    const health = getPointWorkspaceNameHealth(source);
    return {
        nodes: health.total,
        unnamedNodes: health.unnamed,
        unnamedRatio: Math.round((Number(health.ratio || 0) || 0) * 1000) / 1000,
        links: Array.isArray(source?.links) ? source.links.length : 0,
        projectName: String(source?.meta?.projectName || source?.projectName || state.projectName || '')
    };
}

function getPointDiagState(extra = {}) {
    return {
        user: collab.user?.username || '',
        hasToken: Boolean(collab.token),
        boardId: shortDiagId(collab.activeBoardId),
        boardTitle: collab.activeBoardTitle || '',
        syncState: collab.syncState || '',
        syncLabel: collab.syncLabel || '',
        realtimeActive: isRealtimeCloudActive(),
        realtimeFallbackActive: Boolean(collab.realtimeFallbackActive),
        transportAvailable: canUseRealtimeTransport(),
        localPersistenceEnabled: isLocalPersistenceEnabled(),
        workspace: getPointPayloadSummary(),
        ...extra
    };
}

function summarizePointCloudResponse(action, result = {}) {
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
        const plain = result.board.data ? extractPlainPointPayloadFromCloud(result.board.data) : null;
        return {
            boardId: shortDiagId(result.board.id || ''),
            page: String(result.board.page || ''),
            role: String(result.role || result.board.role || ''),
            title: String(result.board.title || ''),
            workspace: plain ? getPointPayloadSummary(plain) : null,
            mergedConflict: Boolean(result?.mergedConflict)
        };
    }
    return {};
}

if (typeof window !== 'undefined') {
    window.__BNI_POINT_DEBUG__ = pointDebugLogger;
    window.__BNI_POINT_DIAG_STATE__ = () => getPointDiagState();
}

const INTEL_PRESETS = {
    quick: {
        mode: 'serieux',
        minScore: 0.5,
        noveltyRatio: 0.12,
        limit: 8,
        sources: { graph: true, text: true, tags: true, profile: true, bridge: false, lex: false, geo: false }
    },
    balanced: {
        mode: 'decouverte',
        minScore: 0.35,
        noveltyRatio: 0.25,
        limit: 12,
        sources: { graph: true, text: true, tags: true, profile: true, bridge: true, lex: true, geo: true }
    },
    wide: {
        mode: 'creatif',
        minScore: 0.24,
        noveltyRatio: 0.45,
        limit: 20,
        sources: { graph: true, text: true, tags: true, profile: true, bridge: true, lex: true, geo: true }
    }
};

const POINT_REALTIME_TEXT_FIELDS = {
    name: {
        label: 'Nom',
        awarenessId: 'awName'
    },
    num: {
        label: 'Telephone',
        awarenessId: 'awPhone'
    },
    accountNumber: {
        label: 'Compte',
        awarenessId: 'awAccount'
    },
    citizenNumber: {
        label: 'Numero social',
        awarenessId: 'awCitizen'
    },
    description: {
        label: 'Description',
        awarenessId: 'awDescription'
    }
};

function hasOwnField(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function getModalOverlay() {
    return modalOverlay;
}

function restoreModalFocus() {
    const target = modalLastActiveElement;
    modalLastActiveElement = null;
    if (target && typeof target.focus === 'function') {
        requestAnimationFrame(() => target.focus());
    }
}

function hideModalOverlay(options = {}) {
    if (!modalOverlay) return;
    modalOverlay.style.display = 'none';
    modalOverlay.setAttribute('data-mode', 'default');
    modalDismissHandler = null;
    if (options.restoreFocus !== false) restoreModalFocus();
}

function dismissModalOverlay() {
    const handler = modalDismissHandler;
    if (typeof handler === 'function') {
        modalDismissHandler = null;
        handler();
        return;
    }
    hideModalOverlay();
}

function showModalOverlay() {
    if (!modalOverlay) createModal();
    if (!modalOverlay) return;
    const activeEl = document.activeElement;
    modalLastActiveElement = activeEl instanceof HTMLElement ? activeEl : null;
    modalOverlay.style.display = 'flex';
    requestAnimationFrame(() => modalOverlay.focus());
}

function updateCenterEmptyState() {
    if (!ui.centerEmptyState) return;
    ui.centerEmptyState.hidden = centerEmptyDismissed || state.nodes.length > 0;
}

function sanitizeLogText(value, fallback = '') {
    const compact = String(value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return fallback;
    if (compact.length > 120) return `${compact.slice(0, 117)}...`;
    return compact;
}

function nodeTypeLabel(type) {
    if (type === TYPES.PERSON) return 'Personne';
    if (type === TYPES.GROUP) return 'Groupe';
    if (type === TYPES.COMPANY) return 'Entreprise';
    return 'Point';
}

function formatLogTime(ts) {
    const date = new Date(Number(ts) || Date.now());
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function hydrateActionLogs() {
    try {
        const raw = localStorage.getItem(ACTION_LOG_STORAGE_KEY);
        if (!raw) {
            actionLogs = [];
            return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            actionLogs = [];
            return;
        }
        actionLogs = parsed
            .map((item) => ({
                text: sanitizeLogText(item?.text || ''),
                at: Number(item?.at) || Date.now()
            }))
            .filter((item) => Boolean(item.text))
            .slice(0, ACTION_LOG_MAX);
    } catch (e) {
        actionLogs = [];
    }
}

function persistActionLogs() {
    try {
        localStorage.setItem(ACTION_LOG_STORAGE_KEY, JSON.stringify(actionLogs.slice(0, ACTION_LOG_MAX)));
    } catch (e) {}
}

function renderActionLogs() {
    const list = document.getElementById('action-log-list');
    if (!list) return;

    if (!actionLogs.length) {
        list.innerHTML = '<div class="action-log-empty">En attente d\'actions...</div>';
        return;
    }

    list.innerHTML = actionLogs.slice(0, 10).map((entry) => `
        <div class="action-log-row">
            <span class="action-log-time">${escapeHtml(formatLogTime(entry.at))}</span>
            <span class="action-log-text">${escapeHtml(entry.text)}</span>
        </div>
    `).join('');
}

function resolveActionActor(preferred = '') {
    const collabName = sanitizeLogText(collab.user?.username || '', '');
    if (collabName) return collabName;
    const preferredName = sanitizeLogText(preferred, '');
    if (preferredName) return preferredName;
    const selected = nodeById(state.selection);
    const selectedName = sanitizeLogText(selected?.name || '', '');
    if (selectedName) return selectedName;
    return 'Operateur';
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

function getPointRealtimeTextKey(nodeId, fieldName) {
    if (!realtimeTextTools?.makePointTextKey) return '';
    return realtimeTextTools.makePointTextKey(nodeId, fieldName);
}

function clearRealtimeFieldPresence(options = {}) {
    const shouldNotify = Boolean(options.notify);
    const hadPresence = Boolean(collab.activeTextKey || collab.activeTextLabel);
    collab.activeTextKey = '';
    collab.activeTextLabel = '';
    if (shouldNotify && hadPresence) {
        if (collab.realtimeSession) {
            collab.realtimeSession.updatePresence();
        } else if (isCloudBoardActive() && collab.user) {
            touchCollabPresence(collab.presenceLoopToken, { force: true }).catch(() => {});
        }
    }
}

function setRealtimeFieldPresence(textKey, textLabel) {
    const nextKey = String(textKey || '').trim();
    const nextLabel = String(textLabel || '').trim();
    if (collab.activeTextKey === nextKey && collab.activeTextLabel === nextLabel) return;
    collab.activeTextKey = nextKey;
    collab.activeTextLabel = nextLabel;
    if (collab.realtimeSession) {
        collab.realtimeSession.updatePresence();
    } else if (isCloudBoardActive() && collab.user) {
        touchCollabPresence(collab.presenceLoopToken, { force: true }).catch(() => {});
    }
}

function getPointFieldAwarenessContainerId(fieldName) {
    return POINT_REALTIME_TEXT_FIELDS[fieldName]?.awarenessId || '';
}

function getPointFieldAwarenessMessage(textKey) {
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

function syncPointRealtimeAwarenessDecorations(nodeId = state.selection) {
    const cleanNodeId = String(nodeId || '').trim();
    Object.keys(POINT_REALTIME_TEXT_FIELDS).forEach((fieldName) => {
        const awarenessId = getPointFieldAwarenessContainerId(fieldName);
        if (!awarenessId) return;
        const el = document.getElementById(awarenessId);
        if (!el) return;
        const textKey = cleanNodeId ? getPointRealtimeTextKey(cleanNodeId, fieldName) : '';
        const message = getPointFieldAwarenessMessage(textKey);
        el.textContent = message;
        el.style.display = message ? 'block' : 'none';
    });
}

export function appendActionLog(message, options = {}) {
    const text = sanitizeLogText(message, '');
    if (!text) return false;

    const now = Date.now();
    const latest = actionLogs[0];
    const dedupeWindowMs = Math.max(400, Number(options?.dedupeWindowMs) || 1300);
    if (latest && latest.text === text && (now - Number(latest.at || 0)) < dedupeWindowMs) {
        return false;
    }

    actionLogs.unshift({ text, at: now });
    if (actionLogs.length > ACTION_LOG_MAX) actionLogs = actionLogs.slice(0, ACTION_LOG_MAX);
    persistActionLogs();
    renderActionLogs();
    return true;
}

export function logNodeAdded(nodeName, actor = '') {
    const cleanNode = sanitizeLogText(nodeName, 'Point');
    const cleanActor = resolveActionActor(actor);
    const detailText = `a ajoute le point ${cleanNode}`;
    return appendActionLog(`${cleanActor} ${detailText}`);
}

function logNodesConnected(sourceNode, targetNode, actor = '') {
    if (!sourceNode || !targetNode) return false;
    const cleanActor = resolveActionActor(actor);
    const sourceName = sanitizeLogText(sourceNode.name || '', 'Source');
    const targetName = sanitizeLogText(targetNode.name || '', 'Cible');
    const detailText = `a ajoute la liaison entre ${sourceName} et ${targetName}`;
    return appendActionLog(`${cleanActor} ${detailText}`);
}

function getApiKey() {
    const fromWindow = (typeof window !== 'undefined' && typeof window.BNI_LINKED_KEY === 'string')
        ? window.BNI_LINKED_KEY.trim()
        : '';
    if (fromWindow) return fromWindow;

    try {
        const fromStorage = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (fromStorage && fromStorage.trim()) return fromStorage.trim();
    } catch (e) {}

    return '';
}

function withApiKey(headers = {}) {
    const merged = { ...headers };
    const apiKey = getApiKey();
    if (apiKey) merged['x-api-key'] = apiKey;
    return merged;
}

function isCloudBoardActive() {
    return isSharedCloudBoardActive(collab);
}

function isCloudOwner() {
    return isSharedCloudOwner(collab);
}

function isLocalSaveLocked() {
    return isSharedLocalSaveLocked(collab);
}

function canEditCloudBoard() {
    return canSharedEditCloudBoard(collab);
}

function shouldUseRealtimeCloud() {
    return shouldSharedUseRealtimeCloud(collab, canUseRealtimeTransport());
}

function isRealtimeCloudActive() {
    return isSharedRealtimeCloudActive(collab);
}

function setBoardQueryParam(boardId) {
    updateBoardQueryParam(boardId);
}

function persistCollabState() {
    collabStorage.persist(collab);
}

function clearCollabStorage() {
    collabStorage.clear();
}

function triggerFileInput(inputId) {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return false;
    try {
        input.value = '';
    } catch (e) {}
    const computed = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(input)
        : null;
    const isActuallyVisible = Boolean(computed)
        && computed.display !== 'none'
        && computed.visibility !== 'hidden'
        && computed.opacity !== '0';
    try {
        if (isActuallyVisible && typeof input.showPicker === 'function') {
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

function hydrateCollabState() {
    collabStorage.hydrate(collab);
    pointDebugLogger.log('hydrate-collab-state', getPointDiagState({
        pendingBoardId: shortDiagId(collab.pendingBoardId),
        storedUser: collab.user?.username || ''
    }));
}

function syncCloudStatus() {
    const statusEl = document.getElementById('cloudStatus');
    const currentSyncState = collab.syncState || (collab.user ? (isCloudBoardActive() ? 'live' : 'session') : 'local');
    if (!statusEl) {
        syncCloudLivePanels();
        return;
    }

    const renderStatus = (stateName, label, value = '') => {
        statusEl.dataset.state = stateName;
        if (!value) {
            statusEl.innerHTML = `<span class="cloud-status-solo">${escapeHtml(label)}</span>`;
            return;
        }
        statusEl.innerHTML = `
            <span class="cloud-status-label">${escapeHtml(label)}</span>
            <span class="cloud-status-value">${escapeHtml(String(value || ''))}</span>
        `;
    };

    if (!collab.user) {
        statusEl.dataset.syncState = 'local';
        statusEl.dataset.disconnectable = '0';
        statusEl.dataset.hoverDisconnect = '0';
        statusEl.classList.remove('is-clickable');
        statusEl.title = '';
        renderStatus('local', 'Local');
        syncCloudLivePanels();
        return;
    }

    if (collab.activeBoardId) {
        const label = collab.activeRole === 'owner' ? 'Lead' : 'Board';
        const value = collab.activeBoardTitle || collab.activeRole || 'Cloud';
        const isHoverDisconnect = statusEl.dataset.hoverDisconnect === '1';
        statusEl.dataset.syncState = currentSyncState;
        statusEl.dataset.disconnectable = '1';
        statusEl.classList.add('is-clickable');
        statusEl.title = 'Cliquer pour deconnecter le cloud actif';
        if (isHoverDisconnect) {
            renderStatus('board', 'Cloud', 'Déconnexion');
        } else {
            renderStatus('board', label, value);
        }
        syncCloudLivePanels();
        return;
    }

    statusEl.dataset.syncState = 'session';
    statusEl.dataset.disconnectable = '0';
    statusEl.dataset.hoverDisconnect = '0';
    statusEl.classList.remove('is-clickable');
    statusEl.title = '';
    renderStatus('local', 'Local', collab.user.username || 'Connecte');
    syncCloudLivePanels();
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

function collabTimeValue(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function cloneJson(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return fallback;
    }
}

function persistWorkspaceSnapshot(storageKey, payload = generateExportData()) {
    try {
        const normalized = normalizePointPayloadForLoad(payload);
        if (!normalized) return false;
        localStorage.setItem(String(storageKey || ''), JSON.stringify({
            savedAt: Date.now(),
            payload: normalized
        }));
        return true;
    } catch (e) {
        return false;
    }
}

function readWorkspaceSnapshot(storageKey) {
    try {
        const raw = localStorage.getItem(String(storageKey || ''));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return normalizePointPayloadForLoad(parsed?.payload || parsed);
    } catch (e) {
        return null;
    }
}

function persistLastLocalWorkspaceSnapshot(payload = generateExportData()) {
    return persistWorkspaceSnapshot(LOCAL_WORKSPACE_BACKUP_KEY, payload);
}

function persistHealthyLocalWorkspaceSnapshot(payload = generateExportData()) {
    const normalized = normalizePointPayloadForLoad(payload);
    if (!normalized) return false;
    if (isLikelyDamagedLocalWorkspace(getPointWorkspaceNameHealth(normalized))) {
        return false;
    }
    return persistWorkspaceSnapshot(LOCAL_WORKSPACE_HEALTHY_BACKUP_KEY, normalized);
}

function readLastLocalWorkspaceSnapshot() {
    return readWorkspaceSnapshot(LOCAL_WORKSPACE_BACKUP_KEY);
}

function readHealthyLocalWorkspaceSnapshot() {
    return readWorkspaceSnapshot(LOCAL_WORKSPACE_HEALTHY_BACKUP_KEY);
}

function rememberCurrentLocalWorkspace() {
    if (isCloudBoardActive()) return false;
    const payload = generateExportData();
    const savedLast = persistLastLocalWorkspaceSnapshot(payload);
    const savedHealthy = persistHealthyLocalWorkspaceSnapshot(payload);
    return savedLast || savedHealthy;
}

function restoreLastLocalWorkspace(options = {}) {
    const fallbackClear = options.fallbackClear !== false;
    const payload = readLastLocalWorkspaceSnapshot();
    if (payload) {
        withoutCloudAutosave(() => processData(payload, 'load', { silent: true }));
        state.selection = null;
        renderEditor();
        updatePathfindingPanel();
        updateFocusControls();
        updateCenterEmptyState();
        draw();
        return true;
    }
    if (fallbackClear) {
        clearPointWorkspaceData();
    }
    return false;
}

function getPointWorkspaceNameHealth(payload = null) {
    const source = payload && typeof payload === 'object' ? payload : { nodes: state.nodes };
    const nodes = Array.isArray(source?.nodes) ? source.nodes : [];
    const total = nodes.length;
    const unnamed = nodes.reduce((count, node) => {
        const rawName = String(node?.name || '').trim();
        return count + (rawName === '' || rawName === 'Sans nom' ? 1 : 0);
    }, 0);
    return {
        total,
        unnamed,
        ratio: total > 0 ? unnamed / total : 0
    };
}

function isLikelyDamagedLocalWorkspace(stats) {
    const total = Number(stats?.total || 0);
    const unnamed = Number(stats?.unnamed || 0);
    const ratio = Number(stats?.ratio || 0);
    if (total < 8) return false;
    if (unnamed < 4) return false;
    return ratio >= 0.28;
}

function isBackupHealthier(currentStats, backupStats) {
    if (!backupStats || Number(backupStats.total || 0) < 1) return false;
    if (Number(backupStats.total || 0) + 2 < Number(currentStats.total || 0)) return false;
    if (Number(backupStats.unnamed || 0) >= Number(currentStats.unnamed || 0)) return false;
    return Number(backupStats.ratio || 0) <= Math.max(0.06, Number(currentStats.ratio || 0) - 0.15);
}

function pickRecoveryWorkspaceSnapshot(currentStats) {
    const candidates = [
        {
            payload: readHealthyLocalWorkspaceSnapshot(),
            label: 'derniere sauvegarde locale saine'
        },
        {
            payload: readLastLocalWorkspaceSnapshot(),
            label: 'derniere sauvegarde locale'
        }
    ].map((entry) => ({
        ...entry,
        stats: entry.payload ? getPointWorkspaceNameHealth(entry.payload) : null
    })).filter((entry) => entry.payload && isBackupHealthier(currentStats, entry.stats));

    if (!candidates.length) return null;
    candidates.sort((left, right) => {
        const leftRatio = Number(left.stats?.ratio || 0);
        const rightRatio = Number(right.stats?.ratio || 0);
        if (leftRatio !== rightRatio) return leftRatio - rightRatio;
        return Number(left.stats?.unnamed || 0) - Number(right.stats?.unnamed || 0);
    });
    return candidates[0] || null;
}

function readWorkspaceHealthWarningState() {
    try {
        if (typeof sessionStorage === 'undefined') return '';
        return String(sessionStorage.getItem(LOCAL_WORKSPACE_HEALTH_WARNED_KEY) || '');
    } catch (e) {
        return '';
    }
}

function writeWorkspaceHealthWarningState(value = '') {
    try {
        if (typeof sessionStorage === 'undefined') return;
        if (!value) {
            sessionStorage.removeItem(LOCAL_WORKSPACE_HEALTH_WARNED_KEY);
            return;
        }
        sessionStorage.setItem(LOCAL_WORKSPACE_HEALTH_WARNED_KEY, String(value));
    } catch (e) {}
}

export function maybeRecoverDamagedLocalWorkspace() {
    if (isCloudBoardActive()) {
        pointDebugLogger.log('local-workspace-health-skip', getPointDiagState({
            reason: 'cloud-board-active'
        }));
        return false;
    }

    const currentStats = getPointWorkspaceNameHealth();
    pointDebugLogger.log('local-workspace-health-check', getPointDiagState({
        workspaceHealth: currentStats,
        damaged: isLikelyDamagedLocalWorkspace(currentStats)
    }));
    if (!isLikelyDamagedLocalWorkspace(currentStats)) {
        writeWorkspaceHealthWarningState('');
        return false;
    }

    const warningFingerprint = `${currentStats.total}:${currentStats.unnamed}`;
    if (readWorkspaceHealthWarningState() === warningFingerprint) {
        return false;
    }
    writeWorkspaceHealthWarningState(warningFingerprint);

    const recoverySnapshot = pickRecoveryWorkspaceSnapshot(currentStats);

    if (recoverySnapshot?.payload) {
        pointDebugLogger.warn('local-workspace-recovery-offered', getPointDiagState({
            workspaceHealth: currentStats,
            recoveryLabel: recoverySnapshot.label,
            recoveryHealth: recoverySnapshot.stats || getPointWorkspaceNameHealth(recoverySnapshot.payload)
        }));
        showCustomConfirm(
            `Le workspace local contient beaucoup de fiches sans nom (${currentStats.unnamed}/${currentStats.total}). Restaurer ${recoverySnapshot.label} ?`,
            () => {
                withoutCloudAutosave(() => processData(recoverySnapshot.payload, 'load', { silent: true }));
                state.selection = null;
                renderEditor();
                updatePathfindingPanel();
                updateFocusControls();
                updateCenterEmptyState();
                draw();
                writeWorkspaceHealthWarningState('');
                showCustomAlert('Sauvegarde locale restauree.');
            }
        );
        return true;
    }

    pointDebugLogger.warn('local-workspace-damaged-no-backup', getPointDiagState({
        workspaceHealth: currentStats
    }));
    showCustomAlert(`Le workspace local contient beaucoup de fiches sans nom (${currentStats.unnamed}/${currentStats.total}). Cela vient souvent d'une fusion/import incomplet. Utilise Fichier > Reset ou reimporte une sauvegarde saine.`);
    return true;
}

let cloudWorkspaceBusyEl = null;

function ensureCloudWorkspaceBusyOverlay() {
    if (cloudWorkspaceBusyEl && cloudWorkspaceBusyEl.isConnected) return cloudWorkspaceBusyEl;
    const el = document.createElement('div');
    el.id = 'cloudWorkspaceBusy';
    el.hidden = true;
    el.innerHTML = `
        <div class="cloud-workspace-busy-card">
            <div class="cloud-workspace-spinner" aria-hidden="true"></div>
            <div id="cloudWorkspaceBusyLabel" class="cloud-workspace-busy-label">Chargement cloud...</div>
        </div>
    `;
    document.body.appendChild(el);
    cloudWorkspaceBusyEl = el;
    return el;
}

function setCloudWorkspaceBusy(active, message = 'Chargement cloud...') {
    const el = ensureCloudWorkspaceBusyOverlay();
    const label = el.querySelector('#cloudWorkspaceBusyLabel');
    const isActive = Boolean(active);
    if (label) label.textContent = String(message || 'Chargement cloud...');
    el.hidden = !isActive;
    el.style.display = isActive ? 'flex' : 'none';
    el.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    document.body.classList.toggle('cloud-workspace-busy-active', isActive);
}

function setModalButtonsBusy(activeButton, busy) {
    const actions = document.getElementById('modal-actions');
    if (!actions) return;
    const buttons = Array.from(actions.querySelectorAll('button'));
    buttons.forEach((btn) => {
        btn.disabled = Boolean(busy);
        btn.classList.toggle('is-busy-dimmed', Boolean(busy));
        btn.classList.remove('is-busy');
    });
    if (busy && activeButton instanceof HTMLElement) {
        activeButton.classList.add('is-busy');
    }
}

function choosePointPayloadSource(options = {}) {
    const { title = 'Choisir une source de données', onText, onFile, onBack = null } = options;
    if (!modalOverlay) createModal();
    setModalMode('prompt');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = `
        <div class="modal-tool">
            <div class="modal-tool-title">${escapeHtml(title)}</div>
            <div class="cloud-create-hint">Choisis la source des données à injecter.</div>
        </div>
    `;
    actEl.innerHTML = `
        <button type="button" id="point-payload-raw">Créer depuis data brute</button>
        <button type="button" id="point-payload-file" class="primary">Créer depuis fichier</button>
        ${onBack ? '<button type="button" id="point-payload-back">Retour</button>' : ''}
    `;

    const rawBtn = document.getElementById('point-payload-raw');
    const fileBtn = document.getElementById('point-payload-file');
    const backBtn = document.getElementById('point-payload-back');

    if (rawBtn) rawBtn.onclick = () => {
        if (typeof onText === 'function') onText();
    };
    if (fileBtn) fileBtn.onclick = () => {
        if (typeof onFile === 'function') onFile();
    };
    if (backBtn) backBtn.onclick = () => {
        if (typeof onBack === 'function') onBack();
    };

    modalDismissHandler = () => hideModalOverlay();
    showModalOverlay();
}

function normalizeCloudNode(rawNode) {
    if (!rawNode || typeof rawNode !== 'object') return null;
    const id = rawNode.id ?? '';
    if (id === '') return null;
    return {
        id,
        name: String(rawNode.name || '').trim(),
        type: String(rawNode.type || TYPES.PERSON),
        color: sanitizeNodeColor(String(rawNode.color || '')),
        manualColor: Boolean(rawNode.manualColor),
        personStatus: normalizePersonStatus(rawNode.personStatus, rawNode.type || TYPES.PERSON),
        num: String(rawNode.num || ''),
        accountNumber: String(rawNode.accountNumber || ''),
        citizenNumber: String(rawNode.citizenNumber || ''),
        linkedMapPointId: String(rawNode.linkedMapPointId || ''),
        description: String(rawNode.description || rawNode.notes || ''),
        notes: String(rawNode.notes || rawNode.description || ''),
        x: Number(rawNode.x) || 0,
        y: Number(rawNode.y) || 0,
        fixed: Boolean(rawNode.fixed)
    };
}

function normalizeCloudLink(rawLink) {
    if (!rawLink || typeof rawLink !== 'object') return null;
    const id = rawLink.id ?? '';
    if (id === '') return null;
    const source = rawLink.source && typeof rawLink.source === 'object' ? rawLink.source.id : rawLink.source;
    const target = rawLink.target && typeof rawLink.target === 'object' ? rawLink.target.id : rawLink.target;
    const sourceId = String(source ?? '');
    const targetId = String(target ?? '');
    if (!sourceId || !targetId || sourceId === targetId) return null;
    return {
        id,
        source: sourceId,
        target: targetId,
        kind: String(rawLink.kind || 'relation')
    };
}

function normalizeCloudEntityMeta(rawMeta, fields, fallbackUpdatedAt = '', fallbackUser = '') {
    const meta = rawMeta && typeof rawMeta === 'object' ? rawMeta : {};
    const fieldTimes = {};
    fields.forEach((field) => {
        fieldTimes[field] = String(meta.fieldTimes?.[field] || meta[field] || fallbackUpdatedAt || '');
    });
    return {
        updatedAt: String(meta.updatedAt || fallbackUpdatedAt || ''),
        updatedBy: String(meta.updatedBy || fallbackUser || ''),
        fieldTimes
    };
}

function normalizeCloudDeletedEntries(list, fallbackUpdatedAt = '', fallbackUser = '') {
    const latest = new Map();
    const source = Array.isArray(list) ? list : [];
    source.forEach((row) => {
        const id = String(row?.id ?? '').trim();
        if (!id) return;
        const next = {
            id,
            deletedAt: String(row?.deletedAt || fallbackUpdatedAt || ''),
            deletedBy: String(row?.deletedBy || fallbackUser || '')
        };
        const prev = latest.get(id);
        if (!prev || collabTimeValue(next.deletedAt) >= collabTimeValue(prev.deletedAt)) {
            latest.set(id, next);
        }
    });
    return [...latest.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalizeCloudBoardData(rawData, options = {}) {
    const fallbackUpdatedAt = String(options.fallbackUpdatedAt || collab.activeBoardUpdatedAt || '');
    const fallbackUser = String(options.fallbackUser || collab.user?.username || '');
    const raw = rawData && typeof rawData === 'object' ? rawData : {};
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .map((node) => {
            const normalized = normalizeCloudNode(node);
            if (!normalized) return null;
            return {
                ...normalized,
                _collab: normalizeCloudEntityMeta(node?._collab, COLLAB_NODE_FIELDS, fallbackUpdatedAt, fallbackUser)
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const links = (Array.isArray(raw.links) ? raw.links : [])
        .map((link) => {
            const normalized = normalizeCloudLink(link);
            if (!normalized) return null;
            return {
                ...normalized,
                _collab: normalizeCloudEntityMeta(link?._collab, COLLAB_LINK_FIELDS, fallbackUpdatedAt, fallbackUser)
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return {
        meta: raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {},
        physicsSettings: raw.physicsSettings && typeof raw.physicsSettings === 'object'
            ? cloneJson(raw.physicsSettings, {})
            : {},
        nodes,
        links,
        deletedNodes: normalizeCloudDeletedEntries(raw.deletedNodes, fallbackUpdatedAt, fallbackUser),
        deletedLinks: normalizeCloudDeletedEntries(raw.deletedLinks, fallbackUpdatedAt, fallbackUser),
        _collab: normalizeCloudEntityMeta(raw._collab, ['physicsSettings'], fallbackUpdatedAt, fallbackUser)
    };
}

function canonicalizePointPayloadForCompare(payload) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    const meta = raw.meta && typeof raw.meta === 'object'
        ? { ...raw.meta, date: '' }
        : { date: '' };
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
        .map((node) => normalizeCloudNode(node))
        .filter(Boolean)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const links = (Array.isArray(raw.links) ? raw.links : [])
        .map((link) => normalizeCloudLink(link))
        .filter(Boolean)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return {
        meta,
        physicsSettings: raw.physicsSettings && typeof raw.physicsSettings === 'object'
            ? cloneJson(raw.physicsSettings, {})
            : {},
        nodes,
        links
    };
}

function collabValuesEqual(leftValue, rightValue) {
    if (leftValue === rightValue) return true;

    const leftIsObject = leftValue !== null && typeof leftValue === 'object';
    const rightIsObject = rightValue !== null && typeof rightValue === 'object';
    if (!leftIsObject && !rightIsObject) return false;

    try {
        return JSON.stringify(leftValue) === JSON.stringify(rightValue);
    } catch (e) {
        return false;
    }
}

function buildCloudEntityMeta(currentEntity, shadowEntity, fields, nowIso, actor) {
    const shadowMeta = normalizeCloudEntityMeta(shadowEntity?._collab, fields, shadowEntity?._collab?.updatedAt || '', shadowEntity?._collab?.updatedBy || actor);
    const fieldTimes = {};
    let changed = !shadowEntity;

    fields.forEach((field) => {
        const nextValue = currentEntity ? currentEntity[field] : undefined;
        const prevValue = shadowEntity ? shadowEntity[field] : undefined;
        const sameValue = collabValuesEqual(nextValue, prevValue);
        if (!shadowEntity || !sameValue) {
            fieldTimes[field] = nowIso;
            changed = true;
        } else {
            fieldTimes[field] = String(shadowMeta.fieldTimes[field] || shadowMeta.updatedAt || nowIso);
        }
    });

    return {
        updatedAt: changed ? nowIso : String(shadowMeta.updatedAt || nowIso),
        updatedBy: changed ? actor : String(shadowMeta.updatedBy || actor),
        fieldTimes
    };
}

function buildCloudBoardPayload(plainData = null) {
    const plain = plainData && typeof plainData === 'object' ? plainData : generateExportData();
    const shadow = normalizeCloudBoardData(collab.shadowData, {
        fallbackUpdatedAt: collab.activeBoardUpdatedAt || '',
        fallbackUser: collab.user?.username || ''
    });
    const nowIso = new Date().toISOString();
    const actor = sanitizeLogText(collab.user?.username || '', 'operateur');
    const shadowNodeMap = new Map(shadow.nodes.map((node) => [String(node.id), node]));
    const shadowLinkMap = new Map(shadow.links.map((link) => [String(link.id), link]));
    const currentNodes = plain.nodes.map((node) => normalizeCloudNode(node)).filter(Boolean);
    const currentLinks = plain.links.map((link) => normalizeCloudLink(link)).filter(Boolean);
    const currentNodeIds = new Set(currentNodes.map((node) => String(node.id)));
    const currentLinkIds = new Set(currentLinks.map((link) => String(link.id)));
    const deletedNodeMap = new Map((shadow.deletedNodes || []).map((entry) => [String(entry.id), entry]));
    const deletedLinkMap = new Map((shadow.deletedLinks || []).map((entry) => [String(entry.id), entry]));

    const nodes = currentNodes.map((node) => {
        deletedNodeMap.delete(String(node.id));
        return {
            ...node,
            _collab: buildCloudEntityMeta(node, shadowNodeMap.get(String(node.id)), COLLAB_NODE_FIELDS, nowIso, actor)
        };
    });

    shadow.nodes.forEach((node) => {
        const key = String(node.id);
        if (currentNodeIds.has(key)) return;
        deletedNodeMap.set(key, {
            id: node.id,
            deletedAt: nowIso,
            deletedBy: actor
        });
    });

    const links = currentLinks.map((link) => {
        deletedLinkMap.delete(String(link.id));
        return {
            ...link,
            _collab: buildCloudEntityMeta(link, shadowLinkMap.get(String(link.id)), COLLAB_LINK_FIELDS, nowIso, actor)
        };
    });

    shadow.links.forEach((link) => {
        const key = String(link.id);
        if (currentLinkIds.has(key)) return;
        deletedLinkMap.set(key, {
            id: link.id,
            deletedAt: nowIso,
            deletedBy: actor
        });
    });

    const currentPhysics = plain.physicsSettings && typeof plain.physicsSettings === 'object'
        ? cloneJson(plain.physicsSettings, {})
        : {};
    const shadowPhysics = shadow.physicsSettings && typeof shadow.physicsSettings === 'object'
        ? shadow.physicsSettings
        : {};
    const samePhysics = JSON.stringify(currentPhysics) === JSON.stringify(shadowPhysics);
    const shadowBoardMeta = normalizeCloudEntityMeta(shadow._collab, ['physicsSettings'], collab.activeBoardUpdatedAt || '', actor);

    return {
        meta: {
            ...(plain.meta || {}),
            projectName: state.projectName || plain.meta?.projectName || shadow.meta?.projectName || ''
        },
        physicsSettings: currentPhysics,
        nodes,
        links,
        deletedNodes: [...deletedNodeMap.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
        deletedLinks: [...deletedLinkMap.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
        _collab: {
            updatedAt: samePhysics ? String(shadowBoardMeta.updatedAt || nowIso) : nowIso,
            updatedBy: samePhysics ? String(shadowBoardMeta.updatedBy || actor) : actor,
            fieldTimes: {
                physicsSettings: samePhysics
                    ? String(shadowBoardMeta.fieldTimes.physicsSettings || shadowBoardMeta.updatedAt || nowIso)
                    : nowIso
            }
        }
    };
}

function extractPlainPointPayloadFromCloud(rawData) {
    const normalized = normalizeCloudBoardData(rawData, {
        fallbackUpdatedAt: collab.activeBoardUpdatedAt || '',
        fallbackUser: collab.user?.username || ''
    });
    const deletedNodeMap = new Map(normalized.deletedNodes.map((entry) => [String(entry.id), entry]));
    const nodes = normalized.nodes
        .filter((node) => {
            const tombstone = deletedNodeMap.get(String(node.id));
            if (!tombstone) return true;
            return collabTimeValue(node?._collab?.updatedAt) > collabTimeValue(tombstone.deletedAt);
        })
        .map((node) => ({
            id: node.id,
            name: node.name,
            type: node.type,
            color: node.color,
            manualColor: Boolean(node.manualColor),
            personStatus: normalizePersonStatus(node.personStatus, node.type),
            num: node.num,
            accountNumber: node.accountNumber,
            citizenNumber: node.citizenNumber,
            linkedMapPointId: String(node.linkedMapPointId || ''),
            description: node.description,
            notes: node.notes,
            x: node.x,
            y: node.y,
            fixed: node.fixed
        }));
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const deletedLinkMap = new Map(normalized.deletedLinks.map((entry) => [String(entry.id), entry]));
    const linkSigs = new Set();
    const links = normalized.links
        .filter((link) => {
            const tombstone = deletedLinkMap.get(String(link.id));
            if (tombstone && collabTimeValue(link?._collab?.updatedAt) <= collabTimeValue(tombstone.deletedAt)) return false;
            return nodeIds.has(String(link.source)) && nodeIds.has(String(link.target));
        })
        .filter((link) => {
            const a = String(link.source);
            const b = String(link.target);
            const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
            const sig = `${pair}|${String(link.kind || '')}`;
            if (linkSigs.has(sig)) return false;
            linkSigs.add(sig);
            return true;
        })
        .map((link) => ({
            id: link.id,
            source: link.source,
            target: link.target,
            kind: link.kind
        }));
    return {
        meta: normalized.meta && typeof normalized.meta === 'object' ? { ...normalized.meta } : {},
        physicsSettings: normalizePointPhysicsSettings(normalized.physicsSettings),
        nodes,
        links
    };
}

function setCloudShadowData(rawData) {
    collab.shadowData = normalizeCloudBoardData(rawData, {
        fallbackUpdatedAt: collab.activeBoardUpdatedAt || '',
        fallbackUser: collab.user?.username || ''
    });
}

function withoutCloudAutosave(fn) {
    collab.suppressAutosave += 1;
    try {
        return fn();
    } finally {
        collab.suppressAutosave = Math.max(0, collab.suppressAutosave - 1);
    }
}

function setCloudSyncState(nextState, label = '') {
    const nextLabel = label || ({
        local: 'Local',
        session: 'Mode local',
        live: 'Synchro live active',
        pending: 'Modifs locales en attente',
        saving: 'Enregistrement cloud...',
        syncing: 'Mise a jour distante...',
        merged: 'Fusion auto appliquee',
        error: 'Sync en attente'
    }[nextState] || 'Cloud');
    if (collab.syncState === nextState && collab.syncLabel === nextLabel) return;
    const previousState = String(collab.syncState || '');
    const previousLabel = String(collab.syncLabel || '');
    collab.syncState = nextState;
    collab.syncLabel = nextLabel;
    pointDebugLogger.log('cloud-sync-state', getPointDiagState({
        from: previousState,
        fromLabel: previousLabel,
        to: nextState,
        toLabel: nextLabel
    }));
    syncCloudStatus();
}

function clearPointCursorSyncTimer() {
    stopNamedTimer(collab, 'cursorSyncTimer');
}

function buildPointPresencePayload(extra = {}) {
    const selectedId = String(extra.activeNodeId || state.selection || '');
    const selected = nodeById(selectedId);
    const cursorVisible = hasOwnField(extra, 'cursorVisible')
        ? Boolean(extra.cursorVisible)
        : Boolean(collab.cursorVisible);
    const cursorWorldX = hasOwnField(extra, 'cursorWorldX')
        ? clampPointCursorCoord(extra.cursorWorldX, collab.cursorWorldX || 0)
        : clampPointCursorCoord(collab.cursorWorldX, 0);
    const cursorWorldY = hasOwnField(extra, 'cursorWorldY')
        ? clampPointCursorCoord(extra.cursorWorldY, collab.cursorWorldY || 0)
        : clampPointCursorCoord(collab.cursorWorldY, 0);

    return {
        activeNodeId: selectedId,
        activeNodeName: String(extra.activeNodeName || selected?.name || ''),
        activeTextKey: String(extra.activeTextKey || collab.activeTextKey || ''),
        activeTextLabel: String(extra.activeTextLabel || collab.activeTextLabel || ''),
        mode: String(extra.mode || (canEditCloudBoard() ? 'editing' : 'viewing')),
        cursorVisible,
        cursorWorldX,
        cursorWorldY
    };
}

async function updatePointCloudPresence(extra = {}) {
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    const payload = buildPointPresencePayload(extra);
    if (isRealtimeCloudActive()) {
        return collab.realtimeSession?.updatePresence(payload) || false;
    }
    const result = await collabBoardRequest('touch_presence', {
        boardId: collab.activeBoardId,
        ...payload
    });
    updateCollabPresence(result?.presence || []);
    return Boolean(result?.ok);
}

async function flushPointCursorPresence() {
    clearPointCursorSyncTimer();
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    if (!isRealtimeCloudActive()) return false;

    const sent = await updatePointCloudPresence();
    if (sent) collab.cursorLastSentAt = Date.now();
    return sent;
}

function schedulePointCursorPresenceSync(delayMs = null) {
    if (!isCloudBoardActive() || !collab.user || !collab.token || !isRealtimeCloudActive()) return false;
    const interval = COLLAB_CURSOR_REALTIME_MS;
    const now = Date.now();
    const elapsed = Math.max(0, now - Number(collab.cursorLastSentAt || 0));
    const hasExplicitDelay = delayMs !== null && delayMs !== undefined;
    const waitMs = hasExplicitDelay
        ? Math.max(0, Number(delayMs) || 0)
        : Math.max(0, interval - elapsed);

    queueNamedTimer(collab, 'cursorSyncTimer', () => {
        flushPointCursorPresence().catch(() => {});
    }, waitMs);
    return true;
}

export function updatePointLiveCursor(worldX, worldY) {
    const nextX = clampPointCursorCoord(worldX, collab.cursorWorldX || 0);
    const nextY = clampPointCursorCoord(worldY, collab.cursorWorldY || 0);
    const changed = !collab.cursorVisible
        || Math.abs(nextX - Number(collab.cursorWorldX || 0)) > 0.01
        || Math.abs(nextY - Number(collab.cursorWorldY || 0)) > 0.01;

    collab.cursorVisible = true;
    collab.cursorWorldX = nextX;
    collab.cursorWorldY = nextY;

    if (changed) {
        schedulePointCursorPresenceSync();
    }
}

export function clearPointLiveCursor(options = {}) {
    const hadVisible = Boolean(collab.cursorVisible);
    collab.cursorVisible = false;
    if (options.resetPosition) {
        collab.cursorWorldX = 0;
        collab.cursorWorldY = 0;
    }
    if (hadVisible && options.broadcast !== false) {
        schedulePointCursorPresenceSync(0);
    }
}

function presenceListsEqual(left = [], right = []) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (!b) return false;
        if (
            String(a.userId || '') !== String(b.userId || '') ||
            String(a.username || '') !== String(b.username || '') ||
            String(a.role || '') !== String(b.role || '') ||
            String(a.activeNodeId || '') !== String(b.activeNodeId || '') ||
            String(a.activeNodeName || '') !== String(b.activeNodeName || '') ||
            String(a.activeTextKey || '') !== String(b.activeTextKey || '') ||
            String(a.activeTextLabel || '') !== String(b.activeTextLabel || '') ||
            String(a.mode || '') !== String(b.mode || '') ||
            Boolean(a.cursorVisible) !== Boolean(b.cursorVisible) ||
            Number(a.cursorWorldX || 0) !== Number(b.cursorWorldX || 0) ||
            Number(a.cursorWorldY || 0) !== Number(b.cursorWorldY || 0) ||
            Boolean(a.isSelf) !== Boolean(b.isSelf)
        ) {
            return false;
        }
    }
    return true;
}

function updateCollabPresence(rawPresence = []) {
    const deduped = new Map();
    (Array.isArray(rawPresence) ? rawPresence : []).forEach((row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return;
        const cursor = normalizePointCursorPresence(row);
        deduped.set(userId, {
            userId,
            username: String(row?.username || 'operateur'),
            role: String(row?.role || ''),
            activeNodeId: String(row?.activeNodeId || ''),
            activeNodeName: String(row?.activeNodeName || ''),
            activeTextKey: String(row?.activeTextKey || ''),
            activeTextLabel: String(row?.activeTextLabel || ''),
            mode: String(row?.mode || 'editing'),
            cursorVisible: cursor.cursorVisible,
            cursorWorldX: cursor.cursorWorldX,
            cursorWorldY: cursor.cursorWorldY,
            lastAt: String(row?.lastAt || ''),
            isSelf: userId === String(collab.user?.id || '')
        });
    });
    const nextPresence = [...deduped.values()].sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        return String(a.username || '').localeCompare(String(b.username || ''));
    });
    if (presenceListsEqual(collab.presence, nextPresence)) return;
    collab.presence = nextPresence;
    setPointRemoteCursors(nextPresence);
    syncCloudStatus();
    syncPointRealtimeAwarenessDecorations();
    scheduleDraw();
}

function renderCloudPresenceChips(entries = [], options = {}) {
    const includeSelf = Boolean(options.includeSelf);
    const visible = entries.filter((entry) => includeSelf || !entry.isSelf).slice(0, 4);
    if (!visible.length) return '';
    return visible.map((entry) => {
        const initials = String(entry.username || '?').slice(0, 2).toUpperCase();
        const label = entry.isSelf ? 'toi' : entry.username;
        const detail = entry.activeTextLabel
            ? `${entry.activeNodeName ? `${entry.activeNodeName} · ` : ''}${entry.activeTextLabel}`
            : (entry.activeNodeName ? `Fiche ${entry.activeNodeName}` : (entry.mode === 'viewing' ? 'Lecture' : 'Edition'));
        return `
            <div class="cloud-presence-pill${entry.isSelf ? ' is-self' : ''}">
                <span class="cloud-presence-avatar">${escapeHtml(initials)}</span>
                <span class="cloud-presence-copy">
                    <span class="cloud-presence-name">${escapeHtml(label)}</span>
                    <span class="cloud-presence-detail">${escapeHtml(detail)}</span>
                </span>
            </div>
        `;
    }).join('');
}

function syncCloudLivePanels() {
    const liveInfoEl = document.getElementById('cloudLiveInfo');
    const syncInfoEl = document.getElementById('cloudSyncInfo');
    const presenceEl = document.getElementById('cloudPresence');
    const modalSyncEl = document.getElementById('cloudModalSyncInfo');
    const modalPresenceEl = document.getElementById('cloudModalPresence');
    const showLiveInfo = Boolean(collab.user && isCloudBoardActive());
    const otherUsers = collab.presence.filter((entry) => !entry.isSelf);
    const presenceLabel = otherUsers.length
        ? `${otherUsers.length} operateur${otherUsers.length > 1 ? 's' : ''} actif${otherUsers.length > 1 ? 's' : ''}`
        : (isCloudBoardActive() ? 'Aucun autre operateur detecte' : '');

    if (liveInfoEl) {
        liveInfoEl.hidden = !showLiveInfo;
    }
    if (syncInfoEl) {
        syncInfoEl.textContent = collab.syncLabel || 'Cloud';
        syncInfoEl.dataset.state = collab.syncState || 'idle';
    }
    if (presenceEl) {
        presenceEl.innerHTML = showLiveInfo
            ? (renderCloudPresenceChips(collab.presence, { includeSelf: false }) || `<div class="cloud-presence-empty">${escapeHtml(presenceLabel || 'Board prive')}</div>`)
            : '';
    }
    if (modalSyncEl) {
        modalSyncEl.textContent = collab.syncLabel || 'Cloud';
        modalSyncEl.className = isCloudBoardActive() ? 'cloud-status-active' : '';
        modalSyncEl.dataset.state = collab.syncState || 'idle';
    }
    if (modalPresenceEl) {
        modalPresenceEl.innerHTML = isCloudBoardActive()
            ? (renderCloudPresenceChips(collab.presence, { includeSelf: true }) || `<div class="cloud-presence-empty">${escapeHtml(presenceLabel || 'Board prive')}</div>`)
            : `<div class="cloud-presence-empty">Mode local</div>`;
    }
}

function applyCloudBoardData(rawData, options = {}) {
    const quiet = Boolean(options.quiet);
    const plain = extractPlainPointPayloadFromCloud(rawData);
    const incomingSummary = getPointPayloadSummary(plain);
    const localSummary = getPointPayloadSummary();
    const serverFingerprint = fingerprintFromPointPayload(plain);
    const localFingerprint = hasLocalCloudChanges()
        ? fingerprintFromPointPayload(generateExportData())
        : String(collab.lastSavedFingerprint || '');
    const shouldReloadLocalState = serverFingerprint !== localFingerprint;

    pointDebugLogger.log('apply-cloud-board-data', getPointDiagState({
        quiet,
        projectName: String(options.projectName || ''),
        shouldReloadLocalState,
        incoming: incomingSummary,
        localBefore: localSummary,
        serverFingerprint: serverFingerprint.slice(0, 18),
        localFingerprint: String(localFingerprint || '').slice(0, 18)
    }));
    if (incomingSummary.unnamedNodes > 0) {
        pointDebugLogger.warn('apply-cloud-board-data-unnamed-nodes', getPointDiagState({
            incoming: incomingSummary
        }));
    }

    if (shouldReloadLocalState) {
        withoutCloudAutosave(() => processData(plain, 'load', { silent: true }));
    }
    setCloudShadowData(rawData);
    if (typeof options.projectName === 'string') {
        state.projectName = options.projectName;
    }
    captureCloudSavedState(collab.localChangeSeq, serverFingerprint);
    if (shouldReloadLocalState) {
        if (state.selection && !nodeById(state.selection)) state.selection = null;
        renderEditor();
        updatePathfindingPanel();
        refreshHvt();
        draw();
    }
    if (!quiet) {
        appendActionLog('sync live: board mis a jour');
    }
}

function fingerprintFromPointPayload(payload) {
    return JSON.stringify(canonicalizePointPayloadForCompare(payload));
}

function captureCloudSavedState(changeSeq = collab.localChangeSeq, fingerprint = collab.lastSavedFingerprint || '') {
    const targetSeq = Math.max(0, Number(changeSeq) || 0);
    collab.lastSavedFingerprint = String(fingerprint || '');
    collab.lastSavedChangeSeq = Math.max(
        collab.lastSavedChangeSeq,
        Math.min(collab.localChangeSeq, targetSeq)
    );
    return collab.lastSavedChangeSeq;
}

function hasLocalCloudChanges() {
    if (!isCloudBoardActive()) return false;
    return collab.localChangeSeq !== collab.lastSavedChangeSeq;
}

function stopCollabRealtime() {
    stopCollabRealtimeText();
    clearPointCursorSyncTimer();
    if (!collab.realtimeSession) return;
    try {
        collab.realtimeSession.stop('switch-sync-mode');
    } catch (e) {}
    collab.realtimeSession = null;
    collab.realtimeFallbackActive = false;
    if (state.selection) {
        renderEditor();
    }
}

function stopCollabRealtimeText() {
    if (!(collab.realtimeTextBindings instanceof Map) || !collab.realtimeTextBindings.size) {
        clearRealtimeFieldPresence({ notify: false });
        return;
    }
    [...collab.realtimeTextBindings.values()].forEach((binding) => {
        try {
            binding.stop();
        } catch (e) {}
    });
    collab.realtimeTextBindings.clear();
    clearRealtimeFieldPresence({ notify: false });
}

function setPointRealtimeFieldValue(nodeId, fieldName, nextValue, options = {}) {
    const node = nodeById(nodeId);
    if (!node) return false;
    const textValue = String(nextValue || '');
    const field = String(fieldName || '').trim();

    if (field === 'description') {
        if (String(node.description || '') === textValue && String(node.notes || '') === textValue) {
            return false;
        }
        node.description = textValue;
        node.notes = textValue;
    } else if (field === 'name') {
        const previousName = String(node.name || '').trim();
        const cleanName = textValue.replace(/\s+/g, ' ').trim();
        if (String(node.name || '') === cleanName) return false;
        if (previousName && !cleanName && isCloudBoardActive()) {
            pointDebugLogger.warn('realtime-name-became-empty', getPointDiagState({
                nodeId: shortDiagId(nodeId),
                previousName,
                origin: options.local ? 'local' : 'remote',
                realtimeActive: isRealtimeCloudActive()
            }));
        }
        node.name = cleanName;
        const headName = document.querySelector('.editor-sheet-name');
        if (headName) headName.textContent = cleanName || 'Sans nom';
        refreshLists();
        updatePathfindingPanel();
        draw();
    } else {
        if (String(node[field] || '') === textValue) {
            return false;
        }
        node[field] = textValue;
    }

    if (options.local) {
        withoutCloudAutosave(() => saveState());
    }
    syncPointRealtimeAwarenessDecorations(nodeId);
    return true;
}

function ensurePointRealtimeTextBinding(nodeId, fieldName) {
    const field = String(fieldName || '').trim();
    const config = POINT_REALTIME_TEXT_FIELDS[field];
    const textKey = getPointRealtimeTextKey(nodeId, field);
    if (!config || !textKey || !isRealtimeCloudActive()) return null;
    if (collab.realtimeTextBindings.has(textKey)) {
        return collab.realtimeTextBindings.get(textKey);
    }

    const initialNode = nodeById(nodeId);
    const initialValue = field === 'description'
        ? String(initialNode?.description || initialNode?.notes || '')
        : String(initialNode?.[field] || '');
    const binding = realtimeTextTools.createTextFieldYBinding({
        key: textKey,
        initialValue,
        canEdit: () => isRealtimeCloudActive() && canEditCloudBoard(),
        onSendUpdate: (key, update) => {
            if (!collab.realtimeSession) return false;
            return collab.realtimeSession.roomClient.sendTextUpdate(key, update);
        },
        onValueChange: (nextValue, meta = {}) => {
            setPointRealtimeFieldValue(nodeId, field, nextValue, {
                local: meta.origin !== 'remote'
            });
        },
        onFocusChange: (meta = {}) => {
            if (meta.active) {
                setRealtimeFieldPresence(textKey, config.label);
                return;
            }
            if (collab.activeTextKey === textKey) {
                clearRealtimeFieldPresence({ notify: true });
            }
        }
    });

    collab.realtimeTextBindings.set(textKey, binding);
    collab.realtimeSession.roomClient.subscribeText(textKey);
    return binding;
}

function handleCollabRealtimeTextUpdate(payload = {}) {
    const textKey = String(payload.key || '').trim();
    if (!textKey) return;
    const binding = collab.realtimeTextBindings.get(textKey);
    if (!binding) return;
    binding.applyRemoteUpdate(payload.update || '', {
        full: Boolean(payload.full)
    });
    syncPointRealtimeAwarenessDecorations();
}

export function bindRealtimePointField(node, fieldName, field) {
    if (!node || !field || !isRealtimeCloudActive()) return false;
    const binding = ensurePointRealtimeTextBinding(node.id, fieldName);
    if (!binding) return false;
    binding.attachField(field);
    syncPointRealtimeAwarenessDecorations(node.id);
    return true;
}

export function bindRealtimeDescriptionField(node, textarea) {
    return bindRealtimePointField(node, 'description', textarea);
}

export function unbindRealtimeDescriptionField() {
    stopCollabRealtimeText();
}

export function unbindRealtimePointFields() {
    stopCollabRealtimeText();
}

function startCheckpointCloudTransport(options = {}) {
    stopCollabRealtime();
    collab.realtimeFallbackActive = true;
    startCollabAutosave();
    startCollabLiveSync();
    startCollabPresence();
    if (!collab.saveInFlight && !hasLocalCloudChanges()) {
        setCloudSyncState(
            'session',
            String(options.label || (canEditCloudBoard()
                ? 'Mode degrade: checkpoint actif'
                : 'Lecture cloud degradee'))
        );
    }
}

async function activateCloudTransport() {
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    pointDebugLogger.log('activate-cloud-transport', getPointDiagState({
        shouldUseRealtime: shouldUseRealtimeCloud()
    }));
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        stopCollabRealtime();
        return false;
    }

    if (!shouldUseRealtimeCloud()) {
        pointDebugLogger.warn('activate-cloud-transport-legacy', getPointDiagState({
            reason: 'realtime-disabled'
        }));
        startCheckpointCloudTransport({
            label: canEditCloudBoard()
                ? 'Cloud sans temps reel'
                : 'Lecture cloud sans temps reel'
        });
        return false;
    }

    try {
        const started = await startCollabRealtime();
        if (started) return true;
    } catch (e) {
        pointDebugLogger.error('activate-cloud-transport-error', getPointDiagState({
            message: e?.message || 'Erreur realtime'
        }));
        appendActionLog(`cloud: fallback legacy (${sanitizeLogText(e?.message, 'temps reel indisponible')})`);
    }

    pointDebugLogger.warn('activate-cloud-transport-fallback', getPointDiagState({
        reason: 'realtime-start-failed'
    }));
    startCheckpointCloudTransport();
    setCloudSyncState('session', 'Fallback checkpoint actif');
    return false;
}

async function startCollabRealtime() {
    if (!shouldUseRealtimeCloud()) return false;
    ensureCollabAutosaveListener();
    stopCollabRealtime();
    await preloadRealtimeTextTools().catch(() => null);
    pointDebugLogger.log('realtime-start-request', getPointDiagState({
        localFlushMs: 120,
        presenceHeartbeatMs: 12000,
        snapshotRefreshMs: 120000
    }));

    const session = await createRealtimeBoardSession({
        page: 'point',
        boardId: collab.activeBoardId,
        collabToken: collab.token,
        getCurrentSnapshot: () => generateExportData(),
        canonicalizeSnapshot: canonicalizePointPayload,
        diffOps: diffPointOpsWithoutRealtimeText,
        applyOps: applyPointOps,
        applySnapshot: (snapshot, meta = {}) => {
            applyCloudBoardData(snapshot, {
                quiet: true,
                projectName: collab.activeBoardTitle,
                ...(meta || {})
            });
        },
        onPresence: (presence) => updateCollabPresence(presence || []),
        onStatus: (status, detail = '') => {
            pointDebugLogger.log('realtime-status', getPointDiagState({
                status,
                detail: String(detail || '')
            }));
            if (status === 'connected') {
                setCloudSyncState('live', 'Temps reel actif');
            } else if (status === 'connecting') {
                setCloudSyncState('syncing', 'Connexion temps reel...');
            }
        },
        onError: (error) => {
            pointDebugLogger.error('realtime-error', getPointDiagState({
                message: error?.message || 'Erreur temps reel'
            }));
            setCloudSyncState('error', error?.message || 'Erreur temps reel');
        },
        onTextUpdate: (payload) => {
            handleCollabRealtimeTextUpdate(payload || {});
        },
        presenceHeartbeatMs: 12000,
        snapshotRefreshMs: 120000,
        reconnectBaseMs: 1500,
        reconnectMaxMs: 20000,
        onClose: (meta = {}) => {
            pointDebugLogger.warn('realtime-close', getPointDiagState({
                code: Number(meta?.code || 0),
                reason: String(meta?.reason || ''),
                intentional: Boolean(meta?.intentional),
                wasConnected: Boolean(meta?.wasConnected)
            }));
            if (collab.realtimeSession === session) {
                collab.realtimeSession = null;
            }
            stopCollabRealtimeText();
            if (!meta.intentional && isCloudBoardActive()) {
                collab.realtimeFallbackActive = true;
                startCheckpointCloudTransport();
                setCloudSyncState('session', 'Fallback checkpoint actif');
            }
            if (state.selection) {
                renderEditor();
            }
        },
        onLocalAccepted: ({ ops = [], snapshot = null } = {}) => {
            pointDebugLogger.log('realtime-local-accepted', getPointDiagState({
                opCount: Array.isArray(ops) ? ops.length : 0,
                shadow: snapshot ? getPointPayloadSummary(snapshot) : null
            }));
            const currentSnapshot = generateExportData();
            setCloudShadowData(buildCloudBoardPayload(currentSnapshot));
            captureCloudSavedState(collab.localChangeSeq, fingerprintFromPointPayload(currentSnapshot));
            setCloudSyncState('live', 'Temps reel actif');
        },
        localFlushMs: 120,
        buildPresence: (extra = {}) => buildPointPresencePayload(extra),
        debug: pointDebugLogger
    });

    collab.realtimeSession = session;
    collab.realtimeFallbackActive = false;
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    session.updatePresence();
    if (state.selection) {
        renderEditor();
    }
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
    setCloudSyncState('pending');
    queueNamedTimer(collab, 'autosaveDebounceTimer', () => {
        saveActiveCloudBoard({ manual: false, quiet: true }).catch(() => {});
    }, delayMs);
}

function onPointLocalChange() {
    if (collab.suppressAutosave > 0) return;
    collab.localChangeSeq += 1;
    if (!isCloudBoardActive()) {
        rememberCurrentLocalWorkspace();
    }
    if (isRealtimeCloudActive()) {
        queueCloudAutosave();
        return;
    }
    queueCloudAutosave();
}

function ensureCollabAutosaveListener() {
    if (collab.autosaveListenerBound) return;
    collab.autosaveListenerBound = true;
    window.addEventListener(POINT_LOCAL_CHANGE_EVENT, onPointLocalChange);
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
    clearPointCursorSyncTimer();
    stopRetriableLoop(collab, {
        timerKey: 'presenceTimer',
        tokenKey: 'presenceLoopToken',
        runningKey: 'presenceLoopRunning',
        retryKey: 'presenceRetryMs',
        inFlightKey: 'presenceInFlight'
    });
}

function stopCollabSessionHeartbeat() {
    stopRetriableLoop(collab, {
        timerKey: 'sessionTimer',
        tokenKey: 'sessionLoopToken',
        runningKey: 'sessionLoopRunning',
        retryKey: 'sessionRetryMs',
        inFlightKey: 'sessionInFlight'
    });
}

function scheduleNextSessionHeartbeat(loopToken, delayMs = COLLAB_SESSION_HEARTBEAT_MS) {
    scheduleRetriableLoop(collab, {
        timerKey: 'sessionTimer',
        tokenKey: 'sessionLoopToken'
    }, loopToken, delayMs, () => {
        runCollabSessionHeartbeat(loopToken).catch(() => {});
    });
}

async function runCollabSessionHeartbeat(loopToken = collab.sessionLoopToken) {
    if (collab.sessionLoopToken !== loopToken) return;
    if (!collab.token || !collab.user) return;
    if (collab.sessionInFlight) return;

    collab.sessionInFlight = true;
    try {
        const res = await collabAuthRequest('me');
        collab.user = res.user || collab.user;
        persistCollabState();
        syncCloudStatus();
        scheduleNextSessionHeartbeat(loopToken, COLLAB_SESSION_HEARTBEAT_MS);
    } catch (e) {
        if (collab.sessionLoopToken !== loopToken) return;
        const status = Number(e?.status || 0);
        if (status === 401 || status === 403) {
            await logoutCollab();
            return;
        }
        scheduleNextSessionHeartbeat(loopToken, COLLAB_SESSION_RETRY_MS);
    } finally {
        collab.sessionInFlight = false;
    }
}

function startCollabSessionHeartbeat() {
    stopCollabSessionHeartbeat();
    if (!collab.token || !collab.user) return;
    const loopToken = collab.sessionLoopToken + 1;
    collab.sessionLoopToken = loopToken;
    scheduleNextSessionHeartbeat(loopToken, 0);
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
    const isRealtime = isRealtimeCloudActive();

    try {
        const sent = await updatePointCloudPresence(options.extra || {});
        if (!isRealtime && (collab.presenceLoopToken === loopToken || options.force)) {
            collab.presenceRetryMs = COLLAB_PRESENCE_RETRY_MS;
            scheduleNextPresenceTick(loopToken, COLLAB_PRESENCE_HEARTBEAT_MS);
        }
        return sent;
    } catch (e) {
        if (!isRealtime && (collab.presenceLoopToken === loopToken || options.force)) {
            const status = Number(e?.status || 0);
            if (status === 401 || status === 403 || status === 404) {
                collab.presenceLoopRunning = false;
                stopCollabPresence();
                updateCollabPresence([]);
                return false;
            }
            collab.presenceRetryMs = collab.presenceRetryMs
                ? Math.min(COLLAB_WATCH_RETRY_MAX_MS, collab.presenceRetryMs * 2)
                : COLLAB_PRESENCE_RETRY_MS;
            scheduleNextPresenceTick(loopToken, collab.presenceRetryMs);
        }
        throw e;
    }
}

function startCollabPresence() {
    stopCollabPresence();
    if (!isCloudBoardActive() || !collab.user || !collab.token) {
        updateCollabPresence([]);
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
        updateCollabPresence(watch?.presence || []);
        if (!collab.saveInFlight && !hasLocalCloudChanges()) {
            setCloudSyncState(canEditCloudBoard() ? 'live' : 'session', canEditCloudBoard() ? 'Synchro live active' : 'Lecture live active');
        }

        if (watch?.deleted || watch?.revoked) {
            setActiveCloudBoardFromSummary(null);
            setBoardQueryParam('');
            appendActionLog('cloud: board indisponible');
            collab.syncLoopRunning = false;
            return;
        }

        if (watch?.changed) {
            const watchedUpdatedAt = String(watch.updatedAt || '');
            if (!watchedUpdatedAt || watchedUpdatedAt !== String(collab.activeBoardUpdatedAt || '')) {
                setCloudSyncState('syncing');
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
            setCloudSyncState('error', 'Connexion live coupee');
            return;
        }

        collab.syncRetryMs = collab.syncRetryMs
            ? Math.min(COLLAB_WATCH_RETRY_MAX_MS, collab.syncRetryMs * 2)
            : COLLAB_WATCH_RETRY_MIN_MS;
        setCloudSyncState('error');
        scheduleNextWatchTick(loopToken, collab.syncRetryMs);
    }
}

async function syncActiveCloudBoard(options = {}) {
    const quiet = Boolean(options.quiet);
    if (isRealtimeCloudActive()) return false;
    if (!isCloudBoardActive() || !collab.user || !collab.token) return false;
    if (collab.syncInFlight) return false;
    if (collab.saveInFlight) return false;

    collab.syncInFlight = true;
    try {
        const result = await collabBoardRequest('get_board', { boardId: collab.activeBoardId });
        if (!result || !result.board || !result.board.data) return false;

        const remoteSummary = {
            id: result.board.id || collab.activeBoardId,
            role: result.role || collab.activeRole,
            title: result.board.title || collab.activeBoardTitle || state.projectName || 'Tableau cloud',
            ownerId: result.board.ownerId || collab.ownerId || '',
            updatedAt: result.board.updatedAt || collab.activeBoardUpdatedAt || ''
        };

        const remoteUpdatedAt = String(remoteSummary.updatedAt || '');
        const localUpdatedAt = String(collab.activeBoardUpdatedAt || '');
        if (!remoteUpdatedAt || remoteUpdatedAt === localUpdatedAt) return false;

        const localChanged = hasLocalCloudChanges();
        updateActiveBoardSummary(remoteSummary);
        updateCollabPresence(result?.presence || []);

        if (localChanged && canEditCloudBoard()) {
            const mergedSaved = await saveActiveCloudBoard({ manual: false, quiet: true, force: true });
            if (mergedSaved) setCloudSyncState('merged');
            return Boolean(mergedSaved);
        }

        applyCloudBoardData(result.board.data, { quiet, projectName: remoteSummary.title });
        setCloudSyncState('live');
        if (!quiet) {
            appendActionLog('sync live: board mis a jour');
        }
        return true;
    } catch (e) {
        setCloudSyncState('error');
        if (!quiet) showCustomAlert(`Erreur sync live: ${escapeHtml(e.message || 'inconnue')}`);
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
    setCloudSyncState(canEditCloudBoard() ? 'live' : 'session', canEditCloudBoard() ? 'Synchro live active' : 'Lecture live active');
    scheduleNextWatchTick(loopToken, 0);
}

async function collabAuthRequest(action, payload = {}) {
    const startedAt = nowDiagMs();
    pointDebugLogger.log('auth-request', {
        action,
        hasToken: Boolean(collab.token),
        username: action === 'me' || action === 'logout'
            ? (collab.user?.username || '')
            : String(payload?.username || '')
    });
    try {
        const result = await sharedCollabAuthRequest(action, payload);
        pointDebugLogger.log('auth-response', {
            action,
            ok: true,
            durationMs: elapsedDiagMs(startedAt),
            ...summarizePointCloudResponse(action, result)
        });
        return result;
    } catch (error) {
        pointDebugLogger.error('auth-response', {
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
    pointDebugLogger.log('board-request', {
        action,
        boardId: shortDiagId(payload?.boardId || collab.activeBoardId),
        hasToken: Boolean(collab.token)
    });
    try {
        const result = await sharedCollabBoardRequest(action, payload);
        pointDebugLogger.log('board-response', {
            action,
            ok: true,
            durationMs: elapsedDiagMs(startedAt),
            ...summarizePointCloudResponse(action, result)
        });
        return result;
    } catch (error) {
        pointDebugLogger.error('board-response', {
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
        clearPointCursorSyncTimer();
        clearPointLiveCursor({ broadcast: false, resetPosition: true });
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
        collab.localChangeSeq = 0;
        collab.lastSavedChangeSeq = 0;
        collab.shadowData = null;
        clearPointRemoteCursors();
        updateCollabPresence([]);
    } else {
        collab.activeBoardId = String(summary.id || '');
        collab.activeRole = String(summary.role || '');
        collab.activeBoardTitle = String(summary.title || '');
        collab.ownerId = String(summary.ownerId || '');
        collab.activeBoardUpdatedAt = String(summary.updatedAt || '');
    }
    if (previousBoardId && previousBoardId !== collab.activeBoardId) {
    }
    applyLocalPersistencePolicy();
    syncCloudStatus();
    persistCollabState();
    if (!isCloudBoardActive()) {
        setCloudSyncState(collab.user ? 'session' : 'local');
    }
}

async function openCloudBoard(boardId, options = {}) {
    const targetId = String(boardId || '').trim();
    if (!targetId) throw new Error('Board cloud invalide.');

    let localWorkspaceRemembered = false;
    if (!isCloudBoardActive()) {
        localWorkspaceRemembered = rememberCurrentLocalWorkspace();
    }
    pointDebugLogger.log('open-cloud-board-start', getPointDiagState({
        targetBoardId: shortDiagId(targetId),
        rememberedLocalWorkspace: localWorkspaceRemembered
    }));

    const result = await collabBoardRequest('get_board', { boardId: targetId });
    if (!result.board || !result.board.data) throw new Error('Board cloud corrompu.');
    if (String(result.board.page || 'point') !== 'point') {
        throw new Error('Ce board appartient au module Carte, pas au mode Reseau.');
    }

    const summary = {
        id: result.board.id,
        role: result.role || 'editor',
        title: result.board.title || state.projectName || 'Tableau cloud',
        ownerId: result.board.ownerId || '',
        updatedAt: result.board.updatedAt || ''
    };

    pointDebugLogger.log('open-cloud-board-data', getPointDiagState({
        targetBoardId: shortDiagId(targetId),
        role: summary.role,
        title: summary.title,
        incoming: getPointPayloadSummary(extractPlainPointPayloadFromCloud(result.board.data))
    }));

    setActiveCloudBoardFromSummary(summary);
    updateCollabPresence(result?.presence || []);
    applyCloudBoardData(result.board.data, { quiet: true, projectName: summary.title });
    setBoardQueryParam(summary.id);
    await activateCloudTransport();
    pointDebugLogger.log('open-cloud-board-ready', getPointDiagState({
        targetBoardId: shortDiagId(targetId),
        presenceCount: Array.isArray(result?.presence) ? result.presence.length : 0
    }));
    setCloudWorkspaceBusy(false);

    if (!options.quiet) {
        showCustomAlert(`☁️ Board cloud ouvert : ${escapeHtml(summary.title)}`);
    }
}

async function saveActiveCloudBoard(options = {}) {
    const manual = Boolean(options.manual);
    const quiet = Boolean(options.quiet);
    const force = Boolean(options.force);

    if (!isCloudBoardActive()) {
        if (manual && !quiet) showCustomAlert("Aucun board cloud actif.");
        return false;
    }
    if (!canEditCloudBoard()) {
        if (manual && !quiet) showCustomAlert("Tu n'as pas les droits d'edition cloud.");
        return false;
    }
    if (isRealtimeCloudActive()) {
        const hadChanges = hasLocalCloudChanges();
        if (!hadChanges) {
            setCloudSyncState('live', 'Temps reel actif');
            if (manual && !quiet) showCustomAlert('☁️ Temps reel deja synchronise.');
            return true;
        }

        setCloudSyncState('syncing', 'Envoi temps reel...');
        const flushed = await collab.realtimeSession.flushLocalChanges();
        if (flushed || !hasLocalCloudChanges()) {
            setCloudSyncState('live', 'Temps reel actif');
            if (manual && !quiet) showCustomAlert('☁️ Synchro temps reel envoyee.');
            return true;
        }

        setCloudSyncState('pending', 'Connexion temps reel en cours');
        if (manual && !quiet) showCustomAlert('Connexion temps reel en cours. Les modifs restent locales pour le moment.');
        return false;
    }
    if (collab.saveInFlight) {
        if (!manual) queueCloudAutosave(COLLAB_AUTOSAVE_RETRY_MS);
        return false;
    }
    if (!force && !manual && !hasLocalCloudChanges()) {
        setCloudSyncState(canEditCloudBoard() ? 'live' : 'session', canEditCloudBoard() ? 'Synchronise' : 'Lecture live active');
        return true;
    }

    collab.saveInFlight = true;
    setCloudSyncState('saving');
    try {
        const title = (state.projectName || collab.activeBoardTitle || 'Tableau cloud').trim();
        const plainData = generateExportData();
        const localFingerprint = fingerprintFromPointPayload(plainData);
        if (!force && !manual && localFingerprint === String(collab.lastSavedFingerprint || '')) {
            captureCloudSavedState(collab.localChangeSeq, localFingerprint);
            setCloudSyncState(canEditCloudBoard() ? 'live' : 'session', canEditCloudBoard() ? 'Synchronise' : 'Lecture live active');
            return true;
        }

        const data = buildCloudBoardPayload(plainData);
        const savedChangeSeq = collab.localChangeSeq;
        const result = await collabBoardRequest('save_board', {
            boardId: collab.activeBoardId,
            title,
            data,
            ...(collab.activeBoardUpdatedAt ? { expectedUpdatedAt: collab.activeBoardUpdatedAt } : {})
        });
        if (result && result.board) {
            collab.activeBoardTitle = result.board.title || title;
            collab.activeBoardUpdatedAt = String(result.board.updatedAt || collab.activeBoardUpdatedAt || '');
            state.projectName = collab.activeBoardTitle;
            persistCollabState();
            updateCollabPresence(result?.presence || []);
            if (result.board.data) {
                setCloudShadowData(result.board.data);
                const serverPlain = extractPlainPointPayloadFromCloud(result.board.data);
                const serverFingerprint = fingerprintFromPointPayload(serverPlain);
                const shouldApplyServerData = serverFingerprint !== localFingerprint;
                if (shouldApplyServerData) {
                    applyCloudBoardData(result.board.data, { quiet: true, projectName: collab.activeBoardTitle });
                } else {
                    captureCloudSavedState(savedChangeSeq, serverFingerprint);
                }
            } else {
                captureCloudSavedState(savedChangeSeq, localFingerprint);
            }
        }
        setCloudSyncState(result?.mergedConflict ? 'merged' : 'live', result?.mergedConflict ? 'Fusion auto appliquee' : 'Synchronise');
        if (manual && !quiet) showCustomAlert("☁️ Board cloud sauvegarde.");
        return true;
    } catch (e) {
        setCloudSyncState('error');
        if (!quiet) showCustomAlert(`Erreur cloud: ${escapeHtml(e.message || 'inconnue')}`);
        return false;
    } finally {
        collab.saveInFlight = false;
        if (!manual && hasLocalCloudChanges()) {
            queueCloudAutosave(COLLAB_AUTOSAVE_RETRY_MS);
        }
    }
}

async function createCloudBoardFromCurrent() {
    showCloudCreateBoardDialog();
}

async function logoutCollab(options = {}) {
    const shouldResetWorkspace = options.resetWorkspace !== false;
    const hadActiveBoard = Boolean(collab.activeBoardId);

    await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
    stopCollabRealtime();
    stopCollabAutosave();
    stopCollabLiveSync();
    stopCollabPresence();
    try {
        if (collab.token) await collabAuthRequest('logout');
    } catch (e) {}

    collab.token = '';
    collab.user = null;
    setActiveCloudBoardFromSummary(null);
    clearCollabStorage();
    stopCollabSessionHeartbeat();
    setLocalPersistenceEnabled(true);
    setBoardQueryParam('');
    setCloudSyncState('local');
    collab.homePanel = 'local';

    if (shouldResetWorkspace && hadActiveBoard) {
        restoreLastLocalWorkspace({ fallbackClear: true });
    }
}

async function renderCloudMembers(boardId) {
    if (!modalOverlay) createModal();
    setModalMode('cloud');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = `
        <div class="modal-tool cloud-manage-shell cloud-manage-loading">
            <div class="cloud-board-manage-head">
                <div>
                    <h3 class="modal-tool-title">Gestion du board</h3>
                    <div class="modal-note">Chargement des acces et des membres...</div>
                </div>
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
    `;
    actEl.innerHTML = `
        <button type="button" id="cloud-members-back">Retour</button>
    `;
    const preBackBtn = document.getElementById('cloud-members-back');
    if (preBackBtn) {
        bindImmediateActionButton(preBackBtn, async () => {
            renderCloudHomeLoading('cloud', 'Retour au tableau cloud...');
            await renderCloudHome();
        });
    }

    await flushPendingCloudAutosave(boardId).catch(() => {});

    let result;
    try {
        result = await collabBoardRequest('get_board', { boardId });
    } catch (e) {
        showCustomAlert(`Erreur cloud: ${escapeHtml(e.message || 'inconnue')}`);
        return;
    }

    if (!result || !result.board) return;
    const board = result.board;
    const resolvedRole = String(result.role || board.role || collab.activeRole || '').trim();
    if (resolvedRole !== 'owner') {
        showCustomAlert('Seul le lead peut gerer les membres.');
        return;
    }

    const members = Array.isArray(board.members) ? board.members : [];
    const onlineUsers = new Set(Array.isArray(result.onlineUsers) ? result.onlineUsers.map((id) => String(id)) : []);
    const presenceByUser = new Map(
        (Array.isArray(result.presence) ? result.presence : []).map((entry) => [String(entry.userId || ''), entry])
    );
    const shareUrl = `${window.location.origin}${window.location.pathname}?board=${encodeURIComponent(board.id)}`;

    const membersHtml = members.map((m) => {
        const isOwner = m.role === 'owner';
        const presence = presenceByUser.get(String(m.userId || ''));
        const isOnline = onlineUsers.has(String(m.userId || ''));
        const statusLabel = presence
            ? (presence.activeNodeName ? `En ligne · ${presence.activeNodeName}` : 'En ligne sur ce board')
            : (isOnline ? 'En ligne sur le site' : 'Hors ligne');
        return `
            <div class="cloud-member-row">
                <div class="cloud-row-main">
                    <div class="cloud-row-title">${escapeHtml(m.username)}</div>
                    <div class="cloud-row-sub">${escapeHtml(m.role || 'editor')}</div>
                    <div class="cloud-member-status ${isOnline ? 'is-online' : 'is-offline'}">${escapeHtml(statusLabel)}</div>
                </div>
                <div class="cloud-row-actions">
                    ${isOwner ? '' : `<button type="button" class="mini-btn cloud-remove-member" data-user="${escapeHtml(m.userId)}">Retirer</button>`}
                    ${isOwner ? '' : `<button type="button" class="mini-btn cloud-transfer-member" data-user="${escapeHtml(m.userId)}">Donner lead</button>`}
                </div>
            </div>
        `;
    }).join('');

    msgEl.innerHTML = `
        <div class="modal-tool cloud-manage-shell">
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
                    <input id="cloud-share-username" type="text" placeholder="username" class="modal-input-standalone" autocomplete="off" spellcheck="false" />
                    <div id="cloud-share-username-results" class="editor-autocomplete-results" hidden></div>
                </div>
                <select id="cloud-share-role" class="compact-select cloud-inline-select">
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
            ${String(result.role || board.role || '') === 'owner' ? `
                <div class="cloud-manage-footer">
                    <button type="button" id="cloud-manage-export" class="mini-btn">Sauvegarder</button>
                    <button type="button" id="cloud-manage-merge" class="mini-btn primary">Fusionner</button>
                </div>
            ` : ''}
        </div>
    `;

    actEl.innerHTML = `
        <button type="button" id="cloud-members-back">Retour</button>
    `;

    document.getElementById('cloud-rename-board').onclick = async () => {
        const defaultTitle = String(board.title || 'Board cloud');
        const nextTitleRaw = await new Promise((resolve) => {
            showCustomPrompt(
                'Renommer le board',
                defaultTitle,
                (value) => resolve(value),
                () => resolve(null)
            );
        });
        if (nextTitleRaw === null) return;

        const nextTitle = String(nextTitleRaw || '').trim();
        if (!nextTitle || nextTitle === defaultTitle) return;

        try {
            await collabBoardRequest('rename_board', { boardId, title: nextTitle });
            if (String(collab.activeBoardId) === String(boardId)) {
                collab.activeBoardTitle = nextTitle;
                state.projectName = nextTitle;
                persistCollabState();
                syncCloudStatus();
            }
            await renderCloudMembers(boardId);
        } catch (e) {
            showCustomAlert(`Erreur renommage: ${escapeHtml(e.message || 'inconnue')}`);
        }
    };

    document.getElementById('cloud-delete-board').onclick = () => {
        showCustomConfirm('Supprimer ce board cloud ?', async () => {
            try {
                await collabBoardRequest('delete_board', { boardId });
                if (String(boardId) === String(collab.activeBoardId)) {
                    setActiveCloudBoardFromSummary(null);
                    setBoardQueryParam('');
                }
                await renderCloudHome();
            } catch (e) {
                showCustomAlert(`Erreur suppression: ${escapeHtml(e.message || 'inconnue')}`);
            }
        });
    };

    document.getElementById('cloud-share-add').onclick = async () => {
        const usernameInput = document.getElementById('cloud-share-username');
        const roleInput = document.getElementById('cloud-share-role');
        const username = usernameInput ? usernameInput.value.trim() : '';
        const role = roleInput ? roleInput.value : 'editor';
        if (!username) {
            showCustomAlert('Entre un username.');
            return;
        }
        try {
            await collabBoardRequest('share_board', { boardId, username, role });
            await renderCloudMembers(boardId);
        } catch (e) {
            showCustomAlert(`Erreur partage: ${escapeHtml(e.message || 'inconnue')}`);
        }
    };
    bindCloudMemberAutocomplete(boardId, members);


    const exportBtn = document.getElementById('cloud-manage-export');
    if (exportBtn) {
        exportBtn.onclick = () => {
            showCloudBoardExportDialog(board.title || 'Board cloud', board.data || { nodes: [], links: [], meta: {}, physicsSettings: {} });
        };
    }

    const mergeBtn = document.getElementById('cloud-manage-merge');
    if (mergeBtn) {
        mergeBtn.onclick = () => {
            promptCloudMergeFromFile(boardId, board.title || 'Board cloud', board.data || { nodes: [], links: [], meta: {}, physicsSettings: {} }, board.updatedAt || '');
        };
    }

    Array.from(document.querySelectorAll('.cloud-remove-member')).forEach((btn) => {
        btn.onclick = async () => {
            const userId = btn.getAttribute('data-user') || '';
            if (!userId) return;
            showCustomConfirm('Retirer ce membre ?', async () => {
                try {
                    await collabBoardRequest('remove_member', { boardId, userId });
                    await renderCloudMembers(boardId);
                } catch (e) {
                    showCustomAlert(`Erreur retrait: ${escapeHtml(e.message || 'inconnue')}`);
                }
            });
        };
    });

    Array.from(document.querySelectorAll('.cloud-transfer-member')).forEach((btn) => {
        btn.onclick = async () => {
            const userId = btn.getAttribute('data-user') || '';
            if (!userId) return;
            showCustomConfirm('Transferer le lead a ce membre ?', async () => {
                try {
                    await collabBoardRequest('transfer_board', { boardId, userId });
                    await openCloudBoard(boardId, { quiet: true });
                    await renderCloudHome();
                } catch (e) {
                    showCustomAlert(`Erreur transfert: ${escapeHtml(e.message || 'inconnue')}`);
                }
            });
        };
    });

    document.getElementById('cloud-copy-link').onclick = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            showCustomAlert('Lien copie.');
        } catch (e) {
            showCustomAlert('Impossible de copier le lien.');
        }
    };
    const backBtn = document.getElementById('cloud-members-back');
    if (backBtn) {
        bindImmediateActionButton(backBtn, async () => {
            renderCloudHomeLoading('cloud', 'Retour au tableau cloud...');
            await renderCloudHome();
        });
    }
}

function buildCloudLocalChoiceShell({
    id,
    title,
    description,
    fileAction,
    fileHint,
    textAction,
    textHint,
    disabled = false
}) {
    const disabledClass = disabled ? ' is-disabled-visual' : '';
    return `
        <div class="cloud-local-action-shell" data-local-shell="${id}">
            <button
                type="button"
                class="cloud-local-action-card data-hub-card data-hub-card-local${disabledClass}"
                data-local-toggle="${id}"
                aria-expanded="false"
                aria-controls="cloud-local-choices-${id}"
            >
                <span class="data-hub-card-title">${title}</span>
                <span class="data-hub-card-meta">${description}</span>
            </button>
            <div id="cloud-local-choices-${id}" class="cloud-local-choice-grid" data-local-choices="${id}" hidden>
                <button type="button" class="cloud-local-choice${disabledClass}" data-local-action="${fileAction}">
                    <span class="cloud-local-choice-title">Fichier local</span>
                    <span class="cloud-local-choice-meta">${fileHint}</span>
                </button>
                <button type="button" class="cloud-local-choice${disabledClass}" data-local-action="${textAction}">
                    <span class="cloud-local-choice-title">Texte brut</span>
                    <span class="cloud-local-choice-meta">${textHint}</span>
                </button>
            </div>
        </div>
    `;
}

function buildCloudLocalPanelMarkup(localSaveLocked) {
    if (isCloudBoardActive()) {
        return `
            <div class="cloud-board-row cloud-board-row-local is-active">
                <div class="cloud-row-main">
                    <div class="cloud-row-title">${escapeHtml(collab.activeBoardTitle || 'Cloud actif')}</div>
                    <div class="cloud-row-sub">cloud · point</div>
                </div>
                <button type="button" class="cloud-local-badge cloud-local-disconnect-btn" data-local-action="disconnect-board">Se déconnecter</button>
            </div>
            <div class="cloud-local-panel">
                <div class="cloud-local-connected-note">vous êtes actuellement actuellement connecté au cloud</div>
                <div class="cloud-local-session-grid">
                    <button type="button" class="data-hub-card" data-local-action="new-local-session">
                        <span class="data-hub-card-title">Nouvelle session local</span>
                        <span class="data-hub-card-meta">Déconnecte le cloud actif et remet la carte à zéro</span>
                    </button>
                    ${buildCloudLocalChoiceShell({
                        id: 'local-open-session',
                        title: 'Ouvrir session local',
                        description: 'Déconnecte le cloud puis ouvre un fichier local ou un texte brut',
                        fileAction: 'disconnect-open-file',
                        fileHint: 'JSON',
                        textAction: 'disconnect-open-text',
                        textHint: 'Coller le JSON'
                    })}
                </div>
            </div>
        `;
    }

    return `
        <div class="cloud-board-row cloud-board-row-local is-active">
            <div class="cloud-row-main">
                <div class="cloud-row-title">${escapeHtml(state.projectName || 'Session locale')}</div>
                <div class="cloud-row-sub">local · point</div>
            </div>
            <div class="cloud-local-badge">Actions locales</div>
        </div>
        <div class="cloud-local-panel">
            ${localSaveLocked ? '<div class="cloud-local-note">Mode partage: les exports locaux sont bloques pour les membres non lead.</div>' : ''}
            <div class="cloud-local-action-grid">
                ${buildCloudLocalChoiceShell({
                    id: 'open',
                    title: 'Ouvrir',
                    description: 'Importer un fichier JSON ou un texte brut',
                    fileAction: 'open-file',
                    fileHint: 'JSON',
                    textAction: 'open-text',
                    textHint: 'Coller le JSON'
                })}
                ${buildCloudLocalChoiceShell({
                    id: 'save',
                    title: 'Sauvegarder',
                    description: 'Exporter en fichier local ou en texte brut',
                    fileAction: 'save-file',
                    fileHint: 'JSON',
                    textAction: 'save-text',
                    textHint: 'Copier le JSON',
                    disabled: localSaveLocked
                })}
                ${buildCloudLocalChoiceShell({
                    id: 'merge',
                    title: 'Fusionner',
                    description: 'Regrouper deux JSON ou deux textes bruts',
                    fileAction: 'merge-file',
                    fileHint: 'JSON',
                    textAction: 'merge-text',
                    textHint: 'Coller le JSON'
                })}
                <button type="button" class="data-hub-card data-hub-card-danger" data-local-action="reset-all">
                    <span class="data-hub-card-title">Reset</span>
                </button>
            </div>
        </div>
    `;
}

function bindCloudLocalActions(localSaveLocked) {
    const runLockedLocalAction = () => {
        showCustomAlert('Export local interdit pour les membres partages.');
    };

    const toggleButtons = Array.from(document.querySelectorAll('[data-local-toggle]'));
    const choicePanels = Array.from(document.querySelectorAll('[data-local-choices]'));
    const actionShells = Array.from(document.querySelectorAll('[data-local-shell]'));

    const setOpenToggle = (targetId = '') => {
        const safeTargetId = String(targetId || '');
        toggleButtons.forEach((btn) => {
            const toggleId = String(btn.getAttribute('data-local-toggle') || '');
            const isOpen = safeTargetId && toggleId === safeTargetId;
            btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
        choicePanels.forEach((panel) => {
            const panelId = String(panel.getAttribute('data-local-choices') || '');
            panel.hidden = !(safeTargetId && panelId === safeTargetId);
        });
        actionShells.forEach((shell) => {
            const shellId = String(shell.getAttribute('data-local-shell') || '');
            shell.classList.toggle('is-open', Boolean(safeTargetId) && shellId === safeTargetId);
        });
    };

    toggleButtons.forEach((btn) => {
        btn.onclick = () => {
            const toggleId = String(btn.getAttribute('data-local-toggle') || '');
            const isOpen = btn.getAttribute('aria-expanded') === 'true';
            setOpenToggle(isOpen ? '' : toggleId);
        };
    });

    Array.from(document.querySelectorAll('[data-local-action]')).forEach((btn) => {
        btn.onclick = () => {
            setOpenToggle('');
            const action = btn.getAttribute('data-local-action') || '';

            if (action === 'save-file') {
                if (localSaveLocked) return runLockedLocalAction();
                modalOverlay.style.display = 'none';
                downloadJSON();
                return;
            }
            if (action === 'new-local-session' || action === 'disconnect-board') {
                disconnectCurrentCloudBoard({ renderHome: true, quiet: true }).catch((e) => {
                    showCustomAlert(`Erreur deconnexion cloud: ${escapeHtml(e.message || 'inconnue')}`);
                });
                return;
            }
            if (action === 'save-text') {
                if (localSaveLocked) return runLockedLocalAction();
                const data = generateExportData();
                navigator.clipboard.writeText(JSON.stringify(data, null, 2))
                    .then(() => {
                        modalOverlay.style.display = 'none';
                        showCustomAlert('JSON copie dans le presse-papier.');
                    })
                    .catch(() => showCustomAlert('Erreur copie clipboard'));
                return;
            }
            if (action === 'open-file') {
                const opened = triggerFileInput('fileImport');
                if (opened) {
                    setTimeout(() => { modalOverlay.style.display = 'none'; }, 0);
                }
                return;
            }
            if (action === 'disconnect-open-file') {
                disconnectCurrentCloudBoard({ renderHome: false, quiet: true }).then(() => {
                    const opened = triggerFileInput('fileImport');
                    if (opened) {
                        setTimeout(() => { modalOverlay.style.display = 'none'; }, 0);
                    }
                }).catch((e) => {
                    showCustomAlert(`Erreur deconnexion cloud: ${escapeHtml(e.message || 'inconnue')}`);
                });
                return;
            }
            if (action === 'open-text') {
                showRawDataInput('load');
                return;
            }
            if (action === 'disconnect-open-text') {
                disconnectCurrentCloudBoard({ renderHome: false, quiet: true }).then(() => {
                    showRawDataInput('load');
                }).catch((e) => {
                    showCustomAlert(`Erreur deconnexion cloud: ${escapeHtml(e.message || 'inconnue')}`);
                });
                return;
            }
            if (action === 'merge-file') {
                const opened = triggerFileInput('fileMerge');
                if (opened) {
                    setTimeout(() => { modalOverlay.style.display = 'none'; }, 0);
                }
                return;
            }
            if (action === 'merge-text') {
                showRawDataInput('merge');
                return;
            }
            if (action === 'reset-all') {
                modalOverlay.style.display = 'none';
                resetAllPointData();
            }
        };
    });
}

function bindCloudHomeTabs() {
    const tabCloud = document.getElementById('cloud-home-tab-cloud');
    if (tabCloud) {
        tabCloud.onclick = () => {
            collab.homePanel = 'cloud';
            renderCloudHome().catch(() => {});
        };
    }
    const tabLocal = document.getElementById('cloud-home-tab-local');
    if (tabLocal) {
        tabLocal.onclick = () => {
            collab.homePanel = 'local';
            renderCloudHome().catch(() => {});
        };
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

async function runCloudAuth(action) {
    const userInput = document.getElementById('cloud-auth-user');
    const passInput = document.getElementById('cloud-auth-pass');
    const username = userInput ? userInput.value.trim() : '';
    const password = passInput ? passInput.value : '';
    if (!username || !password) {
        showCustomAlert('Renseigne l identifiant et le mot de passe.');
        return false;
    }
    try {
        const res = await collabAuthRequest(action, { username, password });
        collab.token = String(res.token || '');
        collab.user = res.user || null;
        persistCollabState();
        setCloudSyncState('session', 'Mode local');
        if (collab.pendingBoardId) {
            const targetBoard = collab.pendingBoardId;
            collab.pendingBoardId = '';
            await openCloudBoard(targetBoard, { quiet: true });
        }
        await renderCloudHome();
        return true;
    } catch (e) {
        showCustomAlert(`Erreur: ${escapeHtml(e.message || 'inconnue')}`);
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
    const nextUsernameRaw = nextUsernameInput ? nextUsernameInput.value.trim() : '';
    const currentPassword = currentPassInput ? currentPassInput.value : '';
    const nextPassword = nextPassInput ? nextPassInput.value : '';
    const nextUsername = nextUsernameRaw && nextUsernameRaw !== currentUsername ? nextUsernameRaw : '';

    if (!nextUsername && !nextPassword) {
        showCustomAlert('Ajoute un nouvel identifiant ou un nouveau mot de passe.');
        return false;
    }
    if (!currentPassword) {
        showCustomAlert('Entre ton mot de passe actuel.');
        return false;
    }

    clearCloudProfileFlash();
    try {
        const res = await collabAuthRequest('update_profile', {
            currentPassword,
            nextUsername,
            nextPassword
        });
        collab.user = res.user || collab.user;
        collab.profileFlash = 'Profil mis a jour.';
        persistCollabState();
        syncCloudStatus();
        if (isCloudBoardActive()) {
            updatePointCloudPresence().catch(() => {});
        }
        await renderCloudProfile();
        return true;
    } catch (e) {
        showCustomAlert(`Erreur: ${escapeHtml(e.message || 'inconnue')}`);
        return false;
    }
}

async function renderCloudProfile() {
    if (!collab.user) {
        await renderCloudHome();
        return;
    }
    setCloudWorkspaceBusy(false);
    if (!modalOverlay) createModal();
    setModalMode('cloud');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = `
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
                            <input id="cloud-profile-username" type="text" placeholder="${escapeHtml(collab.user.username || 'nouvel_identifiant')}" class="modal-input-standalone cloud-auth-input" autocomplete="username" />
                        </label>
                        <label class="cloud-auth-field">
                            <span class="cloud-auth-label">Mot de passe actuel</span>
                            <input id="cloud-profile-current-pass" type="password" placeholder="Mot de passe actuel" class="modal-input-standalone cloud-auth-input" autocomplete="current-password" />
                        </label>
                        <label class="cloud-auth-field">
                            <span class="cloud-auth-label">Nouveau mot de passe</span>
                            <input id="cloud-profile-next-pass" type="password" placeholder="Nouveau mot de passe" class="modal-input-standalone cloud-auth-input" autocomplete="new-password" />
                        </label>
                    </div>
                    <div class="cloud-auth-hint">Le meme compte fonctionne sur Point et Map.</div>
                </div>
            </div>
            <div class="cloud-status-bar">
                <span class="cloud-status-pill">Compte: ${escapeHtml(collab.user.username || '')}</span>
                <span class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">
                    ${isCloudBoardActive() ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} (${escapeHtml(collab.activeRole || '')})` : 'Aucun board cloud actif'}
                </span>
            </div>
        </div>
    `;
    actEl.innerHTML = `
        <button type="button" id="cloud-profile-back" class="cloud-auth-secondary">Retour</button>
        <button type="button" id="cloud-profile-save" class="primary cloud-auth-primary">Enregistrer</button>
    `;

    const backBtn = document.getElementById('cloud-profile-back');
    const saveBtn = document.getElementById('cloud-profile-save');
    if (backBtn) {
        backBtn.onclick = async () => {
            clearCloudProfileFlash();
            await renderCloudHome();
        };
    }
    if (saveBtn) {
        saveBtn.onclick = () => {
            runCloudProfileUpdate().catch(() => {});
        };
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

function bindCloudBoardListActions() {
    Array.from(document.querySelectorAll('.cloud-open-board')).forEach((btn) => {
        bindImmediateActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;
            hideModalOverlay({ restoreFocus: false });
            setCloudWorkspaceBusy(true, 'Chargement cloud...');
            try {
                await openCloudBoard(boardId, { quiet: false });
            } catch (e) {
                setCloudWorkspaceBusy(false);
                showCustomAlert(`Erreur ouverture cloud: ${escapeHtml(e.message || 'inconnue')}`);
            }
        });
    });

    Array.from(document.querySelectorAll('.cloud-manage-board')).forEach((btn) => {
        bindImmediateActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;
            await renderCloudMembers(boardId);
        });
    });

    Array.from(document.querySelectorAll('.cloud-leave-board')).forEach((btn) => {
        bindImmediateActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;
            showCustomConfirm('Quitter ce board partage ?', async () => {
                try {
                    if (boardId === collab.activeBoardId) {
                        await disconnectCurrentCloudBoard({ leaveBoard: true, renderHome: true, quiet: true });
                    } else {
                        await collabBoardRequest('leave_board', { boardId });
                        await renderCloudHome();
                    }
                } catch (e) {
                    showCustomAlert(`Erreur: ${escapeHtml(e.message || 'inconnue')}`);
                }
            });
        });
    });

    Array.from(document.querySelectorAll('.cloud-disconnect-board')).forEach((btn) => {
        bindImmediateActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId || boardId !== collab.activeBoardId) return;
            try {
                await disconnectCurrentCloudBoard({ boardId, renderHome: true, quiet: true });
            } catch (e) {
                showCustomAlert(`Erreur deconnexion cloud: ${escapeHtml(e.message || 'inconnue')}`);
            }
        });
    });

    Array.from(document.querySelectorAll('.cloud-delete-board-inline')).forEach((btn) => {
        bindImmediateActionButton(btn, async () => {
            const boardId = btn.getAttribute('data-board') || '';
            if (!boardId) return;
            showCustomConfirm('Supprimer ce board cloud ?', async () => {
                try {
                    await collabBoardRequest('delete_board', { boardId });
                    if (String(boardId) === String(collab.activeBoardId)) {
                        setActiveCloudBoardFromSummary(null);
                        setBoardQueryParam('');
                        restoreLastLocalWorkspace({ fallbackClear: true });
                    }
                    await renderCloudHome();
                } catch (e) {
                    showCustomAlert(`Erreur suppression: ${escapeHtml(e.message || 'inconnue')}`);
                }
            });
        });
    });
}

function renderCloudHomeLoading(localPanel = 'cloud', note = 'Chargement du cloud...') {
    if (!modalOverlay) createModal();
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    const safePanel = localPanel === 'local' ? 'local' : 'cloud';
    const title = collab.user ? escapeHtml(collab.user.username) : 'Cloud';
    const syncLabel = collab.user
        ? (isCloudBoardActive() ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} (${escapeHtml(collab.activeRole || '')})` : 'Aucun board cloud actif')
        : 'Mode local';

    msgEl.innerHTML = `
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
                <span class="cloud-status-pill">${collab.user ? `Compte: ${escapeHtml(collab.user.username)}` : 'Mode local'}</span>
                <span class="cloud-status-pill">${syncLabel}</span>
            </div>
        </div>
    `;
    actEl.innerHTML = localPanel === 'cloud' && collab.user
        ? `
            <button type="button" id="cloud-create-board" class="primary">Nouveau</button>
            <button type="button" id="cloud-save-active">Sauvegarder</button>
            <button type="button" id="cloud-open-profile" class="cloud-auth-secondary">Profil</button>
            <button type="button" id="cloud-logout">Deconnexion</button>
        `
        : '';

    const createBtn = document.getElementById('cloud-create-board');
    if (createBtn) {
        createBtn.onclick = () => {
            showCloudCreateBoardDialog();
        };
    }

    const saveBtn = document.getElementById('cloud-save-active');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveActiveCloudBoard({ manual: true, quiet: false });
            await renderCloudHome();
        };
    }

    const profileBtn = document.getElementById('cloud-open-profile');
    if (profileBtn) {
        profileBtn.onclick = () => {
            clearCloudProfileFlash();
            renderCloudProfile().catch(() => {});
        };
    }

    const logoutBtn = document.getElementById('cloud-logout');
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            await logoutCollab();
            await renderCloudHome();
        };
    }
    bindCloudHomeTabs();
}

async function renderCloudHome() {
    setCloudWorkspaceBusy(false);
    if (!modalOverlay) createModal();
    setModalMode('cloud');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

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
                            <input id="cloud-auth-user" type="text" placeholder="operateur_nord" class="modal-input-standalone cloud-auth-input" autocomplete="username" />
                        </label>
                        <label class="cloud-auth-field">
                            <span class="cloud-auth-label">Mot de passe</span>
                            <input id="cloud-auth-pass" type="password" placeholder="Mot de passe" class="modal-input-standalone cloud-auth-input" autocomplete="current-password" />
                        </label>
                    </div>
                    <div class="cloud-auth-hint">Le meme compte fonctionne sur Point et Map.</div>
                    </div>
            </div>
        `;
        const panelBody = localPanel === 'local' ? localRows : guestCloudPanel;

        msgEl.innerHTML = `
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
        `;
        actEl.innerHTML = localPanel === 'cloud'
            ? `
                <button type="button" id="cloud-auth-register" class="cloud-auth-secondary">Creer</button>
                <button type="button" id="cloud-auth-login" class="primary cloud-auth-primary">Connexion</button>
            `
            : '';

        bindCloudHomeTabs();
        bindCloudLocalActions(localSaveLocked);

        const registerBtn = document.getElementById('cloud-auth-register');
        const loginBtn = document.getElementById('cloud-auth-login');
        if (registerBtn) registerBtn.onclick = () => { runCloudAuth('register').catch(() => {}); };
        if (loginBtn) loginBtn.onclick = () => { runCloudAuth('login').catch(() => {}); };

        const passInput = document.getElementById('cloud-auth-pass');
        Array.from(document.querySelectorAll('#cloud-auth-user, #cloud-auth-pass')).forEach((field) => {
            field.onkeydown = (event) => {
                if (event.key === 'Enter') runCloudAuth('login').catch(() => {});
            };
        });
        return;
    }

    let boards = [];
    if (localPanel === 'cloud') {
        renderCloudHomeLoading('cloud', 'Chargement des boards et des droits...');
        await flushPendingCloudAutosave(collab.activeBoardId).catch(() => {});
        if (renderToken !== collab.homeRenderSeq || collab.homePanel === 'local') return;
        try {
            const res = await collabBoardRequest('list_boards', { page: 'point' });
            if (renderToken !== collab.homeRenderSeq || collab.homePanel === 'local') return;
            boards = (Array.isArray(res.boards) ? res.boards : [])
                .filter((board) => String(board?.page || 'point') === 'point');
        } catch (e) {
            if (renderToken !== collab.homeRenderSeq) return;
            showCustomAlert(`Erreur cloud: ${escapeHtml(e.message || 'inconnue')}`);
            await renderCloudHome();
            return;
        }
    }

    const boardRows = boards.map((b) => {
        const active = b.id === collab.activeBoardId;
        const role = b.role || '';
        return `
            <div class="cloud-board-row ${active ? 'is-active' : ''}">
                <div class="cloud-row-main">
                    <div class="cloud-row-title-wrap">
                        <div class="cloud-row-title">${escapeHtml(b.title || 'Sans nom')}</div>
                        ${active ? `
                            <button type="button" class="cloud-connected-pill cloud-disconnect-board" data-board="${escapeHtml(b.id)}">
                                <span class="cloud-connected-pill-label">Connecté</span>
                                <span class="cloud-connected-pill-hover">Déconnexion</span>
                            </button>
                        ` : ''}
                    </div>
                    <div class="cloud-row-sub">${escapeHtml(role)} - POINT</div>
                </div>
                <div class="cloud-row-actions">
                    ${active ? '' : `<button type="button" class="mini-btn cloud-open-board" data-board="${escapeHtml(b.id)}">Ouvrir</button>`}
                    ${role === 'owner' ? `<button type="button" class="mini-btn cloud-manage-board" data-board="${escapeHtml(b.id)}">Gerer</button>` : ''}
                    ${role === 'owner' ? `<button type="button" class="mini-btn danger cloud-delete-board-inline" data-board="${escapeHtml(b.id)}">Supprimer</button>` : ''}
                    ${role !== 'owner' ? `<button type="button" class="mini-btn cloud-leave-board" data-board="${escapeHtml(b.id)}">Quitter</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    const panelBody = localPanel === 'local'
        ? localRows
        : (boardRows || '<div class="modal-empty-state">Aucun board point cloud.</div>');

    msgEl.innerHTML = `
        <div class="cloud-shell">
            <div class="cloud-home-head">
                <div class="cloud-home-heading">
                    <div class="cloud-home-kicker">Fichier</div>
                    <div class="cloud-home-title">${escapeHtml(collab.user.username)}</div>
                </div>
                <div class="cloud-home-tab-group">
                    <button type="button" id="cloud-home-tab-cloud" class="cloud-home-tab ${localPanel === 'cloud' ? 'is-active' : ''}">Cloud</button>
                    <button type="button" id="cloud-home-tab-local" class="cloud-home-tab cloud-home-tab-alt ${localPanel === 'local' ? 'is-active' : ''}">Local</button>
                </div>
            </div>
            <div class="cloud-column cloud-panel-shell">${panelBody}</div>
            <div class="cloud-status-bar">
                <span class="cloud-status-pill">Compte: ${escapeHtml(collab.user.username)}</span>
                <span id="cloudModalSyncInfo" class="cloud-status-pill ${isCloudBoardActive() ? 'cloud-status-active' : ''}">
                    ${isCloudBoardActive() ? `Board actif: ${escapeHtml(collab.activeBoardTitle || collab.activeBoardId)} (${escapeHtml(collab.activeRole || '')})` : 'Aucun board cloud actif'}
                </span>
            </div>
        </div>
    `;

    actEl.innerHTML = localPanel === 'cloud'
        ? `
            <button type="button" id="cloud-create-board" class="primary">Nouveau</button>
            <button type="button" id="cloud-save-active">Sauvegarder</button>
            <button type="button" id="cloud-open-profile" class="cloud-auth-secondary">Profil</button>
            <button type="button" id="cloud-logout">Deconnexion</button>
        `
        : `
            <button type="button" id="cloud-open-profile" class="cloud-auth-secondary">Profil</button>
            <button type="button" id="cloud-logout">Deconnexion</button>
        `;

    const createBtn = document.getElementById('cloud-create-board');
    if (createBtn) {
        createBtn.onclick = () => {
            showCloudCreateBoardDialog();
        };
    }

    const saveBtn = document.getElementById('cloud-save-active');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveActiveCloudBoard({ manual: true, quiet: false });
            await renderCloudHome();
        };
    }
    const profileBtn = document.getElementById('cloud-open-profile');
    if (profileBtn) {
        profileBtn.onclick = () => {
            clearCloudProfileFlash();
            renderCloudProfile().catch(() => {});
        };
    }
    const logoutBtn = document.getElementById('cloud-logout');
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            await logoutCollab();
            await renderCloudHome();
        };
    }
    if (saveBtn && (!isCloudBoardActive() || !canEditCloudBoard())) {
        saveBtn.disabled = true;
        saveBtn.title = isCloudBoardActive() ? 'Droits insuffisants' : 'Aucun board actif';
    }
    bindCloudHomeTabs();
    bindCloudLocalActions(localSaveLocked);

    bindCloudBoardListActions();

    syncCloudLivePanels();
}

function showCloudMenu(initialPanel = '') {
    if (!modalOverlay) createModal();
    setModalMode('cloud');
    collab.homePanel = initialPanel || (collab.user ? 'cloud' : 'local');
    showModalOverlay();
    renderCloudHome();
}

export async function initCloudCollab() {
    hydrateCollabState();
    bindCloudStatusQuickDisconnect();
    syncCloudStatus();
    pointDebugLogger.log('init-cloud-collab-start', getPointDiagState());

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const boardFromUrl = String(urlParams.get('board') || '').trim();
        if (boardFromUrl) collab.pendingBoardId = boardFromUrl;
        pointDebugLogger.log('init-cloud-collab-url', getPointDiagState({
            boardFromUrl: shortDiagId(boardFromUrl)
        }));
    } catch (e) {}

    if (!collab.token) {
        setActiveCloudBoardFromSummary(null);
        pointDebugLogger.log('init-cloud-collab-no-token', getPointDiagState());
        return;
    }

    try {
        const me = await collabAuthRequest('me');
        collab.user = me.user || collab.user;
        setCloudSyncState(collab.activeBoardId ? 'live' : 'session');
        pointDebugLogger.log('init-cloud-collab-authenticated', getPointDiagState());
    } catch (e) {
        pointDebugLogger.error('init-cloud-collab-auth-failed', getPointDiagState({
            message: e?.message || 'Erreur auth'
        }));
        await logoutCollab();
        return;
    }

    const preferredBoard = collab.pendingBoardId || collab.activeBoardId;
    if (preferredBoard) {
        try {
            await openCloudBoard(preferredBoard, { quiet: true });
            pointDebugLogger.log('init-cloud-collab-opened-board', getPointDiagState({
                preferredBoard: shortDiagId(preferredBoard)
            }));
        } catch (e) {
            pointDebugLogger.error('init-cloud-collab-open-board-failed', getPointDiagState({
                preferredBoard: shortDiagId(preferredBoard),
                message: e?.message || 'Erreur ouverture board'
            }));
            setActiveCloudBoardFromSummary(null);
            setBoardQueryParam('');
        } finally {
            collab.pendingBoardId = '';
        }
    }

    syncCloudStatus();
    persistCollabState();
    pointDebugLogger.log('init-cloud-collab-complete', getPointDiagState());
}

function updateIntelButtonLockVisual() {
    const btn = document.getElementById('btnIntel');
    if (!btn) return;
    btn.classList.remove('locked');
    btn.innerHTML = `<svg style="width:16px;height:16px;fill:currentColor;margin-right:5px;" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 .29.7l2 2a1 1 0 0 0 .71.3h2a1 1 0 0 0 .7-.3l2-2a1 1 0 0 0 .3-.7v-2.26A7 7 0 0 0 12 2zm2 14.17V17h-4v-.83a1 1 0 0 0-.45-.83A5 5 0 1 1 14.45 15a1 1 0 0 0-.45.83z"/></svg> INTEL`;
}

const TYPE_LABEL = {
    [TYPES.PERSON]: 'Personne',
    [TYPES.COMPANY]: 'Entreprise',
    [TYPES.GROUP]: 'Groupe'
};

const LINK_GUIDE_SECTIONS = [
    {
        title: 'Personne <> Personne',
        subtitle: 'Relations directes entre deux individus.',
        items: [
            { kind: KINDS.FAMILLE, when: 'Parent, enfant, frere, soeur, cousin ou foyer.' },
            { kind: KINDS.COUPLE, when: 'Relation officielle ou vie de couple stable.' },
            { kind: KINDS.AMOUR, when: 'Relation sentimentale floue, liaison ou crush connu.' },
            { kind: KINDS.AMI, when: 'Lien amical clair, proche, sorties ensemble.' },
            { kind: KINDS.COLLEGUE, when: 'Ils bossent ensemble au meme niveau.' },
            { kind: KINDS.CONNAISSANCE, when: 'Ils se connaissent mais sans lien fort confirme.' },
            { kind: KINDS.RIVAL, when: 'Concurrence, tension, conflit froid ou lutte d influence.' },
            { kind: KINDS.ENNEMI, when: 'Hostilite ouverte, menace, guerre ou vendetta.' }
        ]
    },
    {
        title: 'Personne <> Organisation',
        subtitle: 'Entre une personne et une entreprise ou un groupe.',
        items: [
            { kind: KINDS.PATRON, when: 'La personne dirige ou possede la structure.' },
            { kind: KINDS.HAUT_GRADE, when: 'Cadre haut place, chef interne, bras droit, lieutenant.' },
            { kind: KINDS.EMPLOYE, when: 'Travaille pour la structure sans etre dirigeant.' },
            { kind: KINDS.MEMBRE, when: 'Appartient au groupe, gang, club ou organisation.' },
            { kind: KINDS.AFFILIATION, when: 'Lien de proximite, soutien, contact regulier sans appartenance nette.' },
            { kind: KINDS.PARTENAIRE, when: 'Business ou alliance ponctuelle avec la structure.' },
            { kind: KINDS.ENNEMI, when: 'La personne s oppose a la structure ou la cible.' }
        ]
    },
    {
        title: 'Organisation <> Organisation',
        subtitle: 'Entreprises, groupes et institutions entre eux.',
        items: [
            { kind: KINDS.PARTENAIRE, when: 'Alliance, deal, accord, cooperation ou business commun.' },
            { kind: KINDS.AFFILIATION, when: 'Rattachement, tutelle, reseau commun ou proximite durable.' },
            { kind: KINDS.RIVAL, when: 'Concurrence, guerre de territoire, lutte economique.' },
            { kind: KINDS.ENNEMI, when: 'Conflit ouvert, operations contre l autre structure.' }
        ]
    },
    {
        title: 'Lien generique',
        subtitle: 'Quand tu sais qu il y a un lien mais pas encore sa vraie nature.',
        items: [
            { kind: KINDS.RELATION, when: 'Utilise-le comme lien temporaire, puis remplace-le plus tard par le bon type.' }
        ]
    }
];

function renderLinkGuideMarkup() {
    const sections = LINK_GUIDE_SECTIONS.map((section) => `
        <section class="link-guide-section">
            <div class="link-guide-section-head">
                <div class="link-guide-section-title">${escapeHtml(section.title)}</div>
                <div class="link-guide-section-subtitle">${escapeHtml(section.subtitle)}</div>
            </div>
            <div class="link-guide-grid">
                ${section.items.map((item) => `
                    <article class="link-guide-card">
                        <div class="link-guide-card-head">
                            <span class="link-guide-emoji">${escapeHtml(linkKindEmoji(item.kind))}</span>
                            <span class="link-guide-kind">${escapeHtml(kindToLabel(item.kind))}</span>
                        </div>
                        <div class="link-guide-when">${escapeHtml(item.when)}</div>
                    </article>
                `).join('')}
            </div>
        </section>
    `).join('');

    return `
        <div class="link-guide-shell">
            <div class="link-guide-topline">Aide liaison</div>
            <h3 class="link-guide-title">Comment choisir le bon type de lien</h3>
            <p class="link-guide-intro">
                Choisis le lien le plus precis possible. Si tu hesites, commence par <strong>${escapeHtml(kindToLabel(KINDS.RELATION))}</strong>
                puis remplace-le des que tu as une info plus fiable.
            </p>
            <div class="link-guide-tips">
                <div class="link-guide-tip">Patron / Haut grade / Employe servent a poser la hierarchie dans une structure.</div>
                <div class="link-guide-tip">Membre / Affiliation servent quand le lien existe mais que le role exact reste flou.</div>
                <div class="link-guide-tip">Rival et Ennemi ne veulent pas dire la meme chose: Rival = tension, Ennemi = conflit ouvert.</div>
            </div>
            ${sections}
        </div>
    `;
}

function showLinkGuide() {
    if (!modalOverlay) createModal();
    setModalMode('info');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = renderLinkGuideMarkup();
    actEl.innerHTML = '';

    showModalOverlay();
}

// EXPORTS
export { renderEditor, showSettings, showContextMenu, hideContextMenu, pointDebugLogger };

// --- MODALES PERSONNALISÉES ---

function setModalMode(mode = 'default') {
    if (!modalOverlay) createModal();
    if (!modalOverlay) return;
    modalOverlay.setAttribute('data-mode', String(mode || 'default'));
}

function createModal() {
    if (document.getElementById('custom-modal')) return;

    if (!document.getElementById('custom-modal-style')) {
        const style = document.createElement('style');
        style.id = 'custom-modal-style';
        style.textContent = `
            #custom-modal {
                position: fixed;
                inset: 0;
                z-index: 9999;
                display: none;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.68);
                backdrop-filter: blur(4px);
            }
            #custom-modal .modal-card {
                background: rgba(5, 10, 28, 0.96);
                border: 1px solid rgba(115, 251, 247, 0.68);
                width: min(560px, calc(100vw - 32px));
                min-height: 180px;
                position: relative;
                padding: 20px;
                box-shadow: 0 0 0 1px rgba(115, 251, 247, 0.18), 0 20px 40px rgba(0,0,0,0.6);
            }
            #custom-modal .modal-close-x {
                position: absolute;
                top: 14px;
                right: 14px;
                z-index: 3;
            }
            #custom-modal .ui-close-x {
                appearance: none;
                width: 34px;
                height: 34px;
                min-width: 34px;
                min-height: 34px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                border: 1px solid rgba(102, 243, 255, 0.24);
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(8, 18, 42, 0.96), rgba(4, 10, 22, 0.92));
                color: #e6f8ff;
                font-size: 1rem;
                font-weight: 700;
                line-height: 1;
                cursor: pointer;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
                transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
            }
            #custom-modal .ui-close-x:hover {
                transform: translateY(-1px);
                border-color: rgba(102, 243, 255, 0.5);
                background: linear-gradient(180deg, rgba(15, 33, 62, 0.98), rgba(6, 16, 30, 0.96));
                color: #ffffff;
                box-shadow: 0 0 16px rgba(102, 243, 255, 0.12);
            }
            #custom-modal #modal-msg {
                margin-bottom: 14px;
                color: #fff;
                font-size: 1.02rem;
                text-align: left;
            }
            #custom-modal #modal-actions {
                display: flex;
                gap: 10px;
                justify-content: flex-start;
                flex-wrap: wrap;
            }
            #custom-modal[data-mode="cloud"] .modal-card {
                width: min(1040px, calc(100vw - 56px));
                min-height: min(540px, calc(100vh - 34px));
                max-height: calc(100vh - 28px);
                padding: 18px 20px 16px;
                border-radius: 18px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                background:
                    linear-gradient(180deg, rgba(5, 12, 30, 0.98), rgba(4, 10, 22, 0.98)),
                    radial-gradient(circle at top right, rgba(102, 243, 255, 0.08), transparent 28%);
                box-shadow:
                    0 0 0 1px rgba(115, 251, 247, 0.14),
                    0 28px 90px rgba(0, 0, 0, 0.7);
            }
            #custom-modal[data-mode="cloud"] #modal-msg {
                flex: 1 1 auto;
                min-height: 0;
                margin-bottom: 12px;
                overflow: auto;
                padding-right: 4px;
            }
            #custom-modal[data-mode="cloud"] #modal-actions {
                flex: 0 0 auto;
                justify-content: flex-end;
            }
            #custom-modal[data-mode="create"] .modal-card {
                width: min(736px, calc(100vw - 120px));
                min-height: 0;
                padding: 14px 16px 12px;
                overflow: visible;
            }
            #custom-modal[data-mode="create"] #modal-msg {
                margin-bottom: 10px;
            }
            #custom-modal[data-mode="create"] #modal-actions {
                display: none;
            }
            #custom-modal[data-mode="search"] .modal-card {
                width: min(560px, calc(100vw - 220px));
                min-height: 260px;
            }
            #custom-modal[data-mode="info"] .modal-card {
                width: min(980px, calc(100vw - 40px));
                min-height: 0;
                max-height: calc(100vh - 44px);
                padding: 18px 20px 16px;
                overflow: hidden;
            }
            #custom-modal[data-mode="datahub"] .modal-card {
                width: min(860px, calc(100vw - 32px));
                min-height: 420px;
            }
            #custom-modal[data-mode="aihub"] .modal-card {
                width: min(784px, calc(100vw - 18px));
                min-height: 420px;
                padding: 0;
                overflow: hidden;
                border-radius: 18px;
                background:
                    linear-gradient(180deg, rgba(2, 10, 30, 0.98), rgba(1, 7, 20, 0.98)),
                    radial-gradient(circle at top right, rgba(102, 243, 255, 0.08), transparent 30%);
                border: 1px solid rgba(37, 196, 255, 0.54);
                box-shadow:
                    0 0 0 1px rgba(37, 196, 255, 0.1),
                    0 24px 90px rgba(0, 0, 0, 0.68);
                clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
            }
            #custom-modal[data-mode="aihub"] #modal-msg {
                margin-bottom: 0;
            }
            #custom-modal[data-mode="aihub"] #modal-actions {
                display: none;
            }
            #custom-modal[data-mode="alert"] .modal-card,
            #custom-modal[data-mode="prompt"] .modal-card,
            #custom-modal[data-mode="confirm"] .modal-card {
                width: min(560px, calc(100vw - 28px));
                min-height: 170px;
            }
            #custom-modal[data-mode="info"] #modal-msg {
                margin-bottom: 12px;
                max-height: calc(100vh - 170px);
                overflow-y: auto;
                padding-right: 6px;
            }
            .link-guide-shell {
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .link-guide-topline {
                color: #7ec8d5;
                font-size: 0.72rem;
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            .link-guide-title {
                margin: 0;
                color: #fff;
                font-size: 1.5rem;
                letter-spacing: 0.03em;
            }
            .link-guide-intro {
                margin: 0;
                color: #b6c7df;
                line-height: 1.55;
            }
            .link-guide-tips {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 10px;
            }
            .link-guide-tip {
                padding: 10px 12px;
                border: 1px solid rgba(115, 251, 247, 0.16);
                background: rgba(7, 18, 39, 0.82);
                color: #a9bbd5;
                line-height: 1.45;
                border-radius: 10px;
            }
            .link-guide-section {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .link-guide-section-head {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .link-guide-section-title {
                color: #e7f6ff;
                font-size: 1rem;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }
            .link-guide-section-subtitle {
                color: #7f95b0;
                font-size: 0.84rem;
                line-height: 1.45;
            }
            .link-guide-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }
            .link-guide-card {
                padding: 12px 14px;
                border: 1px solid rgba(115, 251, 247, 0.16);
                background: linear-gradient(180deg, rgba(7, 18, 39, 0.9), rgba(4, 11, 24, 0.9));
                border-radius: 12px;
                box-shadow: inset 0 0 0 1px rgba(115, 251, 247, 0.04);
            }
            .link-guide-card-head {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }
            .link-guide-emoji {
                font-size: 1.1rem;
                line-height: 1;
            }
            .link-guide-kind {
                color: #f0fbff;
                font-weight: 700;
                letter-spacing: 0.03em;
                text-transform: uppercase;
            }
            .link-guide-when {
                color: #a7bbd4;
                line-height: 1.5;
            }
            @media (max-width: 900px) {
                #custom-modal[data-mode="cloud"] .modal-card,
                #custom-modal[data-mode="datahub"] .modal-card,
                #custom-modal[data-mode="create"] .modal-card,
                #custom-modal[data-mode="search"] .modal-card,
                #custom-modal[data-mode="aihub"] .modal-card,
                #custom-modal[data-mode="info"] .modal-card {
                    width: calc(100vw - 18px);
                    min-height: 260px;
                }
                #custom-modal[data-mode="create"] .modal-card {
                    padding: 12px;
                }
                .link-guide-tips,
                .link-guide-grid {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(style);
    }

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'custom-modal';
    modalOverlay.setAttribute('data-mode', 'default');
    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-modal', 'true');
    modalOverlay.tabIndex = -1;
    modalOverlay.innerHTML = `
        <div class="modal-card">
            <button type="button" class="ui-close-x modal-close-x" id="modal-close-x" aria-label="Fermer">×</button>
            <div id="modal-msg"></div>
            <div id="modal-actions"></div>
        </div>`;
    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) dismissModalOverlay();
    });
    modalOverlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            dismissModalOverlay();
        }
    });
    document.body.appendChild(modalOverlay);

    const closeBtn = document.getElementById('modal-close-x');
    if (closeBtn) closeBtn.onclick = () => dismissModalOverlay();
}

export function showCustomAlert(msg) {
    setCloudWorkspaceBusy(false);
    if(!modalOverlay) createModal();
    setModalMode('alert');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if(msgEl && actEl) {
        msgEl.innerHTML = msg;
        actEl.innerHTML = `<button id="btn-modal-ok" class="grow">OK</button>`;

        const btn = document.getElementById('btn-modal-ok');
        btn.onclick = () => { hideModalOverlay(); };

        modalDismissHandler = () => hideModalOverlay();
        showModalOverlay();
        btn.focus();
    }
}

export function showCustomConfirm(msg, onYes) {
    if(!modalOverlay) createModal();
    setModalMode('confirm');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if(msgEl && actEl) {
        msgEl.innerText = msg;
        actEl.innerHTML = '';

        const btnNo = document.createElement('button');
        btnNo.innerText = 'ANNULER';
        btnNo.onclick = () => { hideModalOverlay(); };

        const btnYes = document.createElement('button');
        btnYes.className = 'danger';
        btnYes.innerText = 'CONFIRMER';
        btnYes.onclick = () => { hideModalOverlay(); onYes(); };

        actEl.appendChild(btnNo); actEl.appendChild(btnYes);
        modalDismissHandler = () => hideModalOverlay();
        showModalOverlay();
        btnYes.focus();
    }
}

export function showCustomPrompt(msg, defaultValue, onConfirm, onCancel = null) {
    if(!modalOverlay) createModal();
    setModalMode('prompt');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');

    if(msgEl && actEl) {
        const safeDefault = escapeHtml(defaultValue || '');
        msgEl.innerHTML = `
            <div class="modal-tool">
                <div class="modal-tool-title">${msg}</div>
                <input type="text" id="modal-input-custom" value="${safeDefault}" class="modal-input-standalone modal-input-center">
            </div>
        `;

        actEl.innerHTML = '';
        const btnCancel = document.createElement('button');
        btnCancel.innerText = 'ANNULER';
        btnCancel.onclick = () => {
            hideModalOverlay();
            if (typeof onCancel === 'function') onCancel();
        };

        const btnConfirm = document.createElement('button');
        btnConfirm.innerText = 'VALIDER';
        btnConfirm.onclick = () => {
             const val = document.getElementById('modal-input-custom').value;
             if(val && val.trim() !== "") {
                 hideModalOverlay();
                 onConfirm(val.trim());
             }
        };

        actEl.appendChild(btnCancel); actEl.appendChild(btnConfirm);
        modalDismissHandler = () => {
            hideModalOverlay();
            if (typeof onCancel === 'function') onCancel();
        };
        showModalOverlay();
        setTimeout(() => document.getElementById('modal-input-custom').focus(), 50);
    }
}

// --- INITIALISATION UI ---
export function initUI() {
    createModal();
    injectStyles();
    updatePathfindingPanel();
    updateIntelButtonLockVisual();

    const hud = document.getElementById('hud');
    if (hud && hud.parentElement !== document.body) {
        document.body.appendChild(hud);
    }

    const canvas = document.getElementById('graph');
    window.addEventListener('resize', resizeCanvas);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault(); undo(); saveState(); refreshLists();
            if (state.selection) renderEditor();
            draw();
        }
    });

    setupCanvasEvents(canvas, {
        selectNode,
        renderEditor,
        updatePathfindingPanel,
        addLink,
        showContextMenu,
        hideContextMenu
    });

    setupHudButtons();
    setupSearch();
    setupTopButtons();
    setupQuickActions();
    updateFocusControls();
    updateCenterEmptyState();

    window.zoomToNode = zoomToNode;
    window.recenterGraphView = recenterGraphView;
    window.graphZoomIn = () => stepGraphZoom(1);
    window.graphZoomOut = () => stepGraphZoom(-1);
    window.updateHvtPanel = updateHvtPanel;
}

function resetAllPointData() {
    showCustomConfirm('SUPPRIMER TOUTES LES DONNÉES ?', () => {
        pushHistory();
        state.nodes = [];
        state.links = [];
        state.selection = null;
        intelSuggestions = [];
        state.aiPredictedLinks = [];
        state.aiPreviewPair = null;
        clearFocusMode();
        state.nextId = 1;
        state.projectName = null;
        restartSim();
        refreshLists();
        renderEditor();
        updateFocusControls();
        saveState();
    });
}


function clearPointWorkspaceData(options = {}) {
    const projectName = Object.prototype.hasOwnProperty.call(options || {}, 'projectName')
        ? options.projectName
        : null;

    state.nodes = [];
    state.links = [];
    state.selection = null;
    intelSuggestions = [];
    state.aiPredictedLinks = [];
    state.aiPreviewPair = null;
    state.projectName = projectName;
    state.nextId = 1;
    state.pathfinding.startId = null;
    state.pathfinding.active = false;
    state.pathfinding.pathNodes = new Set();
    state.pathfinding.pathLinks = new Set();
    clearPath();
    clearFocusMode();
    restartSim();
    refreshLists();
    renderEditor();
    updatePathfindingPanel();
    updateFocusControls();
    updateCenterEmptyState();
    draw();
    saveState();
}

async function disconnectCurrentCloudBoard(options = {}) {
    const {
        leaveBoard = false,
        boardId = collab.activeBoardId,
        renderHome = false,
        quiet = false,
        clearWorkspace = true
    } = options;

    const targetBoardId = String(boardId || '').trim();
    if (!targetBoardId) return false;

    await flushPendingCloudAutosave(targetBoardId).catch(() => {});

    if (leaveBoard) {
        await collabBoardRequest('leave_board', { boardId: targetBoardId });
    }

    if (String(collab.activeBoardId || '') === targetBoardId) {
        setActiveCloudBoardFromSummary(null);
        setBoardQueryParam('');
        collab.homePanel = 'local';
        const restoredLocal = clearWorkspace ? restoreLastLocalWorkspace({ fallbackClear: true }) : false;
        if (!quiet) {
            showCustomAlert(restoredLocal
                ? 'Cloud deconnecte. La derniere session locale a ete rouverte.'
                : 'Cloud deconnecte. Session locale remise a zero.');
        }
    }

    if (renderHome && modalOverlay && modalOverlay.style.display === 'flex') {
        await renderCloudHome();
    }
    return true;
}

function bindCloudStatusQuickDisconnect() {
    const statusEl = document.getElementById('cloudStatus');
    if (!statusEl || statusEl.dataset.quickDisconnectBound === '1') return;
    statusEl.dataset.quickDisconnectBound = '1';

    statusEl.addEventListener('mouseenter', () => {
        if (statusEl.dataset.disconnectable !== '1') return;
        statusEl.dataset.hoverDisconnect = '1';
        syncCloudStatus();
    });

    statusEl.addEventListener('mouseleave', () => {
        if (statusEl.dataset.hoverDisconnect !== '1') return;
        statusEl.dataset.hoverDisconnect = '0';
        syncCloudStatus();
    });

    statusEl.addEventListener('click', async (event) => {
        if (statusEl.dataset.disconnectable !== '1' || statusEl.dataset.hoverDisconnect !== '1') return;
        event.preventDefault();
        event.stopPropagation();
        try {
            await disconnectCurrentCloudBoard({ renderHome: modalOverlay && modalOverlay.style.display === 'flex', quiet: true });
        } catch (e) {
            showCustomAlert(`Erreur deconnexion cloud: ${escapeHtml(e.message || 'inconnue')}`);
        }
    });
}

function openJsonTextPrompt(title, onConfirm) {
    if (!modalOverlay) createModal();
    setModalMode('prompt');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = `
        <div class="modal-tool">
            <div class="modal-tool-title">${escapeHtml(title)}</div>
            <textarea id="modal-json-prompt" class="modal-raw-input" placeholder="Collez le code JSON ici..." style="min-height:220px;"></textarea>
        </div>
    `;

    actEl.innerHTML = '';
    const btnCancel = document.createElement('button');
    btnCancel.innerText = 'ANNULER';
    btnCancel.onclick = () => hideModalOverlay();

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'primary';
    btnConfirm.innerText = 'VALIDER';
    btnConfirm.onclick = () => {
        const rawInput = document.getElementById('modal-json-prompt');
        const txt = rawInput ? rawInput.value : '';
        try {
            const json = JSON.parse(txt);
            hideModalOverlay();
            onConfirm(json);
        } catch (e) {
            showCustomAlert('JSON invalide.');
        }
    };

    actEl.appendChild(btnCancel);
    actEl.appendChild(btnConfirm);
    modalDismissHandler = () => hideModalOverlay();
    showModalOverlay();
    const textarea = document.getElementById('modal-json-prompt');
    if (textarea) textarea.focus();
}

function normalizePointPayloadForLoad(d) {
    if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.links)) {
        return null;
    }

    const usedNodeIds = new Set();
    const nodes = d.nodes.map((rawNode, index) => {
        const node = normalizeImportedNode(rawNode, `node_${uid()}_${index}`);
        while (!node.id || usedNodeIds.has(String(node.id))) {
            node.id = `node_${uid()}_${index}`;
        }
        usedNodeIds.add(String(node.id));
        return node;
    });

    const validNodeIds = new Set(nodes.map((node) => String(node.id)));
    const linkIds = new Set();
    const linkSigs = new Set();
    const links = d.links
        .map((rawLink) => normalizeImportedLink(rawLink))
        .filter((link) => {
            if (!link) return false;
            if (!validNodeIds.has(String(link.source)) || !validNodeIds.has(String(link.target))) return false;

            const sig = linkSignature(link.source, link.target, link.kind);
            if (linkSigs.has(sig)) return false;

            while (!link.id || linkIds.has(String(link.id))) {
                link.id = `link_${uid()}`;
            }

            linkIds.add(String(link.id));
            linkSigs.add(sig);
            return true;
        });

    return {
        meta: d.meta && typeof d.meta === 'object' ? cloneJson(d.meta, {}) : {},
        physicsSettings: normalizePointPhysicsSettings(d.physicsSettings),
        nodes,
        links
    };
}

function mergePointPayloads(basePayload, incomingPayload) {
    const base = normalizePointPayloadForLoad(basePayload) || {
        meta: {},
        physicsSettings: {},
        nodes: [],
        links: []
    };
    const incoming = normalizePointPayloadForLoad(incomingPayload);
    if (!incoming) {
        throw new Error('Format de fichier invalide.');
    }

    const working = {
        meta: cloneJson(base.meta, {}),
        physicsSettings: cloneJson(base.physicsSettings, {}),
        nodes: cloneJson(base.nodes, []),
        links: cloneJson(base.links, [])
    };

    let addedNodes = 0;
    let enrichedNodes = 0;
    let addedLinks = 0;

    const idMap = new Map();
    const mergeIndexes = buildNodeMergeIndexes(working.nodes);

    incoming.nodes.forEach((rawNode, index) => {
        const rawId = String(rawNode?.id ?? '');
        const normalizedNode = normalizeImportedNode(rawNode, `node_${uid()}_${index}`);
        const existing = findMergeTarget(mergeIndexes, normalizedNode);

        if (existing) {
            if (rawId) idMap.set(rawId, existing.id);
            if (mergeImportedNodeIntoExisting(existing, normalizedNode)) {
                indexNodeForMerge(mergeIndexes, existing);
                enrichedNodes++;
            }
            return;
        }

        while (!normalizedNode.id || getUniqueIndexedNode(mergeIndexes.byId, normalizeMergeText(normalizedNode.id)) || working.nodes.some((node) => String(node.id) === String(normalizedNode.id))) {
            normalizedNode.id = `node_${uid()}_${index}`;
        }

        working.nodes.push(normalizedNode);
        indexNodeForMerge(mergeIndexes, normalizedNode);
        if (rawId) idMap.set(rawId, normalizedNode.id);
        addedNodes++;
    });

    const existingLinkSigs = new Set(
        working.links.map((link) => linkSignature(
            normalizeLinkEndpoint(link.source),
            normalizeLinkEndpoint(link.target),
            link.kind
        ))
    );
    const existingLinkIds = new Set(working.links.map((link) => String(link.id)));

    incoming.links.forEach((rawLink) => {
        if (!rawLink) return;

        const sourceRaw = normalizeLinkEndpoint(rawLink.source ?? rawLink.from);
        const targetRaw = normalizeLinkEndpoint(rawLink.target ?? rawLink.to);
        if (!sourceRaw || !targetRaw) return;

        const mappedSource = idMap.get(sourceRaw) ?? sourceRaw;
        const mappedTarget = idMap.get(targetRaw) ?? targetRaw;
        if (!mappedSource || !mappedTarget || String(mappedSource) === String(mappedTarget)) return;

        const sourceExists = working.nodes.some((node) => String(node.id) === String(mappedSource));
        const targetExists = working.nodes.some((node) => String(node.id) === String(mappedTarget));
        if (!sourceExists || !targetExists) return;

        const kind = rawLink.kind || 'relation';
        const sig = linkSignature(mappedSource, mappedTarget, kind);
        if (existingLinkSigs.has(sig)) return;

        let nextId = String(rawLink.id ?? '');
        while (!nextId || existingLinkIds.has(nextId)) {
            nextId = `link_${uid()}`;
        }

        working.links.push({
            id: nextId,
            source: mappedSource,
            target: mappedTarget,
            kind
        });

        existingLinkIds.add(nextId);
        existingLinkSigs.add(sig);
        addedLinks++;
    });

    if (!working.meta?.projectName && incoming.meta?.projectName) {
        working.meta = {
            ...working.meta,
            projectName: incoming.meta.projectName
        };
    }

    return {
        payload: working,
        addedNodes,
        enrichedNodes,
        addedLinks
    };
}

async function createCloudBoardFromPayload(title, plainData) {
    if (!collab.user) throw new Error('Connexion cloud requise.');
    if (!isCloudBoardActive()) {
        rememberCurrentLocalWorkspace();
    }
    const cleanTitle = String(title || '').trim() || (state.projectName || `reseau_${new Date().toISOString().slice(0, 10)}`);
    const payload = normalizePointPayloadForLoad(plainData || generateExportData()) || normalizePointPayloadForLoad(generateExportData());

    const result = await collabBoardRequest('create_board', {
        title: cleanTitle,
        page: 'point',
        data: payload
    });

    if (!result.board) throw new Error('Creation cloud echouee.');

    setActiveCloudBoardFromSummary({
        id: result.board.id,
        role: result.board.role || 'owner',
        title: result.board.title || cleanTitle,
        ownerId: result.board.ownerId || collab.user.id,
        updatedAt: result.board.updatedAt || ''
    });
    state.projectName = collab.activeBoardTitle;
    updateCollabPresence(result?.presence || []);
    applyCloudBoardData(result.board.data || payload, { quiet: true, projectName: collab.activeBoardTitle });
    if (result.board.data) setCloudShadowData(result.board.data);
    captureCloudSavedState(collab.localChangeSeq, fingerprintFromPointPayload(payload));
    setBoardQueryParam(result.board.id);
    await activateCloudTransport();
    setCloudWorkspaceBusy(false);
}

function promptCloudCreateFromData(title) {
    const safeTitle = String(title || '').trim() || (state.projectName || `reseau_${new Date().toISOString().slice(0, 10)}`);

    choosePointPayloadSource({
        title: 'Créer un cloud depuis data',
        onBack: () => showCloudCreateBoardDialog(),
        onText: () => {
            openJsonTextPrompt('Créer un cloud depuis data brute', async (json) => {
                const payload = normalizePointPayloadForLoad(json);
                if (!payload) {
                    showCustomAlert('Format de fichier invalide.');
                    return;
                }
                hideModalOverlay();
                setCloudWorkspaceBusy(true, 'Chargement cloud...');
                try {
                    await createCloudBoardFromPayload(safeTitle, payload);
                    setCloudWorkspaceBusy(false);
                    showCustomAlert(`Board cree: ${escapeHtml(collab.activeBoardTitle || '')}`);
                } catch (e) {
                    setCloudWorkspaceBusy(false);
                    showCustomAlert(`Erreur creation cloud: ${escapeHtml(e.message || 'inconnue')}`);
                } finally {
                    setCloudWorkspaceBusy(false);
                }
            });
        },
        onFile: () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) return;
                try {
                    const payload = normalizePointPayloadForLoad(JSON.parse(await file.text()));
                    if (!payload) throw new Error('Format de fichier invalide.');
                    hideModalOverlay();
                    setCloudWorkspaceBusy(true, 'Chargement cloud...');
                    await createCloudBoardFromPayload(safeTitle, payload);
                    setCloudWorkspaceBusy(false);
                    showCustomAlert(`Board cree: ${escapeHtml(collab.activeBoardTitle || '')}`);
                } catch (e) {
                    setCloudWorkspaceBusy(false);
                    showCustomAlert(`Erreur creation cloud: ${escapeHtml(e.message || 'inconnue')}`);
                } finally {
                    setCloudWorkspaceBusy(false);
                }
            }, { once: true });
            fileInput.click();
        }
    });
}

function applyCloudMergeResult(boardId, result, merged) {
    if (!result || !result.board) return;
    const isActive = String(collab.activeBoardId) === String(boardId);
    if (isActive && result.board.data) {
        collab.activeBoardUpdatedAt = result.board.updatedAt || '';
        withoutCloudAutosave(() => {
            applyCloudBoardData(result.board.data, { quiet: true, projectName: collab.activeBoardTitle });
        });
        setCloudShadowData(result.board.data);
        captureCloudSavedState(collab.localChangeSeq, fingerprintFromPointPayload(merged.payload));
    } else if (isActive && result.board.updatedAt) {
        collab.activeBoardUpdatedAt = result.board.updatedAt;
    }
}

function promptCloudMergeFromFile(boardId, boardTitle, boardData, boardUpdatedAt = '') {
    choosePointPayloadSource({
        title: 'Fusionner des données dans le cloud',
        onBack: () => renderCloudMembers(boardId),
        onText: () => {
            openJsonTextPrompt('Fusionner depuis data brute', async (json) => {
                if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.links)) {
                    showCustomAlert('Format de fichier invalide.');
                    return;
                }
                setCloudWorkspaceBusy(true, 'Fusion cloud en cours...');
                try {
                    const merged = mergePointPayloads(extractPlainPointPayloadFromCloud(boardData), json);
                    const result = await collabBoardRequest('save_board', {
                        boardId,
                        title: boardTitle || 'Board cloud',
                        data: merged.payload
                    });
                    applyCloudMergeResult(boardId, result, merged);
                    showCustomAlert(`Fusion cloud: ${merged.addedNodes} nouveaux éléments, ${merged.enrichedNodes} fiches enrichies, ${merged.addedLinks} nouveaux liens.`);
                    await renderCloudMembers(boardId);
                } catch (e) {
                    showCustomAlert(`Erreur fusion cloud: ${escapeHtml(e.message || 'inconnue')}`);
                } finally {
                    setCloudWorkspaceBusy(false);
                }
            });
        },
        onFile: () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) return;
                try {
                    const raw = JSON.parse(await file.text());
                    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.links)) {
                        throw new Error('Format de fichier invalide.');
                    }
                    setCloudWorkspaceBusy(true, 'Fusion cloud en cours...');
                    const merged = mergePointPayloads(extractPlainPointPayloadFromCloud(boardData), raw);
                    const result = await collabBoardRequest('save_board', {
                        boardId,
                        title: boardTitle || 'Board cloud',
                        data: merged.payload
                    });
                    applyCloudMergeResult(boardId, result, merged);
                    showCustomAlert(`Fusion cloud: ${merged.addedNodes} nouveaux éléments, ${merged.enrichedNodes} fiches enrichies, ${merged.addedLinks} nouveaux liens.`);
                    await renderCloudMembers(boardId);
                } catch (e) {
                    showCustomAlert(`Erreur fusion cloud: ${escapeHtml(e.message || 'inconnue')}`);
                } finally {
                    setCloudWorkspaceBusy(false);
                }
            }, { once: true });
            fileInput.click();
        }
    });
}

function showCloudCreateBoardDialog() {
    if (!modalOverlay) createModal();
    setModalMode('prompt');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    const defaultTitle = state.projectName || `reseau_${new Date().toISOString().slice(0, 10)}`;
    msgEl.innerHTML = `
        <div class="modal-tool">
            <div class="modal-tool-title">Nom du board cloud</div>
            <input type="text" id="cloud-create-title" value="${escapeHtml(defaultTitle)}" class="modal-input-standalone modal-input-center">
            <div class="cloud-create-hint">Choisis comment créer le cloud.</div>
        </div>
    `;
    actEl.innerHTML = `
        <button type="button" id="cloud-create-empty">Cree vierge</button>
        <button type="button" id="cloud-create-local" class="primary">Cree depuis local</button>
        <button type="button" id="cloud-create-file">Cree depuis data</button>
    `;

    const getTitle = () => {
        const titleInput = document.getElementById('cloud-create-title');
        return titleInput ? titleInput.value.trim() : defaultTitle;
    };

    const bindCreateAction = (buttonId, handler) => {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.onclick = async () => {
            setModalButtonsBusy(btn, true);
            try {
                await handler();
            } finally {
                setModalButtonsBusy(btn, false);
            }
        };
    };

    bindCreateAction('cloud-create-empty', async () => {
        hideModalOverlay();
        setCloudWorkspaceBusy(true, 'Chargement cloud...');
        try {
            await createCloudBoardFromPayload(getTitle(), { meta: {}, physicsSettings: {}, nodes: [], links: [] });
            setCloudWorkspaceBusy(false);
            showCustomAlert(`Board cree: ${escapeHtml(collab.activeBoardTitle || '')}`);
        } catch (e) {
            setCloudWorkspaceBusy(false);
            showCustomAlert(`Erreur creation cloud: ${escapeHtml(e.message || 'inconnue')}`);
        } finally {
            setCloudWorkspaceBusy(false);
        }
    });

    bindCreateAction('cloud-create-local', async () => {
        hideModalOverlay();
        setCloudWorkspaceBusy(true, 'Chargement cloud...');
        try {
            await createCloudBoardFromPayload(getTitle(), generateExportData());
            setCloudWorkspaceBusy(false);
            showCustomAlert(`Board cree: ${escapeHtml(collab.activeBoardTitle || '')}`);
        } catch (e) {
            setCloudWorkspaceBusy(false);
            showCustomAlert(`Erreur creation cloud: ${escapeHtml(e.message || 'inconnue')}`);
        } finally {
            setCloudWorkspaceBusy(false);
        }
    });

    bindCreateAction('cloud-create-file', async () => {
        promptCloudCreateFromData(getTitle());
    });

    modalDismissHandler = () => hideModalOverlay();
    showModalOverlay();
    const titleInput = document.getElementById('cloud-create-title');
    if (titleInput) titleInput.focus();
}

function showCloudBoardExportDialog(boardTitle, boardData) {
    const plain = extractPlainPointPayloadFromCloud(boardData);
    if (!modalOverlay) createModal();
    setModalMode('prompt');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    msgEl.innerHTML = `
        <div class="modal-tool">
            <div class="modal-tool-title">Sauvegarder le cloud</div>
            <div class="modal-note">Choisis une sortie locale pour ce board.</div>
        </div>
    `;
    actEl.innerHTML = `
        <button type="button" id="cloud-export-copy">Copier JSON</button>
        <button type="button" id="cloud-export-file" class="primary">Télécharger JSON</button>
    `;

    document.getElementById('cloud-export-copy').onclick = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(plain, null, 2));
            showCustomAlert('JSON copie dans le presse-papier.');
        } catch (e) {
            showCustomAlert('Impossible de copier le JSON.');
        }
    };
    document.getElementById('cloud-export-file').onclick = () => {
        const safeName = String(boardTitle || 'board_cloud').trim() || 'board_cloud';
        downloadExportData(plain, `${safeName.replace(/[^a-z0-9-_]+/gi, '_')}.json`);
        hideModalOverlay();
    };

    modalDismissHandler = () => hideModalOverlay();
    showModalOverlay();
}

function openDataHubModal() {
    showCloudMenu();
}

function dismissCenterEmptyState() {
    centerEmptyDismissed = true;
    updateCenterEmptyState();
}

function showCenterEmptyState() {
    centerEmptyDismissed = false;
    updateCenterEmptyState();
}

function setupTopButtons() {
    document.getElementById('createPerson').onclick = () => createNode(TYPES.PERSON, 'Nouvelle personne', { actor: collab.user?.username || '' });
    document.getElementById('createGroup').onclick = () => createNode(TYPES.GROUP, 'Nouveau groupe', { actor: collab.user?.username || '' });
    document.getElementById('createCompany').onclick = () => createNode(TYPES.COMPANY, 'Nouvelle entreprise', { actor: collab.user?.username || '' });
    const btnCenterClose = document.getElementById('centerEmptyClose');
    if (btnCenterClose) btnCenterClose.onclick = () => dismissCenterEmptyState();
    const btnCenterCreatePerson = document.getElementById('centerEmptyCreatePerson');
    if (btnCenterCreatePerson) btnCenterCreatePerson.onclick = () => {
        dismissCenterEmptyState();
        createNode(TYPES.PERSON, 'Nouvelle personne', { actor: collab.user?.username || '' });
    };
    const btnCenterCreateGroup = document.getElementById('centerEmptyCreateGroup');
    if (btnCenterCreateGroup) btnCenterCreateGroup.onclick = () => {
        dismissCenterEmptyState();
        createNode(TYPES.GROUP, 'Nouveau groupe', { actor: collab.user?.username || '' });
    };
    const btnCenterOpenFile = document.getElementById('centerEmptyOpenFile');
    if (btnCenterOpenFile) btnCenterOpenFile.onclick = () => {
        dismissCenterEmptyState();
        openDataHubModal();
    };

    const btnDataFileToggle = document.getElementById('btnDataFileToggle');
    if (btnDataFileToggle) {
        btnDataFileToggle.textContent = 'Fichier';
        btnDataFileToggle.title = 'Ouvrir le hub local / cloud';
        btnDataFileToggle.onclick = () => openDataHubModal();
    }

    document.getElementById('fileImport').onchange = (e) => handleFileProcess(e.target.files[0], 'load');
    document.getElementById('fileMerge').onchange = (e) => handleFileProcess(e.target.files[0], 'merge');

    syncCloudStatus();
}

function setupQuickActions() {
    bindPointQuickActions({
        onSearch: openQuickSearchModal,
        onCreate: openQuickCreateModal,
        onAi: openOperatorIAMode,
    });
}

function openQuickSearchModal() {
    if (!modalOverlay) createModal();
    setModalMode('search');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    const searchableNodes = state.nodes
        .filter((node) => String(node?.name || '').trim())
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    msgEl.innerHTML = `
        <div class="modal-tool">
            <h3 class="modal-tool-title">Recherche mot-cle</h3>
            <input id="quick-search-input" type="text" placeholder="Nom, numero, description, notes..." class="modal-input-standalone modal-search-input">
            <div id="quick-search-results" class="modal-search-results"></div>
        </div>
    `;

    const resultsEl = document.getElementById('quick-search-results');
    const inputEl = document.getElementById('quick-search-input');
    const formatQuickSearchMeta = (node) => {
        const phone = String(node?.num || '').trim();
        return phone ? `${nodeTypeLabel(node?.type)} · ${phone}` : nodeTypeLabel(node?.type);
    };

    const renderResults = () => {
        if (!resultsEl) return;
        const rawQuery = String(inputEl?.value || '').trim();
        const filtered = rawQuery
            ? findSearchMatches(rawQuery, { mode: 'smart', limit: 18 })
            : searchableNodes.slice(0, 18);
        resultsEl.innerHTML = filtered.map((node) => `
            <button type="button" class="mini-btn quick-search-hit" data-id="${escapeHtml(String(node.id))}">
                <span class="quick-search-name">${escapeHtml(node.name || 'Sans nom')}</span>
                <span class="quick-search-meta">${escapeHtml(formatQuickSearchMeta(node))}</span>
            </button>
        `).join('') || '<div class="modal-empty-state">Aucun resultat</div>';

        Array.from(resultsEl.querySelectorAll('.quick-search-hit')).forEach((btn) => {
            btn.onclick = () => {
                const nodeId = btn.getAttribute('data-id') || '';
                modalOverlay.style.display = 'none';
                if (nodeId) zoomToNode(nodeId);
            };
        });
    };

    if (inputEl) inputEl.oninput = renderResults;
    renderResults();

    actEl.innerHTML = '';

    showModalOverlay();
    if (inputEl) inputEl.focus();
}

function openQuickCreateModal() {
    if (!modalOverlay) createModal();
    setModalMode('create');
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!msgEl || !actEl) return;

    const prefilledSourceNode = nodeById(state.selection);
    const searchableNodes = [...state.nodes]
        .filter((node) => String(node?.name || '').trim())
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

    msgEl.innerHTML = `
        <div class="quick-create-shell">
            <div class="quick-create-head">
                <h3 class="quick-create-title">Creer</h3>
            </div>
            <div class="quick-create-tabs" role="tablist" aria-label="Creation rapide">
                <button type="button" class="quick-create-tab active" data-create-tab="link" aria-selected="true">Nouvelle liaison</button>
                <button type="button" class="quick-create-tab" data-create-tab="node" aria-selected="false">Nouvelle fiche</button>
            </div>
            <div class="quick-create-panels">
                <section class="quick-create-block quick-create-panel" data-panel="link">
                    <div class="quick-create-block-head">Relier deux fiches</div>
                    <div class="quick-create-link-flow">
                        <div class="quick-create-field-stack">
                            <label class="quick-create-field-label" for="quick-link-source">Source</label>
                            <input id="quick-link-source" type="text" value="${escapeHtml(prefilledSourceNode?.name || '')}" placeholder="Nom de la fiche" class="quick-create-target-input" />
                            <div id="quick-link-source-result" class="quick-create-search-result" hidden></div>
                        </div>
                        <div class="quick-create-link-arrow" aria-hidden="true">&rarr;</div>
                        <div class="quick-create-field-stack">
                            <label class="quick-create-field-label" for="quick-link-target">Cible</label>
                            <input id="quick-link-target" type="text" placeholder="Nom de la fiche" class="quick-create-target-input" />
                            <div id="quick-link-target-result" class="quick-create-search-result" hidden></div>
                        </div>
                    </div>
                    <div class="flex-row-force quick-create-kind-row">
                        <label class="quick-create-kind-label" for="quick-link-kind">Lien</label>
                        <select id="quick-link-kind" class="flex-grow-input"></select>
                    </div>
                    <div id="quick-link-context" class="quick-create-context"></div>
                    <button type="button" id="quick-link-apply" class="mini-btn primary quick-create-panel-action">Lier</button>
                </section>

                <section class="quick-create-block quick-create-panel is-hidden" data-panel="node">
                    <div class="quick-create-block-head">Creer une nouvelle fiche</div>
                    <div class="quick-create-node-row">
                        <button type="button" class="mini-btn quick-create-node-btn active" data-create-type="${TYPES.PERSON}">Personne</button>
                        <button type="button" class="mini-btn quick-create-node-btn" data-create-type="${TYPES.GROUP}">Groupe</button>
                        <button type="button" class="mini-btn quick-create-node-btn" data-create-type="${TYPES.COMPANY}">Entreprise</button>
                    </div>
                    <div class="quick-create-field-stack">
                        <label class="quick-create-field-label" for="quick-create-node-name">Nom</label>
                        <input id="quick-create-node-name" type="text" placeholder="Nom de la fiche" class="quick-create-target-input" />
                    </div>
                    <div id="quick-create-node-context" class="quick-create-context"></div>
                    <button type="button" id="quick-create-node-apply" class="mini-btn primary quick-create-panel-action">Creer la fiche</button>
                </section>
            </div>
        </div>
    `;

    actEl.innerHTML = '';

    const actorName = collab.user?.username || '';
    let draftTargetType = TYPES.PERSON;
    const nodeContextEl = document.getElementById('quick-create-node-context');
    const nodeInput = document.getElementById('quick-create-node-name');
    const nodeApplyBtn = document.getElementById('quick-create-node-apply');
    const linkSourceInput = document.getElementById('quick-link-source');
    const linkSourceResultEl = document.getElementById('quick-link-source-result');
    const linkContextEl = document.getElementById('quick-link-context');
    const linkTargetInput = document.getElementById('quick-link-target');
    const linkTargetResultEl = document.getElementById('quick-link-target-result');
    const linkKindSelect = document.getElementById('quick-link-kind');
    const linkApplyBtn = document.getElementById('quick-link-apply');
    const tabButtons = Array.from(document.querySelectorAll('.quick-create-tab'));
    const panelEls = Array.from(document.querySelectorAll('.quick-create-panel'));
    const linkDraftTypes = {
        source: TYPES.PERSON,
        target: TYPES.PERSON
    };
    const linkCreateState = {
        source: false,
        target: false
    };

    const defaultBaseName = () => (
        draftTargetType === TYPES.COMPANY
            ? 'Nouvelle entreprise'
            : (draftTargetType === TYPES.GROUP ? 'Nouveau groupe' : 'Nouvelle personne')
    );

    const findNodeByName = (value) => {
        const targetName = String(value || '').trim().toLowerCase();
        if (!targetName) return null;
        return state.nodes.find((node) => String(node.name || '').trim().toLowerCase() === targetName) || null;
    };

    const normalizeNodeName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const getLinkDraftType = (field) => linkDraftTypes[field] || TYPES.PERSON;
    const setLinkDraftType = (field, type) => {
        if (!Object.prototype.hasOwnProperty.call(linkDraftTypes, field)) return;
        linkDraftTypes[field] = TYPE_LABEL[type] ? type : TYPES.PERSON;
    };

    const getLinkEndpoint = (field) => {
        const input = field === 'source' ? linkSourceInput : linkTargetInput;
        const name = normalizeNodeName(input?.value);
        if (!name) return null;
        const existingNode = findNodeByName(name);
        if (existingNode) {
            return {
                mode: 'existing',
                name: existingNode.name,
                type: existingNode.type,
                node: existingNode,
                id: existingNode.id
            };
        }
        return {
            mode: 'draft',
            name,
            type: getLinkDraftType(field),
            node: null,
            id: ''
        };
    };

    const resolveLinkSource = () => {
        const endpoint = getLinkEndpoint('source');
        return endpoint?.mode === 'existing' ? endpoint.node : null;
    };
    const resolveLinkTarget = () => {
        const endpoint = getLinkEndpoint('target');
        return endpoint?.mode === 'existing' ? endpoint.node : null;
    };
    const isDraftEndpoint = (endpoint) => endpoint?.mode === 'draft' && Boolean(endpoint?.name);
    const formatTypeLabelLower = (type) => String(TYPE_LABEL[type] || 'Fiche').toLowerCase();

    const hideLinkResults = (resultsEl) => {
        if (!resultsEl) return;
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
    };

    const queryLinkNodes = (query, options = {}) => {
        const normalizedQuery = String(query || '').trim().toLowerCase();
        const excludeIds = new Set((options.excludeIds || []).map((value) => String(value)));
        if (!normalizedQuery) return [];
        return searchableNodes
            .filter((node) => String(node?.name || '').toLowerCase().includes(normalizedQuery))
            .filter((node) => !excludeIds.has(String(node?.id || '')))
            .slice(0, 8);
    };

    const renderLinkResults = (resultsEl, field, query, nodes, onPick) => {
        if (!resultsEl) return;
        const cleanQuery = normalizeNodeName(query);
        if (!cleanQuery) {
            linkCreateState[field] = false;
            hideLinkResults(resultsEl);
            return;
        }

        const exactMatch = findNodeByName(cleanQuery);
        if (exactMatch) linkCreateState[field] = false;
        const draftType = getLinkDraftType(field);
        const createExpanded = !exactMatch && !!linkCreateState[field];
        const existingHits = nodes.map((node) => `
            <button
                type="button"
                class="quick-create-search-hit"
                data-id="${escapeHtml(String(node.id || ''))}"
                title="${escapeHtml(TYPE_LABEL[node.type] || node.type || '')}"
            >${escapeHtml(String(node.name || 'Sans nom'))}
            </button>
        `).join('');
        const createMarkup = exactMatch ? '' : `
            <div class="quick-create-search-create-wrap ${createExpanded ? 'is-active' : ''}">
                <button type="button" class="quick-create-search-hit quick-create-search-hit-create" data-create-field="${escapeHtml(field)}">
                    Ou creer "${escapeHtml(cleanQuery)}"
                </button>
                ${createExpanded ? `
                    <span class="quick-create-search-create-label">Type</span>
                    <div class="quick-create-type-switch" role="group" aria-label="Type de creation">
                        ${[TYPES.PERSON, TYPES.GROUP, TYPES.COMPANY].map((type) => `
                            <button
                                type="button"
                                class="quick-create-type-chip ${draftType === type ? 'active' : ''}"
                                data-create-field-type="${escapeHtml(field)}"
                                data-type="${escapeHtml(type)}"
                            >${escapeHtml(TYPE_LABEL[type] || type)}</button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        const existingMarkup = (existingHits && !createExpanded) ? `<div class="quick-create-search-list">${existingHits}</div>` : '';
        const emptyMarkup = (!existingHits && !createMarkup)
            ? '<span class="quick-create-search-empty">Aucun resultat</span>'
            : '';

        resultsEl.hidden = false;
        resultsEl.innerHTML = `${existingMarkup}${createMarkup}${emptyMarkup}`;

        Array.from(resultsEl.querySelectorAll('.quick-create-search-hit')).forEach((btn) => {
            btn.onmousedown = (event) => {
                event.preventDefault();
            };
            btn.onclick = () => {
                const createField = btn.getAttribute('data-create-field') || '';
                if (createField) {
                    const input = createField === 'source' ? linkSourceInput : linkTargetInput;
                    if (input) input.value = cleanQuery;
                    linkCreateState[createField] = !linkCreateState[createField];
                    renderLinkResults(resultsEl, createField, cleanQuery, nodes, onPick);
                    updateLinkState();
                    return;
                }
                const nodeId = btn.getAttribute('data-id') || '';
                const pickedNode = state.nodes.find((node) => String(node.id) === String(nodeId)) || null;
                if (pickedNode) {
                    linkCreateState[field] = false;
                    if (typeof onPick === 'function') onPick(pickedNode);
                }
            };
        });

        Array.from(resultsEl.querySelectorAll('.quick-create-type-chip')).forEach((btn) => {
            btn.onmousedown = (event) => {
                event.preventDefault();
                event.stopPropagation();
            };
            btn.onclick = () => {
                const fieldName = btn.getAttribute('data-create-field-type') || '';
                const nextType = btn.getAttribute('data-type') || TYPES.PERSON;
                if (!fieldName) return;
                setLinkDraftType(fieldName, nextType);
                renderLinkResults(resultsEl, fieldName, cleanQuery, nodes, onPick);
                updateLinkState();
            };
        });
    };

    const setLinkKindPlaceholder = (label = 'Choisir source et cible') => {
        if (!linkKindSelect) return;
        linkKindSelect.innerHTML = `<option value="">${escapeHtml(label)}</option>`;
        linkKindSelect.disabled = true;
    };

    const updateKindOptions = () => {
        if (!linkKindSelect) return;
        const source = getLinkEndpoint('source');
        const target = getLinkEndpoint('target');
        const currentKind = String(linkKindSelect.value || '').trim();
        if (!source || !target) {
            setLinkKindPlaceholder();
            return;
        }
        if (
            (source.id && target.id && String(source.id) === String(target.id))
            || source.name.toLowerCase() === target.name.toLowerCase()
        ) {
            setLinkKindPlaceholder('Source et cible identiques');
            return;
        }
        const allowedKinds = Array.from(getAllowedKinds(source.type, target.type));
        linkKindSelect.innerHTML = Array.from(allowedKinds).map((kind) => `
            <option value="${kind}">${linkKindEmoji(kind)} ${kindToLabel(kind)}</option>
        `).join('');
        linkKindSelect.disabled = false;
        if (allowedKinds.includes(currentKind)) {
            linkKindSelect.value = currentKind;
        } else if (allowedKinds.length) {
            linkKindSelect.value = allowedKinds[0];
        }
    };

    const setActiveCreateTab = (tab) => {
        const nextTab = tab === 'link' ? 'link' : 'node';
        tabButtons.forEach((btn) => {
            const isActive = btn.getAttribute('data-create-tab') === nextTab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panelEls.forEach((panel) => {
            panel.classList.toggle('is-hidden', panel.getAttribute('data-panel') !== nextTab);
        });
        if (nextTab === 'link') {
            linkSourceInput?.focus();
        } else {
            nodeInput?.focus();
        }
    };

    const updateNodeState = () => {
        const typedName = String(nodeInput?.value || '').trim();
        const existingNode = typedName
            ? state.nodes.find((node) => String(node.name || '').trim().toLowerCase() === typedName.toLowerCase())
            : null;
        Array.from(document.querySelectorAll('.quick-create-node-btn')).forEach((btn) => {
            const isActive = btn.getAttribute('data-create-type') === draftTargetType;
            btn.classList.toggle('active', isActive);
        });

        if (nodeContextEl) {
            if (existingNode) {
                nodeContextEl.textContent = 'Cette fiche existe deja. Le bouton ouvrira directement cette fiche.';
            } else {
                nodeContextEl.textContent = `Creer une nouvelle ${TYPE_LABEL[draftTargetType] || 'fiche'}.`;
            }
        }

        if (nodeApplyBtn) {
            nodeApplyBtn.textContent = existingNode ? 'Ouvrir la fiche' : 'Creer la fiche';
        }
    };

    const updateLinkState = () => {
        const source = getLinkEndpoint('source');
        const target = getLinkEndpoint('target');
        const sameEndpoint = Boolean(source && target && (
            (source.id && target.id && String(source.id) === String(target.id))
            || source.name.toLowerCase() === target.name.toLowerCase()
        ));
        const usesDraft = isDraftEndpoint(source) || isDraftEndpoint(target);

        if (linkContextEl) {
            if (source && target && !sameEndpoint) {
                if (isDraftEndpoint(source) && isDraftEndpoint(target)) {
                    linkContextEl.textContent = `Creer ${source.name} comme ${formatTypeLabelLower(source.type)} et ${target.name} comme ${formatTypeLabelLower(target.type)}, puis ajouter la liaison.`;
                } else if (isDraftEndpoint(source)) {
                    linkContextEl.textContent = `Creer ${source.name} comme ${formatTypeLabelLower(source.type)} puis le lier a ${target.name}.`;
                } else if (isDraftEndpoint(target)) {
                    linkContextEl.textContent = `Creer ${target.name} comme ${formatTypeLabelLower(target.type)} puis le lier a ${source.name}.`;
                } else {
                    linkContextEl.textContent = `Relier ${source.name} vers ${target.name}.`;
                }
            } else if (source && target) {
                linkContextEl.textContent = 'Choisis deux fiches differentes.';
            } else if (source) {
                linkContextEl.textContent = isDraftEndpoint(source)
                    ? `La source sera creee comme ${formatTypeLabelLower(source.type)}. Choisis maintenant la cible.`
                    : 'Choisis maintenant la cible.';
            } else if (target) {
                linkContextEl.textContent = isDraftEndpoint(target)
                    ? `La cible sera creee comme ${formatTypeLabelLower(target.type)}. Choisis maintenant la source.`
                    : 'Choisis maintenant la source.';
            } else {
                linkContextEl.textContent = 'Tape un nom. Si la fiche n existe pas, elle pourra etre creee ici puis liee directement.';
            }
        }

        if (linkApplyBtn) {
            const ready = source && target && !sameEndpoint;
            linkApplyBtn.textContent = !ready ? 'Choisir source et cible' : (usesDraft ? 'Creer et lier' : 'Lier');
            linkApplyBtn.disabled = !ready;
        }

        updateKindOptions();
    };

    Array.from(document.querySelectorAll('.quick-create-node-btn')).forEach((btn) => {
        btn.onclick = () => {
            draftTargetType = btn.getAttribute('data-create-type') || TYPES.PERSON;
            updateNodeState();
        };
    });
    tabButtons.forEach((btn) => {
        btn.onclick = () => setActiveCreateTab(btn.getAttribute('data-create-tab') || 'node');
    });

    if (nodeInput) {
        nodeInput.oninput = () => updateNodeState();
        nodeInput.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                nodeApplyBtn?.click();
            }
        };
    }

    if (linkSourceInput) {
        linkSourceInput.oninput = () => {
            linkCreateState.source = false;
            renderLinkResults(
                linkSourceResultEl,
                'source',
                linkSourceInput.value,
                queryLinkNodes(linkSourceInput.value, {
                    excludeIds: [resolveLinkTarget()?.id].filter(Boolean)
                }),
                (pickedNode) => {
                    linkSourceInput.value = pickedNode.name;
                    hideLinkResults(linkSourceResultEl);
                    updateLinkState();
                    linkTargetInput?.focus();
                }
            );
            updateLinkState();
        };
        linkSourceInput.onfocus = () => {
            renderLinkResults(
                linkSourceResultEl,
                'source',
                linkSourceInput.value,
                queryLinkNodes(linkSourceInput.value, {
                    excludeIds: [resolveLinkTarget()?.id].filter(Boolean)
                }),
                (pickedNode) => {
                    linkSourceInput.value = pickedNode.name;
                    hideLinkResults(linkSourceResultEl);
                    updateLinkState();
                    linkTargetInput?.focus();
                }
            );
        };
        linkSourceInput.onblur = () => {
            window.setTimeout(() => hideLinkResults(linkSourceResultEl), 120);
        };
        linkSourceInput.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (getLinkEndpoint('source')) linkTargetInput?.focus();
            }
        };
    }

    if (linkTargetInput) {
        linkTargetInput.oninput = () => {
            linkCreateState.target = false;
            renderLinkResults(
                linkTargetResultEl,
                'target',
                linkTargetInput.value,
                queryLinkNodes(linkTargetInput.value, {
                    excludeIds: [resolveLinkSource()?.id].filter(Boolean)
                }),
                (pickedNode) => {
                    linkTargetInput.value = pickedNode.name;
                    hideLinkResults(linkTargetResultEl);
                    updateLinkState();
                }
            );
            updateLinkState();
        };
        linkTargetInput.onfocus = () => {
            renderLinkResults(
                linkTargetResultEl,
                'target',
                linkTargetInput.value,
                queryLinkNodes(linkTargetInput.value, {
                    excludeIds: [resolveLinkSource()?.id].filter(Boolean)
                }),
                (pickedNode) => {
                    linkTargetInput.value = pickedNode.name;
                    hideLinkResults(linkTargetResultEl);
                    updateLinkState();
                }
            );
        };
        linkTargetInput.onblur = () => {
            window.setTimeout(() => hideLinkResults(linkTargetResultEl), 120);
        };
        linkTargetInput.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                linkApplyBtn?.click();
            }
        };
    }

    if (nodeApplyBtn) {
        nodeApplyBtn.onclick = () => {
            const typedName = String(nodeInput?.value || '').trim();
            const finalName = typedName || defaultBaseName();
            const existingTarget = state.nodes.find((node) => String(node.name || '').trim().toLowerCase() === finalName.toLowerCase()) || null;

            if (existingTarget) {
                modalOverlay.style.display = 'none';
                zoomToNode(existingTarget.id);
                return;
            }

            const targetNode = createNodeAtPosition(draftTargetType, finalName, makeSpawnPosition(null, 0, 0));
            logNodeAdded(targetNode.name, actorName);
            refreshLists();
            restartSim();
            scheduleSave();

            modalOverlay.style.display = 'none';
            zoomToNode(targetNode.id);
        };
    }

    if (linkApplyBtn) {
        linkApplyBtn.onclick = () => {
            const sourceEndpoint = getLinkEndpoint('source');
            const targetEndpoint = getLinkEndpoint('target');

            if (!sourceEndpoint || !targetEndpoint) {
                showCustomAlert('Choisis une source et une cible.');
                return;
            }

            if (
                (sourceEndpoint.id && targetEndpoint.id && String(sourceEndpoint.id) === String(targetEndpoint.id))
                || sourceEndpoint.name.toLowerCase() === targetEndpoint.name.toLowerCase()
            ) {
                showCustomAlert('Source et cible identiques.');
                return;
            }

            const createdNodes = [];
            const resolveEndpointNode = (endpoint) => {
                if (endpoint?.mode === 'existing' && endpoint.node) {
                    return endpoint.node;
                }
                const alreadyExisting = findNodeByName(endpoint?.name);
                if (alreadyExisting) return alreadyExisting;
                const viewportCenter = getViewportWorldCenter();
                let spawnPosition = makeSpawnPosition(viewportCenter, 0, 0);
                if (endpoint === sourceEndpoint && targetEndpoint?.mode === 'existing' && targetEndpoint.node) {
                    spawnPosition = makeSpawnPosition(targetEndpoint.node, -120, 0);
                } else if (endpoint === targetEndpoint && sourceEndpoint?.mode === 'existing' && sourceEndpoint.node) {
                    spawnPosition = makeSpawnPosition(sourceEndpoint.node, 120, 0);
                } else if (endpoint === sourceEndpoint) {
                    spawnPosition = makeSpawnPosition(viewportCenter, -72, 0);
                } else if (endpoint === targetEndpoint) {
                    spawnPosition = makeSpawnPosition(viewportCenter, 72, 0);
                }
                const createdNode = createNodeAtPosition(endpoint?.type || TYPES.PERSON, endpoint?.name || defaultBaseName(), spawnPosition);
                createdNodes.push(createdNode);
                return createdNode;
            };

            const sourceNode = resolveEndpointNode(sourceEndpoint);
            const targetNode = resolveEndpointNode(targetEndpoint);

            createdNodes.forEach((node) => logNodeAdded(node.name, actorName));
            if (createdNodes.length) {
                refreshLists();
                restartSim();
            }

            const created = addLink(sourceNode.id, targetNode.id, String(linkKindSelect?.value || '').trim() || null, { actor: actorName });
            if (!created) {
                if (createdNodes.length) scheduleSave();
                showCustomAlert('Lien deja existant ou invalide.');
                return;
            }

            hideLinkResults(linkSourceResultEl);
            hideLinkResults(linkTargetResultEl);
            modalOverlay.style.display = 'none';
            zoomToNode(sourceNode.id);
        };
    }

    updateNodeState();
    updateLinkState();
    setActiveCreateTab('link');

    showModalOverlay();
    linkSourceInput?.focus();
}

function openHvtAssistant() {
    state.hvtMode = true;
    if (state.selection && nodeById(state.selection)) {
        state.hvtSelectedId = state.selection;
    }
    calculateHVT();
    showHvtPanel();
    const btnHVT = document.getElementById('btnHVT');
    if (btnHVT) btnHVT.classList.add('active');
}

function deactivateHvtMode() {
    state.hvtMode = false;
    state.hvtTopIds = new Set();
    state.hvtSelectedId = null;
    const btnHVT = document.getElementById('btnHVT');
    if (btnHVT) btnHVT.classList.remove('active');
    if (hvtPanel) hvtPanel.style.display = 'none';
    draw();
    scheduleSave();
}

function openIntelAssistant(scope = 'selection') {
    state.aiSettings.scope = (scope === 'selection' && state.selection) ? 'selection' : 'global';
    scheduleSave();

    showIntelPanel();
    const btnIntel = document.getElementById('btnIntel');
    if (btnIntel) btnIntel.classList.add('active');
    updateIntelButtonLockVisual();

    const badgeEl = document.getElementById('quickIntelBadge');
    if (badgeEl) badgeEl.textContent = '0';
}

function openOperatorIAMode() {
    openPointAiHub({
        ensureModal: createModal,
        setModalMode,
        getModalOverlay,
        onOpenIntel: () => openIntelAssistant('global'),
        onOpenHvt: openHvtAssistant,
        intelUnlocked: Boolean(state.aiSettings?.intelUnlocked),
    });
}

// --- SYSTÈME DE GESTION DES DONNÉES (MENU) ---

function showRawDataInput(mode) {
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');

    msgEl.innerHTML = `
        <div class="modal-tool">
            <h3 class="modal-tool-title">DATA BRUTE JSON (${mode === 'merge' ? 'FUSION' : 'OUVERTURE'})</h3>
            <textarea id="rawJsonInput" placeholder="Collez le code JSON ici..." class="modal-raw-input"></textarea>
        </div>
    `;

    actEl.innerHTML = '';
    const btnCancel = document.createElement('button');
    btnCancel.innerText = 'ANNULER';
    btnCancel.onclick = () => modalOverlay.style.display = 'none';

    const btnProcess = document.createElement('button');
    btnProcess.innerText = 'TRAITER';
    btnProcess.className = 'primary';
    btnProcess.onclick = () => {
        const txt = document.getElementById('rawJsonInput').value;
        try {
            const json = JSON.parse(txt);
            processData(json, mode);
            modalOverlay.style.display = 'none';
        } catch(e) {
            alert("JSON Invalide");
        }
    };

    actEl.appendChild(btnCancel);
    actEl.appendChild(btnProcess);

    setTimeout(() => document.getElementById('rawJsonInput').focus(), 50);
}

// --- LOGIQUE METIER (IMPORT/EXPORT) ---

function normalizeLinkEndpoint(value) {
    if (value && typeof value === 'object') return String(value.id ?? '');
    return String(value ?? '');
}

function linkSignature(sourceId, targetId, kind) {
    const a = String(sourceId);
    const b = String(targetId);
    const pair = (a < b) ? `${a}|${b}` : `${b}|${a}`;
    return `${pair}|${String(kind || '')}`;
}

function normalizeMergeText(value) {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeMergeDigits(value) {
    return String(value ?? '').replace(/\D+/g, '').trim();
}

function buildTypedMergeKey(type, value, normalizer = normalizeMergeText) {
    const normalizedValue = normalizer(value);
    if (!normalizedValue) return '';
    return `${normalizeMergeText(type)}|${normalizedValue}`;
}

function mergeNameTokens(value, keepInitials = true) {
    return normalizeMergeText(value)
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => keepInitials || token.length > 1);
}

function mergeSurname(value) {
    const tokens = mergeNameTokens(value, false);
    if (!tokens.length) return '';
    return tokens[tokens.length - 1] || '';
}

function isReliableMergePhone(value) {
    const digits = normalizeMergeDigits(value);
    return digits.length >= 7 && !/^(\d)\1+$/.test(digits);
}

function isMergeIdentifierConflict(existingNode, incomingNode, field, normalizer = normalizeMergeText) {
    const left = normalizer(existingNode?.[field]);
    const right = normalizer(incomingNode?.[field]);
    return Boolean(left && right && left !== right);
}

function hasCompatibleMergeIdentity(existingNode, incomingNode) {
    if (!existingNode || !incomingNode) return false;
    if (String(existingNode.type || '') !== String(incomingNode.type || '')) return false;
    if (isMergeIdentifierConflict(existingNode, incomingNode, 'citizenNumber')) return false;
    if (isMergeIdentifierConflict(existingNode, incomingNode, 'accountNumber')) return false;
    return true;
}

function isPersonInitialAlias(existingNode, incomingNode) {
    if (String(existingNode?.type || '') !== TYPES.PERSON || String(incomingNode?.type || '') !== TYPES.PERSON) {
        return false;
    }

    const leftTokens = mergeNameTokens(existingNode.name, true);
    const rightTokens = mergeNameTokens(incomingNode.name, true);
    if (leftTokens.length < 2 || rightTokens.length < 2) return false;

    const leftSurname = mergeSurname(existingNode.name);
    const rightSurname = mergeSurname(incomingNode.name);
    if (!leftSurname || !rightSurname || leftSurname !== rightSurname) return false;

    const leftFirst = leftTokens[0] || '';
    const rightFirst = rightTokens[0] || '';
    if (!leftFirst || !rightFirst || leftFirst[0] !== rightFirst[0]) return false;

    const leftAbbrev = leftTokens.some((token) => token.length === 1);
    const rightAbbrev = rightTokens.some((token) => token.length === 1);
    if (!leftAbbrev && !rightAbbrev) return false;

    return true;
}

function mergeNameQualityScore(name, type) {
    const normalized = normalizeMergeText(name);
    if (!normalized) return -1;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    let score = normalized.length + (tokens.length * 6);
    if (type === TYPES.PERSON) {
        if (tokens.length >= 2) score += 10;
        if (tokens.some((token) => token.length === 1)) score -= 16;
    }
    return score;
}

function choosePreferredMergeName(currentName, nextName, type) {
    const current = String(currentName || '').trim();
    const next = String(nextName || '').trim();
    if (!current) return next;
    if (!next) return current;

    const normalizedCurrent = normalizeMergeText(current);
    const normalizedNext = normalizeMergeText(next);
    if (!normalizedCurrent) return next;
    if (!normalizedNext) return current;
    if (normalizedCurrent === normalizedNext) return next.length > current.length ? next : current;

    return mergeNameQualityScore(next, type) > (mergeNameQualityScore(current, type) + 4)
        ? next
        : current;
}

function mergeTextFieldValue(currentValue, nextValue) {
    const current = String(currentValue || '').trim();
    const next = String(nextValue || '').trim();
    if (!current) return next;
    if (!next) return current;

    const normalizedCurrent = normalizeMergeText(current);
    const normalizedNext = normalizeMergeText(next);
    if (!normalizedCurrent) return next;
    if (!normalizedNext) return current;
    if (normalizedCurrent === normalizedNext) return next.length > current.length ? next : current;
    if (normalizedCurrent.includes(normalizedNext)) return current;
    if (normalizedNext.includes(normalizedCurrent)) return next;
    return `${current}\n\n${next}`;
}

function isDefaultImportedNodeColor(node) {
    const color = sanitizeNodeColor(node?.color);
    if (String(node?.type || '') === TYPES.PERSON) return color === '#ffffff';
    return color === '#cfd8e3';
}

function getUniqueCompatibleIndexedNode(map, key, node, predicate = () => true) {
    if (!key) return null;
    const bucket = map.get(key);
    if (!bucket || !bucket.size) return null;
    const matches = Array.from(bucket).filter((candidate) => candidate && predicate(candidate, node));
    return matches.length === 1 ? matches[0] : null;
}

function isSafeNumMergeCandidate(existingNode, incomingNode) {
    if (!hasCompatibleMergeIdentity(existingNode, incomingNode)) return false;
    const left = normalizeMergeDigits(existingNode?.num);
    const right = normalizeMergeDigits(incomingNode?.num);
    if (!left || !right || left !== right || !isReliableMergePhone(left)) return false;

    const sameName = normalizeMergeText(existingNode?.name) && normalizeMergeText(existingNode?.name) === normalizeMergeText(incomingNode?.name);
    if (sameName) return true;

    if (String(existingNode?.type || '') === TYPES.PERSON) {
        return isPersonInitialAlias(existingNode, incomingNode);
    }

    return false;
}

function pushIndexedNode(map, key, node) {
    if (!key) return;
    let bucket = map.get(key);
    if (!bucket) {
        bucket = new Set();
        map.set(key, bucket);
    }
    bucket.add(node);
}

function getUniqueIndexedNode(map, key) {
    const bucket = map.get(key);
    if (!bucket || bucket.size !== 1) return null;
    return bucket.values().next().value || null;
}

function normalizeImportedNode(rawNode, fallbackId = `node_${uid()}`) {
    const source = rawNode && typeof rawNode === 'object' ? rawNode : {};
    const type = [TYPES.PERSON, TYPES.GROUP, TYPES.COMPANY].includes(source.type) ? source.type : TYPES.PERSON;
    const x = Number(source.x);
    const y = Number(source.y);
    const rawDescription = typeof source.description === 'string' ? source.description : String(source.notes || '');
    const rawNotes = typeof source.notes === 'string' ? source.notes : String(source.description || '');

    return {
        ...source,
        id: String(source.id ?? fallbackId),
        name: String(source.name || '').trim() || 'Sans nom',
        type,
        color: (typeof source.color === 'string' && source.color.trim())
            ? sanitizeNodeColor(source.color.trim())
            : (type === TYPES.PERSON ? '#ffffff' : '#cfd8e3'),
        manualColor: Boolean(source.manualColor),
        personStatus: normalizePersonStatus(source.personStatus, type),
        num: typeof source.num === 'string' ? source.num : String(source.num ?? ''),
        accountNumber: typeof source.accountNumber === 'string' ? source.accountNumber : '',
        citizenNumber: typeof source.citizenNumber === 'string' ? source.citizenNumber : '',
        linkedMapPointId: typeof source.linkedMapPointId === 'string' ? source.linkedMapPointId : String(source.linkedMapPointId ?? ''),
        description: rawDescription,
        notes: rawNotes,
        x: Number.isFinite(x) ? x : (Math.random() - 0.5) * 100,
        y: Number.isFinite(y) ? y : (Math.random() - 0.5) * 100,
        fixed: Boolean(source.fixed)
    };
}

function normalizeImportedLink(rawLink) {
    if (!rawLink || typeof rawLink !== 'object') return null;
    const source = normalizeLinkEndpoint(rawLink.source ?? rawLink.from);
    const target = normalizeLinkEndpoint(rawLink.target ?? rawLink.to);
    if (!source || !target || source === target) return null;

    return {
        id: String(rawLink.id || `link_${uid()}`),
        source,
        target,
        kind: String(rawLink.kind || 'relation')
    };
}

function indexNodeForMerge(indexes, node) {
    if (!node || typeof node !== 'object') return;
    pushIndexedNode(indexes.byId, normalizeMergeText(node.id), node);
    pushIndexedNode(indexes.byCitizenNumber, buildTypedMergeKey(node.type, node.citizenNumber), node);
    pushIndexedNode(indexes.byAccountNumber, buildTypedMergeKey(node.type, node.accountNumber), node);
    pushIndexedNode(indexes.byNum, buildTypedMergeKey(node.type, node.num, normalizeMergeDigits), node);
    pushIndexedNode(indexes.byNameType, `${normalizeMergeText(node.type)}|${normalizeMergeText(node.name)}`, node);
}

function buildNodeMergeIndexes(nodes) {
    const indexes = {
        nodes,
        byId: new Map(),
        byCitizenNumber: new Map(),
        byAccountNumber: new Map(),
        byNum: new Map(),
        byNameType: new Map()
    };

    nodes.forEach((node) => indexNodeForMerge(indexes, node));
    return indexes;
}

function findMergeTarget(indexes, node) {
    const citizenMatch = getUniqueCompatibleIndexedNode(
        indexes.byCitizenNumber,
        buildTypedMergeKey(node.type, node.citizenNumber),
        node,
        (candidate, incomingNode) => hasCompatibleMergeIdentity(candidate, incomingNode)
    );
    if (citizenMatch) return citizenMatch;

    const accountMatch = getUniqueCompatibleIndexedNode(
        indexes.byAccountNumber,
        buildTypedMergeKey(node.type, node.accountNumber),
        node,
        (candidate, incomingNode) => hasCompatibleMergeIdentity(candidate, incomingNode)
    );
    if (accountMatch) return accountMatch;

    const exactNameMatch = getUniqueCompatibleIndexedNode(
        indexes.byNameType,
        `${normalizeMergeText(node.type)}|${normalizeMergeText(node.name)}`,
        node,
        (candidate, incomingNode) => hasCompatibleMergeIdentity(candidate, incomingNode)
    );
    if (exactNameMatch) return exactNameMatch;

    const numMatch = getUniqueCompatibleIndexedNode(
        indexes.byNum,
        buildTypedMergeKey(node.type, node.num, normalizeMergeDigits),
        node,
        (candidate, incomingNode) => isSafeNumMergeCandidate(candidate, incomingNode)
    );
    if (numMatch) return numMatch;

    if (String(node.type || '') === TYPES.PERSON && Array.isArray(indexes.nodes)) {
        const aliasMatches = indexes.nodes.filter((candidate) =>
            candidate
            && String(candidate.id || '') !== String(node.id || '')
            && hasCompatibleMergeIdentity(candidate, node)
            && isPersonInitialAlias(candidate, node)
        );
        if (aliasMatches.length === 1) return aliasMatches[0];
    }

    return null;
}

function mergeImportedNodeIntoExisting(existingNode, incomingNode) {
    if (!existingNode || !incomingNode) return false;

    let changed = false;
    const fillBlank = (field) => {
        const current = String(existingNode[field] ?? '').trim();
        const next = String(incomingNode[field] ?? '').trim();
        if (!current && next) {
            existingNode[field] = incomingNode[field];
            changed = true;
        }
    };

    fillBlank('accountNumber');
    fillBlank('citizenNumber');
    fillBlank('num');
    fillBlank('linkedMapPointId');

    const mergedDescription = mergeTextFieldValue(existingNode.description, incomingNode.description);
    if (mergedDescription !== String(existingNode.description || '')) {
        existingNode.description = mergedDescription;
        changed = true;
    }

    const mergedNotes = mergeTextFieldValue(existingNode.notes, incomingNode.notes);
    if (mergedNotes !== String(existingNode.notes || '')) {
        existingNode.notes = mergedNotes;
        changed = true;
    }

    if ((incomingNode.manualColor && !existingNode.manualColor) || (isDefaultImportedNodeColor(existingNode) && incomingNode.color && existingNode.color !== incomingNode.color)) {
        existingNode.color = incomingNode.color;
        if (incomingNode.manualColor) existingNode.manualColor = true;
        changed = true;
    }

    const preferredName = choosePreferredMergeName(existingNode.name, incomingNode.name, existingNode.type || incomingNode.type);
    if (preferredName && preferredName !== existingNode.name) {
        existingNode.name = preferredName;
        changed = true;
    }

    if (!existingNode.type && incomingNode.type) {
        existingNode.type = incomingNode.type;
        changed = true;
    }

    if (existingNode.type === TYPES.PERSON && incomingNode.type === TYPES.PERSON) {
        const currentStatus = normalizePersonStatus(existingNode.personStatus, existingNode.type);
        const incomingStatus = normalizePersonStatus(incomingNode.personStatus, incomingNode.type);
        const currentPriority = currentStatus === PERSON_STATUS.DECEASED ? 3 : (currentStatus === PERSON_STATUS.INACTIVE ? 2 : (currentStatus === PERSON_STATUS.MISSING ? 1 : 0));
        const incomingPriority = incomingStatus === PERSON_STATUS.DECEASED ? 3 : (incomingStatus === PERSON_STATUS.INACTIVE ? 2 : (incomingStatus === PERSON_STATUS.MISSING ? 1 : 0));
        if (incomingPriority > currentPriority) {
            existingNode.personStatus = incomingStatus;
            changed = true;
        }
    }

    return changed;
}

function downloadJSON() {
    if (isLocalSaveLocked()) {
        showCustomAlert("Export local bloque: seul le lead peut dupliquer/sauvegarder en local.");
        return;
    }

    const data = generateExportData();
    const fileName = buildExportFilename();
    downloadExportData(data, fileName);
}

function handleFileProcess(file, mode) {
    if(!file) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            const d = JSON.parse(r.result);
            processData(d, mode);
        } catch(err) { console.error(err); showCustomAlert('ERREUR FICHIER CORROMPU.'); }
        document.getElementById('fileImport').value = '';
        document.getElementById('fileMerge').value = '';
    };
    r.readAsText(file);
}

function processData(d, mode, options = {}) {
    const silent = Boolean(options && options.silent);
    const shouldCapturePreMutationBackup = !silent && !isCloudBoardActive() && (state.nodes.length || state.links.length);

    if ((mode === 'load' || mode === 'merge') && shouldCapturePreMutationBackup) {
        rememberCurrentLocalWorkspace();
    }

    if (mode === 'load') {
        if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.links)) {
            if (!silent) showCustomAlert('FORMAT DE FICHIER INVALIDE.');
            return false;
        }

        if (!silent && (state.nodes.length || state.links.length)) {
            pushHistory();
        }

        const usedNodeIds = new Set();
        state.nodes = d.nodes.map((rawNode, index) => {
            const node = normalizeImportedNode(rawNode, `node_${uid()}_${index}`);
            while (!node.id || usedNodeIds.has(String(node.id))) {
                node.id = `node_${uid()}_${index}`;
            }
            usedNodeIds.add(String(node.id));
            return node;
        });

        const validNodeIds = new Set(state.nodes.map((node) => String(node.id)));
        const linkIds = new Set();
        const linkSigs = new Set();
        state.links = d.links
            .map((rawLink) => normalizeImportedLink(rawLink))
            .filter((link) => {
                if (!link) return false;
                if (!validNodeIds.has(String(link.source)) || !validNodeIds.has(String(link.target))) return false;

                const sig = linkSignature(link.source, link.target, link.kind);
                if (linkSigs.has(sig)) return false;

                while (!link.id || linkIds.has(String(link.id))) {
                    link.id = `link_${uid()}`;
                }

                linkIds.add(String(link.id));
                linkSigs.add(sig);
                return true;
            });

        state.physicsSettings = normalizePointPhysicsSettings(d.physicsSettings);
        if (d.meta && d.meta.projectName) state.projectName = d.meta.projectName;
        else state.projectName = null;
        intelSuggestions = [];
        state.aiPredictedLinks = [];
        state.aiPreviewPair = null;

        const numericIds = state.nodes.map(n => Number(n.id)).filter(Number.isFinite);
        if (numericIds.length) state.nextId = Math.max(...numericIds) + 1;
        ensureLinkIds();
        updatePersonColors();
        if (!state.nodes.length) {
            state.selection = null;
            clearFocusMode();
            state.hvtSelectedId = null;
            state.view.scale = 0.8;
            state.view.x = 0;
            state.view.y = 0;
        }
        restartSim(); refreshLists();
        if (!state.nodes.length) {
            recenterGraphView({ save: false });
        }
        if (!silent) showCustomAlert('OUVERTURE RÉUSSIE.');
    }
    else if (mode === 'merge') {
        const incomingNodes = Array.isArray(d?.nodes) ? d.nodes : [];
        const incomingLinks = Array.isArray(d?.links) ? d.links : [];

        let addedNodes = 0;
        let enrichedNodes = 0;
        let addedLinks = 0;

        const idMap = new Map();
        const mergeIndexes = buildNodeMergeIndexes(state.nodes);

        if (!silent && (incomingNodes.length || incomingLinks.length)) {
            pushHistory();
        }

        incomingNodes.forEach((rawNode, index) => {
            const rawId = String(rawNode?.id ?? '');
            const normalizedNode = normalizeImportedNode(rawNode, `node_${uid()}_${index}`);
            const existing = findMergeTarget(mergeIndexes, normalizedNode);

            if (existing) {
                if (rawId) idMap.set(rawId, existing.id);
                if (mergeImportedNodeIntoExisting(existing, normalizedNode)) {
                    indexNodeForMerge(mergeIndexes, existing);
                    enrichedNodes++;
                }
                return;
            }

            while (!normalizedNode.id || getUniqueIndexedNode(mergeIndexes.byId, normalizeMergeText(normalizedNode.id)) || state.nodes.some((node) => String(node.id) === String(normalizedNode.id))) {
                normalizedNode.id = `node_${uid()}_${index}`;
            }

            state.nodes.push(normalizedNode);
            indexNodeForMerge(mergeIndexes, normalizedNode);
            if (rawId) idMap.set(rawId, normalizedNode.id);
            addedNodes++;
        });

        const existingLinkSigs = new Set(
            state.links.map(l => linkSignature(
                normalizeLinkEndpoint(l.source),
                normalizeLinkEndpoint(l.target),
                l.kind
            ))
        );
        const existingLinkIds = new Set(state.links.map(l => String(l.id)));

        incomingLinks.forEach((rawLink) => {
            if (!rawLink) return;

            const sourceRaw = normalizeLinkEndpoint(rawLink.source ?? rawLink.from);
            const targetRaw = normalizeLinkEndpoint(rawLink.target ?? rawLink.to);
            if (!sourceRaw || !targetRaw) return;

            const mappedSource = idMap.get(sourceRaw) ?? sourceRaw;
            const mappedTarget = idMap.get(targetRaw) ?? targetRaw;
            if (!mappedSource || !mappedTarget) return;
            if (String(mappedSource) === String(mappedTarget)) return;

            const sourceExists = state.nodes.some(n => String(n.id) === String(mappedSource));
            const targetExists = state.nodes.some(n => String(n.id) === String(mappedTarget));
            if (!sourceExists || !targetExists) return;

            const kind = rawLink.kind || 'relation';
            const sig = linkSignature(mappedSource, mappedTarget, kind);
            if (existingLinkSigs.has(sig)) return;

            let nextId = String(rawLink.id ?? '');
            if (!nextId || existingLinkIds.has(nextId)) {
                do {
                    nextId = `link_${uid()}`;
                } while (existingLinkIds.has(nextId));
            }

            state.links.push({
                id: nextId,
                source: mappedSource,
                target: mappedTarget,
                kind
            });

            existingLinkIds.add(nextId);
            existingLinkSigs.add(sig);
            addedLinks++;
        });

        ensureLinkIds();
        intelSuggestions = [];
        state.aiPredictedLinks = [];
        state.aiPreviewPair = null;
        updatePersonColors();
        restartSim();
        refreshLists();
        if (!state.projectName && d?.meta?.projectName) {
            state.projectName = d.meta.projectName;
        }
        if (!silent) {
            showCustomAlert(`FUSION : ${addedNodes} NOUVEAUX ÉLÉMENTS, ${enrichedNodes} FICHES ENRICHIES, ${addedLinks} NOUVEAUX LIENS.`);
        }
    }
    saveState();
    return true;
}

// --- HUD SETUP ---
function setupHudButtons() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    hud.hidden = false;
    hud.innerHTML = '';

    const labelModes = [
        { value: 1, short: 'Auto', title: 'Mode normal' },
        { value: 2, short: 'Tous', title: 'Toujours afficher tous les noms' },
        { value: 0, short: 'Off', title: 'Masquer tous les noms' }
    ];
    const modeOptions = [
        { value: FILTERS.ALL, short: 'Global', icon: 'global', title: 'Voir tout le reseau' },
        { value: FILTERS.BUSINESS, short: 'Business', icon: 'business', title: 'Favorise les liens business' },
        { value: FILTERS.ILLEGAL, short: 'Conflit', icon: 'conflict', title: 'Favorise les tensions et conflits' },
        { value: FILTERS.SOCIAL, short: 'Social', icon: 'social', title: 'Favorise les liens sociaux' }
    ];
    let modeDrawerOpen = false;

    const iconMarkup = {
        labels: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3v-1.2c0-2.1-1.8-3.8-4-3.8s-4 1.7-4 3.8V20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 10c-1.65 0-3 .93-3 2.08V19h6v-.92C15 17.93 13.65 17 12 17z"/>
            </svg>
        `,
        links: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8.7 15.3a3 3 0 0 1 0-4.24l2.12-2.12 1.42 1.42-2.12 2.12a1 1 0 0 0 1.42 1.42l2.12-2.12 1.42 1.42-2.12 2.12a3 3 0 0 1-4.24 0zm6.6-6.6a3 3 0 0 1 0 4.24l-2.12 2.12-1.42-1.42 2.12-2.12a1 1 0 1 0-1.42-1.42l-2.12 2.12-1.42-1.42 2.12-2.12a3 3 0 0 1 4.24 0z"/>
            </svg>
        `,
        recenter: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 2h2v3.07A7.002 7.002 0 0 1 18.93 11H22v2h-3.07A7.002 7.002 0 0 1 13 18.93V22h-2v-3.07A7.002 7.002 0 0 1 5.07 13H2v-2h3.07A7.002 7.002 0 0 1 11 5.07zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
            </svg>
        `,
        info: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 10h2v7h-2zm0-3h2v2h-2zm1-5a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>
            </svg>
        `,
        settings: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.04 7.04 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.43 7.43 0 0 0-.05.94c0 .32.02.63.05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"/>
            </svg>
        `,
        global: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2c5.52 0 10 4.48 10 10s-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm6.93 9h-3.06a15.4 15.4 0 0 0-1.18-4.96A8.03 8.03 0 0 1 18.93 11zM12 4c.72 0 2.01 1.87 2.5 5h-5C9.99 5.87 11.28 4 12 4zm-4.5 7a13.38 13.38 0 0 0 0 2h5v-2zm0 4a15.4 15.4 0 0 0 1.18 4.96A8.03 8.03 0 0 1 5.07 15zm4.5 5c-.72 0-2.01-1.87-2.5-5h5c-.49 3.13-1.78 5-2.5 5zm2.69-.04A15.4 15.4 0 0 0 15.87 15h3.06a8.03 8.03 0 0 1-4.24 4.96zM15 13h-6v-2h6a13.38 13.38 0 0 1 0 2zM8.13 9H5.07a8.03 8.03 0 0 1 4.24-4.96A15.4 15.4 0 0 0 8.13 9z"/>
            </svg>
        `,
        business: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6h3.5A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9A1.5 1.5 0 0 1 5.5 6zm2 0h2V5h-2zm-5 4h12v6H6z"/>
            </svg>
        `,
        conflict: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.05 4.64 9.88 7.46 8.46 8.88 5.64 6.05zm9.9 0 1.41 1.41-2.82 2.83-1.41-1.42zM10 10l4 4-1.5 1.5-1.29-1.29-3.5 3.5-1.42-1.42 3.5-3.5L8.5 11.5zm4-4 1.5-1.5 3.86 3.86-1.5 1.5zM6.05 14.12l1.41 1.41-2.82 2.83-1.42-1.42z"/>
            </svg>
        `,
        social: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s-6.72-4.34-9.19-8.08C.63 9.6 2.2 5.5 6.12 5.08 8.1 4.87 9.69 5.78 10.7 7.2 11.71 5.78 13.3 4.87 15.28 5.08c3.92.42 5.49 4.52 3.31 7.84C18.72 16.66 12 21 12 21z"/>
            </svg>
        `,
        zoomIn: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.71 11.29L16.4 15l-1.4 1.4 2.3 2.31zM9 9V7h2v2h2v2h-2v2H9v-2H7V9z"/>
            </svg>
        `,
        zoomOut: `
            <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.71 11.29L16.4 15l-1.4 1.4 2.3 2.31zM7 9h6v2H7z"/>
            </svg>
        `
    };

    const setHudButtonContent = (button, icon, label, value = '') => {
        button.innerHTML = `
            <span class="hud-btn-icon">${iconMarkup[icon] || ''}</span>
            <span class="hud-btn-copy">
                <span class="hud-btn-label">${escapeHtml(label)}</span>
                ${value ? `<span class="hud-btn-value">${escapeHtml(value)}</span>` : ''}
            </span>
        `;
        button.classList.toggle('has-meta', !!value);
        button.classList.toggle('no-meta', !value);
    };

    const createHudButton = (className = 'hud-btn hud-stack-btn') => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        return button;
    };
    const createHudIconButton = (icon, title, onClick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hud-btn hud-tool-btn';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = `<span class="hud-btn-icon">${iconMarkup[icon] || ''}</span>`;
        button.onclick = onClick;
        return button;
    };

    const updateHudView = () => {
        updateLinkLegend();
        draw();
        scheduleSave();
    };

    const btnRecenter = createHudButton('hud-btn hud-stack-btn hud-primary-btn');
    setHudButtonContent(btnRecenter, 'recenter', 'Recentrer');
    btnRecenter.title = 'Recentrer la vue sur l ensemble du reseau';
    btnRecenter.onclick = () => recenterGraphView();
    hud.appendChild(btnRecenter);

    const btnLinkTypes = createHudButton('hud-btn hud-stack-btn');
    const updateLinkTypesBtn = () => {
        setHudButtonContent(btnLinkTypes, 'links', 'Liens', state.showLinkTypes ? 'Types' : 'Normal');
        btnLinkTypes.classList.toggle('active', !!state.showLinkTypes);
    };
    updateLinkTypesBtn();
    btnLinkTypes.onclick = () => {
        state.showLinkTypes = !state.showLinkTypes;
        updateLinkTypesBtn();
        updateHudView();
    };
    hud.appendChild(btnLinkTypes);

    const btnLabels = createHudButton('hud-btn hud-stack-btn');
    const updateLabelBtn = () => {
        const current = labelModes.find((entry) => entry.value === state.labelMode) || labelModes[0];
        setHudButtonContent(btnLabels, 'labels', 'Noms', current.short);
        btnLabels.title = current.title;
        btnLabels.classList.toggle('active', state.labelMode !== 1);
        btnLabels.classList.toggle('is-off', state.labelMode === 0);
    };
    updateLabelBtn();
    btnLabels.onclick = () => {
        const currentIndex = labelModes.findIndex((entry) => entry.value === state.labelMode);
        const next = labelModes[(currentIndex + 1 + labelModes.length) % labelModes.length] || labelModes[0];
        state.labelMode = next.value;
        updateLabelBtn();
        draw();
        scheduleSave();
    };
    hud.appendChild(btnLabels);

    const filterCard = document.createElement('div');
    filterCard.className = 'hud-filter-card hud-filter-drawer';
    const btnModeFilter = createHudButton('hud-btn hud-stack-btn hud-filter-trigger');
    btnModeFilter.type = 'button';
    btnModeFilter.onclick = (event) => {
        event.stopPropagation();
        modeDrawerOpen = !modeDrawerOpen;
        updateFilterControls();
    };
    filterCard.appendChild(btnModeFilter);

    const filterOptionsWrap = document.createElement('div');
    filterOptionsWrap.className = 'hud-filter-options';
    filterOptionsWrap.addEventListener('click', (event) => event.stopPropagation());

    const filterOptionButtons = [];
    const updateFilterControls = () => {
        const selectedEntry = modeOptions.find((entry) => entry.value === state.activeFilter) || modeOptions[0];

        setHudButtonContent(btnModeFilter, selectedEntry.icon, 'Mode', selectedEntry.short);
        btnModeFilter.title = selectedEntry.title;
        btnModeFilter.classList.toggle('active', state.activeFilter !== FILTERS.ALL);
        btnModeFilter.setAttribute('aria-expanded', modeDrawerOpen ? 'true' : 'false');
        filterCard.classList.toggle('expanded', modeDrawerOpen);

        filterOptionButtons.forEach(({ button, entry }) => {
            const active = state.activeFilter === entry.value;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    };
    modeOptions.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hud-filter-option';
        button.title = entry.title;
        button.innerHTML = `
            <span class="hud-filter-option-icon">${iconMarkup[entry.icon] || ''}</span>
            <span class="hud-filter-option-label">${escapeHtml(entry.short)}</span>
        `;
        button.onclick = (event) => {
            event.stopPropagation();
            state.activeFilter = entry.value;
            modeDrawerOpen = false;
            updateFilterControls();
            updateHudView();
        };
        filterOptionsWrap.appendChild(button);
        filterOptionButtons.push({ button, entry });
    });
    filterCard.appendChild(filterOptionsWrap);
    updateFilterControls();
    hud.appendChild(filterCard);

    if (hud.__modeOutsideHandler) {
        document.removeEventListener('click', hud.__modeOutsideHandler);
    }
    hud.__modeOutsideHandler = (event) => {
        if (!modeDrawerOpen) return;
        if (hud.contains(event.target)) return;
        modeDrawerOpen = false;
        updateFilterControls();
    };
    document.addEventListener('click', hud.__modeOutsideHandler);

    const toolbar = document.createElement('div');
    toolbar.className = 'hud-toolbar';
    toolbar.appendChild(createHudIconButton('zoomOut', 'Zoom arriere', () => stepGraphZoom(-1)));
    toolbar.appendChild(createHudIconButton('zoomIn', 'Zoom avant', () => stepGraphZoom(1)));
    toolbar.appendChild(createHudIconButton('settings', 'Ouvrir les parametres et presets de vision reseau', () => showSettings()));
    hud.appendChild(toolbar);
}

function ensureHvtPanel() {
    if (hvtPanel) return;
    hvtPanel = document.createElement('div');
    hvtPanel.id = 'hvt-panel';
    hvtPanel.innerHTML = `
        <div class="hvt-header">
            <div class="hvt-title">HVT RANKING</div>
            <div class="hvt-close" id="btnHvtPanelClose">✕</div>
        </div>
        <div class="hvt-sub">
            <span id="hvt-subtitle">Top</span>
            <span id="hvt-count"></span>
        </div>
        <div id="hvt-list"></div>
        <div id="hvt-details"></div>
    `;
    document.body.appendChild(hvtPanel);
    const closeBtn = document.getElementById('btnHvtPanelClose');
    if (closeBtn) closeBtn.onclick = () => deactivateHvtMode();

    const header = hvtPanel.querySelector('.hvt-header');
    if (header) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target && e.target.closest('#btnHvtPanelClose')) return;
            const rect = hvtPanel.getBoundingClientRect();
            isDragging = true;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            hvtPanel.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;
            const maxX = window.innerWidth - hvtPanel.offsetWidth - 10;
            const maxY = window.innerHeight - hvtPanel.offsetHeight - 10;
            x = Math.max(10, Math.min(x, maxX));
            y = Math.max(10, Math.min(y, maxY));
            hvtPanel.style.left = `${x}px`;
            hvtPanel.style.top = `${y}px`;
            hvtPanel.style.right = 'auto';
        });

        window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            hvtPanel.classList.remove('dragging');
        });
    }
}

function showHvtPanel() {
    ensureHvtPanel();
    hvtPanel.style.display = 'flex';
    updateHvtPanel();
}

function hideHvtPanel() {
    deactivateHvtMode();
}

export function updateHvtPanel() {
    if (!hvtPanel || hvtPanel.style.display === 'none') return;
    const listEl = document.getElementById('hvt-list');
    const detailsEl = document.getElementById('hvt-details');
    const subtitleEl = document.getElementById('hvt-subtitle');
    const countEl = document.getElementById('hvt-count');
    if (!listEl || !detailsEl) return;

    const ranked = [...state.nodes]
        .filter(n => (n.hvtScore || 0) > 0)
        .sort((a, b) => (b.hvtScore || 0) - (a.hvtScore || 0));
    const limit = (state.hvtTopN && state.hvtTopN > 0) ? state.hvtTopN : Math.min(20, ranked.length);
    const rankById = new Map(ranked.map((node, index) => [String(node.id), index + 1]));
    let list = ranked.slice(0, limit);
    const currentSelected = nodeById(state.hvtSelectedId);
    if (currentSelected && !list.some((node) => String(node.id) === String(currentSelected.id))) {
        list = [currentSelected, ...list].slice(0, limit);
    }
    const label = (state.hvtTopN && state.hvtTopN > 0) ? `Top ${state.hvtTopN}` : `Top ${limit}`;
    if (subtitleEl) subtitleEl.textContent = label;
    if (countEl) countEl.textContent = `${list.length}/${ranked.length}`;

    if (list.length === 0) {
        listEl.innerHTML = '<div style="padding:8px; color:#666; text-align:center;">Aucun HVT détecté</div>';
        detailsEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = list.map((n, i) => {
        const score = Math.round((n.hvtScore || 0) * 100);
        const typeLabel = TYPE_LABEL[n.type] || n.type;
        const isActive = String(n.id) === String(state.hvtSelectedId);
        const rank = rankById.get(String(n.id)) || (i + 1);
        return `
            <div class="hvt-row ${isActive ? 'active' : ''}" data-id="${n.id}">
                <div class="hvt-rank">#${rank}</div>
                <div class="hvt-name">${escapeHtml(n.name)}</div>
                <div class="hvt-type">${typeLabel}</div>
                <div class="hvt-score">${score}%</div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.hvt-row').forEach(row => {
        row.onclick = () => {
            const id = row.dataset.id;
            state.hvtSelectedId = id;
            const node = nodeById(id);
            if (node) {
                zoomToNode(node.id);
            }
        };
    });

    const selected = nodeById(state.hvtSelectedId) || list[0];
    if (!selected) { detailsEl.innerHTML = ''; return; }
    state.hvtSelectedId = selected.id;
    detailsEl.innerHTML = renderHvtDetails(selected);
}

function renderHvtDetails(n) {
    const links = state.links.filter(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        return s === n.id || t === n.id;
    });
    const influenceLinks = links.filter((link) => (Number(link.hvtInfluence) || 0) > 0.18);
    const neighbors = new Map();
    const kindCounts = {};
    links.forEach(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        const otherId = (s === n.id) ? t : s;
        neighbors.set(otherId, (neighbors.get(otherId) || 0) + 1);
        kindCounts[l.kind] = (kindCounts[l.kind] || 0) + 1;
    });
    const topKinds = Object.entries(kindCounts)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, c]) => `<span class="hvt-tag">${linkKindEmoji(k)} ${kindToLabel(k)} ×${c}</span>`)
        .join('') || '<span class="hvt-tag">Aucun</span>';

    const topNeighbors = [...neighbors.entries()]
        .sort((a,b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, c]) => {
            const other = nodeById(id);
            if (!other) return '';
            const influence = Math.round((Number(other.hvtInfluence) || 0) * 100);
            const suffix = influence > 0 ? ` · ${influence}%` : '';
            return `<span class="hvt-tag">${escapeHtml(other.name)} ×${c}${suffix}</span>`;
        })
        .filter(Boolean)
        .join('') || '<span class="hvt-tag">Aucun</span>';

    const score = Math.round((n.hvtScore || 0) * 100);
    const influence = Math.round((Number(n.hvtInfluence) || 0) * 100);
    return `
        <div class="hvt-detail-title">Détails</div>
        <div class="hvt-detail-name">${escapeHtml(n.name)}</div>
        <div class="hvt-detail-row"><span>Type</span><span>${TYPE_LABEL[n.type] || n.type}</span></div>
        <div class="hvt-detail-row"><span>Score HVT</span><span>${score}%</span></div>
        <div class="hvt-detail-row"><span>Influence visible</span><span>${influence}%</span></div>
        <div class="hvt-detail-row"><span>Liens</span><span>${links.length}</span></div>
        <div class="hvt-detail-row"><span>Relations uniques</span><span>${neighbors.size}</span></div>
        <div class="hvt-detail-row"><span>Ruissellement</span><span>${influenceLinks.length}</span></div>
        <div class="hvt-detail-sub">Types dominants</div>
        <div class="hvt-tags">${topKinds}</div>
        <div class="hvt-detail-sub">Propagation visible</div>
        <div class="hvt-tags">${topNeighbors}</div>
    `;
}

export function refreshHvt() {
    if (!state.hvtMode) return;
    calculateHVT();
    updateHvtPanel();
}

// --- INTEL PANEL (PREDICTION DE LIENS) ---
function ensureIntelPanel() {
    if (intelPanel) return;
    intelPanel = document.createElement('div');
    intelPanel.id = 'intel-panel';
    intelPanel.innerHTML = `
        <div class="intel-header">
            <div>
                <div class="intel-title">LINK INTEL</div>
                <div class="intel-sub">Suggestions de liens prêtes a valider</div>
            </div>
            <div class="intel-close" id="btnIntelClose">✕</div>
        </div>
        <div class="intel-toolbar">
            <div class="intel-toolbar-row">
                <div class="intel-toolbar-label">Portee</div>
                <div class="intel-preset-group intel-grow">
                    <button id="intelScopeFocus" class="mini-btn">Cible active</button>
                    <button id="intelScopeGlobal" class="mini-btn">Reseau</button>
                </div>
                <span id="intelScopeName" class="intel-badge">--</span>
            </div>
            <div class="intel-toolbar-row">
                <div class="intel-toolbar-label">Preset</div>
                <div class="intel-preset-group intel-grow">
                    <button id="intelPresetQuick" class="mini-btn intel-preset-btn">Rapide</button>
                    <button id="intelPresetBalanced" class="mini-btn intel-preset-btn">Equilibre</button>
                    <button id="intelPresetWide" class="mini-btn intel-preset-btn">Large</button>
                </div>
            </div>
            <div class="intel-toolbar-row intel-toolbar-row-actions">
                <label class="intel-simple-toggle"><input id="intelShowPredicted" type="checkbox"/>Overlay</label>
                <label class="intel-simple-toggle"><input id="intelExplain" type="checkbox"/>Explications</label>
                <span id="intelCount" class="intel-badge">0</span>
                <button id="intelRun" class="mini-btn primary">Analyser</button>
                <button id="intelClear" class="mini-btn">Effacer</button>
            </div>
        </div>
        <details class="intel-advanced">
            <summary>Reglages avances</summary>
            <div class="intel-controls">
                <div class="intel-row">
                    <label>Mode</label>
                    <select id="intelMode" class="intel-select intel-grow">
                        <option value="serieux">Serieux</option>
                        <option value="decouverte">Decouverte</option>
                        <option value="creatif">Creatif</option>
                    </select>
                </div>
                <div class="intel-row">
                    <label>Seuil</label>
                    <input id="intelMinScore" type="range" min="10" max="90" step="1" class="intel-grow"/>
                    <span id="intelMinScoreVal" class="intel-badge">35%</span>
                </div>
                <div class="intel-row">
                    <label>Nouvel.</label>
                    <input id="intelNovelty" type="range" min="0" max="60" step="1" class="intel-grow"/>
                    <span id="intelNoveltyVal" class="intel-badge">25%</span>
                </div>
                <div class="intel-row">
                    <label>Quantite</label>
                    <input id="intelLimit" type="number" min="5" max="80" class="intel-input intel-limit-input"/>
                </div>
                <div class="intel-row intel-row-sources">
                    <label>Sources</label>
                    <div class="intel-toggle">
                        <label><input type="checkbox" id="intelSrcGraph"/>Graph</label>
                        <label><input type="checkbox" id="intelSrcText"/>Texte</label>
                        <label><input type="checkbox" id="intelSrcTags"/>Tags</label>
                        <label><input type="checkbox" id="intelSrcProfile"/>Profil</label>
                        <label><input type="checkbox" id="intelSrcBridge"/>Ponts</label>
                        <label><input type="checkbox" id="intelSrcLex"/>Lexique</label>
                        <label><input type="checkbox" id="intelSrcGeo"/>Geo</label>
                    </div>
                </div>
            </div>
        </details>
        <div id="intel-list" class="intel-results"></div>
    `;
    document.body.appendChild(intelPanel);

    const closeBtn = document.getElementById('btnIntelClose');
    if (closeBtn) closeBtn.onclick = () => {
        const btn = document.getElementById('btnIntel');
        if (btn) btn.classList.remove('active');
        hideIntelPanel();
    };

    const header = intelPanel.querySelector('.intel-header');
    if (header) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target && e.target.closest('#btnIntelClose')) return;
            const rect = intelPanel.getBoundingClientRect();
            isDragging = true;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            intelPanel.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;
            const maxX = window.innerWidth - intelPanel.offsetWidth - 10;
            const maxY = window.innerHeight - intelPanel.offsetHeight - 10;
            x = Math.max(10, Math.min(x, maxX));
            y = Math.max(10, Math.min(y, maxY));
            intelPanel.style.left = `${x}px`;
            intelPanel.style.top = `${y}px`;
            intelPanel.style.right = 'auto';
        });

        window.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            intelPanel.classList.remove('dragging');
        });
    }

    setupIntelControls();
}

function setupIntelControls() {
    const modeSel = document.getElementById('intelMode');
    const scopeFocus = document.getElementById('intelScopeFocus');
    const scopeGlobal = document.getElementById('intelScopeGlobal');
    const presetQuick = document.getElementById('intelPresetQuick');
    const presetBalanced = document.getElementById('intelPresetBalanced');
    const presetWide = document.getElementById('intelPresetWide');
    const scopeName = document.getElementById('intelScopeName');
    const srcGraph = document.getElementById('intelSrcGraph');
    const srcText = document.getElementById('intelSrcText');
    const srcTags = document.getElementById('intelSrcTags');
    const srcProfile = document.getElementById('intelSrcProfile');
    const srcBridge = document.getElementById('intelSrcBridge');
    const srcLex = document.getElementById('intelSrcLex');
    const srcGeo = document.getElementById('intelSrcGeo');
    const minScore = document.getElementById('intelMinScore');
    const minScoreVal = document.getElementById('intelMinScoreVal');
    const novelty = document.getElementById('intelNovelty');
    const noveltyVal = document.getElementById('intelNoveltyVal');
    const limitInp = document.getElementById('intelLimit');
    const explainChk = document.getElementById('intelExplain');
    const showPredicted = document.getElementById('intelShowPredicted');
    const btnRun = document.getElementById('intelRun');
    const btnClear = document.getElementById('intelClear');

    if (!state.aiSettings.preset) state.aiSettings.preset = 'balanced';

    const syncPresetButtons = () => {
        const current = String(state.aiSettings.preset || '');
        if (presetQuick) presetQuick.classList.toggle('active', current === 'quick');
        if (presetBalanced) presetBalanced.classList.toggle('active', current === 'balanced');
        if (presetWide) presetWide.classList.toggle('active', current === 'wide');
    };

    const updateScopeName = () => {
        const n = nodeById(state.selection);
        if (scopeName) scopeName.textContent = n ? n.name : 'Aucune';
    };

    const setScope = (scope) => {
        state.aiSettings.scope = scope;
        if (scopeFocus) scopeFocus.classList.toggle('active', scope === 'selection');
        if (scopeGlobal) scopeGlobal.classList.toggle('active', scope === 'global');
        updateScopeName();
        scheduleSave();
    };

    const syncControlsFromState = () => {
        if (modeSel) modeSel.value = state.aiSettings.mode || 'decouverte';
        if (minScore) minScore.value = Math.round((state.aiSettings.minScore || 0.35) * 100);
        if (minScoreVal && minScore) minScoreVal.textContent = `${minScore.value}%`;
        if (novelty) novelty.value = Math.round((state.aiSettings.noveltyRatio || 0.25) * 100);
        if (noveltyVal && novelty) noveltyVal.textContent = `${novelty.value}%`;
        if (limitInp) limitInp.value = state.aiSettings.limit || 20;
        if (explainChk) explainChk.checked = state.aiSettings.showReasons !== false;
        if (showPredicted) showPredicted.checked = state.aiSettings.showPredicted !== false;

        const sources = state.aiSettings.sources || {};
        if (srcGraph) srcGraph.checked = sources.graph !== false;
        if (srcText) srcText.checked = sources.text !== false;
        if (srcTags) srcTags.checked = sources.tags !== false;
        if (srcProfile) srcProfile.checked = sources.profile !== false;
        if (srcBridge) srcBridge.checked = sources.bridge !== false;
        if (srcLex) srcLex.checked = sources.lex !== false;
        if (srcGeo) srcGeo.checked = sources.geo !== false;

        setScope(state.aiSettings.scope || 'selection');
        syncPresetButtons();
    };

    const applyPreset = (presetName) => {
        const preset = INTEL_PRESETS[presetName];
        if (!preset) return;
        state.aiSettings.preset = presetName;
        state.aiSettings.mode = preset.mode;
        state.aiSettings.minScore = preset.minScore;
        state.aiSettings.noveltyRatio = preset.noveltyRatio;
        state.aiSettings.limit = preset.limit;
        state.aiSettings.sources = { ...preset.sources };
        syncControlsFromState();
        scheduleSave();
        updateIntelPanel(true);
    };

    syncControlsFromState();

    if (modeSel) modeSel.onchange = () => {
        state.aiSettings.mode = modeSel.value;
        state.aiSettings.preset = 'custom';
        syncPresetButtons();
        scheduleSave();
        updateIntelPanel(true);
    };
    if (scopeFocus) scopeFocus.onclick = () => { setScope('selection'); updateIntelPanel(true); };
    if (scopeGlobal) scopeGlobal.onclick = () => { setScope('global'); updateIntelPanel(true); };
    if (presetQuick) presetQuick.onclick = () => applyPreset('quick');
    if (presetBalanced) presetBalanced.onclick = () => applyPreset('balanced');
    if (presetWide) presetWide.onclick = () => applyPreset('wide');

    if (minScore) minScore.oninput = () => {
        const val = Number(minScore.value) || 0;
        if (minScoreVal) minScoreVal.textContent = `${val}%`;
        state.aiSettings.minScore = clamp(val / 100, 0.1, 0.9);
        state.aiSettings.preset = 'custom';
        syncPresetButtons();
        scheduleSave();
    };
    if (minScore) minScore.onchange = () => updateIntelPanel(true);

    if (novelty) novelty.oninput = () => {
        const val = Number(novelty.value) || 0;
        if (noveltyVal) noveltyVal.textContent = `${val}%`;
        state.aiSettings.noveltyRatio = clamp(val / 100, 0, 0.6);
        state.aiSettings.preset = 'custom';
        syncPresetButtons();
        scheduleSave();
    };
    if (novelty) novelty.onchange = () => updateIntelPanel(true);

    if (limitInp) limitInp.onchange = () => {
        const val = Number(limitInp.value) || 20;
        state.aiSettings.limit = Math.max(5, Math.min(val, 80));
        limitInp.value = state.aiSettings.limit;
        state.aiSettings.preset = 'custom';
        syncPresetButtons();
        scheduleSave();
        updateIntelPanel(true);
    };

    if (explainChk) explainChk.onchange = () => {
        state.aiSettings.showReasons = explainChk.checked;
        scheduleSave();
        updateIntelPanel(true);
    };
    if (showPredicted) showPredicted.onchange = () => {
        state.aiSettings.showPredicted = showPredicted.checked;
        scheduleSave();
        draw();
    };

    const syncSources = () => {
        state.aiSettings.sources = {
            graph: srcGraph?.checked !== false,
            text: srcText?.checked !== false,
            tags: srcTags?.checked !== false,
            profile: srcProfile?.checked !== false,
            bridge: srcBridge?.checked !== false,
            lex: srcLex?.checked !== false,
            geo: srcGeo?.checked !== false
        };
        scheduleSave();
    };
    [srcGraph, srcText, srcTags, srcProfile, srcBridge, srcLex, srcGeo].forEach(el => {
        if (!el) return;
        el.onchange = () => {
            state.aiSettings.preset = 'custom';
            syncPresetButtons();
            syncSources();
            updateIntelPanel(true);
        };
    });

    if (btnRun) btnRun.onclick = () => {
        state.aiSettings.showPredicted = true;
        if (showPredicted) showPredicted.checked = true;
        scheduleSave();
        updateIntelPanel(true);
    };
    if (btnClear) btnClear.onclick = () => {
        intelSuggestions = [];
        state.aiPredictedLinks = [];
        clearIntelPairPreview({ redraw: false, syncRows: false });
        draw();
        const listEl = document.getElementById('intel-list');
        const countEl = document.getElementById('intelCount');
        if (listEl) listEl.innerHTML = '<div class="intel-empty-state">Analyse effacee</div>';
        if (countEl) countEl.textContent = '0';
    };

    updateScopeName();
}

function showIntelPanel() {
    ensureIntelPanel();
    intelPanel.style.display = 'flex';
    updateIntelPanel(true);
}

function isActiveIntelPreviewPair(aId, bId) {
    if (!state.aiPreviewPair) return false;
    const left = String(aId || '');
    const right = String(bId || '');
    const previewA = String(state.aiPreviewPair.aId || '');
    const previewB = String(state.aiPreviewPair.bId || '');
    return (left === previewA && right === previewB) || (left === previewB && right === previewA);
}

function syncIntelPreviewRows() {
    const listEl = document.getElementById('intel-list');
    if (!listEl) return;
    listEl.querySelectorAll('.intel-item').forEach((row) => {
        row.classList.toggle('is-previewing', isActiveIntelPreviewPair(row.dataset.a, row.dataset.b));
    });
}

export function clearIntelPairPreview(options = {}) {
    if (!state.aiPreviewPair) return;
    state.aiPreviewPair = null;
    if (options.syncRows !== false) syncIntelPreviewRows();
    if (options.redraw !== false) draw();
}

function setIntelPairPreview(aId, bId, meta = {}) {
    state.aiPreviewPair = {
        aId: String(aId || ''),
        bId: String(bId || ''),
        actionType: String(meta.actionType || 'link'),
        kind: String(meta.kind || '')
    };
    syncIntelPreviewRows();
}

function hideIntelPanel() {
    clearIntelPairPreview({ redraw: false });
    if (intelPanel) intelPanel.style.display = 'none';
    draw();
}

function centerOnPair(aId, bId, meta = {}) {
    const a = nodeById(aId);
    const b = nodeById(bId);
    if (!a || !b) return;

    const canvas = document.getElementById('graph');
    const viewportWidth = Number(canvas?.clientWidth || canvas?.width || window.innerWidth || 0);
    const viewportHeight = Number(canvas?.clientHeight || canvas?.height || window.innerHeight || 0);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

    if (viewportWidth && viewportHeight) {
        const spanX = Math.max(240, Math.abs(Number(a.x || 0) - Number(b.x || 0)) + 240);
        const spanY = Math.max(220, Math.abs(Number(a.y || 0) - Number(b.y || 0)) + 220);
        const usableWidth = Math.max(220, viewportWidth * 0.62);
        const usableHeight = Math.max(220, viewportHeight * 0.66);
        state.view.scale = clamp(Math.min(usableWidth / spanX, usableHeight / spanY), 0.4, 1.65);
    } else {
        state.view.scale = 1.2;
    }

    const sideBiasPx = intelPanel && intelPanel.style.display !== 'none'
        ? Math.min(180, Math.round((intelPanel.offsetWidth || 0) * 0.28))
        : 0;
    state.view.x = -cx * state.view.scale - sideBiasPx;
    state.view.y = -cy * state.view.scale;
    setIntelPairPreview(aId, bId, meta);
    draw();
}

function setGraphZoom(nextScale, options = {}) {
    const canvas = document.getElementById('graph');
    if (!canvas) return;

    const viewportWidth = Number(canvas.clientWidth || canvas.width || 0);
    const viewportHeight = Number(canvas.clientHeight || canvas.height || 0);
    const previousScale = clamp(Number(state.view.scale || 1), 0.1, 5.0);
    const targetScale = clamp(Number(nextScale || previousScale), 0.1, 5.0);
    if (!viewportWidth || !viewportHeight || !Number.isFinite(targetScale)) return;
    if (Math.abs(targetScale - previousScale) < 0.0001) return;

    const anchorX = Number.isFinite(Number(options.anchorX)) ? Number(options.anchorX) : (viewportWidth / 2);
    const anchorY = Number.isFinite(Number(options.anchorY)) ? Number(options.anchorY) : (viewportHeight / 2);
    const worldX = (anchorX - (viewportWidth / 2) - state.view.x) / previousScale;
    const worldY = (anchorY - (viewportHeight / 2) - state.view.y) / previousScale;

    state.view.scale = targetScale;
    state.view.x = anchorX - (viewportWidth / 2) - (worldX * targetScale);
    state.view.y = anchorY - (viewportHeight / 2) - (worldY * targetScale);
    draw();

    if (options.save === true) scheduleSave();
}

function stepGraphZoom(direction = 1, options = {}) {
    const factor = direction > 0 ? 1.1 : 0.9;
    setGraphZoom(Number(state.view.scale || 1) * factor, options);
}

function updateFocusControls() {
    const wrap = document.getElementById('focus-controls');
    const slider = document.getElementById('focusDepthSlider');
    const valueEl = document.getElementById('focusDepthValue');
    const closeBtn = document.getElementById('btnExitFocus');
    if (!wrap || !slider || !valueEl || !closeBtn) return;

    const depth = clampFocusDepth(state.focusDepth);
    state.focusDepth = depth;
    if (slider.value !== String(depth)) slider.value = String(depth);
    valueEl.textContent = String(depth);
    wrap.hidden = !state.focusMode;

    if (!slider.dataset.bound) {
        slider.addEventListener('input', () => {
            const nextDepth = clampFocusDepth(slider.value);
            state.focusDepth = nextDepth;
            valueEl.textContent = String(nextDepth);
            if (state.focusMode) {
                setFocusMode(state.selection || state.focusRootId, nextDepth);
                restartSim();
                renderEditor();
                draw();
                updateFocusControls();
            }
            scheduleSave();
        });
        slider.dataset.bound = '1';
    }

    if (!closeBtn.dataset.bound) {
        closeBtn.addEventListener('click', () => {
            clearFocusMode();
            restartSim();
            renderEditor();
            draw();
            updateFocusControls();
            scheduleSave();
        });
        closeBtn.dataset.bound = '1';
    }
}

function recenterGraphView(options = {}) {
    const canvas = document.getElementById('graph');
    if (!canvas) return;

    resizeCanvas();

    const viewportWidth = Number(canvas.clientWidth || canvas.width || 0);
    const viewportHeight = Number(canvas.clientHeight || canvas.height || 0);
    if (!viewportWidth || !viewportHeight) return;

    const positionedNodes = state.nodes.filter((node) =>
        Number.isFinite(Number(node?.x)) && Number.isFinite(Number(node?.y))
    );

    if (!positionedNodes.length) {
        state.view.scale = 0.8;
        state.view.x = 0;
        state.view.y = 0;
        draw();
        if (options.save !== false) scheduleSave();
        return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    positionedNodes.forEach((node) => {
        const x = Number(node.x);
        const y = Number(node.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    });

    const spanX = Math.max(220, maxX - minX);
    const spanY = Math.max(180, maxY - minY);
    const paddingPx = Math.max(54, Math.min(viewportWidth, viewportHeight) * 0.12);
    const usableWidth = Math.max(180, viewportWidth - (paddingPx * 2));
    const usableHeight = Math.max(180, viewportHeight - (paddingPx * 2));
    const nextScale = clamp(Math.min(usableWidth / spanX, usableHeight / spanY), 0.32, 1.15);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    state.view.scale = nextScale;
    state.view.x = -centerX * nextScale;
    state.view.y = -centerY * nextScale;
    draw();

    if (options.save !== false) scheduleSave();
}

function updateIntelPanel(force = false) {
    if (!intelPanel || intelPanel.style.display === 'none') return;
    const listEl = document.getElementById('intel-list');
    const countEl = document.getElementById('intelCount');
    const scopeName = document.getElementById('intelScopeName');
    if (scopeName) {
        const n = nodeById(state.selection);
        scopeName.textContent = n ? n.name : 'Aucune';
    }
    if (!listEl) return;

    const scope = state.aiSettings.scope || 'selection';
    const focusId = (scope === 'selection' && state.selection) ? state.selection : null;
    if (scope === 'selection' && !focusId) {
        clearIntelPairPreview({ redraw: false, syncRows: false });
        listEl.innerHTML = '<div class="intel-empty-state">Selectionne une fiche ou passe en mode reseau.</div>';
        if (countEl) countEl.textContent = '0';
        state.aiPredictedLinks = [];
        draw();
        return;
    }

    const options = {
        focusId,
        mode: state.aiSettings.mode,
        limit: state.aiSettings.limit,
        minScore: state.aiSettings.minScore,
        noveltyRatio: state.aiSettings.noveltyRatio,
        sources: state.aiSettings.sources
    };

    if (force || intelSuggestions.length === 0) {
        intelSuggestions = computeLinkSuggestions(options);
    }

    if (!intelSuggestions.length) {
        listEl.innerHTML = '<div class="intel-empty-state">Aucune suggestion utile pour ce filtre.</div>';
        if (countEl) countEl.textContent = '0';
        state.aiPredictedLinks = [];
        clearIntelPairPreview({ redraw: false, syncRows: false });
        draw();
        return;
    }

    if (countEl) countEl.textContent = `${intelSuggestions.length}`;
    state.aiPredictedLinks = intelSuggestions
        .filter((suggestion) => suggestion.actionType !== 'merge')
        .map(s => ({
        aId: s.aId,
        bId: s.bId,
        score: s.score,
        kind: s.kind,
        confidence: s.confidence
    }));
    if (state.aiPreviewPair && !intelSuggestions.some((suggestion) => isActiveIntelPreviewPair(suggestion.aId, suggestion.bId))) {
        clearIntelPairPreview({ redraw: false, syncRows: false });
    }
    draw();

    const showReasons = state.aiSettings.showReasons !== false;
    listEl.innerHTML = intelSuggestions.map(s => {
        const isMerge = s.actionType === 'merge';
        const scorePct = Math.round(s.score * 100);
        const confPct = Math.round(s.confidence * 100);
        const mergeBadge = isMerge ? `<span class="intel-badge intel-badge-merge">Fusion</span>` : '';
        const isBridge = s.bridge ? `<span class="intel-badge">Pont</span>` : '';
        const isSurprise = s.surprise >= 0.6 ? `<span class="intel-badge">Surprise</span>` : '';
        const isAlias = s.alias ? `<span class="intel-badge">Alias?</span>` : '';
        const isGeo = s.geoScore && s.geoScore > 0.55 ? `<span class="intel-badge">Geo</span>` : '';
        const hasInactive = s.aStatus === PERSON_STATUS.INACTIVE || s.bStatus === PERSON_STATUS.INACTIVE;
        const hasMissing = s.aStatus === PERSON_STATUS.MISSING || s.bStatus === PERSON_STATUS.MISSING;
        const hasDeceased = s.aStatus === PERSON_STATUS.DECEASED || s.bStatus === PERSON_STATUS.DECEASED;
        const statusBadges = [
            hasInactive ? `<span class="intel-badge">Inactif</span>` : '',
            hasMissing ? `<span class="intel-badge">Disparu</span>` : '',
            hasDeceased ? `<span class="intel-badge">Mort</span>` : ''
        ].join('');
        const reasons = (showReasons && s.reasons && s.reasons.length) ? `<div class="intel-reasons">${s.reasons.slice(0, 3).map(r => escapeHtml(r)).join(' · ')}</div>` : '';
        const mergeTargetLabel = isMerge && s.mergeTarget
            ? `<div class="intel-merge-target">Cible: ${escapeHtml(s.mergeTarget.name || 'Sans nom')}</div>`
            : '';
        const cta = isMerge
            ? `
                <button class="mini-btn primary intel-merge-btn" data-action="merge">Fusionner</button>
                <button class="mini-btn" data-action="focus">Voir</button>
            `
            : (() => {
                const allowedKinds = getAllowedKinds(s.a.type, s.b.type);
                const options = Array.from(allowedKinds).map(k => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${linkKindEmoji(k)} ${kindToLabel(k)}</option>`).join('');
                return `
                    <select class="intel-select intel-kind" data-action="kind">${options}</select>
                    <button class="mini-btn primary intel-connect-btn" data-action="apply">Connecter</button>
                    <button class="mini-btn" data-action="focus">Voir</button>
                `;
            })();
        return `
            <div class="intel-item ${s.surprise >= 0.6 ? 'highlight' : ''} ${isActiveIntelPreviewPair(s.aId, s.bId) ? 'is-previewing' : ''}" data-a="${s.aId}" data-b="${s.bId}" data-action-type="${isMerge ? 'merge' : 'link'}" data-kind="${escapeHtml(s.kind || '')}" data-source="${escapeHtml(s.mergeSourceId || '')}" data-target="${escapeHtml(s.mergeTargetId || '')}">
                <div class="intel-card-top">
                    <div class="intel-meta">
                        <span class="intel-score">Score ${scorePct}%</span>
                        <span class="intel-confidence">Confiance ${confPct}%</span>
                    </div>
                    <div class="intel-badges">${mergeBadge}${isBridge}${isSurprise}${isAlias}${isGeo}${statusBadges}</div>
                </div>
                <div class="intel-names">
                    <span class="intel-name-pair">${escapeHtml(s.a.name)} ⇄ ${escapeHtml(s.b.name)}</span>
                </div>
                ${mergeTargetLabel}
                ${reasons}
                <div class="intel-cta">
                    ${cta}
                </div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.intel-item').forEach(row => {
        const aId = row.dataset.a;
        const bId = row.dataset.b;
        const actionType = row.dataset.actionType || 'link';
        const buildPairMeta = () => ({
            actionType,
            kind: row.querySelector('.intel-kind')?.value || row.dataset.kind || ''
        });
        row.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.dataset.action;
            if (action === 'apply') {
                btn.onclick = () => {
                    const kindSel = row.querySelector('.intel-kind');
                    const kind = kindSel ? kindSel.value : null;
                    const res = addLink(aId, bId, kind);
                    if (res) updateIntelPanel(true);
                };
            }
            if (action === 'merge') {
                btn.onclick = () => {
                    const sourceId = row.dataset.source;
                    const targetId = row.dataset.target;
                    const sourceNode = nodeById(sourceId);
                    const targetNode = nodeById(targetId);
                    if (!sourceNode || !targetNode) return;
                    showCustomConfirm(`Fusionner "${sourceNode.name}" DANS "${targetNode.name}" ?`, () => {
                        intelSuggestions = [];
                        clearIntelPairPreview({ redraw: false, syncRows: false });
                        mergeNodes(sourceId, targetId);
                        selectNode(targetId);
                        scheduleSave();
                        refreshHvt();
                    });
                };
            }
            if (action === 'kind') {
                btn.onchange = () => {
                    row.dataset.kind = btn.value;
                    if (isActiveIntelPreviewPair(aId, bId) && state.aiPreviewPair) {
                        state.aiPreviewPair.kind = btn.value;
                        state.aiPreviewPair.actionType = actionType;
                        draw();
                    }
                };
            }
            if (action === 'focus') {
                btn.onclick = () => centerOnPair(aId, bId, buildPairMeta());
            }
        });
        row.onclick = () => centerOnPair(aId, bId, buildPairMeta());
        row.querySelectorAll('button, select').forEach((control) => {
            control.addEventListener('click', (event) => event.stopPropagation());
        });
    });
}

export function refreshIntelPanel() {
    if (!intelPanel || intelPanel.style.display === 'none') return;
    updateIntelPanel(true);
}

function getNodeSearchStatus(node) {
    const status = normalizePersonStatus(node?.personStatus, node?.type);
    if (status === PERSON_STATUS.INACTIVE) return 'inactif';
    if (status === PERSON_STATUS.MISSING) return 'disparu';
    if (status === PERSON_STATUS.DECEASED) return 'mort';
    return 'actif';
}

function findSearchMatches(query, options = {}) {
    return findPointSearchMatches(state.nodes, query, {
        ...options,
        typeLabel: (node) => nodeTypeLabel(node?.type),
        statusLabel: getNodeSearchStatus
    });
}

function setupSearch() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim();
        const res = document.getElementById('searchResult');
        if(!q) { res.textContent = ''; return; }
        const found = findSearchMatches(q, { mode: 'name', limit: 8 });
        if(found.length === 0) { res.innerHTML = '<span style="color:#666;">Aucun résultat</span>'; return; }
        res.innerHTML = found.map((n) => {
            const rawName = String(n.name || 'Sans nom');
            const label = escapeHtml(rawName);
            return `<span class="search-hit" data-id="${n.id}" title="${escapeHtml(rawName)}">${label}</span>`;
        }).join(' · ');
        res.querySelectorAll('.search-hit').forEach(el => el.onclick = () => { zoomToNode(el.dataset.id); e.target.value = ''; res.textContent = ''; });
    });
}

function getViewportWorldCenter() {
    const canvas = document.getElementById('graph');
    if (!canvas) return { x: 0, y: 0 };
    const width = Number(canvas.clientWidth || canvas.width || 0);
    const height = Number(canvas.clientHeight || canvas.height || 0);
    const scale = Number(state.view?.scale || 0);
    if (!width || !height || !Number.isFinite(scale) || scale <= 0) {
        return { x: 0, y: 0 };
    }
    return screenToWorld(width / 2, height / 2, canvas, state.view);
}

function placeNodeAtWorldPosition(node, position = null) {
    const targetX = Number(position?.x);
    const targetY = Number(position?.y);
    if (!node || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return node;
    node.x = targetX;
    node.y = targetY;
    node.fx = targetX;
    node.fy = targetY;
    node.vx = 0;
    node.vy = 0;
    return node;
}

function createNodeAtPosition(type, name, position = null) {
    const node = ensureNode(type, name, position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
        ? { x: Number(position.x), y: Number(position.y) }
        : {});
    return placeNodeAtWorldPosition(node, position);
}

function makeSpawnPosition(anchor = null, offsetX = 0, offsetY = 0) {
    const base = anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))
        ? { x: Number(anchor.x), y: Number(anchor.y) }
        : getViewportWorldCenter();
    return {
        x: base.x + Number(offsetX || 0),
        y: base.y + Number(offsetY || 0)
    };
}

function createNode(type, baseName, options = {}) {
    let name = baseName, i = 1;
    while(state.nodes.find(n => n.name === name)) { name = `${baseName} ${++i}`; }
    const viewportCenter = getViewportWorldCenter();
    const angle = (state.nodes.length + 1) * 1.6180339887;
    const radius = state.nodes.length ? 26 : 0;
    const n = createNodeAtPosition(type, name, {
        x: viewportCenter.x + (Math.cos(angle) * radius),
        y: viewportCenter.y + (Math.sin(angle) * radius)
    });
    logNodeAdded(n.name, options.actor);
    zoomToNode(n.id); restartSim();
    scheduleSave();
}

function resolveNodeForAction(ref) {
    if (!ref) return null;
    const id = (typeof ref === 'object') ? ref.id : ref;
    return nodeById(id);
}

export function addLink(a, b, kind, options = {}) {
    const res = logicAddLink(a, b, kind);
    if (res) {
        const sourceNode = resolveNodeForAction(a);
        const targetNode = resolveNodeForAction(b);
        logNodesConnected(sourceNode, targetNode, options.actor);
        if (state.focusMode) { refreshFocusMode(); restartSim(); }
        refreshLists();
        renderEditor();
        scheduleSave();
        updateFocusControls();
        refreshHvt();
    }
    return res;
}

export function selectNode(id) {
    clearIntelPairPreview({ redraw: false });
    state.selection = id;
    if (state.focusMode) {
        setFocusMode(id, state.focusDepth);
        restartSim();
    }
    if (state.hvtMode && String(state.hvtSelectedId || '') !== String(id || '')) {
        state.hvtSelectedId = id;
        refreshHvt();
    }
    renderEditor();
    updatePathfindingPanel();
    draw();
    updateFocusControls();
    refreshIntelPanel();
    if (isCloudBoardActive() && collab.user) {
        touchCollabPresence(collab.presenceLoopToken, { force: true }).catch(() => {});
    }
}

function zoomToNode(id) {
    const n = nodeById(id);
    if (!n) return;
    clearIntelPairPreview({ redraw: false });
    state.selection = n.id;
    if (state.focusMode) {
        setFocusMode(n.id, state.focusDepth);
        restartSim();
    }
    if (state.hvtMode) {
        state.hvtSelectedId = n.id;
        refreshHvt();
    }
    state.view.scale = 1.6;
    state.view.x = -n.x * 1.6;
    state.view.y = -n.y * 1.6;
    renderEditor();
    updatePathfindingPanel();
    draw();
    updateFocusControls();
    if (isCloudBoardActive() && collab.user) {
        touchCollabPresence(collab.presenceLoopToken, { force: true }).catch(() => {});
    }
}

export function updateLinkLegend() {
    const el = ui.linkLegend;
    if (!el) return;
    if(!state.showLinkTypes) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    const allowedKinds = FILTER_RULES[state.activeFilter];
    const usedKinds = new Set(
        state.links
            .filter((link) => !allowedKinds || allowedKinds.has(link.kind))
            .map((link) => link.kind)
    );
    const orderedKinds = [...usedKinds].sort((a, b) => kindToLabel(a).localeCompare(kindToLabel(b), 'fr', { sensitivity: 'base' }));
    if(orderedKinds.length === 0) {
        el.hidden = false;
        el.innerHTML = '<div class="legend-title">Types de liaisons</div><div class="legend-empty">Aucun type visible</div>';
        return;
    }
    el.hidden = false;
    el.innerHTML = `
        <div class="legend-title">Types de liaisons</div>
        ${orderedKinds.map((kind) => `<div class="legend-item"><span class="legend-emoji">${linkKindEmoji(kind)}</span><span>${kindToLabel(kind)}</span></div>`).join('')}
    `;
}

export function refreshLists() {
    updateDegreeCache();
    const fill = (ul, arr) => {
        if(!ul) return;
        ul.innerHTML = '';
        arr.sort((a,b) => a.name.localeCompare(b.name)).forEach(n => {
            const li = document.createElement('li');
            li.innerHTML = `<div class="list-item"><span class="bullet" style="background:${n.color}"></span>${escapeHtml(n.name)}</div>`;
            li.onclick = () => zoomToNode(n.id);
            ul.appendChild(li);
        });
    };
    fill(ui.listCompanies, state.nodes.filter(isCompany));
    fill(ui.listGroups, state.nodes.filter(isGroup));
    fill(ui.listPeople, state.nodes.filter(isPerson));

    updateCenterEmptyState();
    updateLinkLegend();
    if (state.hvtMode) updateHvtPanel();
    refreshIntelPanel();
}

export function updatePathfindingPanel() {
    const el = ui.pathfindingContainer;
    if(!el) return;
    const selectedNode = nodeById(state.selection);
    el.innerHTML = renderPathfindingSidebar(state, selectedNode);
    const pathfindingLed = document.getElementById('pathfindingLed');
    if (pathfindingLed) {
        pathfindingLed.classList.toggle('is-active', !!state.pathfinding.active);
    }

    const btnStart = document.getElementById('btnPathStart');
    if(btnStart) btnStart.onclick = () => {
        if(!selectedNode) return;
        state.pathfinding.startId = selectedNode.id;
        state.pathfinding.active = false;
        updatePathfindingPanel();
        draw();
    };
    const btnCancel = document.getElementById('btnPathCancel');
    if(btnCancel) btnCancel.onclick = () => {
        state.pathfinding.startId = null;
        state.pathfinding.active = false;
        clearPath();
        draw();
        updatePathfindingPanel();
    };
    const btnCalc = document.getElementById('btnPathCalc');
    if(btnCalc) btnCalc.onclick = () => {
        if(!selectedNode || !state.pathfinding.startId) return;
        const result = calculatePath(state.pathfinding.startId, selectedNode.id);
        if (result) {
            state.pathfinding.pathNodes = result.pathNodes;
            state.pathfinding.pathLinks = result.pathLinks;
            state.pathfinding.active = true;
            draw();
            updatePathfindingPanel();
        } else {
            showCustomAlert("Aucune connexion trouvée (hors ennemis).");
        }
    };
}
