const { getStore, connectLambda } = require("../lib/blob-store");
const crypto = require("crypto");
const {
  resolveAuth,
  listKeysByPrefix,
  getStoreClient,
  normalizeUsername,
} = require("../lib/collab");

const STORE_NAME = "bni-linked-alerts";
const CURRENT_KEY = "alerts/current";
const ALERTS_KEY = "alerts/all";
const ALERTS_MAX = 120;
const API_KEY = process.env.BNI_LINKED_KEY;
const REQUIRE_AUTH = process.env.BNI_LINKED_REQUIRE_AUTH !== "0";
const STAFF_ACCESS_CODE = "staff";

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-staff-code, x-collab-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

function getHeader(event, name) {
  const wanted = String(name || "").toLowerCase();
  const headers = event.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return value;
  }
  return undefined;
}

function isAuthorized(event) {
  if (!REQUIRE_AUTH) return true;
  if (!API_KEY) return false;
  const key = getHeader(event, "x-api-key");
  return key === API_KEY;
}

function hasStaffCode(event, body = null) {
  const headerCode = String(getHeader(event, "x-staff-code") || "").trim();
  const bodyCode = String(body?.accessCode || "").trim();
  return headerCode === STAFF_ACCESS_CODE || bodyCode === STAFF_ACCESS_CODE;
}

function authError() {
  if (REQUIRE_AUTH && !API_KEY) {
    return jsonResponse(503, { ok: false, error: "API key is not configured on server" });
  }
  return jsonResponse(401, { ok: false, error: "Unauthorized" });
}

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (Number.isFinite(min) && num < min) return min;
  if (Number.isFinite(max) && num > max) return max;
  return num;
}

function normalizeZonePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  return rawPoints
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const x = clampNumber(point.x, NaN, -1000, 1000);
      const y = clampNumber(point.y, NaN, -1000, 1000);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
      };
    })
    .filter(Boolean);
}

function normalizeCircle(rawCircle, fallback = null) {
  if (!rawCircle || typeof rawCircle !== "object") return null;
  const xPercent = clampNumber(rawCircle.xPercent, fallback?.xPercent ?? NaN, 0, 100);
  const yPercent = clampNumber(rawCircle.yPercent, fallback?.yPercent ?? NaN, 0, 100);
  const gpsX = clampNumber(rawCircle.gpsX, fallback?.gpsX ?? NaN);
  const gpsY = clampNumber(rawCircle.gpsY, fallback?.gpsY ?? NaN);
  const radius = clampNumber(rawCircle.radius, fallback?.radius ?? 2.5, 0.4, 18);

  if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) return null;
  if (!Number.isFinite(gpsX) || !Number.isFinite(gpsY)) return null;

  return {
    xPercent: Number(xPercent.toFixed(4)),
    yPercent: Number(yPercent.toFixed(4)),
    gpsX: Number(gpsX.toFixed(2)),
    gpsY: Number(gpsY.toFixed(2)),
    radius: Number(radius.toFixed(1)),
  };
}

function normalizeCircles(rawCircles, fallbackCircles = []) {
  if (!Array.isArray(rawCircles)) return [];
  const fallback = Array.isArray(fallbackCircles) && fallbackCircles.length ? fallbackCircles[0] : null;
  return rawCircles
    .map((circle) => normalizeCircle(circle, fallback))
    .filter(Boolean);
}

function normalizeStrokeWidth(value, fallback = 0.06) {
  return Number(clampNumber(value, fallback, 0.02, 0.5).toFixed(2));
}

