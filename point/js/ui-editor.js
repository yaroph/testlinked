import { state, nodeById, pushHistory, scheduleSave, saveState, linkHasNode } from './state.js';
import { ensureNode, mergeNodes, updatePersonColors } from './logic.js';
import { renderEditorHTML } from './templates.js';
import { restartSim } from './physics.js';
import { draw, updateDegreeCache } from './render.js';
import {
    addLink as addUILink,
    logNodeAdded,
    refreshLists,
    updatePathfindingPanel,
    selectNode,
    showCustomConfirm,
    showCustomAlert,
    showCustomPrompt,
    refreshHvt,
    unbindCloudPointFields,
    ensureCloudWriteAccess,
    isCloudBoardReadOnly,
    getCloudReadOnlyMessage
} from './ui.js';
import { escapeHtml, kindToLabel, linkKindEmoji, computeLinkColor, sanitizeNodeColor, normalizePersonStatus } from './utils.js';
import { TYPES, KINDS, KIND_LABELS, PERSON_PERSON_KINDS, PERSON_ORG_KINDS, ORG_ORG_KINDS, PERSON_STATUS, PERSON_STATUS_LABELS } from './constants.js';
import { clearFocusMode, setFocusMode, refreshFocusMode } from './focus.js';

const ui = {
    editorTitle: document.getElementById('editorTitle'),
    editorBody: document.getElementById('editorBody')
};

const editorDragState = {
    initialized: false,
    dragging: false,
    offsetX: 0,
    offsetY: 0
};

function decorateReadOnlyEditor(editorRoot) {
    if (!editorRoot || !isCloudBoardReadOnly()) return;
    if (!editorRoot.querySelector('.cloud-readonly-banner')) {
        const banner = document.createElement('div');
        banner.className = 'cloud-readonly-banner';
        banner.textContent = getCloudReadOnlyMessage() || 'Lecture seule sur ce board.';
        banner.style.cssText = 'margin:0 0 12px; padding:10px 12px; border-radius:12px; border:1px dashed rgba(255, 204, 138, 0.32); background:rgba(18, 12, 4, 0.72); color:#ffd8a4; font-size:0.78rem; line-height:1.45;';
        editorRoot.prepend(banner);
    }

    const allowedButtonIds = new Set(['btnClose', 'btnCenterNode', 'btnFocusNode', 'btnExportRP']);
    editorRoot.querySelectorAll('input, select, textarea, button').forEach((field) => {
        if (field instanceof HTMLButtonElement && allowedButtonIds.has(field.id)) return;
        if (field instanceof HTMLButtonElement) {
            field.disabled = true;
            return;
        }
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            field.readOnly = true;
            field.disabled = true;
            return;
        }
        if (field instanceof HTMLSelectElement) {
            field.disabled = true;
        }
    });
}

function nodeTypeLabel(type) {
    if (type === TYPES.COMPANY) return 'Entreprise';
    if (type === TYPES.GROUP) return 'Groupe';
    return 'Personne';
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizeNodeNameDraft(value, { finalize = false } = {}) {
    const collapsed = String(value || '').replace(/\s+/g, ' ');
    return finalize ? collapsed.trim() : collapsed.replace(/^\s+/, '');
}

function getAllowedKindsForTarget(sourceType, targetType) {
    let base;
    if (sourceType === TYPES.PERSON && targetType === TYPES.PERSON) base = PERSON_PERSON_KINDS;
    else if (sourceType === TYPES.PERSON || targetType === TYPES.PERSON) base = PERSON_ORG_KINDS;
    else base = ORG_ORG_KINDS;
    const allowed = new Set(base);
    allowed.add(KINDS.RELATION);
    return allowed;
}

function buildKindOptions(allowedKinds, selected = '') {
    return Object.keys(KIND_LABELS)
        .filter((kind) => !allowedKinds || allowedKinds.has(kind))
        .map((kind) => `<option value="${kind}" ${kind === selected ? 'selected' : ''}>${linkKindEmoji(kind)} ${kindToLabel(kind)}</option>`)
        .join('');
}

function normalizeNodeLookupName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getAutocompleteMatches(query, excludedIds = [], limit = 7) {
    const normalizedQuery = normalizeNodeLookupName(query);
    if (!normalizedQuery) return [];

    const excluded = new Set(excludedIds.map((id) => String(id)));
    return state.nodes
        .filter((item) => item && !excluded.has(String(item.id)))
        .map((item) => {
            const name = String(item.name || '').trim();
            const normalizedName = normalizeNodeLookupName(name);
            if (!normalizedName) return null;
            const starts = normalizedName.startsWith(normalizedQuery);
            const index = normalizedName.indexOf(normalizedQuery);
            if (index < 0) return null;
            return { item, starts, index };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.starts !== b.starts) return a.starts ? -1 : 1;
            if (a.index !== b.index) return a.index - b.index;
            return String(a.item.name || '').localeCompare(String(b.item.name || ''), 'fr', { sensitivity: 'base' });
        })
        .slice(0, limit)
        .map((entry) => entry.item);
}

