import { restartSim } from './physics.js';
import { getId, uid, sanitizeNodeColor, normalizePersonStatus } from './utils.js';
import { cloneDefaultPointPhysicsSettings } from '../../shared/js/point-physics-settings.mjs';

export const state = {
    nodes: [],
    links: [],
    nextId: 1,
    selection: null,
    hoverId: null,
    focusMode: false,
    focusRootId: null,
    focusDepth: 1,
    focusSet: new Set(),
    focusDirectSet: new Set(),
    hvtMode: false,
    hvtTopN: 10,
    hvtTopIds: new Set(),
    hvtSelectedId: null,
    hvtRenderVersion: 0,
    pathfinding: { startId: null, active: false, pathNodes: new Set(), pathLinks: new Set() },
    activeFilter: 'ALL',
    globeMode: true,
    physicsSettings: cloneDefaultPointPhysicsSettings(),
    history: [], tempLink: null, labelMode: 1, showLinkTypes: false, 
    performance: false, view: { x: 0, y: 0, scale: 0.8 }, forceSimulation: false,
    projectName: null, // AJOUT DU NOM DU PROJET
    aiSettings: {
        mode: 'decouverte',
        scope: 'selection',
        limit: 20,
        minScore: 0.35,
        noveltyRatio: 0.25,
        sources: { graph: true, text: true, tags: true, profile: true, bridge: true, lex: true, geo: true },
        showReasons: true,
        showPredicted: false,
        intelUnlocked: true
    },
    aiFeedback: {},
    aiPredictedLinks: [],
    aiPreviewPair: null
};

const STORAGE_KEY = 'pointPageState_v13'; 
const LOCAL_CHANGE_EVENT = 'bni:point-local-change';
let saveTimer = null;
let localPersistenceEnabled = true;

function emitLocalChange(detail = {}) {
    try {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
        window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, {
            detail: {
                at: Date.now(),
                ...detail
            }
        }));
    } catch (e) {}
}

export function setLocalPersistenceEnabled(enabled, options = {}) {
    localPersistenceEnabled = Boolean(enabled);
    const shouldPurge = Boolean(options && options.purge);
    if (!localPersistenceEnabled && shouldPurge) {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }
}

export function isLocalPersistenceEnabled() {
    return localPersistenceEnabled;
}

export function saveState() {
    if (!localPersistenceEnabled) {
        emitLocalChange({ source: 'saveState', persisted: false });
        return;
    }
    try {
        const payload = {
            meta: { projectName: state.projectName }, // SAUVEGARDE DU NOM
            nodes: state.nodes.map(n => ({
                id: n.id, name: n.name, type: n.type, color: sanitizeNodeColor(n.color),
                manualColor: Boolean(n.manualColor),
                personStatus: normalizePersonStatus(n.personStatus, n.type),
                num: n.num,
                accountNumber: n.accountNumber,
                citizenNumber: n.citizenNumber,
                linkedMapPointId: String(n.linkedMapPointId || ''),
                description: n.description,
                notes: n.notes,
                x: n.x, y: n.y, fixed: n.fixed
            })),
            links: state.links.map(l => ({
                id: l.id,
                source: (typeof l.source === 'object') ? l.source.id : l.source,
                target: (typeof l.target === 'object') ? l.target.id : l.target,
                kind: l.kind
            })),
            view: state.view, labelMode: state.labelMode, showLinkTypes: state.showLinkTypes,
            focusDepth: state.focusDepth,
            activeFilter: state.activeFilter, globeMode: state.globeMode, hvtTopN: state.hvtTopN,
            physicsSettings: state.physicsSettings, nextId: state.nextId,
            aiSettings: state.aiSettings, aiFeedback: state.aiFeedback,
            aiPredictedLinks: state.aiPredictedLinks
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        emitLocalChange({ source: 'saveState', persisted: true });
    } catch (e) {
        console.error("Save error", e);
        emitLocalChange({ source: 'saveState', persisted: false });
    }
}

export function scheduleSave(delay = 400) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveState();
    }, delay);
}

