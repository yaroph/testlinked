const { getStore, connectLambda } = require("../lib/blob-store");
const { MAX_SCAN_FILES, normalizePage, parseKey, removeIndexEntry } = require("../lib/db-index");
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

  const key = String(body.key || "");
  if (!key) {
    return jsonResponse(400, { ok: false, error: "Missing key" });
  }

  try {
    const store = getStore(STORE_NAME);
    const parsed = parseKey(key);
    await store.delete(key);
    if (parsed && normalizePage(parsed.page)) {
      await removeIndexEntry(store, parsed.page, key, { maxScanFiles: MAX_SCAN_FILES });
    }
    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error("db-delete error:", e);
    return jsonResponse(500, { ok: false, error: "Failed to delete entry" });
  }
};
