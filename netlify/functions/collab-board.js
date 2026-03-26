const {
  connectLambda,
  jsonResponse,
  preflightResponse,
  errorResponse,
  readBody,
  normalizeUsername,
  normalizeTitle,
  normalizePage,
  safeUser,
  nowIso,
  newId,
  resolveAuth,
  listKeysByPrefix,
  getUserBoardIndex,
  setUserBoardIndex,
  addUserBoardRef,
  removeUserBoardRef,
  boardKey,
  getUserByUsername,
  getUserById,
  getRoleForUser,
  canEditBoard,
  sanitizeRole,
  withMember,
  withoutMember,
  boardSummary,
  ROLE_OWNER,
  ROLE_EDITOR,
} = require("../lib/collab");

async function loadBoard(store, boardId) {
  if (!boardId) return null;
  return store.get(boardKey(boardId), { type: "json" });
}

async function saveBoard(store, board) {
  return store.setJSON(boardKey(board.id), board);
}

function validatePointBoardData(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) return false;
  return true;
}

function validateMapBoardData(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.groups)) return false;
  if (data.tacticalLinks !== undefined && !Array.isArray(data.tacticalLinks)) return false;
  return true;
}

function validateBoardData(data, page) {
  const normalizedPage = normalizePage(page);
  if (normalizedPage === "map") return validateMapBoardData(data);
  return validatePointBoardData(data);
}

const PRESENCE_STALE_MS = 15000;
const PRESENCE_MAX_ITEMS = 96;
const SESSION_ACTIVE_MS = 35000;
const SESSION_SCAN_MAX = 400;
const BOARD_ACTIVITY_MAX = 40;
const BOARD_EDIT_LOCK_TTL_MS = Math.max(
  45000,
  Number(
    process.env.BNI_BOARD_EDIT_LOCK_TTL_MS ||
    process.env.BOARD_EDIT_LOCK_TTL_MS ||
    2 * 60 * 1000
  ) || (2 * 60 * 1000)
);
const BOARD_EDIT_LOCK_STALE_GRACE_MS = 15000;
const COLLAB_NODE_FIELDS = [
  "name",
  "type",
  "color",
  "manualColor",
  "personStatus",
  "num",
  "accountNumber",
  "citizenNumber",
  "description",
  "notes",
  "x",
  "y",
  "fixed",
  "linkedMapPointId",
];
const COLLAB_LINK_FIELDS = ["source", "target", "kind"];
const MAP_GROUP_PALETTE = ["#73fbf7", "#ff6b81", "#ffd400", "#ff922b", "#a9e34b"];

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return fallback;
  }
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Math.abs(Number(count) || 0) > 1 ? plural : singular;
}

function timeValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortById(list) {
  return [...list].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
}

function normalizeMetaForCompare(meta) {
  const source = meta && typeof meta === "object" ? { ...meta } : {};
  if (Object.prototype.hasOwnProperty.call(source, "date")) {
    source.date = "";
  }
  return source;
}

function mapPairKey(a, b) {
  const x = String(a ?? "");
  const y = String(b ?? "");
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function clampFiniteNumber(value, fallback, min = null, max = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (Number.isFinite(min) && num < min) return min;
  if (Number.isFinite(max) && num > max) return max;
  return num;
}

function readPresenceFlag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (!clean) return false;
    if (["0", "false", "off", "no"].includes(clean)) return false;
    return true;
  }
  return Boolean(value);
}

function normalizeLegacyKey(value, fallback = "") {
  return String(value || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUsernameQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24);
}

function slugifyToken(value, fallback = "item") {
  const safe = normalizeLegacyKey(value, fallback)
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe || fallback;
}

function makeLegacyId(prefix, token, occurrence = 0) {
  const base = slugifyToken(token, prefix);
  return occurrence > 0
    ? `${prefix}_legacy_${base}_${occurrence + 1}`
    : `${prefix}_legacy_${base}`;
}

function ensureUniqueId(preferredId, usedIds, buildFallbackId) {
  let nextId = String(preferredId || "").trim();
  if (nextId && !usedIds.has(nextId)) {
    usedIds.add(nextId);
    return nextId;
  }

  let attempt = 0;
  do {
    nextId = String(buildFallbackId(attempt) || "").trim();
    attempt += 1;
  } while (!nextId || usedIds.has(nextId));

  usedIds.add(nextId);
  return nextId;
}

function normalizeMapZoneStyle(rawStyle) {
  const style = rawStyle && typeof rawStyle === "object" ? rawStyle : {};
  return {
    width: clampFiniteNumber(style.width, 2, 1, 12),
    style: ["solid", "dashed", "dotted"].includes(style.style) ? style.style : "solid",
  };
}

function normalizeMapPoint(rawPoint, fallbackIndex = 0, options = {}) {
  if (!rawPoint || typeof rawPoint !== "object") return null;
  const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
  const pointScope = String(options.scopeKey || `group-${fallbackIndex + 1}`);
  const pointKey = normalizeLegacyKey(rawPoint.name || "", `point-${fallbackIndex + 1}`);
  const pointId = ensureUniqueId(
    rawPoint.id,
    usedIds,
    (attempt) => makeLegacyId("mp", `${pointScope}-${pointKey || `point-${fallbackIndex + 1}`}`, attempt)
  );

  return {
    id: pointId,
    name: String(rawPoint.name || `Point ${fallbackIndex + 1}`),
    x: clampFiniteNumber(rawPoint.x, 50),
    y: clampFiniteNumber(rawPoint.y, 50),
    type: String(rawPoint.type || ""),
    iconType: String(rawPoint.iconType || "DEFAULT"),
    notes: String(rawPoint.notes || ""),
    status: String(rawPoint.status || "ACTIVE"),
  };
}

function normalizeMapZone(rawZone, fallbackIndex = 0, options = {}) {
  if (!rawZone || typeof rawZone !== "object") return null;
  const usedIds = options.usedIds instanceof Set ? options.usedIds : new Set();
  const zoneScope = String(options.scopeKey || `group-${fallbackIndex + 1}`);
  const zoneKey = normalizeLegacyKey(rawZone.name || "", `zone-${fallbackIndex + 1}`);
  const zoneId = ensureUniqueId(
    rawZone.id,
    usedIds,
    (attempt) => makeLegacyId("mz", `${zoneScope}-${zoneKey || `zone-${fallbackIndex + 1}`}`, attempt)
  );
  const zoneName = String(rawZone.name || `Zone ${fallbackIndex + 1}`);
  const style = normalizeMapZoneStyle(rawZone.style);

  if (rawZone.type === "CIRCLE") {
    return {
      id: zoneId,
      name: zoneName,
      type: "CIRCLE",
      cx: clampFiniteNumber(rawZone.cx, 50),
      cy: clampFiniteNumber(rawZone.cy, 50),
      r: clampFiniteNumber(rawZone.r, 1, 0.1),
      style,
    };
  }

  const points = (Array.isArray(rawZone.points) ? rawZone.points : [])
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    })
    .filter(Boolean);

  if (points.length < 3) return null;

  return {
    id: zoneId,
    name: zoneName,
    type: "POLYGON",
    points,
    style,
  };
}

function normalizeMapGroup(rawGroup, groupIndex = 0) {
  if (!rawGroup || typeof rawGroup !== "object") rawGroup = {};
  const groupOccurrences = normalizeMapGroup.groupOccurrences instanceof Map
    ? normalizeMapGroup.groupOccurrences
    : new Map();
  const usedGroupIds = normalizeMapGroup.usedGroupIds instanceof Set
    ? normalizeMapGroup.usedGroupIds
    : new Set();
  const usedPointIds = normalizeMapGroup.usedPointIds instanceof Set
    ? normalizeMapGroup.usedPointIds
    : new Set();
  const usedZoneIds = normalizeMapGroup.usedZoneIds instanceof Set
    ? normalizeMapGroup.usedZoneIds
    : new Set();
  const legacyKey = normalizeLegacyKey(rawGroup.name || "", `group-${groupIndex + 1}`);
  const occurrence = groupOccurrences.get(legacyKey) || 0;
  groupOccurrences.set(legacyKey, occurrence + 1);
  const groupId = ensureUniqueId(
    rawGroup.id,
    usedGroupIds,
    (attempt) => makeLegacyId("grp", legacyKey || `group-${groupIndex + 1}`, occurrence + attempt)
  );

  return {
    id: groupId,
    name: String(rawGroup.name || `GROUPE ${groupIndex + 1}`),
    color: String(rawGroup.color || MAP_GROUP_PALETTE[groupIndex % MAP_GROUP_PALETTE.length]),
    visible: rawGroup.visible !== false,
    points: (Array.isArray(rawGroup.points) ? rawGroup.points : [])
      .map((point, pointIndex) => normalizeMapPoint(point, pointIndex, {
        usedIds: usedPointIds,
        scopeKey: groupId,
      }))
      .filter(Boolean),
    zones: (Array.isArray(rawGroup.zones) ? rawGroup.zones : [])
      .map((zone, zoneIndex) => normalizeMapZone(zone, zoneIndex, {
        usedIds: usedZoneIds,
        scopeKey: groupId,
      }))
      .filter(Boolean),
  };
}

