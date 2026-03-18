export const DEFAULT_HVT_LINK_WEIGHTS = {
    patron: 2.6,
    haut_grade: 2.2,
    employe: 1.3,
    collegue: 1.0,
    partenaire: 1.7,
    famille: 1.1,
    couple: 1.2,
    amour: 1.1,
    ami: 0.9,
    ennemi: 1.8,
    rival: 1.6,
    connaissance: 0.6,
    affiliation: 1.4,
    membre: 1.0,
    relation: 0.5
};

function getLinkEndpointIds(link) {
    return {
        sourceId: String((typeof link?.source === 'object') ? link.source?.id : link?.source),
        targetId: String((typeof link?.target === 'object') ? link.target?.id : link?.target)
    };
}

function normalizeHvtEdgeWeight(kind, linkWeights = DEFAULT_HVT_LINK_WEIGHTS) {
    const base = linkWeights[kind] ?? 0.8;
    return Math.max(0.35, Math.min(1, base / 2.6));
}

export function mixInfluenceColors(baseColor, accentColor, baseWeight = 1, accentWeight = 1, options = {}) {
    const sanitizeColor = typeof options.sanitizeColor === 'function'
        ? options.sanitizeColor
        : (value) => String(value || '#ffffff');
    const hexToRgb = typeof options.hexToRgb === 'function'
        ? options.hexToRgb
        : (hex) => {
            const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
            return match
                ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
                : { r: 255, g: 255, b: 255 };
        };
    const rgbToHex = typeof options.rgbToHex === 'function'
        ? options.rgbToHex
        : (r, g, b) => {
            const toHex = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0');
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        };
    const safeBase = hexToRgb(sanitizeColor(baseColor));
    const safeAccent = hexToRgb(sanitizeColor(accentColor));
    const totalWeight = Math.max(0.001, Math.max(0, Number(baseWeight) || 0) + Math.max(0, Number(accentWeight) || 0));
    return rgbToHex(
        ((safeBase.r * baseWeight) + (safeAccent.r * accentWeight)) / totalWeight,
        ((safeBase.g * baseWeight) + (safeAccent.g * accentWeight)) / totalWeight,
        ((safeBase.b * baseWeight) + (safeAccent.b * accentWeight)) / totalWeight
    );
}

export function calculateHvtScores(nodes, links, options = {}) {
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const linkList = Array.isArray(links) ? links : [];
    const linkWeights = options.linkWeights || DEFAULT_HVT_LINK_WEIGHTS;
    const normalizeStatus = typeof options.normalizePersonStatus === 'function'
        ? options.normalizePersonStatus
        : (status) => status;
    const personStatus = options.personStatus || {};
    const types = options.types || {};
    const nodeById = new Map(nodeList.map((node) => [String(node?.id || ''), node]));
    const degrees = new Map();
    const weighted = new Map();
    let maxDegree = 0;
    let maxWeighted = 0;

    nodeList.forEach((node) => {
        degrees.set(String(node?.id || ''), 0);
        weighted.set(String(node?.id || ''), 0);
    });

    linkList.forEach((link) => {
        const { sourceId, targetId } = getLinkEndpointIds(link);
        degrees.set(sourceId, (degrees.get(sourceId) || 0) + 1);
        degrees.set(targetId, (degrees.get(targetId) || 0) + 1);

        const baseWeight = linkWeights[link?.kind] ?? 0.8;
        const sourceNode = nodeById.get(sourceId) || null;
        const targetNode = nodeById.get(targetId) || null;
        let sourceWeight = baseWeight;
        let targetWeight = baseWeight;

        if (targetNode?.type === types.COMPANY) sourceWeight *= 1.2;
        else if (targetNode?.type === types.GROUP) sourceWeight *= 1.1;
        if (sourceNode?.type === types.COMPANY) targetWeight *= 1.2;
        else if (sourceNode?.type === types.GROUP) targetWeight *= 1.1;

        weighted.set(sourceId, (weighted.get(sourceId) || 0) + sourceWeight);
        weighted.set(targetId, (weighted.get(targetId) || 0) + targetWeight);
    });

    degrees.forEach((value) => {
        if (value > maxDegree) maxDegree = value;
    });
    weighted.forEach((value) => {
        if (value > maxWeighted) maxWeighted = value;
    });

    return nodeList.map((node) => {
        const nodeId = String(node?.id || '');
        const degree = degrees.get(nodeId) || 0;
        const weight = weighted.get(nodeId) || 0;
        const degreeNorm = maxDegree > 0 ? (degree / maxDegree) : 0;
        const weightNorm = maxWeighted > 0 ? (weight / maxWeighted) : 0;
        let score = (degreeNorm * 0.6) + (weightNorm * 0.4);
        const normalizedStatus = normalizeStatus(node?.personStatus, node?.type);
        if (normalizedStatus === personStatus.MISSING) score *= 0.85;
        if (normalizedStatus === personStatus.INACTIVE) score *= 0.35;
        if (normalizedStatus === personStatus.DECEASED) score *= 0.35;
        return { id: nodeId, score };
    });
}

