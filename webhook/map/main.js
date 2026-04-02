const API_ENDPOINT = "/api/webhook-detection";
const AUTO_REFRESH_MS = 5000;
const FETCH_LIMIT = 100;
const GTA_BOUNDS = {
    MIN_X: -5647,
    MAX_X: 6672,
    MIN_Y: -4060,
    MAX_Y: 8426,
};
const GPS_CORRECTION = { x: 0, y: 0 };

const state = {
    items: [],
    filter: "all",
    selectedId: "",
    loading: false,
    syncLabel: "Idle",
    mapWidth: 0,
    mapHeight: 0,
    view: {
        x: 0,
        y: 0,
        scale: 1,
    },
    drag: {
        active: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
    },
};

const debugEnabled = new URLSearchParams(window.location.search).has("debug");

const ui = {
    body: document.body,
    detailsCard: document.getElementById("detailsCard"),
    detectionsList: document.getElementById("detectionsList"),
    mapEmptyState: document.getElementById("mapEmptyState"),
    mapMeta: document.getElementById("mapMeta"),
    mapImage: document.getElementById("map-image"),
    markersLayer: document.getElementById("markersLayer"),
    mapWorld: document.getElementById("map-world"),
    mobileMenuButton: document.getElementById("btnMobileMenu"),
    overlay: document.getElementById("sidebar-overlay"),
    refreshButton: document.getElementById("refreshButton"),
    resetViewButton: document.getElementById("btnResetView"),
    sidebarLeft: document.getElementById("sidebar-left"),
    statsCount: document.getElementById("statsCount"),
    statsLatest: document.getElementById("statsLatest"),
    syncStatus: document.getElementById("syncStatus"),
    toggleLightButton: document.getElementById("btnToggleLight"),
    typeFilter: document.getElementById("typeFilter"),
    viewport: document.getElementById("viewport"),
};

function debugLog(message, details = {}) {
    if (!debugEnabled) return;
    console.log("[webhook-map]", message, details);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
    const timestamp = Date.parse(String(value || ""));
    if (!Number.isFinite(timestamp)) return "Inconnue";
    return new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "medium",
    }).format(new Date(timestamp));
}

function getTypeMeta(type) {
    const normalized = String(type || "detection").trim().toLowerCase();
    if (normalized === "prediction") {
        return { key: "prediction", label: "Prédiction" };
    }
    if (normalized === "staff_prediction" || normalized === "staff-prediction") {
        return { key: "staff_prediction", label: "Staff prediction" };
    }
    return { key: "detection", label: "Détection" };
}

function gtaToPercent(x, y) {
    const mapWidth = GTA_BOUNDS.MAX_X - GTA_BOUNDS.MIN_X;
    const mapHeight = GTA_BOUNDS.MAX_Y - GTA_BOUNDS.MIN_Y;
    const percentX = ((Number(x) - GTA_BOUNDS.MIN_X) / mapWidth) * 100 + GPS_CORRECTION.x;
    const percentY = ((GTA_BOUNDS.MAX_Y - Number(y)) / mapHeight) * 100 + GPS_CORRECTION.y;
    return {
        x: clamp(percentX, 0, 100),
        y: clamp(percentY, 0, 100),
    };
}

