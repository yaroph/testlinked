import { state, pushHistory, scheduleSave, linkHasNode } from './state.js';
import { restartSim } from './physics.js'; // CORRECTION : Import depuis physics.js
import { calculateHVT } from './logic.js';
import { draw } from './render.js';
// On importe depuis ui.js les fonctions nécessaires
import { selectNode, renderEditor, updatePathfindingPanel, refreshLists, showCustomConfirm, refreshHvt } from './ui.js';

let settingsPanel = null;
let contextMenu = null;

const DEFAULT_PHYSICS_SETTINGS = {
    repulsion: 1200,
    gravity: 0.005,
    linkLength: 220,
    friction: 0.3,
    collision: 50,
    enemyForce: 300,
    structureRepulsion: 0.1,
    curveStrength: 1.0,
    socialLinkStrength: 0.34,
    socialLinkDistanceMult: 0.78,
    businessLinkStrength: 0.26,
    businessLinkDistanceMult: 1.08,
    companyChargeMultiplier: 5,
    groupChargeMultiplier: 3,
    companyTerritoryRadius: 450,
    groupTerritoryRadius: 350,
    enemyDistanceMultiplier: 1.0,
    presetId: 'standard'
};

const PHYSICS_PRESETS = [
    {
        id: 'standard',
        label: 'Standard',
        hint: 'Vision equilibree du reseau.',
        patch: {}
    },
    {
        id: 'enemy_far',
        label: 'Ennemis tres eloignes',
        hint: 'Eclate les hostiles en premier plan et desserre le reste.',
        patch: {
            enemyForce: 960,
            enemyDistanceMultiplier: 2.6,
            repulsion: 1520,
            gravity: 0.0025,
            linkLength: 240
        }
    },
    {
        id: 'enemy_near',
        label: 'Ennemis proches',
        hint: 'Concentre les hostiles et expulse les non-hostiles en peripherie.',
        patch: {
            enemyForce: 90,
            enemyDistanceMultiplier: 0.32,
            gravity: 0.011,
            linkLength: 180,
            repulsion: 1440
        }
    },
    {
        id: 'friends_close',
        label: 'Amis proches',
        hint: 'Regroupe le social au coeur et eloigne les autres circuits.',
        patch: {
            socialLinkStrength: 0.98,
            socialLinkDistanceMult: 0.3,
            businessLinkStrength: 0.14,
            businessLinkDistanceMult: 1.4,
            companyChargeMultiplier: 7,
            repulsion: 1360,
            gravity: 0.008
        }
    },
    {
        id: 'group_cluster',
        label: 'Groupuscule fort',
        hint: 'Dessine des noyaux de groupe beaucoup plus lisibles.',
        patch: {
            groupChargeMultiplier: 1.2,
            groupTerritoryRadius: 200,
            businessLinkStrength: 0.48,
            businessLinkDistanceMult: 0.62,
            structureRepulsion: 0.05,
            gravity: 0.009,
            linkLength: 190
        }
    },
    {
        id: 'companies_far',
        label: 'Entreprises tres loin',
        hint: 'Etire les blocs business et place les entreprises comme des poles.',
        patch: {
            companyChargeMultiplier: 11,
            companyTerritoryRadius: 820,
            structureRepulsion: 0.22,
            businessLinkDistanceMult: 1.46,
            repulsion: 1680,
            gravity: 0.0028,
            linkLength: 250
        }
    },
    {
        id: 'groups_far',
        label: 'Groupes tres loin',
        hint: 'Separe les factions tres loin avec des satellites plus lisibles.',
        patch: {
            groupChargeMultiplier: 6.4,
            groupTerritoryRadius: 700,
            structureRepulsion: 0.18,
            linkLength: 270,
            repulsion: 1560,
            gravity: 0.003
        }
    }
];

function cloneDefaultPhysicsSettings() {
    return { ...DEFAULT_PHYSICS_SETTINGS };
}

function ensurePhysicsSettingsShape() {
    const nextSettings = {
        ...cloneDefaultPhysicsSettings(),
        ...(state.physicsSettings && typeof state.physicsSettings === 'object' ? state.physicsSettings : {})
    };
    const presetId = String(nextSettings.presetId || 'custom');
    nextSettings.presetId = PHYSICS_PRESETS.some((entry) => entry.id === presetId) ? presetId : 'custom';
    state.physicsSettings = nextSettings;
    return nextSettings;
}

