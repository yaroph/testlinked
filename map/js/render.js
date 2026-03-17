import { state } from './state.js';
import { ICONS, MAP_SCALE_UNIT } from './constants.js';
import { handleLinkClick, handleLinkHover, handleLinkOut, moveTooltip, selectItem, syncInteractionModeHud, syncMapEmptyState } from './ui.js';
import { startMarkerDrag } from './engine.js';
import { handleZoneMouseDown } from './zone-editor.js';
import { escapeHtml } from './utils.js';

const markersLayer = document.getElementById('markers-layer');
const zonesLayer = document.getElementById('zones-layer');
const alertLayer = document.getElementById('alert-layer');
const linksLayer = document.getElementById('links-layer');
const SVG_NS = 'http://www.w3.org/2000/svg';

document.addEventListener('mousemove', moveTooltip);

const ICON_TINT_MIX = 0.65;

function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '').trim();
    if (clean.length === 3) {
        return {
            r: parseInt(clean[0] + clean[0], 16),
            g: parseInt(clean[1] + clean[1], 16),
            b: parseInt(clean[2] + clean[2], 16)
        };
    }
    if (clean.length === 6) {
        return {
            r: parseInt(clean.slice(0, 2), 16),
            g: parseInt(clean.slice(2, 4), 16),
            b: parseInt(clean.slice(4, 6), 16)
        };
    }
    return null;
}

function mixHex(baseHex, mixHexColor, mixRatio) {
    const base = hexToRgb(baseHex);
    const mix = hexToRgb(mixHexColor);
    if (!base || !mix) return null;
    const r = Math.round(base.r * (1 - mixRatio) + mix.r * mixRatio);
    const g = Math.round(base.g * (1 - mixRatio) + mix.g * mixRatio);
    const b = Math.round(base.b * (1 - mixRatio) + mix.b * mixRatio);
    const toHex = (v) => v.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getContrastColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#ffffff';
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return lum > 0.6 ? '#000000' : '#ffffff';
}

function configureSVG(layer) {
    if (layer) {
        layer.setAttribute('viewBox', '0 0 100 100');
        layer.setAttribute('preserveAspectRatio', 'none');
        layer.style.position = 'absolute';
        layer.style.top = '0';
        layer.style.left = '0';
        layer.style.display = 'block';
        layer.style.overflow = 'visible';
        layer.style.pointerEvents = 'none';
        layer.style.width = '100%';
        layer.style.height = '100%';
    }
}

function getTacticalLinkWidths() {
    const scale = Math.max(0.08, Number(state.view?.scale || 1));
    const zoomCompensation = 1 / Math.sqrt(scale);
    const normal = Math.min(0.5, Math.max(0.15, 0.16 * zoomCompensation));
    const hover = Math.min(0.95, normal * 2.1);
    return { normal, hover };
}

function sanitizeDomIdSegment(value, fallback = 'item') {
    const clean = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return clean || fallback;
}

function removeStaleElements(layer, selector, activeIds) {
    if (!layer) return;
    Array.from(layer.querySelectorAll(selector)).forEach((el) => {
        if (!activeIds.has(String(el.id || ''))) {
            el.remove();
        }
    });
}

function applyDashStyle(el, style) {
    if (style === 'dashed') {
        el.setAttribute('stroke-dasharray', '0.5, 0.5');
        return;
    }
    if (style === 'dotted') {
        el.setAttribute('stroke-dasharray', '0.1, 0.3');
        return;
    }
    el.removeAttribute('stroke-dasharray');
}

function buildPointLookup() {
    const pointLookup = new Map();
    state.groups.forEach((group) => {
        if (!group.visible || !Array.isArray(group.points)) return;
        const color = group.color || '#ffffff';
        group.points.forEach((point) => {
            pointLookup.set(String(point.id), { point, color });
        });
    });
    return pointLookup;
}

