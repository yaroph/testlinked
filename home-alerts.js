const ALERTS_ENDPOINT = '/.netlify/functions/alerts';
const DISMISS_STORAGE_KEY = 'bniAlertDismissed_v1';
const ALERT_REFRESH_EVENT_KEY = 'bniAlertRefresh_v1';
const ALERT_REFRESH_CHANNEL = 'bni-alert-refresh';
const ALERT_POLL_MS = 6000;
const COLLAB_SESSION_STORAGE_KEY = 'bniLinkedCollabSession_v1';

let homeReady = false;
let pendingRefresh = false;
let currentAlerts = [];
let currentAlertIndex = 0;

function getAlertPhase(alert) {
    if (!alert || typeof alert !== 'object') {
        return {
            phase: 'live',
            kicker: 'Alerte BNI',
            state: 'Signal actif'
        };
    }

    if (alert.scheduled === true) {
        return {
            phase: 'scheduled',
            kicker: 'Prediction BNI',
            state: alert.showBeforeStart === true ? 'Projection active' : 'Diffusion planifiee'
        };
    }

    return {
        phase: 'live',
        kicker: 'Alerte BNI',
        state: 'Signal actif'
    };
}

function readViewerSession() {
    try {
        const raw = localStorage.getItem(COLLAB_SESSION_STORAGE_KEY);
        if (!raw) return { token: '', user: null };
        const parsed = JSON.parse(raw);
        return {
            token: String(parsed?.token || ''),
            user: parsed?.user && typeof parsed.user === 'object' ? parsed.user : null
        };
    } catch (e) {
        return { token: '', user: null };
    }
}

function signature(alert) {
    if (!alert) return '';
    return `${String(alert.id || '')}:${String(alert.updatedAt || '')}`;
}

function readDismissedSignatures() {
    try {
        const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY) || '';
        if (!raw) return new Set();
        if (raw.startsWith('[')) {
            const parsed = JSON.parse(raw);
            return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value || '')).filter(Boolean) : []);
        }
        return new Set([raw]);
    } catch (e) {
        return new Set();
    }
}

