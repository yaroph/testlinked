export function isCloudBoardActive(collab = {}) {
    return Boolean(collab && collab.activeBoardId);
}

export function isCloudOwner(collab = {}) {
    return isCloudBoardActive(collab) && String(collab.activeRole || '') === 'owner';
}

export function isEditLockHeldByOther(collab = {}) {
    return Boolean(collab?.activeEditLock?.heldByOther);
}

export function canEditCloudBoard(collab = {}) {
    if (!isCloudBoardActive(collab)) return false;
    const role = String(collab.activeRole || '');
    if (role !== 'owner' && role !== 'editor') return false;
    return Boolean(collab?.activeEditLock?.isSelf);
}

export function isLocalSaveLocked(collab = {}) {
    return isCloudBoardActive(collab) && !canEditCloudBoard(collab);
}

export function shouldUseRealtimeCloud(collab = {}, transportAvailable = true) {
    void collab;
    void transportAvailable;
    return false;
}

export function isRealtimeCloudActive(collab = {}) {
    void collab;
    return false;
}
