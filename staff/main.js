import { gpsToPercentage, percentageToGps } from '../map/js/utils.js';
import { createStaffAlertsApi } from './alerts-api.js';
import { escapeText, toValidDate, formatAlertDateTime, toLocalDateTimeInputValue } from './date-utils.js';
import { normalizeAudienceUsername, normalizeAudienceQuery, sanitizeAllowedUsers } from './audience-utils.js';

const STAFF_CODE = 'staff';
const ALERTS_ENDPOINT = '/.netlify/functions/alerts';
const ALERT_REFRESH_EVENT_KEY = 'bniAlertRefresh_v1';
const ALERT_REFRESH_CHANNEL = 'bni-alert-refresh';
const DEFAULT_RADIUS = 2.6;
const DEFAULT_STROKE_WIDTH = 0.06;
const alertsApi = createStaffAlertsApi({
    endpoint: ALERTS_ENDPOINT,
    staffCode: STAFF_CODE,
    refreshEventKey: ALERT_REFRESH_EVENT_KEY,
    refreshChannel: ALERT_REFRESH_CHANNEL,
});

const dom = {
    contextMenu: document.getElementById('context-menu'),
    ctxNewZone: document.getElementById('ctx-new-zone'),
    ctxNewFreeZone: document.getElementById('ctx-new-free-zone'),
    ctxCancel: document.getElementById('ctx-cancel'),
    accessOverlay: document.getElementById('staff-access-overlay'),
    accessInput: document.getElementById('staff-access-input'),
    accessError: document.getElementById('staff-access-error'),
    accessSubmit: document.getElementById('staff-access-submit'),
    newAlertBtn: document.getElementById('btnNewAlert'),
    startFreeDrawBtn: document.getElementById('btnStartFreeDraw'),
    cancelDrawBtn: document.getElementById('btnCancelDrawMode'),
    publishBtn: document.getElementById('btnPublishAlert'),
    radius: document.getElementById('alertRadius'),
    radiusValue: document.getElementById('alertRadiusValue'),
    circleTools: document.getElementById('staffCircleTools'),
    circleToolsHint: document.getElementById('staffCircleToolsHint'),
    circleCount: document.getElementById('staffCircleCount'),
    circlePicker: document.getElementById('staffCirclePicker'),
    drawStatus: document.getElementById('staffDrawStatus'),
    statusState: document.getElementById('staffAlertState'),
    statusCoords: document.getElementById('staffAlertCoords'),
    statusMessage: document.getElementById('staffStatusMessage'),
    alertMode: document.getElementById('staffAlertMode'),
    selectionMode: document.getElementById('staffSelectionMode'),
    audienceMode: document.getElementById('staffAudienceMode'),
    title: document.getElementById('alertTitle'),
    description: document.getElementById('alertDescription'),
    active: document.getElementById('alertActive'),
    startAt: document.getElementById('alertStartAt'),
    showBeforeStart: document.getElementById('alertShowBeforeStart'),
    startVisibilitySwitch: document.getElementById('staffStartVisibilitySwitch'),
    startVisibilityHint: document.getElementById('staffStartVisibilityHint'),
    startVisibilityWaitBtn: document.getElementById('btnAlertStartWait'),
    startVisibilityShowNowBtn: document.getElementById('btnAlertStartShowNow'),
    strokeWidth: document.getElementById('alertStrokeWidth'),
    strokeWidthValue: document.getElementById('alertStrokeWidthValue'),
    audienceAllBtn: document.getElementById('btnAudienceAll'),
    audienceWhitelistBtn: document.getElementById('btnAudienceWhitelist'),
    whitelistPanel: document.getElementById('staffWhitelistPanel'),
    whitelistInput: document.getElementById('staffWhitelistInput'),
    whitelistAddBtn: document.getElementById('btnAddWhitelistUser'),
    whitelistSuggestions: document.getElementById('staffWhitelistSuggestions'),
    whitelistCount: document.getElementById('staffWhitelistCount'),
    whitelistList: document.getElementById('staffWhitelistList'),
    viewport: document.getElementById('viewport'),
    mapWorld: document.getElementById('map-world'),
    mapImage: document.getElementById('map-image'),
    alertLayer: document.getElementById('staff-alert-layer'),
    mapBanner: document.getElementById('staff-map-banner'),
    coords: document.getElementById('coords-display'),
    resetView: document.getElementById('btnResetView'),
    alertsList: document.getElementById('staffAlertsList'),
    modal: document.getElementById('staff-alert-modal'),
    modalTitle: document.getElementById('staffAlertModalTitle'),
    modalCloseBtn: document.getElementById('btnAlertModalClose'),
    modalCancelBtn: document.getElementById('btnAlertModalCancel'),
    confirmModal: document.getElementById('staff-confirm-modal'),
    confirmTitle: document.getElementById('staffConfirmTitle'),
    confirmMessage: document.getElementById('staffConfirmMessage'),
    confirmCloseBtn: document.getElementById('btnStaffConfirmClose'),
    confirmCancelBtn: document.getElementById('btnStaffConfirmCancel'),
    confirmOkBtn: document.getElementById('btnStaffConfirmOk'),
};

const state = {
    unlocked: false,
    alerts: [],
    currentAlert: null,
    selection: null,
    drawMode: false,
    drawType: '',
    drawCircleDraft: null,
    drawCircleHoverMode: false,
    isFreeDrawing: false,
    drawDraftPoints: [],
    drawBackupAlert: null,
    drawBackupSelection: null,
    mapWidth: 0,
    mapHeight: 0,
    view: { x: 0, y: 0, scale: 0.5 },
    pointer: {
        active: false,
        moved: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
    },
    mapSelectionEnabled: true,
    audienceMode: 'all',
    allowedUsers: [],
    userDirectory: [],
    whitelistLookupLoading: false,
    whitelistLookupError: '',
    whitelistLookupRequestId: 0,
    selectionDrag: null,
    contextMenuMapCoords: null,
    contextMenuOpen: false,
    modalSession: {
        open: false,
        openedFromDraw: false,
        originAlert: null,
        originSelection: null,
    },
    confirmSession: {
        open: false,
        resolve: null,
    },
};

function cloneAlertRecord(alert) {
    if (!alert || typeof alert !== 'object') return null;
    try {
        return JSON.parse(JSON.stringify(alert));
    } catch (error) {
        return { ...alert };
    }
}

function getAlertId(alert = state.currentAlert) {
    return String(alert?.id || '').trim();
}

function getAlertShapeLabel(alert) {
    return alert?.shapeType === 'zone' ? 'Zone' : 'Cercle';
}

function getAlertStateLabel(alert) {
    if (!alert) return 'Brouillon';
    if (alert.active === false) return 'Inactive';
    if (isAlertPreview(alert)) return 'Visible';
    if (isAlertScheduled(alert)) return 'Programmee';
    return 'Live';
}

function getAlertStateTone(alert) {
    if (!alert) return 'muted';
    if (alert.active === false) return 'muted';
    if (isAlertPreview(alert)) return 'live';
    if (isAlertScheduled(alert)) return 'warn';
    return 'live';
}

function getAlertStamp(alert) {
    return formatAlertDateTime(alert?.startsAt || alert?.updatedAt || alert?.createdAt || '');
}

function readScheduledAtInput() {
    const raw = String(dom.startAt?.value || '').trim();
    if (!raw) return '';
    const date = toValidDate(raw);
    if (!date) {
        throw new Error('Date de diffusion invalide.');
    }
    return date.toISOString();
}

function getScheduledStartDate(alert = state.currentAlert) {
    return toValidDate(alert?.startsAt || '');
}

function hasFutureStartDate(date) {
    return Boolean(date && date.getTime() > Date.now());
}

function isAlertPreview(alert = state.currentAlert) {
    const date = getScheduledStartDate(alert);
    return Boolean(alert?.active !== false && hasFutureStartDate(date) && alert?.showBeforeStart === true);
}

function isAlertScheduled(alert = state.currentAlert) {
    const date = getScheduledStartDate(alert);
    return Boolean(alert?.active !== false && hasFutureStartDate(date) && alert?.showBeforeStart !== true);
}

function getDraftStartDate() {
    if (dom.startAt) {
        return toValidDate(String(dom.startAt.value || '').trim());
    }
    return getScheduledStartDate(state.currentAlert);
}

function shouldDraftShowBeforeStart() {
    return Boolean(dom.showBeforeStart?.checked) && hasFutureStartDate(getDraftStartDate());
}

function refreshStartVisibilityUi() {
    const startDate = getDraftStartDate();
    const hasFutureStart = hasFutureStartDate(startDate);

    if (!hasFutureStart && dom.showBeforeStart) {
        dom.showBeforeStart.checked = false;
    }

    const showBeforeStart = shouldDraftShowBeforeStart();
    if (dom.startVisibilitySwitch) {
        dom.startVisibilitySwitch.hidden = !hasFutureStart;
    }
    dom.startVisibilityWaitBtn?.classList.toggle('is-active', hasFutureStart && !showBeforeStart);
    dom.startVisibilityShowNowBtn?.classList.toggle('is-active', showBeforeStart);
    dom.startVisibilityWaitBtn?.setAttribute('aria-pressed', hasFutureStart && !showBeforeStart ? 'true' : 'false');
    dom.startVisibilityShowNowBtn?.setAttribute('aria-pressed', showBeforeStart ? 'true' : 'false');

    if (dom.startVisibilityHint) {
        if (!startDate) {
            dom.startVisibilityHint.textContent = 'Laisse vide pour afficher tout de suite.';
        } else if (!hasFutureStart) {
            dom.startVisibilityHint.textContent = 'La date est deja atteinte: l alerte sera visible maintenant.';
        } else if (showBeforeStart) {
            dom.startVisibilityHint.textContent = 'Visible des maintenant. La date garde la montee de pression sur la carte.';
        } else {
            dom.startVisibilityHint.textContent = 'L alerte reste cachee jusqu a la date choisie.';
        }
    }
}

function refreshAlertModePill() {
    if (!dom.alertMode) return;

    if (!dom.active?.checked) {
        dom.alertMode.textContent = 'Brouillon';
        return;
    }

    const startDate = getDraftStartDate();
    if (hasFutureStartDate(startDate)) {
        dom.alertMode.textContent = shouldDraftShowBeforeStart() ? 'Visible' : 'Programmee';
        return;
    }

    dom.alertMode.textContent = state.currentAlert ? 'Live' : 'Nouveau';
}

function audienceSummary() {
    if (state.audienceMode !== 'whitelist') return 'Tous';
    if (!state.allowedUsers.length) return 'Whitelist vide';
    return `${state.allowedUsers.length} user${state.allowedUsers.length > 1 ? 's' : ''}`;
}

function audienceDescription() {
    if (state.audienceMode !== 'whitelist') {
        return 'Tout le monde verra cette alerte.';
    }
    if (!state.allowedUsers.length) {
        return 'Restreinte: ajoute un ou plusieurs usernames autorises.';
    }
    return `Restreinte a ${state.allowedUsers.length} username${state.allowedUsers.length > 1 ? 's' : ''}.`;
}

function renderWhitelistComposerState() {
    const query = normalizeAudienceQuery(dom.whitelistInput?.value || '');
    const canAdd = Boolean(query && !state.allowedUsers.includes(query));
    if (dom.whitelistAddBtn) {
        dom.whitelistAddBtn.disabled = !canAdd;
    }
    if (dom.whitelistCount) {
        dom.whitelistCount.textContent = String(state.allowedUsers.length);
    }
}

