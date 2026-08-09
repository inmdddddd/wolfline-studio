const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// HTTP/integration coverage for the Square Sandbox flow: checkout -> pay ->
// paid+confirmed, idempotency (double pay / duplicate webhook), declined and
// ambiguous-failure handling, webhook signature verification, and admin
// refunds. square.request is stubbed throughout (see stubSquareRequest
// below) - this suite never makes a real network call to Square, same
// structural guarantee test/square.test.js checks directly.

const square = require("../lib/square");
const originalSquareRequest = square.request;

const ADMIN_EMAIL = "admin@payments-test.local";
const ADMIN_PASSWORD = "admintestpass123";
const WEBHOOK_SIGNING_KEY = "test-webhook-signing-key";
const SITE_ORIGIN = "https://payments-test.local";

let tempDir;
let httpServer;
let baseUrl;
let adminCookie;

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

// clientIp() in server.js only trusts X-Forwarded-For when the actual socket
// peer is localhost - true here, since this whole suite talks to baseUrl
// over loopback - which lets each simulated "customer" get its own
// rate-limit bucket instead of every test in this file sharing one (the
// checkout/pay limiters are deliberately tight - 10/min and 5/min per IP -
// and this file alone makes far more than 5 pay attempts across its
// scenarios). Mirrors exactly how a real reverse proxy sets this header for
// distinct real clients; nothing here weakens the limiter itself.
function randomTestIp() {
  return `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
}

async function jsonRequest(pathname, { method = "GET", body, cookie, ip } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(ip ? { "X-Forwarded-For": ip } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, response };
}

function readOutbox() {
  return JSON.parse(fs.readFileSync(path.join(tempDir, "email-outbox.json"), "utf8"));
}

function countOutboxEntriesFor(emailAddress, subjectPattern) {
  return readOutbox().filter((entry) => entry.to === emailAddress && (!subjectPattern || subjectPattern.test(entry.subject))).length;
}

// Places a guest checkout for qty 1 of the seeded default product (25 units
// total, spread S:7/M:6/L:6/XL:6 - see config/brands/beca.json) and returns
// { order, publicAccessToken, ip }. Picks whichever size currently has the
// most remaining stock (re-checked fresh on every call) rather than always
// the first one, so this file's ~15 checkouts spread across all four sizes
// instead of exhausting a single 6-7 unit size partway through the run.
async function placeCheckout() {
  const ip = randomTestIp();
  const { payload: productsPayload } = await jsonRequest("/api/products", { ip });
  const product = productsPayload.products[0];
  const sizeStock = product.sizeStock || {};
  const size = Object.keys(sizeStock).length
    ? Object.entries(sizeStock).sort((a, b) => b[1] - a[1])[0][0]
    : "";

  const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "X-Forwarded-For": ip },
    body: JSON.stringify({ productId: product.id, size, qty: 1 })
  });
  assert.equal(addResponse.status, 200, "cart add must succeed");
  const cartCookie = cookiesFrom(addResponse);

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cartCookie, "X-Forwarded-For": ip },
    body: JSON.stringify({
      customerName: "Payments Buyer",
      customerEmail: `buyer-${crypto.randomUUID()}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Iasi"
    })
  });
  const payload = await checkoutResponse.json().catch(() => ({}));
  assert.equal(checkoutResponse.status, 200, `checkout must succeed: ${JSON.stringify(payload)}`);
  return { order: payload.order, publicAccessToken: payload.publicAccessToken, ip };
}

function payOrder(orderId, { sourceId = "cnon:card-nonce-ok", token, ip } = {}) {
  return jsonRequest(`/api/orders/${orderId}/pay`, { method: "POST", body: { sourceId, token }, ip });
}

function signWebhookBody(bodyString) {
  const notificationUrl = `${SITE_ORIGIN}/api/webhooks/square`;
  return crypto.createHmac("sha256", WEBHOOK_SIGNING_KEY).update(notificationUrl + bodyString).digest("base64");
}

