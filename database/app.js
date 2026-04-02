(function () {
  const PAGE_SIZE = 50;
  const API_KEY_STORAGE_KEY = "bniLinkedApiKey";
  const COLLAB_SESSION_STORAGE_KEY = "bniLinkedCollabSession_v1";
  const tabs = Array.from(document.querySelectorAll(".tab-btn"));
  const panels = {
    point: document.getElementById("panel-point"),
    map: document.getElementById("panel-map"),
    boards: document.getElementById("panel-boards"),
  };
  const globalStatus = document.getElementById("global-status");
  const toolbarSearch = document.getElementById("toolbar-search");
  const toolbarActionWrap = document.getElementById("toolbar-action-wrap");
  const toolbarActionFilter = document.getElementById("toolbar-action-filter");
  const toolbarRefresh = document.getElementById("toolbar-refresh");
  const toolbarMeta = document.getElementById("toolbar-meta");

  const modal = document.getElementById("custom-modal");
  const modalBox = modal?.querySelector(".modal-box");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalFooter = document.getElementById("modal-footer");
  const modalCloseX = document.getElementById("modal-close-x");

  const appState = {
    activeTab: "point",
    filters: {
      search: "",
      action: "all",
    },
    point: createListState(),
    map: createListState(),
    boards: createListState(),
  };

  let activeModalResolve = null;
  let activeModalDismissValue = null;
  let activeModalCleanup = null;

  function createListState() {
    return {
      entries: [],
      loaded: false,
      loading: false,
      hasMore: false,
      nextOffset: 0,
      totalFound: 0,
      error: null,
    };
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanText(value, fallback = "") {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text || fallback;
  }

  function normalizeSearchText(value) {
    return cleanText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function humanizeAction(action) {
    const cleanAction = cleanText(action).toLowerCase();
    if (!cleanAction) return "Archive";
    const prefix = cleanAction.startsWith("import") ? "IMPORT" : "EXPORT";
    const suffix = cleanAction
      .replace(/^import[-_]?/, "")
      .replace(/^export[-_]?/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return suffix ? `${prefix} ${suffix}` : prefix;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("fr-FR");
    } catch (error) {
      return String(iso);
    }
  }

  function makeFilename(entry) {
    const safeDate = cleanText(entry?.createdAt).replace(/[:.]/g, "-");
    const source = cleanText(entry?.summary?.sourceLabel || entry?.summary?.title || entry?.ts || "archive")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "");
    return `${cleanText(entry?.page, "point")}_${source || "archive"}_${safeDate || Date.now()}.json`;
  }

  function finishModal(value) {
    modal.classList.remove("visible");
    modal.setAttribute("aria-hidden", "true");
    if (typeof activeModalCleanup === "function") {
      try {
        activeModalCleanup();
      } catch (error) {}
    }
    activeModalCleanup = null;
    if (modalBox) {
      modalBox.className = "modal-box";
    }
    const resolver = activeModalResolve;
    activeModalResolve = null;
    activeModalDismissValue = null;
    if (typeof resolver === "function") resolver(value);
  }

  function showModal(options = {}) {
    const buttons = Array.isArray(options.buttons) && options.buttons.length
      ? options.buttons
      : [{ label: "Fermer", value: true, className: "confirm" }];

    return new Promise((resolve) => {
      activeModalResolve = resolve;
      activeModalDismissValue = options.dismissValue ?? buttons[0]?.value ?? true;
      modalTitle.textContent = cleanText(options.title, "Information");
      modalText.innerHTML = options.html || `<p>${escapeHtml(cleanText(options.text))}</p>`;
      modalFooter.innerHTML = "";
      if (modalBox) {
        const dialogClass = cleanText(options.dialogClass);
        modalBox.className = dialogClass ? `modal-box ${dialogClass}` : "modal-box";
      }

      buttons.forEach((button) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `modal-btn ${button.className || ""}`.trim();
        btn.textContent = cleanText(button.label, "OK");
        btn.disabled = Boolean(button.disabled);
        btn.addEventListener("click", () => finishModal(button.value));
        modalFooter.appendChild(btn);
      });

      modal.classList.add("visible");
      modal.setAttribute("aria-hidden", "false");

      if (typeof options.onRender === "function") {
        const cleanup = options.onRender({
          modal,
          modalBox,
          modalTitle,
          modalText,
          modalFooter,
          finishModal,
        });
        activeModalCleanup = typeof cleanup === "function" ? cleanup : null;
      }
    });
  }

  function closeModal() {
    finishModal(activeModalDismissValue);
  }

  modalCloseX?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("visible")) {
      closeModal();
    }
  });

  async function customAlert(text) {
    await showModal({
      title: "Information",
      text,
    });
  }

  async function customConfirm(text) {
    return showModal({
      title: "Confirmation",
      text,
      dismissValue: false,
      buttons: [
        { label: "Annuler", value: false },
        { label: "Confirmer", value: true, className: "danger" },
      ],
    });
  }

  function getApiKey() {
    const fromWindow = typeof window.BNI_LINKED_KEY === "string" ? window.BNI_LINKED_KEY.trim() : "";
    if (fromWindow) return fromWindow;
    try {
      const fromStorage = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (fromStorage && fromStorage.trim()) return fromStorage.trim();
    } catch (error) {}
    return "";
  }

  function readViewerSession() {
    try {
      const raw = localStorage.getItem(COLLAB_SESSION_STORAGE_KEY);
      if (!raw) return { token: "", user: null };
      const parsed = JSON.parse(raw);
      return {
        token: cleanText(parsed?.token),
        user: parsed?.user && typeof parsed.user === "object" ? parsed.user : null,
      };
    } catch (error) {
      return { token: "", user: null };
    }
  }

  function withViewerAuth(headers = {}) {
    const merged = { ...headers };
    const key = getApiKey();
    if (key) merged["x-api-key"] = key;
    const session = readViewerSession();
    if (session.token) merged["x-collab-token"] = session.token;
    return merged;
  }

  async function apiListArchives(page, options = {}) {
    const params = new URLSearchParams({
      page: String(page || ""),
      limit: String(Number(options.limit || PAGE_SIZE)),
      offset: String(Number(options.offset || 0)),
      includeSummary: "1",
    });
    if (options.refresh) params.set("refresh", "1");
    const res = await fetch(`/.netlify/functions/db-list?${params.toString()}`, {
      headers: withViewerAuth(),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || `Erreur API (${res.status})`);
    return out;
  }

  async function apiListBoards(options = {}) {
    const params = new URLSearchParams({
      limit: String(Number(options.limit || PAGE_SIZE)),
      offset: String(Number(options.offset || 0)),
    });
    const res = await fetch(`/.netlify/functions/db-boards?${params.toString()}`, {
      headers: withViewerAuth(),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || `Erreur boards (${res.status})`);
    return out;
  }

  async function apiGetArchive(key) {
    const res = await fetch(`/.netlify/functions/db-get?key=${encodeURIComponent(key)}`, {
      headers: withViewerAuth(),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.ok === false) throw new Error(out.error || `Erreur recuperation (${res.status})`);
    return out;
  }

  async function apiDeleteArchive(key) {
    const res = await fetch("/.netlify/functions/db-delete", {
      method: "POST",
      headers: withViewerAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ key }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || "Erreur suppression");
    return out;
  }

  async function apiClearBoardActivity(boardId) {
    const res = await fetch("/.netlify/functions/db-boards", {
      method: "POST",
      headers: withViewerAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        action: "clear_activity",
        boardId,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || "Erreur purge journal");
    return out;
  }

  async function apiGetBoardDetails(boardId) {
    const res = await fetch("/.netlify/functions/db-boards", {
      method: "POST",
      headers: withViewerAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        action: "get_board_details",
        boardId,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || "Erreur details board");
    return out;
  }

  async function apiRestoreBoardSnapshot(boardId, snapshotDate) {
    const res = await fetch("/.netlify/functions/db-boards", {
      method: "POST",
      headers: withViewerAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        action: "restore_snapshot",
        boardId,
        snapshotDate,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) throw new Error(out.error || "Erreur restauration snapshot");
    return out;
  }

  function buildArchiveFallbackSummary(entry) {
    const page = cleanText(entry?.page, "point");
    const action = cleanText(entry?.action, "export-standard");
    const actionKind = action.startsWith("import") ? "import" : "export";
    const label = humanizeAction(action);
    const title = cleanText(
      entry?.title ||
      label.replace(/^(IMPORT|EXPORT)\s+/i, "") ||
      entry?.ts ||
      "Archive",
      "Archive"
    );
    return {
      title,
      sourceLabel: title,
      sourceKey: normalizeSearchText(title).replace(/[^a-z0-9]+/g, "-") || normalizeSearchText(action) || "archive",
      actionKind,
      actionLabel: label,
      updatedAt: cleanText(entry?.createdAt),
      stats: page === "map"
        ? { groups: 0, points: 0, zones: 0, tacticalLinks: 0 }
        : { nodes: 0, links: 0, unnamedNodes: 0 },
      statLines: [],
      matchText: normalizeSearchText([
        title,
        label,
        action,
        entry?.key,
        page,
      ].join(" ")),
    };
  }

  function getArchiveSummary(entry) {
    return entry?.summary && typeof entry.summary === "object"
      ? entry.summary
      : buildArchiveFallbackSummary(entry);
  }

  function getArchiveEntrySearchText(entry) {
    const summary = getArchiveSummary(entry);
    return normalizeSearchText([
      summary.matchText,
      entry?.key,
      entry?.action,
      entry?.page,
    ].join(" "));
  }

  function getArchiveCountsHtml(entry) {
    const summary = getArchiveSummary(entry);
    const stats = summary.stats || {};
    const page = cleanText(entry?.page, "point");
    const chips = page === "map"
      ? [
          `${Number(stats.groups || 0)} grp`,
          `${Number(stats.points || 0)} pts`,
          `${Number(stats.zones || 0)} zones`,
          `${Number(stats.tacticalLinks || 0)} links`,
        ]
      : [
          `${Number(stats.nodes || 0)} fiches`,
          `${Number(stats.links || 0)} liens`,
          Number(stats.unnamedNodes || 0) > 0 ? `${Number(stats.unnamedNodes || 0)} sans nom` : "",
        ];

    return chips
      .filter(Boolean)
      .map((chip) => `<span class="stat-pill">${escapeHtml(chip)}</span>`)
      .join("");
  }

  function groupArchives(entries) {
    const groups = new Map();

    entries.forEach((entry) => {
      const summary = getArchiveSummary(entry);
      const key = cleanText(summary.sourceKey || summary.title || entry?.ts, "archive");
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: cleanText(summary.sourceLabel || summary.title || "Archive"),
          items: [],
          latestAt: "",
        });
      }
      const bucket = groups.get(key);
      bucket.items.push(entry);
      const candidateTime = Date.parse(cleanText(summary.updatedAt || entry?.createdAt || ""));
      const latestTime = Date.parse(cleanText(bucket.latestAt || ""));
      if (Number.isFinite(candidateTime) && (!Number.isFinite(latestTime) || candidateTime > latestTime)) {
        bucket.latestAt = cleanText(summary.updatedAt || entry?.createdAt || "");
      }
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: group.items.sort((left, right) => Date.parse(right?.createdAt || 0) - Date.parse(left?.createdAt || 0)),
      }))
      .sort((left, right) => {
        const delta = Date.parse(right.latestAt || 0) - Date.parse(left.latestAt || 0);
        if (delta !== 0) return delta;
        return String(left.title || "").localeCompare(String(right.title || ""));
      });
  }

  function formatLoadError(tab, error) {
    const labels = {
      point: "archives reseau",
      map: "archives tactiques",
      boards: "boards cloud",
    };
    const label = labels[tab] || "contenu";
    const rawMessage = cleanText(error?.message);
    const normalized = normalizeSearchText(rawMessage);

    if (!rawMessage || normalized === "not_found") {
      return {
        status: `SOURCE ${label.toUpperCase()} INDISPONIBLE`,
        title: "Service indisponible",
        copy: `Le service des ${label} ne repond pas dans cet environnement.`,
        hint: "Recharge la page ou relance la fonction Netlify concernee.",
      };
    }

    if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
      return {
        status: `LIAISON ${label.toUpperCase()} INTERROMPUE`,
        title: "Connexion interrompue",
        copy: `Impossible de joindre le service des ${label} pour le moment.`,
        hint: "Verifie la connexion ou reessaie dans quelques secondes.",
      };
    }

    return {
      status: `ERREUR SUR ${label.toUpperCase()}`,
      title: "Chargement impossible",
      copy: `Les ${label} ne peuvent pas etre charges actuellement.`,
      hint: "Reessaie dans un instant.",
    };
  }

  function renderErrorState(container, details, tab) {
    container.innerHTML = `
      <div class="error-state">
        <div class="error-state-title">${escapeHtml(details.title || "Chargement impossible")}</div>
        <div class="error-state-copy">${escapeHtml(details.copy || "Le service ne repond pas actuellement.")}</div>
        <div class="error-state-hint">${escapeHtml(details.hint || "Reessaie dans un instant.")}</div>
        <div class="error-state-actions">
          <button class="btn-cyber btn-error-retry" type="button" data-retry-tab="${escapeHtml(tab)}">REESSAYER</button>
        </div>
      </div>
    `;
    const retryBtn = container.querySelector("[data-retry-tab]");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        refreshTab(tab, { force: true }).catch(() => {});
      });
    }
  }

  function updateLoadMoreButton(tab) {
    const state = appState[tab];
    const btn = document.getElementById(`load-more-${tab}`);
    if (!btn) return;
    const remaining = Math.max(0, Number(state.totalFound || 0) - state.entries.length);
    btn.hidden = !state.hasMore;
    btn.disabled = state.loading;
    btn.textContent = state.loading
      ? "CHARGEMENT..."
      : `CHARGER ${Math.min(PAGE_SIZE, remaining || PAGE_SIZE)} DE PLUS`;
  }

  function getFilteredArchiveEntries(tab) {
    const state = appState[tab];
    const actionFilter = cleanText(appState.filters.action, "all");
    const query = normalizeSearchText(appState.filters.search);
    return state.entries.filter((entry) => {
      const summary = getArchiveSummary(entry);
      const actionKind = cleanText(summary.actionKind || (cleanText(entry.action).startsWith("import") ? "import" : "export"), "export");
      if (actionFilter !== "all" && actionKind !== actionFilter) return false;
      if (!query) return true;
      return getArchiveEntrySearchText(entry).includes(query);
    });
  }

  function getFilteredBoards() {
    const state = appState.boards;
    const query = normalizeSearchText(appState.filters.search);
    if (!query) return state.entries;
    return state.entries.filter((entry) => normalizeSearchText(entry?.searchText || [
      entry?.title,
      entry?.ownerName,
      ...(Array.isArray(entry?.memberNames) ? entry.memberNames : []),
    ].join(" ")).includes(query));
  }

  function updateToolbar() {
    const isArchiveTab = appState.activeTab === "point" || appState.activeTab === "map";
    toolbarActionWrap.hidden = !isArchiveTab;
    const currentEntries = isArchiveTab
      ? getFilteredArchiveEntries(appState.activeTab)
      : getFilteredBoards();
    const loaded = appState[appState.activeTab].entries.length;
    const total = Number(appState[appState.activeTab].totalFound || loaded);
    const parts = [];
    if (cleanText(appState.filters.search)) {
      parts.push(`Recherche: "${cleanText(appState.filters.search)}"`);
    }
    if (isArchiveTab && cleanText(appState.filters.action, "all") !== "all") {
      parts.push(`Type: ${cleanText(appState.filters.action)}`);
    }
    parts.push(`${currentEntries.length} visibles`);
    parts.push(`${loaded} charges`);
    parts.push(`${total} total`);
    toolbarMeta.textContent = parts.join(" | ");
  }

  function buildArchiveCard(entry) {
    const summary = getArchiveSummary(entry);
    const actionKind = cleanText(summary.actionKind, "export");
    const badgeClass = actionKind === "import" ? "badge-import" : "badge-export";
    return `
      <article class="data-card" data-entry-key="${escapeHtml(cleanText(entry.key))}">
        <div class="card-top">
          <span class="badge ${badgeClass}">${escapeHtml(summary.actionLabel || humanizeAction(entry.action))}</span>
          <span class="card-date">${escapeHtml(formatDate(summary.updatedAt || entry.createdAt))}</span>
        </div>
        <div class="card-title">${escapeHtml(summary.title || "Archive")}</div>
        <div class="card-subtitle">${escapeHtml(cleanText(entry.page, "point").toUpperCase())} • ${escapeHtml(cleanText(entry.ts || ""))}</div>
        <div class="card-stats">${getArchiveCountsHtml(entry)}</div>
        <div class="card-key">ID: ${escapeHtml(cleanText(entry.ts || entry.key))}</div>
        <div class="card-actions">
          <button class="btn-cyber btn-detail" type="button" data-action="detail">DETAILS</button>
          <button class="btn-cyber btn-dl" type="button" data-action="download">TELECHARGER</button>
          <button class="btn-cyber btn-del" type="button" data-action="delete">SUPPRIMER</button>
        </div>
      </article>
    `;
  }

  function renderArchivePanel(tab) {
    const state = appState[tab];
    const container = document.getElementById(`cards-${tab}`);
    const status = document.getElementById(`status-${tab}`);
    if (!container || !status) return;

    if (state.error) {
      const details = formatLoadError(tab, state.error);
      status.textContent = details.status;
      renderErrorState(container, details, tab);
      updateLoadMoreButton(tab);
      updateToolbar();
      return;
    }

    const filteredEntries = getFilteredArchiveEntries(tab);
    if (!state.entries.length) {
      status.textContent = "Aucune donnee.";
      container.innerHTML = '<div class="empty-state">AUCUNE ARCHIVE TROUVEE DANS LE CLOUD</div>';
      updateLoadMoreButton(tab);
      updateToolbar();
      return;
    }

    if (!filteredEntries.length) {
      status.textContent = "Aucun resultat.";
      container.innerHTML = '<div class="empty-state">AUCUN RESULTAT POUR CES FILTRES</div>';
      updateLoadMoreButton(tab);
      updateToolbar();
      return;
    }

    const groups = groupArchives(filteredEntries);
    container.innerHTML = groups.map((group) => `
      <section class="archive-group">
        <div class="archive-group-head">
          <div>
            <div class="archive-group-title">${escapeHtml(group.title)}</div>
            <div class="archive-group-meta">${group.items.length} snapshots • Maj ${escapeHtml(formatDate(group.latestAt))}</div>
          </div>
          <div class="archive-group-count">${group.items.length}</div>
        </div>
        <div class="archive-group-grid">
          ${group.items.map((entry) => buildArchiveCard(entry)).join("")}
        </div>
      </section>
    `).join("");

    container.querySelectorAll("[data-entry-key]").forEach((card) => {
      const key = card.getAttribute("data-entry-key") || "";
      const entry = filteredEntries.find((item) => cleanText(item.key) === key);
      if (!entry) return;

      const detailBtn = card.querySelector('[data-action="detail"]');
      const downloadBtn = card.querySelector('[data-action="download"]');
      const deleteBtn = card.querySelector('[data-action="delete"]');

      detailBtn?.addEventListener("click", () => {
        showArchiveDetails(entry).catch(() => {});
      });
      downloadBtn?.addEventListener("click", () => {
        downloadArchive(entry, downloadBtn).catch(() => {});
      });
      deleteBtn?.addEventListener("click", () => {
        deleteArchive(tab, entry, deleteBtn).catch(() => {});
      });
    });

    status.textContent = `${filteredEntries.length} visibles sur ${state.entries.length} charges`;
    updateLoadMoreButton(tab);
    updateToolbar();
  }

  function renderMemberChips(members = []) {
    return members.slice(0, 6).map((member) => `
      <span class="member-pill ${escapeHtml(cleanText(member.role, "editor"))}">
        ${escapeHtml(cleanText(member.username, "user"))}
      </span>
    `).join("");
  }

  function renderBoardActivityPreview(board) {
    const latest = Array.isArray(board?.activity) ? board.activity[0] : null;
    if (!latest || !cleanText(latest.text)) {
      return `
        <div class="board-activity-preview is-empty">
          <span class="board-activity-preview-label">Journal</span>
          <span class="board-activity-preview-text">Aucune activite detaillee.</span>
        </div>
      `;
    }

    return `
      <div class="board-activity-preview">
        <span class="board-activity-preview-label">Derniere action</span>
        <span class="board-activity-preview-text">
          <strong>${escapeHtml(cleanText(latest.actorName, "systeme"))}</strong>
          ${escapeHtml(cleanText(latest.text))}
        </span>
      </div>
    `;
  }

  function normalizeActivityType(type) {
    return cleanText(type, "info")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-") || "info";
  }

  function getActivityTypeLabel(type) {
    switch (normalizeActivityType(type)) {
      case "board":
        return "Board";
      case "rename":
        return "Edition";
      case "member":
        return "Membre";
      case "node":
        return "Fiche";
      case "field":
        return "Edition";
      case "layout":
        return "Position";
      case "link":
        return "Relation";
      case "settings":
        return "Systeme";
      case "save":
        return "Systeme";
      default:
        return "Activite";
    }
  }

  function getSnapshotReasonLabel(reason) {
    switch (cleanText(reason).toLowerCase()) {
      case "create":
        return "Creation";
      case "rename":
        return "Renommage";
      case "restore":
        return "Restauration";
      case "save":
      default:
        return "Snapshot";
    }
  }

  function normalizeActivityBucket(type) {
    const normalized = normalizeActivityType(type);
    if (normalized === "link") return "relations";
    if (normalized === "field" || normalized === "node" || normalized === "rename") return "editions";
    if (normalized === "member") return "membres";
    if (normalized === "board" || normalized === "save" || normalized === "settings") return "systeme";
    return "autres";
  }

  function extractActivityGroupMeta(entry) {
    const text = cleanText(entry?.text);
    let match = text.match(/^a modifie le nom de (.+?) en (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[2] || match[1]),
        facet: cleanText(entry?.details?.label, "Nom"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a modifie la description de (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Description"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a modifie les notes de (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Notes"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a change le type de (.+?) \(/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Type"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a change le statut de (.+?) \(/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Statut"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a modifie les identifiants de (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Identifiants"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a modifie la liaison carte de (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Liaison carte"),
        bucket: "editions",
        groupable: true,
      };
    }

    match = text.match(/^a modifie la couleur de (.+)$/i);
    if (match) {
      return {
        subject: cleanText(match[1]),
        facet: cleanText(entry?.details?.label, "Couleur"),
        bucket: "editions",
        groupable: true,
      };
    }

    return {
      subject: "",
      facet: cleanText(entry?.details?.label),
      bucket: normalizeActivityBucket(entry?.type),
      groupable: false,
    };
  }

  function buildBoardActivityGroups(activity = []) {
    const rows = Array.isArray(activity) ? activity : [];
    const groups = [];
    const groupMap = new Map();

    rows.forEach((entry, index) => {
      const meta = extractActivityGroupMeta(entry);
      const actorName = cleanText(entry?.actorName, "systeme");
      const subjectKey = normalizeSearchText(meta.subject);
      const groupId = meta.groupable && subjectKey
        ? [
            normalizeSearchText(actorName),
            cleanText(entry?.at),
            meta.bucket,
            subjectKey,
          ].join("::")
        : `activity-${cleanText(entry?.id, index)}`;

      if (groupMap.has(groupId)) {
        const group = groupMap.get(groupId);
        group.items.push(entry);
        return;
      }

      const group = {
        id: groupId,
        actorName,
        at: cleanText(entry?.at),
        bucket: meta.bucket,
        subject: meta.subject,
        items: [entry],
        type: normalizeActivityType(entry?.type),
      };
      groupMap.set(groupId, group);
      groups.push(group);
    });

    return groups.map((group) => {
      const labels = [...new Set(
        group.items
          .map((entry) => cleanText(entry?.details?.label || extractActivityGroupMeta(entry).facet))
          .filter(Boolean)
      )];
      const hasDetails = group.items.some((entry) => entry?.details && (
        cleanText(entry.details.label) || cleanText(entry.details.before) || cleanText(entry.details.after)
      ));
      const summaryText = group.subject && group.items.length > 1
        ? `a modifie ${group.subject}`
        : cleanText(group.items[0]?.text);
      const detailHint = group.items.length > 1
        ? labels.join(" · ") || `${group.items.length} modifications`
        : labels[0] || "";

      return {
        ...group,
        labels,
        hasDetails,
        summaryText,
        detailHint,
      };
    });
  }

  function filterBoardActivityGroups(groups = [], filter = "all") {
    const list = Array.isArray(groups) ? groups : [];
    if (!filter || filter === "all") return list;
    return list.filter((group) => group.bucket === filter);
  }

  function summarizeBoardActivity(groups = []) {
    const rows = Array.isArray(groups) ? groups : [];
    const authors = new Set(
      rows
        .map((entry) => cleanText(entry?.actorName))
        .filter(Boolean)
    );
    const latest = rows[0] || null;
    return {
      total: rows.length,
      authorCount: authors.size,
      latest,
    };
  }

  function renderActivityDetailValue(value) {
    const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
    return escapeHtml(text || "Vide");
  }

  function renderBoardActivityFilters(groups = [], currentFilter = "all") {
    const counts = {
      all: groups.length,
      editions: groups.filter((group) => group.bucket === "editions").length,
      relations: groups.filter((group) => group.bucket === "relations").length,
      systeme: groups.filter((group) => group.bucket === "systeme").length,
    };
    const options = [
      { id: "all", label: "Tout" },
      { id: "editions", label: "Editions" },
      { id: "relations", label: "Relations" },
      { id: "systeme", label: "Systeme" },
    ].filter((option) => option.id === "all" || counts[option.id] > 0);

    return `
      <div class="activity-filter-bar">
        ${options.map((option) => `
          <button
            type="button"
            class="activity-filter-btn ${option.id === currentFilter ? "is-active" : ""}"
            data-activity-filter="${escapeHtml(option.id)}"
          >
            <span>${escapeHtml(option.label)}</span>
            <strong>${Number(counts[option.id] || 0)}</strong>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderBoardActivityRows(groups = []) {
    const rows = Array.isArray(groups) ? groups : [];
    if (!rows.length) {
      return '<div class="activity-row-empty">Aucune activite detaillee pour ce board.</div>';
    }

    return rows.map((group) => `
      <article class="activity-row activity-type-${escapeHtml(group.type)} activity-bucket-${escapeHtml(group.bucket)}">
        <div class="activity-row-head">
          <div class="activity-row-meta">
            <span class="activity-type-pill activity-type-${escapeHtml(group.type)}">${escapeHtml(getActivityTypeLabel(group.items[0]?.type || group.type))}</span>
            <span class="activity-row-actor">${escapeHtml(cleanText(group.actorName, "systeme"))}</span>
          </div>
          <span class="activity-row-time">${escapeHtml(formatDate(group.at))}</span>
        </div>
        <div class="activity-row-text">${escapeHtml(cleanText(group.summaryText))}</div>
        ${group.detailHint ? `<div class="activity-row-sub">${escapeHtml(group.detailHint)}</div>` : ""}
        ${group.hasDetails ? `
          <div class="activity-row-actions">
            <button
              type="button"
              class="btn-cyber btn-activity-detail"
              data-activity-detail="${escapeHtml(group.id)}"
            >
              Details
            </button>
          </div>
        ` : ""}
      </article>
    `).join("");
  }

  function buildBoardActivityDetailHtml(group) {
    const items = Array.isArray(group?.items) ? group.items : [];
    const detailedItems = items.filter((entry) => entry?.details && (
      cleanText(entry.details.label) || cleanText(entry.details.before) || cleanText(entry.details.after)
    ));

    return `
      <div class="detail-grid activity-detail-layout">
        <div class="detail-card activity-detail-summary">
          <div class="detail-card-title">Action</div>
          <div class="detail-row"><span>Acteur</span><strong>${escapeHtml(cleanText(group?.actorName, "systeme"))}</strong></div>
          <div class="detail-row"><span>Heure</span><strong>${escapeHtml(formatDate(group?.at))}</strong></div>
          <div class="detail-row"><span>Resume</span><strong>${escapeHtml(cleanText(group?.summaryText))}</strong></div>
          ${group?.detailHint ? `<div class="detail-row"><span>Champs</span><strong>${escapeHtml(cleanText(group.detailHint))}</strong></div>` : ""}
        </div>
        <div class="detail-card activity-detail-list-card">
          <div class="detail-card-title">Details</div>
          <div class="activity-detail-list">
            ${detailedItems.map((entry) => `
              <article class="activity-detail-item">
                <div class="activity-detail-item-head">
                  <span class="activity-type-pill activity-type-${escapeHtml(normalizeActivityType(entry.type))}">
                    ${escapeHtml(cleanText(entry?.details?.label || getActivityTypeLabel(entry.type), "Modification"))}
                  </span>
                  <span class="activity-detail-item-text">${escapeHtml(cleanText(entry.text))}</span>
                </div>
                <div class="activity-diff-grid">
                  <div class="activity-diff-col">
                    <span class="activity-diff-label">Avant</span>
                    <pre class="activity-diff-value">${renderActivityDetailValue(entry?.details?.before)}</pre>
                  </div>
                  <div class="activity-diff-col">
                    <span class="activity-diff-label">Apres</span>
                    <pre class="activity-diff-value">${renderActivityDetailValue(entry?.details?.after)}</pre>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderBoardSnapshotRows(board) {
    const snapshots = Array.isArray(board?.snapshots) ? board.snapshots : [];
    if (!snapshots.length) {
      return '<div class="activity-row-empty">Aucun snapshot disponible pour ce board.</div>';
    }

    return snapshots.map((snapshot) => {
      const stats = Array.isArray(snapshot?.content?.statLines) ? snapshot.content.statLines : [];
      const diffEntries = Array.isArray(snapshot?.diffEntries) ? snapshot.diffEntries.slice(0, 6) : [];
      return `
        <article class="version-card ${snapshot?.isLatest ? "is-latest" : ""}">
          <div class="version-card-head">
            <div class="version-card-title-wrap">
              <div class="version-card-date">${escapeHtml(formatDate(snapshot?.capturedAt || snapshot?.snapshotDate))}</div>
              <div class="version-card-name">${escapeHtml(cleanText(snapshot?.title, board?.title || "Board sans nom"))}</div>
              <div class="version-card-meta">
                <span>${escapeHtml(cleanText(snapshot?.actorName, "systeme"))}</span>
                <span>${escapeHtml(getSnapshotReasonLabel(snapshot?.reason))}</span>
                <span>${escapeHtml(cleanText(snapshot?.snapshotDate))}</span>
              </div>
            </div>
            <div class="version-card-actions">
              ${snapshot?.isLatest ? '<span class="version-state-pill">Actuel</span>' : ""}
              <button
                type="button"
                class="btn-cyber btn-version-restore"
                data-snapshot-restore="${escapeHtml(cleanText(snapshot?.snapshotDate))}"
                ${snapshot?.isLatest ? "disabled" : ""}
              >
                Restaurer
              </button>
            </div>
          </div>
          <div class="version-card-summary">${escapeHtml(cleanText(snapshot?.diffSummary, "Snapshot journalier"))}</div>
          ${stats.length ? `
            <div class="card-stats version-card-stats">
              ${stats.map((line) => `<span class="stat-pill">${escapeHtml(line)}</span>`).join("")}
            </div>
          ` : ""}
          ${diffEntries.length ? `
            <div class="version-card-diff-list">
              ${diffEntries.map((entry) => `<div class="version-card-diff-item">${escapeHtml(cleanText(entry))}</div>`).join("")}
            </div>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  function buildBoardVersionsHtml(board) {
    const snapshots = Array.isArray(board?.snapshots) ? board.snapshots : [];
    return `
      <div class="detail-grid board-version-layout">
        <aside class="detail-card version-sidebar-card">
          <div class="detail-card-title">Versioning</div>
          <div class="detail-row"><span>Board</span><strong>${escapeHtml(cleanText(board?.title, "Board sans nom"))}</strong></div>
          <div class="detail-row"><span>Snapshots</span><strong>${Number(board?.snapshotCount || snapshots.length || 0)}</strong></div>
          <div class="detail-row"><span>Frequence</span><strong>1 / jour si modifie</strong></div>
          <div class="detail-row"><span>Derniere maj</span><strong>${escapeHtml(formatDate(board?.updatedAt || board?.createdAt))}</strong></div>
        </aside>
        <section class="detail-card version-list-card">
          <div class="detail-card-head">
            <div>
              <div class="detail-card-title">Snapshots dates</div>
              <div class="detail-card-kicker">Diff lisible par jour et restauration en un clic.</div>
            </div>
          </div>
          <div class="version-list">
            ${renderBoardSnapshotRows(board)}
          </div>
        </section>
      </div>
    `;
  }

  function renderBriefingKeyTargets(items = []) {
    if (!items.length) return '<div class="report-empty">Aucune cible clee.</div>';
    return items.map((item, index) => `
      <article class="report-rank-row">
        <span class="report-rank-index">${index + 1}</span>
        <div class="report-rank-copy">
          <strong>${escapeHtml(cleanText(item?.name, "Cible"))}</strong>
          <span>${escapeHtml([
            cleanText(item?.type),
            cleanText(item?.status),
            Number.isFinite(Number(item?.degree)) ? `${Number(item.degree)} liens` : "",
          ].filter(Boolean).join(" • ") || "Profil")}</span>
        </div>
        <span class="report-rank-score">${escapeHtml(Number(item?.score || 0).toFixed(2))}</span>
      </article>
    `).join("");
  }

  function renderBriefingRelations(items = []) {
    if (!items.length) return '<div class="report-empty">Aucune relation dominante.</div>';
    return items.map((item, index) => `
      <article class="report-rank-row">
        <span class="report-rank-index">${index + 1}</span>
        <div class="report-rank-copy">
          <strong>${escapeHtml(cleanText(item?.label, "Relation"))}</strong>
          <span>${escapeHtml(cleanText(item?.kind, "relation"))}</span>
        </div>
        <span class="report-rank-score">${escapeHtml(Number(item?.score || 0).toFixed(2))}</span>
      </article>
    `).join("");
  }

  function renderBriefingChanges(items = []) {
    if (!items.length) return '<div class="report-empty">Aucun changement recent.</div>';
    return items.map((item) => `
      <article class="report-change-row">
        <div class="report-change-head">
          <strong>${escapeHtml(cleanText(item?.actorName, "systeme"))}</strong>
          <span>${escapeHtml(formatDate(item?.at))}</span>
        </div>
        <div class="report-change-text">${escapeHtml(cleanText(item?.text, "Modification"))}</div>
      </article>
    `).join("");
  }

  function buildBoardBriefingPrintHtml(board) {
    const report = board?.report && typeof board.report === "object" ? board.report : {};
    const statLines = Array.isArray(report?.statLines) ? report.statLines : [];
    const keyTargets = Array.isArray(report?.keyTargets) ? report.keyTargets : [];
    const topRelations = Array.isArray(report?.topRelations) ? report.topRelations : [];
    const latestChanges = Array.isArray(report?.latestChanges) ? report.latestChanges : [];
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(cleanText(report?.title || board?.title, "Board briefing"))}</title>
        <style>
          :root {
            color-scheme: dark;
            --bg: #071019;
            --panel: #0d1824;
            --panel-2: #101f2d;
            --line: rgba(102, 255, 249, 0.18);
            --text: #e6f8ff;
            --muted: #92a7b8;
            --accent: #73fbf7;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 32px;
            font-family: Rajdhani, Arial, sans-serif;
            background:
              radial-gradient(circle at top right, rgba(115, 251, 247, 0.08), transparent 32%),
              var(--bg);
            color: var(--text);
          }
          .report-shell {
            max-width: 1100px;
            margin: 0 auto;
            display: grid;
            gap: 18px;
          }
          .report-hero,
          .report-card {
            border: 1px solid var(--line);
            background: linear-gradient(180deg, rgba(115, 251, 247, 0.04), rgba(255, 255, 255, 0.02)), var(--panel);
            padding: 20px;
          }
          .report-brand {
            color: var(--accent);
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
          }
          .report-title {
            margin: 8px 0 6px;
            font-size: 34px;
            line-height: 1.05;
            text-transform: uppercase;
          }
          .report-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            color: var(--muted);
            font-size: 15px;
          }
          .report-stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }
          .report-stat {
            border: 1px solid var(--line);
            background: var(--panel-2);
            padding: 14px;
          }
          .report-stat span {
            display: block;
            color: var(--muted);
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .report-stat strong {
            display: block;
            margin-top: 8px;
            font-size: 21px;
          }
          .report-grid {
            display: grid;
            grid-template-columns: 1.1fr 1fr;
            gap: 18px;
          }
          .report-card h2 {
            margin: 0 0 14px;
            color: var(--accent);
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .report-pill-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .report-pill {
            border: 1px solid var(--line);
            background: rgba(255,255,255,0.03);
            padding: 8px 10px;
            font-size: 14px;
          }
          .report-rank-list,
          .report-change-list {
            display: grid;
            gap: 10px;
          }
          .report-rank-row,
          .report-change-row {
            border: 1px solid var(--line);
            background: rgba(255,255,255,0.03);
            padding: 12px 14px;
          }
          .report-rank-row {
            display: grid;
            grid-template-columns: 34px minmax(0, 1fr) auto;
            gap: 12px;
            align-items: center;
          }
          .report-rank-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            border: 1px solid var(--line);
            color: var(--accent);
            font-weight: 700;
          }
          .report-rank-copy {
            display: grid;
            gap: 4px;
          }
          .report-rank-copy strong {
            font-size: 18px;
          }
          .report-rank-copy span,
          .report-change-head span {
            color: var(--muted);
            font-size: 14px;
          }
          .report-rank-score {
            font-size: 17px;
            font-weight: 700;
          }
          .report-change-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 6px;
          }
          .report-change-text {
            font-size: 16px;
            line-height: 1.45;
          }
          .report-empty {
            color: var(--muted);
            font-size: 15px;
          }
          @media print {
            body { padding: 0; background: #071019; }
            .report-shell { max-width: none; }
          }
        </style>
      </head>
      <body>
        <main class="report-shell">
          <section class="report-hero">
            <div class="report-brand">BNI LINKED · BRIEFING BOARD</div>
            <h1 class="report-title">${escapeHtml(cleanText(report?.title || board?.title, "Board briefing"))}</h1>
            <div class="report-meta">
              <span>${escapeHtml(cleanText(report?.page, cleanText(board?.page, "point")).toUpperCase())}</span>
              <span>Owner ${escapeHtml(cleanText(report?.ownerName || board?.ownerName, "Lead"))}</span>
              <span>Maj ${escapeHtml(formatDate(report?.updatedAt || board?.updatedAt || board?.createdAt))}</span>
              <span>${Number(report?.snapshotCount || board?.snapshotCount || 0)} snapshots</span>
            </div>
          </section>
          <section class="report-stats">
            <div class="report-stat"><span>Board</span><strong>${escapeHtml(cleanText(board?.title, "Board sans nom"))}</strong></div>
            <div class="report-stat"><span>Activite</span><strong>${Number(board?.activityCount || latestChanges.length || 0)} evenements</strong></div>
            <div class="report-stat"><span>Versions</span><strong>${Number(report?.snapshotCount || board?.snapshotCount || 0)}</strong></div>
            <div class="report-stat"><span>Page</span><strong>${escapeHtml(cleanText(report?.page, cleanText(board?.page, "point")).toUpperCase())}</strong></div>
          </section>
          <section class="report-card">
            <h2>Resume board</h2>
            <div class="report-pill-list">
              ${statLines.length
                ? statLines.map((line) => `<span class="report-pill">${escapeHtml(cleanText(line))}</span>`).join("")
                : '<span class="report-pill">Aucune statistique</span>'}
            </div>
          </section>
          <section class="report-grid">
            <article class="report-card">
              <h2>Cibles cles</h2>
              <div class="report-rank-list">${renderBriefingKeyTargets(keyTargets)}</div>
            </article>
            <article class="report-card">
              <h2>Top relations</h2>
              <div class="report-rank-list">${renderBriefingRelations(topRelations)}</div>
            </article>
          </section>
          <section class="report-card">
            <h2>Derniers changements</h2>
            <div class="report-change-list">${renderBriefingChanges(latestChanges)}</div>
          </section>
        </main>
        <script>
          window.addEventListener('load', function () {
            setTimeout(function () {
              window.print();
            }, 120);
          });
        </script>
      </body>
      </html>
    `;
  }

  function renderBoardCard(board) {
    const pageBadge = cleanText(board?.page, "point").toUpperCase();
    const lockBadge = board?.editLock
      ? `<span class="badge badge-lock">LOCK ${escapeHtml(cleanText(board.editLock.username, "operateur"))}</span>`
      : `<span class="badge badge-free">LIBRE</span>`;
    const statLines = Array.isArray(board?.content?.statLines) ? board.content.statLines : [];
    return `
      <article class="data-card board-card" data-board-id="${escapeHtml(cleanText(board.id))}">
        <div class="card-top">
          <span class="badge badge-page">${escapeHtml(pageBadge)}</span>
          ${lockBadge}
        </div>
        <div class="card-title">${escapeHtml(cleanText(board.title, "Board sans nom"))}</div>
        <div class="card-subtitle">Owner: ${escapeHtml(cleanText(board.ownerName, "Lead"))}</div>
        <div class="card-board-meta">
          <span>Maj ${escapeHtml(formatDate(board.updatedAt || board.createdAt))}</span>
          <span>${Number(board.memberCount || 0)} users</span>
        </div>
        <div class="card-stats">
          ${statLines.map((line) => `<span class="stat-pill">${escapeHtml(line)}</span>`).join("")}
        </div>
        <div class="member-list">${renderMemberChips(Array.isArray(board.members) ? board.members : [])}</div>
        ${renderBoardActivityPreview(board)}
        <div class="card-actions">
          <button class="btn-cyber btn-detail" type="button" data-board-action="detail">DETAILS</button>
        </div>
      </article>
    `;
  }

  function renderBoardsPanel() {
    const state = appState.boards;
    const container = document.getElementById("cards-boards");
    const status = document.getElementById("status-boards");
    if (!container || !status) return;

    if (state.error) {
      const details = formatLoadError("boards", state.error);
      status.textContent = details.status;
      renderErrorState(container, details, "boards");
      updateLoadMoreButton("boards");
      updateToolbar();
      return;
    }

    const filteredBoards = getFilteredBoards();
    if (!state.entries.length) {
      status.textContent = "Aucun board.";
      container.innerHTML = '<div class="empty-state">AUCUN BOARD CLOUD TROUVE</div>';
      updateLoadMoreButton("boards");
      updateToolbar();
      return;
    }

    if (!filteredBoards.length) {
      status.textContent = "Aucun resultat.";
      container.innerHTML = '<div class="empty-state">AUCUN BOARD NE CORRESPOND AUX FILTRES</div>';
      updateLoadMoreButton("boards");
      updateToolbar();
      return;
    }

    container.innerHTML = filteredBoards.map((board) => renderBoardCard(board)).join("");
    container.querySelectorAll("[data-board-id]").forEach((card) => {
      const boardId = card.getAttribute("data-board-id") || "";
      const board = filteredBoards.find((entry) => cleanText(entry.id) === boardId);
      if (!board) return;
      card.querySelector('[data-board-action="detail"]')?.addEventListener("click", () => {
        showBoardDetails(board).catch(() => {});
      });
    });

    status.textContent = `${filteredBoards.length} visibles sur ${state.entries.length} charges`;
    updateLoadMoreButton("boards");
    updateToolbar();
  }

  function replaceBoardEntry(nextBoard) {
    const targetId = cleanText(nextBoard?.id);
    if (!targetId) return;
    appState.boards.entries = appState.boards.entries.map((entry) =>
      cleanText(entry?.id) === targetId ? nextBoard : entry
    );
  }

  function renderActiveTab() {
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle("active", key === appState.activeTab);
    });
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === appState.activeTab);
    });

    globalStatus.textContent = appState.activeTab === "boards"
      ? "Affichage des boards cloud"
      : `Affichage des archives ${appState.activeTab.toUpperCase()}`;

    if (appState.activeTab === "boards") {
      renderBoardsPanel();
    } else {
      renderArchivePanel(appState.activeTab);
    }
  }

  async function downloadArchive(entry, button = null) {
    if (button) {
      button.disabled = true;
      button.textContent = "...";
    }
    try {
      const data = await apiGetArchive(entry.key);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = makeFilename(entry);
      document.body.appendChild(anchor);
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
      if (button) button.textContent = "OK";
    } catch (error) {
      await customAlert("Erreur lors du telechargement du fichier.");
      if (button) button.textContent = "ERR";
    } finally {
      if (button) {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = "TELECHARGER";
        }, 1000);
      }
    }
  }

  async function deleteArchive(tab, entry, button = null) {
    const confirmed = await customConfirm("Voulez-vous vraiment supprimer definitivement cette archive ?");
    if (!confirmed) return;

    if (button) {
      button.disabled = true;
      button.textContent = "...";
    }

    try {
      await apiDeleteArchive(entry.key);
      appState[tab].entries = appState[tab].entries.filter((item) => cleanText(item.key) !== cleanText(entry.key));
      appState[tab].loaded = true;
      appState[tab].totalFound = Math.max(0, Number(appState[tab].totalFound || 0) - 1);
      renderActiveTab();
    } catch (error) {
      await customAlert("Erreur lors de la suppression. Verifiez votre connexion.");
      if (button) {
        button.disabled = false;
        button.textContent = "SUPPRIMER";
      }
    }
  }

  function buildArchiveDetailHtml(entry, data) {
    const summary = getArchiveSummary(entry);
    const rootKeys = Object.keys(data || {}).sort();
    const preview = data?.meta && typeof data.meta === "object"
      ? Object.entries(data.meta)
          .slice(0, 8)
          .map(([key, value]) => `<div class="detail-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(cleanText(value, "—"))}</strong></div>`)
          .join("")
      : '<div class="detail-row"><span>Meta</span><strong>Absente</strong></div>';

    return `
      <div class="detail-grid">
        <div class="detail-card">
          <div class="detail-card-title">Resume</div>
          <div class="detail-row"><span>Source</span><strong>${escapeHtml(summary.title || "Archive")}</strong></div>
          <div class="detail-row"><span>Type</span><strong>${escapeHtml(summary.actionLabel || humanizeAction(entry.action))}</strong></div>
          <div class="detail-row"><span>Date</span><strong>${escapeHtml(formatDate(summary.updatedAt || entry.createdAt))}</strong></div>
          <div class="detail-row"><span>Cle</span><strong>${escapeHtml(cleanText(entry.key))}</strong></div>
        </div>
        <div class="detail-card">
          <div class="detail-card-title">Contenu</div>
          ${(summary.statLines || []).map((line) => `<div class="detail-row"><span>Stats</span><strong>${escapeHtml(line)}</strong></div>`).join("")}
          <div class="detail-row"><span>Racine JSON</span><strong>${escapeHtml(rootKeys.join(", ") || "vide")}</strong></div>
        </div>
        <div class="detail-card">
          <div class="detail-card-title">Meta</div>
          ${preview}
        </div>
      </div>
    `;
  }

  async function showArchiveDetails(entry) {
    const data = await apiGetArchive(entry.key);
    const action = await showModal({
      title: getArchiveSummary(entry).title || "Archive",
      html: buildArchiveDetailHtml(entry, data),
      buttons: [
        { label: "Fermer", value: "close" },
        { label: "Telecharger", value: "download", className: "confirm" },
      ],
      dismissValue: "close",
    });
    if (action === "download") {
      await downloadArchive(entry, null);
    }
  }

  function buildBoardDetailHtml(board, options = {}) {
    const members = Array.isArray(board.members) ? board.members : [];
    const activityGroups = Array.isArray(options.activityGroups) ? options.activityGroups : [];
    const allActivityGroups = Array.isArray(options.allActivityGroups) ? options.allActivityGroups : activityGroups;
    const activitySummary = summarizeBoardActivity(allActivityGroups);
    const statLines = Array.isArray(board?.content?.statLines) ? board.content.statLines : [];
    const memberRows = members.length
      ? `
          <div class="detail-member-list">
            ${members.map((member) => `
              <span class="member-pill ${escapeHtml(cleanText(member.role, "editor"))}">
                ${escapeHtml(cleanText(member.role, "editor").toUpperCase())} · ${escapeHtml(cleanText(member.username, "user"))}
              </span>
            `).join("")}
          </div>
        `
      : '<div class="detail-inline-empty">Aucun user.</div>';

    const lockRow = board.editLock
      ? `<div class="detail-row"><span>Lock</span><strong>${escapeHtml(cleanText(board.editLock.username, "operateur"))} jusqu'a ${escapeHtml(formatDate(board.editLock.expiresAt))}</strong></div>`
      : '<div class="detail-row"><span>Lock</span><strong>Libre</strong></div>';

    return `
      <div class="detail-grid board-detail-layout">
        <aside class="board-detail-sidebar">
          <div class="detail-card detail-card-board">
            <div class="detail-card-title">Board</div>
            <div class="detail-row"><span>Nom</span><strong>${escapeHtml(cleanText(board.title, "Board sans nom"))}</strong></div>
            <div class="detail-row"><span>Page</span><strong>${escapeHtml(cleanText(board.page, "point").toUpperCase())}</strong></div>
            <div class="detail-row"><span>Owner</span><strong>${escapeHtml(cleanText(board.ownerName, "Lead"))}</strong></div>
            <div class="detail-row"><span>Maj</span><strong>${escapeHtml(formatDate(board.updatedAt || board.createdAt))}</strong></div>
            ${lockRow}
          </div>
          <div class="detail-card detail-card-content">
          <div class="detail-card-title">Contenu</div>
          <div class="detail-metric-list">
            ${statLines.length
                ? statLines.map((line) => `<div class="detail-metric-line">${escapeHtml(line)}</div>`).join("")
                : '<div class="detail-inline-empty">Aucune statistique.</div>'}
          </div>
          <div class="detail-row"><span>Activite</span><strong>${Number(board.activityCount || 0)} evenements</strong></div>
          <div class="detail-row"><span>Versions</span><strong>${Number(board.snapshotCount || 0)} snapshots</strong></div>
        </div>
        <div class="detail-card detail-card-users">
          <div class="detail-card-title">Users</div>
          ${memberRows}
        </div>
        </aside>
        <section class="detail-card detail-card-activity">
          <div class="detail-card-head">
            <div>
              <div class="detail-card-title">Journal</div>
              <div class="detail-card-kicker">Liste compacte, groupes utiles, details a part.</div>
            </div>
          </div>
          <div class="activity-summary-strip">
            <div class="activity-summary-item">
              <span class="activity-summary-label">Actions</span>
              <strong>${activitySummary.total}</strong>
            </div>
            <div class="activity-summary-item">
              <span class="activity-summary-label">Acteurs</span>
              <strong>${activitySummary.authorCount}</strong>
            </div>
            <div class="activity-summary-item">
              <span class="activity-summary-label">Derniere maj</span>
              <strong>${escapeHtml(activitySummary.latest ? formatDate(activitySummary.latest.at) : "Aucune")}</strong>
            </div>
          </div>
          ${renderBoardActivityFilters(allActivityGroups, cleanText(options.activityFilter, "all"))}
          <div class="activity-log">
            ${renderBoardActivityRows(activityGroups)}
          </div>
        </section>
      </div>
    `;
  }

  async function clearBoardActivity(board) {
    const boardId = cleanText(board?.id);
    if (!boardId) throw new Error("Board introuvable");
    const out = await apiClearBoardActivity(boardId);
    const nextBoard = out?.board && typeof out.board === "object"
      ? out.board
      : {
          ...board,
          activity: [],
          activityCount: 0,
        };
    replaceBoardEntry(nextBoard);
    if (appState.activeTab === "boards") {
      renderBoardsPanel();
    }
    return nextBoard;
  }

  async function loadBoardDetails(board) {
    const boardId = cleanText(board?.id);
    if (!boardId) throw new Error("Board introuvable");
    const out = await apiGetBoardDetails(boardId);
    const nextBoard = out?.board && typeof out.board === "object" ? out.board : board;
    replaceBoardEntry(nextBoard);
    if (appState.activeTab === "boards") {
      renderBoardsPanel();
    }
    return nextBoard;
  }

  function openBoardBriefingPdf(board) {
    const popup = window.open("", "_blank");
    if (!popup) {
      throw new Error("Popup bloquee");
    }
    popup.document.open();
    popup.document.write(buildBoardBriefingPrintHtml(board));
    popup.document.close();
  }

  async function showBoardVersionsModal(board) {
    let currentBoard = board;
    while (currentBoard) {
      const snapshots = Array.isArray(currentBoard?.snapshots) ? currentBoard.snapshots : [];
      const action = await showModal({
        title: `${cleanText(currentBoard?.title, "Board sans nom")} · Versions`,
        html: buildBoardVersionsHtml(currentBoard),
        dialogClass: "modal-box-wide modal-box-versions",
        dismissValue: "close",
        buttons: [
          { label: "Retour", value: "close", className: "confirm" },
        ],
        onRender: ({ modalText: body, finishModal: resolveModal }) => {
          const disposers = [];
          body.querySelectorAll("[data-snapshot-restore]").forEach((button) => {
            const handler = () => {
              const snapshotDate = cleanText(button.getAttribute("data-snapshot-restore"));
              if (!snapshotDate) return;
              resolveModal({ type: "restore", snapshotDate });
            };
            button.addEventListener("click", handler);
            disposers.push(() => button.removeEventListener("click", handler));
          });
          return () => disposers.forEach((dispose) => dispose());
        },
      });

      if (!action || action === "close") {
        return currentBoard;
      }

      if (action && typeof action === "object" && action.type === "restore") {
        const snapshotDate = cleanText(action.snapshotDate);
        const snapshot = snapshots.find((entry) => cleanText(entry?.snapshotDate) === snapshotDate);
        const confirmed = await showModal({
          title: "Restaurer ce snapshot ?",
          text: `Le board "${cleanText(currentBoard?.title, "Board sans nom")}" sera restaure sur l'etat du ${formatDate(snapshot?.capturedAt || snapshotDate)}.`,
          dismissValue: false,
          buttons: [
            { label: "Annuler", value: false },
            { label: "Restaurer", value: true, className: "danger" },
          ],
        });
        if (!confirmed) continue;

        try {
          const out = await apiRestoreBoardSnapshot(cleanText(currentBoard?.id), snapshotDate);
          currentBoard = out?.board && typeof out.board === "object" ? out.board : currentBoard;
          replaceBoardEntry(currentBoard);
          if (appState.activeTab === "boards") {
            renderBoardsPanel();
          }
        } catch (error) {
          await customAlert("Erreur lors de la restauration du snapshot.");
        }
      }
    }
    return currentBoard;
  }

  async function showBoardActivityDetailModal(group, board) {
    if (!group || !Array.isArray(group.items) || !group.items.length) return;
    await showModal({
      title: `${cleanText(board?.title, "Board sans nom")} · Details`,
      html: buildBoardActivityDetailHtml(group),
      dialogClass: "modal-box-wide modal-box-activity-detail",
      dismissValue: "close",
      buttons: [
        { label: "Retour", value: "close", className: "confirm" },
      ],
    });
  }

  async function showBoardDetails(board) {
    let currentBoard = board;
    try {
      currentBoard = await loadBoardDetails(board);
    } catch (error) {
      await customAlert("Erreur lors du chargement des details du board.");
      return;
    }
    let activityFilter = "all";
    while (currentBoard) {
      const allActivityGroups = buildBoardActivityGroups(currentBoard.activity);
      const visibleActivityGroups = filterBoardActivityGroups(allActivityGroups, activityFilter);
      const hasActivity = allActivityGroups.length > 0;
      const action = await showModal({
        title: cleanText(currentBoard.title, "Board sans nom"),
        html: buildBoardDetailHtml(currentBoard, {
          activityGroups: visibleActivityGroups,
          allActivityGroups,
          activityFilter,
        }),
        dialogClass: "modal-box-wide",
        dismissValue: "close",
        buttons: [
          { label: "Versions", value: "versions" },
          { label: "Export PDF", value: "export-report" },
          { label: "Vider le journal", value: "clear-activity", className: "danger", disabled: !hasActivity },
          { label: "Fermer", value: "close", className: "confirm" },
        ],
        onRender: ({ modalText: body, finishModal: resolveModal }) => {
          const disposers = [];
          body.querySelectorAll("[data-activity-filter]").forEach((button) => {
            const handler = () => {
              const nextFilter = cleanText(button.getAttribute("data-activity-filter"), "all");
              resolveModal({ type: "filter", filter: nextFilter });
            };
            button.addEventListener("click", handler);
            disposers.push(() => button.removeEventListener("click", handler));
          });
          body.querySelectorAll("[data-activity-detail]").forEach((button) => {
            const handler = () => {
              const groupId = cleanText(button.getAttribute("data-activity-detail"));
              resolveModal({ type: "detail", groupId });
            };
            button.addEventListener("click", handler);
            disposers.push(() => button.removeEventListener("click", handler));
          });
          return () => disposers.forEach((dispose) => dispose());
        },
      });

      if (action && typeof action === "object" && action.type === "filter") {
        activityFilter = cleanText(action.filter, "all");
        continue;
      }

      if (action && typeof action === "object" && action.type === "detail") {
        const targetGroup = allActivityGroups.find((group) => group.id === cleanText(action.groupId));
        if (targetGroup) {
          await showBoardActivityDetailModal(targetGroup, currentBoard);
        }
        continue;
      }

      if (action === "versions") {
        currentBoard = await showBoardVersionsModal(currentBoard);
        continue;
      }

      if (action === "export-report") {
        try {
          openBoardBriefingPdf(currentBoard);
        } catch (error) {
          await customAlert("Impossible d'ouvrir la fenetre d'export PDF.");
        }
        continue;
      }

      if (action !== "clear-activity") return;

      const confirmed = await showModal({
        title: "Etes-vous sur ?",
        text: `Voulez-vous vraiment vider definitivement le journal du board "${cleanText(currentBoard.title, "Board sans nom")}" ?`,
        dismissValue: false,
        buttons: [
          { label: "Annuler", value: false },
          { label: "Vider le journal", value: true, className: "danger" },
        ],
      });
      if (!confirmed) continue;

      try {
        currentBoard = await clearBoardActivity(currentBoard);
      } catch (error) {
        await customAlert("Erreur lors du vidage du journal.");
      }
    }
  }

  async function refreshTab(tab, options = {}) {
    const state = appState[tab];
    if (!state || state.loading) return;
    const status = document.getElementById(`status-${tab}`);
    state.loading = true;
    state.error = null;
    updateLoadMoreButton(tab);
    if (status) {
      status.textContent = options.append ? "CHARGEMENT DES DONNEES..." : "SYNCHRONISATION...";
    }

    try {
      const data = tab === "boards"
        ? await apiListBoards({
            offset: options.append ? state.nextOffset : 0,
            limit: PAGE_SIZE,
          })
        : await apiListArchives(tab, {
            offset: options.append ? state.nextOffset : 0,
            limit: PAGE_SIZE,
            refresh: Boolean(options.force),
          });

      const nextEntries = Array.isArray(data.entries) ? data.entries : [];
      state.entries = options.append ? state.entries.concat(nextEntries) : nextEntries;
      state.totalFound = Number(data.totalFound || state.entries.length);
      state.hasMore = Boolean(data.hasMore);
      state.nextOffset = Number(data.nextOffset || state.entries.length);
      state.loaded = true;
      state.error = null;
    } catch (error) {
      state.error = error;
      state.loaded = false;
      console.warn("Erreur database:", error);
    } finally {
      state.loading = false;
      renderActiveTab();
    }
  }

  function activateTab(tab) {
    appState.activeTab = tab;
    renderActiveTab();
    if (!appState[tab].loaded && !appState[tab].loading) {
      refreshTab(tab).catch(() => {});
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  toolbarSearch?.addEventListener("input", () => {
    appState.filters.search = toolbarSearch.value || "";
    renderActiveTab();
  });

  toolbarActionFilter?.addEventListener("change", () => {
    appState.filters.action = toolbarActionFilter.value || "all";
    renderActiveTab();
  });

  toolbarRefresh?.addEventListener("click", () => {
    refreshTab(appState.activeTab, { force: true }).catch(() => {});
  });

  ["point", "map", "boards"].forEach((tab) => {
    const btn = document.getElementById(`load-more-${tab}`);
    if (!btn) return;
    btn.addEventListener("click", () => {
      refreshTab(tab, { append: true }).catch(() => {});
    });
  });

  activateTab("point");
})();
