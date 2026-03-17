const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("crypto");

const STORE_NAME = "bni-linked-collab";
const ROLE_OWNER = "owner";
const ROLE_EDITOR = "editor";
const ROLE_VIEWER = "viewer";
const ALLOWED_ROLES = new Set([ROLE_OWNER, ROLE_EDITOR, ROLE_VIEWER]);

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Collab-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Collab-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
    },
    body: "",
  };
}

function errorResponse(statusCode, error, extra = {}) {
  return jsonResponse(statusCode, { ok: false, error, ...extra });
}

function readBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

function getHeader(event, name) {
  const target = String(name || "").toLowerCase();
  const headers = event.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) return value;
  }
  return "";
}

function normalizeUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, reason: "Nom utilisateur vide." };
  const lowered = raw.toLowerCase();
  const clean = lowered.replace(/[^a-z0-9._-]/g, "");
  if (clean.length < 3) return { ok: false, reason: "Nom utilisateur trop court (min 3)." };
  if (clean.length > 24) return { ok: false, reason: "Nom utilisateur trop long (max 24)." };
  return { ok: true, username: clean };
}

function normalizeTitle(input) {
  const value = String(input || "").trim();
  if (!value) return "Tableau sans nom";
  return value.slice(0, 80);
}

function normalizePage(input) {
  const page = String(input || "point").toLowerCase();
  return page === "map" ? "map" : "point";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function newToken() {
  return `${crypto.randomUUID()}${crypto.randomBytes(8).toString("hex")}`;
}

function userKey(userId) {
  return `users/${userId}`;
}

function usernameKey(username) {
  return `users/by-name/${username}`;
}

function sessionKey(token) {
  return `sessions/${token}`;
}

function boardKey(boardId) {
  return `boards/${boardId}`;
}

function legacyUserBoardsKey(userId) {
  return `users/${userId}/boards`;
}

function userBoardsKey(userId) {
  // Kept outside of `users/<id>` because that path is already used by the user blob itself.
  // Some blob backends do not behave well when a key is both a stored value and a prefix.
  return `user-boards/${userId}`;
}

function getStoreClient() {
  return getStore(STORE_NAME);
}

async function getUserByUsername(store, username) {
  const mapping = await store.get(usernameKey(username), { type: "json" });
  if (!mapping || !mapping.userId) return null;
  return store.get(userKey(mapping.userId), { type: "json" });
}

async function getUserById(store, userId) {
  if (!userId) return null;
  return store.get(userKey(userId), { type: "json" });
}

async function createSession(store, user) {
  const token = newToken();
  const session = {
    token,
    userId: user.id,
    username: user.username,
    createdAt: nowIso(),
    lastAt: nowIso(),
  };
  await store.setJSON(sessionKey(token), session);
  return session;
}

async function getSession(store, token) {
  if (!token) return null;
  const session = await store.get(sessionKey(token), { type: "json" });
  if (!session || !session.userId) return null;
  return session;
}

async function deleteSession(store, token) {
  if (!token) return;
  await store.delete(sessionKey(token));
}

async function resolveAuth(event, body = null) {
  const store = getStoreClient();
  const bodyToken = body && typeof body.token === "string" ? body.token : "";
  const token = String(
    getHeader(event, "x-collab-token") ||
      event.queryStringParameters?.token ||
      bodyToken ||
      ""
  ).trim();

  if (!token) {
    return { ok: false, statusCode: 401, error: "Session requise." };
  }

  const session = await getSession(store, token);
  if (!session) {
    return { ok: false, statusCode: 401, error: "Session invalide." };
  }

  const user = await getUserById(store, session.userId);
  if (!user) {
    await deleteSession(store, token);
    return { ok: false, statusCode: 401, error: "Utilisateur introuvable." };
  }

  session.lastAt = nowIso();
  await store.setJSON(sessionKey(token), session);

  return { ok: true, store, token, session, user };
}

async function listKeysByPrefix(store, prefix, maxItems = 1000) {
  const keys = [];
  let cursor;
  let scanned = 0;

  do {
    const page = await store.list({ prefix, cursor });
    const blobs = Array.isArray(page.blobs) ? page.blobs : [];
    for (const blob of blobs) {
      keys.push(blob.key);
      scanned++;
      if (keys.length >= maxItems) return keys;
    }
    cursor = page.cursor;
    if (scanned >= maxItems) break;
  } while (cursor);

  return keys;
}

async function getUserBoardIndex(store, userId) {
  if (!userId) return { boardIds: [], hydrated: false };
  let rawIndex = await store.get(userBoardsKey(userId), { type: "json" }).catch(() => null);
  if (!rawIndex) {
    rawIndex = await store.get(legacyUserBoardsKey(userId), { type: "json" }).catch(() => null);
  }
  const seen = new Set();
  const boardIds = (Array.isArray(rawIndex?.boardIds) ? rawIndex.boardIds : [])
    .map((boardId) => String(boardId || "").trim())
    .filter((boardId) => {
      if (!boardId || seen.has(boardId)) return false;
      seen.add(boardId);
      return true;
    });
  return {
    boardIds,
    hydrated: Boolean(rawIndex?.hydrated),
  };
}

async function setUserBoardIndex(store, userId, boardIds = [], options = {}) {
  if (!userId) return;
  const seen = new Set();
  const normalizedBoardIds = boardIds
    .map((boardId) => String(boardId || "").trim())
    .filter((boardId) => {
      if (!boardId || seen.has(boardId)) return false;
      seen.add(boardId);
      return true;
    });
  await store.setJSON(userBoardsKey(userId), {
    boardIds: normalizedBoardIds,
    hydrated: options.hydrated !== undefined ? Boolean(options.hydrated) : true,
    updatedAt: nowIso(),
  });
  await store.delete(legacyUserBoardsKey(userId)).catch(() => {});
}

async function addUserBoardRef(store, userId, boardId) {
  const cleanBoardId = String(boardId || "").trim();
  if (!userId || !cleanBoardId) return;
  const index = await getUserBoardIndex(store, userId);
  if (!index.boardIds.includes(cleanBoardId)) {
    index.boardIds.push(cleanBoardId);
  }
  await setUserBoardIndex(store, userId, index.boardIds, { hydrated: index.hydrated });
}

async function removeUserBoardRef(store, userId, boardId) {
  const cleanBoardId = String(boardId || "").trim();
  if (!userId || !cleanBoardId) return;
  const index = await getUserBoardIndex(store, userId);
  const nextBoardIds = index.boardIds.filter((currentId) => currentId !== cleanBoardId);
  await setUserBoardIndex(store, userId, nextBoardIds, { hydrated: index.hydrated });
}

function getRoleForUser(board, userId) {
  if (!board || !userId) return null;
  if (String(board.ownerId) === String(userId)) return ROLE_OWNER;
  const members = Array.isArray(board.members) ? board.members : [];
  const member = members.find((m) => String(m.userId) === String(userId));
  return member ? member.role || ROLE_EDITOR : null;
}

function canEditBoard(role) {
  return role === ROLE_OWNER || role === ROLE_EDITOR;
}

function sanitizeRole(inputRole, fallback = ROLE_EDITOR) {
  const role = String(inputRole || fallback).toLowerCase();
  if (ALLOWED_ROLES.has(role)) return role;
  return fallback;
}

function withMember(board, member) {
  const members = Array.isArray(board.members) ? [...board.members] : [];
  const index = members.findIndex((m) => String(m.userId) === String(member.userId));
  if (index >= 0) {
    members[index] = { ...members[index], ...member };
  } else {
    members.push(member);
  }
  return members;
}

function withoutMember(board, userId) {
  const members = Array.isArray(board.members) ? board.members : [];
  return members.filter((m) => String(m.userId) !== String(userId));
}

function boardSummary(board, role) {
  const members = Array.isArray(board.members) ? board.members : [];
  return {
    id: board.id,
    title: board.title,
    page: board.page || "point",
    role,
    ownerId: board.ownerId,
    ownerName: board.ownerName,
    updatedAt: board.updatedAt,
    createdAt: board.createdAt,
    membersCount: members.length,
  };
}

module.exports = {
  ROLE_OWNER,
  ROLE_EDITOR,
  ROLE_VIEWER,
  connectLambda,
  jsonResponse,
  preflightResponse,
  errorResponse,
  readBody,
  normalizeUsername,
  normalizeTitle,
  normalizePage,
  hashPassword,
  safeUser,
  nowIso,
  newId,
  getStoreClient,
  getUserByUsername,
  getUserById,
  createSession,
  deleteSession,
  resolveAuth,
  listKeysByPrefix,
  getUserBoardIndex,
  setUserBoardIndex,
  addUserBoardRef,
  removeUserBoardRef,
  boardKey,
  userKey,
  usernameKey,
  getRoleForUser,
  canEditBoard,
  sanitizeRole,
  withMember,
  withoutMember,
  boardSummary,
  ALLOWED_ROLES,
};