function hideWhitelistSuggestions() {
    if (!dom.whitelistSuggestions) return;
    dom.whitelistSuggestions.hidden = true;
    dom.whitelistSuggestions.innerHTML = '';
}

function renderWhitelistSuggestions() {
    if (!dom.whitelistSuggestions) return;
    const query = normalizeAudienceQuery(dom.whitelistInput?.value || '');
    if (!query || state.audienceMode !== 'whitelist') {
        hideWhitelistSuggestions();
        return;
    }

    const visible = state.userDirectory
        .filter((username) => username.includes(query))
        .filter((username) => !state.allowedUsers.includes(username))
        .slice(0, 10);

    dom.whitelistSuggestions.hidden = false;
    dom.whitelistSuggestions.innerHTML = visible.map((username) => `
        <button type="button" class="staff-whitelist-suggestion" data-user="${escapeText(username)}">
            <span class="staff-whitelist-suggestion-name">${escapeText(username)}</span>
            <span class="staff-whitelist-suggestion-meta">cloud</span>
        </button>
    `).join('') || `
        <div class="staff-whitelist-empty">
            ${state.whitelistLookupLoading ? 'Recherche en cours...' : (state.whitelistLookupError || 'Aucun username correspondant')}
        </div>
    `;

    Array.from(dom.whitelistSuggestions.querySelectorAll('[data-user]')).forEach((button) => {
        button.onmousedown = (event) => {
            event.preventDefault();
        };
        button.onclick = () => {
            const username = button.getAttribute('data-user') || '';
            addWhitelistUser(username);
        };
    });
}

function renderWhitelistList() {
    if (!dom.whitelistList) return;
    dom.whitelistList.innerHTML = state.allowedUsers.map((username) => `
        <div class="staff-whitelist-chip">
            <span>${escapeText(username)}</span>
            <button type="button" data-remove-user="${escapeText(username)}">×</button>
        </div>
    `).join('') || '<div class="staff-whitelist-empty">Aucun username autorise pour l instant.</div>';

    Array.from(dom.whitelistList.querySelectorAll('[data-remove-user]')).forEach((button) => {
        button.onclick = () => {
            const username = button.getAttribute('data-remove-user') || '';
            state.allowedUsers = state.allowedUsers.filter((entry) => entry !== username);
            renderAudienceUi();
        };
    });
}

function renderAudienceUi() {
    if (dom.audienceMode) {
        dom.audienceMode.textContent = audienceDescription();
    }
    dom.audienceAllBtn?.classList.toggle('is-active', state.audienceMode === 'all');
    dom.audienceWhitelistBtn?.classList.toggle('is-active', state.audienceMode === 'whitelist');
    dom.audienceAllBtn?.setAttribute('aria-pressed', state.audienceMode === 'all' ? 'true' : 'false');
    dom.audienceWhitelistBtn?.setAttribute('aria-pressed', state.audienceMode === 'whitelist' ? 'true' : 'false');
    if (dom.whitelistPanel) {
        dom.whitelistPanel.hidden = state.audienceMode !== 'whitelist';
    }
    if (state.audienceMode !== 'whitelist') {
        state.userDirectory = [];
        state.whitelistLookupLoading = false;
        state.whitelistLookupError = '';
        if (dom.whitelistInput) dom.whitelistInput.value = '';
        hideWhitelistSuggestions();
    } else {
        renderWhitelistSuggestions();
    }
    renderWhitelistComposerState();
    renderWhitelistList();
}

function addWhitelistUser(value) {
    const username = normalizeAudienceUsername(value);
    if (!username) {
        setStatusMessage('Username invalide.', 'warn');
        return;
    }
    if (!state.allowedUsers.includes(username)) {
        state.allowedUsers = [...state.allowedUsers, username];
    }
    if (dom.whitelistInput) dom.whitelistInput.value = '';
    state.userDirectory = [];
    state.whitelistLookupLoading = false;
    state.whitelistLookupError = '';
    renderAudienceUi();
    if (state.audienceMode === 'whitelist') {
        window.setTimeout(() => {
            dom.whitelistInput?.focus();
        }, 0);
    }
}

async function loadUserDirectory(query = '') {
    const normalizedQuery = normalizeAudienceQuery(query);
    const requestId = ++state.whitelistLookupRequestId;

    if (!normalizedQuery || state.audienceMode !== 'whitelist') {
        state.userDirectory = [];
        state.whitelistLookupLoading = false;
        state.whitelistLookupError = '';
        renderWhitelistSuggestions();
        return [];
    }

    state.whitelistLookupLoading = true;
    state.whitelistLookupError = '';
    renderWhitelistSuggestions();

    try {
        const data = await requestAdmin('list_users', { query: normalizedQuery });
        if (requestId !== state.whitelistLookupRequestId) return state.userDirectory;
        state.userDirectory = Array.isArray(data.users) ? sanitizeAllowedUsers(data.users) : [];
    } catch (error) {
        if (requestId !== state.whitelistLookupRequestId) return state.userDirectory;
        state.userDirectory = [];
        state.whitelistLookupError = 'Recherche indisponible';
    } finally {
        if (requestId === state.whitelistLookupRequestId) {
            state.whitelistLookupLoading = false;
            renderWhitelistSuggestions();
        }
    }

    return state.userDirectory;
}

function isAlertModalOpen() {
    return Boolean(dom.modal && !dom.modal.hidden);
}

function updateAlertModalTitle() {
    if (!dom.modalTitle) return;
    dom.modalTitle.textContent = getAlertId()
        ? 'Modifier l alerte'
        : 'Nouvelle alerte';
}

function openAlertModal(options = {}) {
    if (!dom.modal) return;
    state.modalSession = {
        open: true,
        openedFromDraw: Boolean(options.openedFromDraw),
        originAlert: cloneAlertRecord(options.originAlert ?? state.currentAlert),
        originSelection: cloneSelection(options.originSelection ?? state.selection),
    };
    dom.modal.hidden = false;
    updateAlertModalTitle();
    window.setTimeout(() => {
        dom.title?.focus();
    }, 0);
}

function restoreAlertWorkspace(originAlert = null) {
    const restoreAlert = cloneAlertRecord(originAlert);
    state.currentAlert = restoreAlert;
    if (restoreAlert) {
        fillForm(restoreAlert, { focus: false });
        return;
    }
    fillForm(null, { preserveSelection: false, focus: false });
}

function closeAlertModal(options = {}) {
    if (!dom.modal) return;
    const session = state.modalSession;
    dom.modal.hidden = true;

    if (options.restore) {
        restoreAlertWorkspace(session.originAlert);
    }

    state.modalSession = {
        open: false,
        openedFromDraw: false,
        originAlert: null,
        originSelection: null,
    };
    renderBanner();
    refreshStatusCards();
}

function isConfirmModalOpen() {
    return Boolean(dom.confirmModal && !dom.confirmModal.hidden);
}

function closeConfirmModal(result = false) {
    if (!dom.confirmModal) return;
    dom.confirmModal.hidden = true;
    const resolver = state.confirmSession.resolve;
    state.confirmSession = {
        open: false,
        resolve: null,
    };
    if (typeof resolver === 'function') {
        resolver(Boolean(result));
    }
}

function openConfirmModal(options = {}) {
    if (!dom.confirmModal || !dom.confirmTitle || !dom.confirmMessage || !dom.confirmOkBtn) {
        return Promise.resolve(false);
    }
    if (typeof state.confirmSession.resolve === 'function') {
        state.confirmSession.resolve(false);
    }
    state.confirmSession = {
        open: true,
        resolve: null,
    };
    dom.confirmTitle.textContent = String(options.title || 'Confirmation');
    dom.confirmMessage.textContent = String(options.message || 'Confirme cette action.');
    dom.confirmOkBtn.textContent = String(options.confirmLabel || 'Confirmer');
    dom.confirmOkBtn.classList.toggle('staff-confirm-danger', options.tone === 'danger');
    dom.confirmModal.hidden = false;

    return new Promise((resolve) => {
        state.confirmSession.resolve = resolve;
        window.setTimeout(() => {
            dom.confirmOkBtn?.focus();
        }, 0);
    });
}

function renderAlertsList() {
    if (!dom.alertsList) return;
    const rows = Array.isArray(state.alerts) ? state.alerts : [];
    if (!rows.length) {
        dom.alertsList.innerHTML = `
            <div class="staff-alert-empty">
                Aucune alerte enregistree.<br>
                Clique droit sur la carte pour en creer une.
            </div>
        `;
        return;
    }

    dom.alertsList.innerHTML = rows.map((alert) => {
        const alertId = getAlertId(alert);
        const isSelected = alertId && alertId === getAlertId();
        return `
            <article class="staff-alert-card${isSelected ? ' is-selected' : ''}" data-alert-focus="${escapeText(alertId)}">
                <div class="staff-alert-card-head">
                    <div class="staff-alert-card-title">${escapeText(alert.title || 'Alerte sans titre')}</div>
                    <div class="staff-alert-card-meta">
                        <span class="staff-alert-badge" data-tone="${escapeText(getAlertStateTone(alert))}">${escapeText(getAlertStateLabel(alert))}</span>
                        <span class="staff-alert-badge">${escapeText(getAlertShapeLabel(alert))}</span>
                    </div>
                </div>
                <div class="staff-alert-card-desc">${escapeText(alert.description || 'Aucune description')}</div>
                <div class="staff-alert-card-meta">
                    <span class="staff-alert-badge" data-tone="muted">${escapeText(getAlertStamp(alert) || 'Sans date')}</span>
                    <span class="staff-alert-badge" data-tone="muted">GPS ${Number(alert.gpsX || 0).toFixed(2)} / ${Number(alert.gpsY || 0).toFixed(2)}</span>
                </div>
                <div class="staff-alert-card-actions">
                    <button type="button" class="mini-btn" data-alert-edit="${escapeText(alertId)}">Modifier</button>
                    <button type="button" class="mini-btn" data-alert-delete="${escapeText(alertId)}">Supprimer</button>
                </div>
            </article>
        `;
    }).join('');

    Array.from(dom.alertsList.querySelectorAll('[data-alert-focus]')).forEach((button) => {
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const alertId = button.getAttribute('data-alert-focus') || '';
            if (!alertId) return;
            selectAlert(alertId, { focus: true });
        };
    });

    Array.from(dom.alertsList.querySelectorAll('[data-alert-edit]')).forEach((button) => {
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const alertId = button.getAttribute('data-alert-edit') || '';
            if (!alertId) return;
            const selected = selectAlert(alertId, { focus: true });
            if (selected) openAlertModal({ openedFromDraw: false, originAlert: selected, originSelection: state.selection });
        };
    });

    Array.from(dom.alertsList.querySelectorAll('[data-alert-delete]')).forEach((button) => {
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const alertId = button.getAttribute('data-alert-delete') || '';
            if (!alertId) return;
            deleteAlert(alertId).catch(() => {});
        };
    });

    renderSelection();
}

function clampRadius(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULT_RADIUS;
    return Math.min(12, Math.max(0.8, num));
}

function clampStrokeWidth(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULT_STROKE_WIDTH;
    return Math.min(0.5, Math.max(0.02, Number(num.toFixed(2))));
}

function getCurrentRadius() {
    return clampRadius(dom.radius?.value || state.selection?.radius || state.currentAlert?.radius || DEFAULT_RADIUS);
}