function formatSettingValue(key, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value ?? '');
    if (key === 'gravity' || key === 'structureRepulsion') return numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    if (key === 'friction') return numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    if (String(key).toLowerCase().includes('mult') || String(key).toLowerCase().includes('strength')) {
        return numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    }
    return String(Math.round(numeric * 100) / 100);
}

function buildPresetButtonsMarkup() {
    return PHYSICS_PRESETS.map((preset) => `
        <button type="button" class="settings-preset-btn" data-preset-id="${preset.id}">
            <span class="settings-preset-name">${preset.label}</span>
            <span class="settings-preset-hint-inline">${preset.hint}</span>
        </button>
    `).join('');
}

function applyPhysicsPreset(presetId) {
    ensurePhysicsSettingsShape();
    const preset = PHYSICS_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    state.physicsSettings = {
        ...cloneDefaultPhysicsSettings(),
        ...preset.patch,
        presetId: preset.id
    };
    updateSettingsUI();
    restartSim();
    if (typeof window !== 'undefined' && typeof window.recenterGraphView === 'function') {
        window.recenterGraphView({ save: false });
    }
    draw();
    scheduleSave();
}

function attachDraggablePanel(panel, handle, closeSelector = '') {
    if (!panel || !handle) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (closeSelector && event.target && event.target.closest(closeSelector)) return;
        const rect = panel.getBoundingClientRect();
        isDragging = true;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        panel.classList.add('dragging');
        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!isDragging) return;
        let nextX = event.clientX - offsetX;
        let nextY = event.clientY - offsetY;
        const maxX = window.innerWidth - panel.offsetWidth - 10;
        const maxY = window.innerHeight - panel.offsetHeight - 10;
        nextX = Math.max(10, Math.min(nextX, maxX));
        nextY = Math.max(10, Math.min(nextY, maxY));
        panel.style.left = `${nextX}px`;
        panel.style.top = `${nextY}px`;
        panel.style.right = 'auto';
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove('dragging');
    });
}

// --- GESTION DU PANNEAU REGLAGES ---
export function showSettings() {
    ensurePhysicsSettingsShape();
    if (!settingsPanel) createSettingsPanel();
    updateSettingsUI();
    const isHidden = (settingsPanel.style.display === 'none');
    settingsPanel.style.display = isHidden ? 'block' : 'none';
}

