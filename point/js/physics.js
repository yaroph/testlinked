import { state } from './state.js';
import { KINDS, TYPES } from './constants.js';
import { nodeRadius, draw, scheduleDraw } from './render.js';
import { clamp, getId } from './utils.js';

let simulation;

function getD3() {
    if (typeof globalThis !== 'undefined' && globalThis.d3) return globalThis.d3;
    if (typeof window !== 'undefined' && window.d3) return window.d3;
    return null;
}

const SOCIAL_LINK_KINDS = new Set([
    KINDS.FAMILLE,
    KINDS.COUPLE,
    KINDS.AMOUR,
    KINDS.AMI,
    KINDS.CONNAISSANCE
]);

const BUSINESS_LINK_KINDS = new Set([
    KINDS.PATRON,
    KINDS.HAUT_GRADE,
    KINDS.EMPLOYE,
    KINDS.COLLEGUE,
    KINDS.PARTENAIRE,
    KINDS.AFFILIATION,
    KINDS.MEMBRE,
    KINDS.RELATION,
    KINDS.RIVAL
]);

const HOSTILE_LINK_KINDS = new Set([KINDS.ENNEMI, KINDS.RIVAL]);
const COMPANY_LAYOUT_KINDS = new Set([
    KINDS.PATRON,
    KINDS.HAUT_GRADE,
    KINDS.EMPLOYE,
    KINDS.COLLEGUE,
    KINDS.PARTENAIRE,
    KINDS.AFFILIATION,
    KINDS.MEMBRE,
    KINDS.RELATION,
    KINDS.RIVAL
]);
const GROUP_LAYOUT_KINDS = new Set([
    KINDS.MEMBRE,
    KINDS.AFFILIATION,
    KINDS.FAMILLE,
    KINDS.AMI,
    KINDS.CONNAISSANCE,
    KINDS.COLLEGUE,
    KINDS.RELATION,
    KINDS.ENNEMI,
    KINDS.RIVAL
]);