function getCurrentStrokeWidth() {
    return clampStrokeWidth(dom.strokeWidth?.value || state.selection?.strokeWidth || state.currentAlert?.strokeWidth || DEFAULT_STROKE_WIDTH);
}

function sanitizeZonePoints(rawPoints) {
    if (!Array.isArray(rawPoints)) return [];
    return rawPoints
        .map((point) => {
            if (!point || typeof point !== 'object') return null;
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return {
                x: Number(x.toFixed(4)),
                y: Number(y.toFixed(4)),
            };
        })
        .filter(Boolean);
}

function computePolygonCenter(points) {
    const clean = sanitizeZonePoints(points);
    if (clean.length === 0) return { x: 50, y: 50 };

    let area = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < clean.length; i += 1) {
        const current = clean[i];
        const next = clean[(i + 1) % clean.length];
        const cross = current.x * next.y - next.x * current.y;
        area += cross;
        cx += (current.x + next.x) * cross;
        cy += (current.y + next.y) * cross;
    }

    if (Math.abs(area) < 0.0001) {
        const sum = clean.reduce((acc, point) => ({
            x: acc.x + point.x,
            y: acc.y + point.y,
        }), { x: 0, y: 0 });
        return {
            x: Number((sum.x / clean.length).toFixed(4)),
            y: Number((sum.y / clean.length).toFixed(4)),
        };
    }

    const factor = 1 / (3 * area);
    return {
        x: Number((cx * factor).toFixed(4)),
        y: Number((cy * factor).toFixed(4)),
    };
}

function getZoneBounds(points) {
    const clean = sanitizeZonePoints(points);
    if (!clean.length) return null;
    const xs = clean.map((point) => point.x);
    const ys = clean.map((point) => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
}

function clampPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    return Math.min(100, Math.max(0, num));
}

function sanitizeCircle(rawCircle, fallbackRadius = DEFAULT_RADIUS) {
    if (!rawCircle || typeof rawCircle !== 'object') return null;

    let xPercent = clampPercent(rawCircle.xPercent);
    let yPercent = clampPercent(rawCircle.yPercent);
    let gpsX = Number(rawCircle.gpsX);
    let gpsY = Number(rawCircle.gpsY);

    if ((!Number.isFinite(xPercent) || !Number.isFinite(yPercent))
        && Number.isFinite(gpsX)
        && Number.isFinite(gpsY)) {
        const percent = gpsToPercentage(gpsX, gpsY);
        xPercent = clampPercent(percent.x);
        yPercent = clampPercent(percent.y);
    }

    if ((!Number.isFinite(gpsX) || !Number.isFinite(gpsY))
        && Number.isFinite(xPercent)
        && Number.isFinite(yPercent)) {
        const gps = percentageToGps(xPercent, yPercent);
        gpsX = gps.x;
        gpsY = gps.y;
    }

    if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) return null;
    if (!Number.isFinite(gpsX) || !Number.isFinite(gpsY)) return null;

    return {
        xPercent: Number(xPercent.toFixed(4)),
        yPercent: Number(yPercent.toFixed(4)),
        gpsX: Number(Number(gpsX).toFixed(2)),
        gpsY: Number(Number(gpsY).toFixed(2)),
        radius: clampRadius(rawCircle.radius ?? fallbackRadius),
    };
}

function sanitizeCircles(rawCircles, fallbackRadius = DEFAULT_RADIUS) {
    if (!Array.isArray(rawCircles)) return [];
    return rawCircles
        .map((circle) => sanitizeCircle(circle, fallbackRadius))
        .filter(Boolean);
}

function buildCircleSelection(circles, activeCircleIndex = null, options = {}) {
    const clean = sanitizeCircles(circles, getCurrentRadius());
    if (!clean.length) return null;

    const index = Number.isInteger(activeCircleIndex)
        ? Math.min(clean.length - 1, Math.max(0, activeCircleIndex))
        : clean.length - 1;
    const activeCircle = clean[index];

    return {
        shapeType: 'circle',
        xPercent: activeCircle.xPercent,
        yPercent: activeCircle.yPercent,
        gpsX: activeCircle.gpsX,
        gpsY: activeCircle.gpsY,
        radius: activeCircle.radius,
        strokeWidth: clampStrokeWidth(
            options.strokeWidth
            ?? state.selection?.strokeWidth
            ?? state.currentAlert?.strokeWidth
            ?? getCurrentStrokeWidth()
        ),
        circles: clean,
        activeCircleIndex: index,
        zonePoints: [],
    };
}

function getSelectionCircles(selection = state.selection) {
    if (!selection || selection.shapeType === 'zone') return [];
    if (Array.isArray(selection.circles) && selection.circles.length) {
        return selection.circles.map((circle) => ({ ...circle }));
    }
    const legacyCircle = sanitizeCircle(selection, selection.radius);
    return legacyCircle ? [legacyCircle] : [];
}

function getActiveCircleIndex(selection = state.selection) {
    const circles = getSelectionCircles(selection);
    if (!circles.length) return -1;
    const index = Number(selection?.activeCircleIndex);
    if (Number.isInteger(index) && index >= 0 && index < circles.length) {
        return index;
    }
    return circles.length - 1;
}

function getActiveCircle(selection = state.selection) {
    const circles = getSelectionCircles(selection);
    const index = getActiveCircleIndex(selection);
    return index >= 0 ? circles[index] : null;
}

function selectActiveCircle(index, options = {}) {
    const selection = cloneSelection(state.selection);
    if (!selection || selection.shapeType === 'zone') return false;
    const circles = getSelectionCircles(selection);
    if (!circles.length) return false;

    const nextIndex = Math.min(circles.length - 1, Math.max(0, Number(index)));
    if (!Number.isInteger(nextIndex)) return false;

    const nextSelection = buildCircleSelection(circles, nextIndex, {
        strokeWidth: selection.strokeWidth,
    });
    if (!nextSelection) return false;

    setSelection(nextSelection, {
        syncForm: options.syncForm !== false,
        resetDraft: false,
    });

    if (options.status !== false) {
        const activeCircle = getActiveCircle(nextSelection);
        if (activeCircle) {
            setStatusMessage(
                `Cercle ${nextIndex + 1} selectionne. Rayon ${activeCircle.radius.toFixed(1)} • Trait ${nextSelection.strokeWidth.toFixed(2)}.`,
                'ok'
            );
        }
    }

    return true;
}

function getCircleBounds(selection = state.selection) {
    const circles = getSelectionCircles(selection);
    if (!circles.length) return null;

    const minX = Math.min(...circles.map((circle) => circle.xPercent - circle.radius));
    const maxX = Math.max(...circles.map((circle) => circle.xPercent + circle.radius));
    const minY = Math.min(...circles.map((circle) => circle.yPercent - circle.radius));
    const maxY = Math.max(...circles.map((circle) => circle.yPercent + circle.radius));

    return {
        minX: Math.max(0, minX),
        maxX: Math.min(100, maxX),
        minY: Math.max(0, minY),
        maxY: Math.min(100, maxY),
    };
}

function summarizeCircles(circles) {
    const clean = sanitizeCircles(circles, getCurrentRadius());
    if (!clean.length) return null;

    const minX = Math.min(...clean.map((circle) => circle.xPercent - circle.radius));
    const maxX = Math.max(...clean.map((circle) => circle.xPercent + circle.radius));
    const minY = Math.min(...clean.map((circle) => circle.yPercent - circle.radius));
    const maxY = Math.max(...clean.map((circle) => circle.yPercent + circle.radius));
    const minGpsX = Math.min(...clean.map((circle) => circle.gpsX));
    const maxGpsX = Math.max(...clean.map((circle) => circle.gpsX));
    const minGpsY = Math.min(...clean.map((circle) => circle.gpsY));
    const maxGpsY = Math.max(...clean.map((circle) => circle.gpsY));
    const radius = Math.max(...clean.map((circle) => circle.radius));

    return {
        xPercent: Number((((minX + maxX) / 2)).toFixed(4)),
        yPercent: Number((((minY + maxY) / 2)).toFixed(4)),
        gpsX: Number((((minGpsX + maxGpsX) / 2)).toFixed(2)),
        gpsY: Number((((minGpsY + maxGpsY) / 2)).toFixed(2)),
        radius: Number(radius.toFixed(1)),
    };
}

function cloneSelection(selection) {
    if (!selection) return null;
    const zonePoints = sanitizeZonePoints(selection.zonePoints);
    const shapeType = selection.shapeType === 'zone' && zonePoints.length >= 3 ? 'zone' : 'circle';
    if (shapeType === 'zone') {
        return {
            shapeType,
            xPercent: Number(selection.xPercent),
            yPercent: Number(selection.yPercent),
            gpsX: Number(selection.gpsX),
            gpsY: Number(selection.gpsY),
            radius: clampRadius(selection.radius),
            strokeWidth: clampStrokeWidth(selection.strokeWidth),
            zonePoints,
            circles: [],
            activeCircleIndex: -1,
        };
    }

    return buildCircleSelection(
        Array.isArray(selection.circles) && selection.circles.length ? selection.circles : [selection],
        Number(selection.activeCircleIndex),
        { strokeWidth: selection.strokeWidth }
    );
}

function buildSelectionFromAlert(alert) {
    if (!alert || typeof alert !== 'object') return null;
    if (alert.shapeType === 'zone') {
        return cloneSelection({
            shapeType: 'zone',
            xPercent: Number(alert.xPercent),
            yPercent: Number(alert.yPercent),
            gpsX: Number(alert.gpsX),
            gpsY: Number(alert.gpsY),
            radius: clampRadius(alert.radius || DEFAULT_RADIUS),
            strokeWidth: clampStrokeWidth(alert.strokeWidth),
            zonePoints: Array.isArray(alert.zonePoints) ? alert.zonePoints : [],
        });
    }

    const circles = Array.isArray(alert.circles) && alert.circles.length
        ? alert.circles
        : [{
            xPercent: alert.xPercent,
            yPercent: alert.yPercent,
            gpsX: alert.gpsX,
            gpsY: alert.gpsY,
            radius: alert.radius || DEFAULT_RADIUS,
        }];
    return buildCircleSelection(circles, Number(alert.activeCircleIndex), {
        strokeWidth: alert.strokeWidth,
    });
}

function buildCircleSelectionFromPercent(xPercent, yPercent, radius = getCurrentRadius()) {
    return buildCircleSelection([{
        xPercent,
        yPercent,
        radius,
    }], 0, { strokeWidth: getCurrentStrokeWidth() });
}

function buildCircleSelectionFromGps(gpsX, gpsY, radius = getCurrentRadius()) {
    return buildCircleSelection([{
        gpsX,
        gpsY,
        radius,
    }], 0, { strokeWidth: getCurrentStrokeWidth() });
}

function buildZoneSelection(points, radius = getCurrentRadius()) {
    const zonePoints = sanitizeZonePoints(points);
    if (zonePoints.length < 3) return null;
    const center = computePolygonCenter(zonePoints);
    const gps = percentageToGps(center.x, center.y);
    return {
        shapeType: 'zone',
        xPercent: Number(center.x.toFixed(4)),
        yPercent: Number(center.y.toFixed(4)),
        gpsX: Number(gps.x.toFixed(2)),
        gpsY: Number(gps.y.toFixed(2)),
        radius: clampRadius(radius),
        strokeWidth: getCurrentStrokeWidth(),
        zonePoints,
    };
}

