import { state, saveState } from './state.js';
import { getSimulation } from './physics.js';
import { draw } from './render.js';
import { screenToWorld, clamp } from './utils.js';
import {
    selectNode,
    renderEditor,
    updatePathfindingPanel,
    addLink,
    clearIntelPairPreview,
    updatePointLiveCursor,
    clearPointLiveCursor,
    isCloudBoardReadOnly,
    ensureCloudWriteAccess
} from './ui.js';

function getD3() {
    if (typeof globalThis !== 'undefined' && globalThis.d3) return globalThis.d3;
    if (typeof window !== 'undefined' && window.d3) return window.d3;
    return null;
}

function findNodeAtPosition(worldX, worldY, radius = 40) {
    const sim = getSimulation();
    if (sim && typeof sim.find === 'function') {
        return sim.find(worldX, worldY, radius);
    }

    let bestNode = null;
    let bestDistSq = radius * radius;
    state.nodes.forEach((node) => {
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
        const dx = worldX - Number(node.x);
        const dy = worldY - Number(node.y);
        const distSq = (dx * dx) + (dy * dy);
        if (distSq <= bestDistSq) {
            bestNode = node;
            bestDistSq = distSq;
        }
    });
    return bestNode;
}

function getCanvasEventPosition(event, canvas) {
    const source = event?.sourceEvent || event;
    const rect = canvas.getBoundingClientRect();
    const touch = source?.touches?.[0] || source?.changedTouches?.[0] || null;
    const clientX = Number(touch?.clientX ?? source?.clientX ?? 0);
    const clientY = Number(touch?.clientY ?? source?.clientY ?? 0);

    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function getWorldPositionFromEvent(event, canvas) {
    const point = getCanvasEventPosition(event, canvas);
    return screenToWorld(point.x, point.y, canvas, state.view);
}

function isClientInsideCanvas(clientX, clientY, canvas) {
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect) return false;
    return clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
}

