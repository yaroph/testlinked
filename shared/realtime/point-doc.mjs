import { cloneJson, sortById, valuesEqual } from './utils.mjs';
import { normalizePointPhysicsSettings } from '../js/point-physics-settings.mjs';

const POINT_REALTIME_TEXT_FIELDS = ['name', 'num', 'accountNumber', 'citizenNumber', 'description', 'notes'];

function normalizeMeta(meta) {
    const source = meta && typeof meta === 'object' ? { ...meta } : {};
    return {
        projectName: String(source.projectName || '')
    };
}

function normalizeNode(node) {
    if (!node || typeof node !== 'object') return null;
    const id = String(node.id ?? '').trim();
    if (!id) return null;
    return {
        id,
        name: String(node.name || '').trim(),
        type: String(node.type || 'person'),
        color: String(node.color || ''),
        manualColor: Boolean(node.manualColor),
        personStatus: String(node.personStatus || 'active'),
        num: String(node.num || ''),
        accountNumber: String(node.accountNumber || ''),
        citizenNumber: String(node.citizenNumber || ''),
        description: String(node.description || node.notes || ''),
        notes: String(node.notes || node.description || ''),
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        fixed: Boolean(node.fixed),
        linkedMapPointId: String(node.linkedMapPointId || '')
    };
}

function normalizeLink(link) {
    if (!link || typeof link !== 'object') return null;
    const id = String(link.id ?? '').trim();
    const source = String(link.source ?? link.from ?? '').trim();
    const target = String(link.target ?? link.to ?? '').trim();
    if (!id || !source || !target || source === target) return null;
    return {
        id,
        source,
        target,
        kind: String(link.kind || 'relation')
    };
}

function stripPointNodeRealtimeText(node) {
    return {
        ...node,
        name: '',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        description: '',
        notes: ''
    };
}

export function canonicalizePointPayload(payload = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    return {
        meta: normalizeMeta(raw.meta),
        physicsSettings: normalizePointPhysicsSettings(
            raw.physicsSettings && typeof raw.physicsSettings === 'object'
                ? cloneJson(raw.physicsSettings, {})
                : {}
        ),
        nodes: sortById((Array.isArray(raw.nodes) ? raw.nodes : []).map(normalizeNode).filter(Boolean)),
        links: sortById((Array.isArray(raw.links) ? raw.links : []).map(normalizeLink).filter(Boolean))
    };
}

export function stripPointRealtimeTextFields(payload = {}) {
    const normalized = canonicalizePointPayload(payload);
    return {
        ...normalized,
        nodes: normalized.nodes.map(stripPointNodeRealtimeText)
    };
}

export function diffPointOps(previousPayload, nextPayload) {
    const previous = canonicalizePointPayload(previousPayload);
    const next = canonicalizePointPayload(nextPayload);
    const ops = [];

    if (!valuesEqual(previous.meta, next.meta)) {
        ops.push({ type: 'set_meta', meta: cloneJson(next.meta, {}) });
    }

    if (!valuesEqual(previous.physicsSettings, next.physicsSettings)) {
        ops.push({ type: 'set_physics', physicsSettings: cloneJson(next.physicsSettings, {}) });
    }

    const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));

    next.nodes.forEach((node) => {
        const previousNode = previousNodes.get(node.id);
        if (!previousNode || !valuesEqual(previousNode, node)) {
            ops.push({ type: 'upsert_node', node: cloneJson(node, node) });
        }
    });

    previous.nodes.forEach((node) => {
        if (!nextNodes.has(node.id)) {
            ops.push({ type: 'delete_node', id: node.id });
        }
    });

    const previousLinks = new Map(previous.links.map((link) => [link.id, link]));
    const nextLinks = new Map(next.links.map((link) => [link.id, link]));

    next.links.forEach((link) => {
        const previousLink = previousLinks.get(link.id);
        if (!previousLink || !valuesEqual(previousLink, link)) {
            ops.push({ type: 'upsert_link', link: cloneJson(link, link) });
        }
    });

    previous.links.forEach((link) => {
        if (!nextLinks.has(link.id)) {
            ops.push({ type: 'delete_link', id: link.id });
        }
    });

    return ops;
}

