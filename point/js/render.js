import { state, isGroup, isCompany, nodeById } from './state.js';
import { NODE_BASE_SIZE, DEG_SCALE, R_MIN, R_MAX, LINK_KIND_EMOJI, TYPES, KINDS, FILTERS, FILTER_RULES, PERSON_STATUS } from './constants.js';
import { computeLinkColor, sanitizeNodeColor, normalizePersonStatus, hexToRgb, rgbToHex } from './utils.js';

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const container = document.getElementById('center'); 

function updateZoomDisplay(scale) {
    const zoomValue = document.getElementById('zoomDisplay');
    const zoomFill = document.getElementById('zoomDisplayFill');
    const safeScale = Math.max(0.1, Number(scale || 1));
    const percentText = `${Math.round(safeScale * 100)}%`;
    const minScale = 0.1;
    const maxScale = 5;
    const ratio = Math.max(0, Math.min(1, Math.log(safeScale / minScale) / Math.log(maxScale / minScale)));

    if (zoomValue && zoomValue.textContent !== percentText) {
        zoomValue.textContent = percentText;
    }
    if (zoomFill) {
        zoomFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
}

export function scheduleDraw() {
    if (drawFrameHandle) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        draw();
        return;
    }
    drawFrameHandle = window.requestAnimationFrame(() => {
        drawFrameHandle = 0;
        draw();
    });
}

const degreeCache = new Map();
const NODE_ICONS = { [TYPES.PERSON]: '👤', [TYPES.COMPANY]: '🏢', [TYPES.GROUP]: '👥' };
const LABEL_METRICS_CACHE = new Map();
const LABEL_METRICS_CACHE_MAX = 1600;
const HVT_NODE_VISUAL_CACHE = new Map();
const HVT_LINK_VISUAL_CACHE = new Map();
let hvtCacheVersion = -1;
let drawFrameHandle = 0;

function getLinkEndpointId(endpoint) {
    return (typeof endpoint === 'object') ? endpoint?.id : endpoint;
}

function pruneCache(map, maxEntries) {
    if (map.size <= maxEntries) return;
    const overflow = map.size - maxEntries;
    let removed = 0;
    for (const key of map.keys()) {
        map.delete(key);
        removed += 1;
        if (removed >= overflow) break;
    }
}

function getLabelMetrics(label, fontSize) {
    const roundedFontSize = Math.round(Number(fontSize || 0) * 10) / 10;
    const key = `${roundedFontSize}|${label}`;
    let cached = LABEL_METRICS_CACHE.get(key);
    if (!cached) {
        cached = { width: ctx.measureText(label).width };
        LABEL_METRICS_CACHE.set(key, cached);
        pruneCache(LABEL_METRICS_CACHE, LABEL_METRICS_CACHE_MAX);
    }
    return cached;
}

function getPersonStatusVisual(node) {
    const status = normalizePersonStatus(node?.personStatus, node?.type);
    if (status === PERSON_STATUS.MISSING) {
        return { status, accent: '#f4c35a', badge: '?', label: 'DISPARU' };
    }
    if (status === PERSON_STATUS.DECEASED) {
        return { status, accent: '#ff6b81', badge: 'X', label: 'MORT' };
    }
    return null;
}

function splitDisplayName(name) {
    const raw = String(name || '').trim().replace(/\s+/g, ' ');
    if (!raw) return [];
    return raw.split(' ');
}

