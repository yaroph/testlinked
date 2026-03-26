import { cloneJson, sortById, valuesEqual } from './utils.mjs';
import { normalizePointPhysicsSettings } from '../js/point-physics-settings.mjs';

const POINT_REALTIME_TEXT_FIELDS = ['name', 'num', 'accountNumber', 'citizenNumber', 'description', 'notes'];
const POINT_NODE_FIELDS = ['name', 'type', 'color', 'manualColor', 'personStatus', 'num', 'accountNumber', 'citizenNumber', 'description', 'notes', 'x', 'y', 'fixed', 'linkedMapPointId'];
const POINT_NODE_STRUCTURAL_FIELDS = POINT_NODE_FIELDS.filter((fieldName) => !POINT_REALTIME_TEXT_FIELDS.includes(fieldName));
const POINT_LINK_FIELDS = ['source', 'target', 'kind'];
const POINT_PHYSICS_FIELDS = Object.keys(normalizePointPhysicsSettings());

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

function pickChangedFields(previousValue, nextValue, fieldNames = []) {
    const changes = {};
    fieldNames.forEach((fieldName) => {
        if (!valuesEqual(previousValue?.[fieldName], nextValue?.[fieldName])) {
            changes[fieldName] = cloneJson(nextValue?.[fieldName], nextValue?.[fieldName]);
        }
    });
    return changes;
}

function cleanNodePatch(changes = {}, options = {}) {
    const keepText = Boolean(options.keepText);
    const source = changes && typeof changes === 'object' ? changes : {};
    const cleaned = {};
    Object.entries(source).forEach(([fieldName, value]) => {
        if (!POINT_NODE_FIELDS.includes(fieldName)) return;
        if (!keepText && POINT_REALTIME_TEXT_FIELDS.includes(fieldName)) return;
        cleaned[fieldName] = cloneJson(value, value);
    });
    return cleaned;
}

function cleanLinkPatch(changes = {}) {
    const source = changes && typeof changes === 'object' ? changes : {};
    const cleaned = {};
    POINT_LINK_FIELDS.forEach((fieldName) => {
        if (Object.prototype.hasOwnProperty.call(source, fieldName)) {
            cleaned[fieldName] = cloneJson(source[fieldName], source[fieldName]);
        }
    });
    return cleaned;
}

function cleanPhysicsPatch(changes = {}) {
    const source = changes && typeof changes === 'object' ? changes : {};
    const cleaned = {};
    POINT_PHYSICS_FIELDS.forEach((fieldName) => {
        if (Object.prototype.hasOwnProperty.call(source, fieldName)) {
            cleaned[fieldName] = cloneJson(source[fieldName], source[fieldName]);
        }
    });
    return cleaned;
}

function normalizeNodePatchOperation(operation, options = {}) {
    const nodeId = String(operation?.id || operation?.nodeId || '').trim();
    if (!nodeId) return null;
    const changes = cleanNodePatch(operation?.changes, options);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        id: nodeId,
        changes
    };
}

function normalizeLinkPatchOperation(operation) {
    const linkId = String(operation?.id || operation?.linkId || '').trim();
    if (!linkId) return null;
    const changes = cleanLinkPatch(operation?.changes);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        id: linkId,
        changes
    };
}

