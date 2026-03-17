const { resolveAuth } = require("./collab");

const API_KEY = String(process.env.BNI_LINKED_KEY || "").trim();
const REQUIRE_AUTH = process.env.BNI_LINKED_REQUIRE_AUTH !== "0";

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-collab-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-collab-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: "",
  };
}

function getHeader(event, name) {
  const wanted = String(name || "").toLowerCase();
  const headers = event?.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return value;
  }
  return "";
}

async function authorizeDbRequest(event, body = null) {
  if (!REQUIRE_AUTH) {
    return { ok: true, mode: "open", auth: null };
  }

  const suppliedApiKey = String(getHeader(event, "x-api-key") || "").trim();
  if (API_KEY && suppliedApiKey && suppliedApiKey === API_KEY) {
    return { ok: true, mode: "api-key", auth: null };
  }

  const auth = await resolveAuth(event, body).catch(() => null);
  if (auth?.ok) {
    return { ok: true, mode: "collab", auth };
  }

  return {
    ok: false,
    statusCode: Number(auth?.statusCode || 401),
    error: String(auth?.error || "Unauthorized"),
  };
}

module.exports = {
  jsonResponse,
  preflightResponse,
  authorizeDbRequest,
};