function updateRadiusUi(radius = getCurrentRadius()) {
    const value = clampRadius(radius);
    if (dom.radius) dom.radius.value = String(value);
    if (dom.radiusValue) dom.radiusValue.textContent = value.toFixed(1);
}

function updateStrokeWidthUi(strokeWidth = getCurrentStrokeWidth()) {
    const value = clampStrokeWidth(strokeWidth);
    if (dom.strokeWidth) dom.strokeWidth.value = value.toFixed(2);
    if (dom.strokeWidthValue) dom.strokeWidthValue.textContent = value.toFixed(2);
}

function renderCircleTools() {
    if (!dom.circleTools || !dom.circlePicker || !dom.circleToolsHint || !dom.circleCount) return;

    const selection = state.selection;
    const circles = getSelectionCircles(selection);
    const isCircleSelection = Boolean(selection && selection.shapeType !== 'zone' && circles.length);
    dom.circleTools.hidden = !isCircleSelection || state.drawMode;

    if (!isCircleSelection || state.drawMode) {
        dom.circleCount.textContent = '0';
        dom.circlePicker.innerHTML = '';
        return;
    }

    const activeIndex = getActiveCircleIndex(selection);
    const strokeWidth = clampStrokeWidth(selection.strokeWidth || DEFAULT_STROKE_WIDTH);

    dom.circleCount.textContent = String(circles.length);
    dom.circleToolsHint.textContent = circles.length > 1
        ? 'Choisis le cercle a regler. Le rayon suit ce choix, le trait reste global.'
        : 'Un seul cercle actif. Le rayon agit ici, le trait reste global.';

    dom.circlePicker.innerHTML = circles.map((circle, index) => {
        const isActive = index === activeIndex;
        return `
            <button
                type="button"
                class="staff-circle-chip${isActive ? ' is-active' : ''}"
                data-circle-pick="${index}"
                aria-pressed="${isActive ? 'true' : 'false'}"
            >
                <span class="staff-circle-chip-top">
                    <span class="staff-circle-chip-title">Cercle ${index + 1}</span>
                    <span class="staff-circle-chip-badge">${isActive ? 'Actif' : 'Choisir'}</span>
                </span>
                <span class="staff-circle-chip-meta">GPS ${circle.gpsX.toFixed(2)} / ${circle.gpsY.toFixed(2)} • Rayon ${circle.radius.toFixed(1)}</span>
                <span class="staff-circle-chip-meta">Trait global ${strokeWidth.toFixed(2)}</span>
            </button>
        `;
    }).join('');

    Array.from(dom.circlePicker.querySelectorAll('[data-circle-pick]')).forEach((button) => {
        button.onclick = () => {
            const index = Number(button.getAttribute('data-circle-pick'));
            if (!Number.isInteger(index)) return;
            selectActiveCircle(index, { syncForm: true, status: false });
        };
    });
}

function updateDrawActionButtons() {
    const isCircleMode = state.drawMode && state.drawType === 'circle';
    const isZoneMode = state.drawMode && state.drawType === 'free';
    const canCancel = state.drawMode;

    dom.newAlertBtn?.classList.toggle('is-active', isCircleMode);
    dom.startFreeDrawBtn?.classList.toggle('is-active', isZoneMode);

    if (dom.newAlertBtn) {
        dom.newAlertBtn.textContent = isCircleMode ? 'Mode cercle' : 'Tracer cercle';
        dom.newAlertBtn.setAttribute('aria-pressed', isCircleMode ? 'true' : 'false');
    }

    if (dom.startFreeDrawBtn) {
        dom.startFreeDrawBtn.textContent = isZoneMode ? 'Mode zone' : 'Tracer zone';
        dom.startFreeDrawBtn.setAttribute('aria-pressed', isZoneMode ? 'true' : 'false');
    }

    if (dom.cancelDrawBtn) {
        dom.cancelDrawBtn.disabled = !canCancel;
    }
}

function renderInteractivePreview() {
    renderSelection();
    renderBanner();
    renderCircleTools();
    refreshStatusCards();
}

function getDraftCircleDisplayRadius(draft = state.drawCircleDraft) {
    if (!draft) return 0;
    const rawRadius = Number(draft.r || 0);
    if (rawRadius > 0.08) return rawRadius;
    return Math.min(2.4, Math.max(0.55, getCurrentRadius() * 0.32));
}

function setStatusMessage(text, stateName = 'idle') {
    if (!dom.statusMessage) return;
    dom.statusMessage.textContent = text;
    dom.statusMessage.dataset.state = stateName;
}

function formatAlertAdminError(error, fallback = 'Operation impossible.') {
    const rawMessage = String(error?.message || '').trim();
    const normalized = rawMessage.toLowerCase();
    if (!rawMessage) return fallback;
    if (normalized === 'not_found') {
        return 'Service alertes indisponible. Recharge la console ou verifie la fonction Netlify.';
    }
    if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('load failed')) {
        return 'Connexion au service alertes interrompue. Reessaie.';
    }
    if (normalized.startsWith('erreur alerte (4') || normalized.startsWith('erreur alerte (5')) {
        return 'Le service alertes ne repond pas correctement pour le moment.';
    }
    return rawMessage;
}

function setDrawStatus(text, mode = 'circle') {
    if (!dom.drawStatus) return;
    dom.drawStatus.textContent = text;
    dom.drawStatus.dataset.mode = mode;
}

function setLockState(locked) {
    state.unlocked = !locked;
    if (!dom.accessOverlay) return;
    dom.accessOverlay.classList.toggle('is-hidden', !locked);
}

function closeContextMenu() {
    if (!dom.contextMenu) return;
    dom.contextMenu.classList.remove('visible');
    state.contextMenuMapCoords = null;
    state.contextMenuOpen = false;
}

function openContextMenu(clientX, clientY) {
    if (!dom.contextMenu) return;
    let x = clientX;
    let y = clientY;
    const menuWidth = 220;
    const menuHeight = 130;

    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    dom.contextMenu.style.left = `${x}px`;
    dom.contextMenu.style.top = `${y}px`;
    dom.contextMenu.classList.add('visible');
    state.contextMenuOpen = true;
}

function stopDrawingMode(options = {}) {
    const shouldRestore = Boolean(options.restoreBackup);
    const backupAlert = cloneAlertRecord(state.drawBackupAlert);
    state.drawMode = false;
    state.drawType = '';
    state.drawCircleDraft = null;
    state.drawCircleHoverMode = false;
    state.isFreeDrawing = false;
    state.drawDraftPoints = [];
    closeContextMenu();
    if (options.clearBackup !== false) {
        state.drawBackupAlert = null;
        state.drawBackupSelection = null;
    }
    if (shouldRestore) {
        restoreAlertWorkspace(backupAlert);
        return;
    }
    renderSelection();
    renderBanner();
    renderCircleTools();
    updateDrawActionButtons();
    refreshStatusCards();
}

function beginNewAlertDraw(type) {
    const backupAlert = cloneAlertRecord(state.currentAlert);
    const backupSelection = cloneSelection(state.selection);
    const contextCoords = state.contextMenuMapCoords
        ? {
            x: state.contextMenuMapCoords.x,
            y: state.contextMenuMapCoords.y,
        }
        : null;

    closeContextMenu();
    if (isAlertModalOpen()) closeAlertModal({ restore: false });

    state.currentAlert = null;
    fillForm(null, { preserveSelection: false, focus: false });
    state.drawMode = true;
    state.drawType = type;
    state.drawCircleDraft = null;
    state.drawCircleHoverMode = false;
    state.isFreeDrawing = false;
    state.drawDraftPoints = [];
    state.drawBackupAlert = backupAlert;
    state.drawBackupSelection = backupSelection;
    return contextCoords;
}

function startCircleDraw() {
    const contextCoords = beginNewAlertDraw('circle');
    if (contextCoords) {
        state.drawCircleDraft = {
            cx: contextCoords.x,
            cy: contextCoords.y,
            r: 0,
        };
        state.drawCircleHoverMode = true;
    }
    setStatusMessage(
        contextCoords
            ? 'Point de depart place. Bouge la souris pour regler le rayon, puis clique gauche pour valider.'
            : 'Clique puis glisse pour creer le cercle de la nouvelle alerte.',
        'ok'
    );
    renderSelection();
    renderBanner();
    updateDrawActionButtons();
    refreshStatusCards();
}

function startFreeDraw() {
    beginNewAlertDraw('free');
    setStatusMessage('Maintiens clic gauche pour dessiner la zone de la nouvelle alerte.', 'ok');
    renderSelection();
    renderBanner();
    updateDrawActionButtons();
    refreshStatusCards();
}

function finalizeCircleDraft() {
    const draft = state.drawCircleDraft;
    if (!draft) return;
    const originAlert = cloneAlertRecord(state.drawBackupAlert || state.currentAlert);
    const originSelection = cloneSelection(state.drawBackupSelection);

    if (!Number.isFinite(draft.r) || draft.r < 0.2) {
        state.drawCircleDraft = null;
        state.drawCircleHoverMode = false;
        stopDrawingMode({ restoreBackup: true });
        setStatusMessage('Zone trop petite.', 'warn');
        return;
    }

    const nextSelection = buildCircleSelection([{
        xPercent: draft.cx,
        yPercent: draft.cy,
        radius: draft.r,
    }]);

    state.drawCircleDraft = null;
    state.drawCircleHoverMode = false;
    setSelection(nextSelection, {
        syncForm: true,
        resetDraft: true,
    });
    state.drawMode = false;
    state.drawType = '';
    updateAlertModalTitle();
    openAlertModal({
        openedFromDraw: true,
        originAlert,
        originSelection,
    });
    setStatusMessage('Cercle pret. Termine l alerte dans la fenetre.', 'ok');
}

function finalizeFreeDraw() {
    const pointCount = state.drawDraftPoints.length;
    const originAlert = cloneAlertRecord(state.drawBackupAlert || state.currentAlert);
    const originSelection = cloneSelection(state.drawBackupSelection);
    if (pointCount < 3) {
        stopDrawingMode({ restoreBackup: true });
        setStatusMessage('Trace trop court.', 'warn');
        return;
    }

    const nextSelection = buildZoneSelection(state.drawDraftPoints, getCurrentRadius());
    if (!nextSelection) {
        stopDrawingMode({ restoreBackup: true });
        setStatusMessage('Zone invalide.', 'error');
        return;
    }

    setSelection(nextSelection, {
        syncForm: true,
        resetDraft: true,
    });
    state.drawMode = false;
    state.drawType = '';
    state.isFreeDrawing = false;
    updateAlertModalTitle();
    openAlertModal({
        openedFromDraw: true,
        originAlert,
        originSelection,
    });
    setStatusMessage(`Zone prete. ${pointCount} points enregistres.`, 'ok');
}

function refreshModeControls() {
    const selection = state.selection;
    const isZoneSelection = selection?.shapeType === 'zone';
    const circleCount = getSelectionCircles(selection).length;

    if (!state.mapSelectionEnabled) {
        setDrawStatus('Placement en pause. Reactive la selection pour modifier la carte.', 'circle');
        return;
    }

    if (state.drawMode) {
        if (state.drawType === 'circle') {
            setDrawStatus(
                state.drawCircleHoverMode
                    ? 'Nouveau cercle. Bouge la souris pour regler le rayon puis clique gauche pour valider.'
                    : 'Nouveau cercle. Clique puis glisse pour regler le rayon.',
                'circle'
            );
        } else {
            const count = state.drawDraftPoints.length;
            setDrawStatus(`Dessin libre. Maintiens clic gauche pour tracer. ${count} point${count > 1 ? 's' : ''} poses.`, 'zone');
        }
        return;
    }

    if (isZoneSelection) {
        setDrawStatus(`Zone prete. ${selection.zonePoints.length} points enregistres.`, 'zone');
        return;
    }

    setDrawStatus(
        circleCount > 0
            ? 'Glisse le cercle actif pour le deplacer. Shift+clic ajoute un cercle. Clic droit ouvre les outils de zone.'
            : 'Utilise Tracer cercle ou Tracer zone pour commencer.',
        'circle'
    );
}

