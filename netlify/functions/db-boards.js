const { getStore, connectLambda } = require("../lib/blob-store");
const { listKeysByPrefix, normalizePage, readBody, boardKey } = require("../lib/collab");
const { summarizeBoardData, normalizeSearchText } = require("../lib/db-summary");
const { __test: collabBoardHelpers } = require("./collab-board");
const {
  jsonResponse,
  preflightResponse,
  authorizeDbRequest,
} = require("../lib/db-auth");

const STORE_NAME = "bni-linked-collab";
const LOCK_STALE_GRACE_MS = 15000;
const MAX_BOARD_SCAN = 2000;
const POINT_RELATION_WEIGHTS = {
  patron: 2.6,
  haut_grade: 2.2,
  employe: 1.3,
  collegue: 1.0,
  partenaire: 1.7,
  famille: 1.1,
  couple: 1.2,
  amour: 1.1,
  ami: 0.9,
  ennemi: 1.8,
  rival: 1.6,
  connaissance: 0.6,
  affiliation: 1.4,
  membre: 1.0,
  relation: 0.5,
};

const {
  normalizeBoardPayload,
  normalizeMapBoardPayload,
  buildBoardSaveActivityEntriesByPage,
  summarizeBoardDeltaByPage,
  appendBoardActivity,
  saveBoardDailySnapshot,
  listBoardSnapshots,
  boardSnapshotKey,
} = collabBoardHelpers;

function sanitizeLimit(rawValue) {
  let limit = parseInt(rawValue || "40", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 40;
  if (limit > 100) limit = 100;
  return limit;
}

function sanitizeOffset(rawValue) {
  const offset = parseInt(rawValue || "0", 10);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return offset;
}

function timeValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cleanDetailValue(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 1600);
}

async function loadBoard(store, boardId) {
  if (!boardId) return null;
  return store.get(boardKey(boardId), { type: "json" });
}

async function saveBoard(store, board) {
  return store.setJSON(boardKey(board.id), board);
}

function getDbActor(access) {
  const user = access?.auth?.user;
  if (user && typeof user === "object") {
    return {
      id: cleanText(user.id, "database"),
      username: cleanText(user.username, "database"),
    };
  }
  return {
    id: "database",
    username: access?.mode === "api-key" ? "database" : "systeme",
  };
}

function normalizeBoardDataForDetails(board = {}) {
  const page = normalizePage(board?.page) || "point";
  if (page === "map") {
    return normalizeMapBoardPayload(board?.data || {});
  }
  return normalizeBoardPayload(board?.data || {}, {
    fallbackUpdatedAt: cleanText(board?.updatedAt),
    fallbackUser: cleanText(board?.lastEditedBy?.username || board?.ownerName),
  });
}

function formatDateLabel(value) {
  const text = cleanText(value);
  if (!text) return "—";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toLocaleString("fr-FR");
}

function humanizeToken(value, fallback = "element") {
  const text = cleanText(value, fallback)
    .replace(/[-_]+/g, " ")
    .trim();
  return text || fallback;
}

function buildEmptyBoardData(page = "point") {
  return normalizePage(page) === "map"
    ? normalizeMapBoardPayload({ groups: [], tacticalLinks: [] })
    : normalizeBoardPayload({
        meta: {},
        physicsSettings: {},
        nodes: [],
        links: [],
        deletedNodes: [],
        deletedLinks: [],
        _collab: {},
      });
}

function formatSnapshotDelta(page, previousData, nextData) {
  const normalizedPage = normalizePage(page) || "point";
  const from = previousData && typeof previousData === "object" ? previousData : buildEmptyBoardData(normalizedPage);
  const to = nextData && typeof nextData === "object" ? nextData : buildEmptyBoardData(normalizedPage);
  const diffEntries = buildBoardSaveActivityEntriesByPage(normalizedPage, from, to, {});
  const diffSummary = summarizeBoardDeltaByPage(normalizedPage, from, to, {});
  return {
    diffSummary,
    diffEntries: (Array.isArray(diffEntries) ? diffEntries : []).map((entry) => cleanText(entry?.text)).filter(Boolean).slice(0, 8),
  };
}

