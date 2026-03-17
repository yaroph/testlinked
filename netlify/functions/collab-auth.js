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
} = require("../lib/collab");

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

  return errorResponse(400, "Action inconnue.");
};
