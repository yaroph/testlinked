const crypto = require("node:crypto");

// Store only a slow verification hash for the permanent code in this public repository.
const PERMANENT_CODE_SALT = "bni-linked:permanent-staff:v1";
const PERMANENT_CODE_HASH = Buffer.from("0b224985b660ed930bc478b4be9230971bb23d1d8c2bf8969b97eab0e7932f29", "hex");

function getHeader(event, name) {
  const entry = Object.entries(event?.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1] || "").trim() : "";
}

function isStaffCode(value, { allowLegacy = true } = {}) {
  const code = String(value || "").trim();
  if (!code || code.length > 256) return false;
  const configured = String(process.env.BNI_LINKED_STAFF_CODE || "").trim();
  if (configured && code === configured) return true;
  if (allowLegacy && code === "staff") return true;
  return crypto.timingSafeEqual(crypto.scryptSync(code, PERMANENT_CODE_SALT, 32), PERMANENT_CODE_HASH);
}

function hasStaffCode(event, body = null, options = {}) {
  return isStaffCode(getHeader(event, "x-staff-code"), options) || isStaffCode(body?.accessCode, options);
}

function authorizeDatabaseAdmin(event, body = null) {
  const apiKey = String(process.env.BNI_LINKED_KEY || "").trim();
  if (apiKey && getHeader(event, "x-api-key") === apiKey) return { ok: true, mode: "api-key" };
  if (hasStaffCode(event, body, { allowLegacy: false })) return { ok: true, mode: "staff" };
  return { ok: false, statusCode: 401, error: "Code administrateur requis pour consulter tous les clouds." };
}

module.exports = { hasStaffCode, authorizeDatabaseAdmin };