function attachEditorAutocomplete({ input, resultsEl, excludedIds = [], onPick, onInputChange, onSubmit }) {
    if (!input || !resultsEl) {
        return {
            hide: () => {},
            refresh: () => {}
        };
    }

    let matches = [];
    let activeIndex = -1;
    let hideTimer = null;

    const clearHideTimer = () => {
        if (!hideTimer) return;
        clearTimeout(hideTimer);
        hideTimer = null;
    };

    const hide = () => {
        clearHideTimer();
        matches = [];
        activeIndex = -1;
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
    };

    const setActiveIndex = (nextIndex) => {
        activeIndex = nextIndex;
        Array.from(resultsEl.querySelectorAll('[data-autocomplete-index]')).forEach((button) => {
            button.classList.toggle('active', Number(button.getAttribute('data-autocomplete-index')) === activeIndex);
        });
    };

    const pickNode = (node, { focusInput = true } = {}) => {
        if (!node) return;
        input.value = String(node.name || '');
        hide();
        if (typeof onPick === 'function') onPick(node);
        if (focusInput) input.focus();
    };

    const render = () => {
        clearHideTimer();
        const query = String(input.value || '').trim();
        if (typeof onInputChange === 'function') onInputChange(query);
        if (!query) {
            hide();
            return;
        }

        matches = getAutocompleteMatches(query, excludedIds);
        activeIndex = -1;

        if (!matches.length) {
            hide();
            return;
        }

        resultsEl.hidden = false;
        resultsEl.innerHTML = matches.map((node, index) => `
            <button
                type="button"
                class="editor-autocomplete-hit"
                data-autocomplete-id="${escapeHtml(String(node.id || ''))}"
                data-autocomplete-index="${index}"
            >
                <span class="editor-autocomplete-name">${escapeHtml(String(node.name || 'Sans nom'))}</span>
                <span class="editor-autocomplete-type">${escapeHtml(nodeTypeLabel(node.type))}</span>
            </button>
        `).join('');

        Array.from(resultsEl.querySelectorAll('[data-autocomplete-id]')).forEach((button) => {
            button.onmousedown = (event) => {
                event.preventDefault();
                clearHideTimer();
            };
            button.onmouseenter = () => {
                setActiveIndex(Number(button.getAttribute('data-autocomplete-index')));
            };
            button.onclick = () => {
                const id = button.getAttribute('data-autocomplete-id') || '';
                const node = matches.find((entry) => String(entry.id) === String(id)) || null;
                pickNode(node);
            };
        });
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', () => {
        if (String(input.value || '').trim()) render();
    });
    input.addEventListener('blur', () => {
        clearHideTimer();
        hideTimer = setTimeout(hide, 120);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!matches.length) {
                render();
                if (!matches.length) return;
            }
            const nextIndex = Math.min(activeIndex + 1, matches.length - 1);
            setActiveIndex(nextIndex < 0 ? 0 : nextIndex);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!matches.length) {
                render();
                if (!matches.length) return;
            }
            if (!matches.length) return;
            const nextIndex = activeIndex <= 0 ? 0 : activeIndex - 1;
            setActiveIndex(nextIndex);
            return;
        }
        if (event.key === 'Escape') {
            hide();
            return;
        }
        if (event.key === 'Tab' && activeIndex >= 0 && matches[activeIndex]) {
            event.preventDefault();
            pickNode(matches[activeIndex], { focusInput: false });
            return;
        }
        if (event.key === 'Enter') {
            if (activeIndex >= 0 && matches[activeIndex]) {
                event.preventDefault();
                pickNode(matches[activeIndex]);
                return;
            }
            if (typeof onSubmit === 'function') {
                event.preventDefault();
                onSubmit();
            }
        }
    });

    hide();

    return {
        hide,
        refresh: render
    };
}

function isCompactLayout() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function isUltraWideEditorLayout() {
    return window.matchMedia('(min-width: 2560px) and (min-height: 1200px)').matches;
}

function readCssPxVariable(name, fallback = 0, source = document.documentElement) {
    if (!source) return Number(fallback) || 0;
    const value = Number.parseFloat(window.getComputedStyle(source).getPropertyValue(String(name || '')));
    return Number.isFinite(value) ? value : Number(fallback) || 0;
}

function getDefaultEditorReservedRightGap(rightPanel = document.getElementById('right')) {
    const sideClearance = readCssPxVariable('--editor-side-clearance', isUltraWideEditorLayout() ? 156 : 124);
    const paddingRight = rightPanel ? readCssPxVariable('padding-right', 0, rightPanel) : 0;
    return Math.max(8, sideClearance + paddingRight);
}

function getDefaultEditorTopOffset(rightPanel = document.getElementById('right')) {
    const panelPaddingTop = rightPanel ? readCssPxVariable('padding-top', 0, rightPanel) : 0;
    if (panelPaddingTop > 0) return 0;
    return isUltraWideEditorLayout() ? 8 : 6;
}

function applyDefaultEditorPosition(editorPanel, rightPanel = document.getElementById('right')) {
    if (!editorPanel) return;
    if (isCompactLayout()) return;
    if (!rightPanel) return;

    const containerRect = rightPanel.getBoundingClientRect();
    const inset = isUltraWideEditorLayout() ? 28 : 18;
    const maxX = Math.max(inset, containerRect.width - editorPanel.offsetWidth - inset);
    const maxY = Math.max(inset, containerRect.height - editorPanel.offsetHeight - inset);
    const desiredLeft = Math.max(inset, containerRect.width - editorPanel.offsetWidth - getDefaultEditorReservedRightGap(rightPanel));
    const desiredTop = Math.min(Math.max(0, getDefaultEditorTopOffset(rightPanel)), maxY);

    editorPanel.style.left = `${Math.min(desiredLeft, maxX)}px`;
    editorPanel.style.top = `${Math.min(desiredTop, maxY)}px`;
    editorPanel.style.transform = 'none';
    editorPanel.dataset.freePosition = '0';
}

