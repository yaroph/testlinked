import { TYPES, KINDS, KIND_LABELS, PERSON_PERSON_KINDS, PERSON_ORG_KINDS, ORG_ORG_KINDS, PERSON_STATUS, PERSON_STATUS_LABELS } from './constants.js';
import { escapeHtml, safeHex, sanitizeNodeColor, linkKindEmoji, kindToLabel, normalizePersonStatus } from './utils.js';

// Génère les options pour les listes déroulantes de liens
function getAllowedKinds(sourceType, targetType) {
    let base;
    if (sourceType === TYPES.PERSON && targetType === TYPES.PERSON) base = PERSON_PERSON_KINDS;
    else if (sourceType === TYPES.PERSON || targetType === TYPES.PERSON) base = PERSON_ORG_KINDS;
    else base = ORG_ORG_KINDS;
    const allowed = new Set(base);
    allowed.add(KINDS.RELATION);
    return allowed;
}

function getLinkOptions(allowedKinds) {
    return Object.keys(KIND_LABELS)
        .filter(k => !allowedKinds || allowedKinds.has(k))
        .map(k => `<option value="${k}">${linkKindEmoji(k)} ${kindToLabel(k)}</option>`)
        .join('');
}

// =============================================================================
// --- 1. BARRE LATÉRALE GAUCHE (PATHFINDING / IA) ---
// =============================================================================
export function renderPathfindingSidebar(state, selectedNode) {
    if (!state.pathfinding.startId) {
        if (selectedNode) {
            return `
                <div class="pf-card">
                    <div class="pf-node-box pf-node-box-active">
                        <span class="pf-node-label">Candidat source</span>
                        <span class="pf-node-value">${escapeHtml(selectedNode.name)}</span>
                    </div>
                    <button id="btnPathStart" class="primary pf-action-btn" type="button">
                        Choisir source
                    </button>
                </div>
            `;
        } else {
            return `
                <div class="pf-empty-card">
                    <div class="pf-empty-icon">ANT</div>
                    <div class="pf-empty-text">En attente de signal...</div>
                </div>
            `;
        }
    }

    const startNode = state.nodes.find(n => n.id === state.pathfinding.startId);
    const startName = startNode ? escapeHtml(startNode.name) : "ERR_UNKNOWN";
    const targetNode = (selectedNode && selectedNode.id !== state.pathfinding.startId) ? selectedNode : null;
    const hasTarget = !!targetNode;

    let statusDisplay = '';
    if (state.pathfinding.active) {
        statusDisplay = `<div class="pf-status pf-status-active">Liaison active</div>`;
    } else if (hasTarget) {
        statusDisplay = `<button id="btnPathCalc" class="pf-action-btn pf-action-btn-alt" type="button">Connecter</button>`;
    } else {
        statusDisplay = `<div class="pf-status pf-status-idle">En attente de cible...</div>`;
    }

    return `
        <div class="pf-card">
            <div class="pf-node-grid">
                <div class="pf-node-box pf-node-box-active">
                    <span class="pf-node-label">Source</span>
                    <span class="pf-node-value">${startName}</span>
                </div>
                <div class="pf-node-box ${hasTarget ? 'pf-node-box-target' : ''}">
                    <span class="pf-node-label">Cible</span>
                    <span class="pf-node-value">${targetNode ? escapeHtml(targetNode.name) : 'Selectionner...'}</span>
                </div>
            </div>
            <div class="pf-status-wrap">
                ${statusDisplay}
            </div>
            <button id="btnPathCancel" class="pf-cancel-btn" type="button">Annuler la sequence</button>
        </div>
    `;
}