function getMarkerRenderState(group, point, gIndex, pIndex) {
    const status = String(point.status || 'ACTIVE').toLowerCase();
    const baseColor = group.color || '#00ffff';
    const softColor = mixHex(baseColor, '#ffffff', 0.35) || baseColor;
    const deepColor = mixHex(baseColor, '#000000', 0.5) || baseColor;
    const contrastColor = getContrastColor(baseColor);
    const isSelected = Boolean(
        state.selectedPoint &&
        state.selectedPoint.groupIndex === gIndex &&
        state.selectedPoint.pointIndex === pIndex
    );
    const isDragging = Boolean(
        state.draggingMarker &&
        state.draggingMarker.groupIndex === gIndex &&
        state.draggingMarker.pointIndex === pIndex
    );
    return {
        status,
        baseColor,
        softColor,
        deepColor,
        contrastColor,
        isSelected,
        isDragging
    };
}

function buildMarkerInnerContent(point, baseColor) {
    const iconData = ICONS[point.iconType] || ICONS.DEFAULT;
    let innerContent = '';

    if (iconData.startsWith('http') || iconData.startsWith('data:') || iconData.startsWith('./') || iconData.startsWith('/')) {
        let iconUrl = iconData;
        const isIcons8 = iconData.startsWith('http') && iconData.includes('img.icons8.com');
        if (isIcons8) {
            const softened = mixHex(baseColor, '#ffffff', ICON_TINT_MIX) || baseColor;
            const colorHex = softened.replace('#', '').toLowerCase();
            iconUrl = iconData.replace(/(\/\d+\/)([0-9a-fA-F]{6})(\/)/, `$1${colorHex}$3`);
        }

        if (isIcons8) {
            innerContent = `
                <div class="marker-icon-box">
                    <img class="marker-icon-img marker-icon-tint" src="${iconUrl}" alt="icon">
                    <img class="marker-icon-img marker-icon-mono" src="${iconData}" alt="">
                </div>`;
        } else {
            innerContent = `
                <div class="marker-icon-box">
                    <img class="marker-icon-img marker-icon-tint" src="${iconUrl}" alt="icon">
                </div>`;
        }
    } else {
        innerContent = `
            <div class="marker-icon-box">
                <svg viewBox="0 0 24 24">${iconData}</svg>
            </div>`;
    }

    return `
        <div class="marker-content-wrapper">
            ${innerContent}
            <div class="marker-label">${escapeHtml(point.name)}</div>
        </div>
    `;
}

function syncMarkerElement(el, group, point, gIndex, pIndex) {
    const markerState = getMarkerRenderState(group, point, gIndex, pIndex);
    const classes = [`marker`, `status-${markerState.status}`];
    if (markerState.isSelected) classes.push('selected');
    if (markerState.isDragging) classes.push('is-dragging');
    el.className = classes.join(' ');
    el.style.left = `${point.x}%`;
    el.style.top = `${point.y}%`;
    el.style.setProperty('--marker-color', markerState.baseColor);
    el.style.setProperty('--marker-color-soft', markerState.softColor);
    el.style.setProperty('--marker-color-deep', markerState.deepColor);
    el.style.setProperty('--marker-color-contrast', markerState.contrastColor);
    el.style.pointerEvents = 'auto';

    const contentKey = [
        point.name,
        point.iconType,
        markerState.baseColor,
        point.status || 'ACTIVE'
    ].join('|');
    if (el.dataset.contentKey !== contentKey) {
        el.innerHTML = buildMarkerInnerContent(point, markerState.baseColor);
        el.dataset.contentKey = contentKey;
    }

    el.onmousedown = (event) => {
        if (state.drawingMode || state.measuringMode) return;
        if (event.button === 2) return;
        event.stopPropagation();
        startMarkerDrag(event, gIndex, pIndex);
    };
}

