const { normalizePage } = require("./db-index");

function cleanText(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function slugify(value, fallback = "item") {
  const text = cleanText(value, fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function humanizeToken(value, fallback = "Archive") {
  const text = cleanText(value, fallback)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  return text || fallback;
}

function humanizeAction(action, fallback = "Archive") {
  const cleanAction = cleanText(action).toLowerCase();
  if (!cleanAction) return fallback;

  const actionKind = cleanAction.startsWith("import") ? "IMPORT" : "EXPORT";
  const suffix = cleanAction
    .replace(/^import[-_]?/, "")
    .replace(/^export[-_]?/, "");
  const label = humanizeToken(suffix, actionKind);
  return suffix ? `${actionKind} ${label}` : actionKind;
}

function normalizeSearchText(parts = []) {
  return parts
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function countMapPoints(groups = []) {
  return groups.reduce((total, group) => (
    total + (Array.isArray(group?.points) ? group.points.length : 0)
  ), 0);
}

function countMapZones(groups = []) {
  return groups.reduce((total, group) => (
    total + (Array.isArray(group?.zones) ? group.zones.length : 0)
  ), 0);
}

function summarizePointData(data = {}) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const links = Array.isArray(data?.links) ? data.links : [];
  return {
    nodes: nodes.length,
    links: links.length,
    unnamedNodes: nodes.filter((node) => !cleanText(node?.name)).length,
    people: nodes.filter((node) => cleanText(node?.type).toLowerCase() === "person").length,
    groups: nodes.filter((node) => cleanText(node?.type).toLowerCase() === "group").length,
    companies: nodes.filter((node) => cleanText(node?.type).toLowerCase() === "company").length,
  };
}

function summarizeMapData(data = {}) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return {
    groups: groups.length,
    points: countMapPoints(groups),
    zones: countMapZones(groups),
    tacticalLinks: Array.isArray(data?.tacticalLinks) ? data.tacticalLinks.length : 0,
  };
}

function buildPointStatLines(stats = {}) {
  const lines = [
    `${Number(stats.nodes || 0)} fiches`,
    `${Number(stats.links || 0)} liens`,
  ];
  if (Number(stats.unnamedNodes || 0) > 0) {
    lines.push(`${Number(stats.unnamedNodes || 0)} sans nom`);
  }
  return lines;
}

function buildMapStatLines(stats = {}) {
  return [
    `${Number(stats.groups || 0)} groupes`,
    `${Number(stats.points || 0)} points`,
    `${Number(stats.zones || 0)} zones`,
    `${Number(stats.tacticalLinks || 0)} liaisons`,
  ];
}

function resolveTitleCandidate(page, action, data = {}) {
  const meta = data && typeof data === "object" && data.meta && typeof data.meta === "object"
    ? data.meta
    : {};
  const fallbackTitle = humanizeToken(
    cleanText(action)
      .replace(/^import[-_]?/i, "")
      .replace(/^export[-_]?/i, ""),
    page === "map" ? "Carte tactique" : "Reseau"
  );

  return cleanText(
    meta.projectName ||
    meta.title ||
    data.projectName ||
    data.title ||
    meta.fileName ||
    data.currentFileName ||
    fallbackTitle,
    fallbackTitle
  );
}

function buildArchiveSummary(page, action, data = {}, options = {}) {
  const normalizedPage = normalizePage(page) || "point";
  const cleanAction = cleanText(action, "export-standard").toLowerCase();
  const actionKind = cleanAction.startsWith("import") ? "import" : "export";
  const title = resolveTitleCandidate(normalizedPage, cleanAction, data);
  const stats = normalizedPage === "map"
    ? summarizeMapData(data)
    : summarizePointData(data);
  const statLines = normalizedPage === "map"
    ? buildMapStatLines(stats)
    : buildPointStatLines(stats);
  const updatedAt = cleanText(data?.meta?.date || data?.updatedAt || options.createdAt || "");

  return {
    title,
    sourceLabel: title,
    sourceKey: slugify(title, slugify(cleanAction, "archive")),
    actionKind,
    actionLabel: humanizeAction(cleanAction),
    updatedAt,
    stats,
    statLines,
    matchText: normalizeSearchText([
      title,
      humanizeAction(cleanAction),
      cleanAction,
      options.key,
      normalizedPage,
      ...statLines,
    ]),
  };
}

function summarizeBoardData(page, data = {}) {
  const normalizedPage = normalizePage(page) || "point";
  const stats = normalizedPage === "map"
    ? summarizeMapData(data)
    : summarizePointData(data);
  return {
    page: normalizedPage,
    stats,
    statLines: normalizedPage === "map"
      ? buildMapStatLines(stats)
      : buildPointStatLines(stats),
  };
}

module.exports = {
  buildArchiveSummary,
  humanizeAction,
  normalizeSearchText,
  summarizeBoardData,
  summarizeMapData,
  summarizePointData,
};
