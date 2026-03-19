import { normalizeMapBoardPayload } from '../js/map-board.mjs';
import { cloneJson, sortById, valuesEqual } from './utils.mjs';

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

export function diffMapOps(previousPayload, nextPayload) {
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
        if (!previousGroup || !valuesEqual(previousGroup, group)) {
            ops.push({ type: 'upsert_group', group: cloneJson(group, group) });
        }
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
        if (!previousLink || !valuesEqual(previousLink, link)) {
            ops.push({ type: 'upsert_tactical_link', link: cloneJson(link, link) });
        }
    });

    previous.tacticalLinks.forEach((link) => {
        if (!nextLinks.has(String(link.id))) {
            ops.push({ type: 'delete_tactical_link', id: String(link.id) });
        }
    });

    return ops;
}

export function diffMapOpsWithoutRealtimeText(previousPayload, nextPayload) {
    const previous = canonicalizeMapPayload(previousPayload);
    const next = canonicalizeMapPayload(nextPayload);
    const previousComparable = stripMapRealtimeTextFields(previous);
    const nextComparable = stripMapRealtimeTextFields(next);
    const ops = [];

    if (!valuesEqual(previous.meta, next.meta)) {
        ops.push({ type: 'set_meta', meta: cloneJson(next.meta, {}) });
    }

    const previousGroups = new Map(previousComparable.groups.map((group) => [String(group.id), group]));
    const nextGroups = new Map(nextComparable.groups.map((group) => [String(group.id), group]));
    const nextFullGroups = new Map(next.groups.map((group) => [String(group.id), group]));

    nextComparable.groups.forEach((group) => {
        const previousGroup = previousGroups.get(String(group.id));
        if (!previousGroup || !valuesEqual(previousGroup, group)) {
            const fullGroup = nextFullGroups.get(String(group.id));
            if (fullGroup) {
                ops.push({ type: 'upsert_group', group: cloneJson(fullGroup, fullGroup) });
            }
        }
    });

    previousComparable.groups.forEach((group) => {
        if (!nextGroups.has(String(group.id))) {
            ops.push({ type: 'delete_group', id: String(group.id) });
        }
    });

    const previousLinks = new Map(previous.tacticalLinks.map((link) => [String(link.id), link]));
    const nextLinks = new Map(next.tacticalLinks.map((link) => [String(link.id), link]));

    next.tacticalLinks.forEach((link) => {
        const previousLink = previousLinks.get(String(link.id));
        if (!previousLink || !valuesEqual(previousLink, link)) {
            ops.push({ type: 'upsert_tactical_link', link: cloneJson(link, link) });
        }
    });

    previous.tacticalLinks.forEach((link) => {
        if (!nextLinks.has(String(link.id))) {
            ops.push({ type: 'delete_tactical_link', id: String(link.id) });
        }
    });

    return ops;
}

export function preserveMapRealtimeTextInOps(snapshot, ops = []) {
    const current = canonicalizeMapPayload(snapshot);
    const currentGroups = new Map(current.groups.map((group) => [String(group.id), group]));

    return (Array.isArray(ops) ? ops : []).map((operation) => {
        const type = String(operation?.type || '').trim();
        if (type !== 'upsert_group') {
            return cloneJson(operation, operation);
        }

        const group = canonicalizeMapPayload({ groups: [operation.group], tacticalLinks: [] }).groups[0];
        if (!group) {
            return cloneJson(operation, operation);
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
    });
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