function summarizeCircles(circles) {
  if (!Array.isArray(circles) || !circles.length) return null;
  const minX = Math.min(...circles.map((circle) => circle.xPercent - circle.radius));
  const maxX = Math.max(...circles.map((circle) => circle.xPercent + circle.radius));
  const minY = Math.min(...circles.map((circle) => circle.yPercent - circle.radius));
  const maxY = Math.max(...circles.map((circle) => circle.yPercent + circle.radius));
  const minGpsX = Math.min(...circles.map((circle) => circle.gpsX));
  const maxGpsX = Math.max(...circles.map((circle) => circle.gpsX));
  const minGpsY = Math.min(...circles.map((circle) => circle.gpsY));
  const maxGpsY = Math.max(...circles.map((circle) => circle.gpsY));
  const radius = Math.max(...circles.map((circle) => circle.radius));

  return {
    xPercent: Number((((minX + maxX) / 2)).toFixed(4)),
    yPercent: Number((((minY + maxY) / 2)).toFixed(4)),
    gpsX: Number((((minGpsX + maxGpsX) / 2)).toFixed(2)),
    gpsY: Number((((minGpsY + maxGpsY) / 2)).toFixed(2)),
    radius: Number(radius.toFixed(1)),
  };
}

function normalizeAllowedUsers(rawUsers) {
  if (!Array.isArray(rawUsers)) return [];
  const seen = new Set();
  const clean = [];
  rawUsers.forEach((value) => {
    const normalized = normalizeUsername(value);
    if (!normalized.ok) return;
    const username = normalized.username;
    if (seen.has(username)) return;
    seen.add(username);
    clean.push(username);
  });
  return clean;
}

function normalizeStartsAt(value, fallback = "") {
  const raw = String(value ?? fallback ?? "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Date de diffusion invalide.");
  }
  return date.toISOString();
}

function normalizeShowBeforeStart(value, startsAt, fallback = false) {
  if (!String(startsAt || "").trim()) return false;
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return Boolean(fallback);
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return Boolean(fallback);
}

function isAlertStarted(alert) {
  const startsAt = String(alert?.startsAt || "").trim();
  if (!startsAt) return true;
  const timestamp = Date.parse(startsAt);
  if (!Number.isFinite(timestamp)) return true;
  return timestamp <= Date.now();
}