// =============================================================================
// --- 2. BARRE LATÉRALE DROITE (ÉDITEUR) ---
// =============================================================================
export function renderEditorHTML(n, state) {
    const kindsForPerson = getAllowedKinds(n.type, TYPES.PERSON);
    const personStatus = normalizePersonStatus(n.personStatus, n.type);
    const personStatusControls = `
        <div class="editor-status-inline">
            ${Object.values(PERSON_STATUS).map((status) => `
                <button
                    type="button"
                    class="editor-status-btn ${personStatus === status ? 'active' : ''} is-${escapeHtml(status)}"
                    data-person-status="${escapeHtml(status)}"
                >${escapeHtml(PERSON_STATUS_LABELS[status])}</button>
            `).join('')}
        </div>
    `;

    const typeOptions = `
        <option value="${TYPES.PERSON}" ${n.type===TYPES.PERSON?'selected':''}>Personne</option>
        <option value="${TYPES.GROUP}" ${n.type===TYPES.GROUP?'selected':''}>Groupe</option>
        <option value="${TYPES.COMPANY}" ${n.type===TYPES.COMPANY?'selected':''}>Entreprise</option>
    `;
    const headMetaControls = `
        <div class="editor-status-inline editor-status-inline-meta">
            <select id="edQuickType" class="editor-type-select" aria-label="Type de fiche">
                ${typeOptions}
            </select>
            <label class="editor-color-pill editor-color-pill-head" title="Couleur de la fiche">
                <span class="editor-inline-label">Couleur</span>
                <input type="color" id="edColorQuick" value="${sanitizeNodeColor(safeHex(n.color))}" class="editor-color-input editor-color-input-inline">
            </label>
        </div>
    `;

    return `
    <div class="editor-panel-layout">
        <div class="editor-side-rail" aria-label="Actions rapides de la fiche">
            <div class="editor-side-group">
                <button id="btnFocusNode" class="mini-btn ${state.focusMode ? 'active' : ''}" type="button">${state.focusMode ? 'Tout voir' : 'Focus'}</button>
                <button id="btnCenterNode" class="mini-btn" type="button">Centrer</button>
                <button id="btnExportRP" class="mini-btn" type="button">Copier</button>
            </div>
            <div class="editor-side-group editor-side-group-bottom">
                <button id="btnMergeLaunch" class="mini-btn editor-action-merge" type="button">Fusionner</button>
                <button id="btnDelete" class="mini-btn danger" type="button">Supprimer</button>
            </div>
        </div>

        <div class="editor-main-card">
            <div class="editor-sheet">
                <div class="editor-sheet-head">
                    <div class="editor-sheet-head-main">
                        <div class="editor-sheet-identity-row">
                            <div class="editor-sheet-title-block">
                                <textarea id="edQuickNameInline" class="editor-sheet-name editor-sheet-name-input editor-sheet-name-textarea" rows="1" placeholder="Nom de la fiche">${escapeHtml(n.name)}</textarea>
                                <div id="awName" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:4px; font-size:0.68rem; color:#ffcc8a;"></div>
                            </div>
                            ${n.type === TYPES.PERSON ? `
                                <div class="editor-inline-phone editor-inline-phone-head">
                                    <span class="editor-inline-label">Tel</span>
                                    <input id="edQuickNum" type="text" value="${escapeHtml(n.num || '')}" placeholder="555-...">
                                    <div id="awPhone" class="editor-realtime-presence" style="display:none; min-height:12px; margin-top:4px; font-size:0.64rem; color:#ffcc8a;"></div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="editor-sheet-topbar ${personStatusControls ? '' : 'editor-sheet-topbar-meta-only'}">
                        ${personStatusControls}
                        ${headMetaControls}
                    </div>
                </div>

                <div id="editorMergeRail" class="editor-side-popover editor-merge-inline" hidden>
                    <div class="editor-merge-head">
                        <div class="editor-side-popover-title">Fusionner cette fiche</div>
                        <div class="editor-merge-copy">Tout le contenu de cette fiche sera absorbé par la fiche cible.</div>
                    </div>
                    <div class="editor-merge-row">
                        <div class="editor-autocomplete-field flex-grow-input">
                            <input id="mergeTarget" type="text" autocomplete="off" spellcheck="false" placeholder="Rechercher la fiche cible" class="flex-grow-input">
                            <div id="mergeTargetResults" class="editor-autocomplete-results" hidden></div>
                        </div>
                        <button id="btnMergeApply" class="mini-btn primary" type="button">Valider la fusion</button>
                    </div>
                </div>

                <div class="editor-sheet-note">
                    <label class="editor-section-label" for="edDescription">Description</label>
                    <textarea id="edDescription" rows="3" placeholder="Description / note">${escapeHtml(n.description || n.notes || '')}</textarea>
                    <div id="awDescription" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:4px; font-size:0.68rem; color:#ffcc8a;"></div>
                </div>

                <div class="editor-meta-strip">
                    <div class="editor-meta-pill">
                        <span>Compte bancaire</span>
                        <input
                            id="edQuickAccountNumber"
                            type="text"
                            value="${escapeHtml(n.accountNumber || '')}"
                            placeholder="Non renseigne"
                        >
                        <div id="awAccount" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:4px; font-size:0.68rem; color:#ffcc8a;"></div>
                    </div>
                    <div class="editor-meta-pill">
                        <span>Numéro social</span>
                        <input
                            id="edQuickCitizenNumber"
                            type="text"
                            value="${escapeHtml(n.citizenNumber || '')}"
                            placeholder="Non renseigne"
                        >
                        <div id="awCitizen" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:4px; font-size:0.68rem; color:#ffcc8a;"></div>
                    </div>
                </div>

                <div class="editor-links-head">
                    <span>LIENS ACTIFS</span>
                    <span id="editorLinksCount" class="editor-links-count">0</span>
                </div>

                <div id="chipsLinks"></div>

                <div class="editor-link-strip">
                    <div class="editor-inline-title">Ajouter une relation</div>
                    <div class="editor-link-grid">
                        <div class="editor-autocomplete-field flex-grow-input editor-link-target">
                            <input id="editorLinkName" type="text" autocomplete="off" spellcheck="false" placeholder="Nom de la fiche a lier" class="flex-grow-input">
                            <div id="editorLinkNameResults" class="editor-autocomplete-results" hidden></div>
                        </div>
                        <select id="editorLinkType" class="compact-select editor-compact-select">
                            <option value="${TYPES.PERSON}">Personne</option>
                            <option value="${TYPES.GROUP}">Groupe</option>
                            <option value="${TYPES.COMPANY}">Entreprise</option>
                        </select>
                        <select id="editorLinkKind" class="flex-grow-input editor-link-kind-select">${getLinkOptions(kindsForPerson)}</select>
                        <button id="btnAddLinkQuick" class="mini-btn primary" type="button">Ajouter</button>
                    </div>
                    <div id="editorLinkHint" class="editor-link-hint">Si la fiche existe deja, son type est repris automatiquement.</div>
                </div>

            </div>
        </div>
    </div>
    `;
}