function normalizeDetection(raw) {
    if (!raw || typeof raw !== "object") return null;

    const x = Number(raw.x);
    const y = Number(raw.y);
    const z = Number(raw.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    const typeMeta = getTypeMeta(raw.type);
    const position = gtaToPercent(x, y);
    const receivedAt = String(raw.receivedAt || "");
    const detectedAt = String(raw.detectedAt || receivedAt || "");
    const receivedAtMs = Number(raw.receivedAtMs || Date.parse(receivedAt));

    return {
        id: String(raw.id || ""),
        player: String(raw.player || "Inconnu"),
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        z: Number(z.toFixed(3)),
        type: typeMeta.key,
        typeLabel: typeMeta.label,
        timestamp: Number(raw.timestamp || 0),
        timestampMs: Number(raw.timestampMs || 0),
        detectedAt,
        receivedAt,
        receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : 0,
        mapX: position.x,
        mapY: position.y,
    };
}

function getVisibleItems() {
    const filter = String(state.filter || "all");
    if (filter === "all") return state.items;
    return state.items.filter((item) => item.type === filter);
}

function syncSelectedItem() {
    const visibleItems = getVisibleItems();
    if (!visibleItems.length) {
        state.selectedId = "";
        return null;
    }

    const current = visibleItems.find((item) => item.id === state.selectedId);
    if (current) return current;

    state.selectedId = visibleItems[0].id;
    return visibleItems[0];
}

function setSyncStatus(label) {
    state.syncLabel = label;
    if (ui.syncStatus) ui.syncStatus.textContent = label;
}

function syncMapFrame() {
    if (!state.mapWidth || !state.mapHeight) return;
    if (ui.mapWorld) {
        ui.mapWorld.style.width = `${state.mapWidth}px`;
        ui.mapWorld.style.height = `${state.mapHeight}px`;
    }
}

function updateMapTransform() {
    syncMapFrame();
    if (ui.mapWorld) {
        ui.mapWorld.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
    }
    if (ui.markersLayer && state.mapWidth && state.mapHeight) {
        ui.markersLayer.style.transform = `translate(${state.view.x}px, ${state.view.y}px)`;
        ui.markersLayer.style.width = `${state.mapWidth * state.view.scale}px`;
        ui.markersLayer.style.height = `${state.mapHeight * state.view.scale}px`;
    }
}

function centerMapView() {
    const viewport = ui.viewport;
    if (!viewport || !state.mapWidth || !state.mapHeight) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const scale = Math.min(vw / state.mapWidth, vh / state.mapHeight);
    state.view.scale = Math.max(0.2, Math.min(4, scale || 1));
    state.view.x = (vw - state.mapWidth * state.view.scale) / 2;
    state.view.y = (vh - state.mapHeight * state.view.scale) / 2;
    updateMapTransform();
}

function setMapZoom(nextScale, options = {}) {
    const viewport = ui.viewport;
    if (!viewport) return;

    const currentScale = Math.max(0.2, Number(state.view.scale || 1));
    const targetScale = clamp(Number(nextScale || currentScale), 0.2, 6);
    if (!Number.isFinite(targetScale) || Math.abs(targetScale - currentScale) < 0.0001) return;

    const rect = viewport.getBoundingClientRect();
    const anchorX = Number.isFinite(Number(options.anchorX))
        ? Number(options.anchorX)
        : rect.width / 2;
    const anchorY = Number.isFinite(Number(options.anchorY))
        ? Number(options.anchorY)
        : rect.height / 2;
    const ratio = targetScale / currentScale;

    state.view.x = anchorX - ((anchorX - state.view.x) * ratio);
    state.view.y = anchorY - ((anchorY - state.view.y) * ratio);
    state.view.scale = targetScale;
    updateMapTransform();
}

function handleViewportMouseDown(event) {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest(".map-marker")) return;

    state.drag.active = true;
    state.drag.startX = event.clientX;
    state.drag.startY = event.clientY;
    state.drag.originX = state.view.x;
    state.drag.originY = state.view.y;
    if (ui.viewport) ui.viewport.style.cursor = "grabbing";
}

function handleViewportMouseMove(event) {
    if (!state.drag.active) return;
    state.view.x = state.drag.originX + (event.clientX - state.drag.startX);
    state.view.y = state.drag.originY + (event.clientY - state.drag.startY);
    updateMapTransform();
}

function stopViewportDrag() {
    state.drag.active = false;
    if (ui.viewport) ui.viewport.style.cursor = "";
}

