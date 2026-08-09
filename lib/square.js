const crypto = require("crypto");

/* Zero-dependency Square REST client (mirrors lib/email.js's style: only
   Node core/globals, no npm package - uses the global fetch() that ships
   with Node >=22.13, so there isn't even an "https" require).

   This module is required independently by server.js and by tests, so - like
   lib/email.js does for SMTP/brand config - it resolves its own brand
   context from process.env rather than having it passed in.

   Sandbox vs production is picked explicitly by SQUARE_ENVIRONMENT, never
   guessed from the access token's shape, so a misconfigured env can't
   silently start charging real cards from what looks like a test deploy. */

const BRAND_ID = String(process.env.BRAND || "beca").trim().toLowerCase();
const BRAND_ENV_SUFFIX = BRAND_ID.toUpperCase().replace(/[^A-Z0-9]/g, "_");

function brandEnv(key) {
  const scoped = process.env[`${key}_${BRAND_ENV_SUFFIX}`];
  if (typeof scoped === "string" && scoped.trim() !== "") return scoped;
  return process.env[key];
}

function getConfig() {
  const environment = String(brandEnv("SQUARE_ENVIRONMENT") || "sandbox").trim().toLowerCase();
  return {
    environment,
    baseUrl: environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
    accessToken: brandEnv("SQUARE_ACCESS_TOKEN") || "",
    locationId: brandEnv("SQUARE_LOCATION_ID") || "",
    applicationId: brandEnv("SQUARE_APPLICATION_ID") || "",
    webhookSignatureKey: brandEnv("SQUARE_WEBHOOK_SIGNATURE_KEY") || "",
    // Square requires a calendar-dated API version header; pinned to a known
    // value but overridable without a code change if Square deprecates it.
    squareVersion: brandEnv("SQUARE_VERSION") || "2026-07-15"
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.accessToken && config.locationId);
}

// The real network call, isolated behind module.exports.request (not a local
// function reference) so tests can replace `square.request` with a stub and
// have createPayment/refundPayment - which always call `square.request(...)`,
// never the local realRequest directly - pick it up. guardTestMode() below
// detects "nobody replaced it" by identity comparison against this function.
async function realRequest(method, urlPath, body) {
  const config = getConfig();
  let response;
  try {
    response = await fetch(`${config.baseUrl}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Square-Version": config.squareVersion,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    // fetch() itself threw: DNS/timeout/connection reset - Square never
    // definitively answered. Must NOT be treated as a clean decline (that
    // would let a caller retry and risk double-charging the same card).
    error.squareAmbiguous = true;
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Square ${method} ${urlPath} -> HTTP ${response.status}`);
    error.squareBody = payload;
    error.httpStatus = response.status;
    throw error;
  }
  return payload;
}

const square = {
  request: realRequest,
  createPayment,
  refundPayment,
  verifyWebhookSignature,
  isConfigured,
  getConfig
};

// BECA_TEST_MODE is a hard stop, the same shape as server.js's own .env-load
// guard: if a test forgets to stub square.request, any real call throws
// immediately instead of letting fetch() attempt a live network request
// (which, against an unconfigured/empty SQUARE_ACCESS_TOKEN in a test
// process, would otherwise fail unpredictably or hang rather than fail loud).
function guardTestMode() {
  if (process.env.BECA_TEST_MODE && square.request === realRequest) {
    throw new Error(
      "[square] BECA_TEST_MODE este activ si square.request nu a fost inlocuit cu un stub. " +
      "Testele nu trebuie sa poata atinge Square real - vezi test/square.test.js pentru pattern."
    );
  }
}

function toErrorList(body) {
  return Array.isArray(body?.errors) ? body.errors : [];
}

async function createPayment({ sourceId, amountMoney, idempotencyKey, referenceId }) {
  guardTestMode();
  if (!isConfigured()) {
    return { ok: false, errors: [{ code: "NOT_CONFIGURED", detail: "Square nu este configurat." }] };
  }

  try {
    const body = await square.request("POST", "/v2/payments", {
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: amountMoney,
      location_id: getConfig().locationId,
      reference_id: referenceId || undefined
    });
    return { ok: true, paymentId: body.payment?.id, status: body.payment?.status, raw: body.payment };
  } catch (error) {
    if (error.squareAmbiguous) {
      return { ok: false, ambiguous: true, errors: [{ code: "NETWORK_ERROR", detail: error.message }] };
    }
    return { ok: false, errors: toErrorList(error.squareBody) };
  }
}

async function refundPayment({ paymentId, amountMoney, idempotencyKey, reason }) {
  guardTestMode();
  if (!isConfigured()) {
    return { ok: false, errors: [{ code: "NOT_CONFIGURED", detail: "Square nu este configurat." }] };
  }

  try {
    const body = await square.request("POST", "/v2/refunds", {
      idempotency_key: idempotencyKey,
      payment_id: paymentId,
      amount_money: amountMoney,
      reason: reason || undefined
    });
    return { ok: true, refundId: body.refund?.id, status: body.refund?.status, raw: body.refund };
  } catch (error) {
    if (error.squareAmbiguous) {
      return { ok: false, ambiguous: true, errors: [{ code: "NETWORK_ERROR", detail: error.message }] };
    }
    return { ok: false, errors: toErrorList(error.squareBody) };
  }
}

// header = base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)),
// compared the same timing-safe way orderTokenMatches() in server.js compares
// order access tokens (length check first, since timingSafeEqual throws
// rather than returning false on a length mismatch). notificationUrl must be
// byte-identical to the URL registered in the Square dashboard for this
// webhook subscription - the caller passes it in (server.js derives it from
// SITE_ORIGIN, the same source every other outbound link in this app uses)
// rather than this module inventing a second, possibly-drifting env var for it.
function verifyWebhookSignature({ rawBody, signatureHeader, notificationUrl }) {
  const config = getConfig();
  if (!config.webhookSignatureKey || !signatureHeader || !notificationUrl) return false;

  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const expected = crypto.createHmac("sha256", config.webhookSignatureKey).update(notificationUrl + bodyString).digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(String(signatureHeader), "utf8");
  return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = square;
