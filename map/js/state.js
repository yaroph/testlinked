import { normalizeMapBoardPayload, normalizeMapGroups } from '../../shared/js/map-board.mjs';

export const state = {
    groups: [],
    tacticalLinks: [],
    view: { x: 0, y: 0, scale: 0.5 },
    
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    selectedPoint: null, 
    selectedZone: null,

    drawingMode: false,
    drawingType: null,
    drawingGroupIndex: null,
    tempZone: null,
    tempPoints: [],
    
    isFreeMode: false,
    isFreeDrawing: false,
    drawingPending: false,
    
    drawOptions: { width: 2, style: 'solid' },
    
    draggingMarker: null, 

    measuringMode: false,
    measureStep: 0,
    measurePoints: [],
    
    linkingMode: false,
    linkStartId: null, 

    statusFilter: 'ALL',
    searchTerm: '',
    labelMode: 'auto',
    activeAlert: null,
    activeAlerts: [],

    currentFileName: null,

    mapWidth: 0,
    mapHeight: 0
};

const LOCAL_STORAGE_KEY = 'tacticalMapData';
const LOCAL_CHANGE_EVENT = 'bni:map-local-change';
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

// --- HISTORIQUE ---
const history = [];
const MAX_HISTORY = 50; 

export function setLocalPersistenceEnabled(enabled, options = {}) {
    localPersistenceEnabled = Boolean(enabled);

    if (!localPersistenceEnabled && options && options.purge) {
        try {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        } catch (e) {}
    }
}

export function isLocalPersistenceEnabled() {
    return localPersistenceEnabled;
}

export function pushHistory() {
    const snapshot = JSON.stringify({
        groups: state.groups,
        tacticalLinks: state.tacticalLinks
    });
    if (history.length > 0 && history[history.length - 1] === snapshot) return;
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
}

export function undo() {
    if (history.length === 0) return false;
    try {
        const prevJSON = history.pop();
        const prevData = JSON.parse(prevJSON);
        const normalized = normalizeMapBoardPayload({
            groups: prevData.groups,
            tacticalLinks: prevData.tacticalLinks || []
        });
        state.groups = normalized.groups;
        state.tacticalLinks = normalized.tacticalLinks || [];
        return true;
    } catch (e) {
        console.error("Erreur Undo:", e);
        return false;
    }
}

export function generateID() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function findPointById(id) {
    for (const group of state.groups) {
        const p = group.points.find(pt => pt.id === id);
        if (p) return p;
    }
    return null;
}

export function addTacticalLink(idA, idB) {
    if (!idA || !idB || idA === idB) return false;
    const exists = state.tacticalLinks.find(l => 
        (l.from === idA && l.to === idB) || (l.from === idB && l.to === idA)
    );
    if (exists) return false;
    state.tacticalLinks.push({ id: generateID(), from: idA, to: idB, color: null, type: 'Standard' });
    return true;
}

export function removeTacticalLink(linkId) {
    state.tacticalLinks = state.tacticalLinks.filter(l => l.id !== linkId);
}

export function updateTacticalLink(linkId, newData) {
    const link = state.tacticalLinks.find(l => l.id === linkId);
    if (link) Object.assign(link, newData);
}

export function pruneTacticalLinks(removedIds) {
    const ids = new Set(removedIds.map(id => String(id)));
    state.tacticalLinks = state.tacticalLinks.filter(l =>
        !ids.has(String(l.from)) && !ids.has(String(l.to))
    );
}

export function setGroups(newGroups) { 
    state.groups = normalizeMapGroups(newGroups || []);
    if(state.tacticalLinks) {
        state.tacticalLinks.forEach(l => {
            if(!l.id) l.id = generateID();
            if(!l.type) l.type = 'Standard';
        });
    }
}

// Helper pour récupérer les données proprement
export function getMapData() {
    return { 
        meta: { date: new Date().toISOString(), version: "2.5" },
        groups: state.groups,
        tacticalLinks: state.tacticalLinks
    };
}

export function exportToJSON(fileNameOverride) {
    if (!localPersistenceEnabled) return false;

    const data = getMapData();
    
    let finalName = fileNameOverride;
    if (!finalName) {
         if (state.currentFileName) {
             finalName = state.currentFileName;
         } else {
             const now = new Date();
             const dateStr = now.toISOString().split('T')[0];
             const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
             finalName = `carte_tactique_${dateStr}_${timeStr}`;
         }
    }
    if (!finalName.endsWith('.json')) finalName += '.json';

    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    return true;
}

export function applyMapBoardData(payload = {}) {
    const normalized = normalizeMapBoardPayload(payload || {});
    state.groups = normalized.groups;
    state.tacticalLinks = normalized.tacticalLinks || [];
    return normalized;
}

export function saveLocalState() {
    if (!localPersistenceEnabled) {
        emitLocalChange({ source: 'saveLocalState', persisted: false });
        return;
    }

    const data = {
        groups: state.groups,
        tacticalLinks: state.tacticalLinks,
        currentFileName: state.currentFileName,
        meta: { date: new Date().toISOString(), savedBy: "AutoSave" }
    };
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        emitLocalChange({ source: 'saveLocalState', persisted: true });
    } catch (e) {
        emitLocalChange({ source: 'saveLocalState', persisted: false });
    }
}

export function loadLocalState() {
    if (!localPersistenceEnabled) return null;

    try {
        const json = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!json) return null;
        return JSON.parse(json);
    } catch (e) { return null; }
}