function syncZoneElement(el, zone, group, gIndex, zIndex, isSelected) {
    const isCircle = zone.type === 'CIRCLE';
    if (isCircle) {
        el.setAttribute('cx', zone.cx);
        el.setAttribute('cy', zone.cy);
        el.setAttribute('r', zone.r);
    } else {
        el.setAttribute('points', zone.points.map((point) => `${point.x},${point.y}`).join(' '));
    }

    let strokeWidth = '0.08';
    if (zone.style && zone.style.width) {
        strokeWidth = (zone.style.width * 0.05).toString();
    }
    if (isSelected) strokeWidth = (parseFloat(strokeWidth) * 1.5).toString();

    el.setAttribute('fill', group.color);
    el.setAttribute('stroke', isSelected ? '#fff' : group.color);
    el.setAttribute('stroke-width', strokeWidth);
    el.setAttribute('fill-opacity', isSelected ? '0.3' : '0.15');
    el.setAttribute('class', isSelected ? 'tactical-zone selected' : 'tactical-zone');
    applyDashStyle(el, zone.style?.style);
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';

    el.onmousedown = (event) => {
        if (state.drawingMode || state.measuringMode) return;
        if (event.button === 2) return;
        event.stopPropagation();
        selectItem('zone', gIndex, zIndex);
        handleZoneMouseDown(event, gIndex, zIndex);
    };
}

function syncAlertZoneElement(el, alert, alertStrokeWidth) {
    const scheduled = isScheduledAlertState(alert);
    el.setAttribute('points', alert.zonePoints.map((point) => `${point.x},${point.y}`).join(' '));
    el.setAttribute('fill', '#ff4d67');
    el.setAttribute('fill-opacity', scheduled ? '0.08' : '0.16');
    el.setAttribute('stroke', '#ff4d67');
    el.setAttribute('stroke-width', alertStrokeWidth.toFixed(2));
    el.setAttribute('class', `map-alert-zone${scheduled ? ' is-scheduled' : ''}`);
    if (scheduled) el.setAttribute('stroke-dasharray', '0.9 0.42');
    else el.removeAttribute('stroke-dasharray');
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onmousedown = (event) => {
        event.stopPropagation();
    };
    el.onclick = (event) => {
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('bni:map-alert-click', {
            detail: { alert }
        }));
    };
}

function syncAlertCircleElement(el, alert, entry, alertStrokeWidth) {
    const scheduled = isScheduledAlertState(alert);
    const x = Number(entry.xPercent);
    const y = Number(entry.yPercent);
    const radius = Math.max(0.5, Number(entry.radius || alert.radius || 2.6));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    el.setAttribute('cx', x);
    el.setAttribute('cy', y);
    el.setAttribute('r', radius.toFixed(2));
    el.setAttribute('fill', '#ff4d67');
    el.setAttribute('fill-opacity', scheduled ? '0.07' : '0.14');
    el.setAttribute('stroke', '#ff4d67');
    el.setAttribute('stroke-width', alertStrokeWidth.toFixed(2));
    el.setAttribute('class', `map-alert-ring${scheduled ? ' is-scheduled' : ''}`);
    if (scheduled) el.setAttribute('stroke-dasharray', '0.9 0.4');
    else el.removeAttribute('stroke-dasharray');
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onmousedown = (event) => {
        event.stopPropagation();
    };
    el.onclick = (event) => {
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('bni:map-alert-click', {
            detail: { alert }
        }));
    };
    return true;
}

function isScheduledAlertState(alert) {
    const startsAt = Date.parse(String(alert?.startsAt || '').trim());
    return Number.isFinite(startsAt) && startsAt > Date.now();
}

export function renderAll(options = {}) {
    const fast = Boolean(options.fast);

    configureSVG(zonesLayer);
    configureSVG(alertLayer);
    configureSVG(linksLayer);

    if (!fast) {
        renderZones();
        renderAlertOverlay();
    }
    renderTacticalLinks();
    renderMarkersAndClusters();
    renderMeasureTool();
    syncInteractionModeHud();
    syncMapEmptyState();
}

