const { connectLambda: connectNetlifyLambda, getStore: getNetlifyStore } = require("@netlify/blobs");
const { getFirebaseDatabase } = require("./firebase-admin");

const ROOT_PREFIX = "stores";
const BLOB_SENTINEL = "__bni_blob";
const DEFAULT_LIST_PAGE_SIZE = 400;
const MAX_LIST_PAGE_SIZE = 1000;

function connectLambda(event) {
  try {
    connectNetlifyLambda(event);
  } catch (error) {}
}

function normalizeStoreName(storeName) {
  return String(storeName || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-");
}

function splitKey(key) {
  return String(key || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readStoreNamespace() {
  return String(
    process.env.BNI_FIREBASE_STORE_NAMESPACE ||
    process.env.FIREBASE_STORE_NAMESPACE ||
    ""
  )
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildStorePath(storeName, key = "") {
  const namespace = readStoreNamespace();
  const parts = [
    ROOT_PREFIX,
    ...(namespace ? [namespace] : []),
    normalizeStoreName(storeName),
    ...splitKey(key),
  ];
  return parts.join("/");
}

function isBlobNode(value) {
  return Boolean(value && typeof value === "object" && value[BLOB_SENTINEL] === true);
}

function wrapBlobValue(value, metadata = null) {
  return {
    [BLOB_SENTINEL]: true,
    value: value === undefined ? null : value,
    metadata: metadata && typeof metadata === "object" ? metadata : null,
    updatedAt: new Date().toISOString(),
  };
}

function unwrapBlobValue(value) {
  if (!isBlobNode(value)) return null;
  return value.value === undefined ? null : value.value;
}

function trimSlashes(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function encodeRestPath(path) {
  return trimSlashes(path)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function hasFirebaseStoreConfig() {
  return Boolean(
    String(process.env.BNI_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || "").trim()
  );
}

function readNetlifyStoreConfig() {
  const siteID = String(
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    ""
  ).trim();
  const token = String(
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.NETLIFY_TOKEN ||
    ""
  ).trim();
  const apiURL = String(process.env.NETLIFY_API_URL || "").trim();
  return {
    siteID,
    token,
    apiURL,
  };
}

function normalizePageSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_LIST_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, Math.floor(size)));
}

async function listFirebaseEntries(database, storeName, rawPrefix = "", options = {}) {
  const cleanPrefix = trimSlashes(rawPrefix);
  const cursor = String(options.cursor || "").trim();
  const pageSize = normalizePageSize(options.limit);
  const snapshot = await database.ref(buildStorePath(storeName, cleanPrefix)).get();
  if (!snapshot.exists()) {
    return { blobs: [], cursor: null };
  }

  const payload = snapshot.val();
  if (isBlobNode(payload)) {
    return {
      blobs: cleanPrefix ? [{ key: cleanPrefix }] : [],
      cursor: null,
    };
  }

  let childKeys = Object.keys(payload || {})
    .map((key) => String(key || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (cursor) {
    const cursorIndex = childKeys.indexOf(cursor);
    if (cursorIndex >= 0) {
      childKeys = childKeys.slice(cursorIndex + 1);
    } else {
      childKeys = childKeys.filter((key) => key.localeCompare(cursor) > 0);
    }
  }

  const hasMore = childKeys.length > pageSize;
  const pageKeys = hasMore ? childKeys.slice(0, pageSize) : childKeys;
  return {
    blobs: pageKeys.map((childKey) => ({
      key: cleanPrefix ? `${cleanPrefix}/${childKey}` : childKey,
    })),
    cursor: hasMore && pageKeys.length ? pageKeys[pageKeys.length - 1] : null,
  };
}

function buildFirebaseStore(storeName) {
  const database = getFirebaseDatabase();
  const normalizedStoreName = normalizeStoreName(storeName);

  return {
    async get(key) {
      const snapshot = await database.ref(buildStorePath(normalizedStoreName, key)).get();
      if (!snapshot.exists()) return null;
      return unwrapBlobValue(snapshot.val());
    },

    async getWithMetadata(key) {
      const snapshot = await database.ref(buildStorePath(normalizedStoreName, key)).get();
      if (!snapshot.exists()) {
        return null;
      }
      const rawValue = snapshot.val();
      return {
        data: unwrapBlobValue(rawValue),
        etag: "",
        metadata: rawValue?.metadata || null,
      };
    },

    async setJSON(key, value, options = {}) {
      const metadata = options && typeof options === "object" ? options.metadata || null : null;
      await database.ref(buildStorePath(normalizedStoreName, key)).set(wrapBlobValue(value, metadata));
      if (options.onlyIfMatch || options.onlyIfNew) {
        return { modified: true, etag: "", value };
      }
      return value;
    },

    async delete(key) {
      await database.ref(buildStorePath(normalizedStoreName, key)).remove();
      return true;
    },

    async list(options = {}) {
      return listFirebaseEntries(database, normalizedStoreName, options.prefix || "", options);
    },
  };
}

function buildNetlifyStore(storeName) {
  const normalizedStoreName = normalizeStoreName(storeName);
  const config = readNetlifyStoreConfig();
  const store = config.siteID && config.token
    ? getNetlifyStore({
        name: normalizedStoreName,
        siteID: config.siteID,
        token: config.token,
        ...(config.apiURL ? { apiURL: config.apiURL } : {}),
      })
    : getNetlifyStore(normalizedStoreName);

  return {
    async get(key) {
      const payload = await store.get(String(key || ""), { type: "json" });
      return unwrapBlobValue(payload);
    },

    async getWithMetadata(key) {
      const entry = await store.getWithMetadata(String(key || ""), { type: "json" });
      if (!entry) return null;
      return {
        data: unwrapBlobValue(entry.data),
        etag: String(entry.etag || ""),
        metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null,
      };
    },

    async setJSON(key, value, options = {}) {
      const metadata = options && typeof options === "object" ? options.metadata || null : null;
      const writeResult = await store.setJSON(
        String(key || ""),
        wrapBlobValue(value, metadata),
        {
          ...(options.onlyIfMatch ? { onlyIfMatch: options.onlyIfMatch } : {}),
          ...(options.onlyIfNew ? { onlyIfNew: true } : {}),
          ...(metadata ? { metadata } : {}),
        }
      );
      if (options.onlyIfMatch || options.onlyIfNew) {
        return {
          modified: writeResult?.modified !== false,
          etag: String(writeResult?.etag || ""),
          value,
        };
      }
      return value;
    },

    async delete(key) {
      await store.delete(String(key || ""));
      return true;
    },

    async list(options = {}) {
      const listed = await store.list({
        prefix: String(options.prefix || "").trim(),
      });
      return {
        blobs: Array.isArray(listed?.blobs) ? listed.blobs : [],
        cursor: null,
      };
    },
  };
}

function getStore(storeName) {
  if (hasFirebaseStoreConfig()) {
    return buildFirebaseStore(storeName);
  }
  return buildNetlifyStore(storeName);
}

module.exports = {
  BLOB_SENTINEL,
  buildStorePath,
  connectLambda,
  getStore,
  readStoreNamespace,
  unwrapBlobValue,
  wrapBlobValue,
  __test: {
    buildStorePath,
    isBlobNode,
    normalizeStoreName,
    normalizePageSize,
    readStoreNamespace,
    splitKey,
    trimSlashes,
    unwrapBlobValue,
    wrapBlobValue,
  },
};
