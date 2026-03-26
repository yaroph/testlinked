import {
    normalizeMapBoardPayload,
    normalizeMapPoint,
    normalizeMapZone,
    normalizeMapLink
} from '../js/map-board.mjs';
import { cloneJson, sortById, valuesEqual } from './utils.mjs';

const MAP_GROUP_TEXT_FIELDS = ['name'];
const MAP_GROUP_FIELDS = ['name', 'color', 'visible'];
const MAP_GROUP_STRUCTURAL_FIELDS = MAP_GROUP_FIELDS.filter((fieldName) => !MAP_GROUP_TEXT_FIELDS.includes(fieldName));
const MAP_POINT_TEXT_FIELDS = ['name', 'type', 'notes'];
const MAP_POINT_FIELDS = ['name', 'x', 'y', 'type', 'iconType', 'notes', 'status'];
const MAP_POINT_STRUCTURAL_FIELDS = MAP_POINT_FIELDS.filter((fieldName) => !MAP_POINT_TEXT_FIELDS.includes(fieldName));
const MAP_ZONE_TEXT_FIELDS = ['name'];
const MAP_ZONE_FIELDS = ['name', 'type', 'cx', 'cy', 'r', 'points', 'style'];
const MAP_ZONE_STRUCTURAL_FIELDS = MAP_ZONE_FIELDS.filter((fieldName) => !MAP_ZONE_TEXT_FIELDS.includes(fieldName));
const MAP_TACTICAL_LINK_FIELDS = ['from', 'to', 'color', 'type'];

function normalizeMeta(meta) {
    const source = meta && typeof meta === 'object' ? { ...meta } : {};
    if (Object.prototype.hasOwnProperty.call(source, 'date')) {
        source.date = '';
    }
    return source;
}

function stripMapRealtimeTextFromGroup(group) {
    return {
        ...group,
        name: '',
        points: (Array.isArray(group?.points) ? group.points : []).map((point) => ({
            ...point,
            name: '',
            type: '',
            notes: ''
        })),
        zones: (Array.isArray(group?.zones) ? group.zones : []).map((zone) => ({
            ...zone,
            name: ''
        }))
    };
}

function pickChangedFields(previousValue, nextValue, fieldNames = []) {
    const changes = {};
    fieldNames.forEach((fieldName) => {
        if (!valuesEqual(previousValue?.[fieldName], nextValue?.[fieldName])) {
            changes[fieldName] = cloneJson(nextValue?.[fieldName], nextValue?.[fieldName]);
        }
    });
    return changes;
}

function cleanPatch(changes = {}, allowedFields = []) {
    const source = changes && typeof changes === 'object' ? changes : {};
    const cleaned = {};
    allowedFields.forEach((fieldName) => {
        if (Object.prototype.hasOwnProperty.call(source, fieldName)) {
            cleaned[fieldName] = cloneJson(source[fieldName], source[fieldName]);
        }
    });
    return cleaned;
}

function normalizePatchOperation(operation, idFields = ['id'], allowedFields = []) {
    let cleanId = '';
    idFields.some((fieldName) => {
        const value = String(operation?.[fieldName] || '').trim();
        if (!value) return false;
        cleanId = value;
        return true;
    });
    if (!cleanId) return null;
    const changes = cleanPatch(operation?.changes, allowedFields);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        id: cleanId,
        changes
    };
}

function normalizePointPatchOperation(operation, allowedFields = MAP_POINT_FIELDS) {
    const groupId = String(operation?.groupId || '').trim();
    const pointId = String(operation?.pointId || operation?.id || '').trim();
    if (!groupId || !pointId) return null;
    const changes = cleanPatch(operation?.changes, allowedFields);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        groupId,
        pointId,
        changes
    };
}

function normalizeZonePatchOperation(operation, allowedFields = MAP_ZONE_FIELDS) {
    const groupId = String(operation?.groupId || '').trim();
    const zoneId = String(operation?.zoneId || operation?.id || '').trim();
    if (!groupId || !zoneId) return null;
    const changes = cleanPatch(operation?.changes, allowedFields);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        groupId,
        zoneId,
        changes
    };
}

