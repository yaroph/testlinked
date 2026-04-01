const { getStore, connectLambda } = require("../lib/blob-store");
const { listKeysByPrefix, normalizePage } = require("../lib/collab");
const { summarizeBoardData, normalizeSearchText } = require("../lib/db-summary");
const {
  jsonResponse,
  preflightResponse,
  authorizeDbRequest,
} = require("../lib/db-auth");

const STORE_NAME = "bni-linked-collab";
const LOCK_STALE_GRACE_MS = 15000;
const MAX_BOARD_SCAN = 2000;

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

function normalizeBoardActivityRows(activity = []) {
  return (Array.isArray(activity) ? activity : [])
    .map((item) => ({
      id: cleanText(item?.id),
      at: cleanText(item?.at),
      actorId: cleanText(item?.actorId),
      actorName: cleanText(item?.actorName, "systeme"),
      type: cleanText(item?.type, "info"),
      text: cleanText(item?.text),
    }))
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

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const access = await authorizeDbRequest(event);
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