function normalizeMapLink(rawLink, fallbackIndex = 0) {
  if (!rawLink || typeof rawLink !== "object") return null;
  const from = String(rawLink.from || rawLink.source || "");
  const to = String(rawLink.to || rawLink.target || "");
  if (!from || !to || from === to) return null;
  const usedIds = normalizeMapLink.usedIds instanceof Set ? normalizeMapLink.usedIds : new Set();
  return {
    id: ensureUniqueId(
      rawLink.id,
      usedIds,
      (attempt) => makeLegacyId("ml", `${mapPairKey(from, to)}-${fallbackIndex + 1}`, attempt)
    ),
    from,
    to,
    color: rawLink.color || null,
    type: String(rawLink.type || "Standard"),
  };
}

function normalizeMapBoardPayload(data) {
  const raw = data && typeof data === "object" ? data : {};
  normalizeMapGroup.groupOccurrences = new Map();
  normalizeMapGroup.usedGroupIds = new Set();
  normalizeMapGroup.usedPointIds = new Set();
  normalizeMapGroup.usedZoneIds = new Set();
  normalizeMapLink.usedIds = new Set();
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .map((group, groupIndex) => normalizeMapGroup(group, groupIndex))
    .filter(Boolean);

  const pointIds = new Set();
  groups.forEach((group) => {
    (group.points || []).forEach((point) => {
      const pointId = String(point?.id || "");
      if (pointId) pointIds.add(pointId);
    });
  });

  const dedupedLinks = new Map();
  (Array.isArray(raw.tacticalLinks) ? raw.tacticalLinks : []).forEach((link, linkIndex) => {
    const normalized = normalizeMapLink(link, linkIndex);
    if (!normalized) return;
    if (!pointIds.has(String(normalized.from)) || !pointIds.has(String(normalized.to))) return;
    dedupedLinks.set(mapPairKey(normalized.from, normalized.to), normalized);
  });

  return {
    meta: raw.meta && typeof raw.meta === "object" ? { ...raw.meta } : {},
    groups,
    tacticalLinks: sortById([...dedupedLinks.values()]),
  };
}

function normalizeOptionalMapBoardPayload(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.groups)) {
    return {
      meta: {},
      groups: [],
      tacticalLinks: [],
    };
  }
  return normalizeMapBoardPayload(data);
}

function canonicalizeMapBoardPayloadForCompare(data) {
  const normalized = normalizeMapBoardPayload(data);
  return {
    meta: normalizeMetaForCompare(normalized.meta),
    groups: cloneJson(normalized.groups, []),
    tacticalLinks: cloneJson(normalized.tacticalLinks, []),
  };
}

function buildMapDeletionSets(existingPayload, incomingPayload, basePayload) {
  const existing = normalizeOptionalMapBoardPayload(existingPayload);
  const incoming = normalizeOptionalMapBoardPayload(incomingPayload);
  const base = normalizeOptionalMapBoardPayload(basePayload);

  const deletedGroupIds = new Set();
  const deletedPointIds = new Set();
  const deletedZoneIds = new Set();
  const deletedLinkKeys = new Set();

  const existingGroupIds = new Set(
    existing.groups.map((group) => String(group?.id || "").trim()).filter(Boolean)
  );
  const incomingGroupIds = new Set(
    incoming.groups.map((group) => String(group?.id || "").trim()).filter(Boolean)
  );

  const existingPointIds = new Set();
  const incomingPointIds = new Set();
  const existingZoneIds = new Set();
  const incomingZoneIds = new Set();

  existing.groups.forEach((group) => {
    (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
      const pointId = String(point?.id || "").trim();
      if (pointId) existingPointIds.add(pointId);
    });
    (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
      const zoneId = String(zone?.id || "").trim();
      if (zoneId) existingZoneIds.add(zoneId);
    });
  });

  incoming.groups.forEach((group) => {
    (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
      const pointId = String(point?.id || "").trim();
      if (pointId) incomingPointIds.add(pointId);
    });
    (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
      const zoneId = String(zone?.id || "").trim();
      if (zoneId) incomingZoneIds.add(zoneId);
    });
  });

  base.groups.forEach((group) => {
    const groupId = String(group?.id || "").trim();
    if (groupId && (!existingGroupIds.has(groupId) || !incomingGroupIds.has(groupId))) {
      deletedGroupIds.add(groupId);
    }

    (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
      const pointId = String(point?.id || "").trim();
      if (pointId && (!existingPointIds.has(pointId) || !incomingPointIds.has(pointId))) {
        deletedPointIds.add(pointId);
      }
    });

    (Array.isArray(group?.zones) ? group.zones : []).forEach((zone) => {
      const zoneId = String(zone?.id || "").trim();
      if (zoneId && (!existingZoneIds.has(zoneId) || !incomingZoneIds.has(zoneId))) {
        deletedZoneIds.add(zoneId);
      }
    });
  });

  const existingLinkKeys = new Set(
    existing.tacticalLinks.map((link) => mapPairKey(link?.from, link?.to)).filter(Boolean)
  );
  const incomingLinkKeys = new Set(
    incoming.tacticalLinks.map((link) => mapPairKey(link?.from, link?.to)).filter(Boolean)
  );

  base.tacticalLinks.forEach((link) => {
    const linkKey = mapPairKey(link?.from, link?.to);
    if (linkKey && (!existingLinkKeys.has(linkKey) || !incomingLinkKeys.has(linkKey))) {
      deletedLinkKeys.add(linkKey);
    }
  });

  return {
    deletedGroupIds,
    deletedPointIds,
    deletedZoneIds,
    deletedLinkKeys,
  };
}

