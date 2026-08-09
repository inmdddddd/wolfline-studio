const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

// Unit coverage for lib/square.js in isolation - no server, no network.
// BECA_TEST_MODE is already set by test/setup-env.js's --require preload
// (see package.json's "test" script), so createPayment/refundPayment would
// throw immediately unless square.request is stubbed - exactly the
// structural guarantee this file exercises directly.

const square = require("../lib/square");
const originalRequest = square.request;

function configure() {
  process.env.SQUARE_ACCESS_TOKEN = "test-access-token";
  process.env.SQUARE_LOCATION_ID = "test-location-id";
  process.env.SQUARE_ENVIRONMENT = "sandbox";
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "test-webhook-signing-key";
}

test.afterEach(() => {
  square.request = originalRequest;
  delete process.env.SQUARE_ACCESS_TOKEN;
  delete process.env.SQUARE_LOCATION_ID;
  delete process.env.SQUARE_ENVIRONMENT;
  delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
});

test("isConfigured is false with no credentials set", () => {
  assert.equal(square.isConfigured(), false);
});

test("isConfigured is true once an access token and location id are set", () => {
  configure();
  assert.equal(square.isConfigured(), true);
});

test("createPayment refuses to run under BECA_TEST_MODE when request was never stubbed", async () => {
  configure();
  await assert.rejects(
    () => square.createPayment({ sourceId: "cnon:test", amountMoney: { amount: 100, currency: "GBP" }, idempotencyKey: "k1" }),
    /BECA_TEST_MODE/
  );
});

test("refundPayment refuses to run under BECA_TEST_MODE when request was never stubbed", async () => {
  configure();
  await assert.rejects(
    () => square.refundPayment({ paymentId: "sq-1", amountMoney: { amount: 100, currency: "GBP" }, idempotencyKey: "k1" }),
    /BECA_TEST_MODE/
  );
});

test("createPayment returns ok with paymentId/status on a stubbed success, and forwards reference_id/location_id", async () => {
  configure();
  square.request = async (method, urlPath, body) => {
    assert.equal(method, "POST");
    assert.equal(urlPath, "/v2/payments");
    assert.equal(body.source_id, "cnon:card-nonce-ok");
    assert.equal(body.amount_money.amount, 4999);
    assert.equal(body.reference_id, "BC-0001");
    assert.equal(body.location_id, "test-location-id");
    return { payment: { id: "sq-payment-1", status: "COMPLETED", amount_money: body.amount_money } };
  };

  const result = await square.createPayment({
    sourceId: "cnon:card-nonce-ok",
    amountMoney: { amount: 4999, currency: "GBP" },
    idempotencyKey: "k1",
    referenceId: "BC-0001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.paymentId, "sq-payment-1");
  assert.equal(result.status, "COMPLETED");
});

test("createPayment returns a clean (non-ambiguous) decline when Square responds with an error", async () => {
  configure();
  square.request = async () => {
    const error = new Error("Square POST /v2/payments -> HTTP 402");
    error.squareBody = { errors: [{ code: "CARD_DECLINED", category: "PAYMENT_METHOD_ERROR", detail: "Card was declined." }] };
    error.httpStatus = 402;
    throw error;
  };

  const result = await square.createPayment({ sourceId: "cnon:declined", amountMoney: { amount: 100, currency: "GBP" }, idempotencyKey: "k2" });
  assert.equal(result.ok, false);
  assert.equal(result.ambiguous, undefined);
  assert.equal(result.errors[0].code, "CARD_DECLINED");
});

test("createPayment marks a transport failure as ambiguous, not a clean decline", async () => {
  configure();
  square.request = async () => {
    const error = new Error("fetch failed");
    error.squareAmbiguous = true;
    throw error;
  };

  const result = await square.createPayment({ sourceId: "cnon:x", amountMoney: { amount: 100, currency: "GBP" }, idempotencyKey: "k3" });
  assert.equal(result.ok, false);
  assert.equal(result.ambiguous, true);
});

test("createPayment reports NOT_CONFIGURED without ever calling request", async () => {
  square.request = async () => {
    throw new Error("must not be called when Square is not configured");
  };
  const result = await square.createPayment({ sourceId: "cnon:x", amountMoney: { amount: 100, currency: "GBP" }, idempotencyKey: "k9" });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "NOT_CONFIGURED");
});

test("refundPayment returns ok with refundId/status on a stubbed success", async () => {
  configure();
  square.request = async (method, urlPath, body) => {
    assert.equal(method, "POST");
    assert.equal(urlPath, "/v2/refunds");
    assert.equal(body.payment_id, "sq-payment-1");
    return { refund: { id: "sq-refund-1", status: "PENDING", payment_id: "sq-payment-1" } };
  };

  const result = await square.refundPayment({
    paymentId: "sq-payment-1",
    amountMoney: { amount: 4999, currency: "GBP" },
    idempotencyKey: "k4"
  });

  assert.equal(result.ok, true);
  assert.equal(result.refundId, "sq-refund-1");
  assert.equal(result.status, "PENDING");
});

test("verifyWebhookSignature accepts a correctly signed body", () => {
  configure();
  const rawBody = Buffer.from(JSON.stringify({ type: "payment.updated" }));
  const notificationUrl = "https://payments-test.local/api/webhooks/square";
  const signature = crypto
    .createHmac("sha256", process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(notificationUrl + rawBody.toString("utf8"))
    .digest("base64");

  assert.equal(square.verifyWebhookSignature({ rawBody, signatureHeader: signature, notificationUrl }), true);
});

test("verifyWebhookSignature rejects a tampered body", () => {
  configure();
  const notificationUrl = "https://payments-test.local/api/webhooks/square";
  const signature = crypto
    .createHmac("sha256", process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(notificationUrl + JSON.stringify({ type: "payment.updated" }))
    .digest("base64");
  const tamperedBody = Buffer.from(JSON.stringify({ type: "payment.updated", extra: "injected" }));

  assert.equal(square.verifyWebhookSignature({ rawBody: tamperedBody, signatureHeader: signature, notificationUrl }), false);
});

test("verifyWebhookSignature rejects a signature made with the wrong key", () => {
  configure();
  const notificationUrl = "https://payments-test.local/api/webhooks/square";
  const rawBody = Buffer.from(JSON.stringify({ type: "payment.updated" }));
  const wrongSignature = crypto.createHmac("sha256", "not-the-real-key").update(notificationUrl + rawBody.toString("utf8")).digest("base64");

  assert.equal(square.verifyWebhookSignature({ rawBody, signatureHeader: wrongSignature, notificationUrl }), false);
});

test("verifyWebhookSignature rejects when no signing key is configured", () => {
  const rawBody = Buffer.from("{}");
  assert.equal(square.verifyWebhookSignature({ rawBody, signatureHeader: "anything", notificationUrl: "https://x/y" }), false);
});

test("verifyWebhookSignature rejects when notificationUrl is missing", () => {
  configure();
  const rawBody = Buffer.from("{}");
  assert.equal(square.verifyWebhookSignature({ rawBody, signatureHeader: "anything", notificationUrl: "" }), false);
});
