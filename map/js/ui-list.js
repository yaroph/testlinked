import { state, saveLocalState } from './state.js';
import { selectItem } from './ui.js';
import { renderAll } from './render.js';
import { updateTransform } from './engine.js'; 
import { openGroupEditor } from './ui-modals.js'; // IMPORT NÉCESSAIRE
import { escapeHtml } from './utils.js';

export function renderGroupsList() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    
    // FIX SCROLL
    const currentScroll = container.scrollTop;

    container.innerHTML = ''; 

    state.groups.forEach((group, gIndex) => {
        // FILTRAGE
        const term = state.searchTerm ? state.searchTerm.toLowerCase() : '';
        const filteredPoints = group.points.filter(p => {
            if (!term) return true;
            return (p.name && p.name.toLowerCase().includes(term)) || 
                   (p.type && p.type.toLowerCase().includes(term));
        });

        if (term && filteredPoints.length === 0 && (!group.zones || group.zones.length === 0)) {
            return;
        }

        const pointCount = filteredPoints.length;
        const zoneCount = group.zones ? group.zones.length : 0;
        const totalCount = pointCount + zoneCount;

        const groupEl = document.createElement('div');
        groupEl.className = 'group-item';
        groupEl.style.setProperty('--group-color', group.color);
        
        // HEADER
        const header = document.createElement('div');
        header.className = 'group-header';

        const eyeOpacity = group.visible ? '1' : '0.45';
        const groupSummary = `${pointCount} point${pointCount > 1 ? 's' : ''} · ${zoneCount} zone${zoneCount > 1 ? 's' : ''}`;

        header.innerHTML = `
            <div class="group-header-main">
                <span class="color-dot"></span>
                <div class="group-header-copy">
                    <span class="group-title">${escapeHtml(group.name)}</span>
                    <span class="group-sub">${escapeHtml(groupSummary)}</span>
                </div>
            </div>
            <div class="group-actions">
                <span class="group-count">${totalCount}</span>
                <button class="mini-btn btn-settings" title="Modifier/Supprimer">
                    ⚙️
                </button>

                <button class="mini-btn btn-focus" title="Centrer la vue">
                    🎯
                </button>
                
                <button class="mini-btn btn-visibility" title="Afficher/Masquer" style="opacity:${eyeOpacity};">
                    👁️
                </button>
            </div>
        `;

        // LISTE CONTENU
        const contentList = document.createElement('div');
        contentList.className = 'group-content';
        if (term) {
            contentList.classList.add('is-open');
            groupEl.classList.add('is-open');
        }

        // Points
        if(filteredPoints.length > 0) {
            filteredPoints.forEach((p) => {
                const originalPIndex = group.points.indexOf(p);
                const pRow = document.createElement('div');
                pRow.className = 'group-entry';
                pRow.innerHTML = `
                    <span class="group-entry-icon">●</span>
                    <span class="group-entry-text">${escapeHtml(p.name)}</span>
                `;
                pRow.onclick = (e) => {
                    e.stopPropagation();
                    selectItem('point', gIndex, originalPIndex);
                    focusOnTarget(p.x, p.y);
                };
                contentList.appendChild(pRow);
            });
        }

        // Zones
        if(group.zones && group.zones.length > 0) {
            group.zones.forEach((z, zIndex) => {
                const zRow = document.createElement('div');
                zRow.className = 'group-entry group-entry-zone';
                const icon = z.type === 'CIRCLE' ? '◌' : '△';
                zRow.innerHTML = `
                    <span class="group-entry-icon">${icon}</span>
                    <span class="group-entry-text">${escapeHtml(z.name || 'Zone sans nom')}</span>
                `;
                zRow.onclick = (e) => {
                    e.stopPropagation();
                    selectItem('zone', gIndex, zIndex);
                    // Calcul centre
                    let targetX = 0, targetY = 0;
                    if (z.type === 'CIRCLE') { targetX = z.cx; targetY = z.cy; } 
                    else if (z.points) {
                        let sumX = 0, sumY = 0;
                        z.points.forEach(pt => { sumX += pt.x; sumY += pt.y; });
                        targetX = sumX / z.points.length; targetY = sumY / z.points.length;
                    }
                    focusOnTarget(targetX, targetY);
                };
                contentList.appendChild(zRow);
            });
        }

        // EVENTS HEADER
        header.onclick = (e) => {
            if(e.target.closest('button')) return;
            const isOpen = contentList.classList.contains('is-open');
            contentList.classList.toggle('is-open', !isOpen);
            groupEl.classList.toggle('is-open', !isOpen);
        };

        const btnVis = header.querySelector('.btn-visibility');
        if (btnVis) btnVis.onclick = (e) => {
            e.stopPropagation();
            group.visible = !group.visible;
            renderAll(); 
            renderGroupsList(); 
            saveLocalState();
        };

        const btnFocus = header.querySelector('.btn-focus');
        if (btnFocus) btnFocus.onclick = (e) => {
            e.stopPropagation();
            focusOnGroup(group);
        };
        
        // LOGIQUE BOUTON EDIT (NOUVEAU)
        const btnEdit = header.querySelector('.btn-settings');
        if (btnEdit) btnEdit.onclick = (e) => {
            e.stopPropagation();
            openGroupEditor(gIndex); // Appel à la modale
        };

        groupEl.appendChild(header);
        groupEl.appendChild(contentList);
        container.appendChild(groupEl);
    });

    container.scrollTop = currentScroll;
}

function focusOnTarget(percentX, percentY) {
    const viewport = document.getElementById('viewport');
    if(!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const mapW = state.mapWidth || 2000; 
    const mapH = state.mapHeight || 2000;
    const targetScale = 2.5; 

    state.view.scale = targetScale;
    state.view.x = (vw / 2) - (percentX * mapW / 100) * targetScale;
    state.view.y = (vh / 2) - (percentY * mapH / 100) * targetScale;
    updateTransform();
}

function focusOnGroup(group) {
    if ((!group.points || group.points.length === 0) && (!group.zones || group.zones.length === 0)) return;

    let minX = 100, maxX = 0, minY = 100, maxY = 0;
    let found = false;

    if(group.points) {
        group.points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
            found = true;
        });
    }

    if (group.zones) {
        group.zones.forEach(z => {
            if(z.type === 'CIRCLE') {
                if (z.cx < minX) minX = z.cx;
                if (z.cx > maxX) maxX = z.cx;
                if (z.cy < minY) minY = z.cy;
                if (z.cy > maxY) maxY = z.cy;
                found = true;
            } else if (z.points) {
                z.points.forEach(zp => {
                    if (zp.x < minX) minX = zp.x;
                    if (zp.x > maxX) maxX = zp.x;
                    if (zp.y < minY) minY = zp.y;
                    if (zp.y > maxY) maxY = zp.y;
                    found = true;
                });
            }
        });
    }

    if (found) {
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        let width = maxX - minX;
        let height = maxY - minY;
        
        if(width < 1) width = 10;
        if(height < 1) height = 10;

        const viewport = document.getElementById('viewport');
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        const mapW = state.mapWidth || 2000; 
        const mapH = state.mapHeight || 2000;

        const contentW = (width / 100) * mapW;
        const contentH = (height / 100) * mapH;
        
        const scaleX = vw / (contentW * 1.5); 
        const scaleY = vh / (contentH * 1.5);
        const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 4.0);

        state.view.scale = newScale;
        state.view.x = (vw / 2) - (centerX * mapW / 100) * state.view.scale;
        state.view.y = (vh / 2) - (centerY * mapH / 100) * state.view.scale;
        
        updateTransform();
    }
}
