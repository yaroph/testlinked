import {
    getPresenceCursorColor,
    getPresenceCursorDetail,
    getPresenceCursorInitials,
    getPresenceCursorLabel,
    normalizePointCursorPresence
} from '../../shared/js/collab-cursor-visuals.mjs';

let remotePointCursors = [];
let pointCursorAnimationHandle = 0;
let pointCursorRenderScheduler = null;
let pointCursorLastFrameAt = 0;

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function stopPointCursorAnimation() {
    if (!pointCursorAnimationHandle || typeof cancelAnimationFrame !== 'function') return;
    cancelAnimationFrame(pointCursorAnimationHandle);
    pointCursorAnimationHandle = 0;
}

function requestPointCursorRender() {
    if (typeof pointCursorRenderScheduler === 'function') {
        pointCursorRenderScheduler();
    }
}

function stepTowards(current, target, easing) {
    if (!Number.isFinite(current)) return target;
    if (!Number.isFinite(target)) return current;
    const distance = target - current;
    if (Math.abs(distance) <= 0.05) return target;
    return current + (distance * easing);
}

function finiteOr(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function animatePointRemoteCursors(frameAt = 0) {
    pointCursorAnimationHandle = 0;
    const now = Number.isFinite(frameAt) && frameAt > 0 ? frameAt : nowMs();
    const deltaMs = pointCursorLastFrameAt ? Math.min(40, Math.max(12, now - pointCursorLastFrameAt)) : 16;
    pointCursorLastFrameAt = now;
    const easing = 1 - Math.exp(-deltaMs / 58);
    let needsMoreFrames = false;

    remotePointCursors = remotePointCursors.map((entry) => {
        const displayWorldX = stepTowards(entry.displayWorldX, entry.targetWorldX, easing);
        const displayWorldY = stepTowards(entry.displayWorldY, entry.targetWorldY, easing);
        const remaining = Math.hypot(entry.targetWorldX - displayWorldX, entry.targetWorldY - displayWorldY);
        const pulse = Math.max(0, Number(entry.pulse || 0) - (deltaMs / 460));
        if (remaining > 0.18 || pulse > 0.02) needsMoreFrames = true;
        return {
            ...entry,
            displayWorldX,
            displayWorldY,
            pulse,
            cursorMotion: remaining
        };
    });

    requestPointCursorRender();
    if (needsMoreFrames && typeof requestAnimationFrame === 'function') {
        pointCursorAnimationHandle = requestAnimationFrame(animatePointRemoteCursors);
    }
}

function ensurePointCursorAnimation() {
    if (!remotePointCursors.length) {
        stopPointCursorAnimation();
        pointCursorLastFrameAt = 0;
        return;
    }
    const shouldAnimate = remotePointCursors.some((entry) =>
        Math.hypot(entry.targetWorldX - entry.displayWorldX, entry.targetWorldY - entry.displayWorldY) > 0.18
        || Number(entry.pulse || 0) > 0.02
    );
    if (!shouldAnimate) {
        stopPointCursorAnimation();
        pointCursorLastFrameAt = 0;
        return;
    }
    if (!pointCursorAnimationHandle && typeof requestAnimationFrame === 'function') {
        pointCursorAnimationHandle = requestAnimationFrame(animatePointRemoteCursors);
    }
}

export function setPointCursorAnimationScheduler(fn) {
    pointCursorRenderScheduler = typeof fn === 'function' ? fn : null;
}

export function setPointRemoteCursors(entries = []) {
    const previousByUserId = new Map(
        remotePointCursors.map((entry) => [String(entry.userId || ''), entry])
    );
    remotePointCursors = (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isSelf)
        .map((entry) => {
            const cursor = normalizePointCursorPresence(entry);
            if (!cursor.cursorVisible) return null;
            const username = getPresenceCursorLabel(entry?.username || '');
            const userId = String(entry?.userId || '');
            const previous = previousByUserId.get(userId);
            const targetWorldX = cursor.cursorWorldX;
            const targetWorldY = cursor.cursorWorldY;
            const previousTargetWorldX = previous
                ? finiteOr(previous.targetWorldX, finiteOr(previous.displayWorldX, targetWorldX))
                : targetWorldX;
            const previousTargetWorldY = previous
                ? finiteOr(previous.targetWorldY, finiteOr(previous.displayWorldY, targetWorldY))
                : targetWorldY;
            const movedDistance = previous
                ? Math.hypot(targetWorldX - previousTargetWorldX, targetWorldY - previousTargetWorldY)
                : 0;
            return {
                userId,
                username,
                initials: getPresenceCursorInitials(username),
                color: getPresenceCursorColor(`${entry?.userId || ''}|${username}`),
                mode: String(entry?.mode || 'editing'),
                detail: getPresenceCursorDetail(entry, {
                    entityLabel: 'Fiche',
                    editingLabel: 'Edition live',
                    viewingLabel: 'Lecture'
                }),
                targetWorldX,
                targetWorldY,
                displayWorldX: previous ? finiteOr(previous.displayWorldX, targetWorldX) : targetWorldX,
                displayWorldY: previous ? finiteOr(previous.displayWorldY, targetWorldY) : targetWorldY,
                pulse: previous
                    ? Math.min(1.2, Math.max(Number(previous.pulse || 0) * 0.72, movedDistance > 5 ? 1 : 0))
                    : 0.92,
                cursorMotion: previous ? movedDistance : 0
            };
        })
        .filter(Boolean);
    requestPointCursorRender();
    ensurePointCursorAnimation();
}

export function clearPointRemoteCursors() {
    remotePointCursors = [];
    stopPointCursorAnimation();
    pointCursorLastFrameAt = 0;
    requestPointCursorRender();
}

export function getPointRemoteCursors() {
    return remotePointCursors.map((entry) => ({
        ...entry,
        cursorWorldX: entry.displayWorldX,
        cursorWorldY: entry.displayWorldY
    }));
}