function beginCircleDrag(event) {
    if (!state.mapSelectionEnabled || state.drawMode) return;
    if (!state.selection || state.selection.shapeType === 'zone') return;
    const circles = getSelectionCircles();
    if (!circles.length) return;

    event.preventDefault();
    event.stopPropagation();

    const rawIndex = Number(event.currentTarget?.dataset.circleIndex);
    const circleIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < circles.length
        ? rawIndex
        : getActiveCircleIndex();
    const circle = circles[circleIndex];
    if (!circle) return;

    selectActiveCircle(circleIndex, { syncForm: true, status: false });
    state.selectionDrag = {
        radius: clampRadius(circle.radius || getCurrentRadius()),
        circleIndex,
    };
    setStatusMessage('Deplacement du cercle en cours.', 'ok');
    renderSelection();
}

function moveCircleDrag(event) {
    if (!state.selectionDrag) return;

    const coords = getMapPercentCoords(event.clientX, event.clientY);
    const circles = getSelectionCircles();
    const circleIndex = Math.min(circles.length - 1, Math.max(0, Number(state.selectionDrag.circleIndex || 0)));
    circles[circleIndex] = {
        xPercent: coords.x,
        yPercent: coords.y,
        radius: state.selectionDrag.radius || getCurrentRadius(),
    };

    setSelection(buildCircleSelection(circles, circleIndex), {
        syncForm: true,
        resetDraft: false,
    });
}

function endCircleDrag() {
    if (!state.selectionDrag) return;
    state.selectionDrag = null;
    renderSelection();
    setStatusMessage('Position du cercle mise a jour.', 'ok');
}

function appendSelectionToLayer(selection, options = {}) {
    if (!dom.alertLayer || !selection) return;

    const isBackground = Boolean(options.background);
    const isInteractive = Boolean(options.interactive);
    const selectionId = String(options.selectionId || '').trim();
    const strokeWidth = clampStrokeWidth(selection.strokeWidth);
    const displayStrokeWidth = isBackground
        ? Math.max(0.02, Number((strokeWidth * 0.92).toFixed(2)))
        : strokeWidth;

    if (selection.shapeType === 'zone' && selection.zonePoints.length >= 3) {
        const zone = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        zone.setAttribute('points', selection.zonePoints.map((point) => `${point.x},${point.y}`).join(' '));
        zone.setAttribute('fill', '#ff4d67');
        zone.setAttribute('fill-opacity', isBackground ? '0.08' : '0.16');
        zone.setAttribute('stroke', '#ff4d67');
        zone.setAttribute('stroke-width', displayStrokeWidth.toFixed(2));
        zone.setAttribute('class', `staff-alert-zone${isBackground ? ' is-background' : ' is-active'}`);
        if (selectionId) zone.dataset.alertId = selectionId;
        dom.alertLayer.appendChild(zone);
        return;
    }

    const circles = getSelectionCircles(selection);
    const activeIndex = getActiveCircleIndex(selection);

    circles.forEach((circle, index) => {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', circle.xPercent);
        ring.setAttribute('cy', circle.yPercent);
        ring.setAttribute('r', String(circle.radius || DEFAULT_RADIUS));
        ring.setAttribute('fill', '#ff4d67');
        ring.setAttribute('fill-opacity', isBackground ? '0.08' : '0.14');
        ring.setAttribute('stroke', '#ff4d67');
        ring.setAttribute('stroke-width', displayStrokeWidth.toFixed(2));
        ring.setAttribute('class', `staff-alert-ring${isBackground ? ' is-background' : ''}`);
        ring.dataset.circleIndex = String(index);
        if (selectionId) ring.dataset.alertId = selectionId;
        if (!isBackground && index === activeIndex) ring.classList.add('is-active');
        if (!isBackground && state.selectionDrag && index === Number(state.selectionDrag.circleIndex)) {
            ring.classList.add('is-dragging');
        }
        if (isInteractive) {
            ring.addEventListener('mousedown', beginCircleDrag);
            ring.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectActiveCircle(index, { syncForm: true, status: false });
            });
        }
        dom.alertLayer.appendChild(ring);
    });
}

function renderSelection() {
    if (!dom.alertLayer) return;
    dom.alertLayer.innerHTML = '';

    const selectedAlertId = getAlertId();
    (Array.isArray(state.alerts) ? state.alerts : []).forEach((alert) => {
        const alertId = getAlertId(alert);
        if (alertId && selectedAlertId && alertId === selectedAlertId) return;
        const alertSelection = buildSelectionFromAlert(alert);
        appendSelectionToLayer(alertSelection, {
            background: true,
            interactive: false,
            selectionId: alertId,
        });
    });

    if (state.drawCircleDraft) {
        const displayRadius = getDraftCircleDisplayRadius(state.drawCircleDraft);
        const draftCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        draftCircle.setAttribute('cx', state.drawCircleDraft.cx);
        draftCircle.setAttribute('cy', state.drawCircleDraft.cy);
        draftCircle.setAttribute('r', String(displayRadius));
        draftCircle.setAttribute('fill', '#ff4d67');
        draftCircle.setAttribute('fill-opacity', '0.1');
        draftCircle.setAttribute('stroke', '#ff4d67');
        draftCircle.setAttribute('stroke-width', getCurrentStrokeWidth().toFixed(2));
        draftCircle.setAttribute('stroke-dasharray', '0.45 0.22');
        draftCircle.setAttribute('class', 'staff-alert-ring is-draft');
        dom.alertLayer.appendChild(draftCircle);
    }

    if (state.drawDraftPoints.length > 0) {
        const draft = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        draft.setAttribute('points', state.drawDraftPoints.map((point) => `${point.x},${point.y}`).join(' '));
        draft.setAttribute('fill', 'none');
        draft.setAttribute('stroke', '#ff4d67');
        draft.setAttribute('stroke-width', getCurrentStrokeWidth().toFixed(2));
        draft.setAttribute('stroke-dasharray', '0.5 0.26');
        draft.setAttribute('class', 'staff-alert-draft');
        dom.alertLayer.appendChild(draft);
    }

    if (state.drawMode) return;

    const selection = state.selection;
    if (!selection) return;
    appendSelectionToLayer(selection, {
        background: false,
        interactive: selection.shapeType !== 'zone',
        selectionId: selectedAlertId,
    });
}

function refreshStatusCards() {
    const selection = state.selection;
    const current = state.currentAlert;
    const activeCircle = getActiveCircle(selection);
    const circleCount = getSelectionCircles(selection).length;
    const draftHasFutureStart = Boolean(dom.active?.checked) && hasFutureStartDate(getDraftStartDate());
    const draftPreview = isAlertModalOpen() && draftHasFutureStart && shouldDraftShowBeforeStart();
    const draftScheduled = isAlertModalOpen() && draftHasFutureStart && !shouldDraftShowBeforeStart();

    if (dom.statusState) {
        if (!state.unlocked) dom.statusState.textContent = 'Verrouille';
        else if (!current && (selection || String(dom.title?.value || '').trim() || String(dom.description?.value || '').trim())) dom.statusState.textContent = 'Pret';
        else if (!current) dom.statusState.textContent = 'Brouillon';
        else if (current.active === false) dom.statusState.textContent = 'Inactive';
        else if (draftPreview || isAlertPreview(current)) dom.statusState.textContent = 'Visible';
        else if (draftScheduled || isAlertScheduled(current)) dom.statusState.textContent = 'Programmee';
        else dom.statusState.textContent = 'Active';
    }
    const coordsLabel = selection
        ? `${(selection.shapeType === 'zone' ? selection.gpsX : activeCircle?.gpsX ?? selection.gpsX).toFixed(2)} / ${(selection.shapeType === 'zone' ? selection.gpsY : activeCircle?.gpsY ?? selection.gpsY).toFixed(2)}`
        : '--';

    if (dom.statusCoords) dom.statusCoords.textContent = coordsLabel;

    if (dom.selectionMode) {
        if (!state.mapSelectionEnabled) dom.selectionMode.textContent = 'Pause';
        else if (state.drawMode && state.drawType === 'circle') dom.selectionMode.textContent = 'Nouveau cercle';
        else if (state.drawMode) dom.selectionMode.textContent = 'Dessin libre';
        else if (!selection) dom.selectionMode.textContent = 'Aucune';
        else if (selection?.shapeType === 'zone') dom.selectionMode.textContent = 'Zone';
        else if (circleCount > 1) dom.selectionMode.textContent = `${circleCount} cercles`;
        else dom.selectionMode.textContent = 'Cercle';
    }

    refreshModeControls();
}

function renderBanner() {
    if (!dom.mapBanner) return;

    const title = String(dom.title?.value || state.currentAlert?.title || '').trim();
    const description = String(dom.description?.value || state.currentAlert?.description || '').trim();
    const selection = state.selection;
    const hasDraft = Boolean(state.drawCircleDraft) || state.drawDraftPoints.length > 0;

    if (!title && !description && !selection && !hasDraft) {
        dom.mapBanner.hidden = true;
        dom.mapBanner.innerHTML = '';
        return;
    }

    let meta = 'Utilise Tracer cercle ou Tracer zone pour choisir la position';
    if (state.drawMode && state.drawType === 'circle') {
        const draft = state.drawCircleDraft;
        const draftGps = draft ? percentageToGps(draft.cx, draft.cy) : null;
        const draftRadius = draft ? Number((draft.r || 0).toFixed(2)) : 0;
        const displayRadius = draft ? getDraftCircleDisplayRadius(draft) : getCurrentRadius();
        meta = draft && draftGps
            ? `Nouveau cercle • GPS ${draftGps.x.toFixed(2)} / ${draftGps.y.toFixed(2)} • Rayon ${Math.max(draftRadius, displayRadius).toFixed(1)} • Trait ${getCurrentStrokeWidth().toFixed(2)}`
            : `Nouveau cercle • Clique puis glisse • Rayon ${getCurrentRadius().toFixed(1)} • Trait ${getCurrentStrokeWidth().toFixed(2)}`;
    }
    const startDate = getDraftStartDate();
    if (!state.drawMode && selection?.shapeType === 'zone') {
        meta = `Zone ${selection.zonePoints.length} points • GPS ${selection.gpsX.toFixed(2)} / ${selection.gpsY.toFixed(2)} • Trait ${getCurrentStrokeWidth().toFixed(2)}`;
    } else if (!state.drawMode && selection) {
        const activeCircle = getActiveCircle(selection) || selection;
        const circleCount = getSelectionCircles(selection).length;
        meta = circleCount > 1
            ? `${circleCount} cercles • Actif ${getActiveCircleIndex(selection) + 1} • GPS ${activeCircle.gpsX.toFixed(2)} / ${activeCircle.gpsY.toFixed(2)} • Rayon ${activeCircle.radius.toFixed(1)} • Trait ${getCurrentStrokeWidth().toFixed(2)}`
            : `GPS ${activeCircle.gpsX.toFixed(2)} / ${activeCircle.gpsY.toFixed(2)} • Rayon ${activeCircle.radius.toFixed(1)} • Trait ${getCurrentStrokeWidth().toFixed(2)} • Glisse pour ajuster`;
    } else if (state.drawDraftPoints.length > 0) {
        meta = `Dessin en cours • ${state.drawDraftPoints.length} points`;
    }
    if (startDate) {
        meta += ` • Diffusion ${formatAlertDateTime(startDate)}`;
        if (shouldDraftShowBeforeStart()) {
            meta += ' • deja visible';
        }
    }

    dom.mapBanner.hidden = false;
    dom.mapBanner.innerHTML = `
        <div class="staff-map-banner-kicker">Alerte en preparation</div>
        <div class="staff-map-banner-title">${escapeText(title || 'Alerte sans titre')}</div>
        <div class="staff-map-banner-desc">${escapeText(description || 'Ajoute une description visible sur la home.')}</div>
        <div class="staff-map-banner-meta">${escapeText(meta)}</div>
    `;
}