function numSetting(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stableUnit(seed) {
    const text = String(seed || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function stableAngle(seed, offset = 0) {
    return (stableUnit(seed) * Math.PI * 2) + offset;
}

function nudgeNodeTowards(node, targetX, targetY, alpha, strength) {
    if (!node || node.fx != null || node.fy != null) return;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    node.vx += (targetX - node.x) * strength * alpha;
    node.vy += (targetY - node.y) * strength * alpha;
}

function pushNodeToRing(node, radius, alpha, strength, salt = '') {
    const angle = stableAngle(`${salt}:${node?.id || ''}`);
    nudgeNodeTowards(node, Math.cos(angle) * radius, Math.sin(angle) * radius, alpha, strength);
}

function pushNodeToAngle(node, radius, angle, alpha, strength) {
    nudgeNodeTowards(node, Math.cos(angle) * radius, Math.sin(angle) * radius, alpha, strength);
}

function pushNodeToOrbit(node, anchor, radius, alpha, strength, salt = '') {
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    const angle = stableAngle(`${salt}:${node?.id || ''}:${anchor.id || ''}`);
    const targetX = anchor.x + (Math.cos(angle) * radius);
    const targetY = anchor.y + (Math.sin(angle) * radius);
    nudgeNodeTowards(node, targetX, targetY, alpha, strength);
}

function addAssociationScore(targetMap, nodeId, structureId, weight = 1) {
    const cleanNodeId = String(nodeId || '');
    const cleanStructureId = String(structureId || '');
    if (!cleanNodeId || !cleanStructureId || cleanNodeId === cleanStructureId) return;
    let nodeScores = targetMap.get(cleanNodeId);
    if (!nodeScores) {
        nodeScores = new Map();
        targetMap.set(cleanNodeId, nodeScores);
    }
    nodeScores.set(cleanStructureId, (nodeScores.get(cleanStructureId) || 0) + weight);
}

function resolveStrongestAssociations(scoreMap, nodeMap) {
    const resolved = new Map();
    scoreMap.forEach((scores, nodeId) => {
        let bestId = '';
        let bestScore = -Infinity;
        scores.forEach((score, structureId) => {
            if (score > bestScore && nodeMap.has(structureId)) {
                bestScore = score;
                bestId = structureId;
            }
        });
        if (bestId) {
            resolved.set(nodeId, nodeMap.get(bestId));
        }
    });
    return resolved;
}

function buildSectorAngles(nodes = [], salt = '') {
    const cleanNodes = [...nodes].sort((a, b) => String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || '')));
    const total = Math.max(1, cleanNodes.length);
    const offset = stableAngle(`${salt}:offset`);
    const angleMap = new Map();
    cleanNodes.forEach((node, index) => {
        angleMap.set(String(node.id), offset + ((index / total) * Math.PI * 2));
    });
    return angleMap;
}

function createPresetLayoutForce(nodes, links, nodeMap) {
    const presetId = String(state.physicsSettings?.presetId || 'standard');
    if (!nodes.length || presetId === 'standard' || presetId === 'custom') return null;

    const nodeSignals = new Map(nodes.map((node) => [String(node.id), {
        hostile: 0,
        social: 0,
        business: 0
    }]));
    const companyScores = new Map();
    const groupScores = new Map();

    const bumpSignal = (nodeId, key) => {
        const signal = nodeSignals.get(String(nodeId || ''));
        if (!signal) return;
        signal[key] += 1;
    };

    links.forEach((link) => {
        const sourceId = getId(link.source);
        const targetId = getId(link.target);
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (!sourceNode || !targetNode) return;

        const kind = String(link.kind || '');
        if (HOSTILE_LINK_KINDS.has(kind)) {
            bumpSignal(sourceId, 'hostile');
            bumpSignal(targetId, 'hostile');
        }
        if (SOCIAL_LINK_KINDS.has(kind)) {
            bumpSignal(sourceId, 'social');
            bumpSignal(targetId, 'social');
        }
        if (BUSINESS_LINK_KINDS.has(kind) || kind === KINDS.AFFILIATION || kind === KINDS.MEMBRE) {
            bumpSignal(sourceId, 'business');
            bumpSignal(targetId, 'business');
        }

        let associationWeight = 1;
        if (kind === KINDS.MEMBRE) associationWeight = 3;
        else if (kind === KINDS.AFFILIATION) associationWeight = 2.4;
        else if (kind === KINDS.PATRON || kind === KINDS.HAUT_GRADE || kind === KINDS.EMPLOYE) associationWeight = 1.9;
        else if (kind === KINDS.PARTENAIRE || kind === KINDS.COLLEGUE) associationWeight = 1.35;

        if (sourceNode.type === TYPES.COMPANY && COMPANY_LAYOUT_KINDS.has(kind)) {
            addAssociationScore(companyScores, targetId, sourceId, associationWeight);
        }
        if (targetNode.type === TYPES.COMPANY && COMPANY_LAYOUT_KINDS.has(kind)) {
            addAssociationScore(companyScores, sourceId, targetId, associationWeight);
        }
        if (sourceNode.type === TYPES.GROUP && GROUP_LAYOUT_KINDS.has(kind)) {
            addAssociationScore(groupScores, targetId, sourceId, associationWeight);
        }
        if (targetNode.type === TYPES.GROUP && GROUP_LAYOUT_KINDS.has(kind)) {
            addAssociationScore(groupScores, sourceId, targetId, associationWeight);
        }
    });

    const companyNodes = nodes.filter((node) => node.type === TYPES.COMPANY);
    const groupNodes = nodes.filter((node) => node.type === TYPES.GROUP);
    const companyAngles = buildSectorAngles(companyNodes, 'company-sector');
    const groupAngles = buildSectorAngles(groupNodes, 'group-sector');
    const companyAnchors = resolveStrongestAssociations(companyScores, nodeMap);
    const groupAnchors = resolveStrongestAssociations(groupScores, nodeMap);

    companyNodes.forEach((node) => companyAnchors.set(String(node.id), node));
    groupNodes.forEach((node) => groupAnchors.set(String(node.id), node));

    const hasHostileNodes = [...nodeSignals.values()].some((signal) => signal.hostile > 0);
    const hasSocialNodes = [...nodeSignals.values()].some((signal) => signal.social > 0);
    if ((presetId === 'enemy_near' || presetId === 'enemy_far') && !hasHostileNodes) return null;
    if (presetId === 'friends_close' && !hasSocialNodes) return null;
    if ((presetId === 'companies_far') && !companyNodes.length) return null;
    if ((presetId === 'groups_far' || presetId === 'group_cluster') && !groupNodes.length) return null;

    return (alpha) => {
        if (alpha <= 0) return;
        if (String(state.physicsSettings?.presetId || presetId) !== presetId) return;

        nodes.forEach((node) => {
            const nodeId = String(node.id);
            const signal = nodeSignals.get(nodeId) || { hostile: 0, social: 0, business: 0 };

            if (presetId === 'enemy_near') {
                if (signal.hostile > 0) {
                    const radius = node.type === TYPES.COMPANY ? 420 : (node.type === TYPES.GROUP ? 320 : 220);
                    pushNodeToRing(node, radius, alpha, 0.24, 'enemy-near-core');
                    return;
                }
                const radius = node.type === TYPES.COMPANY ? 2350 : (node.type === TYPES.GROUP ? 1820 : 1480);
                pushNodeToRing(node, radius + (stableUnit(`enemy-near:${nodeId}`) * 180), alpha, 0.18, 'enemy-near-outer');
                return;
            }

            if (presetId === 'enemy_far') {
                if (signal.hostile > 0) {
                    const radius = node.type === TYPES.COMPANY ? 2400 : (node.type === TYPES.GROUP ? 2140 : 1920);
                    pushNodeToRing(node, radius + (stableUnit(`enemy-far:${nodeId}`) * 140), alpha, 0.2, 'enemy-far-hostile');
                    return;
                }
                const radius = node.type === TYPES.COMPANY ? 1280 : (node.type === TYPES.GROUP ? 1120 : 920);
                pushNodeToRing(node, radius + (stableUnit(`enemy-far-neutral:${nodeId}`) * 120), alpha, 0.12, 'enemy-far-neutral');
                return;
            }

            if (presetId === 'friends_close') {
                if (signal.social > 0) {
                    const radius = node.type === TYPES.COMPANY ? 620 : (node.type === TYPES.GROUP ? 340 : 200);
                    pushNodeToRing(node, radius + (stableUnit(`social-core:${nodeId}`) * 70), alpha, 0.22, 'social-core');
                    return;
                }
                const radius = node.type === TYPES.COMPANY ? 1900 : (node.type === TYPES.GROUP ? 1420 : 1120);
                pushNodeToRing(node, radius + (stableUnit(`social-outer:${nodeId}`) * 140), alpha, 0.15, 'social-outer');
                return;
            }

            if (presetId === 'group_cluster') {
                if (node.type === TYPES.GROUP) {
                    const angle = groupAngles.get(nodeId);
                    if (typeof angle === 'number') pushNodeToAngle(node, 760, angle, alpha, 0.24);
                    return;
                }
                const anchor = groupAnchors.get(nodeId);
                if (anchor && anchor.id !== node.id) {
                    const orbitRadius = node.type === TYPES.COMPANY ? 320 : 190;
                    pushNodeToOrbit(node, anchor, orbitRadius + (stableUnit(`group-cluster:${nodeId}`) * 48), alpha, 0.28, 'group-cluster');
                    return;
                }
                const radius = node.type === TYPES.COMPANY ? 1480 : 1020;
                pushNodeToRing(node, radius, alpha, 0.13, 'group-cluster-outer');
                return;
            }

            if (presetId === 'companies_far') {
                if (node.type === TYPES.COMPANY) {
                    const angle = companyAngles.get(nodeId);
                    if (typeof angle === 'number') pushNodeToAngle(node, 2140, angle, alpha, 0.26);
                    return;
                }
                const anchor = companyAnchors.get(nodeId);
                if (anchor && anchor.id !== node.id) {
                    const orbitRadius = node.type === TYPES.GROUP ? 360 : 250;
                    pushNodeToOrbit(node, anchor, orbitRadius + (stableUnit(`company-orbit:${nodeId}`) * 62), alpha, 0.26, 'company-orbit');
                    return;
                }
                const radius = signal.business > 0 ? 1220 : 900;
                pushNodeToRing(node, radius + (stableUnit(`company-mid:${nodeId}`) * 110), alpha, 0.14, 'company-mid');
                return;
            }

            if (presetId === 'groups_far') {
                if (node.type === TYPES.GROUP) {
                    const angle = groupAngles.get(nodeId);
                    if (typeof angle === 'number') pushNodeToAngle(node, 1980, angle, alpha, 0.25);
                    return;
                }
                const anchor = groupAnchors.get(nodeId);
                if (anchor && anchor.id !== node.id) {
                    const orbitRadius = node.type === TYPES.COMPANY ? 360 : 215;
                    pushNodeToOrbit(node, anchor, orbitRadius + (stableUnit(`groups-far:${nodeId}`) * 56), alpha, 0.24, 'groups-far');
                    return;
                }
                const radius = node.type === TYPES.COMPANY ? 1280 : 980;
                pushNodeToRing(node, radius, alpha, 0.13, 'groups-far-outer');
            }
        });
    };
}

function getLinkDistance(link, settings) {
    const base = numSetting(settings.linkLength, 220);
    const socialMult = numSetting(settings.socialLinkDistanceMult, 0.78);
    const businessMult = numSetting(settings.businessLinkDistanceMult, 1.08);

    if (link.kind === KINDS.AFFILIATION) return base * Math.max(1.35, businessMult * 1.45);
    if (link.kind === KINDS.PATRON) return base * 0.3 * businessMult;
    if (link.kind === KINDS.HAUT_GRADE) return base * 0.5 * businessMult;
    if (link.kind === KINDS.EMPLOYE) return base * 0.9 * businessMult;
    if (link.kind === KINDS.COLLEGUE) return base * 0.95 * businessMult;
    if (link.kind === KINDS.PARTENAIRE) return base * 1.02 * businessMult;
    if (link.kind === KINDS.MEMBRE) return base * 1.08 * businessMult;
    if (link.kind === KINDS.RELATION) return base * 1.1 * businessMult;
    if (SOCIAL_LINK_KINDS.has(link.kind)) {
        if (link.kind === KINDS.CONNAISSANCE) return base * Math.min(1.1, socialMult + 0.18);
        return base * socialMult;
    }
    if (BUSINESS_LINK_KINDS.has(link.kind)) return base * businessMult;
    return base;
}

function getLinkStrength(link, settings) {
    const socialStrength = clamp(numSetting(settings.socialLinkStrength, 0.34), 0.05, 1.4);
    const businessStrength = clamp(numSetting(settings.businessLinkStrength, 0.26), 0.05, 1.2);

    if (link.kind === KINDS.PATRON) return clamp(Math.max(0.45, businessStrength * 2.2), 0.05, 1.4);
    if (link.kind === KINDS.HAUT_GRADE) return clamp(Math.max(0.34, businessStrength * 1.6), 0.05, 1.3);
    if (link.kind === KINDS.EMPLOYE) return clamp(Math.max(0.24, businessStrength * 1.1), 0.05, 1.1);
    if (link.kind === KINDS.COLLEGUE) return clamp(businessStrength * 0.95, 0.05, 1.1);
    if (link.kind === KINDS.AFFILIATION || link.kind === KINDS.MEMBRE) return clamp(businessStrength * 0.74, 0.05, 1.0);
    if (link.kind === KINDS.PARTENAIRE || link.kind === KINDS.RELATION || link.kind === KINDS.RIVAL) {
        return clamp(businessStrength * 0.88, 0.05, 1.0);
    }
    if (SOCIAL_LINK_KINDS.has(link.kind)) {
        if (link.kind === KINDS.CONNAISSANCE) return clamp(socialStrength * 0.72, 0.05, 1.1);
        return socialStrength;
    }
    return 0.25;
}

export function initPhysics() {
    const d3lib = getD3();
    if (!d3lib?.forceSimulation) {
        simulation = null;
        return null;
    }

    simulation = d3lib.forceSimulation()
        .alphaDecay(0.01) 
        .velocityDecay(state.physicsSettings.friction) 
        .on("tick", ticked);
    return simulation;
}

function ticked() {
    if (state.forceSimulation) return; 
    scheduleDraw();
}

export function restartSim() {
    if (!simulation && !initPhysics()) {
        draw();
        return;
    }
    const d3lib = getD3();
    if (!simulation || !d3lib) {
        draw();
        return;
    }
    
    // MAJ de la friction depuis les réglages
    simulation.velocityDecay(state.physicsSettings.friction);

    simulation.nodes(state.nodes);
    
    const nodeDegree = new Map();
    const connectedPairs = new Set();
    const nodeMap = new Map();
    let maxDegree = 0;

    state.nodes.forEach((n) => {
        nodeDegree.set(n.id, 0);
        nodeMap.set(String(n.id), n);
    });
    state.links.forEach(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        nodeDegree.set(s, (nodeDegree.get(s) || 0) + 1);
        nodeDegree.set(t, (nodeDegree.get(t) || 0) + 1);
        connectedPairs.add(`${s}-${t}`);
        connectedPairs.add(`${t}-${s}`);
    });
    nodeDegree.forEach(v => { if (v > maxDegree) maxDegree = v; });

    const S = state.physicsSettings; // Raccourci pour accéder aux sliders
    const nodeCount = state.nodes.length || 1;
    const linkCount = state.links.filter(l => l.kind !== KINDS.ENNEMI).length;
    const avgDegree = (nodeCount > 0) ? (2 * linkCount) / nodeCount : 0;
    const densityBoost = clamp((avgDegree - 3) / 8, 0, 1.5);
    const adaptiveCollision = S.collision * (1 + densityBoost);
    const adaptiveRepulsion = S.repulsion * (1 + densityBoost * 0.7);

    // 1. LIENS
    simulation.force("link", d3lib.forceLink(state.links)
        .id(d => d.id)
        .distance(l => {
            if (l.kind === KINDS.ENNEMI) return 0; 
            return getLinkDistance(l, S);
        })
        .strength(l => {
            if (l.kind === KINDS.ENNEMI) return 0; 
            return getLinkStrength(l, S);
        })
    );

    // 2. GRAVITÉ CENTRALE (Slider: Gravity)
    simulation.force("gravityX", d3lib.forceX(0).strength(S.gravity));
    simulation.force("gravityY", d3lib.forceY(0).strength(S.gravity));

    // 3. ENNEMIS (Utilise le NOUVEAU Slider: enemyForce)
    const enemyRepulsion = (alpha) => {
        state.links.forEach(l => {
            if (l.kind !== KINDS.ENNEMI) return;
            const s = l.source; const t = l.target;
            if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y) || !Number.isFinite(t?.x) || !Number.isFinite(t?.y)) return;

            const isBigS = (s.type === TYPES.COMPANY || s.type === TYPES.GROUP);
            const isBigT = (t.type === TYPES.COMPANY || t.type === TYPES.GROUP);
            const enemyDistanceMultiplier = numSetting(S.enemyDistanceMultiplier, 1.0);
            
            let hateRadius = 900; 
            
            // Le slider définit la "Force de base", on l'amplifie selon la taille
            let forceMultiplier = S.enemyForce / 50; // Normalisation (ex: 300 / 50 = 6)

            if (isBigS && isBigT) { 
                hateRadius = 5000; // Guerre totale
                forceMultiplier *= 10; // Très violent
            } 
            else if (isBigS || isBigT) { 
                hateRadius = 2500; 
                forceMultiplier *= 2;
            }
            hateRadius *= enemyDistanceMultiplier;

            let dx = t.x - s.x || (Math.random() - 0.5);
            let dy = t.y - s.y || (Math.random() - 0.5);
            let distSq = dx*dx + dy*dy; 
            const dist = Math.sqrt(distSq);
            
            if (dist < hateRadius) {
                const strength = (hateRadius - dist) / hateRadius; 
                const force = strength * alpha * forceMultiplier; 
                const fx = (dx / dist) * force; const fy = (dy / dist) * force;
                t.vx += fx; t.vy += fy; s.vx -= fx; s.vy -= fy;
            }
        });
    };
    simulation.force("enemyRepulsion", enemyRepulsion);

    // 4. CHARGE GLOBALE (Slider: Repulsion)
    simulation.force("charge", d3lib.forceManyBody()
        .strength(n => {
            let strength = -adaptiveRepulsion; 
            if (n.type === TYPES.COMPANY) strength *= numSetting(S.companyChargeMultiplier, 5);
            if (n.type === TYPES.GROUP) strength *= numSetting(S.groupChargeMultiplier, 3);
            const degree = nodeDegree.get(n.id) || 0;
            strength -= (degree * 150); 
            return strength;
        })
        .distanceMax(2000) 
        .distanceMin(50) 
    );

    // 5. COLLISION (Slider: Collision)
    simulation.force("collide", d3lib.forceCollide()
        .radius(n => nodeRadius(n) + adaptiveCollision) 
        .iterations(2)
    );

    // 6. BARRIÈRE (Gérée par l'état Globe)
    const worldRadius = 3800; 
    simulation.force("boundary", () => {
        if (!state.globeMode) return; 
        for (const n of state.nodes) {
            const d = Math.sqrt(n.x * n.x + n.y * n.y);
            if (d > worldRadius) {
                const excess = d - worldRadius;
                const angle = Math.atan2(n.y, n.x);
                n.vx -= Math.cos(angle) * (excess * 0.1); 
                n.vy -= Math.sin(angle) * (excess * 0.1);
            }
        }
    });

    // 7. TERRITOIRE (Utilise le NOUVEAU Slider: structureRepulsion)
    simulation.force("territory", () => {
        const structures = state.nodes.filter(n => n.type === TYPES.COMPANY || n.type === TYPES.GROUP);
        for (const struct of structures) {
            const territoryRadius = (struct.type === TYPES.COMPANY)
                ? numSetting(S.companyTerritoryRadius, 450)
                : numSetting(S.groupTerritoryRadius, 350);
            for (const n of state.nodes) {
                if (n.id === struct.id || n.type === TYPES.COMPANY || n.type === TYPES.GROUP) continue;
                if (n.fx != null) continue;
                if (connectedPairs.has(`${n.id}-${struct.id}`)) continue; // Si connecté, le lien gère la distance

                const dx = n.x - struct.x; const dy = n.y - struct.y;
                const distSq = dx*dx + dy*dy; 
                const minDistSq = territoryRadius * territoryRadius;

                if (distSq < minDistSq) {
                    const dist = Math.sqrt(distSq);
                    // Ici on utilise le slider "Force Repousse Entreprise"
                    const push = (territoryRadius - dist) * S.structureRepulsion; 
                    
                    const angle = Math.atan2(dy, dx);
                    n.vx += Math.cos(angle) * push; n.vy += Math.sin(angle) * push;
                }
            }
        }
    });

    // 8. HUB HVT (ramener les noyaux vers le centre sans les coller)
    simulation.force("hub", (alpha) => {
        if (!state.nodes.length) return;
        const hubs = state.nodes
            .map(n => {
                const degree = nodeDegree.get(n.id) || 0;
                const fallback = (maxDegree > 0) ? (degree / maxDegree) : 0;
                const score = (typeof n.hvtScore === 'number') ? n.hvtScore : fallback;
                return { n, score };
            })
            .filter(h => h.score > 0.55)
            .sort((a, b) => b.score - a.score)
            .slice(0, 18);

        const pullStrength = 0.08;
        const repelRadius = 420;
        const repelStrength = 0.12;

        hubs.forEach(h => {
            const n = h.n;
            const s = h.score * alpha * pullStrength;
            n.vx += (-n.x) * s;
            n.vy += (-n.y) * s;
        });

        for (let i = 0; i < hubs.length; i++) {
            for (let j = i + 1; j < hubs.length; j++) {
                const a = hubs[i].n;
                const b = hubs[j].n;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist < repelRadius) {
                    const force = ((repelRadius - dist) / repelRadius) * repelStrength * alpha;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    a.vx -= fx; a.vy -= fy;
                    b.vx += fx; b.vy += fy;
                }
            }
        }
    });

    simulation.force("presetLayout", createPresetLayoutForce(state.nodes, state.links, nodeMap));

    simulation.alpha(1).restart();
}

export function getSimulation() { return simulation; }