function mergeMapBoardPayload(existingData, incomingData, baseData = null) {
  const existing = normalizeMapBoardPayload(existingData);
  const incoming = normalizeMapBoardPayload(incomingData);
  const deletionSets = buildMapDeletionSets(existing, incoming, baseData);
  const mergedGroups = cloneJson(
    existing.groups
      .filter((group) => {
        const groupId = String(group?.id || "").trim();
        return !groupId || !deletionSets.deletedGroupIds.has(groupId);
      })
      .map((group) => ({
        ...group,
        points: (Array.isArray(group?.points) ? group.points : []).filter((point) => {
          const pointId = String(point?.id || "").trim();
          return !pointId || !deletionSets.deletedPointIds.has(pointId);
        }),
        zones: (Array.isArray(group?.zones) ? group.zones : []).filter((zone) => {
          const zoneId = String(zone?.id || "").trim();
          return !zoneId || !deletionSets.deletedZoneIds.has(zoneId);
        }),
      })),
    []
  );
  const pointIndex = new Map();
  const zoneIndex = new Map();
  const groupById = new Map();

  mergedGroups.forEach((group, groupIdx) => {
    const groupId = String(group?.id || "").trim();
    if (groupId && !groupById.has(groupId)) groupById.set(groupId, groupIdx);

    (Array.isArray(group?.points) ? group.points : []).forEach((point, pointIdx) => {
      const pointId = String(point?.id || "").trim();
      if (!pointId || deletionSets.deletedPointIds.has(pointId) || pointIndex.has(pointId)) return;
      pointIndex.set(pointId, { groupIdx, pointIdx });
    });

    (Array.isArray(group?.zones) ? group.zones : []).forEach((zone, zoneIdx) => {
      const zoneId = String(zone?.id || "").trim();
      if (!zoneId || deletionSets.deletedZoneIds.has(zoneId) || zoneIndex.has(zoneId)) return;
      zoneIndex.set(zoneId, { groupIdx, zoneIdx });
    });
  });

  incoming.groups.forEach((incomingGroup, incomingIdx) => {
    const groupId = String(incomingGroup?.id || "").trim();
    if (groupId && deletionSets.deletedGroupIds.has(groupId)) return;
    let targetIdx = groupId && groupById.has(groupId) ? groupById.get(groupId) : -1;

    if (targetIdx < 0) {
      targetIdx = mergedGroups.push({
        id: groupId || makeLegacyId("grp", `group-${mergedGroups.length + 1}`),
        name: String(incomingGroup?.name || `GROUPE ${mergedGroups.length + 1}`),
        color: String(incomingGroup?.color || MAP_GROUP_PALETTE[mergedGroups.length % MAP_GROUP_PALETTE.length]),
        visible: incomingGroup?.visible !== false,
        points: [],
        zones: [],
      }) - 1;
      if (groupId) groupById.set(groupId, targetIdx);
    }

    const targetGroup = mergedGroups[targetIdx];
    if (!targetGroup || typeof targetGroup !== "object") return;
    targetGroup.id = groupId || targetGroup.id || makeLegacyId("grp", `group-${incomingIdx + 1}`);
    targetGroup.name = String(incomingGroup?.name || targetGroup.name || `GROUPE ${incomingIdx + 1}`);
    targetGroup.color = String(incomingGroup?.color || targetGroup.color || MAP_GROUP_PALETTE[targetIdx % MAP_GROUP_PALETTE.length]);
    targetGroup.visible = incomingGroup?.visible !== false;
    if (!Array.isArray(targetGroup.points)) targetGroup.points = [];
    if (!Array.isArray(targetGroup.zones)) targetGroup.zones = [];

    (Array.isArray(incomingGroup?.points) ? incomingGroup.points : []).forEach((point, pointIdx) => {
      const normalizedPoint = normalizeMapPoint(point, pointIdx);
      const pointId = String(normalizedPoint?.id || "").trim();
      if (!normalizedPoint || !pointId || deletionSets.deletedPointIds.has(pointId)) return;

      if (pointIndex.has(pointId)) {
        const loc = pointIndex.get(pointId);
        mergedGroups[loc.groupIdx].points[loc.pointIdx] = normalizedPoint;
        return;
      }

      const nextPointIdx = targetGroup.points.push(normalizedPoint) - 1;
      pointIndex.set(pointId, { groupIdx: targetIdx, pointIdx: nextPointIdx });
    });

    (Array.isArray(incomingGroup?.zones) ? incomingGroup.zones : []).forEach((zone, zoneIdx) => {
      const normalizedZone = normalizeMapZone(zone, zoneIdx);
      const zoneId = String(normalizedZone?.id || "").trim();
      if (!normalizedZone || !zoneId || deletionSets.deletedZoneIds.has(zoneId)) return;

      if (zoneIndex.has(zoneId)) {
        const loc = zoneIndex.get(zoneId);
        mergedGroups[loc.groupIdx].zones[loc.zoneIdx] = normalizedZone;
        return;
      }

      const nextZoneIdx = targetGroup.zones.push(normalizedZone) - 1;
      zoneIndex.set(zoneId, { groupIdx: targetIdx, zoneIdx: nextZoneIdx });
    });
  });

  const validPointIds = new Set();
  mergedGroups.forEach((group) => {
    (Array.isArray(group?.points) ? group.points : []).forEach((point) => {
      const pointId = String(point?.id || "").trim();
      if (pointId) validPointIds.add(pointId);
    });
  });

  const links = new Map();
  [existing.tacticalLinks, incoming.tacticalLinks].forEach((linkList) => {
    (Array.isArray(linkList) ? linkList : []).forEach((link, linkIdx) => {
      const normalizedLink = normalizeMapLink(link, linkIdx);
      if (!normalizedLink) return;
      if (deletionSets.deletedLinkKeys.has(mapPairKey(normalizedLink.from, normalizedLink.to))) return;
      if (!validPointIds.has(String(normalizedLink.from)) || !validPointIds.has(String(normalizedLink.to))) return;
      links.set(mapPairKey(normalizedLink.from, normalizedLink.to), normalizedLink);
    });
  });

  return {
    meta: {
      ...(existing.meta || {}),
      ...(incoming.meta || {}),
    },
    groups: mergedGroups,
    tacticalLinks: sortById([...links.values()]),
  };
}

function summarizeMapBoardDelta(previousData, nextData, options = {}) {
  const countGroups = (payload) => Array.isArray(payload?.groups) ? payload.groups.length : 0;
  const countPoints = (payload) => (Array.isArray(payload?.groups) ? payload.groups : [])
    .reduce((total, group) => total + (Array.isArray(group?.points) ? group.points.length : 0), 0);
  const countZones = (payload) => (Array.isArray(payload?.groups) ? payload.groups : [])
    .reduce((total, group) => total + (Array.isArray(group?.zones) ? group.zones.length : 0), 0);
  const countLinks = (payload) => Array.isArray(payload?.tacticalLinks) ? payload.tacticalLinks.length : 0;

  const parts = [];
  const deltas = [
    { value: countGroups(nextData) - countGroups(previousData), singular: "groupe", plural: "groupes" },
    { value: countPoints(nextData) - countPoints(previousData), singular: "point", plural: "points" },
    { value: countZones(nextData) - countZones(previousData), singular: "zone", plural: "zones" },
    { value: countLinks(nextData) - countLinks(previousData), singular: "liaison", plural: "liaisons" },
  ];

  deltas.forEach((delta) => {
    if (delta.value !== 0) {
      parts.push(`${delta.value > 0 ? "+" : ""}${delta.value} ${pluralize(delta.value, delta.singular, delta.plural)}`);
    }
  });

  if (options.mergedConflict) parts.push("fusion auto");
  return parts.join(" · ") || "contenu mis a jour";
}

function normalizeBoardDataByPage(page, data, options = {}) {
  return normalizePage(page) === "map"
    ? normalizeMapBoardPayload(data)
    : normalizeBoardPayload(data, options);
}

function summarizeBoardDeltaByPage(page, previousData, nextData, options = {}) {
  return normalizePage(page) === "map"
    ? summarizeMapBoardDelta(previousData, nextData, options)
    : summarizeBoardDelta(previousData, nextData, options);
}

function normalizeNode(node) {
  if (!node || typeof node !== "object") return null;
  const id = node.id ?? "";
  if (id === "") return null;
  return {
    id,
    name: String(node.name || "").trim(),
    type: String(node.type || "person"),
    color: String(node.color || ""),
    manualColor: Boolean(node.manualColor),
    personStatus: String(node.personStatus || "active"),
    num: String(node.num || ""),
    accountNumber: String(node.accountNumber || ""),
    citizenNumber: String(node.citizenNumber || ""),
    description: String(node.description || node.notes || ""),
    notes: String(node.notes || node.description || ""),
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    fixed: Boolean(node.fixed),
    linkedMapPointId: String(node.linkedMapPointId || ""),
  };
}

function normalizeLink(link) {
  if (!link || typeof link !== "object") return null;
  const id = link.id ?? "";
  if (id === "") return null;
  const source = link.source && typeof link.source === "object" ? link.source.id : link.source;
  const target = link.target && typeof link.target === "object" ? link.target.id : link.target;
  const sourceId = String(source ?? "");
  const targetId = String(target ?? "");
  if (!sourceId || !targetId || sourceId === targetId) return null;
  return {
    id,
    source: sourceId,
    target: targetId,
    kind: String(link.kind || "relation"),
  };
}

function normalizeEntityMeta(rawMeta, fields, fallbackUpdatedAt = "", fallbackUser = "") {
  const fallbackAt = String(fallbackUpdatedAt || "");
  const fallbackBy = String(fallbackUser || "");
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const fieldTimes = {};
  for (const field of fields) {
    fieldTimes[field] = String(meta.fieldTimes?.[field] || meta[field] || fallbackAt || "");
  }
  return {
    updatedAt: String(meta.updatedAt || fallbackAt || ""),
    updatedBy: String(meta.updatedBy || fallbackBy || ""),
    fieldTimes,
  };
}

function normalizeDeletedEntries(list, fallbackUpdatedAt = "", fallbackUser = "") {
  const latest = new Map();
  const fallbackAt = String(fallbackUpdatedAt || "");
  const fallbackBy = String(fallbackUser || "");
  const source = Array.isArray(list) ? list : [];
  for (const item of source) {
    const id = String(item?.id ?? "").trim();
    if (!id) continue;
    const next = {
      id,
      deletedAt: String(item?.deletedAt || fallbackAt || ""),
      deletedBy: String(item?.deletedBy || fallbackBy || ""),
    };
    const prev = latest.get(id);
    if (!prev || timeValue(next.deletedAt) >= timeValue(prev.deletedAt)) {
      latest.set(id, next);
    }
  }
  return sortById([...latest.values()]);
}

