import { state, generateID, saveLocalState, pushHistory, removeTacticalLink, updateTacticalLink, findPointById } from './state.js';
import { renderAll, getMapPercentCoords } from './render.js';
import { renderGroupsList, selectItem } from './ui.js';
import { customAlert, customConfirm, customColorPicker } from './ui-modals.js';
import { startDrawingCircle, startDrawingFree } from './zone-editor.js';
import { ensureCloudWriteAccess } from './cloud.js';

let contextMenuOpen = false;
let contextClickPos = { x: 0, y: 0 };

// Élément Tooltip unique pour les liens
const tooltipEl = document.createElement('div');
tooltipEl.className = 'link-tooltip';
document.body.appendChild(tooltipEl);

export function initContextMenu() {
    const viewport = document.getElementById('viewport');
    const ctxMenu = document.getElementById('context-menu');
    const btnNewPoint = document.getElementById('ctx-new-point');
    const btnNewZone = document.getElementById('ctx-new-zone');
    const btnNewFree = document.getElementById('ctx-new-free-zone');
    const btnCancel = document.getElementById('ctx-cancel');

    if (!viewport || !ctxMenu) return;

    // 1. OUVRIR LE MENU (Clic Droit)
    viewport.addEventListener('contextmenu', (e) => {
        // On bloque le menu si on est en train de dessiner ou mesurer
        if(state.drawingMode || state.measuringMode) return;
        
        e.preventDefault();
        
        // Calcul position relative à la carte (%)
        contextClickPos = getMapPercentCoords(e.clientX, e.clientY);
        
        // Calcul position pixel pour afficher le menu (avec garde-fou bord d'écran)
        let x = e.clientX;
        let y = e.clientY;
        const w = 220; // largeur approx menu
        const h = 150; // hauteur approx menu
        
        if (x + w > window.innerWidth) x -= w;
        if (y + h > window.innerHeight) y -= h;

        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top = y + 'px';
        ctxMenu.classList.add('visible');
        contextMenuOpen = true;
    });

    // 2. FERMER LE MENU (Clic gauche ailleurs)
    window.addEventListener('click', () => {
        if (contextMenuOpen) {
            ctxMenu.classList.remove('visible');
            contextMenuOpen = false;
        }
    });

    // --- ACTIONS DU MENU ---

    // A. NOUVEAU POINT
    if (btnNewPoint) {
        btnNewPoint.onclick = () => {
            if (!ensureCloudWriteAccess()) return;
            if (state.groups.length === 0) {
                customAlert("ERREUR", "Créez d'abord un groupe dans le menu de gauche.");
                return;
            }
            
            // IMPORTANT : Sauvegarde pour Undo
            pushHistory();

            // On ajoute au premier groupe par défaut (ou le dernier utilisé)
            const targetGroupIndex = 0; 
            const newPoint = {
                id: generateID(),
                name: "Nouveau Point",
                x: contextClickPos.x,
                y: contextClickPos.y,
                iconType: "DEFAULT",
                type: "Inconnu",
                status: "ACTIVE"
            };

            state.groups[targetGroupIndex].points.push(newPoint);
            
            // On sélectionne le point créé pour l'éditer tout de suite
            selectItem('point', targetGroupIndex, state.groups[targetGroupIndex].points.length - 1);
            
            saveLocalState();
            renderAll();
            renderGroupsList();
        };
    }

    // B. NOUVELLE ZONE (Cercle)
    if (btnNewZone) {
        btnNewZone.onclick = () => {
            if (!ensureCloudWriteAccess()) return;
            if (state.groups.length === 0) {
                customAlert("ERREUR", "Créez d'abord un groupe dans le menu de gauche.");
                return;
            }
            startDrawingCircle(0);
        };
    }
    
    // C. DESSIN LIBRE
    if (btnNewFree) {
        btnNewFree.onclick = () => {
            if (!ensureCloudWriteAccess()) return;
            if (state.groups.length === 0) {
                customAlert("ERREUR", "Créez d'abord un groupe dans le menu de gauche.");
                return;
            }
            startDrawingFree(0);
        };
    }

    if (btnCancel) {
        btnCancel.onclick = () => {
            ctxMenu.classList.remove('visible');
        };
    }
}

// --- GESTION DES LIENS TACTIQUES ---

// Clic sur un lien : Ouvre un petit menu pour le supprimer ou le colorer
export function handleLinkClick(e, link) {
    // Nettoyage ancien menu si existe
    const oldMenu = document.getElementById('link-context-menu');
    if(oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'link-context-menu';
    menu.className = 'link-menu'; // Classe CSS définie dans style.css
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    
    // Ajout du bouton COULEUR
    menu.innerHTML = `
        <div class="link-menu-head">
            <div class="link-menu-title">LIAISON TACTIQUE</div>
            <button id="btnLinkClose" type="button" class="ui-close-x link-menu-close" aria-label="Fermer">×</button>
        </div>
        <button id="btnLinkColor">🎨 COULEUR</button>
        <div class="separator-h"></div>
        <button id="btnLinkDelete" style="color:#ff4444;">SUPPRIMER</button>
    `;

    document.body.appendChild(menu);

    // Action : Changer Couleur (Visuel)
    document.getElementById('btnLinkColor').onclick = async () => {
        if (!ensureCloudWriteAccess()) return;
        menu.remove(); // On ferme le petit menu d'abord
        
        // On ouvre le sélecteur visuel (palettes)
        const newColor = await customColorPicker("COULEUR LIAISON", link.color || "#ffffff");
        
        if (newColor) {
            pushHistory(); // Undo support
            updateTacticalLink(link.id, { color: newColor });
            saveLocalState();
            renderAll();
        }
    };

    // Action : Supprimer
    document.getElementById('btnLinkDelete').onclick = async () => {
        if (!ensureCloudWriteAccess()) return;
        menu.remove();
        if(await customConfirm("SUPPRESSION", "Supprimer cette liaison ?")) {
            pushHistory(); // Undo support
            removeTacticalLink(link.id);
            saveLocalState();
            renderAll();
        }
    };

    // Action : Fermer
    document.getElementById('btnLinkClose').onclick = () => menu.remove();

    // Fermeture automatique au clic ailleurs
    setTimeout(() => {
        const closeHandler = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}

// Survol lien : Affiche Tooltip
export function handleLinkHover(e, link) {
    const fromP = findPointById(link.from);
    const toP = findPointById(link.to);
    
    if(fromP && toP) {
        tooltipEl.innerHTML = `${fromP.name} <span style="color:var(--accent-cyan)">⇄</span> ${toP.name}`;
        tooltipEl.style.display = 'block';
        moveTooltip(e);
    }
}

// Sortie survol
export function handleLinkOut() {
    tooltipEl.style.display = 'none';
}

// Déplacement Tooltip
export function moveTooltip(e) {
    if (tooltipEl.style.display === 'block') {
        tooltipEl.style.left = (e.clientX + 15) + 'px';
        tooltipEl.style.top = (e.clientY + 15) + 'px';
    }
}
