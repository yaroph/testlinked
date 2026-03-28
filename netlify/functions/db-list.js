const { getStore, connectLambda } = require("../lib/blob-store");
const {
  MAX_SCAN_FILES,
  ensureIndex,
  normalizePage,
  rebuildIndex,
} = require("../lib/db-index");
const { buildArchiveSummary } = require("../lib/db-summary");
const {
  jsonResponse,
  preflightResponse,
  authorizeDbRequest,
} = require("../lib/db-auth");

const STORE_NAME = "bni-linked-db";

function sanitizeLimit(rawValue) {
  let limit = parseInt(rawValue || "50", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  return limit;
}

function sanitizeOffset(rawValue) {
  const offset = parseInt(rawValue || "0", 10);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return offset;
}

function shouldIncludeSummary(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function hydrateEntrySummary(store, entry) {
  if (!entry || typeof entry !== "object") return entry;

  let record = null;
  let data = null;
  let metadata = null;

  if (typeof store.getWithMetadata === "function") {
    record = await store.getWithMetadata(entry.key, { type: "json" }).catch(() => null);
    data = record?.data || null;
    metadata = record?.metadata && typeof record.metadata === "object" ? record.metadata : null;
  } else {
    data = await store.get(entry.key, { type: "json" }).catch(() => null);
  }

  const summary = metadata?.summary && typeof metadata.summary === "object"
    ? metadata.summary
    : buildArchiveSummary(entry.page, entry.action, data || {}, {
        key: entry.key,
        createdAt: entry.createdAt,
      });

  return {
    ...entry,
    summary,
  };
}

exports.handler = async (event) => {
  // Initialisation du contexte pour Netlify Blobs
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

  // 1. Validation des paramètres
  const page = normalizePage(event.queryStringParameters?.page);
  const limit = sanitizeLimit(event.queryStringParameters?.limit);
  const offset = sanitizeOffset(event.queryStringParameters?.offset);
  const forceRefresh = event.queryStringParameters?.refresh === "1";
  const includeSummary = shouldIncludeSummary(event.queryStringParameters?.includeSummary);

  // Validation stricte de la "page" pour éviter de scanner n'importe quoi
  if (!page) {
    return jsonResponse(400, { ok: false, error: "Invalid page parameter" });
  }

  try {
    const store = getStore(STORE_NAME);
    const snapshot = forceRefresh
      ? await rebuildIndex(store, page, { maxScanFiles: MAX_SCAN_FILES })
      : await ensureIndex(store, page, { maxScanFiles: MAX_SCAN_FILES });
    const allEntries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const limitedEntries = allEntries.slice(offset, offset + limit);
    const entries = includeSummary
      ? await Promise.all(limitedEntries.map((entry) => hydrateEntrySummary(store, entry)))
      : limitedEntries;
    const nextOffset = offset + limitedEntries.length;
    const hasMore = nextOffset < allEntries.length;

    return jsonResponse(200, { 
        ok: true,
        count: entries.length,
        totalScanned: Number(snapshot.scanned || 0),
        totalFound: allEntries.length,
        offset,
        nextOffset,
        hasMore,
        rebuiltIndex: Boolean(snapshot.rebuilt),
        truncated: Boolean(snapshot.truncated),
        entries
    });

  } catch (e) {
    console.error("db-list error:", e);
    return jsonResponse(500, { ok: false, error: "Failed to list entries" });
  }
};