function resetEditorPosition(editorPanel) {
    if (!editorPanel) return;
    applyDefaultEditorPosition(editorPanel);
}

function clampEditorInViewport(editorPanel = document.getElementById('editor')) {
    if (!editorPanel || isCompactLayout()) return;
    if (editorPanel.style.display === 'none') return;

    const rightPanel = document.getElementById('right');
    if (!rightPanel) return;

    const containerRect = rightPanel.getBoundingClientRect();
    const maxX = Math.max(8, containerRect.width - editorPanel.offsetWidth - 8);
    const maxY = Math.max(8, containerRect.height - editorPanel.offsetHeight - 8);

    if (editorPanel.dataset.freePosition === '1') {
        const currentLeft = Number.parseFloat(editorPanel.style.left || '8');
        const currentTop = Number.parseFloat(editorPanel.style.top || '8');
        editorPanel.style.left = `${clamp(currentLeft, 8, maxX)}px`;
        editorPanel.style.top = `${clamp(currentTop, 8, maxY)}px`;
        editorPanel.style.transform = 'none';
        return;
    }

    applyDefaultEditorPosition(editorPanel, rightPanel);

    const panelRect = editorPanel.getBoundingClientRect();
    const overflowLeft = panelRect.left - containerRect.left - 8;
    const overflowRight = containerRect.right - panelRect.right - 8;
    const overflowTop = panelRect.top - containerRect.top - 8;
    const overflowBottom = containerRect.bottom - panelRect.bottom - 8;

    if (overflowLeft >= 0 && overflowRight >= 0 && overflowTop >= 0 && overflowBottom >= 0) return;

    const clampedLeft = clamp(panelRect.left - containerRect.left, 8, maxX);
    const clampedTop = clamp(panelRect.top - containerRect.top, 8, maxY);
    editorPanel.style.left = `${clampedLeft}px`;
    editorPanel.style.top = `${clampedTop}px`;
    editorPanel.style.transform = 'none';
    editorPanel.dataset.freePosition = '0';
}

function ensureEditorDrag() {
    if (editorDragState.initialized) return;
    editorDragState.initialized = true;

    const editorPanel = document.getElementById('editor');
    const rightPanel = document.getElementById('right');
    if (!editorPanel || !rightPanel) return;

    const isDragIntent = (event) => {
        if (!event?.target) return false;
        const header = event.target.closest('.editor-sheet-head');
        if (!header || !editorPanel.contains(header)) return false;
        if (event.target.closest('input, textarea, button, select, label, a')) return false;
        return true;
    };

    editorPanel.addEventListener('dblclick', (event) => {
        if (!isDragIntent(event)) return;
        if (isCompactLayout()) return;
        resetEditorPosition(editorPanel);
        requestAnimationFrame(() => clampEditorInViewport(editorPanel));
    });

    editorPanel.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (!isDragIntent(event)) return;
        if (isCompactLayout()) return;
        if (editorPanel.style.display === 'none') return;

        const panelRect = editorPanel.getBoundingClientRect();
        const containerRect = rightPanel.getBoundingClientRect();

        if (editorPanel.dataset.freePosition !== '1') {
            editorPanel.style.left = `${panelRect.left - containerRect.left}px`;
            editorPanel.style.top = `${panelRect.top - containerRect.top}px`;
            editorPanel.style.transform = 'none';
            editorPanel.dataset.freePosition = '1';
        }

        const currentRect = editorPanel.getBoundingClientRect();
        editorDragState.dragging = true;
        editorDragState.offsetX = event.clientX - currentRect.left;
        editorDragState.offsetY = event.clientY - currentRect.top;
        editorPanel.classList.add('dragging');
        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!editorDragState.dragging) return;
        if (isCompactLayout()) return;

        const containerRect = rightPanel.getBoundingClientRect();
        let x = event.clientX - containerRect.left - editorDragState.offsetX;
        let y = event.clientY - containerRect.top - editorDragState.offsetY;
        const maxX = Math.max(8, containerRect.width - editorPanel.offsetWidth - 8);
        const maxY = Math.max(8, containerRect.height - editorPanel.offsetHeight - 8);

        x = clamp(x, 8, maxX);
        y = clamp(y, 8, maxY);

        editorPanel.style.left = `${x}px`;
        editorPanel.style.top = `${y}px`;
        editorPanel.style.transform = 'none';
        editorPanel.dataset.freePosition = '1';
    });

    window.addEventListener('mouseup', () => {
        if (!editorDragState.dragging) return;
        editorDragState.dragging = false;
        editorPanel.classList.remove('dragging');
    });

    window.addEventListener('resize', () => {
        if (isCompactLayout()) {
            editorDragState.dragging = false;
            editorPanel.classList.remove('dragging');
            editorPanel.style.left = '';
            editorPanel.style.top = '';
            editorPanel.style.transform = '';
            editorPanel.dataset.freePosition = '0';
            return;
        }
        clampEditorInViewport(editorPanel);
    });
}