function findGroup(groupMap, groupId) {
    return groupMap.get(String(groupId || '').trim()) || null;
}

function normalizeSingleGroup(group) {
    return canonicalizeMapPayload({ groups: [group], tacticalLinks: [] }).groups[0] || null;
}

function collectValidPointIdsFromGroups(groupMap) {
    const validPointIds = new Set();
    [...groupMap.values()].forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId) validPointIds.add(pointId);
        });
    });
    return validPointIds;
}

function normalizeSingleLink(link, groupMap) {
    const normalized = normalizeMapLink(link, 0, { usedIds: new Set() });
    if (!normalized) return null;
    const validPointIds = collectValidPointIdsFromGroups(groupMap);
    if (!validPointIds.has(String(normalized.from)) || !validPointIds.has(String(normalized.to))) {
        return null;
    }
    return normalized;
}

export function canonicalizeMapPayload(payload = {}) {
    const normalized = normalizeMapBoardPayload(payload || {});
    return {
        meta: normalizeMeta(normalized.meta),
        groups: sortById(cloneJson(normalized.groups, [])),
        tacticalLinks: sortById(cloneJson(normalized.tacticalLinks, []))
    };
}

export function stripMapRealtimeTextFields(payload = {}) {
    const normalized = canonicalizeMapPayload(payload);
    return {
        ...normalized,
        groups: normalized.groups.map(stripMapRealtimeTextFromGroup)
    };
}

function diffMapOpsInternal(previousPayload, nextPayload, options = {}) {
    const includeRealtimeText = options.includeRealtimeText !== false;
    const previous = canonicalizeMapPayload(previousPayload);
    const next = canonicalizeMapPayload(nextPayload);
    const ops = [];

    if (!valuesEqual(previous.meta, next.meta)) {
        ops.push({ type: 'set_meta', meta: cloneJson(next.meta, {}) });
    }

    const previousGroups = new Map(previous.groups.map((group) => [String(group.id), group]));
    const nextGroups = new Map(next.groups.map((group) => [String(group.id), group]));

    next.groups.forEach((group) => {
        const previousGroup = previousGroups.get(String(group.id));
        if (!previousGroup) {
            ops.push({ type: 'create_group', group: cloneJson(group, group) });
            return;
        }

        const groupPatch = pickChangedFields(
            previousGroup,
            group,
            includeRealtimeText ? MAP_GROUP_FIELDS : MAP_GROUP_STRUCTURAL_FIELDS
        );
        if (Object.keys(groupPatch).length) {
            ops.push({ type: 'patch_group', id: String(group.id), changes: groupPatch });
        }

        const previousPoints = new Map((Array.isArray(previousGroup.points) ? previousGroup.points : []).map((point) => [String(point.id), point]));
        const nextPoints = new Map((Array.isArray(group.points) ? group.points : []).map((point) => [String(point.id), point]));

        (Array.isArray(group.points) ? group.points : []).forEach((point) => {
            const previousPoint = previousPoints.get(String(point.id));
            if (!previousPoint) {
                ops.push({
                    type: 'create_point',
                    groupId: String(group.id),
                    point: cloneJson(point, point)
                });
                return;
            }
            const pointPatch = pickChangedFields(
                previousPoint,
                point,
                includeRealtimeText ? MAP_POINT_FIELDS : MAP_POINT_STRUCTURAL_FIELDS
            );
            if (Object.keys(pointPatch).length) {
                ops.push({
                    type: 'patch_point',
                    groupId: String(group.id),
                    pointId: String(point.id),
                    changes: pointPatch
                });
            }
        });

        (Array.isArray(previousGroup.points) ? previousGroup.points : []).forEach((point) => {
            if (!nextPoints.has(String(point.id))) {
                ops.push({
                    type: 'delete_point',
                    groupId: String(group.id),
                    pointId: String(point.id)
                });
            }
        });

        const previousZones = new Map((Array.isArray(previousGroup.zones) ? previousGroup.zones : []).map((zone) => [String(zone.id), zone]));
        const nextZones = new Map((Array.isArray(group.zones) ? group.zones : []).map((zone) => [String(zone.id), zone]));

        (Array.isArray(group.zones) ? group.zones : []).forEach((zone) => {
            const previousZone = previousZones.get(String(zone.id));
            if (!previousZone) {
                ops.push({
                    type: 'create_zone',
                    groupId: String(group.id),
                    zone: cloneJson(zone, zone)
                });
                return;
            }
            const zonePatch = pickChangedFields(
                previousZone,
                zone,
                includeRealtimeText ? MAP_ZONE_FIELDS : MAP_ZONE_STRUCTURAL_FIELDS
            );
            if (Object.keys(zonePatch).length) {
                ops.push({
                    type: 'patch_zone',
                    groupId: String(group.id),
                    zoneId: String(zone.id),
                    changes: zonePatch
                });
            }
        });

        (Array.isArray(previousGroup.zones) ? previousGroup.zones : []).forEach((zone) => {
            if (!nextZones.has(String(zone.id))) {
                ops.push({
                    type: 'delete_zone',
                    groupId: String(group.id),
                    zoneId: String(zone.id)
                });
            }
        });
    });

    previous.groups.forEach((group) => {
        if (!nextGroups.has(String(group.id))) {
            ops.push({ type: 'delete_group', id: String(group.id) });
        }
    });

    const previousLinks = new Map(previous.tacticalLinks.map((link) => [String(link.id), link]));
    const nextLinks = new Map(next.tacticalLinks.map((link) => [String(link.id), link]));

    next.tacticalLinks.forEach((link) => {
        const previousLink = previousLinks.get(String(link.id));
        if (!previousLink) {
            ops.push({ type: 'create_tactical_link', link: cloneJson(link, link) });
            return;
        }
        const linkPatch = pickChangedFields(previousLink, link, MAP_TACTICAL_LINK_FIELDS);
        if (Object.keys(linkPatch).length) {
            ops.push({ type: 'patch_tactical_link', id: String(link.id), changes: linkPatch });
        }
    });

    previous.tacticalLinks.forEach((link) => {
        if (!nextLinks.has(String(link.id))) {
            ops.push({ type: 'delete_tactical_link', id: String(link.id) });
        }
    });

    return ops;
}