function setSelection(selection, options = {}) {
    if (!selection) {
        state.selection = null;
        if (options.resetDraft !== false) {
            state.drawMode = false;
            state.drawType = '';
            state.drawCircleDraft = null;
            state.isFreeDrawing = false;
            state.drawDraftPoints = [];
            state.drawBackupAlert = null;
            state.drawBackupSelection = null;
        }
        renderSelection();
        renderBanner();
        renderCircleTools();
        refreshStatusCards();
        return;
    }

    state.selection = cloneSelection(selection);
    if (options.resetDraft !== false) {
        state.drawMode = false;
        state.drawType = '';
        state.drawCircleDraft = null;
        state.isFreeDrawing = false;
        state.drawDraftPoints = [];
        state.drawBackupAlert = null;
        state.drawBackupSelection = null;
    }

    if (options.syncForm !== false) {
    }

    updateRadiusUi(state.selection.shapeType === 'zone' ? state.selection.radius : (getActiveCircle(state.selection)?.radius || DEFAULT_RADIUS));
    updateStrokeWidthUi(state.selection.strokeWidth || DEFAULT_STROKE_WIDTH);
    renderSelection();
    renderBanner();
    renderCircleTools();
    updateDrawActionButtons();
    refreshStatusCards();
}

function finalizeZoneDraft(options = {}) {
    if (state.drawDraftPoints.length < 3) {
        if (!options.silent) {
            setStatusMessage('Trace au moins 3 points pour valider la zone.', 'warn');
        }
        return false;
    }

    const nextSelection = buildZoneSelection(state.drawDraftPoints, getCurrentRadius());
    if (!nextSelection) {
        if (!options.silent) {
            setStatusMessage('Zone invalide.', 'error');
        }
        return false;
    }

    setSelection(nextSelection, {
        syncForm: true,
        resetDraft: true,
    });

    if (!options.silent) {
        setStatusMessage('Zone validee.', 'ok');
    }
    return true;
}

function readDraftAlert() {
    const title = String(dom.title?.value || '').trim();
    const description = String(dom.description?.value || '').trim();
    const startsAt = readScheduledAtInput();

    if (!title) throw new Error('Titre requis.');
    if (!description) throw new Error('Description requise.');

    if (state.drawMode) {
        throw new Error('Termine le dessin en cours avant de publier.');
    }

    let selection = cloneSelection(state.selection);
    if (!selection) {
        throw new Error('Place au moins un cercle ou une zone.');
    }

    const radius = getCurrentRadius();
    if (selection.shapeType !== 'zone') {
        const circles = getSelectionCircles(selection);
        const activeIndex = getActiveCircleIndex(selection);
        if (activeIndex >= 0 && circles[activeIndex]) {
            circles[activeIndex] = {
                ...circles[activeIndex],
                radius,
            };
        }
        selection = buildCircleSelection(circles, activeIndex);
    }

    const visibilityMode = state.audienceMode === 'whitelist' ? 'whitelist' : 'all';
    const allowedUsers = visibilityMode === 'whitelist' ? sanitizeAllowedUsers(state.allowedUsers) : [];
    if (visibilityMode === 'whitelist' && allowedUsers.length === 0) {
        throw new Error('Ajoute au moins un utilisateur dans la whitelist.');
    }

    const circles = selection.shapeType === 'zone' ? [] : getSelectionCircles(selection);
    const circleSummary = circles.length ? summarizeCircles(circles) : null;

    return {
        id: state.currentAlert?.id || '',
        title,
        description,
        gpsX: Number((selection.shapeType === 'zone' ? selection.gpsX : circleSummary?.gpsX || selection.gpsX).toFixed(2)),
        gpsY: Number((selection.shapeType === 'zone' ? selection.gpsY : circleSummary?.gpsY || selection.gpsY).toFixed(2)),
        xPercent: Number((selection.shapeType === 'zone' ? selection.xPercent : circleSummary?.xPercent || selection.xPercent).toFixed(4)),
        yPercent: Number((selection.shapeType === 'zone' ? selection.yPercent : circleSummary?.yPercent || selection.yPercent).toFixed(4)),
        radius: selection.shapeType === 'zone' ? radius : (circleSummary?.radius || radius),
        strokeWidth: getCurrentStrokeWidth(),
        shapeType: selection.shapeType === 'zone' ? 'zone' : 'circle',
        zonePoints: selection.shapeType === 'zone'
            ? selection.zonePoints.map((point) => ({ x: point.x, y: point.y }))
            : [],
        circles: circles.map((circle) => ({
            xPercent: Number(circle.xPercent.toFixed(4)),
            yPercent: Number(circle.yPercent.toFixed(4)),
            gpsX: Number(circle.gpsX.toFixed(2)),
            gpsY: Number(circle.gpsY.toFixed(2)),
            radius: Number(circle.radius.toFixed(1)),
        })),
        activeCircleIndex: selection.shapeType === 'zone' ? -1 : getActiveCircleIndex(selection),
        visibilityMode,
        allowedUsers,
        active: Boolean(dom.active?.checked),
        startsAt,
        showBeforeStart: shouldDraftShowBeforeStart(),
    };
}

function fillForm(alert, options = {}) {
    if (!dom.title || !dom.description || !dom.active) return;
    const preserveSelection = Boolean(options.preserveSelection);
    const shouldFocus = options.focus !== false;

    state.drawMode = false;
    state.drawDraftPoints = [];
    state.drawBackupAlert = null;
    state.drawBackupSelection = null;

    if (!alert) {
        dom.title.value = '';
        dom.description.value = '';
        dom.active.checked = true;
        if (dom.startAt) dom.startAt.value = '';
        if (dom.showBeforeStart) dom.showBeforeStart.checked = false;
        state.audienceMode = 'all';
        state.allowedUsers = [];
        if (dom.publishBtn) dom.publishBtn.textContent = 'Publier';
        updateRadiusUi(DEFAULT_RADIUS);
        updateStrokeWidthUi(preserveSelection && state.selection ? state.selection.strokeWidth : DEFAULT_STROKE_WIDTH);
        if (!preserveSelection) {
            setSelection(null, { syncForm: false, resetDraft: true });
        } else {
            renderSelection();
            renderBanner();
            renderCircleTools();
            refreshStatusCards();
        }
        refreshStartVisibilityUi();
        renderAudienceUi();
        refreshAlertModePill();
        updateAlertModalTitle();
        if (!preserveSelection && shouldFocus) {
            scheduleMapView(false);
        }
        return;
    }

    dom.title.value = String(alert.title || '');
    dom.description.value = String(alert.description || '');
    dom.active.checked = alert.active !== false;
    if (dom.startAt) dom.startAt.value = toLocalDateTimeInputValue(alert.startsAt || '');
    if (dom.showBeforeStart) dom.showBeforeStart.checked = alert.showBeforeStart === true;
    state.audienceMode = alert.visibilityMode === 'whitelist' ? 'whitelist' : 'all';
    state.allowedUsers = sanitizeAllowedUsers(alert.allowedUsers);
    if (dom.publishBtn) dom.publishBtn.textContent = 'Mettre a jour';
    updateRadiusUi(alert.radius || DEFAULT_RADIUS);
    updateStrokeWidthUi(alert.strokeWidth || DEFAULT_STROKE_WIDTH);
    refreshStartVisibilityUi();
    renderAudienceUi();
    refreshAlertModePill();
    updateAlertModalTitle();

    setSelection(buildSelectionFromAlert(alert), { resetDraft: true });
    if (shouldFocus) {
        scheduleMapView(true);
    }
}

function syncMapFrame() {
    if (!dom.mapWorld || !state.mapWidth || !state.mapHeight) return false;

    dom.mapWorld.style.width = `${state.mapWidth}px`;
    dom.mapWorld.style.height = `${state.mapHeight}px`;

    if (dom.mapImage) {
        dom.mapImage.style.width = '100%';
        dom.mapImage.style.height = '100%';
    }

    if (dom.alertLayer) {
        dom.alertLayer.style.width = '100%';
        dom.alertLayer.style.height = '100%';
    }

    return true;
}

function updateTransform() {
    if (!dom.mapWorld || !syncMapFrame()) return;
    dom.mapWorld.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
}

function centerMap() {
    if (!dom.viewport || !state.mapWidth || !state.mapHeight) return false;
    const viewportWidth = dom.viewport.clientWidth;
    const viewportHeight = dom.viewport.clientHeight;
    if (viewportWidth < 40 || viewportHeight < 40) return false;
    const scale = Math.min(viewportWidth / state.mapWidth, viewportHeight / state.mapHeight);
    state.view.scale = scale || 0.45;
    state.view.x = (viewportWidth - state.mapWidth * state.view.scale) / 2;
    state.view.y = (viewportHeight - state.mapHeight * state.view.scale) / 2;
    updateTransform();
    return true;
}

function focusSelection() {
    const selection = state.selection;
    if (!selection || !dom.viewport || !state.mapWidth || !state.mapHeight) return false;

    const viewportWidth = dom.viewport.clientWidth;
    const viewportHeight = dom.viewport.clientHeight;
    if (viewportWidth < 40 || viewportHeight < 40) return false;

    let focusX = selection.xPercent;
    let focusY = selection.yPercent;
    let scale = 2.35;

    if (selection.shapeType === 'zone' && selection.zonePoints.length >= 3) {
        const bounds = getZoneBounds(selection.zonePoints);
        if (bounds) {
            focusX = (bounds.minX + bounds.maxX) / 2;
            focusY = (bounds.minY + bounds.maxY) / 2;
            const widthPx = Math.max(80, ((bounds.maxX - bounds.minX) / 100) * state.mapWidth);
            const heightPx = Math.max(80, ((bounds.maxY - bounds.minY) / 100) * state.mapHeight);
            const fitScale = Math.min(
                (viewportWidth - 120) / widthPx,
                (viewportHeight - 120) / heightPx
            );
            scale = Math.min(2.2, Math.max(0.8, fitScale));
        }
    } else {
        const bounds = getCircleBounds(selection);
        const activeCircle = getActiveCircle(selection);
        if (bounds && activeCircle) {
            focusX = (bounds.minX + bounds.maxX) / 2;
            focusY = (bounds.minY + bounds.maxY) / 2;
            const widthPx = Math.max(80, ((bounds.maxX - bounds.minX) / 100) * state.mapWidth);
            const heightPx = Math.max(80, ((bounds.maxY - bounds.minY) / 100) * state.mapHeight);
            const fitScale = Math.min(
                (viewportWidth - 120) / widthPx,
                (viewportHeight - 120) / heightPx
            );
            scale = Math.min(2.35, Math.max(0.8, fitScale));
        }
    }

    state.view.scale = scale;
    state.view.x = (viewportWidth / 2) - (focusX * state.mapWidth / 100) * scale;
    state.view.y = (viewportHeight / 2) - (focusY * state.mapHeight / 100) * scale;
    updateTransform();
    return true;
}

