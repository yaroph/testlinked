import {
    getPresenceCursorColor,
    getPresenceCursorDetail,
    getPresenceCursorInitials,
    getPresenceCursorLabel,
    normalizeMapCursorPresence
} from '../../shared/js/collab-cursor-visuals.mjs';

const markersLayer = document.getElementById('markers-layer');
let remoteMapCursors = [];
let mapCursorAnimationHandle = 0;
let mapCursorLastFrameAt = 0;

function sanitizeDomIdSegment(value, fallback = 'user') {
    const clean = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return clean || fallback;
}

function stopMapCursorAnimation() {
    if (!mapCursorAnimationHandle || typeof cancelAnimationFrame !== 'function') return;
    cancelAnimationFrame(mapCursorAnimationHandle);
    mapCursorAnimationHandle = 0;
}

function stepTowards(current, target, easing) {
    if (!Number.isFinite(current)) return target;
    if (!Number.isFinite(target)) return current;
    const distance = target - current;
    if (Math.abs(distance) <= 0.015) return target;
    return current + (distance * easing);
}

function finiteOr(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function animateMapRemoteCursors(frameAt = 0) {
    mapCursorAnimationHandle = 0;
    const now = Number.isFinite(frameAt) && frameAt > 0
        ? frameAt
        : ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now());
    const deltaMs = mapCursorLastFrameAt ? Math.min(40, Math.max(12, now - mapCursorLastFrameAt)) : 16;
    mapCursorLastFrameAt = now;
    const easing = 1 - Math.exp(-deltaMs / 60);
    let needsMoreFrames = false;

    remoteMapCursors = remoteMapCursors.map((entry) => {
        const displayMapX = stepTowards(entry.displayMapX, entry.targetMapX, easing);
        const displayMapY = stepTowards(entry.displayMapY, entry.targetMapY, easing);
        const remaining = Math.hypot(entry.targetMapX - displayMapX, entry.targetMapY - displayMapY);
        const pulse = Math.max(0, Number(entry.pulse || 0) - (deltaMs / 440));
        if (remaining > 0.045 || pulse > 0.02) needsMoreFrames = true;
        return {
            ...entry,
            displayMapX,
            displayMapY,
            pulse,
            cursorMotion: remaining
        };
    });

    renderMapRemoteCursors();
    if (needsMoreFrames && typeof requestAnimationFrame === 'function') {
        mapCursorAnimationHandle = requestAnimationFrame(animateMapRemoteCursors);
    }
}

function ensureMapCursorAnimation() {
    if (!remoteMapCursors.length) {
        stopMapCursorAnimation();
        mapCursorLastFrameAt = 0;
        return;
    }
    const shouldAnimate = remoteMapCursors.some((entry) =>
        Math.hypot(entry.targetMapX - entry.displayMapX, entry.targetMapY - entry.displayMapY) > 0.045
        || Number(entry.pulse || 0) > 0.02
    );
    if (!shouldAnimate) {
        stopMapCursorAnimation();
        mapCursorLastFrameAt = 0;
        return;
    }
    if (!mapCursorAnimationHandle && typeof requestAnimationFrame === 'function') {
        mapCursorAnimationHandle = requestAnimationFrame(animateMapRemoteCursors);
    }
}

function buildRemoteCursorRows(entries = []) {
    const previousByUserId = new Map(
        remoteMapCursors.map((entry) => [String(entry.userId || ''), entry])
    );
    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isSelf)
        .map((entry) => {
            const cursor = normalizeMapCursorPresence(entry);
            if (!cursor.cursorVisible) return null;
            const username = getPresenceCursorLabel(entry?.username || '');
            const userId = String(entry?.userId || '');
            const previous = previousByUserId.get(userId);
            const targetMapX = cursor.cursorMapX;
            const targetMapY = cursor.cursorMapY;
            const previousTargetMapX = previous
                ? finiteOr(previous.targetMapX, finiteOr(previous.displayMapX, targetMapX))
                : targetMapX;
            const previousTargetMapY = previous
                ? finiteOr(previous.targetMapY, finiteOr(previous.displayMapY, targetMapY))
                : targetMapY;
            const movedDistance = previous
                ? Math.hypot(targetMapX - previousTargetMapX, targetMapY - previousTargetMapY)
                : 0;
            return {
                userId,
                username,
                initials: getPresenceCursorInitials(username),
                color: getPresenceCursorColor(`${entry?.userId || ''}|${username}`),
                mode: String(entry?.mode || 'editing'),
                detail: getPresenceCursorDetail(entry, {
                    entityLabel: 'Point',
                    editingLabel: 'Edition live',
                    viewingLabel: 'Lecture'
                }),
                targetMapX,
                targetMapY,
                displayMapX: previous ? finiteOr(previous.displayMapX, targetMapX) : targetMapX,
                displayMapY: previous ? finiteOr(previous.displayMapY, targetMapY) : targetMapY,
                pulse: previous
                    ? Math.min(1.2, Math.max(Number(previous.pulse || 0) * 0.72, movedDistance > 0.6 ? 1 : 0))
                    : 0.95,
                cursorMotion: previous ? movedDistance : 0
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
                    <span class="map-collab-cursor-meta">
                        <span class="map-collab-cursor-name"></span>
                        <span class="map-collab-cursor-detail"></span>
                    </span>
                </span>
            `;
        }

        el.style.left = `${entry.displayMapX}%`;
        el.style.top = `${entry.displayMapY}%`;
        el.style.setProperty('--cursor-color', entry.color);
        el.style.setProperty('--cursor-pulse', String(Math.max(0, Math.min(1.2, Number(entry.pulse || 0)))));
        el.classList.toggle('is-viewing', String(entry.mode || '').toLowerCase() === 'viewing');
        const avatar = el.querySelector('.map-collab-cursor-avatar');
        const name = el.querySelector('.map-collab-cursor-name');
        const detail = el.querySelector('.map-collab-cursor-detail');
        if (avatar) avatar.textContent = entry.initials;
        if (name) name.textContent = entry.username;
        if (detail) {
            detail.textContent = entry.detail || '';
            detail.hidden = !entry.detail;
        }
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
    ensureMapCursorAnimation();
}

export function clearMapRemoteCursors() {
    remoteMapCursors = [];
    stopMapCursorAnimation();
    mapCursorLastFrameAt = 0;
    renderMapRemoteCursors();
}
