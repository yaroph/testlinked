import {
    getPresenceCursorColor,
    getPresenceCursorInitials,
    getPresenceCursorLabel,
    normalizePointCursorPresence
} from '../../shared/js/collab-cursor-visuals.mjs';

let remotePointCursors = [];

export function setPointRemoteCursors(entries = []) {
    remotePointCursors = (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isSelf)
        .map((entry) => {
            const cursor = normalizePointCursorPresence(entry);
            if (!cursor.cursorVisible) return null;
            const username = getPresenceCursorLabel(entry?.username || '');
            return {
                userId: String(entry?.userId || ''),
                username,
                initials: getPresenceCursorInitials(username),
                color: getPresenceCursorColor(`${entry?.userId || ''}|${username}`),
                cursorWorldX: cursor.cursorWorldX,
                cursorWorldY: cursor.cursorWorldY
            };
        })
        .filter(Boolean);
}

export function clearPointRemoteCursors() {
    remotePointCursors = [];
}

export function getPointRemoteCursors() {
    return remotePointCursors;
}
