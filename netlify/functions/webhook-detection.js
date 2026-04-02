const {
  jsonResponse,
  preflightResponse,
} = require("../lib/db-auth");
const {
  getWebhookDetectionStore,
  listDetections,
  sanitizeLimit,
  saveDetection,
} = require("../lib/webhook-detection-store");
const { connectLambda } = require("../lib/blob-store");

function logWebhookEvent(message, details = {}) {
  try {
    console.log("[webhook-detection]", message, JSON.stringify(details));
  } catch (error) {
    console.log("[webhook-detection]", message);
  }
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return preflightResponse();
  }

  const method = String(event.httpMethod || "GET").toUpperCase();
  const store = getWebhookDetectionStore();

  if (method === "GET") {
    try {
      const limit = sanitizeLimit(event.queryStringParameters?.limit);
      const items = await listDetections(store, { limit });
      logWebhookEvent("list", { count: items.length, limit });
      return jsonResponse(200, {
        ok: true,
        count: items.length,
        limit,
        items,
      });
    } catch (error) {
      console.error("webhook-detection GET error:", error);
      return jsonResponse(500, {
        ok: false,
        error: "Impossible de recuperer les detections webhook.",
      });
    }
  }

  if (method === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (error) {
      return jsonResponse(400, {
        ok: false,
        error: "JSON invalide.",
      });
    }

    try {
      const result = await saveDetection(store, body, { receivedAtMs: Date.now() });
      logWebhookEvent(result.duplicate ? "duplicate" : "stored", {
        player: result.item?.player || "",
        type: result.item?.type || "",
        id: result.item?.id || "",
      });
      return jsonResponse(result.duplicate ? 200 : 201, {
        ok: true,
        duplicate: Boolean(result.duplicate),
        item: result.item,
      });
    } catch (error) {
      return jsonResponse(400, {
        ok: false,
        error: String(error?.message || "Payload webhook invalide."),
      });
    }
  }

  return jsonResponse(405, {
    ok: false,
    error: "Method not allowed",
  });
};
