import { state, exportToJSON, saveLocalState, pruneTacticalLinks } from './state.js';
import { renderGroupsList } from './ui.js'; // Nécessaire pour rafraîchir la liste après modif
import { renderAll } from './render.js';   // Nécessaire pour rafraîchir la carte

// Palette tactique
const TACTICAL_COLORS = [
    "#73fbf7", "#ff6b81", "#ffd400", "#ffffff", 
    "#00ff00", "#ff0000", "#bf00ff", "#ff8800", "#8892b0"
];

let activeTimeout = null;
let lastModalFocus = null;
let activeDismissHandler = null;

function restoreModalFocus() {
    const target = lastModalFocus;
    lastModalFocus = null;
    if (target && typeof target.focus === 'function') {
        requestAnimationFrame(() => target.focus());
    }
}

function hideModalOverlay(overlay, options = {}) {
    if (!overlay) return;
    overlay.classList.add('hidden');
    activeDismissHandler = null;
    if (options.restoreFocus !== false) restoreModalFocus();
}

function dismissModalOverlay(overlay) {
    const handler = activeDismissHandler;
    if (typeof handler === 'function') {
        activeDismissHandler = null;
        handler();
        return;
    }
    hideModalOverlay(overlay);
}

function prepareModalOverlay(overlay) {
    if (!overlay || overlay.dataset.modalEnhanced === 'true') return;
    overlay.dataset.modalEnhanced = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'modal-title');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) dismissModalOverlay(overlay);
    });
    overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            dismissModalOverlay(overlay);
        }
    });
    const closeBtn = overlay.querySelector('#modal-close-x');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => dismissModalOverlay(overlay));
    }
}

function showModalOverlay(overlay) {
    if (!overlay) return;
    prepareModalOverlay(overlay);
    const activeEl = document.activeElement;
    lastModalFocus = activeEl instanceof HTMLElement ? activeEl : null;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.focus());
}

function escapeMarkup(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createModalPromise(setupFn) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const contentEl = document.getElementById('modal-content');
        const actionsEl = document.getElementById('modal-actions');
        const inputContainer = document.getElementById('modal-input-container');
        const colorContainer = document.getElementById('modal-color-picker');
        
        if(!overlay) { console.error("Modal Missing"); return resolve(null); }
        prepareModalOverlay(overlay);
        
        if (activeTimeout) {
            clearTimeout(activeTimeout);
            activeTimeout = null;
        }
        showModalOverlay(overlay);

        inputContainer.style.display = 'none';
        colorContainer.style.display = 'none';
        actionsEl.classList.remove('cloud-actions');
        actionsEl.innerHTML = '';
        
        const close = (value) => {
            hideModalOverlay(overlay);
            activeTimeout = setTimeout(() => {
                resolve(value);
                activeTimeout = null;
            }, 300);
        };

        activeDismissHandler = () => close(null);
        setupFn({
            titleEl,
            contentEl,
            actionsEl,
            inputContainer,
            colorContainer,
            close,
            setDismissHandler(handler) {
                activeDismissHandler = typeof handler === 'function' ? handler : null;
            }
        });
    });
}

export function customAlert(title, msg) {
    return createModalPromise(({ titleEl, contentEl, actionsEl, close, setDismissHandler }) => {
        titleEl.innerText = title;
        contentEl.innerHTML = msg;
        const btn = document.createElement('button');
        btn.className = 'btn-modal-confirm';
        btn.innerText = "OK";
        btn.onclick = () => close(true);
        actionsEl.appendChild(btn);
        setDismissHandler(() => close(true));
        requestAnimationFrame(() => btn.focus());
    });
}

export function customConfirm(title, msg) {
    return createModalPromise(({ titleEl, contentEl, actionsEl, close, setDismissHandler }) => {
        titleEl.innerText = title;
        contentEl.innerHTML = msg;
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-modal-cancel';
        btnCancel.innerText = "ANNULER";
        btnCancel.onclick = () => close(false);
        const btnOk = document.createElement('button');
        btnOk.className = 'btn-modal-confirm';
        btnOk.innerText = "CONFIRMER";
        btnOk.onclick = () => close(true);
        actionsEl.append(btnCancel, btnOk);
        setDismissHandler(() => close(false));
        requestAnimationFrame(() => btnOk.focus());
    });
}

