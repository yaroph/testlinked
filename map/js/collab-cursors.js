import {
    getPresenceCursorColor,
    getPresenceCursorInitials,
    getPresenceCursorLabel,
    normalizeMapCursorPresence
} from '../../shared/js/collab-cursor-visuals.mjs';

const markersLayer = document.getElementById('markers-layer');
let remoteMapCursors = [];

function sanitizeDomIdSegment(value, fallback = 'user') {
    const clean = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return clean || fallback;
}

function buildRemoteCursorRows(entries = []) {
    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isSelf)
        .map((entry) => {
            const cursor = normalizeMapCursorPresence(entry);
            if (!cursor.cursorVisible) return null;
            const username = getPresenceCursorLabel(entry?.username || '');
            return {
                userId: String(entry?.userId || ''),
                username,
                initials: getPresenceCursorInitials(username),
                color: getPresenceCursorColor(`${entry?.userId || ''}|${username}`),
                cursorMapX: cursor.cursorMapX,
                cursorMapY: cursor.cursorMapY
            };
        })
        .filter(Boolean);
}

export function renderMapRemoteCursors() {
    if (!markersLayer) return;
    const activeIds = new Set();

    remoteMapCursors.forEach((entry, index) => {
        const domId = `map-collab-cursor-${sanitizeDomIdSegment(entry.userId || entry.username || index, `cursor_${index}`)}`;
        let el = document.getElementById(domId);
        if (!el || !el.matches('.map-collab-cursor')) {
            if (el) el.remove();
            el = document.createElement('div');
            el.id = domId;
            el.className = 'map-collab-cursor';
            el.dataset.collabCursorId = entry.userId || String(index);
            el.innerHTML = `
                <span class="map-collab-cursor-pointer" aria-hidden="true"></span>
                <span class="map-collab-cursor-chip">
                    <span class="map-collab-cursor-avatar"></span>
                    <span class="map-collab-cursor-name"></span>
                </span>
            `;
        }

        el.style.left = `${entry.cursorMapX}%`;
        el.style.top = `${entry.cursorMapY}%`;
        el.style.setProperty('--cursor-color', entry.color);
        const avatar = el.querySelector('.map-collab-cursor-avatar');
        const name = el.querySelector('.map-collab-cursor-name');
        if (avatar) avatar.textContent = entry.initials;
        if (name) name.textContent = entry.username;
        markersLayer.appendChild(el);
        activeIds.add(domId);
    });

    Array.from(markersLayer.querySelectorAll('[data-collab-cursor-id]')).forEach((el) => {
        if (!activeIds.has(String(el.id || ''))) {
            el.remove();
        }
    });
}

export function syncMapRemoteCursors(entries = []) {
    remoteMapCursors = buildRemoteCursorRows(entries);
    renderMapRemoteCursors();
}

export function clearMapRemoteCursors() {
    remoteMapCursors = [];
    renderMapRemoteCursors();
}
