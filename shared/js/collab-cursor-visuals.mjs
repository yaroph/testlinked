function clampNumber(value, fallback = 0, min = null, max = null) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    let next = num;
    if (Number.isFinite(min) && next < min) next = min;
    if (Number.isFinite(max) && next > max) next = max;
    return next;
}

function hasOwn(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function coerceFlag(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const clean = value.trim().toLowerCase();
        if (!clean) return false;
        if (['0', 'false', 'off', 'no'].includes(clean)) return false;
        return true;
    }
    return Boolean(value);
}

function hashString(value = '') {
    const source = String(value || '');
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = ((hash << 5) - hash) + source.charCodeAt(index);
        hash |= 0;
    }
    return hash;
}

function hslToHex(h, s, l) {
    const hue = ((((Number(h) || 0) % 360) + 360) % 360) / 360;
    const sat = Math.max(0, Math.min(1, Number(s) || 0));
    const light = Math.max(0, Math.min(1, Number(l) || 0));

    if (sat === 0) {
        const gray = Math.round(light * 255);
        const hex = gray.toString(16).padStart(2, '0');
        return `#${hex}${hex}${hex}`;
    }

    const q = light < 0.5 ? light * (1 + sat) : light + sat - (light * sat);
    const p = 2 * light - q;
    const hueToChannel = (t) => {
        let next = t;
        if (next < 0) next += 1;
        if (next > 1) next -= 1;
        if (next < 1 / 6) return p + ((q - p) * 6 * next);
        if (next < 1 / 2) return q;
        if (next < 2 / 3) return p + ((q - p) * (2 / 3 - next) * 6);
        return p;
    };
    const toHex = (channel) => Math.round(channel * 255).toString(16).padStart(2, '0');
    return `#${toHex(hueToChannel(hue + (1 / 3)))}${toHex(hueToChannel(hue))}${toHex(hueToChannel(hue - (1 / 3)))}`;
}

export function clampPointCursorCoord(value, fallback = 0) {
    return clampNumber(value, fallback, -250000, 250000);
}

export function clampMapCursorCoord(value, fallback = 50) {
    return clampNumber(value, fallback, 0, 100);
}

export function getPresenceCursorColor(seed = '') {
    const hue = Math.abs(hashString(seed || 'operateur')) % 360;
    return hslToHex(hue, 0.82, 0.62);
}

export function getPresenceCursorInitials(username = '') {
    const clean = String(username || '').trim();
    if (!clean) return '?';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

export function getPresenceCursorLabel(username = '') {
    return String(username || 'operateur').trim().slice(0, 32) || 'operateur';
}

export function normalizePointCursorPresence(entry = {}) {
    const visible = hasOwn(entry, 'cursorVisible')
        ? coerceFlag(entry.cursorVisible, false)
        : false;
    return {
        cursorVisible: visible,
        cursorWorldX: visible ? clampPointCursorCoord(entry.cursorWorldX, 0) : 0,
        cursorWorldY: visible ? clampPointCursorCoord(entry.cursorWorldY, 0) : 0
    };
}

export function normalizeMapCursorPresence(entry = {}) {
    const visible = hasOwn(entry, 'cursorVisible')
        ? coerceFlag(entry.cursorVisible, false)
        : false;
    return {
        cursorVisible: visible,
        cursorMapX: visible ? clampMapCursorCoord(entry.cursorMapX, 50) : 50,
        cursorMapY: visible ? clampMapCursorCoord(entry.cursorMapY, 50) : 50
    };
}