function renderZones() {
    if (!zonesLayer) return;

    const activeZoneIds = new Set();
    state.groups.forEach((group, gIndex) => {
        if (!group.visible || !Array.isArray(group.zones)) return;

        group.zones.forEach((zone, zIndex) => {
            const zoneId = sanitizeDomIdSegment(zone.id, `zone_${gIndex}_${zIndex}`);
            const domId = `zone-${zoneId}`;
            const tagName = zone.type === 'CIRCLE' ? 'circle' : 'polygon';
            let el = document.getElementById(domId);

            if (!el || el.tagName.toLowerCase() !== tagName) {
                if (el) el.remove();
                el = document.createElementNS(SVG_NS, tagName);
                el.id = domId;
                el.dataset.zoneId = zoneId;
            }

            const isSelected = Boolean(
                state.selectedZone &&
                state.selectedZone.groupIndex === gIndex &&
                state.selectedZone.zoneIndex === zIndex
            );
            syncZoneElement(el, zone, group, gIndex, zIndex, isSelected);
            zonesLayer.appendChild(el);
            activeZoneIds.add(domId);
        });
    });

    removeStaleElements(zonesLayer, '[data-zone-id]', activeZoneIds);

    const draftCircleId = 'zone-draft-circle';
    const draftPolylineId = 'zone-draft-polyline';
    const oldDraftCircle = document.getElementById(draftCircleId);
    const oldDraftPolyline = document.getElementById(draftPolylineId);
    if (!state.drawingMode) {
        if (oldDraftCircle) oldDraftCircle.remove();
        if (oldDraftPolyline) oldDraftPolyline.remove();
        return;
    }

    const draftWidth = (state.drawOptions.width * 0.05).toString();
    let draftDash = '';
    if (state.drawOptions.style === 'dashed') draftDash = '0.5, 0.5';
    if (state.drawOptions.style === 'dotted') draftDash = '0.1, 0.3';

    if (state.tempZone && state.drawingType === 'CIRCLE') {
        if (oldDraftPolyline) oldDraftPolyline.remove();
        let circle = oldDraftCircle;
        if (!circle) {
            circle = document.createElementNS(SVG_NS, 'circle');
            circle.id = draftCircleId;
        }
        circle.setAttribute('cx', state.tempZone.cx);
        circle.setAttribute('cy', state.tempZone.cy);
        circle.setAttribute('r', state.tempZone.r);
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', '#00ff00');
        circle.setAttribute('stroke-width', draftWidth);
        if (draftDash) circle.setAttribute('stroke-dasharray', draftDash);
        else circle.removeAttribute('stroke-dasharray');
        zonesLayer.appendChild(circle);
        return;
    }

    if (oldDraftCircle) oldDraftCircle.remove();
    if (state.tempPoints.length > 0) {
        let polyline = oldDraftPolyline;
        if (!polyline) {
            polyline = document.createElementNS(SVG_NS, 'polyline');
            polyline.id = draftPolylineId;
        }
        polyline.setAttribute('points', state.tempPoints.map((point) => `${point.x},${point.y}`).join(' '));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', state.drawingPending ? '#00ff00' : '#ff00ff');
        polyline.setAttribute('stroke-width', draftWidth);
        if (draftDash) polyline.setAttribute('stroke-dasharray', draftDash);
        else polyline.removeAttribute('stroke-dasharray');
        zonesLayer.appendChild(polyline);
        return;
    }

    if (oldDraftPolyline) oldDraftPolyline.remove();
}

