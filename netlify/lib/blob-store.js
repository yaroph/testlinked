const { getFirebaseDatabase } = require("./firebase-admin");

const ROOT_PREFIX = "stores";
const BLOB_SENTINEL = "__bni_blob";

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

function flattenBlobTree(value, prefix = "") {
  if (isBlobNode(value)) {
    return prefix ? [{ key: prefix }] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const entries = [];
  for (const [rawKey, childValue] of Object.entries(value)) {
    const childKey = String(rawKey || "").trim();
    if (!childKey) continue;
    const nextPrefix = prefix ? `${prefix}/${childKey}` : childKey;
    entries.push(...flattenBlobTree(childValue, nextPrefix));
  }
  return entries;
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
      const prefix = String(options.prefix || "").trim().replace(/\/+$/, "");
      const ref = database.ref(buildStorePath(normalizedStoreName, prefix));
      const snapshot = await ref.get();
      if (!snapshot.exists()) {
        return { blobs: [], cursor: null };
      }

      const baseValue = snapshot.val();
      const blobs = flattenBlobTree(baseValue, prefix);
      blobs.sort((left, right) => String(left.key || "").localeCompare(String(right.key || "")));
      return {
        blobs,
        cursor: null,
      };
    },
  };
}

module.exports = {
  BLOB_SENTINEL,
  connectLambda,
  getStore,
  __test: {
    buildStorePath,
    flattenBlobTree,
    isBlobNode,
    normalizeStoreName,
    readStoreNamespace,
    splitKey,
    unwrapBlobValue,
    wrapBlobValue,
  },
};
