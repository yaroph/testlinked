const crypto = require("crypto");
const { getStore } = require("./blob-store");

const STORE_NAME = "bni-linked-webhook-detection";
const DETECTION_PREFIX = "detections";
const REVERSED_TS_BASE = 9999999999999;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DUPLICATE_SCAN_LIMIT = 40;

function sanitizeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function sanitizeIdentifier(value, fallback = "") {
  const text = sanitizeText(value, fallback);
  return text || sanitizeText(fallback);
}

function sanitizePlayer(value) {
  const player = sanitizeText(value);
  if (!player) {
    throw new Error('Champ "player" manquant.');
  }
  return player.slice(0, 120);
}

function sanitizeType(value) {
  const rawType = sanitizeText(value, "detection")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return rawType || "detection";
}

function sanitizeCoordinate(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Champ "${fieldName}" invalide.`);
  }
  return Number(num.toFixed(3));
}

function normalizeTimestampInput(value) {
  if (value === null || value === undefined || value === "") {
    throw new Error('Champ "timestamp" manquant.');
  }

  const rawNum = Number(value);
  if (!Number.isFinite(rawNum) || rawNum <= 0) {
    throw new Error('Champ "timestamp" invalide.');
  }

  const timestampMs = rawNum < 1e12 ? rawNum * 1000 : rawNum;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new Error('Champ "timestamp" invalide.');
  }

  return {
    original: rawNum,
    timestampMs: Math.round(timestampMs),
    timestampSeconds: Math.floor(timestampMs / 1000),
  };
}

function toIsoString(timestampMs) {
  const date = new Date(Number(timestampMs || 0));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Date invalide.");
  }
  return date.toISOString();
}

function sanitizeLimit(rawValue) {
  const limit = Number.parseInt(rawValue || `${DEFAULT_LIST_LIMIT}`, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, limit);
}

function makeDetectionFingerprint(detection) {
  const player = sanitizeText(detection?.player).toLowerCase();
  const type = sanitizeType(detection?.type);
  const x = Number(Number(detection?.x || 0).toFixed(3));
  const y = Number(Number(detection?.y || 0).toFixed(3));
  const z = Number(Number(detection?.z || 0).toFixed(3));
  const timestampMs = Number(detection?.timestampMs || 0);
  return [player, type, x, y, z, timestampMs].join("|");
}

function buildDetectionKey(receivedAtMs, detectionId) {
  const safeTimestamp = Math.max(0, Math.min(REVERSED_TS_BASE, Number(receivedAtMs || 0)));
  const reversed = String(REVERSED_TS_BASE - safeTimestamp).padStart(13, "0");
  return `${DETECTION_PREFIX}/${reversed}_${sanitizeIdentifier(detectionId, crypto.randomUUID())}`;
}

function normalizeStoredDetection(rawValue) {
  if (!rawValue || typeof rawValue !== "object") return null;

  const player = sanitizeText(rawValue.player);
  const type = sanitizeType(rawValue.type);
  const id = sanitizeText(rawValue.id);
  const receivedAt = sanitizeText(rawValue.receivedAt);
  const detectedAt = sanitizeText(rawValue.detectedAt);
  const timestampMs = Number(rawValue.timestampMs || 0);
  const receivedAtMs = Number(rawValue.receivedAtMs || Date.parse(receivedAt));
  const x = Number(rawValue.x);
  const y = Number(rawValue.y);
  const z = Number(rawValue.z);

  if (!id || !player || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  if (!Number.isFinite(timestampMs) || !Number.isFinite(receivedAtMs)) {
    return null;
  }

  return {
    id,
    player,
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    z: Number(z.toFixed(3)),
    type,
    timestamp: Number(rawValue.timestamp || Math.floor(timestampMs / 1000)),
    timestampMs,
    detectedAt: detectedAt || toIsoString(timestampMs),
    receivedAt: receivedAt || toIsoString(receivedAtMs),
    receivedAtMs,
    fingerprint: sanitizeText(rawValue.fingerprint) || makeDetectionFingerprint(rawValue),
  };
}

function normalizeIncomingDetection(rawPayload, options = {}) {
  const source = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const receivedAtMs = Number(options.receivedAtMs || Date.now());
  const receivedAt = toIsoString(receivedAtMs);
  const timestamp = normalizeTimestampInput(source.timestamp);

  const detection = {
    id: sanitizeIdentifier(source.id, crypto.randomUUID()),
    player: sanitizePlayer(source.player),
    x: sanitizeCoordinate(source.x, "x"),
    y: sanitizeCoordinate(source.y, "y"),
    z: sanitizeCoordinate(source.z, "z"),
    type: sanitizeType(source.type),
    timestamp: timestamp.timestampSeconds,
    timestampMs: timestamp.timestampMs,
    detectedAt: toIsoString(timestamp.timestampMs),
    receivedAt,
    receivedAtMs,
  };
  detection.fingerprint = makeDetectionFingerprint(detection);
  return detection;
}

async function readDetection(store, key) {
  const data = await store.get(key);
  return normalizeStoredDetection(data);
}

async function listDetections(store, options = {}) {
  const limit = sanitizeLimit(options.limit);
  const listed = await store.list({ prefix: DETECTION_PREFIX });
  const blobs = Array.isArray(listed?.blobs) ? listed.blobs : [];
  const keys = blobs
    .map((entry) => sanitizeText(entry?.key))
    .filter((key) => key.startsWith(`${DETECTION_PREFIX}/`))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);

  const records = await Promise.all(keys.map((key) => readDetection(store, key).catch(() => null)));
  return records
    .filter(Boolean)
    .sort((left, right) => Number(right.receivedAtMs || 0) - Number(left.receivedAtMs || 0));
}

async function findDuplicateDetection(store, detection, options = {}) {
  const recent = await listDetections(store, {
    limit: Number(options.limit || DUPLICATE_SCAN_LIMIT),
  });
  const fingerprint = makeDetectionFingerprint(detection);
  return recent.find((entry) => String(entry?.fingerprint || "") === fingerprint) || null;
}

async function saveDetection(store, rawPayload, options = {}) {
  const detection = normalizeIncomingDetection(rawPayload, options);
  const duplicate = await findDuplicateDetection(store, detection);
  if (duplicate) {
    return {
      ok: true,
      duplicate: true,
      item: duplicate,
      key: null,
    };
  }

  const key = buildDetectionKey(detection.receivedAtMs, detection.id);
  await store.setJSON(key, detection, {
    metadata: {
      player: detection.player,
      type: detection.type,
      receivedAtMs: detection.receivedAtMs,
      timestampMs: detection.timestampMs,
      fingerprint: detection.fingerprint,
    },
  });

  return {
    ok: true,
    duplicate: false,
    item: detection,
    key,
  };
}

function getWebhookDetectionStore() {
  return getStore(STORE_NAME);
}

module.exports = {
  DEFAULT_LIST_LIMIT,
  DETECTION_PREFIX,
  DUPLICATE_SCAN_LIMIT,
  MAX_LIST_LIMIT,
  STORE_NAME,
  buildDetectionKey,
  findDuplicateDetection,
  getWebhookDetectionStore,
  listDetections,
  normalizeIncomingDetection,
  normalizeStoredDetection,
  sanitizeLimit,
  saveDetection,
  __test: {
    buildDetectionKey,
    makeDetectionFingerprint,
    normalizeIncomingDetection,
    normalizeStoredDetection,
    normalizeTimestampInput,
    sanitizeLimit,
  },
};
