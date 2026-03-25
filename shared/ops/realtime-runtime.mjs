function sanitizeSegment(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function readRealtimeRuntimeNamespace() {
    return sanitizeSegment(
        process.env.BNI_FIREBASE_STORE_NAMESPACE ||
        process.env.FIREBASE_STORE_NAMESPACE ||
        ''
    );
}

export function buildRealtimeRuntimePath(...parts) {
    const namespace = readRealtimeRuntimeNamespace();
    return [
        'runtime',
        ...(namespace ? [namespace] : []),
        'realtime',
        ...parts.map((part) => sanitizeSegment(part)).filter(Boolean)
    ].join('/');
}

export function buildRealtimeEventsPath(boardId = '') {
    return buildRealtimeRuntimePath('events', boardId);
}

