const { getStore, connectLambda } = require("../lib/blob-store");
const crypto = require("crypto");
const { MAX_SCAN_FILES, appendIndexEntry, normalizePage } = require("../lib/db-index");
const {
  jsonResponse,
  preflightResponse,
  authorizeDbRequest,
} = require("../lib/db-auth");

const STORE_NAME = "bni-linked-db";

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return preflightResponse();
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const access = await authorizeDbRequest(event, body);
  if (!access.ok) {
    return jsonResponse(access.statusCode || 401, { ok: false, error: access.error || "Unauthorized" });
  }

  const page = normalizePage(body.page);
  // On passe tout en minuscule pour éviter les problèmes de nommage de fichiers
  const action = String(body.action || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "");
  const data = body.data;

  if (!page) {
    return jsonResponse(400, { ok: false, error: "Invalid page" });
  }

  // MODIFICATION ICI : On autorise les actions composées (ex: export-mission-alpha)
  // Au lieu de vérifier l'égalité stricte, on vérifie si ça COMMENCE par import ou export
  if (!action.startsWith("import") && !action.startsWith("export")) {
    return jsonResponse(400, { ok: false, error: "Invalid action" });
  }

  const ts = Date.now();
  // La clé inclura le nom personnalisé (action)
  const key = `${page}/${ts}_${action}_${crypto.randomUUID()}`;

  try {
    const store = getStore(STORE_NAME);
    await store.setJSON(key, data, {
      metadata: { page, action, ts },
    });
    await appendIndexEntry(store, page, { key }, { maxScanFiles: MAX_SCAN_FILES });

    return jsonResponse(200, { ok: true, key, ts });
  } catch (e) {
    console.error("db-add error:", e);
    return jsonResponse(500, { ok: false, error: "Failed to save entry" });
  }
};
