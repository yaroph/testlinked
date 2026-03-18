import { state, saveLocalState } from './state.js';
import { renderAll, getMapPercentCoords } from './render.js';
import { handlePointClick } from './ui.js';
import { percentageToGps } from './utils.js';
import { handleMapMouseDown, handleMapMouseMove, handleMapMouseUp } from './zone-editor.js';
import { updateMapLiveCursor, clearMapLiveCursor } from './cloud.js';

const viewport = document.getElementById('viewport');
const mapWorld = document.getElementById('map-world');
const mapImage = document.getElementById('map-image');
const hudCoords = document.getElementById('coords-display');
const markersLayer = document.getElementById('markers-layer');

function isClientInsideViewport(clientX, clientY) {
    const rect = viewport?.getBoundingClientRect?.();
    if (!rect) return false;
    return clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
}

function updateZoomDisplay() {
    const zoomValue = document.getElementById('zoom-display-value');
    const zoomFill = document.getElementById('zoom-display-fill');
    const scale = Math.max(0.05, Number(state.view.scale || 1));
    const percentText = `${Math.round(scale * 100)}%`;
    const minScale = 0.05;
    const maxScale = 8;
    const ratio = Math.max(0, Math.min(1, Math.log(scale / minScale) / Math.log(maxScale / minScale)));

    if (zoomValue && zoomValue.textContent !== percentText) {
        zoomValue.textContent = percentText;
    }
    if (zoomFill) {
        zoomFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
}

function syncMapFrame() {
    if (!state.mapWidth || !state.mapHeight) return;

    if (mapWorld) {
        mapWorld.style.width = `${state.mapWidth}px`;
        mapWorld.style.height = `${state.mapHeight}px`;
    }

    if (mapImage) {
        mapImage.style.width = '100%';
        mapImage.style.height = '100%';
    }

    if (markersLayer) {
        markersLayer.style.transformOrigin = '0 0';
    }
}

export function setMapZoom(nextScale, options = {}) {
    const currentScale = Math.max(0.05, Number(state.view.scale || 1));
    const targetScale = Math.max(0.05, Math.min(8, Number(nextScale || currentScale)));
    if (!Number.isFinite(targetScale) || Math.abs(targetScale - currentScale) < 0.0001) return;

    const rect = viewport?.getBoundingClientRect?.();
    const anchorX = Number.isFinite(Number(options.anchorX))
        ? Number(options.anchorX)
        : Number(rect?.width || viewport?.clientWidth || 0) / 2;
    const anchorY = Number.isFinite(Number(options.anchorY))
        ? Number(options.anchorY)
        : Number(rect?.height || viewport?.clientHeight || 0) / 2;
    const ratio = targetScale / currentScale;

    state.view.x = anchorX - ((anchorX - state.view.x) * ratio);
    state.view.y = anchorY - ((anchorY - state.view.y) * ratio);
    state.view.scale = targetScale;

    renderAll();
    updateTransform();
}

export function stepMapZoom(direction = 1, options = {}) {
    const factor = direction > 0 ? 1.1 : 0.9;
    setMapZoom(Number(state.view.scale || 1) * factor, options);
}

export function updateTransform() {
    syncMapFrame();
    updateZoomDisplay();

    // 1. On applique le zoom UNIQUEMENT sur la carte (l'image de fond)
    mapWorld.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;

    if (markersLayer && state.mapWidth && state.mapHeight) {
        // 2. Pour les marqueurs, on change juste la taille du conteneur
        markersLayer.style.transform = `translate(${state.view.x}px, ${state.view.y}px)`;
        markersLayer.style.width = `${state.mapWidth * state.view.scale}px`;
        markersLayer.style.height = `${state.mapHeight * state.view.scale}px`;
        
        // 3. Gestion du Level of Detail (LOD)
        const zoomScale = Math.max(0.05, Number(state.view.scale || 1));
        document.body.style.setProperty('--map-zoom-scale', zoomScale.toFixed(3));
        if (zoomScale < 0.38) {
            document.body.classList.add('view-zoomed-out');
        } else {
            document.body.classList.remove('view-zoomed-out');
        }
    }

    try {
        window.dispatchEvent(new CustomEvent('bni:map-transform-changed', {
            detail: {
                x: state.view.x,
                y: state.view.y,
                scale: state.view.scale,
            }
        }));
    } catch (e) {}
}

export function startMarkerDrag(e, gIndex, pIndex) {
    const mouseStart = getMapPercentCoords(e.clientX, e.clientY);
    const point = state.groups[gIndex].points[pIndex];

    state.draggingMarker = {
        groupIndex: gIndex,
        pointIndex: pIndex,
        startX: e.clientX,
        startY: e.clientY,
        hasMoved: false,
        offsetX: point.x - mouseStart.x,
        offsetY: point.y - mouseStart.y
    };
    // Force cursor grabbing via CSS class on body usually, or inline
    viewport.style.cursor = 'grabbing';
}

export function initEngine() {
    // Gestion du chargement de l'image
    if(mapImage.complete) {
        state.mapWidth = mapImage.naturalWidth;
        state.mapHeight = mapImage.naturalHeight;
        syncMapFrame();
        centerMap();
    } else {
        mapImage.onload = () => {
            state.mapWidth = mapImage.naturalWidth;
            state.mapHeight = mapImage.naturalHeight;
            syncMapFrame();
            centerMap();
        };
        // Sécurité si l'image plante
        mapImage.onerror = () => {
            console.error("Erreur chargement carte.jpg");
        };
    }

    // Gestion du ZOOM (Wheel)
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? -1 : 1;
        const factor = 1 + (delta * 0.1);
        setMapZoom(Number(state.view.scale || 1) * factor, { anchorX: mouseX, anchorY: mouseY });
    }, { passive: false });

    // Gestion du CLIC (Drag Map start)
    viewport.addEventListener('mousedown', (e) => {
        if (state.draggingMarker) return; 
        if (state.drawingMode || state.draggingItem) {
            handleMapMouseDown(e);
            return;
        }
        
        // Outil Mesure
        if (state.measuringMode && e.button === 0) {
            const coords = getMapPercentCoords(e.clientX, e.clientY);
            if (state.measureStep === 0 || state.measureStep === 2) {
                state.measurePoints = [coords, coords];
                state.measureStep = 1;
            } else if (state.measureStep === 1) {
                state.measurePoints[1] = coords;
                state.measureStep = 2;
            }
            renderAll();
            return;
        }

        // Drag Map
        if(e.button === 0) {
            state.isDragging = true;
            state.lastMouse = { x: e.clientX, y: e.clientY };
            viewport.style.cursor = 'grabbing';
        }
    });

    // --- OPTIMISATION : BOUCLE DE RENDU SOURIS (requestAnimationFrame) ---
    let isMouseMovePending = false;
    let mouseEvent = null;

    window.addEventListener('mousemove', (e) => {
        // On stocke l'event le plus récent
        mouseEvent = e;

        // Si une frame est déjà prévue, on ne fait rien (on attend qu'elle se lance)
        if (!isMouseMovePending) {
            isMouseMovePending = true;
            requestAnimationFrame(processMouseMove);
        }
    });

    function processMouseMove() {
        if (!mouseEvent) {
            isMouseMovePending = false;
            return;
        }

        const e = mouseEvent;
        if (isClientInsideViewport(e.clientX, e.clientY)) {
            const coords = getMapPercentCoords(e.clientX, e.clientY);
            updateMapLiveCursor(coords.x, coords.y);
        } else {
            clearMapLiveCursor();
        }
        
        // 1. Mise à jour HUD (optimisée)
        updateHUDCoords(e);

        if (state.drawingMode || state.draggingItem) {
            handleMapMouseMove(e);
            isMouseMovePending = false;
            return;
        }
        
        // 2. Drag d'un marqueur
        if (state.draggingMarker) {
            const dx = Math.abs(e.clientX - state.draggingMarker.startX);
            const dy = Math.abs(e.clientY - state.draggingMarker.startY);

            if (dx > 5 || dy > 5 || state.draggingMarker.hasMoved) {
                state.draggingMarker.hasMoved = true;
                
                const coords = getMapPercentCoords(e.clientX, e.clientY);
                const gIdx = state.draggingMarker.groupIndex;
                const pIdx = state.draggingMarker.pointIndex;
                
                state.groups[gIdx].points[pIdx].x = coords.x + state.draggingMarker.offsetX;
                state.groups[gIdx].points[pIdx].y = coords.y + state.draggingMarker.offsetY;
                
                renderAll({ fast: true });
            }
        }
        // 3. Outil Mesure (étape intermédiaire)
        else if (state.measuringMode && state.measureStep === 1) {
            const coords = getMapPercentCoords(e.clientX, e.clientY);
            state.measurePoints[1] = coords;
            renderAll({ fast: true });
        }
        // 4. Drag de la carte
        else if (state.isDragging && !state.drawingMode) {
            const dx = e.clientX - state.lastMouse.x;
            const dy = e.clientY - state.lastMouse.y;
            state.view.x += dx;
            state.view.y += dy;
            state.lastMouse = { x: e.clientX, y: e.clientY };
            updateTransform();
        }

        // Fin du traitement, on autorise la prochaine frame
        isMouseMovePending = false;
    }

    // Gestion RELACHEMENT CLIC
    window.addEventListener('mouseup', (e) => {
        if (state.drawingMode || state.draggingItem) {
            handleMapMouseUp(e);
            return;
        }
        if (state.draggingMarker) {
            if (!state.draggingMarker.hasMoved) {
                handlePointClick(state.draggingMarker.groupIndex, state.draggingMarker.pointIndex);
            } else {
                saveLocalState();
            }
            state.draggingMarker = null;
            renderAll(); 
        }

        state.isDragging = false;
        // Reset curseur si pas d'outil actif
        if(!state.drawingMode && !state.measuringMode) {
             viewport.style.cursor = ''; // Laisse le CSS gérer (crosshair)
        }
    });

    viewport.addEventListener('mouseleave', () => {
        clearMapLiveCursor();
    });

    window.addEventListener('blur', () => {
        clearMapLiveCursor({ broadcast: true, resetPosition: true });
    });
}

export function centerMap() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if(!state.mapWidth) return;
    const scale = Math.min(vw / state.mapWidth, vh / state.mapHeight);
    state.view.scale = scale || 0.5;
    state.view.x = (vw - state.mapWidth * state.view.scale) / 2;
    state.view.y = (vh - state.mapHeight * state.view.scale) / 2;
    updateTransform();
}

function updateHUDCoords(e) {
    if(state.mapWidth === 0 || !hudCoords) return;
    const coords = getMapPercentCoords(e.clientX, e.clientY);
    const gps = percentageToGps(coords.x, coords.y);
    hudCoords.innerText = `GPS: ${gps.x.toFixed(2)} | ${gps.y.toFixed(2)}`;
}
