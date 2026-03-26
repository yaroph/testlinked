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
    return (role === 'owner' || role === 'editor') && !isEditLockHeldByOther(collab);
}

export function isLocalSaveLocked(collab = {}) {
    return isCloudBoardActive(collab)
        && (String(collab.activeRole || '') !== 'owner' || isEditLockHeldByOther(collab));
}

export function shouldUseRealtimeCloud(collab = {}, transportAvailable = true) {
    if (!isCloudBoardActive(collab) || !collab.user || !collab.token || !transportAvailable) {
        return false;
    }

    if (typeof window === 'undefined') return false;
    const explicitOptIn = String(window.BNI_ENABLE_REALTIME || '').trim().toLowerCase();
    return explicitOptIn === '1' || explicitOptIn === 'true' || window.BNI_ENABLE_REALTIME === true;
}

export function isRealtimeCloudActive(collab = {}) {
    return Boolean(collab && collab.realtimeSession);
}