export function selectHvtTopIds(nodes, scores, topN) {
    const limit = Math.max(0, Number(topN) || 0);
    if (!limit) return [];
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const scoreById = new Map((Array.isArray(scores) ? scores : []).map((entry) => [String(entry?.id || ''), Number(entry?.score) || 0]));

    return [...nodeList]
        .map((node) => ({ id: String(node?.id || ''), score: scoreById.get(String(node?.id || '')) ?? (Number(node?.hvtScore) || 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.id);
}

export function calculateHvtInfluence(nodes, links, options = {}) {
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const linkList = Array.isArray(links) ? links : [];
    const linkWeights = options.linkWeights || DEFAULT_HVT_LINK_WEIGHTS;
    const sanitizeColor = typeof options.sanitizeColor === 'function'
        ? options.sanitizeColor
        : (value) => String(value || '#66f3ff');
    const scores = Array.isArray(options.scores) ? options.scores : [];
    const topIds = Array.isArray(options.topIds) ? options.topIds.map((id) => String(id)) : [];
    const scoreById = new Map(scores.map((entry) => [String(entry?.id || ''), Number(entry?.score) || 0]));
    const nodeById = new Map(nodeList.map((node) => [String(node?.id || ''), node]));
    const adjacency = new Map();
    const nodeMeta = new Map();
    const linkInfluence = new Array(linkList.length).fill(0);
    const ranked = [...nodeList].sort((left, right) => (scoreById.get(String(right?.id || '')) || 0) - (scoreById.get(String(left?.id || '')) || 0));
    const selectedSeedId = String(options.selectedSeedId || '').trim();
    const selectedSeedNode = selectedSeedId ? nodeById.get(selectedSeedId) : null;
    const seedIds = selectedSeedNode
        ? [selectedSeedId]
        : (topIds.length
            ? topIds
            : ranked
                .filter((node) => (scoreById.get(String(node?.id || '')) || 0) >= 0.55)
                .slice(0, 8)
                .map((node) => String(node?.id || '')));

    nodeList.forEach((node) => {
        const nodeId = String(node?.id || '');
        nodeMeta.set(nodeId, {
            id: nodeId,
            influence: 0,
            depth: null,
            tintColor: ''
        });
        adjacency.set(nodeId, []);
    });

    linkList.forEach((link, index) => {
        const { sourceId, targetId } = getLinkEndpointIds(link);
        if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
        if (!adjacency.has(targetId)) adjacency.set(targetId, []);
        const edgeWeight = normalizeHvtEdgeWeight(link?.kind, linkWeights);
        adjacency.get(sourceId).push({ otherId: targetId, linkIndex: index, edgeWeight });
        adjacency.get(targetId).push({ otherId: sourceId, linkIndex: index, edgeWeight });
    });

    if (!seedIds.length) {
        return {
            nodes: nodeList.map((node) => nodeMeta.get(String(node?.id || ''))),
            links: linkInfluence
        };
    }

    const queue = [];
    seedIds.forEach((seedId) => {
        const seedNode = nodeById.get(seedId);
        if (!seedNode) return;
        const seedInfluence = Math.max(0.58, scoreById.get(seedId) || 0);
        const tintColor = sanitizeColor(seedNode?.color || '#66f3ff');
        nodeMeta.set(seedId, {
            id: seedId,
            influence: seedInfluence,
            depth: 0,
            tintColor
        });
        queue.push({ id: seedId, influence: seedInfluence, depth: 0, tintColor });
    });

    while (queue.length) {
        const current = queue.shift();
        if (!current || current.depth >= 6 || current.influence < 0.08) continue;
        const neighbors = adjacency.get(current.id) || [];
        const currentNode = nodeById.get(current.id);
        const currentMeta = nodeMeta.get(current.id);
        const currentTintColor = sanitizeColor(
            current.tintColor
            || currentMeta?.tintColor
            || currentNode?.color
            || '#66f3ff'
        );

        neighbors.forEach(({ otherId, linkIndex, edgeWeight }) => {
            const nextDepth = current.depth + 1;
            const nextInfluence = current.influence * Math.min(0.9, 0.64 + (edgeWeight * 0.22));
            if (nextInfluence < 0.08) return;

            linkInfluence[linkIndex] = Math.max(linkInfluence[linkIndex] || 0, nextInfluence);

            const previousMeta = nodeMeta.get(otherId) || {
                id: otherId,
                influence: 0,
                depth: null,
                tintColor: ''
            };
            const previousInfluence = Number(previousMeta.influence) || 0;
            const previousDepth = typeof previousMeta.depth === 'number' ? previousMeta.depth : Infinity;
            const previousTintColor = String(previousMeta.tintColor || '').trim();
            const shouldUpdate = nextInfluence > (previousInfluence + 0.025)
                || (Math.abs(nextInfluence - previousInfluence) <= 0.025 && nextDepth < previousDepth)
                || !previousTintColor;

            if (!shouldUpdate) return;

            const tintColor = previousTintColor
                && Math.abs(nextInfluence - previousInfluence) <= 0.06
                && previousTintColor !== currentTintColor
                ? mixInfluenceColors(previousTintColor, currentTintColor, previousInfluence || 0.01, nextInfluence, options)
                : currentTintColor;
            nodeMeta.set(otherId, {
                id: otherId,
                influence: nextInfluence,
                depth: nextDepth,
                tintColor
            });
            queue.push({ id: otherId, influence: nextInfluence, depth: nextDepth, tintColor });
        });
    }

    linkList.forEach((link, index) => {
        const { sourceId, targetId } = getLinkEndpointIds(link);
        const sourceInfluence = Number(nodeMeta.get(sourceId)?.influence) || 0;
        const targetInfluence = Number(nodeMeta.get(targetId)?.influence) || 0;
        linkInfluence[index] = Math.max(
            Number(linkInfluence[index]) || 0,
            sourceInfluence * 0.88,
            targetInfluence * 0.88
        );
    });

    return {
        nodes: nodeList.map((node) => nodeMeta.get(String(node?.id || ''))),
        links: linkInfluence
    };
}
