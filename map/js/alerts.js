import { state } from './state.js';
import { renderAll, getMapPercentCoords } from './render.js';
import { updateTransform } from './engine.js';
import { percentageToGps } from './utils.js';
import { customAlert } from './ui-modals.js';

const ALERTS_ENDPOINT = '/.netlify/functions/alerts';
const ALERT_REFRESH_EVENT_KEY = 'bniAlertRefresh_v1';
const ALERT_REFRESH_CHANNEL = 'bni-alert-refresh';
const ALERT_POLL_MS = 6000;
const ALERT_APPROACH_FALLBACK_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const ALERT_TIMELINE_TICK_MS = 1000;
const COLLAB_SESSION_STORAGE_KEY = 'bniLinkedCollabSession_v1';
const MAP_ALERT_SEEN_STORAGE_KEY = 'bniMapAlertSeen_v2';
const MAP_ALERT_CLICK_EVENT = 'bni:map-alert-click';
const MAP_TRANSFORM_EVENT = 'bni:map-transform-changed';
let alertRefreshStarted = false;
const alertUiState = {
    activeBannerIndex: 0,
    activeBannerKey: '',
    clickListenerBound: false,
    positionFrame: 0,
    timelineTimer: 0,
};

function escapeText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toValidDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function formatAlertDateTime(value) {
    const date = toValidDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(date);
}

function formatRemainingTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'maintenant';
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
        return `dans ${days} j${hours ? ` ${hours} h` : ''}`;
    }
    if (hours > 0) {
        return `dans ${hours} h${minutes ? ` ${minutes} min` : ''}`;
    }
    return `dans ${minutes} min`;
}

function isScheduledAlert(alert) {
    const startsAt = toValidDate(alert?.startsAt || '');
    return Boolean(startsAt && startsAt.getTime() > Date.now());
}

function isAlertVisibleOnMap(alert) {
    if (!alert || alert.active === false) return false;
    if (isScheduledAlert(alert) && alert.showBeforeStart !== true) return false;
    return true;
}