function initMapViewport() {
    const image = ui.mapImage;
    const viewport = ui.viewport;
    if (!image || !viewport) return;

    const onReady = () => {
        state.mapWidth = image.naturalWidth || image.clientWidth || 2000;
        state.mapHeight = image.naturalHeight || image.clientHeight || 2000;
        centerMapView();
    };

    if (image.complete && image.naturalWidth && image.naturalHeight) {
        onReady();
    } else {
        image.addEventListener("load", onReady, { once: true });
    }

    viewport.addEventListener("mousedown", handleViewportMouseDown);
    viewport.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const anchorX = event.clientX - rect.left;
        const anchorY = event.clientY - rect.top;
        const direction = event.deltaY > 0 ? 0.9 : 1.1;
        setMapZoom(state.view.scale * direction, { anchorX, anchorY });
    }, { passive: false });

    window.addEventListener("mousemove", handleViewportMouseMove);
    window.addEventListener("mouseup", stopViewportDrag);
    window.addEventListener("blur", stopViewportDrag);
    window.addEventListener("resize", () => {
        if (!state.mapWidth || !state.mapHeight) return;
        centerMapView();
    });
}

function renderStats() {
    const visibleItems = getVisibleItems();
    const latest = visibleItems[0] || state.items[0] || null;
    ui.statsCount.textContent = `${visibleItems.length}`;
    ui.statsLatest.textContent = latest ? formatDateTime(latest.receivedAt) : "Aucune";
    ui.mapMeta.textContent = `${visibleItems.length} / ${state.items.length} détections affichées`;
}

function renderDetails() {
    const selected = syncSelectedItem();
    if (!selected) {
        ui.detailsCard.className = "details-card is-empty";
        ui.detailsCard.innerHTML = `
            <strong>Pas de détection sélectionnée.</strong>
            <span>Clique sur un point de la carte ou une entrée de la liste.</span>
        `;
        return;
    }

    ui.detailsCard.className = "details-card";
    ui.detailsCard.innerHTML = `
        <div class="details-header">
            <div>
                <div class="kicker">Événement webhook</div>
                <h3 class="details-title">${escapeHtml(selected.player)}</h3>
            </div>
            <span class="type-pill is-${escapeHtml(selected.type)}">${escapeHtml(selected.typeLabel)}</span>
        </div>
        <div class="details-copy">
            Dernière détection connue pour ce point de la map webhook.
        </div>
        <div class="details-grid">
            <div class="details-item">
                <span>Heure de détection</span>
                <strong>${escapeHtml(formatDateTime(selected.detectedAt))}</strong>
            </div>
            <div class="details-item">
                <span>Heure de réception</span>
                <strong>${escapeHtml(formatDateTime(selected.receivedAt))}</strong>
            </div>
            <div class="details-item">
                <span>Coordonnées GTA</span>
                <strong>${selected.x.toFixed(2)} / ${selected.y.toFixed(2)} / ${selected.z.toFixed(2)}</strong>
            </div>
            <div class="details-item">
                <span>Position sur carte</span>
                <strong>${selected.mapX.toFixed(2)}% / ${selected.mapY.toFixed(2)}%</strong>
            </div>
            <div class="details-item">
                <span>Type brut</span>
                <strong>${escapeHtml(selected.type)}</strong>
            </div>
            <div class="details-item">
                <span>ID événement</span>
                <strong>${escapeHtml(selected.id)}</strong>
            </div>
        </div>
    `;
}

function renderList() {
    const visibleItems = getVisibleItems();
    ui.detectionsList.innerHTML = "";

    if (!visibleItems.length) {
        ui.detectionsList.innerHTML = `
            <div class="detection-row">
                <div class="detection-row-title">Aucune entrée</div>
                <div class="detection-row-sub">Le filtre actuel ne renvoie aucune détection.</div>
            </div>
        `;
        return;
    }

    visibleItems.forEach((item) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `detection-row${item.id === state.selectedId ? " is-active" : ""}`;
        row.innerHTML = `
            <div class="detection-row-head">
                <div>
                    <div class="detection-row-title">${escapeHtml(item.player)}</div>
                    <div class="detection-row-sub">${escapeHtml(formatDateTime(item.detectedAt))}</div>
                </div>
                <div>
                    <span class="type-pill is-${escapeHtml(item.type)}">${escapeHtml(item.typeLabel)}</span>
                </div>
            </div>
            <div class="detection-row-sub">
                ${item.x.toFixed(2)} / ${item.y.toFixed(2)} / ${item.z.toFixed(2)}
            </div>
        `;
        row.addEventListener("click", () => {
            state.selectedId = item.id;
            renderAll();
        });
        ui.detectionsList.appendChild(row);
    });
}

