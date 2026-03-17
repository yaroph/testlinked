const VALID_PAGES = new Set(["point", "map"]);
const INDEX_PREFIX = "__meta/index/";
const MAX_SCAN_FILES = 20000;
const MAX_INDEX_ENTRIES = 20000;

function normalizePage(input) {
  const page = String(input || "").toLowerCase();
  return VALID_PAGES.has(page) ? page : "";
}

function indexKey(page) {
  return `${INDEX_PREFIX}${page}`;
}

function parseKey(key) {
  try {
    const [page, rest] = String(key || "").split("/", 2);
    const normalizedPage = normalizePage(page);
    if (!normalizedPage || !rest) return null;

    const parts = rest.split("_");
    const ts = Number(parts[0]);
    if (!Number.isFinite(ts) || ts <= 0) return null;

    const action = parts.slice(1, parts.length - 1).join("_") || "unknown";
    if (!action.startsWith("import") && !action.startsWith("export")) return null;

    return {
      key: String(key),
      page: normalizedPage,
      action,
      ts,
      createdAt: new Date(ts).toISOString(),
    };
  } catch (e) {
    return null;
  }
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return parseKey(entry.key);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const delta = Number(b.ts || 0) - Number(a.ts || 0);
    if (delta !== 0) return delta;
    return String(b.key || "").localeCompare(String(a.key || ""));
  });
}

function dedupeEntries(entries) {
  const latestByKey = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const clean = sanitizeEntry(entry);
    if (!clean) return;
    latestByKey.set(clean.key, clean);
  });
  return sortEntries([...latestByKey.values()]).slice(0, MAX_INDEX_ENTRIES);
}

async function readIndexSnapshot(store, page) {
  const normalizedPage = normalizePage(page);
  if (!normalizedPage) return { exists: false, entries: [] };

  const value = await store.get(indexKey(normalizedPage), { type: "json" }).catch(() => null);
  if (!value || typeof value !== "object") {
    return { exists: false, entries: [] };
  }

  const entries = dedupeEntries(Array.isArray(value.entries) ? value.entries : []);
  return { exists: true, entries };
}

async function writeIndex(store, page, entries) {
  const normalizedPage = normalizePage(page);
  if (!normalizedPage) return [];

  const cleanEntries = dedupeEntries(entries);
  await store.setJSON(indexKey(normalizedPage), {
    page: normalizedPage,
    updatedAt: new Date().toISOString(),
    entries: cleanEntries,
  });
  return cleanEntries;
}

async function rebuildIndex(store, page, options = {}) {
  const normalizedPage = normalizePage(page);
  if (!normalizedPage) return { exists: false, entries: [], scanned: 0, truncated: false };

  const maxScanFiles = Math.max(1, Number(options.maxScanFiles) || MAX_SCAN_FILES);
  const entries = [];
  let cursor;
  let scanned = 0;
  let truncated = false;

  do {
    const result = await store.list({
      prefix: `${normalizedPage}/`,
      cursor,
    });

    const blobs = Array.isArray(result?.blobs) ? result.blobs : [];
    blobs.forEach((blob) => {
      const parsed = parseKey(blob?.key);
      if (parsed) entries.push(parsed);
    });

    scanned += blobs.length;
    cursor = result?.cursor;

    if (scanned >= maxScanFiles) {
      truncated = Boolean(cursor);
      cursor = null;
    }
  } while (cursor);

  const cleanEntries = await writeIndex(store, normalizedPage, entries);
  return {
    exists: true,
    entries: cleanEntries,
    scanned,
    truncated,
  };
}

async function ensureIndex(store, page, options = {}) {
  const snapshot = await readIndexSnapshot(store, page);
  if (snapshot.exists) {
    return {
      exists: true,
      entries: snapshot.entries,
      scanned: 0,
      truncated: false,
      rebuilt: false,
    };
  }

  const rebuilt = await rebuildIndex(store, page, options);
  return {
    ...rebuilt,
    rebuilt: true,
  };
}

async function appendIndexEntry(store, page, entry, options = {}) {
  const normalizedPage = normalizePage(page);
  const cleanEntry = sanitizeEntry(entry);
  if (!normalizedPage || !cleanEntry) return [];

  const snapshot = await ensureIndex(store, normalizedPage, options);
  return writeIndex(store, normalizedPage, [cleanEntry, ...snapshot.entries]);
}

async function removeIndexEntry(store, page, key, options = {}) {
  const normalizedPage = normalizePage(page);
  if (!normalizedPage || !key) return [];

  const snapshot = await ensureIndex(store, normalizedPage, options);
  return writeIndex(
    store,
    normalizedPage,
    snapshot.entries.filter((entry) => String(entry.key || "") !== String(key))
  );
}

module.exports = {
  MAX_SCAN_FILES,
  normalizePage,
  parseKey,
  readIndexSnapshot,
  rebuildIndex,
  ensureIndex,
  appendIndexEntry,
  removeIndexEntry,
};