function normalizeBoardPayload(data, options = {}) {
  const fallbackUpdatedAt = String(options.fallbackUpdatedAt || "");
  const fallbackUser = String(options.fallbackUser || "");
  const raw = data && typeof data === "object" ? data : {};
  const nodes = sortById(
    (Array.isArray(raw.nodes) ? raw.nodes : [])
      .map((node) => {
        const normalized = normalizeNode(node);
        if (!normalized) return null;
        return {
          ...normalized,
          _collab: normalizeEntityMeta(node?._collab, COLLAB_NODE_FIELDS, fallbackUpdatedAt, fallbackUser),
        };
      })
      .filter(Boolean)
  );
  const links = sortById(
    (Array.isArray(raw.links) ? raw.links : [])
      .map((link) => {
        const normalized = normalizeLink(link);
        if (!normalized) return null;
        return {
          ...normalized,
          _collab: normalizeEntityMeta(link?._collab, COLLAB_LINK_FIELDS, fallbackUpdatedAt, fallbackUser),
        };
      })
      .filter(Boolean)
  );
  return {
    meta: raw.meta && typeof raw.meta === "object" ? { ...raw.meta } : {},
    physicsSettings: raw.physicsSettings && typeof raw.physicsSettings === "object"
      ? cloneJson(raw.physicsSettings, {})
      : {},
    nodes,
    links,
    deletedNodes: normalizeDeletedEntries(raw.deletedNodes, fallbackUpdatedAt, fallbackUser),
    deletedLinks: normalizeDeletedEntries(raw.deletedLinks, fallbackUpdatedAt, fallbackUser),
    _collab: normalizeEntityMeta(raw._collab, ["physicsSettings"], fallbackUpdatedAt, fallbackUser),
  };
}

function canonicalizePointBoardPayloadForCompare(data, options = {}) {
  const normalized = normalizeBoardPayload(data, options);
  return {
    meta: normalizeMetaForCompare(normalized.meta),
    physicsSettings: cloneJson(normalized.physicsSettings, {}),
    nodes: normalized.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      color: node.color,
      manualColor: node.manualColor,
      personStatus: node.personStatus,
      num: node.num,
      accountNumber: node.accountNumber,
      citizenNumber: node.citizenNumber,
      description: node.description,
      notes: node.notes,
      x: node.x,
      y: node.y,
      fixed: node.fixed,
      linkedMapPointId: node.linkedMapPointId,
    })),
    links: normalized.links.map((link) => ({
      id: link.id,
      source: link.source,
      target: link.target,
      kind: link.kind,
    })),
    deletedNodes: normalized.deletedNodes.map((item) => ({
      id: item.id,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy,
    })),
    deletedLinks: normalized.deletedLinks.map((item) => ({
      id: item.id,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy,
    })),
  };
}

function canonicalizeBoardPayloadByPage(page, data, options = {}) {
  return normalizePage(page) === "map"
    ? canonicalizeMapBoardPayloadForCompare(data)
    : canonicalizePointBoardPayloadForCompare(data, options);
}

function isSameBoardPayloadByPage(page, left, right, options = {}) {
  try {
    return JSON.stringify(canonicalizeBoardPayloadByPage(page, left, options)) === JSON.stringify(canonicalizeBoardPayloadByPage(page, right, options));
  } catch (e) {
    return false;
  }
}

function normalizeBoardActivity(board) {
  const rows = Array.isArray(board?.activity) ? board.activity : [];
  return rows
    .map((item) => ({
      id: String(item?.id || ""),
      at: String(item?.at || ""),
      actorId: String(item?.actorId || ""),
      actorName: String(item?.actorName || ""),
      type: String(item?.type || "info"),
      text: String(item?.text || "").trim(),
    }))
    .filter((item) => item.id && item.text)
    .sort((a, b) => timeValue(b.at) - timeValue(a.at))
    .slice(0, BOARD_ACTIVITY_MAX);
}

function sanitizeBoardActivityText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function appendBoardActivity(board, user, type, text) {
  const cleanText = sanitizeBoardActivityText(text);
  if (!board || !cleanText) return false;
  const existing = normalizeBoardActivity(board);
  const latest = existing[0];
  if (
    latest &&
    String(type || "info") === "save" &&
    String(latest.type || "") === "save" &&
    String(latest.actorId || "") === String(user?.id || "") &&
    (Date.now() - timeValue(latest.at)) < 25000
  ) {
    latest.at = nowIso();
    latest.text = cleanText;
    board.activity = [latest, ...existing.slice(1)].slice(0, BOARD_ACTIVITY_MAX);
    return true;
  }

  const entry = {
    id: newId("act"),
    at: nowIso(),
    actorId: String(user?.id || ""),
    actorName: String(user?.username || ""),
    type: String(type || "info"),
    text: cleanText,
  };
  board.activity = [entry, ...existing].slice(0, BOARD_ACTIVITY_MAX);
  return true;
}

function summarizeBoardDelta(previousData, nextData, options = {}) {
  const prevNodes = Array.isArray(previousData?.nodes) ? previousData.nodes.length : 0;
  const nextNodes = Array.isArray(nextData?.nodes) ? nextData.nodes.length : 0;
  const prevLinks = Array.isArray(previousData?.links) ? previousData.links.length : 0;
  const nextLinks = Array.isArray(nextData?.links) ? nextData.links.length : 0;
  const nodeDelta = nextNodes - prevNodes;
  const linkDelta = nextLinks - prevLinks;
  const parts = [];

  if (nodeDelta !== 0) {
    parts.push(`${nodeDelta > 0 ? "+" : ""}${nodeDelta} ${pluralize(nodeDelta, "fiche")}`);
  }
  if (linkDelta !== 0) {
    parts.push(`${linkDelta > 0 ? "+" : ""}${linkDelta} ${pluralize(linkDelta, "lien")}`);
  }
  if (options.mergedConflict) {
    parts.push("fusion auto");
  }
  return parts.join(" · ") || "contenu mis a jour";
}

function cloneEntity(entity, fields) {
  if (!entity) return null;
  const result = { id: entity.id };
  for (const field of fields) result[field] = cloneJson(entity[field], entity[field]);
  result._collab = normalizeEntityMeta(entity._collab, fields, entity?._collab?.updatedAt || "", entity?._collab?.updatedBy || "");
  return result;
}

function mergeEntities(left, right, fields) {
  if (!left && !right) return null;
  if (!left) return cloneEntity(right, fields);
  if (!right) return cloneEntity(left, fields);

  const leftMeta = normalizeEntityMeta(left._collab, fields, left?._collab?.updatedAt || "", left?._collab?.updatedBy || "");
  const rightMeta = normalizeEntityMeta(right._collab, fields, right?._collab?.updatedAt || "", right?._collab?.updatedBy || "");
  const merged = { id: right.id ?? left.id };
  const fieldTimes = {};
  let latestAt = "";
  let latestBy = "";

  for (const field of fields) {
    const leftAt = String(leftMeta.fieldTimes[field] || leftMeta.updatedAt || "");
    const rightAt = String(rightMeta.fieldTimes[field] || rightMeta.updatedAt || "");
    const useRight = timeValue(rightAt) >= timeValue(leftAt);
    merged[field] = cloneJson(useRight ? right[field] : left[field], useRight ? right[field] : left[field]);
    fieldTimes[field] = useRight ? rightAt : leftAt;
    if (timeValue(fieldTimes[field]) >= timeValue(latestAt)) {
      latestAt = fieldTimes[field];
      latestBy = useRight ? String(rightMeta.updatedBy || "") : String(leftMeta.updatedBy || "");
    }
  }

  merged._collab = {
    updatedAt: latestAt || String(rightMeta.updatedAt || leftMeta.updatedAt || ""),
    updatedBy: latestBy || String(rightMeta.updatedBy || leftMeta.updatedBy || ""),
    fieldTimes,
  };
  return merged;
}

function mergeDeletedEntries(leftList, rightList) {
  return normalizeDeletedEntries([...(Array.isArray(leftList) ? leftList : []), ...(Array.isArray(rightList) ? rightList : [])]);
}

function normalizeLinkSignature(link) {
  const a = String(link?.source || "");
  const b = String(link?.target || "");
  const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
  return `${pair}|${String(link?.kind || "")}`;
}

function dedupeLinksBySignature(links) {
  const latest = new Map();
  for (const link of links) {
    const sig = normalizeLinkSignature(link);
    const prev = latest.get(sig);
    if (!prev || timeValue(link?._collab?.updatedAt) >= timeValue(prev?._collab?.updatedAt)) {
      latest.set(sig, link);
    }
  }
  return sortById([...latest.values()]);
}

function pruneBoardPayload(payload) {
  const normalized = normalizeBoardPayload(payload, {
    fallbackUpdatedAt: payload?._collab?.updatedAt || "",
    fallbackUser: payload?._collab?.updatedBy || "",
  });
  const deletedNodes = new Map(normalized.deletedNodes.map((item) => [String(item.id), item]));
  const nodes = normalized.nodes.filter((node) => {
    const tombstone = deletedNodes.get(String(node.id));
    if (!tombstone) return true;
    return timeValue(node?._collab?.updatedAt) > timeValue(tombstone.deletedAt);
  });
  const nodeIds = new Set(nodes.map((node) => String(node.id)));

  const deletedLinks = new Map(normalized.deletedLinks.map((item) => [String(item.id), item]));
  const links = dedupeLinksBySignature(
    normalized.links.filter((link) => {
      const tombstone = deletedLinks.get(String(link.id));
      if (tombstone && timeValue(link?._collab?.updatedAt) <= timeValue(tombstone.deletedAt)) return false;
      return nodeIds.has(String(link.source)) && nodeIds.has(String(link.target));
    })
  );

  return {
    ...normalized,
    nodes,
    links,
  };
}