export function diffPointOpsWithoutRealtimeText(previousPayload, nextPayload) {
    const previous = canonicalizePointPayload(previousPayload);
    const next = canonicalizePointPayload(nextPayload);
    const previousComparable = stripPointRealtimeTextFields(previous);
    const nextComparable = stripPointRealtimeTextFields(next);
    const ops = [];

    if (!valuesEqual(previous.meta, next.meta)) {
        ops.push({ type: 'set_meta', meta: cloneJson(next.meta, {}) });
    }

    if (!valuesEqual(previous.physicsSettings, next.physicsSettings)) {
        ops.push({ type: 'set_physics', physicsSettings: cloneJson(next.physicsSettings, {}) });
    }

    const previousNodes = new Map(previousComparable.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(nextComparable.nodes.map((node) => [node.id, node]));
    const nextFullNodes = new Map(next.nodes.map((node) => [node.id, node]));

    nextComparable.nodes.forEach((node) => {
        const previousNode = previousNodes.get(node.id);
        if (!previousNode || !valuesEqual(previousNode, node)) {
            const fullNode = nextFullNodes.get(node.id);
            if (fullNode) {
                ops.push({ type: 'upsert_node', node: cloneJson(fullNode, fullNode) });
            }
        }
    });

    previousComparable.nodes.forEach((node) => {
        if (!nextNodes.has(node.id)) {
            ops.push({ type: 'delete_node', id: node.id });
        }
    });

    const previousLinks = new Map(previous.links.map((link) => [link.id, link]));
    const nextLinks = new Map(next.links.map((link) => [link.id, link]));

    next.links.forEach((link) => {
        const previousLink = previousLinks.get(link.id);
        if (!previousLink || !valuesEqual(previousLink, link)) {
            ops.push({ type: 'upsert_link', link: cloneJson(link, link) });
        }
    });

    previous.links.forEach((link) => {
        if (!nextLinks.has(link.id)) {
            ops.push({ type: 'delete_link', id: link.id });
        }
    });

    return ops;
}

export function preservePointRealtimeTextInOps(snapshot, ops = []) {
    const current = canonicalizePointPayload(snapshot);
    const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));

    return (Array.isArray(ops) ? ops : []).map((operation) => {
        const type = String(operation?.type || '').trim();
        if (type !== 'upsert_node') {
            return cloneJson(operation, operation);
        }

        const node = normalizeNode(operation.node);
        if (!node) {
            return cloneJson(operation, operation);
        }

        const currentNode = currentNodes.get(node.id);
        if (currentNode) {
            POINT_REALTIME_TEXT_FIELDS.forEach((fieldName) => {
                node[fieldName] = currentNode[fieldName];
            });
        }

        return {
            ...cloneJson(operation, operation),
            node: cloneJson(node, node)
        };
    });
}

export function applyPointOps(snapshot, ops = []) {
    const next = canonicalizePointPayload(snapshot);
    const nodeMap = new Map(next.nodes.map((node) => [node.id, node]));
    const linkMap = new Map(next.links.map((link) => [link.id, link]));

    (Array.isArray(ops) ? ops : []).forEach((operation) => {
        const type = String(operation?.type || '').trim();
        if (type === 'set_meta') {
            next.meta = normalizeMeta(operation.meta);
            return;
        }
        if (type === 'set_physics') {
            next.physicsSettings = operation.physicsSettings && typeof operation.physicsSettings === 'object'
                ? cloneJson(operation.physicsSettings, {})
                : {};
            return;
        }
        if (type === 'upsert_node') {
            const node = normalizeNode(operation.node);
            if (node) nodeMap.set(node.id, node);
            return;
        }
        if (type === 'delete_node') {
            const nodeId = String(operation.id || '').trim();
            if (!nodeId) return;
            nodeMap.delete(nodeId);
            [...linkMap.values()].forEach((link) => {
                if (link.source === nodeId || link.target === nodeId) {
                    linkMap.delete(link.id);
                }
            });
            return;
        }
        if (type === 'upsert_link') {
            const link = normalizeLink(operation.link);
            if (link && nodeMap.has(link.source) && nodeMap.has(link.target)) {
                linkMap.set(link.id, link);
            }
            return;
        }
        if (type === 'delete_link') {
            const linkId = String(operation.id || '').trim();
            if (linkId) linkMap.delete(linkId);
        }
    });

    next.nodes = sortById([...nodeMap.values()]);
    next.links = sortById([...linkMap.values()]);
    return next;
}
