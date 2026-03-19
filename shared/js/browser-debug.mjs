const TRUE_DEBUG_VALUES = new Set(['1', 'true', 'yes', 'on', 'debug']);
const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJECT_KEYS = 16;
const MAX_DEPTH = 3;

function isTruthyDebugValue(value) {
    return TRUE_DEBUG_VALUES.has(String(value || '').trim().toLowerCase());
}

function truncateDebugString(value) {
    const text = String(value || '');
    if (text.length <= MAX_STRING_LENGTH) return text;
    return `${text.slice(0, MAX_STRING_LENGTH)}...`;
}

function readStorageFlag(storage, key) {
    try {
        if (!storage || !key) return '';
        return String(storage.getItem(key) || '');
    } catch (error) {
        return '';
    }
}

function sanitizeDebugValue(value, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return truncateDebugString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) {
        return {
            name: value.name || 'Error',
            message: truncateDebugString(value.message || ''),
            status: Number(value.status || 0) || undefined
        };
    }
    if (depth >= MAX_DEPTH) {
        return '[depth-limit]';
    }
    if (typeof value === 'function') {
        return `[function ${value.name || 'anonymous'}]`;
    }
    if (Array.isArray(value)) {
        const safeItems = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeDebugValue(item, depth + 1, seen));
        if (value.length > MAX_ARRAY_ITEMS) {
            safeItems.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
        }
        return safeItems;
    }
    if (typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        const output = {};
        const keys = Object.keys(value);
        keys.slice(0, MAX_OBJECT_KEYS).forEach((key) => {
            output[key] = sanitizeDebugValue(value[key], depth + 1, seen);
        });
        if (keys.length > MAX_OBJECT_KEYS) {
            output.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
        }
        seen.delete(value);
        return output;
    }
    return truncateDebugString(String(value));
}

function isBrowserDebugEnabled(options = {}) {
    if (typeof window === 'undefined') return false;

    const queryParams = Array.isArray(options.queryParams) ? options.queryParams : [];
    for (const queryParam of queryParams) {
        if (!queryParam) continue;
        try {
            const queryValue = new URLSearchParams(String(window.location?.search || '')).get(queryParam);
            if (isTruthyDebugValue(queryValue)) return true;
        } catch (error) {}
    }

    const storageKeys = Array.isArray(options.storageKeys) ? options.storageKeys : [];
    for (const storageKey of storageKeys) {
        if (!storageKey) continue;
        if (isTruthyDebugValue(readStorageFlag(window.localStorage, storageKey))) return true;
        if (isTruthyDebugValue(readStorageFlag(window.sessionStorage, storageKey))) return true;
    }

    const windowFlags = Array.isArray(options.windowFlags) ? options.windowFlags : [];
    for (const windowFlag of windowFlags) {
        if (!windowFlag) continue;
        try {
            if (isTruthyDebugValue(window[windowFlag]) || window[windowFlag] === true) return true;
        } catch (error) {}
    }

    return false;
}

function pushDebugEntry(storeKey, entry, maxEntries) {
    if (typeof window === 'undefined') return;
    try {
        if (!Array.isArray(window[storeKey])) {
            window[storeKey] = [];
        }
        const target = window[storeKey];
        target.push(entry);
        if (target.length > maxEntries) {
            target.splice(0, target.length - maxEntries);
        }
    } catch (error) {}
}

export function createBrowserDebugLogger(options = {}) {
    const namespace = String(options.namespace || 'browser-diag').trim() || 'browser-diag';
    const queryParams = Array.isArray(options.queryParams) ? options.queryParams : [];
    const storageKeys = Array.isArray(options.storageKeys) ? options.storageKeys : [];
    const windowFlags = Array.isArray(options.windowFlags) ? options.windowFlags : [];
    const storeKey = String(options.storeKey || '__BNI_DEBUG_LOGS__').trim() || '__BNI_DEBUG_LOGS__';
    const maxEntries = Math.max(20, Number(options.maxEntries) || 250);

    function enabled() {
        return isBrowserDebugEnabled({ queryParams, storageKeys, windowFlags });
    }

    function write(level = 'info', event = 'event', details = {}) {
        if (!enabled()) return false;
        const safeEvent = String(event || 'event').trim() || 'event';
        const safeLevel = String(level || 'info').trim() || 'info';
        const payload = sanitizeDebugValue(details);
        const entry = {
            at: new Date().toISOString(),
            namespace,
            level: safeLevel,
            event: safeEvent,
            details: payload
        };

        pushDebugEntry(storeKey, entry, maxEntries);

        const label = `[${namespace}] ${safeEvent}`;
        const method = safeLevel === 'error'
            ? console.error
            : safeLevel === 'warn'
                ? console.warn
                : safeLevel === 'debug'
                    ? console.debug
                    : console.info;
        method.call(console, label, payload);
        return true;
    }

    return {
        enabled,
        log(event, details = {}) {
            return write('info', event, details);
        },
        info(event, details = {}) {
            return write('info', event, details);
        },
        debug(event, details = {}) {
            return write('debug', event, details);
        },
        warn(event, details = {}) {
            return write('warn', event, details);
        },
        error(event, details = {}) {
            return write('error', event, details);
        },
        dump(event, producer) {
            if (!enabled()) return false;
            try {
                const payload = typeof producer === 'function' ? producer() : producer;
                return write('info', event, payload);
            } catch (error) {
                return write('error', `${event}:failed`, error);
            }
        }
    };
}
