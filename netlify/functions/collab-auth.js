const {
  connectLambda,
  jsonResponse,
  preflightResponse,
  errorResponse,
  readBody,
  normalizeUsername,
  hashPassword,
  safeUser,
  nowIso,
  newId,
  getStoreClient,
  getUserByUsername,
  createSession,
  deleteSession,
  resolveAuth,
  userKey,
  usernameKey,
  getUserBoardIndex,
  boardKey,
} = require("../lib/collab");

function createActionError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function syncUsernameReferences(store, userId, nextUsername) {
  const index = await getUserBoardIndex(store, userId);
  const boardIds = Array.isArray(index?.boardIds) ? index.boardIds : [];

  for (const boardId of boardIds) {
    const cleanBoardId = String(boardId || "").trim();
    if (!cleanBoardId) continue;

    const board = await store.get(boardKey(cleanBoardId), { type: "json" });
    if (!board || typeof board !== "object") continue;

    let changed = false;

    if (String(board.ownerId || "") === String(userId) && String(board.ownerName || "") !== nextUsername) {
      board.ownerName = nextUsername;
      changed = true;
    }

    if (Array.isArray(board.members)) {
      let memberChanged = false;
      board.members = board.members.map((member) => {
        if (String(member?.userId || "") !== String(userId)) return member;
        if (String(member?.username || "") === nextUsername) return member;
        memberChanged = true;
        return {
          ...member,
          username: nextUsername,
        };
      });
      changed = changed || memberChanged;
    }

    if (
      board.lastEditedBy
      && String(board.lastEditedBy.userId || "") === String(userId)
      && String(board.lastEditedBy.username || "") !== nextUsername
    ) {
      board.lastEditedBy = {
        ...board.lastEditedBy,
        username: nextUsername,
      };
      changed = true;
    }

    if (changed) {
      await store.setJSON(boardKey(cleanBoardId), board);
    }
  }
}