export function flushPendingSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    saveState();
}

export function loadState() {
    try {
        if (!localPersistenceEnabled) return false;
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data.nodes) state.nodes = data.nodes;
        state.nodes.forEach((node) => {
            if (!node || typeof node !== 'object') return;
            node.color = sanitizeNodeColor(node.color);
            if (typeof node.manualColor !== 'boolean') node.manualColor = false;
            node.personStatus = normalizePersonStatus(node.personStatus, node.type);
            if (typeof node.accountNumber !== 'string') node.accountNumber = '';
            if (typeof node.citizenNumber !== 'string') node.citizenNumber = '';
            node.linkedMapPointId = String(node.linkedMapPointId || '');
            if (typeof node.description !== 'string') node.description = String(node.notes || '');
            if (typeof node.notes !== 'string') node.notes = String(node.description || '');
        });
        if (data.links) state.links = data.links;
        if (data.view) state.view = data.view;
        if (data.nextId) state.nextId = data.nextId;
        if (typeof data.labelMode === 'number') state.labelMode = data.labelMode;
        if (typeof data.focusDepth === 'number') state.focusDepth = Math.max(1, Math.min(6, Math.round(data.focusDepth || 1)));
        if (data.activeFilter) state.activeFilter = data.activeFilter;
        if (typeof data.globeMode === 'boolean') state.globeMode = data.globeMode;
        if (typeof data.hvtTopN === 'number') state.hvtTopN = data.hvtTopN;
        if (data.physicsSettings) state.physicsSettings = { ...state.physicsSettings, ...data.physicsSettings };
        if (data.aiSettings) {
            state.aiSettings = { ...state.aiSettings, ...data.aiSettings };
            if (data.aiSettings.sources) {
                state.aiSettings.sources = { ...state.aiSettings.sources, ...data.aiSettings.sources };
            }
        }
        state.aiSettings.intelUnlocked = true;
        state.aiSettings.showPredicted = false;
        if (data.aiFeedback) state.aiFeedback = data.aiFeedback;
        if (data.aiPredictedLinks) state.aiPredictedLinks = data.aiPredictedLinks;
        state.aiPreviewPair = null;
        if (data.meta && data.meta.projectName) state.projectName = data.meta.projectName; // CHARGEMENT DU NOM
        ensureLinkIds();
        state.pathfinding = { startId: null, active: false, pathNodes: new Set(), pathLinks: new Set() };
        state.hvtMode = false;
        state.hvtTopIds = new Set();
        state.hvtSelectedId = null;
        return true;
    } catch (e) { return false; }
}

export function pushHistory() {
    if (state.history.length > 50) state.history.shift();
    const snapshot = {
        nodes: state.nodes.map(n => ({...n})),
        links: state.links.map(l => ({
            id: l.id,
            source: (typeof l.source === 'object') ? l.source.id : l.source,
            target: (typeof l.target === 'object') ? l.target.id : l.target,
            kind: l.kind
        })),
        nextId: state.nextId
    };
    state.history.push(JSON.stringify(snapshot));
}

export function undo() {
    if (state.history.length === 0) return;
    const prevJSON = state.history.pop();
    const prev = JSON.parse(prevJSON);
    state.nodes = prev.nodes;
    state.links = prev.links;
    ensureLinkIds();
    state.nextId = prev.nextId;
    restartSim();
}

export function ensureLinkIds() {
    state.links.forEach(l => {
        if (!l.id) l.id = uid();
    });
}

export function nodeById(id) {
    const target = String(id);
    return state.nodes.find(n => String(n.id) === target);
}

export function linkHasNode(link, nodeId) {
    const target = String(nodeId);
    return getId(link.source) === target || getId(link.target) === target;
}
export function isPerson(n) { return n.type === 'person'; }
export function isGroup(n) { return n.type === 'group'; }
export function isCompany(n) { return n.type === 'company'; }

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        flushPendingSave();
    });
    window.addEventListener('beforeunload', () => {
        flushPendingSave();
    });
}