function createSettingsPanel() {
    const existing = document.getElementById('settings-panel');
    if (existing) existing.remove();

    settingsPanel = document.createElement('div');
    settingsPanel.id = 'settings-panel';
    settingsPanel.style.display = 'none';
    
    const ICON_GLOBE = `<svg class="settings-mode-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;

    settingsPanel.innerHTML = `
        <div class="settings-header">
            <div class="settings-header-copy">
                <h3>Vision reseau</h3>
                <div class="settings-header-sub">Glisse la barre pour deplacer le panneau</div>
            </div>
            <button type="button" class="settings-close ui-close-x" id="btnCloseSettings" aria-label="Fermer">×</button>
        </div>

        <div class="settings-hero">
            <div class="settings-hero-title">Reglages rapides</div>
            <div class="settings-hero-sub">Commence par le preset, puis ajuste seulement si besoin.</div>
        </div>

        <div class="settings-preset-shell">
            <div class="settings-preset-head">
                <div class="settings-preset-title">Presets pre-faits</div>
                <div class="settings-preset-sub">Change la lecture du reseau en un clic</div>
            </div>
            <div id="settingsPresetGrid" class="settings-preset-grid">${buildPresetButtonsMarkup()}</div>
            <div id="settingsPresetHint" class="settings-preset-hint"></div>
        </div>

        <div class="settings-quick-grid">
            <div class="settings-mode-card">
                <div class="settings-mode-label">
                    ${ICON_GLOBE} <span>Mode planete</span>
                </div>
                <label class="hud-toggle">
                    <input type="checkbox" id="chkGlobeInner"/>
                    <div class="toggle-track"><div class="toggle-thumb"></div></div>
                </label>
            </div>
            <div class="settings-quick-card">
                <div class="settings-quick-label">Top HVT</div>
                <div class="settings-quick-value" id="val-hvtTop">OFF</div>
                <input type="range" id="sl-hvtTop" min="0" max="30" step="1">
                <div class="settings-quick-help">0 = OFF</div>
            </div>
        </div>

        <details class="settings-advanced-shell">
            <summary class="settings-advanced-toggle">Reglages avances</summary>
            <div class="settings-advanced-body">
                <div class="setting-row"><label>Repulsion globale <span id="val-repulsion" class="setting-val"></span></label><input type="range" id="sl-repulsion" min="100" max="5000" step="50"></div>
                <div class="setting-row"><label>Force ennemis <span id="val-enemyForce" class="setting-val"></span></label><input type="range" id="sl-enemyForce" min="50" max="1000" step="10"></div>
                <div class="setting-row"><label>Force entreprises <span id="val-structureRepulsion" class="setting-val"></span></label><input type="range" id="sl-structureRepulsion" min="0.01" max="0.5" step="0.01"></div>
                <div class="setting-row"><label>Gravite centrale <span id="val-gravity" class="setting-val"></span></label><input type="range" id="sl-gravity" min="0" max="0.1" step="0.001"></div>
                <div class="setting-row"><label>Longueur liens <span id="val-linkLength" class="setting-val"></span></label><input type="range" id="sl-linkLength" min="50" max="600" step="10"></div>
                <div class="setting-row"><label>Collision <span id="val-collision" class="setting-val"></span></label><input type="range" id="sl-collision" min="0" max="200" step="5"></div>
                <div class="setting-row"><label>Friction <span id="val-friction" class="setting-val"></span></label><input type="range" id="sl-friction" min="0.1" max="0.9" step="0.05"></div>
                <div class="setting-row"><label>Courbure liens <span id="val-curveStrength" class="setting-val"></span></label><input type="range" id="sl-curveStrength" min="0" max="3" step="0.1"></div>
            </div>
        </details>

        <div class="settings-actions">
            <button class="primary settings-reset-btn" id="btnResetPhysics">Rétablir défaut</button>
        </div>
    `;
    document.body.appendChild(settingsPanel);

    // Listeners
    document.getElementById('btnCloseSettings').onclick = () => { settingsPanel.style.display = 'none'; };
    document.getElementById('chkGlobeInner').onchange = (e) => { state.globeMode = e.target.checked; restartSim(); scheduleSave(); };
    document.getElementById('btnResetPhysics').onclick = resetPhysicsDefaults;
    settingsPanel.querySelectorAll('[data-preset-id]').forEach((btn) => {
        btn.onclick = () => applyPhysicsPreset(btn.getAttribute('data-preset-id') || '');
    });
    attachDraggablePanel(settingsPanel, settingsPanel.querySelector('.settings-header'), '#btnCloseSettings');

    bindSlider('sl-repulsion', 'repulsion');
    bindSlider('sl-gravity', 'gravity');
    bindSlider('sl-linkLength', 'linkLength');
    bindSlider('sl-collision', 'collision');
    bindSlider('sl-friction', 'friction');
    bindSlider('sl-curveStrength', 'curveStrength');
    bindSlider('sl-enemyForce', 'enemyForce');
    bindSlider('sl-structureRepulsion', 'structureRepulsion');
    bindHvtTop();
}

function bindSlider(id, key) {
    const sl = document.getElementById(id);
    if(sl) {
        sl.oninput = (e) => {
            state.physicsSettings[key] = parseFloat(e.target.value);
            state.physicsSettings.presetId = 'custom';
            updateSettingsUI();
            restartSim();
            draw();
            scheduleSave();
        };
    }
}

function updateSettingsUI() {
    if(!settingsPanel) return;
    const S = ensurePhysicsSettingsShape();
    const updateVal = (id, key) => {
        const sl = document.getElementById(id);
        const val = document.getElementById(id.replace('sl-', 'val-'));
        if(sl && val && S[key] !== undefined) { 
            sl.value = S[key]; 
            val.innerText = formatSettingValue(key, S[key]); 
        }
    };
    
    updateVal('sl-repulsion', 'repulsion');
    updateVal('sl-gravity', 'gravity');
    updateVal('sl-linkLength', 'linkLength');
    updateVal('sl-collision', 'collision');
    updateVal('sl-friction', 'friction');
    updateVal('sl-curveStrength', 'curveStrength');
    updateVal('sl-enemyForce', 'enemyForce');
    updateVal('sl-structureRepulsion', 'structureRepulsion');
    
    const globe = document.getElementById('chkGlobeInner');
    if(globe) globe.checked = state.globeMode;

    const hvtSl = document.getElementById('sl-hvtTop');
    const hvtVal = document.getElementById('val-hvtTop');
    if (hvtSl && hvtVal) {
        const n = Math.max(0, Number(state.hvtTopN) || 0);
        hvtSl.value = n;
        hvtVal.innerText = n === 0 ? 'OFF' : n;
    }

    const activePresetId = String(S.presetId || 'custom');
    settingsPanel.querySelectorAll('[data-preset-id]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-preset-id') === activePresetId);
    });
    const presetHint = document.getElementById('settingsPresetHint');
    if (presetHint) {
        const activePreset = PHYSICS_PRESETS.find((entry) => entry.id === activePresetId);
        presetHint.textContent = activePreset
            ? activePreset.hint
            : 'Mode custom: tu as modifie les reglages a la main.';
    }
}

function resetPhysicsDefaults() {
    state.physicsSettings = cloneDefaultPhysicsSettings();
    state.globeMode = true;
    updateSettingsUI();
    restartSim();
    if (typeof window !== 'undefined' && typeof window.recenterGraphView === 'function') {
        window.recenterGraphView({ save: false });
    }
    draw();
    scheduleSave();
}

function bindHvtTop() {
    const sl = document.getElementById('sl-hvtTop');
    if (sl) {
        sl.oninput = (e) => {
            state.hvtTopN = parseInt(e.target.value, 10) || 0;
            updateSettingsUI();
            calculateHVT();
            draw();
            scheduleSave();
            if (window.updateHvtPanel) window.updateHvtPanel();
        };
    }
}

// --- GESTION DU CLIC DROIT (CONTEXT MENU) ---
export function showContextMenu(node, x, y) {
    if (!contextMenu) {
        contextMenu = document.createElement('div');
        contextMenu.id = 'context-menu';
        document.body.appendChild(contextMenu);
    }
    
    contextMenu.innerHTML = `
        <div class="ctx-item" data-action="link">🔗 Lier à...</div>
        <div class="ctx-item" data-action="source">🚩 Définir Source IA</div>
        <div class="ctx-item" data-action="color">🎨 Changer couleur</div>
        <div class="ctx-divider"></div>
        <div class="ctx-item danger" data-action="delete">🗑️ Supprimer</div>
    `;

    // Positionnement intelligent
    const menuW = 180, menuH = 160;
    let posX = x, posY = y;
    if (x + menuW > window.innerWidth) posX = x - menuW;
    if (y + menuH > window.innerHeight) posY = y - menuH;
    contextMenu.style.left = posX + 'px';
    contextMenu.style.top = posY + 'px';
    contextMenu.style.display = 'flex';

    // Event Delegation pour les clics
    contextMenu.onclick = (e) => {
        const action = e.target.getAttribute('data-action');
        if (!action) return;
        handleContextAction(action, node);
        hideContextMenu();
    };
}

export function hideContextMenu() {
    if (contextMenu) contextMenu.style.display = 'none';
}

function handleContextAction(action, n) {
    if (action === 'delete') {
        showCustomConfirm(`Supprimer "${n.name}" ?`, () => {
            pushHistory(); 
            state.nodes = state.nodes.filter(x => x.id !== n.id);
            state.links = state.links.filter(l => !linkHasNode(l, n.id));
            state.selection = null; restartSim(); refreshLists(); renderEditor(); updatePathfindingPanel();
            scheduleSave();
            refreshHvt();
        });
    } else if (action === 'source') {
        state.pathfinding.startId = n.id;
        state.pathfinding.active = false;
        updatePathfindingPanel();
        draw();
    } else if (action === 'link') {
        selectNode(n.id);
        const details = document.querySelectorAll('details');
        if(details[2]) details[2].open = true; // Ouvre l'onglet Ajout
    } else if (action === 'color') {
        selectNode(n.id);
        setTimeout(() => { const col = document.getElementById('edColor'); if(col) col.click(); }, 100);
    }
}