function scheduleMapView(preferFocus = true, attempt = 0) {
    if (!state.mapWidth || !state.mapHeight) {
        if (attempt < 12) {
            window.setTimeout(() => scheduleMapView(preferFocus, attempt + 1), 120);
        }
        return;
    }

    const viewportWidth = dom.viewport?.clientWidth || 0;
    const viewportHeight = dom.viewport?.clientHeight || 0;
    if (viewportWidth < 40 || viewportHeight < 40) {
        if (attempt < 12) {
            requestAnimationFrame(() => scheduleMapView(preferFocus, attempt + 1));
        }
        return;
    }

    syncMapFrame();
    const applied = preferFocus && state.selection ? focusSelection() : centerMap();
    if (!applied && attempt < 12) {
        requestAnimationFrame(() => scheduleMapView(preferFocus, attempt + 1));
    }
}

function getMapPercentCoords(clientX, clientY) {
    const rect = dom.mapWorld.getBoundingClientRect();
    const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 50;
    const y = rect.height > 0 ? ((clientY - rect.top) / rect.height) * 100 : 50;
    return {
        x: Math.min(100, Math.max(0, x)),
        y: Math.min(100, Math.max(0, y)),
    };
}

function updateHudCoords(event) {
    if (!dom.coords || !state.mapWidth) return;
    const coords = getMapPercentCoords(event.clientX, event.clientY);
    const gps = percentageToGps(coords.x, coords.y);
    dom.coords.textContent = `GPS: ${gps.x.toFixed(2)} | ${gps.y.toFixed(2)}`;
}

function requestAdmin(action, payload = {}) {
    return alertsApi.requestAdmin(action, payload);
}

function selectAlert(alertId, options = {}) {
    const target = (Array.isArray(state.alerts) ? state.alerts : []).find((alert) => getAlertId(alert) === String(alertId || '').trim());
    if (!target) return null;
    state.currentAlert = cloneAlertRecord(target);
    fillForm(state.currentAlert, { focus: options.focus !== false });
    renderAlertsList();
    if (options.focus !== false) {
        setStatusMessage(`Alerte "${target.title}" chargee.`, 'ok');
    }
    return state.currentAlert;
}

async function loadAlerts(options = {}) {
    const data = await requestAdmin('list-admin');
    state.alerts = Array.isArray(data.alerts) ? data.alerts : [];

    const selectedId = String(options.selectedId || '').trim();
    const keepCurrent = Boolean(options.keepCurrent);
    const currentId = keepCurrent ? getAlertId() : '';

    if (selectedId) {
        const selected = selectAlert(selectedId, { focus: options.focus !== false });
        if (!selected) {
            state.currentAlert = null;
            fillForm(null, { preserveSelection: false, focus: false });
        }
        renderAlertsList();
        return;
    }

    if (currentId) {
        const selected = selectAlert(currentId, { focus: false });
        if (!selected) {
            state.currentAlert = null;
            fillForm(null, { preserveSelection: false, focus: false });
        }
        renderAlertsList();
        return;
    }

    renderAlertsList();
}

function resetToNewAlertDraft(options = {}) {
    state.currentAlert = null;
    fillForm(null, {
        preserveSelection: Boolean(options.keepSelection),
        focus: false,
    });
    renderAlertsList();
    updateAlertModalTitle();
    setStatusMessage('Choisis un mode de creation: Tracer cercle ou Tracer zone.', 'ok');
}

async function loadCurrentAlert() {
    await loadAlerts({ keepCurrent: true });
    refreshStatusCards();
    if (state.currentAlert) {
        if (state.currentAlert.active === false) {
            setStatusMessage('Alerte chargee en brouillon.', 'warn');
        } else if (isAlertPreview(state.currentAlert)) {
            setStatusMessage(`Alerte visible, diffusion fixee pour ${formatAlertDateTime(state.currentAlert.startsAt)}.`, 'ok');
        } else if (isAlertScheduled(state.currentAlert)) {
            setStatusMessage(`Alerte programmee pour ${formatAlertDateTime(state.currentAlert.startsAt)}.`, 'warn');
        } else {
            setStatusMessage('Alerte chargee.', 'ok');
        }
    } else if (state.alerts.length) {
        setStatusMessage('Selectionne une alerte dans les calques ou cree-en une nouvelle.', 'idle');
    } else {
        setStatusMessage('Aucune alerte enregistree. Cree une nouvelle alerte.', 'idle');
    }
}

async function saveAlert() {
    try {
        const payload = readDraftAlert();
        const data = await requestAdmin('upsert', { alert: payload });
        state.currentAlert = data.alert || null;
        await loadAlerts({
            selectedId: getAlertId(state.currentAlert),
            focus: true,
        });
        closeAlertModal({ restore: false });
        refreshStatusCards();
        alertsApi.notifyPublicAlertRefresh();
        if (state.currentAlert?.active === false) {
            setStatusMessage('Alerte sauvegardee en brouillon.', 'warn');
        } else if (isAlertPreview(state.currentAlert)) {
            setStatusMessage(`Alerte visible maintenant, diffusion fixee pour ${formatAlertDateTime(state.currentAlert.startsAt)}.`, 'ok');
        } else if (isAlertScheduled(state.currentAlert)) {
            setStatusMessage(`Alerte programmee pour ${formatAlertDateTime(state.currentAlert.startsAt)}.`, 'ok');
        } else {
            setStatusMessage('Alerte publiee.', 'ok');
        }
    } catch (error) {
        setStatusMessage(formatAlertAdminError(error, 'Impossible de publier l alerte.'), 'error');
    }
}

async function deleteAlert(targetId = getAlertId()) {
    const deleteId = String(targetId || '').trim();
    if (!deleteId) {
        setStatusMessage('Aucune alerte a supprimer.', 'warn');
        return;
    }
    const targetAlert = (Array.isArray(state.alerts) ? state.alerts : []).find((alert) => getAlertId(alert) === deleteId) || state.currentAlert;
    const confirmed = await openConfirmModal({
        title: 'Supprimer l alerte',
        message: `"${String(targetAlert?.title || 'Alerte sans titre')}" sera retiree de la carte et de la home.`,
        confirmLabel: 'Supprimer',
        tone: 'danger',
    });
    if (!confirmed) return;

    try {
        await requestAdmin('delete', { id: deleteId });
        const wasCurrent = deleteId === getAlertId();
        if (wasCurrent) {
            state.currentAlert = null;
            fillForm(null, { preserveSelection: false, focus: false });
        }
        await loadAlerts({ keepCurrent: !wasCurrent, focus: false });
        closeAlertModal({ restore: false });
        refreshStatusCards();
        alertsApi.notifyPublicAlertRefresh();
        setStatusMessage('Alerte supprimee.', 'ok');
    } catch (error) {
        setStatusMessage(formatAlertAdminError(error, 'Suppression impossible.'), 'error');
    }
}

function choosePositionOnMap(event) {
    if (Number(event?.button) !== 0) return;
    if (!state.unlocked || !state.mapSelectionEnabled || state.drawMode) return;

    const coords = getMapPercentCoords(event.clientX, event.clientY);
    const gps = percentageToGps(coords.x, coords.y);
    const previousAlert = cloneAlertRecord(state.currentAlert);
    const previousSelection = cloneSelection(state.selection);
    const currentSelection = cloneSelection(state.selection);
    const shouldAppendCircle = Boolean(event.shiftKey && currentSelection && currentSelection.shapeType !== 'zone');

    let nextSelection = null;
    if (currentSelection && currentSelection.shapeType !== 'zone') {
        const circles = getSelectionCircles(currentSelection);
        const activeIndex = getActiveCircleIndex(currentSelection);
        const nextIndex = shouldAppendCircle
            ? circles.length
            : Math.max(0, activeIndex);

        const radius = shouldAppendCircle
            ? getCurrentRadius()
            : clampRadius(circles[nextIndex]?.radius ?? getCurrentRadius());
        const nextCircle = {
            xPercent: Number(coords.x.toFixed(4)),
            yPercent: Number(coords.y.toFixed(4)),
            gpsX: Number(gps.x.toFixed(2)),
            gpsY: Number(gps.y.toFixed(2)),
            radius,
        };

        if (shouldAppendCircle) {
            circles.push(nextCircle);
        } else if (circles.length) {
            circles[nextIndex] = nextCircle;
        } else {
            circles.push(nextCircle);
        }

        nextSelection = buildCircleSelection(circles, Math.min(circles.length - 1, nextIndex), {
            strokeWidth: currentSelection.strokeWidth || getCurrentStrokeWidth(),
        });
    } else {
        nextSelection = buildCircleSelection([{
            xPercent: Number(coords.x.toFixed(4)),
            yPercent: Number(coords.y.toFixed(4)),
            gpsX: Number(gps.x.toFixed(2)),
            gpsY: Number(gps.y.toFixed(2)),
            radius: getCurrentRadius(),
        }], 0, {
            strokeWidth: currentSelection?.strokeWidth || getCurrentStrokeWidth(),
        });
    }

    if (!nextSelection) {
        setStatusMessage('Impossible de positionner l alerte.', 'error');
        return;
    }

    setSelection(nextSelection, {
        syncForm: true,
        resetDraft: true,
    });
    focusSelection();

    if (!isAlertModalOpen()) {
        openAlertModal({
            openedFromDraw: false,
            originAlert: previousAlert,
            originSelection: previousSelection,
        });
    }

    const message = shouldAppendCircle
        ? 'Cercle ajoute depuis la carte. Complete puis enregistre.'
        : 'Position de l alerte mise a jour. Complete puis enregistre.';
    setStatusMessage(message, 'ok');
}