async function postWebhook(eventObject, { signature } = {}) {
  const bodyString = JSON.stringify(eventObject);
  const response = await fetch(`${baseUrl}/api/webhooks/square`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": signature !== undefined ? signature : signWebhookBody(bodyString)
    },
    body: bodyString
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function paymentUpdatedEvent(order, { paymentId = `sq-payment-${crypto.randomUUID()}` } = {}) {
  return {
    type: "payment.updated",
    data: {
      type: "payment",
      id: paymentId,
      object: {
        payment: {
          id: paymentId,
          status: "COMPLETED",
          reference_id: order.number,
          amount_money: { amount: Math.round(order.total * 100), currency: order.currency }
        }
      }
    }
  };
}

// handlers: { "POST /v2/payments": async (body) => ({...}), "POST /v2/refunds": async (body) => ({...}) }
// Any call not covered by `handlers` throws loudly - a test that expects zero
// Square calls passes {} and any unexpected call fails immediately instead
// of silently hitting the real network.
function stubSquareRequest(handlers) {
  square.request = async (method, urlPath, body) => {
    const key = `${method} ${urlPath}`;
    if (!handlers[key]) throw new Error(`Unexpected Square call in test: ${key}`);
    return handlers[key](body);
  };
}

function stubSquareApproveAll() {
  stubSquareRequest({
    "POST /v2/payments": async (body) => ({
      payment: { id: `sq-payment-${crypto.randomUUID()}`, status: "COMPLETED", amount_money: body.amount_money }
    }),
    "POST /v2/refunds": async (body) => ({
      refund: { id: `sq-refund-${crypto.randomUUID()}`, status: "COMPLETED", payment_id: body.payment_id, amount_money: body.amount_money }
    })
  });
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-payments-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  process.env.SITE_ORIGIN = SITE_ORIGIN;
  process.env.SQUARE_ACCESS_TOKEN = "test-access-token";
  process.env.SQUARE_LOCATION_ID = "test-location-id";
  process.env.SQUARE_APPLICATION_ID = "test-app-id";
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = WEBHOOK_SIGNING_KEY;
  process.env.SQUARE_ENVIRONMENT = "sandbox";

  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  const server = require("../server.js");

  httpServer = server.start();
  await new Promise((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(loginResponse.status, 200);
  adminCookie = cookiesFrom(loginResponse);
});

test.after(() => {
  require("../server.js").stop();
  httpServer?.close();
  square.request = originalSquareRequest;
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.afterEach(() => {
  square.request = originalSquareRequest;
});

test("GET /api/square-config reports enabled with the configured client-side ids", async () => {
  const { payload } = await jsonRequest("/api/square-config");
  assert.equal(payload.enabled, true);
  assert.equal(payload.applicationId, "test-app-id");
  assert.equal(payload.environment, "sandbox");
});

test("GET /api/square-config reports disabled once Square is unconfigured", async () => {
  const saved = process.env.SQUARE_ACCESS_TOKEN;
  delete process.env.SQUARE_ACCESS_TOKEN;
  try {
    const { payload } = await jsonRequest("/api/square-config");
    assert.equal(payload.enabled, false);
  } finally {
    process.env.SQUARE_ACCESS_TOKEN = saved;
  }
});

test("checkout -> pay settles the order to paid+confirmed and sends exactly one payment-confirmed email", async () => {
  stubSquareApproveAll();
  const { order, publicAccessToken, ip } = await placeCheckout();
  assert.equal(order.paymentStatus, "unpaid");
  assert.equal(order.status, "pending");

  const { status, payload } = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.order.paymentStatus, "paid");
  assert.equal(payload.order.status, "confirmed");
  assert.equal(countOutboxEntriesFor(order.customerEmail, /plata confirmata/i), 1);
});

test("paying an already-paid order is a safe no-op and never calls Square again", async () => {
  stubSquareApproveAll();
  const { order, publicAccessToken, ip } = await placeCheckout();
  const first = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(first.status, 200);
  // Settling rotates the guest access token (see settlePaidSquarePayment) -
  // a real client would follow the fresh token the response just handed
  // back, same as this second call does, not keep reusing the one it just
  // spent (which the server would now correctly treat as stale/unknown).
  assert.ok(first.payload.publicAccessToken, "a real settlement must return a fresh token");

  stubSquareRequest({}); // any Square call now fails the test loudly
  const second = await payOrder(order.id, { token: first.payload.publicAccessToken, ip });
  assert.equal(second.status, 200);
  assert.equal(second.payload.alreadyPaid, true);
  assert.equal(countOutboxEntriesFor(order.customerEmail, /plata confirmata/i), 1, "no duplicate payment-confirmed email");
});

test("a declined card leaves the order pending/unpaid and allows retrying with a new card", async () => {
  const { order, publicAccessToken, ip } = await placeCheckout();
  stubSquareRequest({
    "POST /v2/payments": async () => {
      const error = new Error("declined");
      error.squareBody = { errors: [{ code: "CARD_DECLINED", detail: "Card was declined." }] };
      throw error;
    }
  });

  const declined = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(declined.status, 402);
  assert.match(declined.payload.error, /declined/i);

  const stillUnpaid = await jsonRequest(`/api/orders/${order.id}?token=${encodeURIComponent(publicAccessToken)}`, { ip });
  assert.equal(stillUnpaid.payload.order.paymentStatus, "unpaid");

  stubSquareApproveAll();
  const retried = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(retried.status, 200);
  assert.equal(retried.payload.order.paymentStatus, "paid");
});

test("a network failure while charging is reported as ambiguous, not a clean decline", async () => {
  const { order, publicAccessToken, ip } = await placeCheckout();
  stubSquareRequest({
    "POST /v2/payments": async () => {
      const error = new Error("fetch failed");
      error.squareAmbiguous = true;
      throw error;
    }
  });

  const { status, payload } = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(status, 502);
  assert.equal(payload.ambiguous, true);
});

test("pay is rejected with the wrong guest token", async () => {
  const { order, ip } = await placeCheckout();
  stubSquareApproveAll();
  const { status } = await payOrder(order.id, { token: "not-the-real-token", ip });
  assert.equal(status, 404);
});

test("POST /api/orders/:id/pay returns 503 when Square is not configured", async () => {
  const { order, publicAccessToken, ip } = await placeCheckout();
  const saved = process.env.SQUARE_ACCESS_TOKEN;
  delete process.env.SQUARE_ACCESS_TOKEN;
  try {
    const { status } = await payOrder(order.id, { token: publicAccessToken, ip });
    assert.equal(status, 503);
  } finally {
    process.env.SQUARE_ACCESS_TOKEN = saved;
  }
});

test("a valid payment.updated webhook settles the order even without the sync pay call", async () => {
  const { order } = await placeCheckout();
  const { status } = await postWebhook(paymentUpdatedEvent(order));
  assert.equal(status, 200);

  const check = await jsonRequest(`/api/orders/${order.id}`, { cookie: adminCookie });
  assert.equal(check.payload.order.paymentStatus, "paid");
  assert.equal(check.payload.order.status, "confirmed");
  assert.equal(countOutboxEntriesFor(order.customerEmail, /plata confirmata/i), 1);
});

test("a duplicate payment.updated webhook for the same Square payment id is a no-op", async () => {
  const { order } = await placeCheckout();
  const event = paymentUpdatedEvent(order);

  const first = await postWebhook(event);
  assert.equal(first.status, 200);
  const second = await postWebhook(event);
  assert.equal(second.status, 200);

  assert.equal(countOutboxEntriesFor(order.customerEmail, /plata confirmata/i), 1, "no duplicate email on a re-delivered webhook");
});

test("a webhook with an invalid signature is rejected and does not settle the order", async () => {
  const { order, publicAccessToken, ip } = await placeCheckout();
  const { status } = await postWebhook(paymentUpdatedEvent(order), { signature: "not-a-real-signature" });
  assert.equal(status, 401);

  const check = await jsonRequest(`/api/orders/${order.id}?token=${encodeURIComponent(publicAccessToken)}`, { ip });
  assert.equal(check.payload.order.paymentStatus, "unpaid");
});

test("a payment.updated webhook for an unknown order number is accepted (200) but changes nothing", async () => {
  const fakeOrder = { number: "BC-DOES-NOT-EXIST", total: 10, currency: "GBP" };
  const { status } = await postWebhook(paymentUpdatedEvent(fakeOrder));
  assert.equal(status, 200);
});

test("admin refund on a Square-paid order calls Square, records a refund payment, and emails the customer", async () => {
  stubSquareApproveAll();
  const { order, publicAccessToken, ip } = await placeCheckout();
  const paid = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(paid.status, 200);

  const refundResponse = await jsonRequest(`/api/admin/orders/${order.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { status: paid.payload.order.status, paymentStatus: "refunded" }
  });
  assert.equal(refundResponse.status, 200, JSON.stringify(refundResponse.payload));
  assert.equal(refundResponse.payload.order.paymentStatus, "refunded");
  assert.equal(countOutboxEntriesFor(order.customerEmail, /rambursare procesata/i), 1);
});

test("a Square refund failure leaves paymentStatus unchanged", async () => {
  stubSquareApproveAll();
  const { order, publicAccessToken, ip } = await placeCheckout();
  const paid = await payOrder(order.id, { token: publicAccessToken, ip });
  assert.equal(paid.status, 200);

  stubSquareRequest({
    "POST /v2/refunds": async () => {
      const error = new Error("refund failed");
      error.squareBody = { errors: [{ code: "REFUND_DECLINED" }] };
      throw error;
    }
  });

  const refundResponse = await jsonRequest(`/api/admin/orders/${order.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { status: paid.payload.order.status, paymentStatus: "refunded" }
  });
  assert.equal(refundResponse.status, 402);

  const check = await jsonRequest(`/api/orders/${order.id}`, { cookie: adminCookie });
  assert.equal(check.payload.order.paymentStatus, "paid", "paymentStatus must not change when Square rejects the refund");
});

test("marking a non-Square (manual/COD) order as refunded does not call Square", async () => {
  stubSquareRequest({}); // any call fails the test loudly
  const { order } = await placeCheckout(); // never paid via Square

  const refundResponse = await jsonRequest(`/api/admin/orders/${order.id}`, {
    method: "PUT",
    cookie: adminCookie,
    body: { status: order.status, paymentStatus: "refunded" }
  });
  assert.equal(refundResponse.status, 200, JSON.stringify(refundResponse.payload));
  assert.equal(refundResponse.payload.order.paymentStatus, "refunded");
});