function compactNodeLabel(node, scale) {
    const rawName = String(node?.name || '').trim().replace(/\s+/g, ' ');
    if (!rawName) return 'Sans nom';
    if (scale >= 0.62) return rawName;

    const parts = splitDisplayName(rawName);
    if (node?.type === TYPES.PERSON && parts.length >= 2) {
        const first = parts.slice(0, -1).join(' ');
        const last = parts.slice(-1).join('');
        if (scale < 0.34) {
            return `${first.charAt(0).toUpperCase()}. ${last}`.trim();
        }
        return `${first} ${last.charAt(0).toUpperCase()}.`;
    }

    const maxLength = scale < 0.34 ? 12 : 18;
    return rawName.length > maxLength ? `${rawName.slice(0, maxLength - 1)}…` : rawName;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function rgbaFromHex(color, alpha = 1) {
    const { r, g, b } = hexToRgb(sanitizeNodeColor(color));
    return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function blendHexColors(baseColor, accentColor, amount = 0.5) {
    const ratio = clamp01(amount);
    const base = hexToRgb(sanitizeNodeColor(baseColor));
    const accent = hexToRgb(sanitizeNodeColor(accentColor));
    return rgbToHex(
        Math.round(base.r + ((accent.r - base.r) * ratio)),
        Math.round(base.g + ((accent.g - base.g) * ratio)),
        Math.round(base.b + ((accent.b - base.b) * ratio))
    );
}

function createHvtInfluenceGradient(sourceX, sourceY, targetX, targetY, sourceColor, targetColor, sourceInfluence = 0, targetInfluence = 0, linkInfluence = 0) {
    try {
        const safeSourceInfluence = clamp01(sourceInfluence);
        const safeTargetInfluence = clamp01(targetInfluence);
        const safeLinkInfluence = clamp01(Math.max(linkInfluence, safeSourceInfluence, safeTargetInfluence));
        const totalInfluence = Math.max(0.001, safeSourceInfluence + safeTargetInfluence);
        const sourceWeight = clamp01(safeSourceInfluence / totalInfluence);
        const targetWeight = clamp01(safeTargetInfluence / totalInfluence);
        const sourceReach = clamp01(0.18 + (sourceWeight * 0.26) + (safeSourceInfluence * 0.18));
        const targetReach = clamp01(Math.max(sourceReach + 0.08, 0.82 - (targetWeight * 0.26) - (safeTargetInfluence * 0.18)));
        const innerAlpha = Math.min(0.96, 0.22 + (safeLinkInfluence * 0.62));
        const outerAlpha = Math.min(innerAlpha, 0.08 + (safeLinkInfluence * 0.38));
        const gradient = ctx.createLinearGradient(sourceX, sourceY, targetX, targetY);
        gradient.addColorStop(0, rgbaFromHex(sourceColor, outerAlpha));
        gradient.addColorStop(sourceReach, rgbaFromHex(sourceColor, innerAlpha));
        gradient.addColorStop(targetReach, rgbaFromHex(targetColor, innerAlpha));
        gradient.addColorStop(1, rgbaFromHex(targetColor, outerAlpha));
        return gradient;
    } catch (e) {
        return rgbaFromHex(sourceColor, 0.24 + (clamp01(linkInfluence) * 0.48));
    }
}

function pairKey(a, b) {
    const s = String(a);
    const t = String(b);
    return (s < t) ? `${s}|${t}` : `${t}|${s}`;
}

function quadraticPoint(p0, p1, p2, t) {
    const mt = 1 - t;
    const x = (mt * mt * p0.x) + (2 * mt * t * p1.x) + (t * t * p2.x);
    const y = (mt * mt * p0.y) + (2 * mt * t * p1.y) + (t * t * p2.y);
    return { x, y };
}

function ensureHvtVisualCache(topSet, hvtSeedNode) {
    const cacheVersion = Number(state.hvtRenderVersion) || 0;
    if (hvtCacheVersion === cacheVersion) return;

    HVT_NODE_VISUAL_CACHE.clear();
    HVT_LINK_VISUAL_CACHE.clear();

    const selectedSeedId = hvtSeedNode ? String(hvtSeedNode.id) : '';
    const nodeLookup = new Map();

    for (const node of state.nodes) {
        const nodeId = String(node.id);
        const baseColor = sanitizeNodeColor(node.color);
        const score = Number(node.hvtScore) || 0;
        const influence = Number(node.hvtInfluence) || 0;
        const tintColor = sanitizeNodeColor(node.hvtTintColor || baseColor);
        const isSelectedSeed = selectedSeedId && nodeId === selectedSeedId;
        const isTop = topSet ? (topSet.has(node.id) || topSet.has(nodeId)) : false;

        let alpha = 0.18;
        let radiusMultiplier = 0.82;
        let blendAmount = 0.22;
        let isBoss = false;

        if (isSelectedSeed || (!hvtSeedNode && isTop)) {
            isBoss = true;
            radiusMultiplier = 1 + (Math.max(score, influence) * 0.8);
            alpha = 1;
            blendAmount = 0.88;
        } else if (influence > 0.5) {
            alpha = 0.92;
            radiusMultiplier = 1.14;
            blendAmount = 0.82;
        } else if (influence > 0.24) {
            alpha = 0.68;
            radiusMultiplier = 1.02;
            blendAmount = 0.66;
        } else if (influence > 0.12) {
            alpha = 0.4;
            radiusMultiplier = 0.9;
            blendAmount = 0.44;
        }

        HVT_NODE_VISUAL_CACHE.set(nodeId, {
            id: nodeId,
            baseColor,
            tintColor,
            renderColor: blendHexColors(baseColor, tintColor, blendAmount),
            score,
            influence,
            alpha,
            radiusMultiplier,
            isBoss,
            outlineAlpha: influence > 0.24 ? (0.28 + (influence * 0.42)) : 0
        });
        nodeLookup.set(nodeId, node);
    }

    for (const link of state.links) {
        const sourceId = String(getLinkEndpointId(link.source));
        const targetId = String(getLinkEndpointId(link.target));
        const sourceNode = (typeof link.source === 'object') ? link.source : nodeLookup.get(sourceId);
        const targetNode = (typeof link.target === 'object') ? link.target : nodeLookup.get(targetId);
        const sourceVisual = HVT_NODE_VISUAL_CACHE.get(sourceId);
        const targetVisual = HVT_NODE_VISUAL_CACHE.get(targetId);
        const sourceInfluence = sourceVisual?.influence ?? (Number(sourceNode?.hvtInfluence) || 0);
        const targetInfluence = targetVisual?.influence ?? (Number(targetNode?.hvtInfluence) || 0);
        const linkInfluence = Math.max(Number(link.hvtInfluence) || 0, sourceInfluence, targetInfluence);
        const sourceColor = sourceVisual?.tintColor || sanitizeNodeColor(sourceNode?.hvtTintColor || sourceNode?.color || '#66f3ff');
        const targetColor = targetVisual?.tintColor || sanitizeNodeColor(targetNode?.hvtTintColor || targetNode?.color || '#66f3ff');
        const dominantColor = sourceInfluence >= targetInfluence ? sourceColor : targetColor;

        HVT_LINK_VISUAL_CACHE.set(link, {
            sourceId,
            targetId,
            sourceInfluence,
            targetInfluence,
            linkInfluence,
            sourceColor,
            targetColor,
            dominantColor,
            flatColor: (sourceInfluence > 0.18 && targetInfluence > 0.18)
                ? blendHexColors(sourceColor, targetColor, 0.5)
                : dominantColor,
            isSeedLink: Boolean(selectedSeedId) && (sourceId === selectedSeedId || targetId === selectedSeedId)
        });
    }

    hvtCacheVersion = cacheVersion;
}

export function updateDegreeCache() {
    degreeCache.clear();
    for (const l of state.links) {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        degreeCache.set(s, (degreeCache.get(s) || 0) + 1);
        degreeCache.set(t, (degreeCache.get(t) || 0) + 1);
    }
}

export function nodeRadius(n) {
    const base = NODE_BASE_SIZE[n.type] || 10;
    const d = degreeCache.get(n.id) || 0;
    const r = base + (DEG_SCALE[n.type] || 4.0) * d;
    return Math.max(R_MIN[n.type], Math.min(R_MAX[n.type], r));
}

export function resizeCanvas() {
    if (!canvas || !container) return;
    const r = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * r;
    canvas.height = h * r;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    draw();
}

function drawPolygon(ctx, x, y, radius, sides, rotate = 0) {
    ctx.moveTo(x + radius * Math.cos(rotate), y + radius * Math.sin(rotate));
    for (let i = 1; i <= sides; i++) {
        const angle = i * 2 * Math.PI / sides + rotate;
        ctx.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
    }
}

export function draw() {
    if (drawFrameHandle && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(drawFrameHandle);
        drawFrameHandle = 0;
    }
    if (canvas.width === 0 || canvas.height === 0) return;

    const p = state.view;
    updateZoomDisplay(p.scale);
    const r = window.devicePixelRatio || 1;
    const w = canvas.width / r;
    const h = canvas.height / r;
    const invScaleSqrt = 1 / Math.sqrt(Math.max(0.0001, p.scale));
    
    const isFocus = state.focusMode;
    const isHVT = state.hvtMode; 
    const topSet = (isHVT && state.hvtTopN > 0 && state.hvtTopIds && state.hvtTopIds.size) ? state.hvtTopIds : null;
    const hvtSeedNode = isHVT && state.hvtSelectedId ? nodeById(state.hvtSelectedId) : null;
    const showTypes = state.showLinkTypes; 
    const labelMode = state.labelMode; 
    const activeFilter = state.activeFilter; 

    if (isHVT) ensureHvtVisualCache(topSet, hvtSeedNode);

    // NETTOYAGE
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    
    // GRILLE (Optimisée : trait fin)
    ctx.save();
    ctx.strokeStyle = "rgba(115, 251, 247, 0.05)"; 
    ctx.lineWidth = 1;
    const gridSize = 100 * p.scale; 
    const offsetX = (w/2 + p.x) % gridSize;
    const offsetY = (h/2 + p.y) % gridSize;
    ctx.beginPath();
    for (let x = offsetX; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offsetY; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();

    ctx.translate(w / 2 + p.x, h / 2 + p.y);
    ctx.scale(p.scale, p.scale);

    const useGlow = (!state.performance && p.scale > 0.4);
    const focusId = state.hoverId || state.selection;
    const hasFocus = (focusId !== null);

    const allowedKinds = FILTER_RULES[activeFilter];
    const visibleLinks = new Set();
    const activeNodes = new Set(); 
    const pairCounts = new Map();
    const focusNeighborIds = new Set();
    const pathPreviewOnly = state.pathfinding.startId !== null && !state.pathfinding.active;

    // Pré-calcul de visibilité
    for (const l of state.links) {
        const sId = getLinkEndpointId(l.source);
        const tId = getLinkEndpointId(l.target);
        if (allowedKinds && !allowedKinds.has(l.kind)) continue;
        visibleLinks.add(l);
        activeNodes.add(sId);
        activeNodes.add(tId);
        if (hasFocus) {
            if (String(sId) === String(focusId)) focusNeighborIds.add(String(tId));
            else if (String(tId) === String(focusId)) focusNeighborIds.add(String(sId));
        }
        if (l.kind !== KINDS.ENNEMI) {
            const key = pairKey(sId, tId);
            pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
    }

    const predictedLinks = (state.aiSettings?.intelUnlocked && state.aiSettings?.showPredicted && Array.isArray(state.aiPredictedLinks)) ? state.aiPredictedLinks : [];
    const predictedCounts = new Map();
    if (predictedLinks.length) {
        predictedLinks.forEach(l => {
            if (!l || !l.aId || !l.bId) return;
            if (allowedKinds && l.kind && !allowedKinds.has(l.kind)) return;
            const key = pairKey(l.aId, l.bId);
            predictedCounts.set(key, (predictedCounts.get(key) || 0) + 1);
        });
    }

    const nodeMap = predictedLinks.length
        ? new Map(state.nodes.map((n) => [String(n.id), n]))
        : null;
    const nonPersonNodes = [];
    const personNodes = [];
    for (const node of state.nodes) {
        if (node.type === TYPES.PERSON) personNodes.push(node);
        else nonPersonNodes.push(node);
    }
    const sortedNodes = nonPersonNodes.concat(personNodes);
    const renderableNodes = [];
    for (const node of sortedNodes) {
        if (activeFilter !== FILTERS.ALL && node.type === TYPES.PERSON && !activeNodes.has(node.id)) continue;
        if (isFocus && !state.focusSet.has(String(node.id))) continue;
        renderableNodes.push(node);
    }
    const visibleLinkCount = visibleLinks.size;
    const hvtDenseMode = isHVT && (visibleLinkCount > 180 || renderableNodes.length > 220);
    const hvtVeryDenseMode = isHVT && (visibleLinkCount > 320 || renderableNodes.length > 340);
    const useHvtGradients = isHVT && !state.performance && !hvtDenseMode && visibleLinkCount < 90 && renderableNodes.length < 140 && p.scale > 0.42;
    const useHvtLinkShadows = isHVT && !state.performance && !hvtDenseMode && visibleLinkCount < 70 && renderableNodes.length < 120 && p.scale > 0.46;
    const useHvtBossGlow = isHVT && !state.performance && !hvtVeryDenseMode && visibleLinkCount < 180 && renderableNodes.length < 220;
    const nodeDimCache = new Map();

    const getCurve = (sx, sy, tx, ty, offset) => {
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const cx = (sx + tx) / 2 + nx * offset;
        const cy = (sy + ty) / 2 + ny * offset;
        return { cx, cy };
    };

    const getCurveOffset = (sId, tId, totalCount, index, degreeBoost = 0) => {
        const curveStrength = (state.physicsSettings?.curveStrength ?? 1);
        const base = 18 * Math.max(0, curveStrength);
        if (base < 1) return 0;
        if (totalCount <= 1) {
            if (degreeBoost <= 0) return 0;
            const hash = (String(sId).charCodeAt(0) + String(tId).charCodeAt(0)) % 2 ? 1 : -1;
            return base * 0.4 * degreeBoost * hash;
        }
        const mid = (totalCount - 1) / 2;
        const slot = (index - mid);
        return slot * base * (1 + degreeBoost);
    };

    function isNodeDimmed(node) {
        const cacheKey = String(node.id);
        if (nodeDimCache.has(cacheKey)) return nodeDimCache.get(cacheKey);
        let dimmed = false;
        if (isFocus) {
            nodeDimCache.set(cacheKey, false);
            return false;
        }
        if (!isHVT && !pathPreviewOnly) {
            if (state.pathfinding.active) {
                dimmed = !state.pathfinding.pathNodes.has(node.id);
            } else if (hasFocus) {
                dimmed = String(node.id) !== String(focusId) && !focusNeighborIds.has(String(node.id));
            }
        }
        nodeDimCache.set(cacheKey, dimmed);
        return dimmed;
    }

    function isLinkDimmed(link) {
        if (isHVT || isFocus) return false;
        if (pathPreviewOnly) return false;
        if (state.pathfinding.active) {
            const s = getLinkEndpointId(link.source);
            const t = getLinkEndpointId(link.target);
            const k1 = `${s}-${t}`;
            const k2 = `${t}-${s}`;
            return !(state.pathfinding.pathLinks.has(k1) || state.pathfinding.pathLinks.has(k2));
        }
        if (!hasFocus) return false;
        const s = getLinkEndpointId(link.source);
        const t = getLinkEndpointId(link.target);
        return (String(s) !== String(focusId) && String(t) !== String(focusId));
    }

    // 0. LIENS PREDITS (IA)
    if (predictedLinks.length && (!isHVT || state.aiSettings?.showPredicted)) {
        const pairIndex = new Map();
        ctx.save();
        ctx.setLineDash([6, 6]);
        for (const pl of predictedLinks) {
            if (!pl || !pl.aId || !pl.bId) continue;
            if (allowedKinds && pl.kind && !allowedKinds.has(pl.kind)) continue;
            const a = nodeMap?.get(String(pl.aId));
            const b = nodeMap?.get(String(pl.bId));
            if (!a || !b) continue;
            const key = pairKey(pl.aId, pl.bId);
            const total = predictedCounts.get(key) || 1;
            const idx = pairIndex.get(key) || 0;
            pairIndex.set(key, idx + 1);

            const degA = degreeCache.get(a.id) || 0;
            const degB = degreeCache.get(b.id) || 0;
            const degreeBoost = Math.min(1.5, (degA + degB) / 10);
            const offset = getCurveOffset(a.id, b.id, total, idx, degreeBoost);

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            if (offset !== 0) {
                const { cx, cy } = getCurve(a.x, a.y, b.x, b.y, offset);
                ctx.quadraticCurveTo(cx, cy, b.x, b.y);
            } else {
                ctx.lineTo(b.x, b.y);
            }

            const color = pl.kind ? computeLinkColor({ kind: pl.kind }) : 'rgba(115, 251, 247, 0.6)';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 * invScaleSqrt;
            ctx.globalAlpha = 0.35;
            ctx.shadowBlur = 0;
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    // 1. DESSIN DES LIENS
    const pairIndex = new Map();
    for (const l of state.links) {
        if (!visibleLinks.has(l)) continue;
        if (l.kind === KINDS.ENNEMI) continue; 
        const sId = getLinkEndpointId(l.source);
        const tId = getLinkEndpointId(l.target);
        const sourceNode = (typeof l.source === 'object') ? l.source : nodeById(sId);
        const targetNode = (typeof l.target === 'object') ? l.target : nodeById(tId);
        const hvtLinkVisual = isHVT ? HVT_LINK_VISUAL_CACHE.get(l) : null;
        if (isFocus && (!state.focusSet.has(String(sId)) || !state.focusSet.has(String(tId)))) continue;
        
        let dimmed = isLinkDimmed(l);
        let globalAlpha = dimmed ? 0.2 : 0.8;
        const sourceInfluence = hvtLinkVisual?.sourceInfluence ?? (Number(sourceNode?.hvtInfluence) || 0);
        const targetInfluence = hvtLinkVisual?.targetInfluence ?? (Number(targetNode?.hvtInfluence) || 0);
        const linkInfluence = hvtLinkVisual?.linkInfluence ?? Math.max(Number(l.hvtInfluence) || 0, sourceInfluence, targetInfluence);
        const sourceColor = hvtLinkVisual?.sourceColor || sanitizeNodeColor((isHVT ? (sourceNode?.hvtTintColor || sourceNode?.color) : sourceNode?.color) || '#66f3ff');
        const targetColor = hvtLinkVisual?.targetColor || sanitizeNodeColor((isHVT ? (targetNode?.hvtTintColor || targetNode?.color) : targetNode?.color) || '#66f3ff');
        const dominantColor = sourceInfluence >= targetInfluence ? sourceColor : targetColor;
        const isSeedLink = hvtLinkVisual?.isSeedLink || (Boolean(hvtSeedNode)
            && (String(sId) === String(hvtSeedNode.id) || String(tId) === String(hvtSeedNode.id)));

        if (isHVT) {
            if (hvtSeedNode) {
                if (linkInfluence < 0.12 && !isSeedLink) continue;
                globalAlpha = Math.min(0.96, Math.max(0.04, 0.04 + (linkInfluence * 1.02)));
            } else {
                if (linkInfluence < 0.08) continue;
                globalAlpha = Math.min(0.9, Math.max(0.12, 0.08 + (linkInfluence * 0.78)));
            }
        }

        const key = pairKey(sId, tId);
        const total = pairCounts.get(key) || 1;
        const idx = pairIndex.get(key) || 0;
        pairIndex.set(key, idx + 1);

        const degA = degreeCache.get(sId) || 0;
        const degB = degreeCache.get(tId) || 0;
        const degreeBoost = Math.min(1.5, (degA + degB) / 10);
        const offset = getCurveOffset(sId, tId, total, idx, degreeBoost);

        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        if (offset !== 0) {
            const { cx, cy } = getCurve(l.source.x, l.source.y, l.target.x, l.target.y, offset);
            ctx.quadraticCurveTo(cx, cy, l.target.x, l.target.y);
        } else {
            ctx.lineTo(l.target.x, l.target.y);
        }

        const isPathLink = state.pathfinding.active && !dimmed;

        let sTop = false;
        let tTop = false;
        if (topSet) {
            sTop = topSet.has(sId);
            tTop = topSet.has(tId);
            if (!sTop && !tTop && linkInfluence < 0.18) continue;
        }

        if (showTypes || isPathLink || isHVT) {
             const baseLinkColor = isPathLink ? '#00ffff' : computeLinkColor(l);
             const flatHvtColor = hvtLinkVisual?.flatColor || ((sourceInfluence > 0.18 && targetInfluence > 0.18)
                ? blendHexColors(sourceColor, targetColor, 0.5)
                : dominantColor);
             const strokeColor = (isHVT && !isPathLink)
                ? (
                    useHvtGradients && linkInfluence > 0.24
                        ? createHvtInfluenceGradient(l.source.x, l.source.y, l.target.x, l.target.y, sourceColor, targetColor, sourceInfluence, targetInfluence, linkInfluence)
                        : flatHvtColor
                )
                : baseLinkColor;
             ctx.strokeStyle = strokeColor;
             ctx.lineWidth = (
                isPathLink
                    ? 4
                    : (isHVT ? (0.75 + (linkInfluence * (hvtDenseMode ? 2.2 : 3.2))) : (dimmed ? 1 : 2))
             ) * invScaleSqrt;
             if (isPathLink) {
                 ctx.shadowBlur = 15;
                 ctx.shadowColor = '#00ffff';
             } else if (isHVT && useHvtLinkShadows && linkInfluence > 0.22) {
                 ctx.shadowBlur = hvtDenseMode ? 0 : 12;
                 ctx.shadowColor = dominantColor;
             } else if (useGlow && !dimmed && !isHVT) {
                 ctx.shadowBlur = 8;
                 ctx.shadowColor = baseLinkColor;
             } else {
                 ctx.shadowBlur = 0;
             }
        } else {
             if (state.performance) ctx.strokeStyle = "rgba(255,255,255,0.2)";
             else {
                 try {
                    const grad = ctx.createLinearGradient(l.source.x, l.source.y, l.target.x, l.target.y);
                    grad.addColorStop(0, sanitizeNodeColor(l.source.color));
                    grad.addColorStop(1, sanitizeNodeColor(l.target.color));
                    ctx.strokeStyle = grad;
                 } catch(e) { ctx.strokeStyle = '#999'; }
             }
             ctx.lineWidth = (dimmed ? 1 : 1.5) * invScaleSqrt;
             ctx.shadowBlur = 0;
        }
        if (topSet && (sTop ^ tTop) && !isHVT) globalAlpha = Math.min(globalAlpha, 0.25);
        ctx.globalAlpha = globalAlpha;
        ctx.stroke();

        // AFFICHAGE DE L'EMOJI SUR LE LIEN
        if (showTypes && p.scale > 0.6 && !dimmed && !isPathLink && !isHVT) {
            let mx = (l.source.x + l.target.x) / 2;
            let my = (l.source.y + l.target.y) / 2;
            if (offset !== 0) {
                const control = getCurve(l.source.x, l.source.y, l.target.x, l.target.y, offset);
                const mid = quadraticPoint(
                    { x: l.source.x, y: l.source.y },
                    { x: control.cx, y: control.cy },
                    { x: l.target.x, y: l.target.y },
                    0.5
                );
                mx = mid.x; my = mid.y;
            }
            const color = computeLinkColor(l);
            
            ctx.globalAlpha = 1; ctx.shadowBlur = 0;
            
            // Fond rond noir
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(mx, my, 10 * invScaleSqrt, 0, Math.PI*2); ctx.fill();
            
            // Cercle coloré
            ctx.strokeStyle = color; ctx.lineWidth = 1 * invScaleSqrt; ctx.stroke();
            
            // Emoji
            ctx.fillStyle = '#fff'; ctx.font = `${14 * invScaleSqrt}px sans-serif`; 
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            
            // CORRECTION ICI : Si l'emoji n'est pas trouvé, on met '🔗' au lieu de '•'
            const emoji = LINK_KIND_EMOJI[l.kind] || '🔗';
            ctx.fillText(emoji, mx, my);
        }
    }

    // 2. LIEN TEMP
    if (state.tempLink) {
        ctx.beginPath();
        ctx.moveTo(state.tempLink.x1, state.tempLink.y1);
        ctx.lineTo(state.tempLink.x2, state.tempLink.y2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 * invScaleSqrt;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 3. NOEUDS
    for (const n of renderableNodes) {
        const dimmed = isNodeDimmed(n);
        const hvtNodeVisual = isHVT ? HVT_NODE_VISUAL_CACHE.get(String(n.id)) : null;
        let rad = nodeRadius(n); 
        let alpha = dimmed ? 0.4 : 1.0;
        let nodeColor = sanitizeNodeColor(n.color);
        const statusVisual = getPersonStatusVisual(n);
        const isTop = topSet ? topSet.has(n.id) : true;
        
        // --- LOGIQUE VISUELLE HVT ---
        let isBoss = false;
        if (isHVT && hvtNodeVisual) {
            isBoss = hvtNodeVisual.isBoss;
            alpha = hvtNodeVisual.alpha;
            rad *= hvtNodeVisual.radiusMultiplier;
            nodeColor = hvtNodeVisual.renderColor;
        }

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        if (isGroup(n)) drawPolygon(ctx, n.x, n.y, rad * 1.2, 4); 
        else if (isCompany(n)) drawPolygon(ctx, n.x, n.y, rad * 1.1, 6, Math.PI/2); 
        else ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);

        ctx.fillStyle = nodeColor;
        
        const isPathfindingNode = state.pathfinding.active && state.pathfinding.pathNodes.has(n.id);
        const isPathStart = state.pathfinding.startId === n.id;

        // Gestion Contour
        if (state.selection === n.id || state.hoverId === n.id || isPathfindingNode || isPathStart) {
            ctx.shadowBlur = 20; 
            let strokeColor = '#ffffff';
            if (isPathfindingNode) strokeColor = '#00ffff';
            if (isPathStart) strokeColor = '#ffff00';
            ctx.shadowColor = strokeColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3 * invScaleSqrt;
            ctx.stroke();
        } else if (isBoss) {
            ctx.shadowBlur = useHvtBossGlow ? 18 : 0;
            ctx.shadowColor = nodeColor;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3 * invScaleSqrt;
            ctx.stroke();
        } else {
            ctx.shadowBlur = 0;
            if (isHVT && (hvtNodeVisual?.outlineAlpha || 0) > 0) {
                ctx.strokeStyle = rgbaFromHex(nodeColor, hvtNodeVisual.outlineAlpha);
                ctx.lineWidth = 1.4 * invScaleSqrt;
                ctx.stroke();
            } else if(!dimmed && p.scale > 0.5 && !isHVT) {
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.lineWidth = 1 * invScaleSqrt;
                ctx.stroke();
            }
        }
        ctx.fill();
        ctx.shadowBlur = 0; // Reset important

        if (statusVisual && n.type === TYPES.PERSON && (!isHVT || !hvtDenseMode || isBoss || (hvtNodeVisual?.influence || 0) > 0.56)) {
            ctx.save();
            ctx.globalAlpha = Math.max(0.92, alpha);
            ctx.beginPath();
            ctx.setLineDash(statusVisual.status === PERSON_STATUS.MISSING ? [6 * invScaleSqrt, 5 * invScaleSqrt] : []);
            ctx.arc(n.x, n.y, rad + (5 * invScaleSqrt), 0, Math.PI * 2);
            ctx.strokeStyle = statusVisual.accent;
            ctx.lineWidth = 2 * invScaleSqrt;
            ctx.stroke();
            ctx.setLineDash([]);

            const badgeX = n.x + (rad * 0.72);
            const badgeY = n.y - (rad * 0.72);
            const badgeR = Math.max(6, rad * 0.26);
            ctx.beginPath();
            ctx.fillStyle = 'rgba(3, 8, 18, 0.96)';
            ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = statusVisual.accent;
            ctx.lineWidth = 1.6 * invScaleSqrt;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 ${Math.max(10, badgeR * 1.25)}px "Rajdhani", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(statusVisual.badge, badgeX, badgeY + 0.5);
            ctx.restore();
        }

        // Icônes
        if (!dimmed && (p.scale > 0.4 || rad > 15) && (!isHVT || Math.max(n.hvtScore || 0, n.hvtInfluence || 0) > 0.2) && (!isHVT || !hvtDenseMode || isBoss || (hvtNodeVisual?.influence || 0) > 0.52)) {
            ctx.globalAlpha = 1; 
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.font = `${rad}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(NODE_ICONS[n.type] || '', n.x, n.y + (rad*0.05));
        }
    }

    // 4. LABELS
    if (labelMode > 0) { 
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const candidates = [];
        const drawnBoxes = [];

        for (const n of renderableNodes) {
            const influence = Number(n.hvtInfluence) || 0;
            if (isHVT) {
                if (topSet && !topSet.has(n.id) && influence < (hvtVeryDenseMode ? 0.36 : (hvtDenseMode ? 0.3 : 0.24))) continue;
                if (!topSet && Math.max(n.hvtScore || 0, influence) < (hvtVeryDenseMode ? 0.58 : (hvtDenseMode ? 0.5 : 0.42))) continue;
            }

            const rad = nodeRadius(n);
            const dimmed = isNodeDimmed(n);
            if (dimmed) continue;
            
            const isImportant = (n.type === TYPES.COMPANY || n.type === TYPES.GROUP);
            const isPathfindingNode = state.pathfinding.active && state.pathfinding.pathNodes.has(n.id);
            const isHover = (state.hoverId === n.id);
            const isSelected = (state.selection === n.id);
            const isPathStart = state.pathfinding.startId === n.id;
            const hvtScore = n.hvtScore || 0;
            const degree = degreeCache.get(n.id) || 0;

            let showName = false;
            if (labelMode === 2) showName = true;
            else if (labelMode === 1) {
                showName = isSelected || isHover || isPathfindingNode || isPathStart;
                if (!showName) showName = (hvtScore > 0.55) || (influence > 0.46) || (degree > 4) || (isImportant && p.scale > 0.28) || (p.scale > 0.55);
            }
            
            if (isHVT && topSet && topSet.has(n.id)) showName = true;
            else if (isHVT && (hvtScore > 0.6 || influence > 0.48)) showName = true;

            if (!showName) continue;

            const baseScreenFont = (isPathfindingNode || isPathStart || (isHVT && hvtScore > 0.6)) ? 15 : 12.5;
            const zoomBoost = p.scale < 0.62 ? (0.62 - p.scale) * 7 : 0;
            const targetScreenFont = Math.min(18, baseScreenFont + zoomBoost + (isImportant ? 0.8 : 0));
            let fontSize = targetScreenFont / Math.max(p.scale, 0.18);
            fontSize = Math.min(fontSize, 84);
            ctx.font = `600 ${fontSize}px "Rajdhani", sans-serif`;
            const statusVisual = getPersonStatusVisual(n);
            const compactLabel = compactNodeLabel(n, p.scale);
            const label = statusVisual ? `${compactLabel} · ${statusVisual.label}` : compactLabel;
            const metrics = getLabelMetrics(label, fontSize);
            const textW = metrics.width;
            const textH = fontSize * 1.18;
            const padding = Math.max(8, targetScreenFont * 0.72) / Math.max(p.scale, 0.22);
            const boxX = n.x - textW / 2 - padding;
            const boxY = n.y + rad + (6 * invScaleSqrt);
            const boxW = textW + padding * 2;
            const boxH = textH + padding * 0.9;

            let priority = 0;
            if (isSelected) priority += 100;
            if (isHover) priority += 90;
            if (isPathfindingNode || isPathStart) priority += 80;
            if (hvtScore > 0.6) priority += 60;
            priority += Math.min(26, Math.round(influence * 32));
            priority += Math.min(30, Math.round(hvtScore * 30));
            priority += Math.min(20, degree);
            if (isImportant) priority += 10;

            candidates.push({
                n, label, boxX, boxY, boxW, boxH,
                fontSize, rad, priority,
                isPathfindingNode, isPathStart
            });
        }

        candidates.sort((a, b) => b.priority - a.priority);
        if (isHVT) {
            const maxLabels = hvtVeryDenseMode ? 18 : (hvtDenseMode ? 38 : 96);
            if (candidates.length > maxLabels) candidates.length = maxLabels;
        }

        const overlaps = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

        for (const c of candidates) {
            const rect = { x: c.boxX, y: c.boxY, w: c.boxW, h: c.boxH };
            const mustDraw = c.priority >= 90;
            let collide = false;
            if (!mustDraw) {
                for (const r of drawnBoxes) {
                    if (overlaps(rect, r)) { collide = true; break; }
                }
            }
            if (collide) continue;
            drawnBoxes.push(rect);

            ctx.globalAlpha = 0.95; ctx.fillStyle = 'rgba(3, 8, 18, 0.96)';
            ctx.beginPath();
            if(ctx.roundRect) ctx.roundRect(c.boxX, c.boxY, c.boxW, c.boxH, 6);
            else ctx.rect(c.boxX, c.boxY, c.boxW, c.boxH);
            ctx.fill();
            
            const statusVisual = getPersonStatusVisual(c.n);
            let strokeColor = statusVisual ? statusVisual.accent : sanitizeNodeColor(c.n.color);
            if (c.isPathfindingNode) strokeColor = '#00ffff';
            if (c.isPathStart) strokeColor = '#ffff00';
            
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = ((c.isPathfindingNode || c.isPathStart || (isHVT && (c.n.hvtScore || 0) > 0.6)) ? 2.4 : 1.3) * invScaleSqrt;
            ctx.stroke();
            ctx.globalAlpha = 1.0; ctx.fillStyle = '#ffffff';
            ctx.font = `600 ${c.fontSize}px "Rajdhani", sans-serif`;
            if (!isHVT || !hvtDenseMode) {
                ctx.lineWidth = Math.max(2.4, c.fontSize * 0.14);
                ctx.strokeStyle = 'rgba(2, 6, 14, 0.92)';
                ctx.strokeText(c.label, c.n.x, c.boxY + (c.boxH / 2));
            }
            ctx.fillText(c.label, c.n.x, c.boxY + (c.boxH / 2));
        }
    }
    ctx.restore();
}