function hashUnit(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function getAlertApproachSeed(alert) {
    return [
        String(alert?.id || ''),
        String(alert?.startsAt || ''),
        String(alert?.createdAt || ''),
        String(alert?.updatedAt || ''),
        String(alert?.title || ''),
    ].join('::');
}

function getAlertApproachReferenceMs(alert, startMs) {
    const dates = [alert?.createdAt, alert?.updatedAt]
        .map((value) => toValidDate(value))
        .filter(Boolean)
        .map((date) => date.getTime())
        .filter((timestamp) => timestamp < startMs);
    if (dates.length) {
        return Math.min(...dates);
    }
    return startMs - ALERT_APPROACH_FALLBACK_WINDOW_MS;
}

function computeAlertApproachScore(alert, timestamp = Date.now()) {
    const startsAt = toValidDate(alert?.startsAt || '');
    if (!startsAt) return null;

    const startMs = startsAt.getTime();
    if (timestamp >= startMs) return 100;

    const remainingMs = Math.max(0, startMs - timestamp);
    const referenceMs = getAlertApproachReferenceMs(alert, startMs);
    const totalWindowMs = Math.max(60 * 60 * 1000, startMs - referenceMs);
    const linearProgress = clamp(1 - (remainingMs / totalWindowMs), 0, 1);
    const pressure = Math.pow(linearProgress, 0.28);
    const seed = getAlertApproachSeed(alert);
    const secondBucket = Math.floor(timestamp / ALERT_TIMELINE_TICK_MS);
    const fastWave = Math.sin(
        (timestamp / 1000) * (0.72 + (hashUnit(`${seed}:freq-fast`) * 0.42))
        + (hashUnit(`${seed}:phase-fast`) * Math.PI * 2)
    );
    const slowWave = Math.sin(
        (timestamp / 4200) * (0.64 + (hashUnit(`${seed}:freq-slow`) * 0.3))
        + (hashUnit(`${seed}:phase-slow`) * Math.PI * 2)
    );
    const pulseNoise = ((hashUnit(`${seed}:pulse:${secondBucket}`) * 2) - 1) * 0.85;
    const driftNoise = ((hashUnit(`${seed}:drift:${Math.floor(secondBucket / 6)}`) * 2) - 1) * 0.55;
    const volatility = ((1 - pressure) * 18) + 1.25;
    const baseline = 7 + (pressure * 84);
    const floor = Math.min(99.2, 5 + (pressure * 87));
    let score = baseline + ((fastWave * 0.45) + (slowWave * 0.28) + pulseNoise + driftNoise) * volatility;

    if (remainingMs <= 72 * 60 * 60 * 1000) {
        const closeRatio = 1 - (remainingMs / (72 * 60 * 60 * 1000));
        score = Math.max(score, 54 + (Math.pow(closeRatio, 0.58) * 34));
    }
    if (remainingMs <= 6 * 60 * 60 * 1000) {
        score = Math.max(score, 83 + ((1 - (remainingMs / (6 * 60 * 60 * 1000))) * 12));
    }
    if (remainingMs <= 60 * 60 * 1000) {
        score = Math.max(score, 94 + ((1 - (remainingMs / (60 * 60 * 1000))) * 4.6));
    }
    if (remainingMs <= 15 * 60 * 1000) {
        score = Math.max(score, 98 + ((1 - (remainingMs / (15 * 60 * 1000))) * 1.7));
    }

    return Number(clamp(score, floor, 99.6).toFixed(1));
}

function getAlertTimeline(alert) {
    const startsAt = toValidDate(alert?.startsAt || '');
    if (!startsAt) return null;

    const startMs = startsAt.getTime();
    const now = Date.now();
    const remainingMs = startMs - now;
    const scheduled = remainingMs > 0;
    const progress = scheduled
        ? (computeAlertApproachScore(alert, now) ?? 0)
        : 100;
    const previousProgress = scheduled
        ? (computeAlertApproachScore(alert, now - ALERT_TIMELINE_TICK_MS) ?? progress)
        : 100;
    const delta = Number((progress - previousProgress).toFixed(1));

    let tone = 'low';
    if (remainingMs <= 15 * 60 * 1000 || progress >= 97) tone = 'critical';
    else if (remainingMs <= 6 * 60 * 60 * 1000 || progress >= 84) tone = 'high';
    else if (remainingMs <= 72 * 60 * 60 * 1000 || progress >= 56) tone = 'mid';

    let signalLabel = 'telemetrie stable';
    if (delta >= 0.6) {
        signalLabel = `recalage offensif +${Math.max(1, Math.round(Math.abs(delta)))}%`;
    } else if (delta <= -0.6) {
        signalLabel = `recalage defensif -${Math.max(1, Math.round(Math.abs(delta)))}%`;
    }

    return {
        scheduled,
        startsAt,
        startsAtLabel: formatAlertDateTime(startsAt),
        remainingMs,
        remainingLabel: scheduled ? formatRemainingTime(remainingMs) : 'en cours',
        progress: Number(progress.toFixed(1)),
        progressPercent: Math.round(progress),
        delta,
        signalLabel,
        tone,
    };
}

function getAlertCounterLabel(alerts = []) {
    const list = Array.isArray(alerts) ? alerts : [];
    const liveCount = list.filter((alert) => !isScheduledAlert(alert)).length;
    const scheduledCount = list.length - liveCount;
    if (liveCount && scheduledCount) return `${liveCount} live • ${scheduledCount} approche`;
    if (scheduledCount > 1) return `${scheduledCount} en approche`;
    if (scheduledCount === 1) return 'En approche';
    return list.length > 1 ? `${list.length} actives` : '1 active';
}

function getAlertBanner() {
    return document.getElementById('map-alert-banner');
}

function getPickerOverlay() {
    return document.getElementById('alert-picker-overlay');
}

function getAlertKey(alert) {
    if (!alert || typeof alert !== 'object') return '';
    const gpsX = Number.isFinite(Number(alert.gpsX)) ? Number(alert.gpsX).toFixed(2) : '';
    const gpsY = Number.isFinite(Number(alert.gpsY)) ? Number(alert.gpsY).toFixed(2) : '';
    const phase = isScheduledAlert(alert) ? 'scheduled' : 'live';
    return [
        String(alert.id || ''),
        phase,
        String(alert.updatedAt || ''),
        String(alert.startsAt || ''),
        String(alert.title || ''),
        gpsX,
        gpsY
    ].join('::');
}

function readSeenAlertKeys() {
    try {
        const raw = String(localStorage.getItem(MAP_ALERT_SEEN_STORAGE_KEY) || '');
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

function writeSeenAlertKeys(values) {
    try {
        const next = [...new Set(Array.from(values || []).map((value) => String(value || '')).filter(Boolean))].slice(-120);
        if (!next.length) {
            localStorage.removeItem(MAP_ALERT_SEEN_STORAGE_KEY);
            return;
        }
        localStorage.setItem(MAP_ALERT_SEEN_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {}
}

function unmarkAlertSeen(alert) {
    const alertKey = getAlertKey(alert);
    if (!alertKey) return;
    const next = readSeenAlertKeys();
    next.delete(alertKey);
    writeSeenAlertKeys(next);
}

function markAlertSeen(alert) {
    const alertKey = getAlertKey(alert);
    if (!alertKey) return;
    const next = readSeenAlertKeys();
    next.add(alertKey);
    writeSeenAlertKeys(next);
}

function isAlertNewForViewer(alert) {
    const alertKey = getAlertKey(alert);
    return Boolean(alertKey) && !readSeenAlertKeys().has(alertKey);
}

function pruneSeenAlertKeys(alerts) {
    const activeKeys = new Set((Array.isArray(alerts) ? alerts : []).map((alert) => getAlertKey(alert)).filter(Boolean));
    const current = readSeenAlertKeys();
    const next = new Set();
    current.forEach((value) => {
        if (activeKeys.has(value)) next.add(value);
    });
    writeSeenAlertKeys(next);
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

function sanitizeCircle(rawCircle, fallbackRadius = 2.6) {
    if (!rawCircle || typeof rawCircle !== 'object') return null;
    const xPercent = Number(rawCircle.xPercent);
    const yPercent = Number(rawCircle.yPercent);
    const gpsX = Number(rawCircle.gpsX);
    const gpsY = Number(rawCircle.gpsY);
    const radius = Number(rawCircle.radius || fallbackRadius);

    if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) return null;
    if (!Number.isFinite(gpsX) || !Number.isFinite(gpsY)) return null;

    return {
        xPercent: Number(xPercent.toFixed(4)),
        yPercent: Number(yPercent.toFixed(4)),
        gpsX: Number(gpsX.toFixed(2)),
        gpsY: Number(gpsY.toFixed(2)),
        radius: Number(Math.max(0.5, radius).toFixed(1)),
    };
}

function sanitizeCircles(rawCircles, fallbackRadius = 2.6) {
    if (!Array.isArray(rawCircles)) return [];
    return rawCircles
        .map((circle) => sanitizeCircle(circle, fallbackRadius))
        .filter(Boolean);
}

function sanitizeStrokeWidth(value, fallback = 0.06) {
    const num = Number(value);
    if (!Number.isFinite(num)) return Number(fallback) || 0.06;
    return Math.min(0.5, Math.max(0.02, Number(num.toFixed(2))));
}

function getCircleBounds(circles) {
    if (!Array.isArray(circles) || !circles.length) return null;
    return {
        minX: Math.max(0, Math.min(...circles.map((circle) => circle.xPercent - circle.radius))),
        maxX: Math.min(100, Math.max(...circles.map((circle) => circle.xPercent + circle.radius))),
        minY: Math.max(0, Math.min(...circles.map((circle) => circle.yPercent - circle.radius))),
        maxY: Math.min(100, Math.max(...circles.map((circle) => circle.yPercent + circle.radius))),
    };
}

function sanitizeAlert(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const zonePoints = sanitizeZonePoints(raw.zonePoints);
    const circles = sanitizeCircles(raw.circles, raw.radius || 2.6);
    if (!circles.length && raw.shapeType !== 'zone') {
        const legacyCircle = sanitizeCircle(raw, raw.radius || 2.6);
        if (legacyCircle) circles.push(legacyCircle);
    }
    const alert = {
        id: String(raw.id || ''),
        title: String(raw.title || ''),
        description: String(raw.description || ''),
        gpsX: Number(raw.gpsX),
        gpsY: Number(raw.gpsY),
        xPercent: Number(raw.xPercent),
        yPercent: Number(raw.yPercent),
        radius: Number(raw.radius || 2.6),
        strokeWidth: sanitizeStrokeWidth(raw.strokeWidth, 0.06),
        shapeType: raw.shapeType === 'zone' && zonePoints.length >= 3 ? 'zone' : 'circle',
        zonePoints,
        circles,
        activeCircleIndex: Number.isInteger(Number(raw.activeCircleIndex)) ? Number(raw.activeCircleIndex) : (circles.length ? circles.length - 1 : -1),
        active: raw.active !== false,
        scheduled: raw.scheduled === true,
        startsAt: String(raw.startsAt || ''),
        showBeforeStart: raw.showBeforeStart === true,
        createdAt: String(raw.createdAt || ''),
        updatedAt: String(raw.updatedAt || ''),
    };
    if (alert.shapeType === 'zone') {
        if (!Number.isFinite(alert.xPercent) || !Number.isFinite(alert.yPercent)) return null;
        if (!Number.isFinite(alert.gpsX) || !Number.isFinite(alert.gpsY)) return null;
    } else if (!alert.circles.length) {
        return null;
    }
    return alert;
}

function focusAlert(alert, attempt = 0) {
    const viewport = document.getElementById('viewport');
    if (!viewport || !state.mapWidth || !state.mapHeight) {
        if (attempt < 12) {
            window.setTimeout(() => focusAlert(alert, attempt + 1), 180);
        }
        return;
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    let focusX = alert.xPercent;
    let focusY = alert.yPercent;
    let scale = 2.4;

    if (alert.shapeType === 'zone' && alert.zonePoints.length >= 3) {
        const xs = alert.zonePoints.map((point) => point.x);
        const ys = alert.zonePoints.map((point) => point.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        focusX = (minX + maxX) / 2;
        focusY = (minY + maxY) / 2;

        const widthPx = Math.max(80, ((maxX - minX) / 100) * state.mapWidth);
        const heightPx = Math.max(80, ((maxY - minY) / 100) * state.mapHeight);
        const fitScale = Math.min(
            (viewportWidth - 120) / widthPx,
            (viewportHeight - 120) / heightPx
        );
        scale = Math.min(2.2, Math.max(0.8, fitScale));
    } else if (Array.isArray(alert.circles) && alert.circles.length) {
        const bounds = getCircleBounds(alert.circles);
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
    }

    state.view.scale = scale;
    state.view.x = (viewportWidth / 2) - (focusX * state.mapWidth / 100) * scale;
    state.view.y = (viewportHeight / 2) - (focusY * state.mapHeight / 100) * scale;
    updateTransform();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getAlertAnchor(alert) {
    if (!alert || typeof alert !== 'object') return null;

    if (alert.shapeType === 'zone' && Array.isArray(alert.zonePoints) && alert.zonePoints.length >= 3) {
        const xs = alert.zonePoints.map((point) => Number(point.x));
        const ys = alert.zonePoints.map((point) => Number(point.y));
        return {
            xPercent: (Math.min(...xs) + Math.max(...xs)) / 2,
            yPercent: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
    }

    if (Array.isArray(alert.circles) && alert.circles.length) {
        const bounds = getCircleBounds(alert.circles);
        if (bounds) {
            return {
                xPercent: (bounds.minX + bounds.maxX) / 2,
                yPercent: (bounds.minY + bounds.maxY) / 2,
            };
        }
    }

    if (Number.isFinite(Number(alert.xPercent)) && Number.isFinite(Number(alert.yPercent))) {
        return {
            xPercent: Number(alert.xPercent),
            yPercent: Number(alert.yPercent),
        };
    }

    return null;
}

function scheduleAlertCalloutPosition(alert = null) {
    if (alertUiState.positionFrame) {
        cancelAnimationFrame(alertUiState.positionFrame);
        alertUiState.positionFrame = 0;
    }

    alertUiState.positionFrame = requestAnimationFrame(() => {
        alertUiState.positionFrame = 0;
        positionAlertCallout(alert || getCurrentBannerAlert(state.activeAlerts));
    });
}

function positionAlertCallout(alert) {
    const banner = getAlertBanner();
    const viewport = document.getElementById('viewport');
    const card = banner?.querySelector('.map-alert-callout-card');
    const pointer = banner?.querySelector('.map-alert-callout-pointer');
    const dot = banner?.querySelector('.map-alert-callout-dot');
    const anchor = getAlertAnchor(alert);

    if (!banner || !viewport || !card || !pointer || !dot || !anchor || !state.mapWidth || !state.mapHeight) {
        return;
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (viewportWidth < 40 || viewportHeight < 40) return;

    const rawX = state.view.x + (anchor.xPercent / 100) * state.mapWidth * state.view.scale;
    const rawY = state.view.y + (anchor.yPercent / 100) * state.mapHeight * state.view.scale;
    const anchorX = clamp(rawX, 12, viewportWidth - 12);
    const anchorY = clamp(rawY, 12, viewportHeight - 12);

    const cardWidth = card.offsetWidth || 340;
    const cardHeight = card.offsetHeight || 180;
    const side = anchorX < viewportWidth * 0.54 ? 'right' : 'left';

    let cardLeft = side === 'right'
        ? anchorX + 34
        : anchorX - cardWidth - 34;
    cardLeft = clamp(cardLeft, 14, viewportWidth - cardWidth - 14);

    const cardTop = clamp(anchorY - (cardHeight * 0.5), 14, viewportHeight - cardHeight - 14);

    banner.style.left = `${cardLeft}px`;
    banner.style.top = `${cardTop}px`;
    banner.dataset.side = side;

    const startX = side === 'right' ? 0 : cardWidth;
    const startY = clamp(anchorY - cardTop, 24, cardHeight - 24);
    const endX = anchorX - cardLeft;
    const endY = anchorY - cardTop;
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.max(8, Math.sqrt((dx * dx) + (dy * dy)));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    pointer.style.left = `${startX}px`;
    pointer.style.top = `${startY}px`;
    pointer.style.width = `${length}px`;
    pointer.style.transform = `rotate(${angle}deg)`;

    dot.style.left = `${endX}px`;
    dot.style.top = `${endY}px`;
}

function getBannerAlerts(alerts = []) {
    return (Array.isArray(alerts) ? alerts : []).filter((alert) => {
        const alertKey = getAlertKey(alert);
        return Boolean(alertKey) && !readSeenAlertKeys().has(alertKey);
    });
}

function getCurrentBannerAlert(alerts = []) {
    const visibleAlerts = getBannerAlerts(alerts);
    if (!visibleAlerts.length) {
        alertUiState.activeBannerIndex = 0;
        alertUiState.activeBannerKey = '';
        return null;
    }

    const preferredKey = String(alertUiState.activeBannerKey || '');
    if (preferredKey) {
        const preferredIndex = visibleAlerts.findIndex((alert) => getAlertKey(alert) === preferredKey);
        if (preferredIndex >= 0) {
            alertUiState.activeBannerIndex = preferredIndex;
        }
    }

    if (alertUiState.activeBannerIndex >= visibleAlerts.length) {
        alertUiState.activeBannerIndex = visibleAlerts.length - 1;
    }
    if (alertUiState.activeBannerIndex < 0) {
        alertUiState.activeBannerIndex = 0;
    }

    const current = visibleAlerts[alertUiState.activeBannerIndex] || null;
    alertUiState.activeBannerKey = current ? getAlertKey(current) : '';
    return current;
}

function showPreviousBannerAlert(event) {
    event?.stopPropagation?.();
    const visibleAlerts = getBannerAlerts(state.activeAlerts);
    if (visibleAlerts.length <= 1) return;
    alertUiState.activeBannerIndex = (alertUiState.activeBannerIndex - 1 + visibleAlerts.length) % visibleAlerts.length;
    alertUiState.activeBannerKey = getAlertKey(visibleAlerts[alertUiState.activeBannerIndex]);
    renderAlertBanner(state.activeAlerts);
}

function showNextBannerAlert(event) {
    event?.stopPropagation?.();
    const visibleAlerts = getBannerAlerts(state.activeAlerts);
    if (visibleAlerts.length <= 1) return;
    alertUiState.activeBannerIndex = (alertUiState.activeBannerIndex + 1) % visibleAlerts.length;
    alertUiState.activeBannerKey = getAlertKey(visibleAlerts[alertUiState.activeBannerIndex]);
    renderAlertBanner(state.activeAlerts);
}

function renderAlertBanner(alerts) {
    const banner = getAlertBanner();
    if (!banner) return;
    const visibleAlerts = getBannerAlerts(alerts);
    const alert = getCurrentBannerAlert(alerts);

    if (!alert || !visibleAlerts.length) {
        banner.hidden = true;
        delete banner.dataset.phase;
        banner.innerHTML = '';
        return;
    }

    const timeline = getAlertTimeline(alert);
    const isScheduled = Boolean(timeline?.scheduled);
    const scheduleMarkup = isScheduled ? `
        <div class="map-alert-timeline" data-tone="${escapeText(timeline.tone)}">
            <div class="map-alert-timeline-head">
                <span class="map-alert-timeline-label">Projection IA</span>
                <strong class="map-alert-timeline-value">${timeline.progressPercent}%</strong>
            </div>
            <div class="map-alert-progress" aria-hidden="true">
                <span class="map-alert-progress-fill" style="width:${timeline.progress}%"></span>
            </div>
            <div class="map-alert-timeline-note">Fenetre ${escapeText(timeline.startsAtLabel)} • ${escapeText(timeline.remainingLabel)} • ${escapeText(timeline.signalLabel)}</div>
        </div>
    ` : '';
    const metaParts = [`GPS ${alert.gpsX.toFixed(2)} / ${alert.gpsY.toFixed(2)}`];
    if (!isScheduled && timeline?.startsAtLabel) {
        metaParts.push(`diffusee ${timeline.startsAtLabel}`);
    }

    banner.hidden = false;
    banner.dataset.phase = isScheduled ? 'scheduled' : 'live';
    banner.innerHTML = `
        <div class="map-alert-callout-card" data-phase="${isScheduled ? 'scheduled' : 'live'}">
            <div class="map-alert-head">
                <div class="map-alert-kicker">${isScheduled ? 'Prediction IA BNI' : 'Alerte BNI'}</div>
                <div class="map-alert-counter">${getAlertCounterLabel(visibleAlerts)}</div>
            </div>
            <div class="map-alert-title">${escapeText(alert.title)}</div>
            <div class="map-alert-desc">${escapeText(alert.description)}</div>
            ${scheduleMarkup}
            <div class="map-alert-meta">${escapeText(metaParts.join(' • '))}</div>
            <div id="map-alert-nav" class="map-alert-nav" ${visibleAlerts.length > 1 ? '' : 'hidden'}>
                <button type="button" id="map-alert-prev" class="mini-btn map-alert-nav-btn" aria-label="Alerte precedente">‹</button>
                <div class="map-alert-nav-label">${alertUiState.activeBannerIndex + 1} / ${visibleAlerts.length}</div>
                <button type="button" id="map-alert-next" class="mini-btn map-alert-nav-btn" aria-label="Alerte suivante">›</button>
            </div>
            <div class="map-alert-actions">
                <button type="button" id="map-alert-dismiss" class="mini-btn">Masquer</button>
            </div>
        </div>
        <div class="map-alert-callout-pointer"></div>
        <div class="map-alert-callout-dot"></div>
    `;

    const dismissBtn = document.getElementById('map-alert-dismiss');
    const prevBtn = document.getElementById('map-alert-prev');
    const nextBtn = document.getElementById('map-alert-next');
    if (dismissBtn) {
        dismissBtn.onclick = (event) => {
            event.stopPropagation();
            markAlertSeen(alert);
            const remainingAlerts = getBannerAlerts(state.activeAlerts);
            if (alertUiState.activeBannerIndex >= remainingAlerts.length) {
                alertUiState.activeBannerIndex = Math.max(0, remainingAlerts.length - 1);
            }
            alertUiState.activeBannerKey = remainingAlerts[alertUiState.activeBannerIndex]
                ? getAlertKey(remainingAlerts[alertUiState.activeBannerIndex])
                : '';
            renderAlertBanner(state.activeAlerts);
        };
    }

    prevBtn?.addEventListener('click', showPreviousBannerAlert);
    nextBtn?.addEventListener('click', showNextBannerAlert);
    scheduleAlertCalloutPosition(alert);
}

function bindAlertClickListener() {
    if (alertUiState.clickListenerBound) return;
    alertUiState.clickListenerBound = true;

    window.addEventListener(MAP_ALERT_CLICK_EVENT, (event) => {
        const alert = event?.detail?.alert || getCurrentBannerAlert(state.activeAlerts) || state.activeAlert;
        if (!alert) return;
        unmarkAlertSeen(alert);
        alertUiState.activeBannerKey = getAlertKey(alert);
        const visibleAlerts = getBannerAlerts(state.activeAlerts);
        const nextIndex = visibleAlerts.findIndex((entry) => getAlertKey(entry) === alertUiState.activeBannerKey);
        alertUiState.activeBannerIndex = nextIndex >= 0 ? nextIndex : 0;
        renderAlertBanner(state.activeAlerts);
    });
}

function shouldAnimateAlertTimeline() {
    const alert = getCurrentBannerAlert(state.activeAlerts);
    const startsAt = toValidDate(alert?.startsAt || '');
    if (!startsAt) return false;
    return startsAt.getTime() > (Date.now() - ALERT_TIMELINE_TICK_MS);
}

function sanitizeAlertList(rawAlerts = []) {
    return (Array.isArray(rawAlerts) ? rawAlerts : [])
        .map((entry) => sanitizeAlert(entry))
        .filter((entry) => isAlertVisibleOnMap(entry));
}

async function fetchAlertPayload(id = '') {
    const session = readViewerSession();
    const query = id
        ? `id=${encodeURIComponent(id)}&includeScheduled=1&t=${Date.now()}`
        : `includeScheduled=1&t=${Date.now()}`;
    const response = await fetch(`${ALERTS_ENDPOINT}?${query}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            ...(session.token ? { 'x-collab-token': session.token } : {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
        throw new Error(data.error || `Erreur alerte (${response.status})`);
    }
    return {
        alert: (() => {
            const alert = sanitizeAlert(data.alert);
            return isAlertVisibleOnMap(alert) ? alert : null;
        })(),
        alerts: sanitizeAlertList(data.alerts),
    };
}

async function refreshMapAlert(options = {}) {
    const params = new URLSearchParams(window.location.search);
    const alertId = String(params.get('alert') || '').trim();
    const shouldFocus = Boolean(options.focus) || (Boolean(alertId) && Boolean(options.initialLoad));

    try {
        const payload = await fetchAlertPayload(alertId);
        const alerts = payload.alerts.length
            ? payload.alerts
            : (payload.alert ? [payload.alert] : []);
        const alert = payload.alert || alerts[0] || null;
        state.activeAlerts = alerts;
        state.activeAlert = alert;
        pruneSeenAlertKeys(alerts);

        const currentBanner = getCurrentBannerAlert(alerts);
        const preferredBanner = alertId
            ? alerts.find((entry) => String(entry.id || '') === alertId)
            : null;
        const initialBanner = options.initialLoad
            ? getBannerAlerts(alerts).find((entry) => isAlertNewForViewer(entry))
            : null;
        const nextBanner = preferredBanner || currentBanner || initialBanner || getBannerAlerts(alerts)[0] || null;

        if (nextBanner) {
            if (preferredBanner) {
                unmarkAlertSeen(nextBanner);
            }
            alertUiState.activeBannerKey = getAlertKey(nextBanner);
            const nextIndex = getBannerAlerts(alerts).findIndex((entry) => getAlertKey(entry) === alertUiState.activeBannerKey);
            alertUiState.activeBannerIndex = nextIndex >= 0 ? nextIndex : 0;
        } else {
            alertUiState.activeBannerKey = '';
            alertUiState.activeBannerIndex = 0;
        }

        renderAlertBanner(alerts);
        renderAll();
        if (alert && shouldFocus) {
            focusAlert(alert);
        }
    } catch (error) {
        console.error('[ALERT MAP]', error);
        state.activeAlerts = [];
        state.activeAlert = null;
        alertUiState.activeBannerKey = '';
        alertUiState.activeBannerIndex = 0;
        renderAlertBanner([]);
        renderAll();
        if (alertId && !options.silent) {
            await customAlert('ALERTE', 'Alerte indisponible.');
        }
    }
}

function startAlertRefreshLoop() {
    if (alertRefreshStarted) return;
    alertRefreshStarted = true;
    bindAlertClickListener();

    if (!alertUiState.timelineTimer) {
        alertUiState.timelineTimer = window.setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            if (!shouldAnimateAlertTimeline()) return;
            renderAlertBanner(state.activeAlerts);
        }, ALERT_TIMELINE_TICK_MS);
    }

    window.setInterval(() => {
        refreshMapAlert({ silent: true }).catch(() => {});
    }, ALERT_POLL_MS);

    window.addEventListener('storage', (event) => {
        if (event.key === ALERT_REFRESH_EVENT_KEY) {
            refreshMapAlert({ silent: true }).catch(() => {});
        }
    });

    try {
        if (typeof BroadcastChannel === 'function') {
            const channel = new BroadcastChannel(ALERT_REFRESH_CHANNEL);
            channel.onmessage = () => {
                refreshMapAlert({ silent: true }).catch(() => {});
            };
        }
    } catch (e) {}

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshMapAlert({ silent: true }).catch(() => {});
        }
    });

    window.addEventListener(MAP_TRANSFORM_EVENT, () => {
        scheduleAlertCalloutPosition();
    });

    window.addEventListener('resize', () => {
        scheduleAlertCalloutPosition();
    });

    window.addEventListener('focus', () => {
        refreshMapAlert({ silent: true }).catch(() => {});
    });

    window.addEventListener('pageshow', () => {
        refreshMapAlert({ silent: true }).catch(() => {});
    });
}

export async function loadAlertFromUrl() {
    await refreshMapAlert({ focus: false, initialLoad: true });
    startAlertRefreshLoop();
}

export function initAlertPickerMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pickAlert') !== '1') return;

    const overlay = getPickerOverlay();
    if (!overlay) return;

    document.body.classList.add('alert-picker-mode');
    overlay.hidden = false;
    overlay.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const coords = getMapPercentCoords(event.clientX, event.clientY);
        const gps = percentageToGps(coords.x, coords.y);
        const payload = {
            xPercent: Number(coords.x.toFixed(4)),
            yPercent: Number(coords.y.toFixed(4)),
            gpsX: Number(gps.x.toFixed(2)),
            gpsY: Number(gps.y.toFixed(2)),
        };

        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'bni-alert-location', payload }, window.location.origin);
            }
        } catch (e) {}

        overlay.innerHTML = `
            <div class="alert-picker-card alert-picker-card-done">
                <span class="alert-picker-kicker">Position envoyee</span>
                <strong>Retour au panneau admin.</strong>
            </div>
        `;

        window.setTimeout(() => {
            try {
                window.close();
            } catch (e) {}
        }, 280);
    };
}