function mergeBoardPayload(existingData, incomingData, options = {}) {
  const existing = normalizeBoardPayload(existingData, {
    fallbackUpdatedAt: options.existingUpdatedAt || "",
    fallbackUser: options.existingUser || "",
  });
  const incoming = normalizeBoardPayload(incomingData, {
    fallbackUpdatedAt: options.incomingUpdatedAt || options.existingUpdatedAt || "",
    fallbackUser: options.incomingUser || "",
  });
  const mergedNodeIds = new Set([
    ...existing.nodes.map((node) => String(node.id)),
    ...incoming.nodes.map((node) => String(node.id)),
  ]);
  const existingNodes = new Map(existing.nodes.map((node) => [String(node.id), node]));
  const incomingNodes = new Map(incoming.nodes.map((node) => [String(node.id), node]));
  const nodes = sortById(
    [...mergedNodeIds]
      .map((id) => mergeEntities(existingNodes.get(id), incomingNodes.get(id), COLLAB_NODE_FIELDS))
      .filter(Boolean)
  );

  const mergedLinkIds = new Set([
    ...existing.links.map((link) => String(link.id)),
    ...incoming.links.map((link) => String(link.id)),
  ]);
  const existingLinks = new Map(existing.links.map((link) => [String(link.id), link]));
  const incomingLinks = new Map(incoming.links.map((link) => [String(link.id), link]));
  const links = sortById(
    [...mergedLinkIds]
      .map((id) => mergeEntities(existingLinks.get(id), incomingLinks.get(id), COLLAB_LINK_FIELDS))
      .filter(Boolean)
  );

  const existingBoardMeta = normalizeEntityMeta(existing._collab, ["physicsSettings"], options.existingUpdatedAt || "", options.existingUser || "");
  const incomingBoardMeta = normalizeEntityMeta(incoming._collab, ["physicsSettings"], options.incomingUpdatedAt || "", options.incomingUser || "");
  const existingPhysicsAt = String(existingBoardMeta.fieldTimes.physicsSettings || existingBoardMeta.updatedAt || "");
  const incomingPhysicsAt = String(incomingBoardMeta.fieldTimes.physicsSettings || incomingBoardMeta.updatedAt || "");
  const useIncomingPhysics = timeValue(incomingPhysicsAt) >= timeValue(existingPhysicsAt);
  const boardMeta = {
    updatedAt: useIncomingPhysics
      ? String(incomingBoardMeta.updatedAt || incomingPhysicsAt || existingBoardMeta.updatedAt || "")
      : String(existingBoardMeta.updatedAt || existingPhysicsAt || incomingBoardMeta.updatedAt || ""),
    updatedBy: useIncomingPhysics
      ? String(incomingBoardMeta.updatedBy || "")
      : String(existingBoardMeta.updatedBy || ""),
    fieldTimes: {
      physicsSettings: useIncomingPhysics ? incomingPhysicsAt : existingPhysicsAt,
    },
  };

  return pruneBoardPayload({
    meta: {
      ...(existing.meta || {}),
      ...(incoming.meta || {}),
    },
    physicsSettings: useIncomingPhysics
      ? cloneJson(incoming.physicsSettings, incoming.physicsSettings)
      : cloneJson(existing.physicsSettings, existing.physicsSettings),
    nodes,
    links,
    deletedNodes: mergeDeletedEntries(existing.deletedNodes, incoming.deletedNodes),
    deletedLinks: mergeDeletedEntries(existing.deletedLinks, incoming.deletedLinks),
    _collab: boardMeta,
  });
}

function presenceKey(boardId, userId) {
  return `presence/${boardId}/${userId}`;
}

function editLockKey(boardId) {
  return `locks/${boardId}`;
}

function buildBoardEditLockMessage(lock = {}) {
  const username = String(lock.username || "").trim();
  if (!username) return "Une autre personne modifie deja ce board.";
  return `${username} modifie deja ce board.`;
}

function normalizeBoardEditLock(rawLock, boardId, currentUserId = "") {
  if (!rawLock || typeof rawLock !== "object") return null;

  const cleanBoardId = String(rawLock.boardId || boardId || "").trim();
  const userId = String(rawLock.userId || "").trim();
  const expiresAt = String(rawLock.expiresAt || "").trim();
  const expiresAtMs = timeValue(expiresAt);
  if (!cleanBoardId || !userId || !expiresAtMs) return null;
  if ((expiresAtMs + BOARD_EDIT_LOCK_STALE_GRACE_MS) <= Date.now()) return null;

  const username = String(rawLock.username || "operateur").trim() || "operateur";
  const safeCurrentUserId = String(currentUserId || "").trim();
  const isSelf = Boolean(safeCurrentUserId) && userId === safeCurrentUserId;
  const heldByOther = Boolean(safeCurrentUserId) && !isSelf;

  return {
    boardId: cleanBoardId,
    userId,
    username,
    role: sanitizeRole(rawLock.role || ROLE_EDITOR, ROLE_EDITOR),
    acquiredAt: String(rawLock.acquiredAt || rawLock.lastAt || ""),
    lastAt: String(rawLock.lastAt || rawLock.acquiredAt || ""),
    expiresAt,
    expiresInMs: Math.max(0, expiresAtMs - Date.now()),
    isSelf,
    heldByOther,
    message: isSelf ? "Edition reservee pour toi." : buildBoardEditLockMessage({ username }),
  };
}

async function readBoardEditLockRecord(store, boardId, currentUserId = "") {
  const key = editLockKey(boardId);
  let record = null;
  let rawLock = null;

  if (typeof store.getWithMetadata === "function") {
    record = await store.getWithMetadata(key, { type: "json" }).catch(() => null);
    rawLock = record?.data || null;
  } else {
    rawLock = await store.get(key, { type: "json" }).catch(() => null);
  }

  const lock = normalizeBoardEditLock(rawLock, boardId, currentUserId);
  if (!lock && rawLock) {
    await store.delete(key).catch(() => {});
  }

  return {
    key,
    rawLock: lock ? rawLock : null,
    lock,
    etag: String(record?.etag || ""),
    metadata: record?.metadata || null,
  };
}

async function describeBoardEditLock(store, boardId, currentUserId = "") {
  if (!boardId) return null;
  const record = await readBoardEditLockRecord(store, boardId, currentUserId);
  return record.lock;
}

function buildBoardEditLockEntry(boardId, user, role, previousLock = null) {
  const now = nowIso();
  return {
    boardId: String(boardId || ""),
    userId: String(user?.id || ""),
    username: String(user?.username || ""),
    role: sanitizeRole(role || ROLE_EDITOR, ROLE_EDITOR),
    acquiredAt: String(previousLock?.acquiredAt || now),
    lastAt: now,
    expiresAt: new Date(Date.now() + BOARD_EDIT_LOCK_TTL_MS).toISOString(),
  };
}

async function acquireBoardEditLock(store, board, user, role) {
  const boardId = String(board?.id || "");
  if (!boardId) {
    return { ok: false, statusCode: 400, error: "Board invalide.", lock: null };
  }
  if (!user?.id || !canEditBoard(role)) {
    return { ok: false, statusCode: 403, error: "Modification interdite.", lock: null };
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readBoardEditLockRecord(store, boardId, user.id);
    if (current.lock && !current.lock.isSelf) {
      return {
        ok: false,
        statusCode: 423,
        error: current.lock.message,
        lock: current.lock,
      };
    }

    const nextLock = buildBoardEditLockEntry(boardId, user, role, current.rawLock || current.lock || null);

    if (current.etag) {
      const writeResult = await store.setJSON(current.key, nextLock, {
        onlyIfMatch: current.etag,
      }).catch(() => ({ modified: false }));
      if (writeResult && writeResult.modified === false) continue;
    } else if (!current.lock) {
      const writeResult = await store.setJSON(current.key, nextLock, {
        onlyIfNew: true,
      }).catch(() => ({ modified: false }));
      if (writeResult && writeResult.modified === false) continue;
    } else {
      await store.setJSON(current.key, nextLock).catch(() => null);
    }

    return {
      ok: true,
      lock: normalizeBoardEditLock(nextLock, boardId, user.id),
    };
  }

  const lock = await describeBoardEditLock(store, boardId, user.id);
  if (lock && !lock.isSelf) {
    return {
      ok: false,
      statusCode: 423,
      error: lock.message,
      lock,
    };
  }

  return {
    ok: false,
    statusCode: 409,
    error: "Impossible de reserver l edition du board pour le moment.",
    lock,
  };
}

