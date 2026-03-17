import { state, saveLocalState } from './state.js';
import { renderAll } from './render.js'; 
import { renderEditor, closeEditor } from './ui-editor.js';
import { customAlert } from './ui-modals.js';
import { renderGroupsList } from './ui-list.js'; 
import { initContextMenu, handleLinkClick, handleLinkHover, handleLinkOut, moveTooltip } from './ui-menus.js';
import { stopDrawing } from './zone-editor.js';
import { addTacticalLink } from './state.js'; // Correction import
import { updateMapCloudPresence } from './cloud.js';

export { handleLinkClick, handleLinkHover, handleLinkOut, moveTooltip };

function hasMapOperationalContent() {
    const hasGroupsContent = state.groups.some((group) => {
        const pointCount = Array.isArray(group?.points) ? group.points.length : 0;
        const zoneCount = Array.isArray(group?.zones) ? group.zones.length : 0;
        return pointCount > 0 || zoneCount > 0;
    });
    return hasGroupsContent || (Array.isArray(state.tacticalLinks) && state.tacticalLinks.length > 0);
}

export function syncMapEmptyState() {
    const emptyState = document.getElementById('mapEmptyState');
    if (!emptyState) return;
    emptyState.hidden = hasMapOperationalContent();
}

function ensureInteractionModeHud() {
    let hud = document.getElementById('map-interaction-mode');
    if (hud) return hud;

    const viewport = document.getElementById('viewport');
    if (!viewport) return null;

    hud = document.createElement('div');
    hud.id = 'map-interaction-mode';
    hud.className = 'map-interaction-mode';
    hud.hidden = true;
    hud.innerHTML = `
        <div class="map-interaction-mode-copy">
            <span id="mapInteractionModeLabel" class="map-interaction-mode-label"></span>
            <span id="mapInteractionModeHint" class="map-interaction-mode-hint"></span>
        </div>
        <button id="mapInteractionModeCancel" class="hud-btn map-interaction-mode-cancel" type="button">Quitter</button>
    `;
    viewport.appendChild(hud);
    return hud;
}

function describeInteractionMode() {
    if (state.drawingMode && state.drawingType === 'CIRCLE') {
        return {
            label: 'Mode cercle',
            hint: state.drawingPending ? 'Valide ou annule la zone active.' : 'Clique puis glisse sur la carte.',
            cancel: () => {
                stopDrawing();
            }
        };
    }
    if (state.drawingMode && state.drawingType === 'POLYGON') {
        return {
            label: 'Mode zone',
            hint: state.drawingPending ? 'Valide ou annule la zone active.' : 'Trace la zone puis valide.',
            cancel: () => {
                stopDrawing();
            }
        };
    }
    if (state.linkingMode) {
        return {
            label: 'Mode liaison',
            hint: 'Clique sur une autre cible pour creer le lien.',
            cancel: () => {
                state.linkingMode = false;
                state.linkStartId = null;
                document.body.style.cursor = 'default';
                renderAll();
            }
        };
    }
    if (state.measuringMode) {
        return {
            label: 'Mode mesure',
            hint: 'Pose deux points pour mesurer, puis quitte.',
            cancel: () => {
                state.measuringMode = false;
                state.measureStep = 0;
                state.measurePoints = [];
                renderAll();
            }
        };
    }
    return null;
}

export function syncInteractionModeHud() {
    const hud = ensureInteractionModeHud();
    if (!hud) return;

    const mode = describeInteractionMode();
    if (!mode) {
        hud.hidden = true;
        hud.dataset.mode = 'idle';
        return;
    }

    hud.hidden = false;
    hud.dataset.mode = 'active';
    const label = document.getElementById('mapInteractionModeLabel');
    const hint = document.getElementById('mapInteractionModeHint');
    const cancel = document.getElementById('mapInteractionModeCancel');
    if (label) label.textContent = mode.label;
    if (hint) hint.textContent = mode.hint;
    if (cancel) cancel.onclick = () => mode.cancel();
}