function syncEditorRailHeight(editorBody = ui.editorBody) {
    if (!editorBody) return;
    const panelLayout = editorBody.querySelector('.editor-panel-layout');
    const mainCard = panelLayout?.querySelector('.editor-main-card');
    const sheet = panelLayout?.querySelector('.editor-sheet');
    if (!panelLayout || !mainCard || !sheet) return;

    const rightPanel = document.getElementById('right');
    const viewportHeight = Math.max(
        Math.round(rightPanel?.clientHeight || 0),
        Math.round(window.innerHeight || 0),
        320
    );
    const minHeight = isUltraWideEditorLayout() ? 440 : 360;
    const maxHeightRatio = isUltraWideEditorLayout() ? 0.74 : 0.84;
    const chromeClearance = isUltraWideEditorLayout() ? 72 : 34;
    const maxHeight = Math.max(
        minHeight,
        Math.min(viewportHeight - chromeClearance, Math.round(viewportHeight * maxHeightRatio))
    );

    const cardStyles = window.getComputedStyle(mainCard);
    const cardVerticalPadding = ['paddingTop', 'paddingBottom']
        .map((property) => Number.parseFloat(cardStyles[property]) || 0)
        .reduce((sum, value) => sum + value, 0);
    const sideRailMinHeight = Array.from(panelLayout.querySelectorAll('.editor-side-group'))
        .reduce((sum, group) => sum + Math.ceil(group.getBoundingClientRect().height || 0), 0) + 28;
    const naturalHeight = Math.ceil(sheet.scrollHeight || 0) + Math.ceil(cardVerticalPadding);
    const nextHeight = clamp(Math.max(naturalHeight, sideRailMinHeight, minHeight), minHeight, maxHeight);

    panelLayout.style.setProperty('--editor-rail-height', `${nextHeight}px`);
}

function getEditorScrollContainer(editorBody = ui.editorBody) {
    if (!editorBody) return null;
    return editorBody.querySelector('.editor-main-card') || editorBody;
}

function syncCompactEditorOpenState(isOpen) {
    const active = Boolean(isOpen);
    try {
        document.body?.classList.toggle('point-editor-open', active);
        document.documentElement?.classList.toggle('point-editor-open', active);
    } catch (e) {}
}

function captureEditorFocusState(editorBody = ui.editorBody) {
    if (!editorBody) return null;
    const active = document.activeElement;
    if (!active || !editorBody.contains(active)) return null;
    const scrollContainer = getEditorScrollContainer(editorBody);

    const fieldId = String(active.id || '').trim();
    if (!fieldId) return null;

    return {
        selectionId: String(state.selection || ''),
        fieldId,
        scrollTop: scrollContainer ? scrollContainer.scrollTop : 0,
        selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
        selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
        selectionDirection: typeof active.selectionDirection === 'string' ? active.selectionDirection : 'none'
    };
}

function restoreEditorFocusState(snapshot, editorBody = ui.editorBody) {
    if (!snapshot || !editorBody) return;
    if (String(state.selection || '') !== String(snapshot.selectionId || '')) return;
    const scrollContainer = getEditorScrollContainer(editorBody);

    const field = document.getElementById(snapshot.fieldId);
    if (!field || !editorBody.contains(field)) return;

    try {
        field.focus({ preventScroll: true });
    } catch (e) {
        field.focus();
    }

    if (typeof field.setSelectionRange === 'function' && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
        try {
            field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection || 'none');
        } catch (e) {}
    }

    if (scrollContainer && Number.isFinite(snapshot.scrollTop)) {
        scrollContainer.scrollTop = snapshot.scrollTop;
    }
}

export function renderEditor() {
    ensureEditorDrag();
    const n = nodeById(state.selection);
    updatePathfindingPanel();
    const editorPanel = document.getElementById('editor');
    const focusSnapshot = captureEditorFocusState();
    unbindCloudPointFields();

    if (!n) {
        if (editorPanel) editorPanel.style.display = 'none';
        syncCompactEditorOpenState(false);
        ui.editorTitle.style.display = 'none';
        ui.editorBody.innerHTML = '';
        return;
    }
    if (editorPanel) editorPanel.style.display = 'block';
    syncCompactEditorOpenState(true);

    ui.editorTitle.style.display = 'none';
    ui.editorBody.innerHTML = renderEditorHTML(n, state);
    decorateReadOnlyEditor(ui.editorBody);
    syncEditorRailHeight(ui.editorBody);
    ui.editorBody.querySelectorAll('input:not([type="color"]), textarea').forEach((field) => {
        field.setAttribute('autocomplete', 'off');
        field.setAttribute('autocorrect', 'off');
        field.setAttribute('autocapitalize', 'off');
        field.setAttribute('spellcheck', 'false');
    });

    setupEditorListeners(n);
    renderActiveLinks(n);
    clampEditorInViewport(editorPanel);
    requestAnimationFrame(() => {
        syncEditorRailHeight(ui.editorBody);
        restoreEditorFocusState(focusSnapshot);
        clampEditorInViewport(editorPanel);
    });
}