function timeValue(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function alertDisplayTimeValue(alert) {
  if (!alert || typeof alert !== "object") return 0;
  return timeValue(alert.startsAt || alert.updatedAt || alert.createdAt || "");
}

function sortAlerts(alerts) {
  return (Array.isArray(alerts) ? alerts : [])
    .filter((alert) => alert && typeof alert === "object")
    .sort((a, b) => {
      const startDelta = alertDisplayTimeValue(b) - alertDisplayTimeValue(a);
      if (startDelta !== 0) return startDelta;
      const updateDelta = timeValue(b?.updatedAt || b?.createdAt || "") - timeValue(a?.updatedAt || a?.createdAt || "");
      if (updateDelta !== 0) return updateDelta;
      return String(a?.title || "").localeCompare(String(b?.title || ""));
    })
    .slice(0, ALERTS_MAX);
}

function normalizeAlert(raw, previous = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const title = String(source.title || "").trim();
  const description = String(source.description || "").trim();
  const gpsX = clampNumber(source.gpsX, NaN);
  const gpsY = clampNumber(source.gpsY, NaN);
  const xPercent = clampNumber(source.xPercent, NaN, -1000, 1000);
  const yPercent = clampNumber(source.yPercent, NaN, -1000, 1000);
  const radius = clampNumber(source.radius, previous?.radius || 2.5, 0.4, 18);
  const strokeWidth = normalizeStrokeWidth(source.strokeWidth, previous?.strokeWidth || 0.06);
  const zonePoints = normalizeZonePoints(source.zonePoints);
  const shapeType = source.shapeType === "zone" && zonePoints.length >= 3 ? "zone" : "circle";
  const visibilityMode = source.visibilityMode === "whitelist" ? "whitelist" : "all";
  const allowedUsers = normalizeAllowedUsers(source.allowedUsers);
  const startsAt = normalizeStartsAt(
    Object.prototype.hasOwnProperty.call(source, "startsAt") ? source.startsAt : previous?.startsAt,
    previous?.startsAt || ""
  );
  const showBeforeStart = normalizeShowBeforeStart(
    Object.prototype.hasOwnProperty.call(source, "showBeforeStart") ? source.showBeforeStart : previous?.showBeforeStart,
    startsAt,
    previous?.showBeforeStart === true
  );
  const previousCircles = normalizeCircles(previous?.circles || []);
  const fallbackCircle = normalizeCircle(source, previousCircles[0] || previous);
  const circles = normalizeCircles(source.circles, previousCircles);
  if (!circles.length && fallbackCircle) {
    circles.push(fallbackCircle);
  }

  if (!title) throw new Error("Titre requis.");
  if (!description) throw new Error("Description requise.");

  const now = new Date().toISOString();
  if (shapeType === "zone") {
    if (!Number.isFinite(gpsX) || !Number.isFinite(gpsY)) {
      throw new Error("Coordonnees GPS invalides.");
    }
    if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
      throw new Error("Position carte invalide.");
    }

    return {
      id: String(previous?.id || source.id || `alert_${crypto.randomUUID()}`),
      title,
      description,
      gpsX,
      gpsY,
      xPercent,
      yPercent,
      radius,
      strokeWidth,
      shapeType,
      zonePoints,
      circles: [],
      activeCircleIndex: -1,
      visibilityMode,
      allowedUsers: visibilityMode === "whitelist" ? allowedUsers : [],
      active: source.active !== false,
      startsAt,
      showBeforeStart,
      createdAt: String(previous?.createdAt || now),
      updatedAt: now,
    };
  }

  if (!circles.length) {
    throw new Error("Au moins un cercle est requis.");
  }

  const summary = summarizeCircles(circles);
  const rawActiveIndex = Number(source.activeCircleIndex);
  const previousActiveIndex = Number(previous?.activeCircleIndex);
  const activeCircleIndex = Number.isInteger(rawActiveIndex)
    ? Math.min(circles.length - 1, Math.max(0, rawActiveIndex))
    : Math.min(
        circles.length - 1,
        Math.max(0, Number.isInteger(previousActiveIndex) ? previousActiveIndex : (circles.length - 1))
      );

  return {
    id: String(previous?.id || source.id || `alert_${crypto.randomUUID()}`),
    title,
    description,
    gpsX: Number(summary.gpsX),
    gpsY: Number(summary.gpsY),
    xPercent: Number(summary.xPercent),
    yPercent: Number(summary.yPercent),
    radius: Number(summary.radius),
    strokeWidth,
    shapeType: "circle",
    zonePoints: [],
    circles,
    activeCircleIndex,
    visibilityMode,
    allowedUsers: visibilityMode === "whitelist" ? allowedUsers : [],
    active: source.active !== false,
    startsAt,
    showBeforeStart,
    createdAt: String(previous?.createdAt || now),
    updatedAt: now,
  };
}

async function getLegacyCurrentAlert(store) {
  const value = await store.get(CURRENT_KEY, { type: "json" }).catch(() => null);
  if (!value || typeof value !== "object") return null;
  return value;
}

async function getAlertList(store) {
  const value = await store.get(ALERTS_KEY, { type: "json" }).catch(() => null);
  const stored = Array.isArray(value?.alerts) ? value.alerts : (Array.isArray(value) ? value : []);
  if (stored.length) return sortAlerts(stored);

  const legacy = await getLegacyCurrentAlert(store);
  return legacy ? [legacy] : [];
}

function findAlertById(alerts, id) {
  const targetId = String(id || "").trim();
  if (!targetId) return null;
  return (Array.isArray(alerts) ? alerts : []).find((alert) => String(alert?.id || "") === targetId) || null;
}

function pickPublicAlert(alerts, viewer = null, preferredId = "") {
  const visible = sortAlerts(alerts).filter((alert) => isViewerAllowed(alert, viewer));
  if (preferredId) {
    return visible.find((alert) => String(alert.id || "") === String(preferredId)) || null;
  }
  return visible[0] || null;
}