function buildSnapshotRows(board, snapshots = []) {
  const page = normalizePage(board?.page) || "point";
  const rows = Array.isArray(snapshots) ? snapshots : [];
  return rows.map((snapshot, index) => {
    const previousSnapshot = rows[index + 1] || null;
    const previousData = previousSnapshot?.data || buildEmptyBoardData(page);
    const delta = index === (rows.length - 1)
      ? { diffSummary: "snapshot initial", diffEntries: [] }
      : formatSnapshotDelta(page, previousData, snapshot?.data);
    return {
      snapshotDate: cleanText(snapshot?.snapshotDate),
      capturedAt: cleanText(snapshot?.capturedAt),
      title: cleanText(snapshot?.title, cleanText(board?.title, "Board sans nom")),
      actorName: cleanText(snapshot?.actorName, "systeme"),
      reason: cleanText(snapshot?.reason, "save"),
      content: summarizeBoardData(page, snapshot?.data || {}),
      diffSummary: cleanText(delta.diffSummary, "snapshot initial"),
      diffEntries: delta.diffEntries,
      isLatest: index === 0,
    };
  });
}

function normalizePointLinkId(link) {
  const sourceId = cleanText(link?.source?.id || link?.source);
  const targetId = cleanText(link?.target?.id || link?.target);
  if (!sourceId || !targetId) return "";
  return sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
}

function buildPointBriefing(data = {}, activity = []) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const links = Array.isArray(data?.links) ? data.links : [];
  const nodeById = new Map(nodes.map((node) => [cleanText(node?.id), node]));
  const degree = new Map();
  const weighted = new Map();

  nodes.forEach((node) => {
    const nodeId = cleanText(node?.id);
    degree.set(nodeId, 0);
    weighted.set(nodeId, 0);
  });

  links.forEach((link) => {
    const sourceId = cleanText(link?.source);
    const targetId = cleanText(link?.target);
    const weight = Number(POINT_RELATION_WEIGHTS[cleanText(link?.kind).toLowerCase()] || POINT_RELATION_WEIGHTS.relation);
    degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
    degree.set(targetId, (degree.get(targetId) || 0) + 1);
    weighted.set(sourceId, (weighted.get(sourceId) || 0) + weight);
    weighted.set(targetId, (weighted.get(targetId) || 0) + weight);
  });

  const keyTargets = nodes
    .map((node) => {
      const nodeId = cleanText(node?.id);
      const score = Number(weighted.get(nodeId) || 0) + ((degree.get(nodeId) || 0) * 0.35);
      return {
        id: nodeId,
        name: cleanText(node?.name, cleanText(node?.id, "fiche")),
        type: humanizeToken(node?.type, "fiche"),
        status: humanizeToken(node?.personStatus, ""),
        degree: Number(degree.get(nodeId) || 0),
        score: Number(score.toFixed(2)),
      };
    })
    .sort((left, right) => right.score - left.score || right.degree - left.degree || left.name.localeCompare(right.name))
    .slice(0, 6);

  const topRelations = links
    .map((link) => {
      const source = nodeById.get(cleanText(link?.source));
      const target = nodeById.get(cleanText(link?.target));
      const sourceLabel = cleanText(source?.name, cleanText(link?.source, "source"));
      const targetLabel = cleanText(target?.name, cleanText(link?.target, "cible"));
      const kind = cleanText(link?.kind, "relation");
      const relationWeight = Number(POINT_RELATION_WEIGHTS[kind.toLowerCase()] || POINT_RELATION_WEIGHTS.relation);
      const score = relationWeight + Number(weighted.get(cleanText(link?.source)) || 0) + Number(weighted.get(cleanText(link?.target)) || 0);
      return {
        id: normalizePointLinkId(link),
        label: `${sourceLabel} ↔ ${targetLabel}`,
        kind: humanizeToken(kind, "relation"),
        score: Number(score.toFixed(2)),
      };
    })
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, 8);

  return {
    keyTargets,
    topRelations,
    latestChanges: normalizeBoardActivityRows(activity).slice(0, 8),
  };
}