function initMap() {
    if (dom.mapImage?.complete && dom.mapImage.naturalWidth > 0 && dom.mapImage.naturalHeight > 0) {
        state.mapWidth = dom.mapImage.naturalWidth;
        state.mapHeight = dom.mapImage.naturalHeight;
        syncMapFrame();
        scheduleMapView(Boolean(state.selection));
    } else if (dom.mapImage) {
        dom.mapImage.onload = () => {
            state.mapWidth = dom.mapImage.naturalWidth;
            state.mapHeight = dom.mapImage.naturalHeight;
            syncMapFrame();
            scheduleMapView(Boolean(state.selection));
        };
    }

    dom.viewport?.addEventListener('wheel', (event) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -1 : 1;
        const nextScale = state.view.scale * (1 + delta * 0.1);
        if (nextScale < 0.08 || nextScale > 7) return;

        const rect = dom.viewport.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        state.view.x = mouseX - (mouseX - state.view.x) * (nextScale / state.view.scale);
        state.view.y = mouseY - (mouseY - state.view.y) * (nextScale / state.view.scale);
        state.view.scale = nextScale;
        updateTransform();
    }, { passive: false });

    dom.viewport?.addEventListener('contextmenu', (event) => {
        if (!state.unlocked) return;
        if (state.drawMode || state.selectionDrag) return;
        event.preventDefault();
        event.stopPropagation();
        state.pointer.active = false;
        state.pointer.moved = false;
        state.contextMenuMapCoords = getMapPercentCoords(event.clientX, event.clientY);
        openContextMenu(event.clientX, event.clientY);
    });

    dom.viewport?.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;

        closeContextMenu();

        if (state.drawMode && state.drawType === 'circle') {
            const coords = getMapPercentCoords(event.clientX, event.clientY);
            if (state.drawCircleHoverMode && state.drawCircleDraft) {
                const dx = coords.x - state.drawCircleDraft.cx;
                const dy = coords.y - state.drawCircleDraft.cy;
                state.drawCircleDraft.r = Math.sqrt((dx * dx) + (dy * dy));
                finalizeCircleDraft();
                return;
            }
            state.drawCircleDraft = {
                cx: coords.x,
                cy: coords.y,
                r: 0,
            };
            state.drawCircleHoverMode = false;
            renderInteractivePreview();
            return;
        }

        if (state.drawMode && state.drawType === 'free') {
            const coords = getMapPercentCoords(event.clientX, event.clientY);
            state.isFreeDrawing = true;
            state.drawDraftPoints = [{
                x: Number(coords.x.toFixed(4)),
                y: Number(coords.y.toFixed(4)),
            }];
            renderInteractivePreview();
            return;
        }

        state.pointer.active = true;
        state.pointer.moved = false;
        state.pointer.startX = event.clientX;
        state.pointer.startY = event.clientY;
        state.pointer.lastX = event.clientX;
        state.pointer.lastY = event.clientY;
    });

    let pendingMouseMoveFrame = false;
    let latestMouseMoveEvent = null;

    const processMouseMove = () => {
        pendingMouseMoveFrame = false;
        const event = latestMouseMoveEvent;
        if (!event) return;

        updateHudCoords(event);
        if (state.selectionDrag) {
            moveCircleDrag(event);
            return;
        }

        if (state.drawMode && state.drawType === 'circle' && state.drawCircleDraft) {
            const coords = getMapPercentCoords(event.clientX, event.clientY);
            const dx = coords.x - state.drawCircleDraft.cx;
            const dy = coords.y - state.drawCircleDraft.cy;
            state.drawCircleDraft.r = Math.sqrt((dx * dx) + (dy * dy));
            renderInteractivePreview();
            return;
        }

        if (state.drawMode && state.drawType === 'free' && state.isFreeDrawing) {
            const coords = getMapPercentCoords(event.clientX, event.clientY);
            const lastPoint = state.drawDraftPoints[state.drawDraftPoints.length - 1];
            const distance = lastPoint
                ? ((coords.x - lastPoint.x) ** 2) + ((coords.y - lastPoint.y) ** 2)
                : 1;
            if (distance > 0.00002) {
                state.drawDraftPoints.push({
                    x: Number(coords.x.toFixed(4)),
                    y: Number(coords.y.toFixed(4)),
                });
                renderInteractivePreview();
            }
            return;
        }

        if (!state.pointer.active) return;

        const deltaX = event.clientX - state.pointer.lastX;
        const deltaY = event.clientY - state.pointer.lastY;
        const totalX = Math.abs(event.clientX - state.pointer.startX);
        const totalY = Math.abs(event.clientY - state.pointer.startY);

        if (totalX > 4 || totalY > 4) {
            state.pointer.moved = true;
        }

        if (state.pointer.moved) {
            state.view.x += deltaX;
            state.view.y += deltaY;
            updateTransform();
        }

        state.pointer.lastX = event.clientX;
        state.pointer.lastY = event.clientY;
    };

    window.addEventListener('mousemove', (event) => {
        latestMouseMoveEvent = event;
        if (pendingMouseMoveFrame) return;
        pendingMouseMoveFrame = true;
        requestAnimationFrame(processMouseMove);
    });

    window.addEventListener('mouseup', (event) => {
        if (state.selectionDrag) {
            endCircleDrag();
            return;
        }

        if (state.drawMode && state.drawType === 'circle' && state.drawCircleDraft) {
            finalizeCircleDraft();
            return;
        }

        if (state.drawMode && state.drawType === 'free' && state.isFreeDrawing) {
            state.isFreeDrawing = false;
            finalizeFreeDraw();
            return;
        }

        if (event.button !== 0) {
            state.pointer.active = false;
            state.pointer.moved = false;
            return;
        }

        if (!state.pointer.active) return;
        const moved = state.pointer.moved;
        state.pointer.active = false;
        if (!moved && event.shiftKey && dom.viewport?.contains(event.target)) choosePositionOnMap(event);
    });
}

function unlockConsole() {
    setLockState(false);
    if (dom.accessInput) dom.accessInput.value = '';
    if (dom.accessError) dom.accessError.textContent = '';
    loadCurrentAlert().catch((error) => {
        setStatusMessage(formatAlertAdminError(error, 'Impossible de charger les alertes.'), 'error');
    });
    scheduleMapView(Boolean(state.selection));
}

function bindEvents() {
    dom.accessSubmit?.addEventListener('click', () => {
        const code = String(dom.accessInput?.value || '').trim();
        if (code !== STAFF_CODE) {
            if (dom.accessError) dom.accessError.textContent = 'Code incorrect.';
            return;
        }
        unlockConsole();
    });

    dom.accessInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') dom.accessSubmit?.click();
    });

    dom.newAlertBtn?.addEventListener('click', () => {
        if (!state.unlocked) return;
        startCircleDraw();
    });
    dom.startFreeDrawBtn?.addEventListener('click', () => {
        if (!state.unlocked) return;
        startFreeDraw();
    });
    dom.cancelDrawBtn?.addEventListener('click', () => {
        if (!state.drawMode) return;
        stopDrawingMode({ restoreBackup: true });
        setStatusMessage('Trace annule.', 'warn');
    });

    dom.publishBtn?.addEventListener('click', saveAlert);
    dom.modalCloseBtn?.addEventListener('click', () => closeAlertModal({ restore: true }));
    dom.modalCancelBtn?.addEventListener('click', () => closeAlertModal({ restore: true }));
    dom.confirmCloseBtn?.addEventListener('click', () => closeConfirmModal(false));
    dom.confirmCancelBtn?.addEventListener('click', () => closeConfirmModal(false));
    dom.confirmOkBtn?.addEventListener('click', () => closeConfirmModal(true));
    dom.ctxNewZone?.addEventListener('click', startCircleDraw);
    dom.ctxNewFreeZone?.addEventListener('click', startFreeDraw);
    dom.ctxCancel?.addEventListener('click', closeContextMenu);

    dom.radius?.addEventListener('input', () => {
        const radius = getCurrentRadius();
        updateRadiusUi(radius);
        if (state.selection?.shapeType !== 'zone') {
            const circles = getSelectionCircles();
            if (circles.length) {
                const activeIndex = getActiveCircleIndex();
                circles[activeIndex] = {
                    ...circles[activeIndex],
                    radius,
                };
                setSelection(buildCircleSelection(circles, activeIndex), {
                    syncForm: false,
                    resetDraft: false,
                });
            } else if (state.drawCircleDraft) {
                state.drawCircleDraft.r = radius;
                renderInteractivePreview();
            } else {
                refreshStatusCards();
            }
        } else {
            renderBanner();
            refreshStatusCards();
        }
    });

    dom.strokeWidth?.addEventListener('input', () => {
        const strokeWidth = getCurrentStrokeWidth();
        updateStrokeWidthUi(strokeWidth);
        if (state.selection) {
            setSelection({
                ...cloneSelection(state.selection),
                strokeWidth,
            }, {
                syncForm: false,
                resetDraft: false,
            });
        } else {
            renderInteractivePreview();
        }
    });

    dom.resetView?.addEventListener('click', centerMap);

    dom.title?.addEventListener('input', renderBanner);
    dom.description?.addEventListener('input', renderBanner);
    dom.active?.addEventListener('change', () => {
        refreshAlertModePill();
        renderBanner();
        refreshStatusCards();
    });
    dom.startAt?.addEventListener('input', () => {
        refreshStartVisibilityUi();
        refreshAlertModePill();
        renderBanner();
        refreshStatusCards();
    });
    dom.startVisibilityWaitBtn?.addEventListener('click', () => {
        if (!hasFutureStartDate(getDraftStartDate())) return;
        if (dom.showBeforeStart) dom.showBeforeStart.checked = false;
        refreshStartVisibilityUi();
        refreshAlertModePill();
        renderBanner();
        refreshStatusCards();
    });
    dom.startVisibilityShowNowBtn?.addEventListener('click', () => {
        if (!hasFutureStartDate(getDraftStartDate())) return;
        if (dom.showBeforeStart) dom.showBeforeStart.checked = true;
        refreshStartVisibilityUi();
        refreshAlertModePill();
        renderBanner();
        refreshStatusCards();
    });
    dom.audienceAllBtn?.addEventListener('click', () => {
        state.audienceMode = 'all';
        renderAudienceUi();
    });
    dom.audienceWhitelistBtn?.addEventListener('click', () => {
        state.audienceMode = 'whitelist';
        renderAudienceUi();
        window.setTimeout(() => {
            dom.whitelistInput?.focus();
        }, 0);
    });
    dom.whitelistAddBtn?.addEventListener('click', () => addWhitelistUser(dom.whitelistInput?.value || ''));
    dom.whitelistInput?.addEventListener('input', () => {
        renderWhitelistComposerState();
        loadUserDirectory(dom.whitelistInput?.value || '').catch(() => {});
    });
    dom.whitelistInput?.addEventListener('focus', () => {
        renderWhitelistComposerState();
        loadUserDirectory(dom.whitelistInput?.value || '').catch(() => {});
    });
    dom.whitelistInput?.addEventListener('blur', () => {
        window.setTimeout(() => {
            hideWhitelistSuggestions();
        }, 120);
    });
    dom.whitelistInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addWhitelistUser(dom.whitelistInput?.value || '');
        }
    });

    window.addEventListener('resize', () => {
        closeContextMenu();
        scheduleMapView(Boolean(state.selection));
    });

    window.addEventListener('load', () => {
        scheduleMapView(Boolean(state.selection));
    });

    window.addEventListener('click', (event) => {
        if (!state.contextMenuOpen) return;
        if (dom.contextMenu?.contains(event.target)) return;
        closeContextMenu();
    });

    dom.modal?.addEventListener('click', (event) => {
        if (event.target === dom.modal) {
            closeAlertModal({ restore: true });
        }
    });

    dom.confirmModal?.addEventListener('click', (event) => {
        if (event.target === dom.confirmModal) {
            closeConfirmModal(false);
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isConfirmModalOpen()) {
            closeConfirmModal(false);
            return;
        }
        if (event.key === 'Escape' && state.drawMode) {
            stopDrawingMode({ restoreBackup: true });
            setStatusMessage('Trace annule.', 'warn');
            return;
        }
        if (event.key === 'Escape' && isAlertModalOpen()) {
            closeAlertModal({ restore: true });
        }
    });

}

document.addEventListener('DOMContentLoaded', () => {
    updateRadiusUi(DEFAULT_RADIUS);
    updateStrokeWidthUi(DEFAULT_STROKE_WIDTH);
    bindEvents();
    initMap();
    renderAudienceUi();
    renderAlertsList();
    updateAlertModalTitle();
    refreshStartVisibilityUi();
    refreshAlertModePill();
    updateDrawActionButtons();
    refreshStatusCards();
    renderBanner();
    if (dom.accessInput) dom.accessInput.focus();
});