function normalizePhysicsPatchOperation(operation) {
    const changes = cleanPhysicsPatch(operation?.changes);
    if (!Object.keys(changes).length) return null;
    return {
        ...cloneJson(operation, operation),
        changes
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

function diffPointOpsInternal(previousPayload, nextPayload, options = {}) {
    const includeRealtimeText = options.includeRealtimeText !== false;
    const previous = canonicalizePointPayload(previousPayload);
    const next = canonicalizePointPayload(nextPayload);
    const ops = [];

    if (!valuesEqual(previous.meta, next.meta)) {
        ops.push({ type: 'set_meta', meta: cloneJson(next.meta, {}) });
    }

    if (!valuesEqual(previous.physicsSettings, next.physicsSettings)) {
        const physicsChanges = pickChangedFields(previous.physicsSettings, next.physicsSettings, POINT_PHYSICS_FIELDS);
        if (Object.keys(physicsChanges).length === POINT_PHYSICS_FIELDS.length) {
            ops.push({ type: 'set_physics', physicsSettings: cloneJson(next.physicsSettings, {}) });
        } else if (Object.keys(physicsChanges).length) {
            ops.push({ type: 'patch_physics', changes: physicsChanges });
        }
    }

    const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));

    next.nodes.forEach((node) => {
        const previousNode = previousNodes.get(node.id);
        if (!previousNode) {
            ops.push({ type: 'create_node', node: cloneJson(node, node) });
            return;
        }
        const patch = pickChangedFields(
            previousNode,
            node,
            includeRealtimeText ? POINT_NODE_FIELDS : POINT_NODE_STRUCTURAL_FIELDS
        );
        if (Object.keys(patch).length) {
            ops.push({ type: 'patch_node', id: node.id, changes: patch });
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
        if (!previousLink) {
            ops.push({ type: 'create_link', link: cloneJson(link, link) });
            return;
        }
        const patch = pickChangedFields(previousLink, link, POINT_LINK_FIELDS);
        if (Object.keys(patch).length) {
            ops.push({ type: 'patch_link', id: link.id, changes: patch });
        }
    });

    previous.links.forEach((link) => {
        if (!nextLinks.has(link.id)) {
            ops.push({ type: 'delete_link', id: link.id });
        }
    });

    return ops;
}

export function diffPointOps(previousPayload, nextPayload) {
    return diffPointOpsInternal(previousPayload, nextPayload, { includeRealtimeText: true });
}

export function diffPointOpsWithoutRealtimeText(previousPayload, nextPayload) {
    return diffPointOpsInternal(previousPayload, nextPayload, { includeRealtimeText: false });
}

export function preservePointRealtimeTextInOps(snapshot, ops = []) {
    const current = canonicalizePointPayload(snapshot);
    const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));

    return (Array.isArray(ops) ? ops : []).map((operation) => {
        const type = String(operation?.type || '').trim();
        if (type === 'patch_node') {
            return normalizeNodePatchOperation(operation, { keepText: false });
        }
        if (type === 'patch_link') {
            return normalizeLinkPatchOperation(operation);
        }
        if (type === 'patch_physics') {
            return normalizePhysicsPatchOperation(operation);
        }
        if (type !== 'upsert_node' && type !== 'create_node') {
            return cloneJson(operation, operation);
        }

        const node = normalizeNode(operation.node);
        if (!node) {
            return null;
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
    }).filter(Boolean);
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
        if (type === 'patch_physics') {
            const patch = cleanPhysicsPatch(operation.changes);
            if (!Object.keys(patch).length) return;
            next.physicsSettings = normalizePointPhysicsSettings({
                ...next.physicsSettings,
                ...patch
            });
            return;
        }
        if (type === 'create_node') {
            const node = normalizeNode(operation.node);
            if (node) nodeMap.set(node.id, node);
            return;
        }
        if (type === 'patch_node') {
            const patchOp = normalizeNodePatchOperation(operation, { keepText: true });
            if (!patchOp) return;
            const currentNode = nodeMap.get(patchOp.id);
            if (!currentNode) return;
            const nextNode = normalizeNode({
                ...currentNode,
                ...patchOp.changes,
                id: patchOp.id
            });
            if (nextNode) nodeMap.set(nextNode.id, nextNode);
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
        if (type === 'create_link') {
            const link = normalizeLink(operation.link);
            if (link && nodeMap.has(link.source) && nodeMap.has(link.target)) {
                linkMap.set(link.id, link);
            }
            return;
        }
        if (type === 'patch_link') {
            const patchOp = normalizeLinkPatchOperation(operation);
            if (!patchOp) return;
            const currentLink = linkMap.get(patchOp.id);
            if (!currentLink) return;
            const link = normalizeLink({
                ...currentLink,
                ...patchOp.changes,
                id: patchOp.id
            });
            if (link && nodeMap.has(link.source) && nodeMap.has(link.target)) {
                linkMap.set(link.id, link);
            }
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
