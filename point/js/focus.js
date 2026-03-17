import { state } from './state.js';
import { getId } from './utils.js';

const FOCUS_DEPTH_MIN = 1;
const FOCUS_DEPTH_MAX = 6;

export function clampFocusDepth(value) {
    const numeric = Math.round(Number(value) || FOCUS_DEPTH_MIN);
    return Math.max(FOCUS_DEPTH_MIN, Math.min(FOCUS_DEPTH_MAX, numeric));
}

export function buildFocusSet(rootId, depth = state.focusDepth) {
    const root = String(rootId || '');
    if (!root) return new Set();

    const safeDepth = clampFocusDepth(depth);
    const visited = new Set([root]);
    let frontier = [root];

    for (let currentDepth = 0; currentDepth < safeDepth; currentDepth += 1) {
        const nextFrontier = [];

        state.links.forEach((link) => {
            const sourceId = String(getId(link?.source));
            const targetId = String(getId(link?.target));

            frontier.forEach((frontierId) => {
                let neighborId = null;
                if (sourceId === frontierId) neighborId = targetId;
                else if (targetId === frontierId) neighborId = sourceId;

                if (!neighborId || visited.has(neighborId)) return;
                visited.add(neighborId);
                nextFrontier.push(neighborId);
            });
        });

        if (!nextFrontier.length) break;
        frontier = nextFrontier;
    }

    return visited;
}

export function setFocusMode(rootId, depth = state.focusDepth) {
    const resolvedRoot = String(rootId || state.selection || state.focusRootId || '');
    if (!resolvedRoot) {
        clearFocusMode();
        return new Set();
    }

    state.focusMode = true;
    state.focusRootId = resolvedRoot;
    state.focusDepth = clampFocusDepth(depth);
    state.focusSet = buildFocusSet(resolvedRoot, state.focusDepth);
    return state.focusSet;
}

export function clearFocusMode() {
    state.focusMode = false;
    state.focusRootId = null;
    state.focusSet = new Set();
}

export function refreshFocusMode() {
    if (!state.focusMode) return state.focusSet;
    return setFocusMode(state.focusRootId || state.selection, state.focusDepth);
}