export function diffMapOps(previousPayload, nextPayload) {
    return diffMapOpsInternal(previousPayload, nextPayload, { includeRealtimeText: true });
}

export function diffMapOpsWithoutRealtimeText(previousPayload, nextPayload) {
    return diffMapOpsInternal(previousPayload, nextPayload, { includeRealtimeText: false });
}

export function preserveMapRealtimeTextInOps(snapshot, ops = []) {
    const current = canonicalizeMapPayload(snapshot);
    const currentGroups = new Map(current.groups.map((group) => [String(group.id), group]));

    return (Array.isArray(ops) ? ops : []).map((operation) => {
        const type = String(operation?.type || '').trim();
        if (type === 'patch_group') {
            return normalizePatchOperation(operation, ['id'], MAP_GROUP_STRUCTURAL_FIELDS);
        }
        if (type === 'patch_point') {
            return normalizePointPatchOperation(operation, MAP_POINT_STRUCTURAL_FIELDS);
        }
        if (type === 'patch_zone') {
            return normalizeZonePatchOperation(operation, MAP_ZONE_STRUCTURAL_FIELDS);
        }
        if (type === 'patch_tactical_link') {
            return normalizePatchOperation(operation, ['id'], MAP_TACTICAL_LINK_FIELDS);
        }
        if (type !== 'upsert_group' && type !== 'create_group') {
            return cloneJson(operation, operation);
        }

        const group = canonicalizeMapPayload({ groups: [operation.group], tacticalLinks: [] }).groups[0];
        if (!group) {
            return null;
        }

        const currentGroup = currentGroups.get(String(group.id));
        if (currentGroup) {
            group.name = currentGroup.name;

            const currentPoints = new Map((Array.isArray(currentGroup.points) ? currentGroup.points : []).map((point) => [String(point.id), point]));
            const currentZones = new Map((Array.isArray(currentGroup.zones) ? currentGroup.zones : []).map((zone) => [String(zone.id), zone]));

            group.points = (Array.isArray(group.points) ? group.points : []).map((point) => {
                const currentPoint = currentPoints.get(String(point.id));
                return currentPoint
                    ? {
                        ...point,
                        name: currentPoint.name,
                        type: currentPoint.type,
                        notes: currentPoint.notes
                    }
                    : point;
            });

            group.zones = (Array.isArray(group.zones) ? group.zones : []).map((zone) => {
                const currentZone = currentZones.get(String(zone.id));
                return currentZone
                    ? {
                        ...zone,
                        name: currentZone.name
                    }
                    : zone;
            });
        }

        return {
            ...cloneJson(operation, operation),
            group: cloneJson(group, group)
        };
    }).filter(Boolean);
}