function sortTimelineAlerts(alerts) {
  return [...(Array.isArray(alerts) ? alerts : [])].sort((a, b) => {
    const aScheduled = !isAlertStarted(a);
    const bScheduled = !isAlertStarted(b);
    if (aScheduled !== bScheduled) return aScheduled ? 1 : -1;
    if (aScheduled && bScheduled) {
      const delta = timeValue(a?.startsAt || "") - timeValue(b?.startsAt || "");
      if (delta !== 0) return delta;
    }
    const displayDelta = alertDisplayTimeValue(b) - alertDisplayTimeValue(a);
    if (displayDelta !== 0) return displayDelta;
    return String(a?.title || "").localeCompare(String(b?.title || ""));
  });
}

function listPublicAlerts(alerts, viewer = null, options = {}) {
  const includeScheduled = options?.includeScheduled === true;
  const source = includeScheduled ? sortTimelineAlerts(alerts) : sortAlerts(alerts);
  return source
    .map((alert) => toPublicAlert(alert, viewer, { includeScheduled }))
    .filter(Boolean);
}

async function saveAlertList(store, alerts) {
  const nextAlerts = sortAlerts(alerts);
  await store.setJSON(ALERTS_KEY, nextAlerts);

  const publicAlert = pickPublicAlert(nextAlerts, null);
  if (publicAlert) {
    await store.setJSON(CURRENT_KEY, publicAlert);
  } else {
    await store.delete(CURRENT_KEY).catch(() => null);
  }

  return nextAlerts;
}

function isViewerAllowed(alert, viewer, options = {}) {
  if (!alert || typeof alert !== "object" || !alert.active) return false;
  if (!isAlertStarted(alert) && alert.showBeforeStart !== true) return false;
  if (String(alert.visibilityMode || "all") !== "whitelist") return true;
  const normalized = normalizeUsername(viewer?.username || "");
  if (!normalized.ok) return false;
  const allow = new Set(normalizeAllowedUsers(alert.allowedUsers));
  return allow.has(normalized.username);
}

function toPublicAlert(alert, viewer = null, options = {}) {
  if (!alert || typeof alert !== "object") return null;
  if (!isViewerAllowed(alert, viewer, options)) return null;
  return {
    id: String(alert.id || ""),
    title: String(alert.title || ""),
    description: String(alert.description || ""),
    gpsX: Number(alert.gpsX),
    gpsY: Number(alert.gpsY),
    xPercent: Number(alert.xPercent),
    yPercent: Number(alert.yPercent),
    radius: Number(alert.radius || 2.5),
    strokeWidth: normalizeStrokeWidth(alert.strokeWidth, 0.06),
    shapeType: String(alert.shapeType || "circle"),
    zonePoints: Array.isArray(alert.zonePoints) ? alert.zonePoints : [],
    circles: normalizeCircles(alert.circles || []),
    activeCircleIndex: Number.isInteger(Number(alert.activeCircleIndex))
      ? Number(alert.activeCircleIndex)
      : -1,
    visibilityMode: String(alert.visibilityMode || "all"),
    active: true,
    scheduled: !isAlertStarted(alert),
    startsAt: String(alert.startsAt || ""),
    showBeforeStart: alert.showBeforeStart === true,
    createdAt: String(alert.createdAt || ""),
    updatedAt: String(alert.updatedAt || ""),
  };
}

async function resolveViewer(event) {
  const auth = await resolveAuth(event).catch(() => null);
  if (!auth || !auth.ok || !auth.user) return null;
  return auth.user;
}

