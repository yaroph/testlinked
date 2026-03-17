import { state, nodeById, pushHistory } from './state.js';
import { restartSim } from './physics.js';
import { uid, randomPastel, hexToRgb, rgbToHex, normalizePersonStatus, sanitizeNodeColor } from './utils.js';
import { TYPES, KINDS, PERSON_STATUS } from './constants.js';
import {
    DEFAULT_HVT_LINK_WEIGHTS,
    calculateHvtScores,
    selectHvtTopIds,
    calculateHvtInfluence
} from '../../shared/js/hvt-graph.mjs';

function personStatusPriority(status) {
    if (status === PERSON_STATUS.DECEASED) return 2;
    if (status === PERSON_STATUS.MISSING) return 1;
    return 0;
}

function updateHvtInfluenceFlow() {
    const influence = calculateHvtInfluence(state.nodes, state.links, {
        selectedSeedId: state.hvtSelectedId,
        topIds: state.hvtTopIds ? [...state.hvtTopIds] : [],
        scores: state.nodes.map((node) => ({ id: String(node.id), score: Number(node.hvtScore) || 0 })),
        linkWeights: DEFAULT_HVT_LINK_WEIGHTS,
        sanitizeColor: sanitizeNodeColor,
        hexToRgb,
        rgbToHex
    });

    state.nodes.forEach((node, index) => {
        const meta = influence.nodes[index] || {};
        node.hvtInfluence = Number(meta.influence) || 0;
        node.hvtInfluenceDepth = typeof meta.depth === 'number' ? meta.depth : null;
        node.hvtTintColor = String(meta.tintColor || '');
    });

    state.links.forEach((link, index) => {
        link.hvtInfluence = Number(influence.links[index]) || 0;
    });
}

export function calculateHVT() {
    const scores = calculateHvtScores(state.nodes, state.links, {
        linkWeights: DEFAULT_HVT_LINK_WEIGHTS,
        types: TYPES,
        normalizePersonStatus,
        personStatus: PERSON_STATUS
    });
    const scoreById = new Map(scores.map((entry) => [String(entry.id), Number(entry.score) || 0]));
    state.nodes.forEach((node) => {
        node.hvtScore = scoreById.get(String(node.id)) || 0;
    });

    updateHvtTopSet();
    updateHvtInfluenceFlow();
    state.hvtRenderVersion = (Number(state.hvtRenderVersion) || 0) + 1;
}

export function updateHvtTopSet() {
    const topN = Math.max(0, Number(state.hvtTopN) || 0);
    if (!state.hvtTopIds) state.hvtTopIds = new Set();
    state.hvtTopIds.clear();
    if (topN <= 0) return;
    selectHvtTopIds(
        state.nodes,
        state.nodes.map((node) => ({ id: String(node.id), score: Number(node.hvtScore) || 0 })),
        topN
    ).forEach((id) => state.hvtTopIds.add(id));
}

export function updatePersonColors() {
    const nodeWeights = new Map();
    state.links.forEach(l => {
        const sId = (typeof l.source === 'object') ? l.source.id : l.source;
        const tId = (typeof l.target === 'object') ? l.target.id : l.target;
        nodeWeights.set(sId, (nodeWeights.get(sId) || 0) + 1);
        nodeWeights.set(tId, (nodeWeights.get(tId) || 0) + 1);
    });

    state.nodes.forEach(n => {
        if (n.type === TYPES.PERSON) {
            if (n.manualColor) return;
            let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
            state.links.forEach(l => {
                const s = (typeof l.source === 'object') ? l.source : nodeById(l.source);
                const t = (typeof l.target === 'object') ? l.target : nodeById(l.target);
                if (!s || !t) return;
                let other = (s.id === n.id) ? t : ((t.id === n.id) ? s : null);
                if (!other) return;
                if (other.type !== TYPES.PERSON || other.color) {
                    const weight = (nodeWeights.get(other.id) || 1);
                    const rgb = hexToRgb(other.color || '#ffffff');
                    totalR += rgb.r * weight; totalG += rgb.g * weight; totalB += rgb.b * weight;
                    totalWeight += weight;
                }
            });
            if (totalWeight > 0) {
                n.color = rgbToHex(totalR / totalWeight, totalG / totalWeight, totalB / totalWeight);
            } else {
                n.color = '#ffffff';
            }
        }
    });
}

export function ensureNode(type, name) {
    let n = state.nodes.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!n) {
        pushHistory();
        const startX = (Math.random() - 0.5) * 50;
        const startY = (Math.random() - 0.5) * 50;
        n = {
            id: uid(), name, type,
            x: startX, y: startY, fx: startX, fy: startY, vx: 0, vy: 0,
            color: (type === TYPES.PERSON ? '#ffffff' : randomPastel()),
            manualColor: false,
            personStatus: PERSON_STATUS.ACTIVE,
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: '',
            notes: ''
        };
        state.nodes.push(n);
    }
    return n;
}