export function setupCanvasEvents(canvas) {
    if (!canvas) return;
    const NODE_DRAG_THRESHOLD_PX = 6;
    const SUPPRESSED_CLICK_TTL_MS = 260;
    const nowMs = () => {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    };
    const clearSuppressedClick = () => {
        suppressedClick = null;
    };
    const markSuppressedClick = (clientX, clientY) => {
        suppressedClick = {
            x: Number(clientX || 0),
            y: Number(clientY || 0),
            until: nowMs() + SUPPRESSED_CLICK_TTL_MS
        };
    };
    const shouldSuppressClick = (event) => {
        if (!suppressedClick) return false;
        const currentTime = Number.isFinite(event?.timeStamp) ? Number(event.timeStamp) : nowMs();
        if (currentTime > suppressedClick.until) {
            clearSuppressedClick();
            return false;
        }
        const dx = Math.abs(Number(event?.clientX || 0) - suppressedClick.x);
        const dy = Math.abs(Number(event?.clientY || 0) - suppressedClick.y);
        if (dx <= NODE_DRAG_THRESHOLD_PX && dy <= NODE_DRAG_THRESHOLD_PX) {
            clearSuppressedClick();
            return true;
        }
        return false;
    };
    
    // 1. ZOOM (CORRIGÉ ET SYNCHRONISÉ)
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const mouse = getCanvasEventPosition(e, canvas);

        // 1. Où est la souris dans le monde AVANT le zoom ?
        // On utilise la fonction centralisée screenToWorld pour être cohérent avec le clic
        const mouseBefore = screenToWorld(mouse.x, mouse.y, canvas, state.view);

        // 2. Calcul du nouveau zoom
        const delta = (e.deltaY < 0) ? 1.1 : 0.9;
        const newScale = clamp(state.view.scale * delta, 0.1, 5.0);

        // 3. Application du zoom
        state.view.scale = newScale;

        // 4. Recalcul de la position (Pan) pour que la souris reste au même endroit du monde
        // Formule inverse de screenToWorld :
        // screenX = worldX * scale + viewX + width/2
        // => viewX = screenX - width/2 - worldX * scale
        state.view.x = mouse.x - canvas.clientWidth / 2 - (mouseBefore.x * newScale);
        state.view.y = mouse.y - canvas.clientHeight / 2 - (mouseBefore.y * newScale);

        draw();
    }, { passive: false });


    // 2. SOURIS (CLIC & DRAG MANUEL)
    let isPanning = false;
    let pendingPan = false;
    let panStart = { x: 0, y: 0 };
    let lastPan = { x: 0, y: 0 };
    let dragLinkSource = null;
    let suppressedClick = null;

    canvas.addEventListener('mousedown', (e) => {
        // Calcul précis de la position monde
        const p = getWorldPositionFromEvent(e, canvas);
        updatePointLiveCursor(p.x, p.y);
        
        // On cherche un nœud sous la souris (Rayon 40px)
        const hit = findNodeAtPosition(p.x, p.y, 40); 
        
        // Cas 1 : Création de lien (Shift + Clic)
        if (e.shiftKey && hit) {
            if (isCloudBoardReadOnly()) {
                ensureCloudWriteAccess();
                return;
            }
            dragLinkSource = hit;
            state.tempLink = { x1: hit.x, y1: hit.y, x2: hit.x, y2: hit.y };
            draw(); 
            e.stopImmediatePropagation(); // Empêche D3 d'interférer
            return;
        }
        
        // Cas 2 : Panoramique (Clic Gauche DANS LE VIDE)
        // On vérifie bien !hit pour ne pas bouger si on est sur un noeud
        if (!hit && e.button === 0) {
            pendingPan = true;
            isPanning = false;
            panStart = { x: e.clientX, y: e.clientY };
            lastPan = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'default';
        }
    });

    const handleGlobalPointerMove = (e) => {
        if (isClientInsideCanvas(e.clientX, e.clientY, canvas)) {
            const cursorPoint = getWorldPositionFromEvent(e, canvas);
            updatePointLiveCursor(cursorPoint.x, cursorPoint.y);
        } else {
            clearPointLiveCursor();
        }

        if (dragLinkSource) {
            const p = getWorldPositionFromEvent(e, canvas);
            state.tempLink.x2 = p.x;
            state.tempLink.y2 = p.y;
            draw();
            return;
        }

        if (pendingPan || isPanning) {
            if (!isPanning) {
                const totalDx = e.clientX - panStart.x;
                const totalDy = e.clientY - panStart.y;
                if (Math.abs(totalDx) < NODE_DRAG_THRESHOLD_PX && Math.abs(totalDy) < NODE_DRAG_THRESHOLD_PX) {
                    return;
                }
                isPanning = true;
                canvas.style.cursor = 'grabbing';
            }
            const dx = e.clientX - lastPan.x;
            const dy = e.clientY - lastPan.y;
            lastPan = { x: e.clientX, y: e.clientY };
            state.view.x += dx;
            state.view.y += dy;
            draw();
        }
    };

    const handleGlobalPointerUp = (e) => {
        if (dragLinkSource) {
            const p = getWorldPositionFromEvent(e, canvas);
            const hit = findNodeAtPosition(p.x, p.y, 40);
            markSuppressedClick(e.clientX, e.clientY);

            if (hit && hit.id !== dragLinkSource.id) {
                const success = addLink(dragLinkSource, hit, null);
                if (success) selectNode(dragLinkSource.id);
            }
            dragLinkSource = null;
            state.tempLink = null;
            draw();
            return;
        }

        pendingPan = false;
        if (isPanning) {
            isPanning = false;
            markSuppressedClick(e.clientX, e.clientY);
            canvas.style.cursor = 'default';
        }
    };

    canvas.addEventListener('mousemove', (e) => {
        if (pendingPan || isPanning || dragLinkSource) return;

        const p = getWorldPositionFromEvent(e, canvas);
        updatePointLiveCursor(p.x, p.y);
        const hit = findNodeAtPosition(p.x, p.y, 40);
        if (hit) {
            if (state.hoverId !== hit.id) { state.hoverId = hit.id; canvas.style.cursor = 'pointer'; draw(); }
        } else {
            if (state.hoverId !== null) { state.hoverId = null; canvas.style.cursor = 'default'; draw(); }
        }
    });

    window.addEventListener('mousemove', handleGlobalPointerMove);
    window.addEventListener('mouseup', handleGlobalPointerUp);

    canvas.addEventListener('click', (e) => {
        if (shouldSuppressClick(e)) {
            return;
        }
        if (e.shiftKey || e.button !== 0) return;

        const p = getWorldPositionFromEvent(e, canvas);
        const hit = findNodeAtPosition(p.x, p.y, 40);
        if (hit) {
            selectNode(hit.id);
        } else if (state.selection) {
            clearIntelPairPreview({ redraw: false });
            state.selection = null;
            renderEditor();
            updatePathfindingPanel();
            draw();
        } else if (state.aiPreviewPair) {
            clearIntelPairPreview();
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (pendingPan || isPanning || dragLinkSource) return;
        clearPointLiveCursor();
        state.hoverId = null;
        canvas.style.cursor = 'default';
        draw();
    });

    window.addEventListener('blur', () => {
        clearPointLiveCursor({ broadcast: true, resetPosition: true });
        pendingPan = false;
        isPanning = false;
        dragLinkSource = null;
        state.tempLink = null;
        state.hoverId = null;
        clearSuppressedClick();
        clearIntelPairPreview({ redraw: false, syncRows: false });
        canvas.style.cursor = 'default';
        draw();
    });

    // 3. CONFIGURATION D3 DRAG (Pour bouger les nœuds)
    const d3lib = getD3();
    if (!d3lib?.select || !d3lib?.drag) {
        return;
    }

    d3lib.select(canvas).call(d3lib.drag()
        .container(canvas)
        .filter(event => !event.shiftKey && event.button === 0) // Uniquement Clic Gauche sans Shift
        .subject(e => {
            // On utilise screenToWorld ici aussi pour être cohérent !
            const p = getWorldPositionFromEvent(e, canvas);
            return findNodeAtPosition(p.x, p.y, 40);
        })
        .on("start", e => {
            const sim = getSimulation();
            if (!sim) return;
            if (isCloudBoardReadOnly()) {
                e.on?.('drag', null);
                return;
            }
            if (!e.active) sim.alphaTarget(0.3).restart();
            if (e.subject) {
                e.subject.__dragStartClientX = Number(e.sourceEvent?.clientX || 0);
                e.subject.__dragStartClientY = Number(e.sourceEvent?.clientY || 0);
                e.subject.__dragMoved = false;
                e.subject.fx = e.subject.x; 
                e.subject.fy = e.subject.y; 
            }
        })
        .on("drag", e => {
            if (isCloudBoardReadOnly()) return;
            if (e.subject) {
                const dx = Math.abs(Number(e.sourceEvent?.clientX || 0) - Number(e.subject.__dragStartClientX || 0));
                const dy = Math.abs(Number(e.sourceEvent?.clientY || 0) - Number(e.subject.__dragStartClientY || 0));
                if (!e.subject.__dragMoved && dx < NODE_DRAG_THRESHOLD_PX && dy < NODE_DRAG_THRESHOLD_PX) {
                    return;
                }
                e.subject.__dragMoved = true;

                // Conversion continue pendant le mouvement
                const p = getWorldPositionFromEvent(e, canvas);
                e.subject.fx = p.x; 
                e.subject.fy = p.y;
            }
        })
        .on("end", e => {
            const sim = getSimulation();
            if (!sim) return;
            if (!e.active) sim.alphaTarget(0);
            if (e.subject) {
                const moved = Boolean(e.subject.__dragMoved);
                e.subject.fx = null; 
                e.subject.fy = null; 
                delete e.subject.__dragMoved;
                delete e.subject.__dragStartClientX;
                delete e.subject.__dragStartClientY;

                if (moved && !isCloudBoardReadOnly()) {
                    markSuppressedClick(e.sourceEvent?.clientX, e.sourceEvent?.clientY);
                    saveState();
                }
            }
        })
    );
}