function renderTacticalLinks() {
    if (!linksLayer) return;
    if (!state.tacticalLinks) return;

    let defs = linksLayer.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS(SVG_NS, 'defs');
        linksLayer.appendChild(defs);

        const marker = document.createElementNS(SVG_NS, 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
        polygon.setAttribute('fill', '#ffffff');
        marker.appendChild(polygon);
        defs.appendChild(marker);
    }

    const pointLookup = buildPointLookup();
    const activeLinkIds = new Set();
    const activeGradIds = new Set();
    const widths = getTacticalLinkWidths();

    state.tacticalLinks.forEach((link) => {
        const fromInfo = pointLookup.get(String(link.from));
        const toInfo = pointLookup.get(String(link.to));
        if (!fromInfo || !toInfo) return;

        const pFrom = fromInfo.point;
        const pTo = toInfo.point;
        const cFrom = fromInfo.color;
        const cTo = toInfo.color;

        const domId = `link-line-${sanitizeDomIdSegment(link.id, 'link')}`;
        activeLinkIds.add(domId);

        let line = document.getElementById(domId);
        if (!line) {
            line = document.createElementNS(SVG_NS, 'line');
            line.id = domId;
            line.setAttribute('class', 'tactical-link-line');
            line.style.pointerEvents = 'visibleStroke';
            line.style.cursor = 'pointer';
            linksLayer.appendChild(line);
        }

        line.onclick = (event) => { event.stopPropagation(); handleLinkClick(event, link); };
        line.onmouseover = (event) => {
            const hoverWidth = line.getAttribute('data-hover-width') || String(widths.hover);
            line.setAttribute('stroke-width', hoverWidth);
            handleLinkHover(event, link);
        };
        line.onmouseout = () => {
            const normalWidth = line.getAttribute('data-normal-width') || String(widths.normal);
            line.setAttribute('stroke-width', normalWidth);
            handleLinkOut();
        };

        line.setAttribute('x1', pFrom.x);
        line.setAttribute('y1', pFrom.y);
        line.setAttribute('x2', pTo.x);
        line.setAttribute('y2', pTo.y);

        let finalColor = link.color;
        if (!finalColor || finalColor === '#ffffff') {
            if (cFrom === cTo) {
                finalColor = cFrom;
            } else {
                const gradId = `grad_${sanitizeDomIdSegment(link.id, 'link')}`;
                activeGradIds.add(gradId);
                let grad = document.getElementById(gradId);
                if (!grad) {
                    grad = document.createElementNS(SVG_NS, 'linearGradient');
                    grad.id = gradId;
                    grad.setAttribute('gradientUnits', 'userSpaceOnUse');

                    const stop1 = document.createElementNS(SVG_NS, 'stop');
                    stop1.setAttribute('offset', '0%');
                    grad.appendChild(stop1);

                    const stop2 = document.createElementNS(SVG_NS, 'stop');
                    stop2.setAttribute('offset', '100%');
                    grad.appendChild(stop2);

                    defs.appendChild(grad);
                }

                grad.setAttribute('x1', pFrom.x);
                grad.setAttribute('y1', pFrom.y);
                grad.setAttribute('x2', pTo.x);
                grad.setAttribute('y2', pTo.y);
                grad.children[0].setAttribute('stop-color', cFrom);
                grad.children[1].setAttribute('stop-color', cTo);
                finalColor = `url(#${gradId})`;
            }
        }

        line.setAttribute('stroke', finalColor);
        line.setAttribute('data-normal-width', String(widths.normal));
        line.setAttribute('data-hover-width', String(widths.hover));
        line.setAttribute('stroke-width', String(widths.normal));
    });

    Array.from(linksLayer.children).forEach((child) => {
        if (child.tagName === 'line' && child.classList.contains('tactical-link-line') && !activeLinkIds.has(child.id)) {
            child.remove();
        }
    });

    if (defs) {
        defs.querySelectorAll('linearGradient').forEach((grad) => {
            if (!activeGradIds.has(grad.id)) grad.remove();
        });
    }
}