export function customPrompt(title, msg, defaultValue = "") {
    return createModalPromise(({ titleEl, contentEl, actionsEl, inputContainer, close, setDismissHandler }) => {
        titleEl.innerText = title;
        contentEl.innerHTML = msg;
        inputContainer.style.display = 'block';
        const input = document.getElementById('modal-input');
        input.value = defaultValue;
        input.focus();
        input.onkeydown = (e) => {
            if (e.key === 'Enter') close(input.value);
            if (e.key === 'Escape') {
                e.preventDefault();
                close(null);
            }
        };
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-modal-cancel';
        btnCancel.innerText = "ANNULER";
        btnCancel.onclick = () => close(null);
        const btnOk = document.createElement('button');
        btnOk.className = 'btn-modal-confirm';
        btnOk.innerText = "VALIDER";
        btnOk.onclick = () => close(input.value);
        actionsEl.append(btnCancel, btnOk);
        setDismissHandler(() => close(null));
    });
}

// --- ÉDITEUR DE GROUPE (NOUVEAU) ---
export function openGroupEditor(groupIndex) {
    const group = state.groups[groupIndex];
    if (!group) return;

    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    const actions = document.getElementById('modal-actions');
    const inputContainer = document.getElementById('modal-input-container');
    const colorPicker = document.getElementById('modal-color-picker');

    if(!overlay) return;
    if(activeTimeout) clearTimeout(activeTimeout);
    showModalOverlay(overlay);

    title.innerText = "ÉDITION CALQUE";
    inputContainer.style.display = 'block'; // On utilise l'input standard pour le nom
    colorPicker.style.display = 'block';  // On utilise le color picker standard
    
    // Pré-remplissage Nom
    const inputName = document.getElementById('modal-input');
    inputName.value = group.name;

    content.innerHTML = `<p class="map-form-note">Modifier les propriétés du calque.</p>`;

    // --- SETUP COULEURS ---
    const swatchesDiv = document.getElementById('color-swatches');
    const customInput = document.getElementById('modal-color-input');
    const hexDisplay = document.getElementById('modal-color-hex');
    
    if (swatchesDiv) {
        swatchesDiv.innerHTML = '';
        TACTICAL_COLORS.forEach(color => {
            const btn = document.createElement('div');
            btn.className = 'color-swatch-btn';
            btn.style.backgroundColor = color;
            btn.style.setProperty('--color', color);
            
            if(color.toLowerCase() === group.color.toLowerCase()) btn.classList.add('active');
            
            btn.onclick = () => {
                document.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if(customInput) customInput.value = color;
                if(hexDisplay) hexDisplay.innerText = color.toUpperCase();
            };
            swatchesDiv.appendChild(btn);
        });
        
        if(customInput) {
            customInput.value = group.color;
            if(hexDisplay) hexDisplay.innerText = group.color.toUpperCase();
            customInput.oninput = (e) => {
                if(hexDisplay) hexDisplay.innerText = e.target.value.toUpperCase();
                document.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('active'));
            };
        }
    }

    // --- ACTIONS ---
    actions.innerHTML = '';

    // Bouton Supprimer (Rouge)
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-modal-cancel';
    btnDelete.style.borderColor = 'var(--danger)';
    btnDelete.style.color = 'var(--danger)';
    btnDelete.innerText = "SUPPRIMER CALQUE";
    btnDelete.onclick = async () => {
        hideModalOverlay(overlay);
        setTimeout(async () => {
            if(await customConfirm("SUPPRESSION", `Supprimer "${group.name}" et tout son contenu ?`)) {
                const removedIds = group.points.map(p => p.id);
                state.groups.splice(groupIndex, 1);
                pruneTacticalLinks(removedIds);
                renderGroupsList();
                renderAll();
                saveLocalState();
            }
        }, 200);
    };

    // Bouton Annuler
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-modal-cancel';
    btnCancel.innerText = "ANNULER";
    btnCancel.onclick = () => { hideModalOverlay(overlay); };

    // Bouton Valider
    const btnSave = document.createElement('button');
    btnSave.className = 'btn-modal-confirm';
    btnSave.innerText = "ENREGISTRER";
    btnSave.onclick = () => {
        // Sauvegarde Nom
        group.name = inputName.value || "Groupe Sans Nom";
        // Sauvegarde Couleur
        group.color = customInput ? customInput.value : group.color;
        
        renderGroupsList();
        renderAll();
        saveLocalState();
        hideModalOverlay(overlay);
    };

    actions.append(btnDelete, btnCancel, btnSave);
}