function renderMarkers() {
    const visibleItems = getVisibleItems();
    ui.markersLayer.innerHTML = "";
    ui.mapEmptyState.hidden = visibleItems.length > 0;

    visibleItems.forEach((item) => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = `map-marker is-${item.type}${item.id === state.selectedId ? " is-active" : ""}`;
        marker.style.left = `${item.mapX}%`;
        marker.style.top = `${item.mapY}%`;
        marker.style.zIndex = item.id === state.selectedId ? "6" : "3";
        marker.title = `${item.player} • ${item.typeLabel}`;
        marker.setAttribute("aria-label", `${item.player} ${item.typeLabel}`);
        marker.addEventListener("click", () => {
            state.selectedId = item.id;
            renderAll();
        });
        ui.markersLayer.appendChild(marker);
    });
}

function renderAll() {
    renderStats();
    renderList();
    renderMarkers();
    renderDetails();
}

async function loadDetections(options = {}) {
    if (state.loading) return;
    state.loading = true;
    setSyncStatus(options.manual ? "Refresh..." : "Sync...");

    try {
        const response = await fetch(`${API_ENDPOINT}?limit=${FETCH_LIMIT}`, {
            method: "GET",
            cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok !== true) {
            throw new Error(payload.error || `Erreur HTTP ${response.status}`);
        }

        state.items = (Array.isArray(payload.items) ? payload.items : [])
            .map((entry) => normalizeDetection(entry))
            .filter(Boolean)
            .sort((left, right) => Number(right.receivedAtMs || 0) - Number(left.receivedAtMs || 0));

        debugLog("loaded-detections", {
            count: state.items.length,
            filter: state.filter,
        });
        syncSelectedItem();
        renderAll();
        setSyncStatus(`OK ${new Date().toLocaleTimeString("fr-FR")}`);
    } catch (error) {
        console.error("[webhook-map]", error);
        setSyncStatus("Erreur");
        if (!state.items.length) {
            ui.detailsCard.className = "details-card is-empty";
            ui.detailsCard.innerHTML = `
                <strong>Chargement impossible.</strong>
                <span>${escapeHtml(error.message || "Erreur inconnue.")}</span>
            `;
            ui.mapEmptyState.hidden = false;
        }
    } finally {
        state.loading = false;
    }
}

function bindEvents() {
    ui.refreshButton?.addEventListener("click", () => {
        loadDetections({ manual: true }).catch(() => {});
    });

    ui.typeFilter?.addEventListener("change", (event) => {
        state.filter = String(event.target.value || "all");
        debugLog("filter-changed", { filter: state.filter });
        syncSelectedItem();
        renderAll();
    });

    ui.mobileMenuButton?.addEventListener("click", () => {
        ui.sidebarLeft?.classList.toggle("mobile-active");
        ui.overlay?.classList.toggle("active");
    });

    ui.overlay?.addEventListener("click", () => {
        ui.sidebarLeft?.classList.remove("mobile-active");
        ui.overlay?.classList.remove("active");
    });

    ui.toggleLightButton?.addEventListener("click", () => {
        ui.body.classList.toggle("high-light-mode");
        ui.toggleLightButton.classList.toggle("active", ui.body.classList.contains("high-light-mode"));
    });

    ui.resetViewButton?.addEventListener("click", () => {
        state.filter = "all";
        if (ui.typeFilter) ui.typeFilter.value = "all";
        state.selectedId = "";
        syncSelectedItem();
        renderAll();
        centerMapView();
    });
}

initMapViewport();
bindEvents();
loadDetections().catch(() => {});
window.setInterval(() => {
    loadDetections().catch(() => {});
}, AUTO_REFRESH_MS);