function renderAlertOverlay() {
    if (!alertLayer) return;

    const alerts = Array.isArray(state.activeAlerts) && state.activeAlerts.length
        ? state.activeAlerts
        : (state.activeAlert ? [state.activeAlert] : []);
    const activeAlertIds = new Set();

    alerts.forEach((alert, alertIndex) => {
        if (!alert || !alert.active) return;
        const alertKey = sanitizeDomIdSegment(alert.id, `alert_${alertIndex}`);
        const alertStrokeWidth = Math.min(0.5, Math.max(0.02, Number(alert.strokeWidth || 0.06)));

        if (alert.shapeType === 'zone' && Array.isArray(alert.zonePoints) && alert.zonePoints.length >= 3) {
            const domId = `alert-zone-${alertKey}`;
            let zone = document.getElementById(domId);
            if (!zone || zone.tagName.toLowerCase() !== 'polygon') {
                if (zone) zone.remove();
                zone = document.createElementNS(SVG_NS, 'polygon');
                zone.id = domId;
                zone.dataset.alertId = alertKey;
            }
            syncAlertZoneElement(zone, alert, alertStrokeWidth);
            alertLayer.appendChild(zone);
            activeAlertIds.add(domId);
            return;
        }

        const circles = Array.isArray(alert.circles) && alert.circles.length
            ? alert.circles
            : [{
                xPercent: Number(alert.xPercent),
                yPercent: Number(alert.yPercent),
                radius: Math.max(0.5, Number(alert.radius || 2.6)),
            }];

        circles.forEach((entry, circleIndex) => {
            const domId = `alert-circle-${alertKey}-${circleIndex}`;
            let circle = document.getElementById(domId);
            if (!circle || circle.tagName.toLowerCase() !== 'circle') {
                if (circle) circle.remove();
                circle = document.createElementNS(SVG_NS, 'circle');
                circle.id = domId;
                circle.dataset.alertId = alertKey;
            }
            if (!syncAlertCircleElement(circle, alert, entry, alertStrokeWidth)) {
                circle.remove();
                return;
            }
            alertLayer.appendChild(circle);
            activeAlertIds.add(domId);
        });
    });

    removeStaleElements(alertLayer, '[data-alert-id]', activeAlertIds);
}

function renderAlertMarker() {
    return;
}

function renderMarkersAndClusters() {
    if (!markersLayer) return;

    const activeMarkerIds = new Set();
    const searchTerm = String(state.searchTerm || '').trim().toLowerCase();

    state.groups.forEach((group, gIndex) => {
        if (!group.visible) return;
        group.points.forEach((point, pIndex) => {
            if (state.statusFilter !== 'ALL' && (point.status || 'ACTIVE') !== state.statusFilter) return;
            if (searchTerm) {
                const matchName = String(point.name || '').toLowerCase().includes(searchTerm);
                const matchType = String(point.type || '').toLowerCase().includes(searchTerm);
                if (!matchName && !matchType) return;
            }

            const markerId = sanitizeDomIdSegment(point.id, `${gIndex}_${pIndex}`);
            const domId = `marker-${markerId}`;
            let el = document.getElementById(domId);
            if (!el || el.tagName.toLowerCase() !== 'div') {
                if (el) el.remove();
                el = document.createElement('div');
                el.id = domId;
                el.dataset.markerId = markerId;
            }

            syncMarkerElement(el, group, point, gIndex, pIndex);
            markersLayer.appendChild(el);
            activeMarkerIds.add(domId);
        });
    });

    removeStaleElements(markersLayer, '[data-marker-id]', activeMarkerIds);
    renderAlertMarker();
}

function renderMeasureTool() {
    if (state.measurePoints.length === 2) {
        const [p1, p2] = state.measurePoints;

        let line = document.getElementById('measure-line');
        if (!line) {
            line = document.createElementNS(SVG_NS, 'line');
            line.id = 'measure-line';
            line.setAttribute('stroke', '#ff00ff');
            line.setAttribute('stroke-width', '0.2');
            line.setAttribute('stroke-dasharray', '1');
            line.style.pointerEvents = 'none';
            linksLayer.appendChild(line);
        }

        line.setAttribute('x1', p1.x);
        line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x);
        line.setAttribute('y2', p2.y);

        const distPercent = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        const distKm = (distPercent * (MAP_SCALE_UNIT / 1000)).toFixed(2);

        let label = document.getElementById('measure-label');
        if (!label) {
            label = document.createElement('div');
            label.id = 'measure-label';
            label.className = 'measure-tag';
            markersLayer.appendChild(label);
        }
        label.innerText = `${distKm} km`;
        label.style.left = `${(p1.x + p2.x) / 2}%`;
        label.style.top = `${(p1.y + p2.y) / 2}%`;
        label.style.transform = 'translate(-50%, -50%)';
        return;
    }

    const line = document.getElementById('measure-line');
    if (line) line.remove();

    const label = document.getElementById('measure-label');
    if (label) label.remove();
}

export function getMapPercentCoords(clientX, clientY) {
    const mapWorld = document.getElementById('map-world');
    const rect = mapWorld.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100
    };
}
