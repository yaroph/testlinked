export function isCloudBoardActive(collab = {}) {
    return Boolean(collab && collab.activeBoardId);
}

export function isCloudOwner(collab = {}) {
    return isCloudBoardActive(collab) && String(collab.activeRole || '') === 'owner';
}

export function canEditCloudBoard(collab = {}) {
    if (!isCloudBoardActive(collab)) return false;
    const role = String(collab.activeRole || '');
    return role === 'owner' || role === 'editor';
}

export function isLocalSaveLocked(collab = {}) {
    return isCloudBoardActive(collab) && String(collab.activeRole || '') !== 'owner';
}

export function shouldUseRealtimeCloud(collab = {}, transportAvailable = true) {
    return isCloudBoardActive(collab) && Boolean(collab.user && collab.token) && Boolean(transportAvailable);
}

export function isRealtimeCloudActive(collab = {}) {
    return Boolean(collab && collab.realtimeSession);
}