export function openMapDataHubModal(options = {}) {
    const localSummary = String(options?.localSummary || 'Local actif');
    const cloudSummary = String(options?.cloudSummary || 'Cloud hors ligne');
    const syncSummary = String(options?.syncSummary || 'Map tactique');
    const canOpenCloud = typeof options?.onCloud === 'function';
    const localSaveLocked = Boolean(options?.localSaveLocked);

    return createModalPromise(({ titleEl, contentEl, actionsEl, close }) => {
        titleEl.innerText = 'CENTRE FICHIER';

        contentEl.innerHTML = `
            <div class="data-hub">
                <div class="data-hub-head">
                    <h3 class="modal-tool-title">Centre Fichier</h3>
                </div>

                <div class="data-hub-section data-hub-section-local">
                    <div class="data-hub-kicker">Local</div>
                    <div class="data-hub-grid">
                        <button type="button" class="data-hub-card data-hub-card-local ${localSaveLocked ? 'is-disabled-visual' : ''}" data-action="save" ${localSaveLocked ? 'disabled' : ''}>
                            <span class="data-hub-card-title">Sauvegarder</span>
                        </button>
                        <button type="button" class="data-hub-card data-hub-card-local" data-action="open">
                            <span class="data-hub-card-title">Ouvrir</span>
                        </button>
                        <button type="button" class="data-hub-card data-hub-card-local" data-action="merge">
                            <span class="data-hub-card-title">Fusionner</span>
                        </button>
                    </div>
                    ${localSaveLocked ? '<div class="map-form-note">Sauvegarde locale reservee au proprietaire du cloud actif.</div>' : ''}
                </div>

                <div class="data-hub-section data-hub-section-cloud">
                    <div class="data-hub-kicker">Cloud</div>
                    <div class="data-hub-grid">
                        <button
                            type="button"
                            class="data-hub-card data-hub-card-cloud ${canOpenCloud ? '' : 'is-disabled-visual'}"
                            data-action="cloud"
                            ${canOpenCloud ? '' : 'disabled'}
                        >
                            <span class="data-hub-card-title">Cloud</span>
                        </button>
                    </div>
                </div>

                <div class="data-hub-section data-hub-section-danger">
                    <div class="data-hub-kicker">Danger</div>
                    <div class="data-hub-grid">
                        <button type="button" class="data-hub-card data-hub-card-danger" data-action="reset">
                            <span class="data-hub-card-title">Reset</span>
                        </button>
                    </div>
                </div>

                <div class="data-hub-status">
                    <span class="data-hub-status-pill data-hub-status-pill-local">${escapeMarkup(localSummary)}</span>
                    <span class="data-hub-status-pill data-hub-status-pill-cloud">${escapeMarkup(cloudSummary)}</span>
                    <span class="data-hub-status-pill data-hub-status-pill-sync">${escapeMarkup(syncSummary)}</span>
                </div>
            </div>
        `;

        actionsEl.innerHTML = '';

        const runAction = (handler) => {
            if (typeof handler !== 'function') return;
            close(true);
            window.setTimeout(() => handler(), 40);
        };

        Array.from(contentEl.querySelectorAll('[data-action]')).forEach((button) => {
            button.onclick = () => {
                const action = button.getAttribute('data-action');
                if (action === 'save') {
                    runAction(options.onSave);
                    return;
                }
                if (action === 'open') {
                    runAction(options.onOpen);
                    return;
                }
                if (action === 'merge') {
                    runAction(options.onMerge);
                    return;
                }
                if (action === 'cloud') {
                    runAction(options.onCloud);
                    return;
                }
                if (action === 'reset') {
                    runAction(options.onReset);
                }
            };
        });
    });
}