async function releaseBoardEditLock(store, boardId, userId = "") {
  if (!boardId) return null;
  const record = await readBoardEditLockRecord(store, boardId, userId);
  if (!record.lock) return null;
  if (userId && String(record.lock.userId || "") !== String(userId || "")) {
    return record.lock;
  }
  await store.delete(record.key).catch(() => {});
  return record.lock;
}

async function listOnlineUsers(store, allowedUserIds = null) {
  const keys = await listKeysByPrefix(store, "sessions/", SESSION_SCAN_MAX);
  const rows = await Promise.all(keys.map((key) => store.get(key, { type: "json" }).catch(() => null)));
  const now = Date.now();
  const allow = allowedUserIds instanceof Set ? allowedUserIds : null;
  const latestByUser = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const key = keys[index];
    const userId = String(row?.userId || "");
    if (!row || !userId) {
      if (key) await store.delete(key).catch(() => {});
      continue;
    }
    if (allow && !allow.has(userId)) continue;
    const age = now - timeValue(row.lastAt);
    if (age > SESSION_ACTIVE_MS) continue;
    const prev = latestByUser.get(userId);
    if (!prev || timeValue(row.lastAt) >= timeValue(prev.lastAt)) {
      latestByUser.set(userId, { userId, lastAt: String(row.lastAt || "") });
    }
  }

  return [...latestByUser.values()]
    .sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt))
    .map((item) => item.userId);
}

function presencePrefix(boardId) {
  return `presence/${boardId}/`;
}

async function listBoardPresence(store, boardId) {
  const keys = await listKeysByPrefix(store, presencePrefix(boardId), PRESENCE_MAX_ITEMS);
  const rows = await Promise.all(keys.map((key) => store.get(key, { type: "json" }).catch(() => null)));
  const now = Date.now();
  const latestByUser = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const key = keys[index];
    if (!row || !row.userId) {
      if (key) await store.delete(key).catch(() => {});
      continue;
    }
    const age = now - timeValue(row.lastAt);
    if (age > PRESENCE_STALE_MS) {
      if (key) await store.delete(key).catch(() => {});
      continue;
    }
    const entry = {
      userId: String(row.userId || ""),
      username: String(row.username || ""),
      role: sanitizeRole(row.role || ROLE_EDITOR, ROLE_EDITOR),
      boardId: String(row.boardId || boardId || ""),
      activeNodeId: String(row.activeNodeId || ""),
      activeNodeName: String(row.activeNodeName || ""),
      activeTextKey: String(row.activeTextKey || ""),
      activeTextLabel: String(row.activeTextLabel || ""),
      mode: String(row.mode || "editing"),
      cursorVisible: readPresenceFlag(row.cursorVisible, false),
      cursorWorldX: readPresenceFlag(row.cursorVisible, false)
        ? clampFiniteNumber(row.cursorWorldX, 0, -250000, 250000)
        : 0,
      cursorWorldY: readPresenceFlag(row.cursorVisible, false)
        ? clampFiniteNumber(row.cursorWorldY, 0, -250000, 250000)
        : 0,
      cursorMapX: readPresenceFlag(row.cursorVisible, false)
        ? clampFiniteNumber(row.cursorMapX, 50, 0, 100)
        : 50,
      cursorMapY: readPresenceFlag(row.cursorVisible, false)
        ? clampFiniteNumber(row.cursorMapY, 50, 0, 100)
        : 50,
      lastAt: String(row.lastAt || ""),
    };
    const previous = latestByUser.get(entry.userId);
    if (!previous || timeValue(entry.lastAt) >= timeValue(previous.lastAt)) {
      latestByUser.set(entry.userId, entry);
    }
  }

  const active = [...latestByUser.values()];
  active.sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")));
  return active;
}

async function touchBoardPresence(store, board, user, role, payload = {}) {
  const boardId = String(board?.id || "");
  if (!boardId || !user?.id) return [];
  const now = nowIso();
  const cursorVisible = readPresenceFlag(payload.cursorVisible, false);
  await store.setJSON(presenceKey(boardId, user.id), {
    boardId,
    userId: user.id,
    username: user.username,
    role: sanitizeRole(role || ROLE_EDITOR, ROLE_EDITOR),
    activeNodeId: String(payload.activeNodeId || ""),
    activeNodeName: String(payload.activeNodeName || "").slice(0, 80),
    activeTextKey: String(payload.activeTextKey || ""),
    activeTextLabel: String(payload.activeTextLabel || "").slice(0, 80),
    mode: String(payload.mode || "editing"),
    cursorVisible,
    cursorWorldX: cursorVisible
      ? clampFiniteNumber(payload.cursorWorldX, 0, -250000, 250000)
      : 0,
    cursorWorldY: cursorVisible
      ? clampFiniteNumber(payload.cursorWorldY, 0, -250000, 250000)
      : 0,
    cursorMapX: cursorVisible
      ? clampFiniteNumber(payload.cursorMapX, 50, 0, 100)
      : 50,
    cursorMapY: cursorVisible
      ? clampFiniteNumber(payload.cursorMapY, 50, 0, 100)
      : 50,
    lastAt: now,
  });
  return listBoardPresence(store, boardId);
}

async function searchUsersForBoard(store, board, requesterId, query, options = {}) {
  const boardId = String(board?.id || "").trim();
  const safeQuery = normalizeUsernameQuery(query);
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
  if (!boardId || !safeQuery) return [];

  const role = getRoleForUser(board, requesterId);
  if (role !== ROLE_OWNER) return [];

  const memberIds = new Set([
    String(board.ownerId || ""),
    ...(Array.isArray(board.members) ? board.members.map((member) => String(member?.userId || "")) : []),
  ].filter(Boolean));
  const exactKey = `users/by-name/${safeQuery}`;
  const exactMatch = await store.get(exactKey, { type: "json" }).catch(() => null);
  let candidateKeys = exactMatch ? [exactKey] : [];

  if (safeQuery.length >= 2 && candidateKeys.length < limit) {
    const broadKeys = await listKeysByPrefix(store, "users/by-name/", 180);
    const broadMatches = broadKeys.filter((key) => String(key || "").includes(safeQuery));
    candidateKeys = [...new Set([...candidateKeys, ...broadMatches])].slice(0, 180);
  }

  const rows = await Promise.all(candidateKeys.map((key) => store.get(key, { type: "json" }).catch(() => null)));
  const users = rows
    .map((row) => {
      const username = String(row?.username || "").trim();
      const userId = String(row?.userId || "").trim();
      if (!username || !userId || memberIds.has(userId)) return null;
      const starts = username.startsWith(safeQuery);
      const index = username.indexOf(safeQuery);
      if (index < 0) return null;
      return { userId, username, starts, index };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.starts !== b.starts) return a.starts ? -1 : 1;
      if (a.index !== b.index) return a.index - b.index;
      return String(a.username || "").localeCompare(String(b.username || ""), "fr", { sensitivity: "base" });
    })
    .slice(0, limit)
    .map((entry) => ({
      userId: entry.userId,
      username: entry.username,
    }));

  return users;
}

async function clearBoardPresence(store, boardId, userId) {
  if (!boardId || !userId) return;
  const baseKey = presenceKey(boardId, userId);
  const prefix = `${presencePrefix(boardId)}${String(userId || "")}`;
  await store.delete(baseKey).catch(() => {});
  const keys = await listKeysByPrefix(store, presencePrefix(boardId), PRESENCE_MAX_ITEMS).catch(() => []);
  await Promise.all(
    keys
      .filter((key) => key !== baseKey && String(key || "").startsWith(`${prefix}~`))
      .map((key) => store.delete(key).catch(() => {}))
  );
}

function sanitizeShareRole(inputRole) {
  const role = sanitizeRole(inputRole, ROLE_EDITOR);
  return role === ROLE_OWNER ? ROLE_EDITOR : role;
}

function getUnsupportedShareRoleMessage(inputRole, board, targetUser) {
  const requestedRole = sanitizeRole(inputRole, ROLE_EDITOR);
  if (
    requestedRole === ROLE_OWNER
    && String(targetUser?.id || "") !== String(board?.ownerId || "")
  ) {
    return 'Utilise "Donner lead" pour changer le lead.';
  }
  return "";
}

