const { getFirebaseApp, getFirebaseDatabase } = require("./firebase-admin");

const ROOT_PREFIX = "stores";
const BLOB_SENTINEL = "__bni_blob";
const DEFAULT_LIST_PAGE_SIZE = 400;
const MAX_LIST_PAGE_SIZE = 1000;

let cachedAccessToken = {
  value: "",
  expiresAt: 0,
};

function connectLambda() {}

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

function readDatabaseUrl() {
  const app = getFirebaseApp();
  const databaseURL = String(app?.options?.databaseURL || "").trim();
  if (!databaseURL) {
    throw new Error("Firebase Database URL manquante. Configure FIREBASE_DATABASE_URL.");
  }
  return databaseURL.replace(/\/+$/, "");
}

async function getDatabaseAccessToken() {
  const now = Date.now();
  if (cachedAccessToken.value && now < (cachedAccessToken.expiresAt - 60 * 1000)) {
    return cachedAccessToken.value;
  }

  const app = getFirebaseApp();
  const credential = app?.options?.credential;
  if (!credential || typeof credential.getAccessToken !== "function") {
    throw new Error("Credential Firebase invalide pour les requetes RTDB.");
  }

  const token = await credential.getAccessToken();
  cachedAccessToken = {
    value: String(token?.access_token || ""),
    expiresAt: Number(token?.expiry_date || 0) || 0,
  };
  if (!cachedAccessToken.value) {
    throw new Error("Impossible d'obtenir un token Firebase RTDB.");
  }
  return cachedAccessToken.value;
}

function buildRestUrl(path, query = null) {
  const databaseURL = readDatabaseUrl();
  const encodedPath = encodeRestPath(path);
  const baseUrl = encodedPath ? `${databaseURL}/${encodedPath}.json` : `${databaseURL}/.json`;
  const queryText = query ? String(query) : "";
  return queryText ? `${baseUrl}?${queryText}` : baseUrl;
}

async function fetchRestJson(path, query = null) {
  const accessToken = await getDatabaseAccessToken();
  const response = await fetch(buildRestUrl(path, query), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Firebase RTDB list failed (${response.status}).`);
  }
  return response.json();
}

function normalizePageSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_LIST_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, Math.floor(size)));
}

async function listDirectStoreEntries(storeName, rawPrefix = "", options = {}) {
  const cleanPrefix = trimSlashes(rawPrefix);
  const cursor = String(options.cursor || "").trim();
  const pageSize = normalizePageSize(options.limit);
  const query = new URLSearchParams();
  query.set("shallow", "true");

  const payload = await fetchRestJson(buildStorePath(storeName, cleanPrefix), query.toString());
  if (!payload || typeof payload !== "object") {
    return { blobs: [], cursor: null };
  }

  const payloadKeys = Object.keys(payload);
  if (payloadKeys.includes(BLOB_SENTINEL)) {
    return {
      blobs: cleanPrefix ? [{ key: cleanPrefix }] : [],
      cursor: null,
    };
  }

  let childKeys = payloadKeys
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

function getStore(storeName) {
  const database = getFirebaseDatabase();
  const normalizedStoreName = normalizeStoreName(storeName);

  return {
    async get(key) {
      const snapshot = await database.ref(buildStorePath(normalizedStoreName, key)).get();
      if (!snapshot.exists()) return null;
      return unwrapBlobValue(snapshot.val());
    },

    async setJSON(key, value, options = {}) {
      const metadata = options && typeof options === "object" ? options.metadata || null : null;
      await database.ref(buildStorePath(normalizedStoreName, key)).set(wrapBlobValue(value, metadata));
      return value;
    },

    async delete(key) {
      await database.ref(buildStorePath(normalizedStoreName, key)).remove();
      return true;
    },

    async list(options = {}) {
      return listDirectStoreEntries(normalizedStoreName, options.prefix || "", options);
    },
  };
}

module.exports = {
  BLOB_SENTINEL,
  connectLambda,
  getStore,
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