async function updateUserProfile(store, user, payload = {}) {
  const currentPassword = String(payload.currentPassword || "");
  if (!currentPassword) {
    throw createActionError(400, "Mot de passe actuel requis.");
  }
  if (String(user?.passwordHash || "") !== hashPassword(currentPassword)) {
    throw createActionError(401, "Mot de passe actuel invalide.");
  }

  const nextUsernameRaw = String(payload.nextUsername || "").trim();
  const nextPassword = String(payload.nextPassword || "");
  const nextUser = { ...user };
  const currentUsername = String(user?.username || "");
  let usernameChanged = false;
  let passwordChanged = false;

  if (nextUsernameRaw) {
    const usernameCheck = normalizeUsername(nextUsernameRaw);
    if (!usernameCheck.ok) {
      throw createActionError(400, usernameCheck.reason);
    }
    if (usernameCheck.username !== currentUsername) {
      const existing = await getUserByUsername(store, usernameCheck.username);
      if (existing && String(existing.id || "") !== String(user.id || "")) {
        throw createActionError(409, "Ce nom utilisateur existe deja.");
      }
      nextUser.username = usernameCheck.username;
      usernameChanged = true;
    }
  }

  if (nextPassword) {
    if (nextPassword.length < 3) {
      throw createActionError(400, "Mot de passe trop court (min 3).");
    }
    const nextPasswordHash = hashPassword(nextPassword);
    if (nextPasswordHash === String(user?.passwordHash || "")) {
      throw createActionError(400, "Le nouveau mot de passe est identique.");
    }
    nextUser.passwordHash = nextPasswordHash;
    passwordChanged = true;
  }

  if (!usernameChanged && !passwordChanged) {
    throw createActionError(400, "Aucune modification a enregistrer.");
  }

  nextUser.updatedAt = nowIso();
  await store.setJSON(userKey(nextUser.id), nextUser);

  if (usernameChanged) {
    await store.setJSON(usernameKey(nextUser.username), { userId: nextUser.id, username: nextUser.username });
    if (currentUsername && currentUsername !== nextUser.username) {
      await store.delete(usernameKey(currentUsername));
    }
    await syncUsernameReferences(store, nextUser.id, nextUser.username);
  }

  return {
    user: nextUser,
    usernameChanged,
    passwordChanged,
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return preflightResponse();
  }

  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return errorResponse(405, "Method not allowed");
  }

  const body = event.httpMethod === "POST"
    ? readBody(event)
    : {
        action: event.queryStringParameters?.action || "",
        username: event.queryStringParameters?.username || "",
        password: event.queryStringParameters?.password || "",
        token: event.queryStringParameters?.token || "",
      };

  if (event.httpMethod === "POST" && !body) {
    return errorResponse(400, "JSON invalide.");
  }

  const action = String(body.action || "").toLowerCase();
  const store = getStoreClient();

  if (action === "register") {
    if (event.httpMethod !== "POST") {
      return errorResponse(400, "register doit etre en POST.");
    }
    const usernameCheck = normalizeUsername(body.username);
    if (!usernameCheck.ok) {
      return errorResponse(400, usernameCheck.reason);
    }

    const username = usernameCheck.username;
    const password = String(body.password || "");
    if (password.length < 3) {
      return errorResponse(400, "Mot de passe trop court (min 3).");
    }

    const existing = await getUserByUsername(store, username);
    if (existing) {
      return errorResponse(409, "Ce nom utilisateur existe deja.");
    }

    const user = {
      id: newId("usr"),
      username,
      passwordHash: hashPassword(password),
      createdAt: nowIso(),
    };

    await store.setJSON(userKey(user.id), user);
    await store.setJSON(usernameKey(username), { userId: user.id, username });

    const session = await createSession(store, user);
    return jsonResponse(200, {
      ok: true,
      token: session.token,
      user: safeUser(user),
    });
  }

  if (action === "login") {
    if (event.httpMethod !== "POST") {
      return errorResponse(400, "login doit etre en POST.");
    }
    const usernameCheck = normalizeUsername(body.username);
    if (!usernameCheck.ok) {
      return errorResponse(400, "Nom utilisateur invalide.");
    }

    const username = usernameCheck.username;
    const password = String(body.password || "");
    const user = await getUserByUsername(store, username);
    if (!user) {
      return errorResponse(401, "Identifiants invalides.");
    }

    if (user.passwordHash !== hashPassword(password)) {
      return errorResponse(401, "Identifiants invalides.");
    }

    const session = await createSession(store, user);
    return jsonResponse(200, {
      ok: true,
      token: session.token,
      user: safeUser(user),
    });
  }

  if (action === "me") {
    const auth = await resolveAuth(event, body);
    if (!auth.ok) {
      return errorResponse(auth.statusCode || 401, auth.error || "Session invalide.");
    }

    return jsonResponse(200, {
      ok: true,
      user: safeUser(auth.user),
    });
  }

  if (action === "logout") {
    const auth = await resolveAuth(event, body);
    if (!auth.ok) {
      return errorResponse(auth.statusCode || 401, auth.error || "Session invalide.");
    }

    await deleteSession(auth.store, auth.token);
    return jsonResponse(200, { ok: true });
  }

  if (action === "update_profile") {
    if (event.httpMethod !== "POST") {
      return errorResponse(400, "update_profile doit etre en POST.");
    }

    const auth = await resolveAuth(event, body);
    if (!auth.ok) {
      return errorResponse(auth.statusCode || 401, auth.error || "Session invalide.");
    }

    try {
      const result = await updateUserProfile(auth.store, auth.user, body);
      return jsonResponse(200, {
        ok: true,
        user: safeUser(result.user),
      });
    } catch (error) {
      return errorResponse(error.statusCode || 400, error.message || "Erreur profil.");
    }
  }

  return errorResponse(400, "Action inconnue.");
};

exports.__test = {
  syncUsernameReferences,
  updateUserProfile,
};
