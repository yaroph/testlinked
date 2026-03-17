export const MAP_GROUP_PALETTE = ['#73fbf7', '#ff6b81', '#ffd400', '#ff922b', '#a9e34b'];

function defaultMakeId(prefix = 'id') {
    const globalCrypto = typeof crypto !== 'undefined' ? crypto : null;
    if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
        return `${prefix}_${globalCrypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function clampFiniteNumber(value, fallback, min = null, max = null) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (Number.isFinite(min) && num < min) return min;
    if (Number.isFinite(max) && num > max) return max;
    return num;
}

function normalizeLegacyKey(value, fallback = '') {
    return String(value || fallback)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugifyToken(value, fallback = 'item') {
    const safe = normalizeLegacyKey(value, fallback)
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return safe || fallback;
}

function makeLegacyId(prefix, token, occurrence = 0) {
    const base = slugifyToken(token, prefix);
    return occurrence > 0
        ? `${prefix}_legacy_${base}_${occurrence + 1}`
        : `${prefix}_legacy_${base}`;
}

function ensureUniqueId(preferredId, usedIds, makeFallbackId) {
    let nextId = String(preferredId || '').trim();
    if (nextId && !usedIds.has(nextId)) {
        usedIds.add(nextId);
        return nextId;
    }

    let attempt = 0;
    do {
        nextId = String(makeFallbackId(attempt) || '').trim();
        attempt += 1;
    } while (!nextId || usedIds.has(nextId));

    usedIds.add(nextId);
    return nextId;
}

function sortById(list = []) {
    return [...list].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
}

function mapPairKey(a, b) {
    const left = String(a ?? '').trim();
    const right = String(b ?? '').trim();
    return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function normalizeMapZoneStyle(rawStyle) {
    const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
    return {
        width: clampFiniteNumber(style.width, 2, 1, 12),
        style: ['solid', 'dashed', 'dotted'].includes(style.style) ? style.style : 'solid'
    };
}

export function normalizeMapPoint(rawPoint, fallbackIndex = 0, options = {}) {
    const source = rawPoint && typeof rawPoint === 'object' ? rawPoint : {};
    const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
    const pointScope = String(options.scopeKey || `group-${fallbackIndex + 1}`);
    const pointKey = normalizeLegacyKey(source.name || '', `point-${fallbackIndex + 1}`);
    const pointToken = `${pointScope}-${pointKey || `point-${fallbackIndex + 1}`}`;
    const pointId = ensureUniqueId(
        source.id,
        usedIds,
        (attempt) => makeLegacyId('mp', pointToken, attempt)
    );

    return {
        id: pointId,
        name: String(source.name || `Point ${fallbackIndex + 1}`),
        x: clampFiniteNumber(source.x, 50),
        y: clampFiniteNumber(source.y, 50),
        type: String(source.type || ''),
        iconType: String(source.iconType || 'DEFAULT'),
        notes: String(source.notes || ''),
        status: String(source.status || 'ACTIVE')
    };
}

export function normalizeMapZone(rawZone, fallbackIndex = 0, options = {}) {
    const source = rawZone && typeof rawZone === 'object' ? rawZone : {};
    const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
    const zoneScope = String(options.scopeKey || `group-${fallbackIndex + 1}`);
    const zoneKey = normalizeLegacyKey(source.name || '', `zone-${fallbackIndex + 1}`);
    const zoneId = ensureUniqueId(
        source.id,
        usedIds,
        (attempt) => makeLegacyId('mz', `${zoneScope}-${zoneKey || `zone-${fallbackIndex + 1}`}`, attempt)
    );
    const zoneName = String(source.name || `Zone ${fallbackIndex + 1}`);
    const style = normalizeMapZoneStyle(source.style);

    if (source.type === 'CIRCLE') {
        return {
            id: zoneId,
            name: zoneName,
            type: 'CIRCLE',
            cx: clampFiniteNumber(source.cx, 50),
            cy: clampFiniteNumber(source.cy, 50),
            r: clampFiniteNumber(source.r, 1, 0.1),
            style
        };
    }

    const points = (Array.isArray(source.points) ? source.points : [])
        .map((point) => {
            if (!point || typeof point !== 'object') return null;
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        })
        .filter(Boolean);

    if (points.length < 3) return null;

    return {
        id: zoneId,
        name: zoneName,
        type: 'POLYGON',
        points,
        style
    };
}

export function normalizeMapGroup(rawGroup, groupIndex = 0, options = {}) {
    const source = rawGroup && typeof rawGroup === 'object' ? rawGroup : {};
    const groupOccurrences = options.groupOccurrences instanceof Map ? options.groupOccurrences : new Map();
    const usedGroupIds = options.usedGroupIds instanceof Set ? options.usedGroupIds : new Set();
    const legacyKey = normalizeLegacyKey(source.name || '', `group-${groupIndex + 1}`);
    const occurrence = groupOccurrences.get(legacyKey) || 0;
    groupOccurrences.set(legacyKey, occurrence + 1);

    const groupId = ensureUniqueId(
        source.id,
        usedGroupIds,
        (attempt) => makeLegacyId('grp', legacyKey || `group-${groupIndex + 1}`, occurrence + attempt)
    );

    const pointIds = options.usedPointIds instanceof Set ? options.usedPointIds : new Set();
    const zoneIds = options.usedZoneIds instanceof Set ? options.usedZoneIds : new Set();

    return {
        id: groupId,
        name: String(source.name || `GROUPE ${groupIndex + 1}`),
        color: String(source.color || MAP_GROUP_PALETTE[groupIndex % MAP_GROUP_PALETTE.length]),
        visible: source.visible !== false,
        points: (Array.isArray(source.points) ? source.points : [])
            .map((point, pointIndex) => normalizeMapPoint(point, pointIndex, {
                usedIds: pointIds,
                scopeKey: groupId
            }))
            .filter(Boolean),
        zones: (Array.isArray(source.zones) ? source.zones : [])
            .map((zone, zoneIndex) => normalizeMapZone(zone, zoneIndex, {
                usedIds: zoneIds,
                scopeKey: groupId
            }))
            .filter(Boolean)
    };
}

export function createMapGroup(seed = {}, options = {}) {
    const makeGroupId = typeof options.makeGroupId === 'function' ? options.makeGroupId : () => defaultMakeId('grp');
    return normalizeMapGroup({
        ...seed,
        id: seed?.id || makeGroupId('grp')
    }, Number(options.index || 0), {
        usedGroupIds: new Set()
    });
}

export function normalizeMapGroups(rawGroups, options = {}) {
    const usedGroupIds = new Set();
    const groupOccurrences = new Map();
    const usedPointIds = new Set();
    const usedZoneIds = new Set();
    return (Array.isArray(rawGroups) ? rawGroups : [])
        .map((group, groupIndex) => normalizeMapGroup(group, groupIndex, {
            usedGroupIds,
            groupOccurrences,
            usedPointIds,
            usedZoneIds
        }))
        .filter(Boolean);
}

export function normalizeMapLink(rawLink, fallbackIndex = 0, options = {}) {
    const source = rawLink && typeof rawLink === 'object' ? rawLink : {};
    const from = String(source.from || source.source || '').trim();
    const to = String(source.to || source.target || '').trim();
    if (!from || !to || from === to) return null;

    const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
    const linkId = ensureUniqueId(
        source.id,
        usedIds,
        (attempt) => makeLegacyId('ml', `${mapPairKey(from, to)}-${fallbackIndex + 1}`, attempt)
    );

    return {
        id: linkId,
        from,
        to,
        color: source.color || null,
        type: String(source.type || 'Standard')
    };
}

export function normalizeMapBoardPayload(data) {
    const raw = data && typeof data === 'object' ? data : {};
    const groups = normalizeMapGroups(raw.groups || []);
    const pointIds = new Set();

    groups.forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId) pointIds.add(pointId);
        });
    });

    const usedLinkIds = new Set();
    const dedupedLinks = new Map();
    (Array.isArray(raw.tacticalLinks) ? raw.tacticalLinks : []).forEach((link, linkIndex) => {
        const normalized = normalizeMapLink(link, linkIndex, { usedIds: usedLinkIds });
        if (!normalized) return;
        if (!pointIds.has(String(normalized.from)) || !pointIds.has(String(normalized.to))) return;
        dedupedLinks.set(mapPairKey(normalized.from, normalized.to), normalized);
    });

    return {
        meta: raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {},
        groups,
        tacticalLinks: sortById([...dedupedLinks.values()])
    };
}

export function normalizeOptionalMapBoardPayload(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.groups)) {
        return {
            meta: {},
            groups: [],
            tacticalLinks: []
        };
    }
    return normalizeMapBoardPayload(data);
}

function getGroupIdentity(group) {
    return String(group?.id || '').trim();
}

export function buildMapDeletionSets(existingPayload, incomingPayload, basePayload = null) {
    const existing = normalizeOptionalMapBoardPayload(existingPayload);
    const incoming = normalizeOptionalMapBoardPayload(incomingPayload);
    const base = normalizeOptionalMapBoardPayload(basePayload);

    const deletedGroupIds = new Set();
    const deletedPointIds = new Set();
    const deletedZoneIds = new Set();
    const deletedLinkKeys = new Set();

    const existingGroupIds = new Set(existing.groups.map((group) => getGroupIdentity(group)).filter(Boolean));
    const incomingGroupIds = new Set(incoming.groups.map((group) => getGroupIdentity(group)).filter(Boolean));

    const existingPointIds = new Set();
    const incomingPointIds = new Set();
    const existingZoneIds = new Set();
    const incomingZoneIds = new Set();

    existing.groups.forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId) existingPointIds.add(pointId);
        });
        (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
            const zoneId = String(zone?.id || '').trim();
            if (zoneId) existingZoneIds.add(zoneId);
        });
    });

    incoming.groups.forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId) incomingPointIds.add(pointId);
        });
        (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
            const zoneId = String(zone?.id || '').trim();
            if (zoneId) incomingZoneIds.add(zoneId);
        });
    });

    base.groups.forEach((group) => {
        const groupId = getGroupIdentity(group);
        if (groupId && (!existingGroupIds.has(groupId) || !incomingGroupIds.has(groupId))) {
            deletedGroupIds.add(groupId);
        }

        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId && (!existingPointIds.has(pointId) || !incomingPointIds.has(pointId))) {
                deletedPointIds.add(pointId);
            }
        });

        (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
            const zoneId = String(zone?.id || '').trim();
            if (zoneId && (!existingZoneIds.has(zoneId) || !incomingZoneIds.has(zoneId))) {
                deletedZoneIds.add(zoneId);
            }
        });
    });

    const existingLinkKeys = new Set(existing.tacticalLinks.map((link) => mapPairKey(link?.from, link?.to)).filter(Boolean));
    const incomingLinkKeys = new Set(incoming.tacticalLinks.map((link) => mapPairKey(link?.from, link?.to)).filter(Boolean));

    base.tacticalLinks.forEach((link) => {
        const linkKey = mapPairKey(link?.from, link?.to);
        if (linkKey && (!existingLinkKeys.has(linkKey) || !incomingLinkKeys.has(linkKey))) {
            deletedLinkKeys.add(linkKey);
        }
    });

    return {
        deletedGroupIds,
        deletedPointIds,
        deletedZoneIds,
        deletedLinkKeys
    };
}

export function mergeMapBoardPayload(existingData, incomingData, baseData = null) {
    const existing = normalizeMapBoardPayload(existingData);
    const incoming = normalizeMapBoardPayload(incomingData);
    const deletionSets = buildMapDeletionSets(existing, incoming, baseData);

    const mergedGroups = existing.groups
        .filter((group) => !deletionSets.deletedGroupIds.has(getGroupIdentity(group)))
        .map((group) => ({
            ...group,
            points: (Array.isArray(group?.points) ? group.points : []).filter((point) => {
                const pointId = String(point?.id || '').trim();
                return !pointId || !deletionSets.deletedPointIds.has(pointId);
            }),
            zones: (Array.isArray(group?.zones) ? group.zones : []).filter((zone) => {
                const zoneId = String(zone?.id || '').trim();
                return !zoneId || !deletionSets.deletedZoneIds.has(zoneId);
            })
        }));

    const pointIndex = new Map();
    const zoneIndex = new Map();
    const groupById = new Map();

    mergedGroups.forEach((group, groupIdx) => {
        const groupId = getGroupIdentity(group);
        if (groupId && !groupById.has(groupId)) groupById.set(groupId, groupIdx);

        (Array.isArray(group?.points) ? group.points : []).forEach((point, pointIdx) => {
            const pointId = String(point?.id || '').trim();
            if (!pointId || deletionSets.deletedPointIds.has(pointId) || pointIndex.has(pointId)) return;
            pointIndex.set(pointId, { groupIdx, pointIdx });
        });

        (Array.isArray(group?.zones) ? group.zones : []).forEach((zone, zoneIdx) => {
            const zoneId = String(zone?.id || '').trim();
            if (!zoneId || deletionSets.deletedZoneIds.has(zoneId) || zoneIndex.has(zoneId)) return;
            zoneIndex.set(zoneId, { groupIdx, zoneIdx });
        });
    });

    incoming.groups.forEach((incomingGroup, incomingIdx) => {
        const groupId = getGroupIdentity(incomingGroup);
        if (groupId && deletionSets.deletedGroupIds.has(groupId)) return;

        let targetIdx = groupId && groupById.has(groupId) ? groupById.get(groupId) : -1;
        if (targetIdx < 0) {
            targetIdx = mergedGroups.push({
                ...incomingGroup,
                name: String(incomingGroup?.name || `GROUPE ${mergedGroups.length + 1}`),
                color: String(incomingGroup?.color || MAP_GROUP_PALETTE[mergedGroups.length % MAP_GROUP_PALETTE.length]),
                visible: incomingGroup?.visible !== false,
                points: [],
                zones: []
            }) - 1;
            if (groupId) groupById.set(groupId, targetIdx);
        }

        const targetGroup = mergedGroups[targetIdx];
        if (!targetGroup || typeof targetGroup !== 'object') return;

        targetGroup.id = groupId || targetGroup.id || makeLegacyId('grp', `group-${incomingIdx + 1}`);
        targetGroup.name = String(incomingGroup?.name || targetGroup.name || `GROUPE ${incomingIdx + 1}`);
        targetGroup.color = String(incomingGroup?.color || targetGroup.color || MAP_GROUP_PALETTE[targetIdx % MAP_GROUP_PALETTE.length]);
        targetGroup.visible = incomingGroup?.visible !== false;
        if (!Array.isArray(targetGroup.points)) targetGroup.points = [];
        if (!Array.isArray(targetGroup.zones)) targetGroup.zones = [];

        (Array.isArray(incomingGroup?.points) ? incomingGroup.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (!pointId || deletionSets.deletedPointIds.has(pointId)) return;
            if (pointIndex.has(pointId)) {
                const loc = pointIndex.get(pointId);
                mergedGroups[loc.groupIdx].points[loc.pointIdx] = { ...point };
                return;
            }
            const nextPointIdx = targetGroup.points.push({ ...point }) - 1;
            pointIndex.set(pointId, { groupIdx: targetIdx, pointIdx: nextPointIdx });
        });

        (Array.isArray(incomingGroup?.zones) ? incomingGroup.zones : []).forEach((zone) => {
            const zoneId = String(zone?.id || '').trim();
            if (!zoneId || deletionSets.deletedZoneIds.has(zoneId)) return;
            if (zoneIndex.has(zoneId)) {
                const loc = zoneIndex.get(zoneId);
                mergedGroups[loc.groupIdx].zones[loc.zoneIdx] = { ...zone };
                return;
            }
            const nextZoneIdx = targetGroup.zones.push({ ...zone }) - 1;
            zoneIndex.set(zoneId, { groupIdx: targetIdx, zoneIdx: nextZoneIdx });
        });
    });

    const validPointIds = new Set();
    mergedGroups.forEach((group) => {
        (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
            const pointId = String(point?.id || '').trim();
            if (pointId) validPointIds.add(pointId);
        });
    });

    const mergedLinks = new Map();
    [existing.tacticalLinks, incoming.tacticalLinks].forEach((links) => {
        (Array.isArray(links) ? links : []).forEach((link, linkIndex) => {
            const normalized = normalizeMapLink(link, linkIndex);
            if (!normalized) return;
            const pairKey = mapPairKey(normalized.from, normalized.to);
            if (deletionSets.deletedLinkKeys.has(pairKey)) return;
            if (!validPointIds.has(normalized.from) || !validPointIds.has(normalized.to)) return;
            mergedLinks.set(pairKey, normalized);
        });
    });

    return {
        meta: {
            ...(existing.meta || {}),
            ...(incoming.meta || {})
        },
        groups: mergedGroups,
        tacticalLinks: sortById([...mergedLinks.values()])
    };
}

export function countMapBoardEntities(payload) {
    const groups = Array.isArray(payload?.groups) ? payload.groups.length : 0;
    const points = (Array.isArray(payload?.groups) ? payload.groups : [])
        .reduce((total, group) => total + (Array.isArray(group?.points) ? group.points.length : 0), 0);
    const zones = (Array.isArray(payload?.groups) ? payload.groups : [])
        .reduce((total, group) => total + (Array.isArray(group?.zones) ? group.zones.length : 0), 0);
    const tacticalLinks = Array.isArray(payload?.tacticalLinks) ? payload.tacticalLinks.length : 0;
    return { groups, points, zones, tacticalLinks };
}
