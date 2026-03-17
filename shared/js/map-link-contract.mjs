import { parseJsonSafe } from './collab-browser.mjs';

export const TACTICAL_MAP_LOCAL_STORAGE_KEY = 'tacticalMapData';
export const MAP_ACTIVE_BOARD_STORAGE_KEY = 'bniLinkedMapActiveBoard_v1';
export const MAP_SHARED_SNAPSHOT_STORAGE_KEY = 'bniLinkedMapSharedSnapshot_v1';
export const MAP_SHARED_SNAPSHOT_SCHEMA_VERSION = 1;

export function mapPointNameKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function clearSharedMapSnapshot(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage) return false;
    try {
        storage.removeItem(MAP_SHARED_SNAPSHOT_STORAGE_KEY);
        return true;
    } catch (error) {
        return false;
    }
}

export function writeSharedMapSnapshot(storage = (typeof localStorage !== 'undefined' ? localStorage : null), payload = null) {
    if (!storage) return false;
    try {
        if (!payload || !payload.boardId || !payload.data || !Array.isArray(payload.data.groups)) {
            storage.removeItem(MAP_SHARED_SNAPSHOT_STORAGE_KEY);
            return false;
        }

        storage.setItem(MAP_SHARED_SNAPSHOT_STORAGE_KEY, JSON.stringify({
            schemaVersion: MAP_SHARED_SNAPSHOT_SCHEMA_VERSION,
            boardId: String(payload.boardId || ''),
            updatedAt: String(payload.updatedAt || ''),
            data: payload.data
        }));
        return true;
    } catch (error) {
        return false;
    }
}

export function readActiveMapBoard(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage) return null;
    const raw = storage.getItem(MAP_ACTIVE_BOARD_STORAGE_KEY);
    const parsed = parseJsonSafe(raw || '{}', {});
    if (!parsed || typeof parsed !== 'object') return null;
    const boardId = String(parsed.boardId || '').trim();
    if (!boardId) return null;
    return {
        boardId,
        role: String(parsed.role || ''),
        title: String(parsed.title || ''),
        ownerId: String(parsed.ownerId || ''),
        updatedAt: String(parsed.updatedAt || '')
    };
}

export function readSharedMapSnapshot(storage = (typeof localStorage !== 'undefined' ? localStorage : null), activeBoardId = '') {
    if (!storage) return null;
    const raw = storage.getItem(MAP_SHARED_SNAPSHOT_STORAGE_KEY);
    const parsed = parseJsonSafe(raw || '{}', {});
    if (!parsed || typeof parsed !== 'object') return null;

    const boardId = String(parsed.boardId || '').trim();
    if (!boardId) return null;
    if (activeBoardId && boardId !== String(activeBoardId)) return null;
    if (!parsed.data || !Array.isArray(parsed.data.groups)) return null;

    return {
        schemaVersion: Number(parsed.schemaVersion || 0),
        boardId,
        updatedAt: String(parsed.updatedAt || ''),
        data: parsed.data
    };
}

export function buildMapPointIndex(payloads = []) {
    const byId = new Map();
    const byNameBuckets = new Map();

    (Array.isArray(payloads) ? payloads : []).forEach((payload) => {
        if (!payload || !Array.isArray(payload.groups)) return;

        payload.groups.forEach((group) => {
            (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
                if (!point || typeof point !== 'object') return;
                const pointId = String(point.id || '').trim();
                const x = Number(point.x);
                const y = Number(point.y);
                if (!pointId || !Number.isFinite(x) || !Number.isFinite(y)) return;

                const safePoint = {
                    id: pointId,
                    name: String(point.name || ''),
                    x,
                    y
                };

                byId.set(pointId, safePoint);

                const nameKey = mapPointNameKey(safePoint.name);
                if (!nameKey) return;
                const bucket = byNameBuckets.get(nameKey) || [];
                bucket.push(safePoint);
                byNameBuckets.set(nameKey, bucket);
            });
        });
    });

    const byName = new Map();
    byNameBuckets.forEach((bucket, key) => {
        if (bucket.length === 1) byName.set(key, bucket[0]);
    });

    if (!byId.size && !byName.size) return null;
    return { byId, byName };
}

export function loadMapPointIndex(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage) return null;

    const payloads = [];

    const localRaw = storage.getItem(TACTICAL_MAP_LOCAL_STORAGE_KEY);
    const localPayload = parseJsonSafe(localRaw || 'null', null);
    if (localPayload && Array.isArray(localPayload.groups)) {
        payloads.push(localPayload);
    }

    const activeBoard = readActiveMapBoard(storage);
    const snapshot = readSharedMapSnapshot(storage, activeBoard?.boardId || '');
    if (snapshot?.data && Array.isArray(snapshot.data.groups)) {
        payloads.push(snapshot.data);
    }

    return buildMapPointIndex(payloads);
}

export function resolveMapPointForNode(node, mapPoints) {
    if (!node || !mapPoints) return null;
    const byId = mapPoints.byId instanceof Map ? mapPoints.byId : null;
    const byName = mapPoints.byName instanceof Map ? mapPoints.byName : null;

    const linkedId = String(node.linkedMapPointId || '').trim();
    if (linkedId && byId?.has(linkedId)) return byId.get(linkedId);

    const nodeId = String(node.id || '').trim();
    if (nodeId && byId?.has(nodeId)) return byId.get(nodeId);

    const nameKey = mapPointNameKey(node.name || '');
    if (nameKey && byName?.has(nameKey)) return byName.get(nameKey);

    return null;
}