export function addLink(a, b, kind) {
    const A = (typeof a === 'object') ? a : nodeById(a);
    const B = (typeof b === 'object') ? b : nodeById(b);
    if (!A || !B || A.id === B.id) return false;

    if (!kind) {
        if (A.type === TYPES.PERSON && B.type === TYPES.PERSON) kind = KINDS.AMI;
        else if (A.type === TYPES.COMPANY || B.type === TYPES.COMPANY) kind = KINDS.EMPLOYE;
        else if (A.type === TYPES.GROUP || B.type === TYPES.GROUP) kind = KINDS.MEMBRE;
        else kind = KINDS.RELATION;
    }

    const exists = state.links.find(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        const samePair = (s === A.id && t === B.id) || (s === B.id && t === A.id);
        return samePair && l.kind === kind;
    });

    if (!exists) {
        pushHistory();
        state.links.push({ id: uid(), source: A.id, target: B.id, kind });
        if (kind === KINDS.PATRON) propagateOrgNums();

        if (A.fx !== undefined) A.fx = null; if (A.fy !== undefined) A.fy = null;
        if (B.fx !== undefined) B.fx = null; if (B.fy !== undefined) B.fy = null;

        updatePersonColors();
        restartSim();
        return true;
    }
    return false;
}

export function mergeNodes(sourceId, targetId) {
    if (sourceId === targetId) return;
    pushHistory();
    const sourceNode = nodeById(sourceId);
    const targetNode = nodeById(targetId);
    const linksToMove = state.links.filter(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        return s === sourceId || t === sourceId;
    });
    linksToMove.forEach(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        const otherId = (s === sourceId) ? t : s;
        if (otherId === targetId) return;
        const exists = state.links.find(ex => {
            const es = (typeof ex.source === 'object') ? ex.source.id : ex.source;
            const et = (typeof ex.target === 'object') ? ex.target.id : ex.target;
            const samePair = (es === targetId && et === otherId) || (es === otherId && et === targetId);
            return samePair && ex.kind === l.kind;
        });
        if (!exists) {
            state.links.push({ id: uid(), source: targetId, target: otherId, kind: l.kind });
        }
    });
    state.links = state.links.filter(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        return s !== sourceId && t !== sourceId;
    });
    if (sourceNode && targetNode && sourceNode.type === TYPES.PERSON && targetNode.type === TYPES.PERSON) {
        const sourceStatus = normalizePersonStatus(sourceNode.personStatus, sourceNode.type);
        const targetStatus = normalizePersonStatus(targetNode.personStatus, targetNode.type);
        if (personStatusPriority(sourceStatus) > personStatusPriority(targetStatus)) {
            targetNode.personStatus = sourceStatus;
        }
    }
    state.nodes = state.nodes.filter(n => n.id !== sourceId);
    updatePersonColors();
    restartSim();
}

export function propagateOrgNums() {
    for (const l of state.links) {
        if (l.kind !== KINDS.PATRON) continue;
        const srcId = (typeof l.source === 'object') ? l.source.id : l.source;
        const tgtId = (typeof l.target === 'object') ? l.target.id : l.target;
        const A = nodeById(srcId), B = nodeById(tgtId);
        if (!A || !B) continue;
        const person = (A.type === TYPES.PERSON) ? A : (B.type === TYPES.PERSON ? B : null);
        const org = (A.type !== TYPES.PERSON) ? A : (B.type !== TYPES.PERSON ? B : null);
        if (person && org && person.num) org.num = person.num;
    }
}

export function calculatePath(startId, endId) {
    if (!startId || !endId || startId === endId) return null;
    const queue = [[startId]];
    const visited = new Set([startId]);
    while (queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];
        if (node === endId) {
            const pathNodes = new Set(path);
            const pathLinks = new Set();
            for (let i = 0; i < path.length - 1; i++) {
                const u = path[i];
                const v = path[i + 1];
                const link = state.links.find(l => {
                    if (l.kind === KINDS.ENNEMI) return false;
                    const s = (typeof l.source === 'object') ? l.source.id : l.source;
                    const t = (typeof l.target === 'object') ? l.target.id : l.target;
                    return (s === u && t === v) || (s === v && t === u);
                });
                if (link) {
                    const s = (typeof link.source === 'object') ? link.source.id : link.source;
                    const t = (typeof link.target === 'object') ? link.target.id : link.target;
                    pathLinks.add(`${s}-${t}`);
                    pathLinks.add(`${t}-${s}`);
                }
            }
            return { pathNodes, pathLinks };
        }
        const neighbors = [];
        state.links.forEach(l => {
            if (l.kind === KINDS.ENNEMI) return;
            const s = (typeof l.source === 'object') ? l.source.id : l.source;
            const t = (typeof l.target === 'object') ? l.target.id : l.target;
            if (s === node && !visited.has(t)) neighbors.push(t);
            else if (t === node && !visited.has(s)) neighbors.push(s);
        });
        for (const neighbor of neighbors) {
            visited.add(neighbor);
            queue.push([...path, neighbor]);
        }
    }
    return null;
}

export function clearPath() {
    state.pathfinding.active = false;
    state.pathfinding.startId = null;
    state.pathfinding.pathNodes.clear();
    state.pathfinding.pathLinks.clear();
}