function buildMapBriefing(data = {}, activity = []) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const keyTargets = groups
    .map((group) => ({
      name: cleanText(group?.name, cleanText(group?.id, "groupe")),
      type: "groupe",
      status: "",
      degree: (Array.isArray(group?.points) ? group.points.length : 0) + (Array.isArray(group?.zones) ? group.zones.length : 0),
      score: (Array.isArray(group?.points) ? group.points.length : 0) + ((Array.isArray(group?.zones) ? group.zones.length : 0) * 0.5),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 6);
  const topRelations = (Array.isArray(data?.tacticalLinks) ? data.tacticalLinks : [])
    .map((link, index) => ({
      id: cleanText(link?.id, `tactical-${index}`),
      label: `${cleanText(link?.sourceLabel || link?.from || "source")} ↔ ${cleanText(link?.targetLabel || link?.to || "cible")}`,
      kind: humanizeToken(link?.type || link?.kind || "liaison", "liaison"),
      score: 1,
    }))
    .slice(0, 8);

  return {
    keyTargets,
    topRelations,
    latestChanges: normalizeBoardActivityRows(activity).slice(0, 8),
  };
}

function buildBoardBriefingReport(board, data, snapshots = []) {
  const page = normalizePage(board?.page) || "point";
  const content = summarizeBoardData(page, data || {});
  const pointOrMap = page === "map"
    ? buildMapBriefing(data, board?.activity)
    : buildPointBriefing(data, board?.activity);
  return {
    page,
    title: cleanText(board?.title, "Board sans nom"),
    ownerName: cleanText(board?.ownerName, "Lead"),
    updatedAt: cleanText(board?.updatedAt),
    snapshotCount: Array.isArray(snapshots) ? snapshots.length : 0,
    statLines: Array.isArray(content.statLines) ? content.statLines : [],
    keyTargets: pointOrMap.keyTargets,
    topRelations: pointOrMap.topRelations,
    latestChanges: pointOrMap.latestChanges,
  };
}

async function buildBoardDetailsPayload(store, board) {
  const normalizedData = normalizeBoardDataForDetails(board);
  const snapshots = await listBoardSnapshots(store, cleanText(board?.id));
  const boardRow = buildBoardRow(board, await readBoardLock(store, cleanText(board?.id)));
  return {
    ...boardRow,
    data: normalizedData,
    snapshots: buildSnapshotRows(board, snapshots),
    snapshotCount: snapshots.length,
    report: buildBoardBriefingReport(board, normalizedData, snapshots),
  };
}

function normalizeBoardActivityRows(activity = []) {
  return (Array.isArray(activity) ? activity : [])
    .map((item) => {
      const details = item?.details && typeof item.details === "object"
        ? {
            label: cleanText(item.details.label),
            before: cleanDetailValue(item.details.before),
            after: cleanDetailValue(item.details.after),
          }
        : null;
      return {
        id: cleanText(item?.id),
        at: cleanText(item?.at),
        actorId: cleanText(item?.actorId),
        actorName: cleanText(item?.actorName, "systeme"),
        type: cleanText(item?.type, "info"),
        text: cleanText(item?.text),
        details: details && (details.label || details.before || details.after) ? details : null,
      };
    })
    .filter((item) => item.id && item.text)
    .sort((left, right) => timeValue(right.at) - timeValue(left.at))
    .slice(0, 40);
}

function uniqueMembers(board = {}) {
  const buckets = new Map();
  const ownerId = cleanText(board.ownerId);
  const ownerName = cleanText(board.ownerName, "Lead");

  if (ownerId || ownerName) {
    buckets.set(ownerId || ownerName, {
      userId: ownerId,
      username: ownerName,
      role: "owner",
      addedAt: cleanText(board.createdAt),
    });
  }

  (Array.isArray(board.members) ? board.members : []).forEach((member) => {
    const userId = cleanText(member?.userId);
    const username = cleanText(member?.username, "Membre");
    const key = userId || username;
    if (!key) return;
    buckets.set(key, {
      userId,
      username,
      role: cleanText(member?.role, userId && userId === ownerId ? "owner" : "editor"),
      addedAt: cleanText(member?.addedAt),
    });
  });

  return [...buckets.values()].sort((left, right) => {
    if (left.role === "owner" && right.role !== "owner") return -1;
    if (right.role === "owner" && left.role !== "owner") return 1;
    return String(left.username || "").localeCompare(String(right.username || ""));
  });
}

function normalizeLock(rawLock, boardId) {
  if (!rawLock || typeof rawLock !== "object") return null;
  const expiresAt = cleanText(rawLock.expiresAt);
  const expiresAtMs = timeValue(expiresAt);
  if (!boardId || !cleanText(rawLock.userId) || !expiresAtMs) return null;
  if ((expiresAtMs + LOCK_STALE_GRACE_MS) <= Date.now()) return null;

  const username = cleanText(rawLock.username, "operateur");
  return {
    boardId,
    userId: cleanText(rawLock.userId),
    username,
    role: cleanText(rawLock.role, "editor"),
    acquiredAt: cleanText(rawLock.acquiredAt || rawLock.lastAt),
    lastAt: cleanText(rawLock.lastAt || rawLock.acquiredAt),
    expiresAt,
    expiresInMs: Math.max(0, expiresAtMs - Date.now()),
    message: `${username} modifie ce board.`,
  };
}

async function readBoardLock(store, boardId) {
  if (!boardId) return null;
  const key = `locks/${boardId}`;
  const rawLock = await store.get(key, { type: "json" }).catch(() => null);
  const lock = normalizeLock(rawLock, boardId);
  if (!lock && rawLock) {
    await store.delete(key).catch(() => {});
  }
  return lock;
}

function buildBoardRow(board, editLock = null) {
  const page = normalizePage(board?.page) || "point";
  const members = uniqueMembers(board);
  const content = summarizeBoardData(page, board?.data || {});
  const title = cleanText(board?.title, "Board sans nom");
  const activity = normalizeBoardActivityRows(board?.activity);
  const searchText = normalizeSearchText([
    title,
    page,
    board?.ownerName,
    ...(members.map((member) => member.username)),
    ...(content.statLines || []),
    ...(activity.map((entry) => `${entry.actorName} ${entry.text}`)),
  ]);

  return {
    id: cleanText(board?.id),
    title,
    page,
    ownerId: cleanText(board?.ownerId),
    ownerName: cleanText(board?.ownerName, "Lead"),
    createdAt: cleanText(board?.createdAt),
    updatedAt: cleanText(board?.updatedAt),
    lastEditedBy: board?.lastEditedBy && typeof board.lastEditedBy === "object"
      ? {
          userId: cleanText(board.lastEditedBy.userId),
          username: cleanText(board.lastEditedBy.username),
          at: cleanText(board.lastEditedBy.at),
        }
      : null,
    memberCount: members.length,
    memberNames: members.map((member) => member.username),
    members,
    activityCount: activity.length,
    activity,
    content,
    editLock,
    searchText,
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return preflightResponse();
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const body = event.httpMethod === "POST" ? readBody(event) : null;
  if (event.httpMethod === "POST" && !body) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const access = await authorizeDbRequest(event, body);
  if (!access.ok) {
    return jsonResponse(access.statusCode || 401, { ok: false, error: access.error || "Unauthorized" });
  }

  const requestedPage = String(event.queryStringParameters?.page || "").trim().toLowerCase();
  const pageFilter = requestedPage === "map" || requestedPage === "point" ? requestedPage : "";
  const limit = sanitizeLimit(event.queryStringParameters?.limit);
  const offset = sanitizeOffset(event.queryStringParameters?.offset);
  const query = normalizeSearchText([event.queryStringParameters?.query || ""]);

  try {
    const store = getStore(STORE_NAME);
    if (event.httpMethod === "POST") {
      const action = cleanText(body?.action).toLowerCase();
      const boardId = cleanText(body?.boardId);
      const needsBoard = ["clear_activity", "get_board_details", "restore_snapshot"].includes(action);
      const board = needsBoard && boardId ? await loadBoard(store, boardId) : null;

      if (needsBoard && !boardId) {
        return jsonResponse(400, { ok: false, error: "Board introuvable" });
      }
      if (needsBoard && (!board || typeof board !== "object")) {
        return jsonResponse(404, { ok: false, error: "Board introuvable" });
      }

      if (action === "get_board_details") {
        return jsonResponse(200, {
          ok: true,
          board: await buildBoardDetailsPayload(store, board),
        });
      }

      if (action === "restore_snapshot") {
        const snapshotDate = cleanText(body?.snapshotDate);
        if (!snapshotDate) {
          return jsonResponse(400, { ok: false, error: "Snapshot introuvable" });
        }

        const snapshot = await store.get(boardSnapshotKey(boardId, snapshotDate), { type: "json" }).catch(() => null);
        const normalizedSnapshot = snapshot && typeof snapshot === "object"
          ? collabBoardHelpers.normalizeBoardSnapshot(snapshot)
          : null;
        if (!normalizedSnapshot || !normalizedSnapshot.snapshotDate) {
          return jsonResponse(404, { ok: false, error: "Snapshot introuvable" });
        }

        const actor = getDbActor(access);
        const now = new Date().toISOString();
        const previousTitle = cleanText(board?.title, "Board sans nom");
        const nextTitle = cleanText(normalizedSnapshot.title, previousTitle);
        const previousData = normalizeBoardDataForDetails(board);
        const nextData = normalizeBoardDataForDetails({
          ...board,
          page: normalizePage(normalizedSnapshot.page) || normalizePage(board?.page) || "point",
          data: normalizedSnapshot.data || {},
        });
        const deltaSummary = cleanText(
          summarizeBoardDeltaByPage(normalizePage(board?.page) || "point", previousData, nextData, {}),
          "snapshot restaure"
        );

        board.page = normalizePage(normalizedSnapshot.page) || normalizePage(board?.page) || "point";
        board.title = nextTitle;
        board.data = nextData;
        board.updatedAt = now;
        board.lastEditedBy = {
          userId: actor.id,
          username: actor.username,
          at: now,
        };
        appendBoardActivity(
          board,
          actor,
          "save",
          `a restaure le snapshot du ${normalizedSnapshot.snapshotDate} (${deltaSummary})`,
          {
            label: "Snapshot",
            before: previousTitle,
            after: nextTitle,
          }
        );
        await saveBoard(store, board);
        await saveBoardDailySnapshot(store, board, {
          capturedAt: now,
          actor,
          reason: "restore",
        }).catch((error) => {
          console.error("Failed to write board snapshot on restore", error);
        });

        return jsonResponse(200, {
          ok: true,
          board: await buildBoardDetailsPayload(store, board),
        });
      }

      if (action === "clear_activity") {
        board.activity = [];
        await saveBoard(store, board);

        return jsonResponse(200, {
          ok: true,
          board: await buildBoardDetailsPayload(store, board),
        });
      }

      return jsonResponse(400, { ok: false, error: "Action inconnue" });
    }

    const keys = await listKeysByPrefix(store, "boards/", MAX_BOARD_SCAN);
    const boards = await Promise.all(keys.map((key) => store.get(key, { type: "json" }).catch(() => null)));
    const rows = await Promise.all(
      boards
        .filter((board) => board && typeof board === "object" && cleanText(board.id))
        .map(async (board) => buildBoardRow(board, await readBoardLock(store, cleanText(board.id))))
    );

    const filtered = rows
      .filter((row) => !pageFilter || row.page === pageFilter)
      .filter((row) => !query || row.searchText.includes(query))
      .sort((left, right) => {
        const delta = timeValue(right.updatedAt || right.createdAt) - timeValue(left.updatedAt || left.createdAt);
        if (delta !== 0) return delta;
        return String(left.title || "").localeCompare(String(right.title || ""));
      });

    const entries = filtered.slice(offset, offset + limit);
    const nextOffset = offset + entries.length;

    return jsonResponse(200, {
      ok: true,
      count: entries.length,
      totalFound: filtered.length,
      offset,
      nextOffset,
      hasMore: nextOffset < filtered.length,
      entries,
    });
  } catch (error) {
    console.error("db-boards error:", error);
    return jsonResponse(500, { ok: false, error: "Failed to list boards" });
  }
};
