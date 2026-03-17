import { state, generateID, saveLocalState, pushHistory } from './state.js';
import { renderAll, getMapPercentCoords } from './render.js';
import { selectItem, renderGroupsList } from './ui.js'; // Import de renderGroupsList pour mettre à jour l'UI
import { customAlert } from './ui-modals.js';

// --- INITIALISATION DES MODES ---

export function startDrawingCircle(groupIndex) {
    setupDrawingMode('CIRCLE', groupIndex, "MODE CERCLE: Cliquez + Glissez pour le rayon");
}

// Mode Dessin Libre
export function startDrawingFree(groupIndex) {
    setupDrawingMode('POLYGON', groupIndex, "✏️ DESSIN LIBRE: Maintenez clic gauche. Relâchez pour éditer.");
    state.isFreeMode = true; 
}

function setupDrawingMode(type, groupIndex, msg) {
    state.drawingMode = true;
    state.drawingType = type;
    state.drawingGroupIndex = groupIndex;
    
    // Reset
    state.tempZone = null;
    state.tempPoints = [];
    state.isFreeMode = (type === 'POLYGON' && state.isFreeMode);
    state.isFreeDrawing = false;
    state.drawingPending = false;

    document.body.style.cursor = 'crosshair';
    
    // Désélectionner pour éviter les conflits visuels
    if(state.selectedPoint || state.selectedZone) selectItem(null); 
    
    showNotification(msg);
    initToolbarEvents(); 
    renderAll();
}

function showNotification(msg) {
    let notif = document.getElementById('drawing-notif');
    if(!notif) {
        notif = document.createElement('div');
        notif.id = 'drawing-notif';
        notif.style.position = 'fixed';
        notif.style.top = '90px';
        notif.style.left = '50%';
        notif.style.transform = 'translateX(-50%)';
        notif.style.pointerEvents = 'none';
        notif.style.zIndex = '4000';
        notif.style.fontWeight = '700';
        notif.style.textTransform = 'uppercase';
        document.body.appendChild(notif);
    }
    notif.innerHTML = msg;
    notif.style.display = 'block';
}

// --- GESTION BARRE D'OUTILS (TOOLBAR) ---

function initToolbarEvents() {
    const toolbar = document.getElementById('drawing-toolbar');
    if(!toolbar) return;

    const range = document.getElementById('drawWidth');
    const val = document.getElementById('drawWidthVal');
    const select = document.getElementById('drawStyle');
    
    // Mise à jour en temps réel
    range.oninput = () => {
        state.drawOptions.width = parseInt(range.value);
        val.innerText = range.value + 'px';
        renderAll();
    };
    
    select.onchange = () => {
        state.drawOptions.style = select.value;
        renderAll();
    };

    document.getElementById('btnDrawConfirm').onclick = confirmDrawing;
    document.getElementById('btnDrawCancel').onclick = cancelDrawing;
    document.getElementById('btnDrawSmooth').onclick = smoothDrawing;
}

function showToolbar() {
    const toolbar = document.getElementById('drawing-toolbar');
    if(toolbar) toolbar.style.display = 'block';
    
    // On cache la notification d'aide quand on édite
    const notif = document.getElementById('drawing-notif');
    if(notif) notif.style.display = 'none';
}

function hideToolbar() {
    const toolbar = document.getElementById('drawing-toolbar');
    if(toolbar) toolbar.style.display = 'none';
}

// --- HANDLERS SOURIS (MAP) ---

export function handleMapMouseDown(e) {
    // Si on est en attente de validation (toolbar ouverte), on bloque le clic sur la map
    if (state.drawingPending) return; 

    const coords = getMapPercentCoords(e.clientX, e.clientY);

    // 1. DÉBUT CERCLE
    if (state.drawingMode && state.drawingType === 'CIRCLE' && e.button === 0) {
        state.tempZone = { cx: coords.x, cy: coords.y, r: 0 };
        renderAll();
        return;
    }
    
    // 2. DÉBUT POLYGONE / LIBRE
    if (state.drawingMode && state.drawingType === 'POLYGON' && e.button === 0) {
        if (state.isFreeMode) {
            // Mode Libre : On commence une nouvelle ligne
            state.tempPoints = [coords]; 
            state.isFreeDrawing = true;  
            renderAll();
        } else {
            // Mode Classique : On ajoute un point
            state.tempPoints.push(coords);
            renderAll();
        }
        return;
    }
    
    // 3. CLIC DROIT (Fin Polygone Classique)
    if (state.drawingMode && state.drawingType === 'POLYGON' && !state.isFreeMode && e.button === 2) {
        e.preventDefault();
        state.drawingPending = true;
        showToolbar();
        document.body.style.cursor = 'default';
        return;
    }
}