function sleep(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return preflightResponse();
  }

  if (event.httpMethod !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  const body = readBody(event);
  if (!body) {
    return errorResponse(400, "JSON invalide.");
  }

  const action = String(body.action || "").toLowerCase();
  const auth = await resolveAuth(event, body);
  if (!auth.ok) {
    return errorResponse(auth.statusCode || 401, auth.error || "Session requise.");
  }

  const { store, user } = auth;

  if (action === "list_boards") {
    const requestedPage = body.page === undefined || body.page === null || String(body.page).trim() === ""
      ? ""
      : normalizePage(body.page);
    const index = await getUserBoardIndex(store, user.id);
    let loadedBoards = [];

    if (index.boardIds.length > 0 || index.hydrated) {
      loadedBoards = await Promise.all(
        index.boardIds.map((boardId) => loadBoard(store, boardId).catch(() => null))
      );
    } else {
      const keys = await listKeysByPrefix(store, "boards/", 1000);
      loadedBoards = await Promise.all(
        keys.map((key) => store.get(key, { type: "json" }).catch(() => null))
      );
    }

    const accessibleBoards = loadedBoards.filter((board) => board && board.id && getRoleForUser(board, user.id));
    const accessibleIds = accessibleBoards.map((board) => String(board.id));
    if (!index.hydrated) {
      try {
        await setUserBoardIndex(store, user.id, accessibleIds, { hydrated: true });
      } catch (e) {
        console.error("Failed to hydrate user board index", e);
      }
    } else {
      const shouldHealIndex = accessibleIds.length !== index.boardIds.length || loadedBoards.some((board) => !board || !getRoleForUser(board, user.id));
      if (shouldHealIndex) {
        try {
          await setUserBoardIndex(store, user.id, accessibleIds, { hydrated: true });
        } catch (e) {
          console.error("Failed to heal user board index", e);
        }
      }
    }

    const boards = accessibleBoards
      .filter((board) => !requestedPage || normalizePage(board.page) === requestedPage)
      .map((board) => boardSummary(board, getRoleForUser(board, user.id)))
      .filter(Boolean);

    boards.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return jsonResponse(200, {
      ok: true,
      user: safeUser(user),
      boards,
    });
  }

  if (action === "create_board") {
    const data = body.data;
    const page = normalizePage(body.page);
    if (!validateBoardData(data, page)) {
      return errorResponse(400, "Donnees du tableau invalides.");
    }

    const boardId = newId("brd");
    const now = nowIso();
    const normalizedData = page === "map"
      ? normalizeMapBoardPayload(data)
      : mergeBoardPayload(
          {
            meta: {},
            physicsSettings: {},
            nodes: [],
            links: [],
            deletedNodes: [],
            deletedLinks: [],
            _collab: { updatedAt: now, updatedBy: user.username, fieldTimes: { physicsSettings: now } },
          },
          data,
          {
            existingUpdatedAt: now,
            incomingUpdatedAt: now,
            existingUser: user.username,
            incomingUser: user.username,
          }
        );
    const boardActivity = [];
    const board = {
      id: boardId,
      title: normalizeTitle(body.title),
      page,
      ownerId: user.id,
      ownerName: user.username,
      createdAt: now,
      updatedAt: now,
      lastEditedBy: {
        userId: user.id,
        username: user.username,
        at: now,
      },
      members: [
        {
          userId: user.id,
          username: user.username,
          role: ROLE_OWNER,
          addedAt: now,
        },
      ],
      data: normalizedData,
      activity: boardActivity,
    };
    appendBoardActivity(board, user, "board", "a cree le board");

    await saveBoard(store, board);
    await addUserBoardRef(store, user.id, boardId);
    const editLockResult = await acquireBoardEditLock(store, board, user, ROLE_OWNER).catch(() => ({ ok: false, lock: null }));
    return jsonResponse(200, {
      ok: true,
      board: {
        ...boardSummary(board, ROLE_OWNER),
        members: board.members,
        data: board.data,
        activity: normalizeBoardActivity(board),
      },
      presence: [],
      editLock: editLockResult?.lock || null,
      boardId,
    });
  }

  if (action === "get_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (!role) return errorResponse(403, "Acces refuse.");
    const presence = await listBoardPresence(store, boardId);
    let editLock = await describeBoardEditLock(store, boardId, user.id);
    if (canEditBoard(role)) {
      const lockResult = await acquireBoardEditLock(store, board, user, role).catch(() => ({ ok: false, lock: editLock }));
      if (lockResult?.lock) {
        editLock = lockResult.lock;
      }
    }
    const memberIds = new Set([
      String(board.ownerId || ""),
      ...(Array.isArray(board.members) ? board.members.map((member) => String(member.userId || "")) : []),
    ].filter(Boolean));
    const onlineUsers = await listOnlineUsers(store, memberIds);

    return jsonResponse(200, {
      ok: true,
      role,
      board: {
        ...boardSummary(board, role),
        members: Array.isArray(board.members) ? board.members : [],
        data: normalizeBoardDataByPage(board.page, board.data, {
          fallbackUpdatedAt: board.updatedAt || "",
          fallbackUser: board.lastEditedBy?.username || board.ownerName || "",
        }),
        activity: normalizeBoardActivity(board),
      },
      presence,
      onlineUsers,
      editLock,
    });
  }

  if (action === "refresh_edit_lock") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (!role) return errorResponse(403, "Acces refuse.");
    if (!canEditBoard(role)) return errorResponse(403, "Modification interdite.");

    const lockResult = await acquireBoardEditLock(store, board, user, role);
    if (!lockResult.ok) {
      return errorResponse(lockResult.statusCode || 423, lockResult.error || "Edition deja reservee.", {
        editLock: lockResult.lock || null,
      });
    }

    return jsonResponse(200, {
      ok: true,
      boardId,
      editLock: lockResult.lock || null,
    });
  }

  if (action === "release_edit_lock") {
    const boardId = String(body.boardId || "");
    if (boardId) {
      await releaseBoardEditLock(store, boardId, user.id).catch(() => {});
    }
    return jsonResponse(200, {
      ok: true,
      boardId,
    });
  }

  if (action === "watch_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (!role) return errorResponse(403, "Acces refuse.");
    const initialPresence = await listBoardPresence(store, boardId);

    const sinceUpdatedAt = String(body.sinceUpdatedAt || "").trim();
    const currentUpdatedAt = String(board.updatedAt || "");
    if (!sinceUpdatedAt || currentUpdatedAt !== sinceUpdatedAt) {
      return jsonResponse(200, {
        ok: true,
        changed: true,
        boardId,
        updatedAt: currentUpdatedAt,
        role,
        lastEditedBy: board.lastEditedBy || null,
        presence: initialPresence,
      });
    }

    const requestedTimeoutMs = Number(body.timeoutMs);
    const timeoutMs = Number.isFinite(requestedTimeoutMs)
      ? Math.max(3000, Math.min(15000, requestedTimeoutMs))
      : 12000;

    const pollEveryMs = 1200;
    const deadline = Date.now() + timeoutMs;
    let latestBoard = board;
    let latestRole = role;

    while (Date.now() < deadline) {
      await sleep(pollEveryMs);
      latestBoard = await loadBoard(store, boardId);

      if (!latestBoard) {
        return jsonResponse(200, {
          ok: true,
          changed: true,
          boardId,
          deleted: true,
          presence: [],
        });
      }

      latestRole = getRoleForUser(latestBoard, user.id);
      if (!latestRole) {
        return jsonResponse(200, {
          ok: true,
          changed: true,
          boardId,
          revoked: true,
          presence: [],
        });
      }

      const latestUpdatedAt = String(latestBoard.updatedAt || "");
      if (latestUpdatedAt !== sinceUpdatedAt) {
        const presence = await listBoardPresence(store, boardId);
        return jsonResponse(200, {
          ok: true,
          changed: true,
          boardId,
          updatedAt: latestUpdatedAt,
          role: latestRole,
          lastEditedBy: latestBoard.lastEditedBy || null,
          presence,
        });
      }
    }

    const presence = await listBoardPresence(store, boardId);
    return jsonResponse(200, {
      ok: true,
      changed: false,
      boardId,
      updatedAt: currentUpdatedAt,
      presence,
    });
  }

  if (action === "touch_presence") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (!role) return errorResponse(403, "Acces refuse.");

    const presence = await touchBoardPresence(store, board, user, role, body);
    return jsonResponse(200, {
      ok: true,
      boardId,
      presence,
    });
  }

  if (action === "clear_presence") {
    const boardId = String(body.boardId || "");
    if (boardId) {
      await clearBoardPresence(store, boardId, user.id);
    }
    return jsonResponse(200, {
      ok: true,
      boardId,
    });
  }

  if (action === "save_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (!canEditBoard(role)) return errorResponse(403, "Modification interdite.");
    const lockResult = await acquireBoardEditLock(store, board, user, role);
    if (!lockResult.ok) {
      return errorResponse(lockResult.statusCode || 423, lockResult.error || "Edition deja reservee.", {
        editLock: lockResult.lock || null,
      });
    }

    const data = body.data;
    const page = normalizePage(board.page || body.page || "point");
    if (!validateBoardData(data, page)) {
      return errorResponse(400, "Donnees du tableau invalides.");
    }
    const baseData = page === "map" && body.baseData && typeof body.baseData === "object"
      ? body.baseData
      : null;
    if (page === "map" && body.baseData !== undefined && body.baseData !== null && !validateMapBoardData(baseData)) {
      return errorResponse(400, "Base de fusion map invalide.");
    }

    const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
    const hadVersionDrift = Boolean(expectedUpdatedAt && String(board.updatedAt || "") !== expectedUpdatedAt);

    const nextTitle = normalizeTitle(body.title || board.title);
    const normalizedCurrent = normalizeBoardDataByPage(page, board.data, {
      fallbackUpdatedAt: board.updatedAt || "",
      fallbackUser: board.lastEditedBy?.username || board.ownerName || "",
    });
    const mergedData = page === "map"
      ? (hadVersionDrift ? mergeMapBoardPayload(board.data, data, baseData) : normalizeMapBoardPayload(data))
      : mergeBoardPayload(board.data, data, {
          existingUpdatedAt: board.updatedAt || "",
          incomingUpdatedAt: expectedUpdatedAt || nowIso(),
          existingUser: board.lastEditedBy?.username || board.ownerName || "",
          incomingUser: user.username,
        });
    const sameData = isSameBoardPayloadByPage(page, normalizedCurrent, mergedData, {
      fallbackUpdatedAt: board.updatedAt || "",
      fallbackUser: board.lastEditedBy?.username || board.ownerName || "",
    });
    const sameTitle = String(nextTitle) === String(board.title || "");
    const presence = await touchBoardPresence(store, board, user, role, body);
    if (sameData && sameTitle) {
      return jsonResponse(200, {
        ok: true,
      board: {
        ...boardSummary(board, role),
        data: normalizedCurrent,
        activity: normalizeBoardActivity(board),
      },
      unchanged: true,
      mergedConflict: hadVersionDrift,
      presence,
      editLock: lockResult.lock || null,
    });
    }

    const now = nowIso();
    const deltaSummary = summarizeBoardDeltaByPage(page, normalizedCurrent, mergedData, { mergedConflict: hadVersionDrift });
    board.data = mergedData;
    board.title = nextTitle;
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "save", `a modifie le board (${deltaSummary})`);

    await saveBoard(store, board);
    return jsonResponse(200, {
      ok: true,
      board: {
        ...boardSummary(board, role),
        data: board.data,
        activity: normalizeBoardActivity(board),
      },
      mergedConflict: hadVersionDrift,
      presence,
      editLock: lockResult.lock || null,
    });
  }

  if (action === "rename_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut renommer.");

    const nextTitle = normalizeTitle(body.title || board.title);
    if (String(nextTitle) === String(board.title || "")) {
      return jsonResponse(200, {
        ok: true,
        board: boardSummary(board, role),
        unchanged: true,
      });
    }

    const now = nowIso();
    board.title = nextTitle;
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "rename", `a renomme le board en "${nextTitle}"`);

    await saveBoard(store, board);
    return jsonResponse(200, {
      ok: true,
      board: {
        ...boardSummary(board, role),
        activity: normalizeBoardActivity(board),
      },
    });
  }

  if (action === "delete_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut supprimer.");

    const memberIds = new Set([
      String(board.ownerId || ""),
      ...(Array.isArray(board.members) ? board.members.map((member) => String(member.userId || "")) : []),
    ].filter(Boolean));
    await store.delete(boardKey(boardId));
    await Promise.all([...memberIds].map((memberId) => removeUserBoardRef(store, memberId, boardId)));
    return jsonResponse(200, { ok: true, deleted: true, boardId });
  }

  if (action === "share_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut partager.");

    const usernameCheck = normalizeUsername(body.username);
    if (!usernameCheck.ok) return errorResponse(400, "Nom utilisateur invalide.");

    const targetUser = await getUserByUsername(store, usernameCheck.username);
    if (!targetUser) return errorResponse(404, "Utilisateur introuvable.");
    const unsupportedShareRoleMessage = getUnsupportedShareRoleMessage(body.role, board, targetUser);
    if (unsupportedShareRoleMessage) {
      return errorResponse(400, unsupportedShareRoleMessage);
    }

    const memberRole = sanitizeShareRole(body.role);
    const now = nowIso();
    board.members = withMember(board, {
      userId: targetUser.id,
      username: targetUser.username,
      role: targetUser.id === board.ownerId ? ROLE_OWNER : memberRole,
      addedAt: now,
    });
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "member", `a ajoute ${targetUser.username} (${targetUser.id === board.ownerId ? ROLE_OWNER : memberRole})`);

    await saveBoard(store, board);
    await addUserBoardRef(store, targetUser.id, boardId);
    return jsonResponse(200, {
      ok: true,
      members: board.members,
    });
  }

  if (action === "search_users") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut rechercher des membres.");

    const users = await searchUsersForBoard(store, board, user.id, body.query, {
      limit: body.limit,
    });
    return jsonResponse(200, {
      ok: true,
      users,
    });
  }

  if (action === "remove_member") {
    const boardId = String(body.boardId || "");
    const targetUserId = String(body.userId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut retirer.");
    if (!targetUserId) return errorResponse(400, "Utilisateur cible manquant.");
    if (targetUserId === String(board.ownerId)) return errorResponse(400, "Impossible de retirer le lead.");

    const removedMember = (Array.isArray(board.members) ? board.members : []).find((member) => String(member.userId) === targetUserId);
    board.members = withoutMember(board, targetUserId);
    const now = nowIso();
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "member", `a retire ${removedMember?.username || "un membre"}`);
    await saveBoard(store, board);
    await removeUserBoardRef(store, targetUserId, boardId);

    return jsonResponse(200, { ok: true, members: board.members });
  }

  if (action === "transfer_board") {
    const boardId = String(body.boardId || "");
    const targetUserId = String(body.userId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");

    const role = getRoleForUser(board, user.id);
    if (role !== ROLE_OWNER) return errorResponse(403, "Seul le lead peut transferer.");
    if (!targetUserId) return errorResponse(400, "Utilisateur cible manquant.");
    if (targetUserId === String(board.ownerId)) return errorResponse(400, "Cet utilisateur est deja lead.");

    const targetUser = await getUserById(store, targetUserId);
    if (!targetUser) return errorResponse(404, "Utilisateur cible introuvable.");

    const now = nowIso();
    board.members = withMember(board, {
      userId: board.ownerId,
      username: board.ownerName,
      role: ROLE_EDITOR,
      addedAt: now,
    });
    board.members = withMember(board, {
      userId: targetUser.id,
      username: targetUser.username,
      role: ROLE_OWNER,
      addedAt: now,
    });

    board.ownerId = targetUser.id;
    board.ownerName = targetUser.username;
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "member", `a donne le lead a ${targetUser.username}`);

    await saveBoard(store, board);
    await addUserBoardRef(store, targetUser.id, boardId);
    return jsonResponse(200, {
      ok: true,
      board: {
        ...boardSummary(board, getRoleForUser(board, user.id)),
        activity: normalizeBoardActivity(board),
      },
      members: board.members,
    });
  }

  if (action === "leave_board") {
    const boardId = String(body.boardId || "");
    const board = await loadBoard(store, boardId);
    if (!board) return errorResponse(404, "Tableau introuvable.");
    const role = getRoleForUser(board, user.id);
    if (!role) return errorResponse(403, "Acces refuse.");
    if (role === ROLE_OWNER) {
      return errorResponse(400, "Le lead doit transferer avant de quitter.");
    }
    board.members = withoutMember(board, user.id);
    const now = nowIso();
    board.updatedAt = now;
    board.lastEditedBy = {
      userId: user.id,
      username: user.username,
      at: now,
    };
    appendBoardActivity(board, user, "member", "a quitte le board");
    await saveBoard(store, board);
    await removeUserBoardRef(store, user.id, boardId);
    await releaseBoardEditLock(store, boardId, user.id).catch(() => {});
    return jsonResponse(200, { ok: true });
  }

  return errorResponse(400, "Action inconnue.");
};

exports.__test = {
  canonicalizeBoardPayloadByPage,
  normalizeMapBoardPayload,
  mergeMapBoardPayload,
  normalizeBoardPayload,
  mergeBoardPayload,
  normalizeBoardActivity,
  appendBoardActivity,
  summarizeBoardDeltaByPage,
  sanitizeShareRole,
  getUnsupportedShareRoleMessage,
  listBoardPresence,
  touchBoardPresence,
  clearBoardPresence,
  normalizeBoardEditLock,
  acquireBoardEditLock,
  releaseBoardEditLock,
  describeBoardEditLock,
  searchUsersForBoard,
};