export function applyMapOps(snapshot, ops = []) {
    const next = canonicalizeMapPayload(snapshot);
    const groupMap = new Map(next.groups.map((group) => [String(group.id), group]));
    const linkMap = new Map(next.tacticalLinks.map((link) => [String(link.id), link]));

    (Array.isArray(ops) ? ops : []).forEach((operation) => {
        const type = String(operation?.type || '').trim();
        if (type === 'set_meta') {
            next.meta = normalizeMeta(operation.meta);
            return;
        }
        if (type === 'create_group') {
            const normalized = normalizeSingleGroup(operation.group);
            if (normalized) groupMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'patch_group') {
            const patchOp = normalizePatchOperation(operation, ['id'], MAP_GROUP_FIELDS);
            if (!patchOp) return;
            const currentGroup = findGroup(groupMap, patchOp.id);
            if (!currentGroup) return;
            const normalized = normalizeSingleGroup({
                ...currentGroup,
                ...patchOp.changes,
                points: currentGroup.points,
                zones: currentGroup.zones
            });
            if (normalized) groupMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'upsert_group') {
            const normalized = canonicalizeMapPayload({ groups: [operation.group], tacticalLinks: [] }).groups[0];
            if (normalized) groupMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'delete_group') {
            const groupId = String(operation.id || '').trim();
            if (!groupId) return;
            groupMap.delete(groupId);
            const validPointIds = new Set();
            [...groupMap.values()].forEach((group) => {
                (Array.isArray(group?.points) ? group.points : []).forEach((point) => validPointIds.add(String(point.id)));
            });
            [...linkMap.values()].forEach((link) => {
                if (!validPointIds.has(String(link.from)) || !validPointIds.has(String(link.to))) {
                    linkMap.delete(String(link.id));
                }
            });
            return;
        }
        if (type === 'create_point') {
            const groupId = String(operation.groupId || '').trim();
            const group = findGroup(groupMap, groupId);
            if (!group) return;
            const point = normalizeMapPoint(operation.point, 0, { usedIds: new Set() });
            if (!point) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                points: [...(Array.isArray(group.points) ? group.points : []).filter((entry) => String(entry?.id || '') !== String(point.id)), point]
            });
            if (nextGroup) groupMap.set(String(nextGroup.id), nextGroup);
            return;
        }
        if (type === 'patch_point') {
            const patchOp = normalizePointPatchOperation(operation, MAP_POINT_FIELDS);
            if (!patchOp) return;
            const group = findGroup(groupMap, patchOp.groupId);
            if (!group) return;
            const currentPoint = (Array.isArray(group.points) ? group.points : [])
                .find((entry) => String(entry?.id || '') === patchOp.pointId);
            if (!currentPoint) return;
            const nextPoint = normalizeMapPoint({
                ...currentPoint,
                ...patchOp.changes,
                id: patchOp.pointId
            }, 0, { usedIds: new Set() });
            if (!nextPoint) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                points: (Array.isArray(group.points) ? group.points : []).map((entry) =>
                    String(entry?.id || '') === patchOp.pointId ? nextPoint : entry
                )
            });
            if (nextGroup) groupMap.set(String(nextGroup.id), nextGroup);
            return;
        }
        if (type === 'delete_point') {
            const groupId = String(operation.groupId || '').trim();
            const pointId = String(operation.pointId || operation.id || '').trim();
            const group = findGroup(groupMap, groupId);
            if (!group || !pointId) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                points: (Array.isArray(group.points) ? group.points : []).filter((entry) => String(entry?.id || '') !== pointId)
            });
            if (nextGroup) {
                groupMap.set(String(nextGroup.id), nextGroup);
            } else {
                groupMap.delete(groupId);
            }
            [...linkMap.values()].forEach((link) => {
                if (String(link.from || '') === pointId || String(link.to || '') === pointId) {
                    linkMap.delete(String(link.id));
                }
            });
            return;
        }
        if (type === 'create_zone') {
            const groupId = String(operation.groupId || '').trim();
            const group = findGroup(groupMap, groupId);
            if (!group) return;
            const zone = normalizeMapZone(operation.zone, 0, { usedIds: new Set() });
            if (!zone) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                zones: [...(Array.isArray(group.zones) ? group.zones : []).filter((entry) => String(entry?.id || '') !== String(zone.id)), zone]
            });
            if (nextGroup) groupMap.set(String(nextGroup.id), nextGroup);
            return;
        }
        if (type === 'patch_zone') {
            const patchOp = normalizeZonePatchOperation(operation, MAP_ZONE_FIELDS);
            if (!patchOp) return;
            const group = findGroup(groupMap, patchOp.groupId);
            if (!group) return;
            const currentZone = (Array.isArray(group.zones) ? group.zones : [])
                .find((entry) => String(entry?.id || '') === patchOp.zoneId);
            if (!currentZone) return;
            const nextZone = normalizeMapZone({
                ...currentZone,
                ...patchOp.changes,
                id: patchOp.zoneId
            }, 0, { usedIds: new Set() });
            if (!nextZone) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                zones: (Array.isArray(group.zones) ? group.zones : []).map((entry) =>
                    String(entry?.id || '') === patchOp.zoneId ? nextZone : entry
                )
            });
            if (nextGroup) groupMap.set(String(nextGroup.id), nextGroup);
            return;
        }
        if (type === 'delete_zone') {
            const groupId = String(operation.groupId || '').trim();
            const zoneId = String(operation.zoneId || operation.id || '').trim();
            const group = findGroup(groupMap, groupId);
            if (!group || !zoneId) return;
            const nextGroup = normalizeSingleGroup({
                ...group,
                zones: (Array.isArray(group.zones) ? group.zones : []).filter((entry) => String(entry?.id || '') !== zoneId)
            });
            if (nextGroup) {
                groupMap.set(String(nextGroup.id), nextGroup);
            } else {
                groupMap.delete(groupId);
            }
            return;
        }
        if (type === 'create_tactical_link') {
            const normalized = normalizeSingleLink(operation.link, groupMap);
            if (normalized) linkMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'patch_tactical_link') {
            const patchOp = normalizePatchOperation(operation, ['id'], MAP_TACTICAL_LINK_FIELDS);
            if (!patchOp) return;
            const currentLink = linkMap.get(String(patchOp.id));
            if (!currentLink) return;
            const normalized = normalizeSingleLink({
                ...currentLink,
                ...patchOp.changes,
                id: patchOp.id
            }, groupMap);
            if (normalized) linkMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'upsert_tactical_link') {
            const normalized = canonicalizeMapPayload({ groups: [...groupMap.values()], tacticalLinks: [operation.link] }).tacticalLinks[0];
            if (normalized) linkMap.set(String(normalized.id), normalized);
            return;
        }
        if (type === 'delete_tactical_link') {
            const linkId = String(operation.id || '').trim();
            if (linkId) linkMap.delete(linkId);
        }
    });

    next.groups = sortById([...groupMap.values()]);
    const validPointIds = new Set();
    next.groups.forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => validPointIds.add(String(point.id)));
    });
    next.tacticalLinks = sortById(
        [...linkMap.values()].filter((link) => validPointIds.has(String(link.from)) && validPointIds.has(String(link.to)))
    );
    return next;
}