// --- MENU DE SAUVEGARDE (Inchangé mais inclus pour complétude) ---
export function openSaveOptionsModal(options = {}) {
    const cloudActive = Boolean(options && options.cloudActive);
    const cloudEditable = Boolean(options && options.cloudEditable);
    const localExportLocked = Boolean(options && options.localExportLocked);
    const boardTitle = String(options?.boardTitle || '');
    const safeBoardTitle = escapeMarkup(boardTitle);
    const onSaveCloud = typeof options?.onSaveCloud === 'function' ? options.onSaveCloud : null;
    const onArchiveLocal = typeof options?.onArchiveLocal === 'function' ? options.onArchiveLocal : null;

    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    const actions = document.getElementById('modal-actions');
    const inputContainer = document.getElementById('modal-input-container');
    const colorPicker = document.getElementById('modal-color-picker');

    if(!overlay) return;
    if(activeTimeout) clearTimeout(activeTimeout);
    showModalOverlay(overlay);

    title.innerText = "OPTIONS DE SAUVEGARDE";
    inputContainer.style.display = 'none';
    colorPicker.style.display = 'none';

    const exportWarning = localExportLocked ? `
        <div class="map-save-warning">
            Export local bloque sur ce board cloud.
            Seul le lead peut dupliquer/sauver en local.
        </div>
    ` : '';

    const cloudBlock = cloudActive ? `
        <div class="data-hub-section data-hub-section-cloud">
            <div class="data-hub-kicker">Cloud</div>
            <div class="data-hub-grid">
                <button
                    id="btnOptCloud"
                    class="data-hub-card data-hub-card-cloud ${cloudEditable ? '' : 'is-disabled-visual'}"
                    ${cloudEditable ? '' : 'disabled'}
                >
                    <span class="data-hub-card-title">${cloudEditable ? 'Sauver Board' : 'Lecture seule'}</span>
                </button>
            </div>
            ${safeBoardTitle ? `<div class="map-form-note">Board actif: ${safeBoardTitle}</div>` : ''}
        </div>
    ` : '';

    const localBlock = localExportLocked ? '' : `
        <div class="data-hub-section data-hub-section-local">
            <div class="data-hub-kicker">Local</div>
            <div class="map-form-note">
                Sauvegarde fichier ou copie brute pour partager rapidement.
            </div>
            <div class="data-hub-grid">
                <button id="btnOptFile" class="data-hub-card data-hub-card-local">
                    <span class="data-hub-card-title">Fichier JSON</span>
                </button>
                <button id="btnOptRaw" class="data-hub-card data-hub-card-local">
                    <span class="data-hub-card-title">Copier JSON</span>
                </button>
            </div>
        </div>
    `;

    content.innerHTML = `
        <div class="data-hub">
            <div class="data-hub-head">
                <h3 class="modal-tool-title">Sauvegarde</h3>
            </div>
            ${exportWarning}
            ${localBlock}
            ${cloudBlock}
        </div>

        <div id="raw-data-area" class="map-raw-data-area">
            <label class="map-form-note" for="rawJsonOutput">JSON brut</label>
            <textarea id="rawJsonOutput" class="cyber-input"></textarea>
            <button id="btnCopyRaw" class="mini-btn" style="width:100%; margin-top:8px;" type="button">Copier</button>
        </div>
    `;

    actions.innerHTML = '';

    const btnOptFile = document.getElementById('btnOptFile');
    if (btnOptFile) {
        btnOptFile.onclick = async () => {
            hideModalOverlay(overlay);
            setTimeout(async () => {
                const defaultName = state.currentFileName || "mission_tactique";
                const newName = await customPrompt(
                    "NOMMER LA SAUVEGARDE",
                    "Entrez le nom du fichier (sans extension) :",
                    defaultName
                );
                if (newName) {
                    state.currentFileName = newName;
                    const exported = exportToJSON(newName);
                    if (!exported) {
                        await customAlert("ACCES", "Export local bloque sur ce board cloud.");
                        return;
                    }
                    if (onArchiveLocal) {
                        await Promise.resolve(onArchiveLocal(newName)).catch(() => null);
                    }
                }
            }, 300);
        };
    }

    const btnOptRaw = document.getElementById('btnOptRaw');
    if (btnOptRaw) {
        btnOptRaw.onclick = () => {
            const rawArea = document.getElementById('raw-data-area');
            const txt = document.getElementById('rawJsonOutput');
            const data = { meta: { date: new Date().toISOString(), version: "2.5" }, groups: state.groups, tacticalLinks: state.tacticalLinks };
            txt.value = JSON.stringify(data, null, 2);
            rawArea.classList.add('is-visible');
            if (btnOptFile) btnOptFile.style.display = 'none';
            btnOptRaw.style.display = 'none';
            txt.select();
        };
    }

    const btnCopyRaw = document.getElementById('btnCopyRaw');
    if (btnCopyRaw) {
        btnCopyRaw.onclick = async () => {
            const txt = document.getElementById('rawJsonOutput');
            if (!txt) return;
            txt.select();
            try {
                await navigator.clipboard.writeText(txt.value);
                if (onArchiveLocal) {
                    const archiveName = state.currentFileName || 'mission_tactique';
                    await Promise.resolve(onArchiveLocal(archiveName)).catch(() => null);
                }
                const originalText = btnCopyRaw.innerText;
                btnCopyRaw.innerText = "Copie OK";
                btnCopyRaw.classList.add('active');
                setTimeout(() => {
                    btnCopyRaw.innerText = originalText;
                    btnCopyRaw.classList.remove('active');
                }, 2000);
            } catch (e) {
                await customAlert("ERREUR", "Impossible de copier le JSON.");
            }
        };
    }

    const btnOptCloud = document.getElementById('btnOptCloud');
    if (btnOptCloud) {
        btnOptCloud.onclick = async () => {
            if (!onSaveCloud) {
                await customAlert("CLOUD", "Board cloud non disponible.");
                return;
            }
            btnOptCloud.setAttribute('disabled', 'true');
            const previous = btnOptCloud.innerText;
            btnOptCloud.innerText = "SAUVEGARDE...";
            try {
                await onSaveCloud();
            } finally {
                btnOptCloud.innerText = previous;
                if (cloudEditable) btnOptCloud.removeAttribute('disabled');
            }
        };
    }
}

