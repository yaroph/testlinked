function isLocalHost(hostname = '') {
    const safeHostname = String(hostname || '').trim().toLowerCase();
    return safeHostname === 'localhost' || safeHostname === '127.0.0.1' || safeHostname === '[::1]';
}

function getWindowOrigin() {
    if (typeof window === 'undefined') return '';
    const origin = String(window.location?.origin || '').trim();
    if (!origin || origin === 'null') return '';
    return origin.replace(/\/+$/, '');
}

function toHttpBase(value = '') {
    return String(value || '').trim().replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/+$/, '');
}

function toWsBase(value = '') {
    return String(value || '').trim().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '');
}

export function resolveRealtimeHttpBase() {
    if (typeof window === 'undefined') return '';
    const explicit = String(window.BNI_REALTIME_HTTP_URL || window.BNI_REALTIME_URL || '').trim();
    if (explicit) {
        return toHttpBase(explicit);
    }

    if (isLocalHost(window.location.hostname)) {
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        return `${protocol}//localhost:8787`;
    }

    return toHttpBase(getWindowOrigin());
}

export function resolveRealtimeWsBase() {
    if (typeof window === 'undefined') return '';
    const explicit = String(window.BNI_REALTIME_WS_URL || window.BNI_REALTIME_URL || '').trim();
    if (explicit) {
        return toWsBase(explicit);
    }

    if (isLocalHost(window.location.hostname)) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//localhost:8787`;
    }

    return toWsBase(getWindowOrigin());
}

export function canUseRealtimeTransport() {
    return Boolean(resolveRealtimeHttpBase() && resolveRealtimeWsBase());
}