export function initUI() {
    initContextMenu(); 
    ensureInteractionModeHud();
    syncInteractionModeHud();
    syncMapEmptyState();

    // Menu Mobile
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const sidebarLeft = document.getElementById('sidebar-left');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if(btnMobileMenu && sidebarLeft) {
        btnMobileMenu.onclick = () => {
            sidebarLeft.classList.toggle('mobile-active');
            if(sidebarOverlay) sidebarOverlay.classList.toggle('active');
        };
    }
    if(sidebarOverlay) {
        sidebarOverlay.onclick = () => {
            sidebarLeft.classList.remove('mobile-active');
            sidebarOverlay.classList.remove('active');
        };
    }

    // --- RECHERCHE (CRUCIAL) ---
    const searchInput = document.getElementById('searchInput');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchTerm = e.target.value.toLowerCase();
            renderGroupsList(); // Met à jour la liste (ouvre les dossiers)
            renderAll();        // Met à jour la carte (cache les points)
        });
    }

    // --- BOUTON NOMS (3 ÉTATS : AUTO -> ALWAYS -> NEVER) ---
    const btnLabels = document.getElementById('btnToggleLabels');
    if(btnLabels) {
        btnLabels.onclick = () => {
            const body = document.body;
            body.classList.remove('labels-auto', 'labels-always', 'labels-never');
            
            // Cycle : Auto -> Always -> Never -> Auto
            if (state.labelMode === 'auto') {
                state.labelMode = 'always';
                body.classList.add('labels-always');
                btnLabels.innerText = "NOMS: TOUJOURS";
                btnLabels.style.color = "#fff";
            } else if (state.labelMode === 'always') {
                state.labelMode = 'never';
                body.classList.add('labels-never');
                btnLabels.innerText = "NOMS: JAMAIS";
                btnLabels.style.color = "var(--text-dim)";
            } else {
                state.labelMode = 'auto';
                body.classList.add('labels-auto');
                btnLabels.innerText = "NOMS: AUTO";
                btnLabels.style.color = "var(--text-dim)";
            }
        };
    }

    syncInteractionModeHud();
}

export function handlePointClick(gIndex, pIndex) {
    const group = state.groups[gIndex];
    const point = group.points[pIndex];
    
    // Mode création de lien
    if (state.linkingMode) {
        if (state.linkStartId && state.linkStartId !== point.id) {
            const success = addTacticalLink(state.linkStartId, point.id);
            if (success) {
                customAlert("SUCCÈS", "Lien tactique créé.");
                saveLocalState();
            } else {
                customAlert("INFO", "Ce lien existe déjà ou est invalide.");
            }
            state.linkingMode = false;
            state.linkStartId = null;
            document.body.style.cursor = 'default';
            renderAll();
        }
        return;
    }
    
    // Sélection normale
    selectItem('point', gIndex, pIndex);
}

export function selectItem(type, gIndex, index) { 
    if (type === 'point') { 
        state.selectedPoint = { groupIndex: gIndex, pointIndex: index }; 
        state.selectedZone = null; 
    } else if (type === 'zone') { 
        state.selectedZone = { groupIndex: gIndex, zoneIndex: index }; 
        state.selectedPoint = null; 
    } else { 
        state.selectedPoint = null; 
        state.selectedZone = null; 
    }
    renderAll(); 
    renderEditor(); 
    updateMapCloudPresence().catch(() => {});
    syncInteractionModeHud();
}

export function selectPoint(gIndex, pIndex) { selectItem('point', gIndex, pIndex); }

export function deselect() { 
    state.selectedPoint = null; 
    state.selectedZone = null; 
    renderAll(); 
    closeEditor(); 
    updateMapCloudPresence().catch(() => {});
    syncInteractionModeHud();
}

export { renderGroupsList };
