import { state, saveLocalState, pruneTacticalLinks } from './state.js';
import { ICONS } from './constants.js';
import { customConfirm, customAlert } from './ui-modals.js';
import { percentageToGps, gpsToPercentage, escapeHtml } from './utils.js';
import { renderAll } from './render.js';
import { renderGroupsList } from './ui-list.js';
import { deselect } from './ui.js';
import {
    bindMapRealtimeTextField,
    unbindMapRealtimeTextFields,
    syncMapRealtimeAwarenessDecorations,
    ensureCloudWriteAccess,
    isCloudBoardReadOnly,
    getCloudReadOnlyMessage
} from './cloud.js';

const sidebarRight = document.getElementById('sidebar-right');
const editorContent = document.getElementById('editor-content');

function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, '&#10;');
}

function renderEmptyEditor() {
    editorContent.innerHTML = `
        <div class="empty-state">
            <span class="empty-state-kicker">Aucune cible</span>
            <strong>Sélectionnez un point ou une zone.</strong>
        </div>
    `;
}

function decorateReadOnlyEditor() {
    if (!editorContent || !isCloudBoardReadOnly()) return;
    if (!editorContent.querySelector('.cloud-readonly-banner')) {
        const banner = document.createElement('div');
        banner.className = 'cloud-readonly-banner';
        banner.textContent = getCloudReadOnlyMessage() || 'Lecture seule sur ce board.';
        banner.style.cssText = 'margin:0 0 12px; padding:10px 12px; border-radius:12px; border:1px dashed rgba(255, 204, 138, 0.32); background:rgba(18, 12, 4, 0.72); color:#ffd8a4; font-size:0.78rem; line-height:1.45;';
        editorContent.prepend(banner);
    }

    const allowedButtonIds = new Set(['btnClose', 'btnCopyId', 'btnCopyCoords']);
    editorContent.querySelectorAll('input, select, textarea, button').forEach((field) => {
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

export function renderEditor() {
    unbindMapRealtimeTextFields();
    if (state.selectedPoint) {
        renderPointEditor();
        return;
    }
    if (state.selectedZone) {
        renderZoneEditor();
        return;
    }
    renderEmptyEditor();
    closeEditor();
}

function renderZoneEditor() {
    sidebarRight.classList.add('active');
    const { groupIndex, zoneIndex } = state.selectedZone;
    const group = state.groups[groupIndex];
    if (!group || !group.zones[zoneIndex]) {
        deselect();
        return;
    }

    const zone = group.zones[zoneIndex];
    const isCircle = zone.type === 'CIRCLE';
    const gpsCoords = percentageToGps(zone.cx || 0, zone.cy || 0);

    const groupOptions = state.groups.map((entry, index) =>
        `<option value="${index}" ${index === groupIndex ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`
    ).join('');

    const geometryBlock = isCircle ? `
        <div class="editor-section" style="--editor-accent:#dff7ff;">
            <div class="editor-section-title">
                <span>Géométrie GPS</span>
            </div>
            <div class="editor-row">
                <div class="editor-col">
                    <label>Rayon</label>
                    <input type="number" id="ezR" value="${Number(zone.r || 0).toFixed(2)}" step="0.1" class="cyber-input">
                </div>
            </div>
            <div class="editor-row">
                <div class="editor-col">
                    <label>X</label>
                    <input type="number" id="ezX" value="${gpsCoords.x.toFixed(2)}" step="1" class="cyber-input">
                </div>
                <div class="editor-col">
                    <label>Y</label>
                    <input type="number" id="ezY" value="${gpsCoords.y.toFixed(2)}" step="1" class="cyber-input">
                </div>
            </div>
        </div>
    ` : `
        <div class="editor-section" style="--editor-accent:#dff7ff;">
            <div class="editor-section-title">
                <span>Géométrie</span>
            </div>
            <p class="editor-caption">
                Forme libre avec ${zone.points.length} points.
                Déplacez la zone directement sur la carte.
            </p>
        </div>
    `;

    editorContent.innerHTML = `
        <div class="editor-shell">
            <button id="btnClose" class="ui-close-x editor-panel-close" type="button" aria-label="Fermer">×</button>
            <div class="editor-section" style="--editor-accent:${escapeAttr(group.color)};">
                <div class="editor-section-title">
                    <span>Zone tactique</span>
                    <span class="editor-pill">${isCircle ? 'Cercle' : 'Polygone'}</span>
                </div>
                <input
                    type="text"
                    id="ezName"
                    value="${escapeAttr(zone.name || '')}"
                    class="cyber-input"
                >
                <div id="mapAwZoneName" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:6px; font-size:0.68rem; color:#ffcc8a;"></div>
            </div>

            ${geometryBlock}

            <div class="editor-section" style="--editor-accent:#ffcc8a;">
                <div class="editor-section-title">
                    <span>Calque</span>
                </div>
                <select id="ezGroup" class="cyber-input">${groupOptions}</select>
            </div>

            <div class="editor-actions-row editor-actions-row-single">
                <button id="btnDeleteZone" class="btn-delete-zone">Supprimer</button>
            </div>
        </div>
    `;
    decorateReadOnlyEditor();

    const zoneNameInput = document.getElementById('ezName');
    if (!bindMapRealtimeTextField('zone', zone, 'name', zoneNameInput)) {
        zoneNameInput.oninput = (event) => {
            zone.name = event.target.value;
            renderAll();
            renderGroupsList();
            saveLocalState();
        };
    }

    document.getElementById('ezGroup').onchange = (event) => {
        if (!ensureCloudWriteAccess()) return;
        const nextGroupIndex = parseInt(event.target.value, 10);
        group.zones.splice(zoneIndex, 1);
        state.groups[nextGroupIndex].zones.push(zone);
        state.selectedZone = {
            groupIndex: nextGroupIndex,
            zoneIndex: state.groups[nextGroupIndex].zones.length - 1
        };
        renderGroupsList();
        renderAll();
        renderEditor();
        saveLocalState();
    };

    if (isCircle) {
        const inpR = document.getElementById('ezR');
        const inpX = document.getElementById('ezX');
        const inpY = document.getElementById('ezY');

        const updateGeometry = () => {
            if (!ensureCloudWriteAccess()) return;
            zone.r = parseFloat(inpR.value) || 0;
            const percentCoords = gpsToPercentage(
                parseFloat(inpX.value) || 0,
                parseFloat(inpY.value) || 0
            );
            zone.cx = percentCoords.x;
            zone.cy = percentCoords.y;
            renderAll();
            saveLocalState();
        };

        inpR.oninput = updateGeometry;
        inpX.oninput = updateGeometry;
        inpY.oninput = updateGeometry;
    }

    document.getElementById('btnDeleteZone').onclick = async () => {
        if (!ensureCloudWriteAccess()) return;
        if (await customConfirm('SUPPRESSION', 'Supprimer cette zone ?')) {
            group.zones.splice(zoneIndex, 1);
            renderGroupsList();
            deselect();
            saveLocalState();
        }
    };

    document.getElementById('btnClose').onclick = deselect;
    syncMapRealtimeAwarenessDecorations();
}

function renderPointEditor() {
    sidebarRight.classList.add('active');
    const { groupIndex, pointIndex } = state.selectedPoint;
    const group = state.groups[groupIndex];
    if (!group || !group.points[pointIndex]) {
        deselect();
        return;
    }

    const point = group.points[pointIndex];
    const gpsCoords = percentageToGps(point.x, point.y);

    const iconOptions = Object.keys(ICONS).map((key) =>
        `<option value="${escapeAttr(key)}" ${point.iconType === key ? 'selected' : ''}>${escapeHtml(key)}</option>`
    ).join('');

    const groupOptions = state.groups.map((entry, index) =>
        `<option value="${index}" ${index === groupIndex ? 'selected' : ''}>${escapeHtml(entry.name)}</option>`
    ).join('');

    editorContent.innerHTML = `
        <div class="editor-shell">
            <button id="btnClose" class="ui-close-x editor-panel-close" type="button" aria-label="Fermer">×</button>
            <div class="editor-section" style="--editor-accent:${escapeAttr(group.color)};">
                <div class="editor-section-title">
                    <span>Identification</span>
                    <button id="btnCopyId" class="mini-btn" type="button">ID</button>
                </div>
                <div class="editor-meta-grid">
                    <input
                        type="text"
                        id="edName"
                        value="${escapeAttr(point.name || '')}"
                        class="cyber-input"
                    >
                    <div id="mapAwPointName" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:6px; font-size:0.68rem; color:#ffcc8a;"></div>
                    <input
                        type="text"
                        id="edType"
                        value="${escapeAttr(point.type || '')}"
                        placeholder="Type / affiliation"
                        class="cyber-input"
                    >
                    <div id="mapAwPointType" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:6px; font-size:0.68rem; color:#ffcc8a;"></div>
                </div>
            </div>

            <div class="editor-section" style="--editor-accent:#dff7ff;">
                <div class="editor-section-title">
                    <span>Actions tactiques</span>
                </div>
                <div class="editor-actions-grid">
                    <button id="btnLinkPoint" class="mini-btn editor-link-btn" type="button">Nouvelle liaison</button>
                </div>
            </div>

            <div class="editor-section" style="--editor-accent:#ffcc8a;">
                <div class="editor-section-title">
                    <span>Classification</span>
                </div>
                <div class="editor-meta-grid">
                    <select id="edIcon" class="cyber-input">${iconOptions}</select>
                    <div class="editor-col">
                        <label>Calque</label>
                        <select id="edGroup" class="cyber-input">${groupOptions}</select>
                    </div>
                </div>
            </div>

            <div class="editor-section" style="--editor-accent:#dff7ff;">
                <div class="editor-section-title">
                    <span>Position GPS</span>
                </div>
                <div class="editor-row">
                    <div class="editor-col">
                        <label>X</label>
                        <input type="number" id="edX" value="${gpsCoords.x.toFixed(2)}" step="1" class="cyber-input">
                    </div>
                    <div class="editor-col">
                        <label>Y</label>
                        <input type="number" id="edY" value="${gpsCoords.y.toFixed(2)}" step="1" class="cyber-input">
                    </div>
                </div>
                <button id="btnCopyCoords" class="btn-close-editor" type="button">Copier coordonnees</button>
            </div>

            <div class="editor-section" style="--editor-accent:#ff738d;">
                <div class="editor-section-title">
                    <span>Intel</span>
                </div>
                <textarea id="edNotes" class="cyber-input" placeholder="Notes...">${escapeHtml(point.notes || '')}</textarea>
                <div id="mapAwPointNotes" class="editor-realtime-presence" style="display:none; min-height:14px; margin-top:6px; font-size:0.68rem; color:#ffcc8a;"></div>
            </div>

            <div class="editor-actions-row editor-actions-row-single">
                <button id="btnDelete" class="btn-delete-zone" type="button">Supprimer</button>
            </div>
        </div>
    `;
    decorateReadOnlyEditor();

    const pointNameInput = document.getElementById('edName');
    if (!bindMapRealtimeTextField('point', point, 'name', pointNameInput)) {
        pointNameInput.oninput = (event) => {
            point.name = event.target.value;
            renderAll();
            renderGroupsList();
            saveLocalState();
        };
    }

    document.getElementById('edIcon').onchange = (event) => {
        if (!ensureCloudWriteAccess()) return;
        point.iconType = event.target.value;
        renderAll();
        saveLocalState();
    };

    const pointTypeInput = document.getElementById('edType');
    if (!bindMapRealtimeTextField('point', point, 'type', pointTypeInput)) {
        pointTypeInput.oninput = (event) => {
            point.type = event.target.value;
            renderGroupsList();
            saveLocalState();
        };
    }

    const pointNotesInput = document.getElementById('edNotes');
    if (!bindMapRealtimeTextField('point', point, 'notes', pointNotesInput)) {
        pointNotesInput.oninput = (event) => {
            point.notes = event.target.value;
            saveLocalState();
        };
    }

    const updateCoords = () => {
        if (!ensureCloudWriteAccess()) return;
        const percent = gpsToPercentage(
            parseFloat(document.getElementById('edX').value) || 0,
            parseFloat(document.getElementById('edY').value) || 0
        );
        point.x = percent.x;
        point.y = percent.y;
        renderAll();
        saveLocalState();
    };

    document.getElementById('edX').oninput = updateCoords;
    document.getElementById('edY').oninput = updateCoords;

    document.getElementById('edGroup').onchange = (event) => {
        if (!ensureCloudWriteAccess()) return;
        const nextGroupIndex = parseInt(event.target.value, 10);
        group.points.splice(pointIndex, 1);
        state.groups[nextGroupIndex].points.push(point);
        state.selectedPoint = {
            groupIndex: nextGroupIndex,
            pointIndex: state.groups[nextGroupIndex].points.length - 1
        };
        renderGroupsList();
        renderAll();
        renderEditor();
        saveLocalState();
    };

    document.getElementById('btnLinkPoint').onclick = () => {
        if (!ensureCloudWriteAccess()) return;
        state.linkingMode = true;
        state.linkStartId = point.id;
        closeEditor();
        customAlert('MODE LIAISON', 'Cliquez sur un second point.');
        document.body.style.cursor = 'crosshair';
    };

    document.getElementById('btnCopyId').onclick = () => navigator.clipboard.writeText(point.id);
    document.getElementById('btnCopyCoords').onclick = () => navigator.clipboard.writeText(`${gpsCoords.x.toFixed(2)}, ${gpsCoords.y.toFixed(2)}`);

    document.getElementById('btnDelete').onclick = async () => {
        if (!ensureCloudWriteAccess()) return;
        if (await customConfirm('SUPPRESSION', 'Supprimer ce point ?')) {
            const removedId = point.id;
            group.points.splice(pointIndex, 1);
            pruneTacticalLinks([removedId]);
            deselect();
            renderGroupsList();
            saveLocalState();
        }
    };

    document.getElementById('btnClose').onclick = deselect;
    syncMapRealtimeAwarenessDecorations();
}

export function closeEditor() {
    sidebarRight.classList.remove('active');
    unbindMapRealtimeTextFields();
}