// Fonction utilitaire pour le sélecteur de couleur simple (utilisé par openGroupEditor ou autre)
export function customColorPicker(title, defaultColor = "#ffffff") {
    // Note: Cette fonction reste dispo pour d'autres usages, mais openGroupEditor implémente sa propre version intégrée
    return createModalPromise(({ titleEl, contentEl, actionsEl, colorContainer, close }) => {
        titleEl.innerText = title;
        contentEl.innerHTML = "Sélectionnez une couleur :";
        colorContainer.style.display = 'block';
        // ... (Logique identique à openGroupEditor pour les couleurs, simplifiée ici pour ne pas dupliquer trop de code si non utilisé ailleurs)
        // Pour être sûr, on laisse l'implémentation complète si besoin :
        const swatchesDiv = document.getElementById('color-swatches');
        const customInput = document.getElementById('modal-color-input');
        if (swatchesDiv) {
            swatchesDiv.innerHTML = '';
            TACTICAL_COLORS.forEach(color => {
                const btn = document.createElement('div');
                btn.className = 'color-swatch-btn';
                btn.style.backgroundColor = color;
                btn.style.setProperty('--color', color);
                btn.onclick = () => {
                    if(customInput) customInput.value = color;
                    close(color);
                };
                swatchesDiv.appendChild(btn);
            });
        }
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-modal-cancel';
        btnCancel.innerText = "ANNULER";
        btnCancel.onclick = () => close(null);
        actionsEl.appendChild(btnCancel);
    });
}