function writeDismissedSignatures(values) {
    try {
        const next = [...new Set(Array.from(values || []).map((value) => String(value || '')).filter(Boolean))].slice(-80);
        if (!next.length) {
            sessionStorage.removeItem(DISMISS_STORAGE_KEY);
            return;
        }
        sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {}
}

function dismissSignature(value) {
    const next = readDismissedSignatures();
    if (value) next.add(String(value));
    writeDismissedSignatures(next);
}

function pruneDismissedSignatures(alerts) {
    const active = new Set((Array.isArray(alerts) ? alerts : []).map((alert) => signature(alert)).filter(Boolean));
    const current = readDismissedSignatures();
    const next = new Set();
    current.forEach((value) => {
        if (active.has(value)) next.add(value);
    });
    writeDismissedSignatures(next);
}

function isHomeReady() {
    if (!document.body || document.body.classList.contains('app-loading')) return false;

    const bootLayer = document.getElementById('boot-layer');
    const bioLayer = document.getElementById('bio-layer');
    const isHidden = (element) => {
        if (!element) return true;
        if (element.hidden) return true;
        const style = window.getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
    };

    return isHidden(bootLayer) && isHidden(bioLayer);
}

function waitForHomeReady(callback) {
    if (isHomeReady()) {
        homeReady = true;
        callback();
        return;
    }

    const timer = window.setInterval(() => {
        if (!isHomeReady()) return;
        window.clearInterval(timer);
        homeReady = true;
        callback();
    }, 140);
}

function getVisibleAlerts() {
    const dismissed = readDismissedSignatures();
    return currentAlerts.filter((alert) => {
        const alertSignature = signature(alert);
        return Boolean(alertSignature) && alert.active !== false && !dismissed.has(alertSignature);
    });
}

function getCurrentAlert() {
    const visibleAlerts = getVisibleAlerts();
    if (!visibleAlerts.length) return null;
    if (currentAlertIndex >= visibleAlerts.length) currentAlertIndex = visibleAlerts.length - 1;
    if (currentAlertIndex < 0) currentAlertIndex = 0;
    return visibleAlerts[currentAlertIndex] || null;
}

function syncCurrentAlertIndex(preferredSignature = '') {
    const visibleAlerts = getVisibleAlerts();
    if (!visibleAlerts.length) {
        currentAlertIndex = 0;
        return null;
    }

    if (preferredSignature) {
        const preferredIndex = visibleAlerts.findIndex((alert) => signature(alert) === preferredSignature);
        if (preferredIndex >= 0) {
            currentAlertIndex = preferredIndex;
            return visibleAlerts[currentAlertIndex];
        }
    }

    if (currentAlertIndex >= visibleAlerts.length) currentAlertIndex = visibleAlerts.length - 1;
    if (currentAlertIndex < 0) currentAlertIndex = 0;
    return visibleAlerts[currentAlertIndex];
}

function showPreviousAlert(event) {
    event?.stopPropagation?.();
    const visibleAlerts = getVisibleAlerts();
    if (visibleAlerts.length <= 1) return;
    currentAlertIndex = (currentAlertIndex - 1 + visibleAlerts.length) % visibleAlerts.length;
    renderPopup();
}

function showNextAlert(event) {
    event?.stopPropagation?.();
    const visibleAlerts = getVisibleAlerts();
    if (visibleAlerts.length <= 1) return;
    currentAlertIndex = (currentAlertIndex + 1) % visibleAlerts.length;
    renderPopup();
}

function injectPopup() {
    if (document.getElementById('site-alert-popup')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div id="site-alert-popup" class="site-alert-popup" hidden>
            <button id="site-alert-close" class="site-alert-close" type="button" aria-label="Fermer">×</button>
            <div class="site-alert-head">
                <div class="site-alert-title-block">
                    <div id="site-alert-kicker" class="site-alert-kicker">Alerte BNI</div>
                    <div id="site-alert-state" class="site-alert-state">
                        <span class="site-alert-state-dot" aria-hidden="true"></span>
                        <span id="site-alert-state-label">Signal actif</span>
                    </div>
                </div>
                <div id="site-alert-counter" class="site-alert-counter" hidden></div>
            </div>
            <div id="site-alert-title" class="site-alert-title"></div>
            <div id="site-alert-desc" class="site-alert-desc"></div>
            <div id="site-alert-nav" class="site-alert-nav" hidden>
                <button id="site-alert-prev" class="site-alert-nav-btn" type="button" aria-label="Alerte precedente">‹</button>
                <div id="site-alert-nav-label" class="site-alert-nav-label"></div>
                <button id="site-alert-next" class="site-alert-nav-btn" type="button" aria-label="Alerte suivante">›</button>
            </div>
            <div class="site-alert-actions">
                <button id="site-alert-open" class="site-alert-open" type="button">Voir sur carte</button>
            </div>
        </div>
    `;

    document.body.appendChild(wrapper);

    const popup = document.getElementById('site-alert-popup');
    const closeBtn = document.getElementById('site-alert-close');
    const openBtn = document.getElementById('site-alert-open');
    const prevBtn = document.getElementById('site-alert-prev');
    const nextBtn = document.getElementById('site-alert-next');

    const openAlert = () => {
        const alert = getCurrentAlert();
        if (!alert) return;
        const alertId = String(alert.id || '').trim();
        window.location.href = alertId ? `./map/?alert=${encodeURIComponent(alertId)}` : './map/';
    };

    closeBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const alert = getCurrentAlert();
        if (!alert) return;
        dismissSignature(signature(alert));
        syncCurrentAlertIndex();
        renderPopup();
    });

    openBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        openAlert();
    });

    prevBtn?.addEventListener('click', showPreviousAlert);
    nextBtn?.addEventListener('click', showNextAlert);
    popup?.addEventListener('click', openAlert);
}

function renderPopup() {
    const popup = document.getElementById('site-alert-popup');
    const title = document.getElementById('site-alert-title');
    const desc = document.getElementById('site-alert-desc');
    const counter = document.getElementById('site-alert-counter');
    const nav = document.getElementById('site-alert-nav');
    const navLabel = document.getElementById('site-alert-nav-label');
    const kicker = document.getElementById('site-alert-kicker');
    const stateLabel = document.getElementById('site-alert-state-label');
    if (!popup || !title || !desc || !counter || !nav || !navLabel || !kicker || !stateLabel) return;

    if (!homeReady) {
        popup.hidden = true;
        return;
    }

    const visibleAlerts = getVisibleAlerts();
    const alert = getCurrentAlert();

    if (!alert || !visibleAlerts.length) {
        popup.hidden = true;
        return;
    }

    title.textContent = String(alert.title || 'Alerte BNI');
    desc.textContent = String(alert.description || '');
    const phase = getAlertPhase(alert);

    kicker.textContent = phase.kicker;
    stateLabel.textContent = phase.state;
    popup.dataset.phase = phase.phase;

    counter.hidden = false;
    counter.textContent = visibleAlerts.length > 1 ? `${visibleAlerts.length} actives` : '1 active';

    nav.hidden = visibleAlerts.length <= 1;
    navLabel.textContent = `${currentAlertIndex + 1} / ${visibleAlerts.length}`;

    popup.hidden = false;
}

async function fetchPublicAlerts() {
    const cacheBust = `t=${Date.now()}`;
    const session = readViewerSession();
    const response = await fetch(`${ALERTS_ENDPOINT}?${cacheBust}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            'Cache-Control': 'no-cache',
            ...(session.token ? { 'x-collab-token': session.token } : {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
        throw new Error(data.error || `Erreur alerte (${response.status})`);
    }

    const alerts = Array.isArray(data.alerts)
        ? data.alerts
        : (data.alert ? [data.alert] : []);
    return alerts.filter((alert) => alert && typeof alert === 'object');
}

async function refreshAlert() {
    if (!homeReady) {
        pendingRefresh = true;
        return;
    }

    try {
        const previousSignature = signature(getCurrentAlert());
        currentAlerts = await fetchPublicAlerts();
        pruneDismissedSignatures(currentAlerts);
        syncCurrentAlertIndex(previousSignature);
        renderPopup();
    } catch (error) {
        console.error('[HOME ALERT]', error);
    }
}

function requestRefresh() {
    if (!homeReady) {
        pendingRefresh = true;
        return;
    }
    refreshAlert().catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
    injectPopup();

    waitForHomeReady(() => {
        renderPopup();
        refreshAlert().catch(() => {});
        window.setInterval(() => {
            requestRefresh();
        }, ALERT_POLL_MS);

        if (pendingRefresh) {
            pendingRefresh = false;
            requestRefresh();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestRefresh();
        }
    });

    window.addEventListener('pageshow', () => {
        requestRefresh();
    });

    window.addEventListener('storage', (event) => {
        if (event.key === ALERT_REFRESH_EVENT_KEY) {
            requestRefresh();
        }
    });

    try {
        if (typeof BroadcastChannel === 'function') {
            const channel = new BroadcastChannel(ALERT_REFRESH_CHANNEL);
            channel.onmessage = () => {
                requestRefresh();
            };
        }
    } catch (e) {}
});