export function handleMapMouseMove(e) {
    if (state.drawingPending) return;

    const coords = getMapPercentCoords(e.clientX, e.clientY);

    // A. DESSIN DU CERCLE (Ajustement du rayon)
    if (state.drawingMode && state.drawingType === 'CIRCLE' && state.tempZone) {
        const dx = coords.x - state.tempZone.cx;
        const dy = coords.y - state.tempZone.cy;
        state.tempZone.r = Math.sqrt(dx*dx + dy*dy);
        renderAll();
        return;
    }

    // B. DESSIN LIBRE (Traceur)
    if (state.drawingMode && state.drawingType === 'POLYGON' && state.isFreeDrawing) {
        const lastPt = state.tempPoints[state.tempPoints.length - 1];
        // Optimisation : On n'ajoute pas de point si on a bougé de moins de 0.00002%
        const distSq = (coords.x - lastPt.x)**2 + (coords.y - lastPt.y)**2;
        if (distSq > 0.00002) { 
            state.tempPoints.push(coords);
            renderAll();
        }
        return;
    }

    // C. DÉPLACEMENT (DRAG & DROP) D'UNE ZONE EXISTANTE
    if (state.draggingItem && state.draggingItem.type === 'zone') {
        const item = state.draggingItem;
        const group = state.groups[item.groupIndex];
        const zone = group.zones[item.zoneIndex];
        if (!group || !zone) return;
        
        const deltaX = coords.x - item.startMouseMap.x;
        const deltaY = coords.y - item.startMouseMap.y;
        const movedEnough = (deltaX * deltaX + deltaY * deltaY) > 0.00001;

        if (!item.hasMoved && movedEnough) {
            pushHistory();
            item.hasMoved = true;
        }

        if (!item.hasMoved) return;

        if (zone.type === 'CIRCLE') {
            zone.cx = item.origCx + deltaX;
            zone.cy = item.origCy + deltaY;
        } else {
            // Pour les polygones, on déplace tous les points
            if(item.origPoints) {
                zone.points = item.origPoints.map(p => ({
                    x: p.x + deltaX,
                    y: p.y + deltaY
                }));
            }
        }
        renderAll();
    }
}

export function handleMapMouseUp(e) {
    // 1. FIN CERCLE
    if (state.drawingMode && state.drawingType === 'CIRCLE' && state.tempZone) {
        finishCircle();
        return;
    }

    // 2. FIN TRACÉ LIBRE -> PASSAGE EN VALIDATION
    if (state.drawingMode && state.drawingType === 'POLYGON' && state.isFreeDrawing) {
        state.isFreeDrawing = false;
        
        if (state.tempPoints.length > 2) {
            state.drawingPending = true;
            document.body.style.cursor = 'default';
            showToolbar(); // On affiche la barre pour confirmer/lisser
        } else {
            state.tempPoints = []; // Tracé trop court, on annule
        }
        renderAll();
        return;
    }

    // 3. FIN DU DRAG (On libère l'objet)
    if (state.draggingItem) {
        if (state.draggingItem.hasMoved) {
            saveLocalState();
            renderGroupsList();
        }
        state.draggingItem = null;
    }
}

// --- ACTIONS DE LA BARRE D'OUTILS ---

function confirmDrawing() {
    const group = state.groups[state.drawingGroupIndex];
    if (group) {
        pushHistory();
        group.zones.push({
            id: generateID(),
            name: "Zone " + (group.zones.length + 1),
            type: 'POLYGON',
            points: [...state.tempPoints],
            style: { ...state.drawOptions } // On sauvegarde le style (épaisseur, pointillés)
        });
        selectItem('zone', state.drawingGroupIndex, group.zones.length - 1);
        
        // Mise à jour de la liste latérale (Compteur + Accordéon)
        renderGroupsList();
        saveLocalState();
    }
    stopDrawing();
}

function cancelDrawing() {
    // Annulation
    state.tempPoints = [];
    state.drawingPending = false;
    hideToolbar();
    stopDrawing();
}

function smoothDrawing() {
    if (state.tempPoints.length < 3) return;
    
    // Algorithme de Chaikin (Lissage des coins)
    const pts = state.tempPoints;
    const smoothed = [];
    
    // On conserve le premier point
    smoothed.push(pts[0]);
    
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i+1];
        
        // On crée deux points intermédiaires à 25% et 75% du segment
        smoothed.push({ x: 0.75 * p1.x + 0.25 * p2.x, y: 0.75 * p1.y + 0.25 * p2.y });
        smoothed.push({ x: 0.25 * p1.x + 0.75 * p2.x, y: 0.25 * p1.y + 0.75 * p2.y });
    }
    
    // On conserve le dernier point
    smoothed.push(pts[pts.length - 1]);
    
    state.tempPoints = smoothed;
    renderAll();
}

// --- FINALISATION ---

function finishCircle() {
    if (state.tempZone.r < 0.2) {
        customAlert("INFO", "Zone trop petite.");
        stopDrawing();
        return;
    }
    
    const group = state.groups[state.drawingGroupIndex];
    if (group) {
        pushHistory();
        group.zones.push({
            id: generateID(),
            name: "Zone " + (group.zones.length + 1),
            type: 'CIRCLE',
            cx: state.tempZone.cx,
            cy: state.tempZone.cy,
            r: state.tempZone.r,
            style: { ...state.drawOptions }
        });
        selectItem('zone', state.drawingGroupIndex, group.zones.length - 1);
        
        // Mise à jour de la liste latérale
        renderGroupsList();
        saveLocalState();
    }
    stopDrawing();
}

export function stopDrawing() {
    state.drawingMode = false;
    state.drawingType = null;
    state.tempZone = null;
    state.tempPoints = [];
    state.drawingGroupIndex = null;
    state.isFreeMode = false;
    state.isFreeDrawing = false;
    state.drawingPending = false;
    
    document.body.style.cursor = 'default';
    
    const notif = document.getElementById('drawing-notif');
    if(notif) notif.remove();
    
    hideToolbar();
    renderAll();
}

// Initialise le drag d'une zone (appelé depuis render.js lors du mousedown sur une zone)
export function handleZoneMouseDown(e, gIndex, zIndex) {
    const coords = getMapPercentCoords(e.clientX, e.clientY);
    const zone = state.groups[gIndex].zones[zIndex];

    state.draggingItem = {
        type: 'zone',
        groupIndex: gIndex,
        zoneIndex: zIndex,
        startMouseMap: coords,
        hasMoved: false,
        origCx: zone.cx || 0,
        origCy: zone.cy || 0,
        origPoints: zone.points ? JSON.parse(JSON.stringify(zone.points)) : []
    };
}
