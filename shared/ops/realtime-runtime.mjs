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

export function formatRealtimeSeqKey(sequence = 0) {
    const safeSequence = Math.max(0, Math.floor(Number(sequence) || 0));
    return `seq_${String(safeSequence).padStart(12, '0')}`;
}

export function parseRealtimeSeqKey(key = '') {
    const match = String(key || '').trim().match(/^seq_(\d{1,})$/);
    if (!match) return 0;
    return Math.max(0, Number(match[1] || 0) || 0);
}

export function buildRealtimeJournalPath(boardId = '', sequence = '') {
    const sequencePart = sequence === '' || sequence === null || sequence === undefined
        ? ''
        : (typeof sequence === 'number' ? formatRealtimeSeqKey(sequence) : String(sequence || '').trim());
    return buildRealtimeRuntimePath('journal', boardId, sequencePart);
}