function setupEditorListeners(n) {
    let editHistoryArmed = false;
    let editHistoryTimer = null;
    const queueHistory = () => {
        if (!editHistoryArmed) {
            pushHistory();
            editHistoryArmed = true;
        }
        if (editHistoryTimer) clearTimeout(editHistoryTimer);
        editHistoryTimer = setTimeout(() => { editHistoryArmed = false; }, 800);
    };

    const btnMergeLaunch = document.getElementById('btnMergeLaunch');

    document.getElementById('btnCenterNode').onclick = () => { state.view.x = -n.x * state.view.scale; state.view.y = -n.y * state.view.scale; restartSim(); };

    document.getElementById('btnFocusNode').onclick = () => {
        if (state.focusMode) clearFocusMode();
        else setFocusMode(n.id, state.focusDepth);
        restartSim();
        selectNode(n.id);
        scheduleSave();
    };

    document.getElementById('btnDelete').onclick = () => {
        if (!ensureCloudWriteAccess()) return;
        showCustomConfirm(`Supprimer "${n.name}" ?`, () => {
            pushHistory();
            state.nodes = state.nodes.filter(x => x.id !== n.id);
            state.links = state.links.filter(l => !linkHasNode(l, n.id));
            if (state.focusMode) {
                if (String(state.focusRootId || '') === String(n.id)) clearFocusMode();
                else refreshFocusMode();
            }
            state.selection = null; restartSim(); refreshLists(); renderEditor(); updatePathfindingPanel();
            scheduleSave();
            refreshHvt();
        });
    };

    const syncEditorNameLayout = () => {
        const headName = document.getElementById('edQuickNameInline');
        if (!headName) return;
        headName.style.height = 'auto';
        const nextHeight = Math.min(Math.max(headName.scrollHeight, 36), 96);
        headName.style.height = `${nextHeight}px`;
        headName.classList.toggle('is-multiline', nextHeight > 42);
        const sheetEl = headName.closest('.editor-sheet');
        if (sheetEl) sheetEl.classList.toggle('editor-sheet-name-expanded', nextHeight > 42);
        syncEditorRailHeight(ui.editorBody);
        requestAnimationFrame(() => clampEditorInViewport(document.getElementById('editor')));
    };

    const syncEditorNameDisplays = (nextName) => {
        const safeName = String(nextName || '');
        const headName = document.getElementById('edQuickNameInline');
        if (headName && headName.value !== safeName) headName.value = safeName;
        syncEditorNameLayout();
    };

    const syncEditorPhoneDisplays = (nextPhone) => {
        const safePhone = String(nextPhone || '').trim();
        const quickPhone = document.getElementById('edQuickNum');
        if (quickPhone && quickPhone.value !== safePhone) quickPhone.value = safePhone;
    };

    const syncMetaDisplays = () => {
        const accountValue = String(n.accountNumber || '').trim();
        const citizenValue = String(n.citizenNumber || '').trim();

        const quickAccount = document.getElementById('edQuickAccountNumber');
        const quickCitizen = document.getElementById('edQuickCitizenNumber');

        if (quickAccount && quickAccount.value !== accountValue) quickAccount.value = accountValue;
        if (quickCitizen && quickCitizen.value !== citizenValue) quickCitizen.value = citizenValue;
    };

    const applyNodeName = (nextName, options = {}) => {
        queueHistory();
        n.name = normalizeNodeNameDraft(nextName, options);
        syncEditorNameDisplays(n.name);
        refreshLists();
        draw();
        scheduleSave();
    };

    const applyNodePhone = (nextPhone) => {
        queueHistory();
        n.num = String(nextPhone || '').trim();
        syncEditorPhoneDisplays(n.num);
        scheduleSave();
    };

    const edQuickName = document.getElementById('edQuickNameInline');
    if (edQuickName) {
        edQuickName.addEventListener('input', syncEditorNameLayout);
        edQuickName.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.preventDefault();
        });
        edQuickName.oninput = (e) => applyNodeName(e.target.value);

        edQuickName.addEventListener('blur', () => {
            const finalizedName = normalizeNodeNameDraft(edQuickName.value, { finalize: true });
            if (edQuickName.value !== finalizedName || String(n.name || '') !== finalizedName) {
                applyNodeName(finalizedName, { finalize: true });
            }
        });
        syncEditorNameLayout();
    }

    const edQuickNum = document.getElementById('edQuickNum');
    if (edQuickNum) {
        edQuickNum.oninput = (e) => applyNodePhone(e.target.value);
    }

    const quickType = document.getElementById('edQuickType');
    if (quickType) quickType.onchange = (e) => {
        queueHistory();
        n.type = e.target.value;
        n.personStatus = normalizePersonStatus(n.personStatus, n.type);
        updatePersonColors();
        restartSim();
        draw();
        refreshLists();
        renderEditor();
        scheduleSave();
    };

    const inpColor = document.getElementById('edColorQuick');
    if(inpColor) inpColor.oninput = (e) => {
        queueHistory();
        const nextColor = sanitizeNodeColor(e.target.value);
        n.color = nextColor;
        inpColor.value = nextColor;
        n.manualColor = true;
        updatePersonColors();
        draw();
        saveState();
        scheduleSave();
    };

    const inpQuickAccountNumber = document.getElementById('edQuickAccountNumber');
    if (inpQuickAccountNumber) {
        inpQuickAccountNumber.oninput = (e) => {
            queueHistory();
            n.accountNumber = e.target.value;
            syncMetaDisplays();
            scheduleSave();
        };
    }

    const inpQuickCitizenNumber = document.getElementById('edQuickCitizenNumber');
    if (inpQuickCitizenNumber) {
        inpQuickCitizenNumber.oninput = (e) => {
            queueHistory();
            n.citizenNumber = e.target.value;
            syncMetaDisplays();
            scheduleSave();
        };
    }

    const inpDescription = document.getElementById('edDescription');
    if (inpDescription) {
        inpDescription.oninput = (e) => {
            queueHistory();
            n.description = e.target.value;
            n.notes = e.target.value;
            scheduleSave();
        };
    }

    Array.from(document.querySelectorAll('[data-person-status]')).forEach((btn) => {
        btn.onclick = () => {
            const nextStatus = normalizePersonStatus(btn.getAttribute('data-person-status'), n.type);
            if (nextStatus === normalizePersonStatus(n.personStatus, n.type)) return;
            queueHistory();
            n.personStatus = nextStatus;
            refreshLists();
            renderEditor();
            draw();
            scheduleSave();
        };
    });

    const linkNameInput = document.getElementById('editorLinkName');
    const linkTypeSelect = document.getElementById('editorLinkType');
    const linkKindSelect = document.getElementById('editorLinkKind');
    const linkHint = document.getElementById('editorLinkHint');
    const btnAddLinkQuick = document.getElementById('btnAddLinkQuick');
    const linkNameResults = document.getElementById('editorLinkNameResults');
    const mergeInput = document.getElementById('mergeTarget');
    const mergeResults = document.getElementById('mergeTargetResults');
    const btnMergeApply = document.getElementById('btnMergeApply');
    const mergeRail = document.getElementById('editorMergeRail');

    const resolveQuickLinkTarget = () => {
        const rawName = normalizeNodeLookupName(linkNameInput?.value || '');
        if (!rawName) return null;
        return state.nodes.find((item) => normalizeNodeLookupName(item.name || '') === rawName) || null;
    };

    const syncQuickLinkKindTitle = () => {
        if (!linkKindSelect) return;
        const selectedOption = linkKindSelect.selectedOptions?.[0];
        linkKindSelect.title = selectedOption ? selectedOption.textContent.trim().replace(/\s+/g, ' ') : '';
    };

    const syncQuickLinkComposer = () => {
        if (!linkTypeSelect || !linkKindSelect) return;
        const target = resolveQuickLinkTarget();
        const targetType = target ? target.type : String(linkTypeSelect.value || TYPES.PERSON);
        const selectedKind = String(linkKindSelect.value || '');
        linkTypeSelect.value = targetType;
        linkTypeSelect.disabled = !!target;
        linkKindSelect.innerHTML = buildKindOptions(getAllowedKindsForTarget(n.type, targetType), selectedKind);
        if (linkHint) {
            linkHint.textContent = target
                ? `${target.name} existe deja. Son type est verrouille automatiquement.`
                : `Si la fiche n'existe pas, elle sera creee comme ${targetType === TYPES.COMPANY ? 'entreprise' : (targetType === TYPES.GROUP ? 'groupe' : 'personne')}.`;
        }
        syncQuickLinkKindTitle();
    };

    const submitQuickLink = () => {
        if (!ensureCloudWriteAccess()) return;
        const name = String(linkNameInput?.value || '').trim();
        const kind = String(linkKindSelect?.value || '').trim();
        const selectedType = String(linkTypeSelect?.value || TYPES.PERSON);
        if (!name) {
            showCustomAlert('Renseigne le nom de la fiche a lier.');
            return;
        }

        let target = resolveQuickLinkTarget();
        if (!target) {
            target = ensureNode(selectedType, name, {
                x: Number(n.x || 0) + 120,
                y: Number(n.y || 0)
            });
            logNodeAdded(target.name, n.name);
        }

        if (String(target.id) === String(n.id)) {
            showCustomAlert('Impossible de lier une fiche a elle-meme.');
            return;
        }

        const added = addUILink(n.id, target.id, kind, { actor: n.name });
        if (!added) {
            showCustomAlert('Lien deja existant ou invalide.');
            return;
        }

        if (linkNameInput) linkNameInput.value = '';
        linkAutocomplete.hide();
        requestAnimationFrame(() => {
            document.getElementById('editorLinkName')?.focus();
        });
    };

    const linkAutocomplete = attachEditorAutocomplete({
        input: linkNameInput,
        resultsEl: linkNameResults,
        excludedIds: [n.id],
        onPick: () => syncQuickLinkComposer(),
        onInputChange: () => syncQuickLinkComposer(),
        onSubmit: submitQuickLink
    });
    if (linkTypeSelect) linkTypeSelect.onchange = () => syncQuickLinkComposer();
    if (linkKindSelect) linkKindSelect.onchange = () => syncQuickLinkKindTitle();
    if (btnAddLinkQuick) btnAddLinkQuick.onclick = submitQuickLink;
    syncQuickLinkComposer();

    const runMerge = (targetName) => {
        if (!ensureCloudWriteAccess()) return;
        const normalizedTarget = normalizeNodeLookupName(targetName);
        const target = state.nodes.find((item) => normalizeNodeLookupName(item.name || '') === normalizedTarget);
        if (target && target.id !== n.id) {
            showCustomConfirm(`Fusionner "${n.name}" DANS "${target.name}" ?`, () => {
                mergeNodes(n.id, target.id);
                selectNode(target.id);
                scheduleSave();
                refreshHvt();
            });
        } else {
            showCustomAlert("Cible invalide.");
        }
    };

    const submitMergeTarget = () => {
        const targetNameRaw = mergeInput ? mergeInput.value.trim() : '';
        if (!targetNameRaw) {
            showCustomAlert('Choisis une fiche pour la fusion.');
            mergeInput?.focus();
            return;
        }
        runMerge(targetNameRaw);
    };

    const mergeAutocomplete = attachEditorAutocomplete({
        input: mergeInput,
        resultsEl: mergeResults,
        excludedIds: [n.id],
        onSubmit: submitMergeTarget
    });

    const closeMergeRail = () => {
        if (!mergeRail) return;
        mergeRail.hidden = true;
        btnMergeLaunch?.classList.remove('active');
    };
    const openMergeRail = () => {
        if (!mergeRail) return;
        mergeRail.hidden = false;
        btnMergeLaunch?.classList.add('active');
        requestAnimationFrame(() => {
            mergeInput?.focus();
            mergeInput?.select();
        });
    };

    if (document.__pointMergeOutsideHandler) {
        document.removeEventListener('mousedown', document.__pointMergeOutsideHandler, true);
    }
    document.__pointMergeOutsideHandler = (event) => {
        if (!mergeRail || mergeRail.hidden) return;
        if (mergeRail.contains(event.target)) return;
        if (btnMergeLaunch && btnMergeLaunch.contains(event.target)) return;
        closeMergeRail();
    };
    document.addEventListener('mousedown', document.__pointMergeOutsideHandler, true);

    if (btnMergeLaunch) {
        btnMergeLaunch.onclick = () => {
            if (!mergeRail) return;
            if (mergeRail.hidden) openMergeRail();
            else closeMergeRail();
        };
    }

    if (btnMergeApply) btnMergeApply.onclick = () => {
        mergeAutocomplete.hide();
        submitMergeTarget();
        closeMergeRail();
    };

    document.getElementById('btnExportRP').onclick = () => {
        const typeLabel = n.type === TYPES.PERSON ? "Individu" : (n.type === TYPES.COMPANY ? "Entreprise" : "Organisation");
        const statusLabel = PERSON_STATUS_LABELS[normalizePersonStatus(n.personStatus, n.type)] || '';
        const relations = [];
        state.links.forEach(l => {
            const s = (typeof l.source === 'object') ? l.source : nodeById(l.source);
            const t = (typeof l.target === 'object') ? l.target : nodeById(l.target);
            if (!s || !t) return;
            if (s.id === n.id || t.id === n.id) {
                const other = (s.id === n.id) ? t : s;
                const kind = kindToLabel(l.kind).toUpperCase();
                const emoji = linkKindEmoji(l.kind);
                relations.push(`- ${emoji} [${kind}] ${other.name}`);
            }
        });
        const reportDescription = n.description || n.notes || 'R.A.S';
        const report = `📂 DOSSIER : ${n.name.toUpperCase()}\n================================\n🆔 ${typeLabel} ${n.num ? '| 📞 ' + n.num : ''}${statusLabel ? ' | ⚑ ' + statusLabel.toUpperCase() : ''}\n🧾 COMPTE : ${n.accountNumber || 'N/A'}\n🪪 CITOYEN : ${n.citizenNumber || 'N/A'}\n📝 DESCRIPTION :\n${reportDescription}\n--------------------------------\n🔗 RÉSEAU (${relations.length}) :\n${relations.length > 0 ? relations.join('\n') : "Aucun lien connu."}\n================================`.trim();
        navigator.clipboard.writeText(report).then(() => { showCustomAlert("✅ Dossier copié !"); });
    };
}