async function listKnownUsers(query = "") {
  const prefix = "users/by-name/";
  const store = getStoreClient();
  const keys = await listKeysByPrefix(store, prefix, 400).catch(() => []);
  const lowered = String(query || "").trim().toLowerCase();
  return keys
    .map((key) => String(key || "").slice(prefix.length))
    .filter(Boolean)
    .filter((username) => !lowered || username.includes(lowered))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 40);
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(204, { ok: true });
  }

  const store = getStore(STORE_NAME);

  if (event.httpMethod === "GET") {
    const id = String(event.queryStringParameters?.id || "").trim();
    const includeScheduled = String(event.queryStringParameters?.includeScheduled || "").trim() === "1";
    const alerts = await getAlertList(store);
    const viewer = await resolveViewer(event);
    const publicAlerts = listPublicAlerts(alerts, viewer, { includeScheduled });
    const publicAlert = id
      ? (publicAlerts.find((alert) => String(alert?.id || "") === id) || null)
      : (publicAlerts[0] || null);

    if (id) {
      if (!publicAlert || String(publicAlert.id) !== id) {
        return jsonResponse(200, { ok: true, alert: null, alerts: publicAlerts });
      }
      return jsonResponse(200, { ok: true, alert: publicAlert, alerts: publicAlerts });
    }

    return jsonResponse(200, { ok: true, alert: publicAlert, alerts: publicAlerts });
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

  if (!(isAuthorized(event) || hasStaffCode(event, body))) {
    return authError();
  }

  const action = String(body.action || "").toLowerCase();

  if (action === "get-admin") {
    const alerts = await getAlertList(store);
    const requestedId = String(body.id || "").trim();
    const alert = requestedId ? findAlertById(alerts, requestedId) : (alerts[0] || null);
    return jsonResponse(200, { ok: true, alert, alerts });
  }

  if (action === "list-admin") {
    const alerts = await getAlertList(store);
    return jsonResponse(200, { ok: true, alerts, alert: alerts[0] || null });
  }

  if (action === "list_users") {
    const query = String(body.query || "").trim().toLowerCase();
    const users = await listKnownUsers(query);
    return jsonResponse(200, { ok: true, users });
  }

  if (action === "delete") {
    const targetId = String(body.id || "").trim();
    const previousAlerts = await getAlertList(store);
    if (!previousAlerts.length) {
      await store.delete(CURRENT_KEY).catch(() => null);
      await store.delete(ALERTS_KEY).catch(() => null);
      return jsonResponse(200, { ok: true, alert: null, alerts: [] });
    }

    const resolvedId = targetId || String(previousAlerts[0]?.id || "").trim();
    const nextAlerts = previousAlerts.filter((alert) => String(alert?.id || "") !== resolvedId);

    if (!nextAlerts.length) {
      await store.delete(CURRENT_KEY).catch(() => null);
      await store.delete(ALERTS_KEY).catch(() => null);
      return jsonResponse(200, { ok: true, alert: null, alerts: [] });
    }

    const savedAlerts = await saveAlertList(store, nextAlerts);
    return jsonResponse(200, {
      ok: true,
      alert: savedAlerts[0] || null,
      alerts: savedAlerts,
    });
  }

  if (action === "upsert") {
    try {
      const previousAlerts = await getAlertList(store);
      const requestedId = String(body?.alert?.id || "").trim();
      const previous = requestedId ? findAlertById(previousAlerts, requestedId) : null;
      const nextAlert = normalizeAlert(body.alert, previous);
      const remainingAlerts = previousAlerts.filter((alert) => String(alert?.id || "") !== String(nextAlert.id || ""));
      const savedAlerts = await saveAlertList(store, [nextAlert, ...remainingAlerts]);
      return jsonResponse(200, { ok: true, alert: nextAlert, alerts: savedAlerts });
    } catch (error) {
      return jsonResponse(400, { ok: false, error: error.message || "Invalid alert" });
    }
  }

  return jsonResponse(400, { ok: false, error: "Invalid action" });
};

exports.__test = {
  normalizeAlert,
  listPublicAlerts,
  isViewerAllowed,
  toPublicAlert,
};