function renderActiveLinks(n) {
    const chipsContainer = document.getElementById('chipsLinks');
    const linksCount = document.getElementById('editorLinksCount');
    let activeSelect = null;
    let activeBadge = null;
    let outsideHandler = null;
    const myLinks = state.links.filter(l => {
        const s = (typeof l.source === 'object') ? l.source.id : l.source;
        const t = (typeof l.target === 'object') ? l.target.id : l.target;
        return s === n.id || t === n.id;
    });

    if (linksCount) linksCount.textContent = String(myLinks.length);

    if (myLinks.length === 0) {
        chipsContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#666; font-style:italic; font-size:0.8rem;">Aucune connexion active</div>';
        return;
    }

    const groups = { [TYPES.COMPANY]: [], [TYPES.GROUP]: [], [TYPES.PERSON]: [] };
    myLinks.forEach(l => {
        const s = (typeof l.source === 'object') ? l.source : nodeById(l.source);
        const t = (typeof l.target === 'object') ? l.target : nodeById(l.target);
        if (!s || !t) return;
        const other = (s.id === n.id) ? t : s;
        groups[other.type].push({ link: l, other });
    });

    const getAllowedKinds = (sourceType, targetType) => {
        let base;
        if (sourceType === TYPES.PERSON && targetType === TYPES.PERSON) base = PERSON_PERSON_KINDS;
        else if (sourceType === TYPES.PERSON || targetType === TYPES.PERSON) base = PERSON_ORG_KINDS;
        else base = ORG_ORG_KINDS;
        const allowed = new Set(base);
        allowed.add(KINDS.RELATION);
        return allowed;
    };

    const renderGroup = (title, items) => {
        if (items.length === 0) return '';
        const cards = items.map((item) => {
            const linkColor = computeLinkColor(item.link);
            const typeLabel = kindToLabel(item.link.kind);
            const emoji = linkKindEmoji(item.link.kind);
            return `
            <div class="chip" data-link-id="${item.link.id}" style="border-left-color: ${linkColor};">
                <div class="chip-content">
                    <span class="chip-name" data-node-id="${escapeHtml(String(item.other.id))}">${escapeHtml(item.other.name)}</span>
                    <div class="chip-meta"><span class="chip-badge" data-link-id="${item.link.id}" style="color: ${linkColor};">${emoji} ${typeLabel}</span></div>
                </div>
                <div class="x" title="Supprimer le lien" data-id="${item.link.id}">×</div>
            </div>`;
        }).join('');

        return `
            <section class="link-group-section">
                <div class="link-group-head">
                    <div class="link-category">${title}</div>
                    <div class="link-group-count">${items.length}</div>
                </div>
                <div class="link-grid">${cards}</div>
            </section>
        `;
    };

    chipsContainer.innerHTML = `
        ${renderGroup('PERSONNES', groups[TYPES.PERSON])}
        ${renderGroup('ENTREPRISES', groups[TYPES.COMPANY])}
        ${renderGroup('GROUPES', groups[TYPES.GROUP])}
    `;

    const closeActiveSelect = () => {
        if (!activeSelect) return;
        const badge = activeBadge;
        const linkId = badge?.dataset.linkId;
        const link = linkId ? state.links.find(l => String(l.id) === String(linkId)) : null;
        if (badge && link) {
            badge.textContent = `${linkKindEmoji(link.kind)} ${kindToLabel(link.kind)}`;
        } else {
            renderEditor();
        }
        activeSelect = null;
        activeBadge = null;
        if (outsideHandler) {
            document.removeEventListener('click', outsideHandler);
            outsideHandler = null;
        }
    };

    chipsContainer.onclick = (e) => {
        const nodeName = e.target.closest('.chip-name[data-node-id]');
        if (nodeName) {
            const nodeId = nodeName.dataset.nodeId;
            if (nodeId) window.zoomToNode(nodeId);
            return;
        }

        const delBtn = e.target.closest('.x');
        if(delBtn) {
            if (!ensureCloudWriteAccess()) return;
            pushHistory();
            const linkId = delBtn.dataset.id;
            state.links = state.links.filter(l => String(l.id) !== String(linkId));
            if (state.focusMode) refreshFocusMode();
            updatePersonColors(); updateDegreeCache(); restartSim(); renderEditor(); updatePathfindingPanel(); draw(); scheduleSave(); refreshHvt();
            return;
        }

        if (activeSelect && activeSelect.contains(e.target)) return;

        const badge = e.target.closest('.chip-badge');
        if (badge) {
            if (!ensureCloudWriteAccess()) return;
            e.preventDefault();
            e.stopPropagation();
            if (activeBadge && badge === activeBadge) return;
            closeActiveSelect();

            const linkId = badge.dataset.linkId || badge.closest('.chip')?.dataset.linkId;
            const link = state.links.find(l => String(l.id) === String(linkId));
            if (!link) return;

            const s = (typeof link.source === 'object') ? link.source : nodeById(link.source);
            const t = (typeof link.target === 'object') ? link.target : nodeById(link.target);
            if (!s || !t) return;
            const other = (s.id === n.id) ? t : s;

            const allowedKinds = getAllowedKinds(n.type, other.type);
            const kindsForUi = new Set(allowedKinds);
            if (link.kind) kindsForUi.add(link.kind);
            const options = Object.keys(KIND_LABELS)
                .filter(k => kindsForUi.has(k))
                .map(k => `<option value="${k}">${linkKindEmoji(k)} ${kindToLabel(k)}</option>`)
                .join('');

            const select = document.createElement('select');
            select.className = 'compact-select';
            select.style.fontSize = '0.7rem';
            select.style.padding = '2px 6px';
            select.innerHTML = options;
            select.value = link.kind;

            badge.textContent = '';
            badge.appendChild(select);
            activeSelect = select;
            activeBadge = badge;

            const applyChange = () => {
                const nextKind = select.value;
                if (nextKind && nextKind !== link.kind) {
                    pushHistory();
                    link.kind = nextKind;
                    updatePersonColors();
                    restartSim();
                    updatePathfindingPanel();
                    scheduleSave();
                    refreshHvt();
                }
                renderEditor();
            };

            select.onchange = applyChange;
            select.onblur = () => {};
            select.onkeydown = (ev) => {
                if (ev.key === 'Enter') applyChange();
                if (ev.key === 'Escape') renderEditor();
            };
            select.focus();

            outsideHandler = (ev) => {
                if (activeBadge && activeBadge.contains(ev.target)) return;
                closeActiveSelect();
            };
            setTimeout(() => {
                document.addEventListener('click', outsideHandler);
            }, 0);
        }
    };
}
