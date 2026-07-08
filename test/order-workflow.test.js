const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ADMIN_EMAIL = "admin@order-workflow-test.local";
const ADMIN_PASSWORD = "admintestpass123";

let tempDir;
let httpServer;
let baseUrl;
let adminCookie;

function ordersFilePath() {
  return path.join(tempDir, "orders.json");
}

function readOrders() {
  return JSON.parse(fs.readFileSync(ordersFilePath(), "utf8"));
}

function writeOrders(orders) {
  fs.writeFileSync(ordersFilePath(), JSON.stringify(orders, null, 2));
}

function readOutbox() {
  return JSON.parse(fs.readFileSync(path.join(tempDir, "email-outbox.json"), "utf8"));
}

// Outbox entries are unshifted (newest first) and shared across the whole test file, so
// unrelated fire-and-forget sends (e.g. the register verification email) can land in
// between. Filtering by the order's own (unique per test) customerEmail keeps assertions
// isolated from that background traffic instead of assuming a fixed array position.
function latestOutboxEntryFor(email) {
  return readOutbox().find((entry) => entry.to === email);
}

function countOutboxEntriesFor(email) {
  return readOutbox().filter((entry) => entry.to === email).length;
}

function seedOrder(overrides = {}) {
  const orders = readOrders();
  const order = {
    id: crypto.randomUUID(),
    number: `BC-TEST-${orders.length + 1}`,
    userId: null,
    customerName: "Test Buyer",
    customerEmail: `buyer-${crypto.randomUUID()}@example.com`,
    customerPhone: "0700000000",
    customerAddress: "Str. Test 1, Iasi",
    notes: "",
    status: "confirmed",
    currency: "GBP",
    total: 59,
    discount: 0,
    couponCode: null,
    items: [{ productId: "test-product", name: "Test Tee", size: "M", price: 59, currency: "GBP", qty: 1, subtotal: 59 }],
    processedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    fulfillment: { courierName: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", customerNote: "", internalNote: "" },
    cancellationReason: "",
    statusHistory: [{ from: null, to: "confirmed", changedAt: new Date().toISOString(), changedBy: null, emailSent: true }],
    createdAt: new Date().toISOString(),
    ...overrides
  };
  orders.unshift(order);
  writeOrders(orders);
  return order;
}

function getOrder(id) {
  return readOrders().find((order) => order.id === id);
}

async function putOrderStatus(id, body, cookie = adminCookie) {
  const response = await fetch(`${baseUrl}/api/admin/orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function resendOrderEmail(id, cookie = adminCookie) {
  const response = await fetch(`${baseUrl}/api/admin/orders/${id}/resend-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: "{}"
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-order-workflow-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  // Set (not delete) so server.js's .env loader - which only fills in keys that are
  // completely absent from process.env - does not pull real SMTP creds from the
  // project's local .env file and attempt a live network connection to Gmail.
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";

  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  const server = require("../server.js");

  httpServer = server.start();
  await new Promise((resolve) => httpServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(loginResponse.status, 200);
  adminCookie = loginResponse.headers.get("set-cookie").split(";")[0];
});

test.after(() => {
  httpServer?.close();
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("PUT order status without a session is rejected with 401", async () => {
  const order = seedOrder();
  const { status } = await putOrderStatus(order.id, { status: "processing" }, null);
  assert.equal(status, 401);
  assert.equal(getOrder(order.id).status, "confirmed");
});

test("PUT order status from a non-admin session is rejected with 401", async () => {
  const order = seedOrder();
  const email = `client-${Date.now()}@example.com`;
  const registerResponse = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "clientpass123", name: "Client Test" })
  });
  assert.equal(registerResponse.status, 200);
  const clientCookie = registerResponse.headers.get("set-cookie").split(";")[0];

  const { status } = await putOrderStatus(order.id, { status: "processing" }, clientCookie);
  assert.equal(status, 401);
  assert.equal(getOrder(order.id).status, "confirmed");
});

test("confirmed -> processing sets processedAt, records statusHistory, and does not duplicate on re-save", async () => {
  const order = seedOrder();

  const first = await putOrderStatus(order.id, { status: "processing", customerNote: "Se pregateste coletul" });
  assert.equal(first.status, 200);
  assert.equal(first.payload.order.status, "processing");
  assert.ok(first.payload.order.processedAt, "processedAt should be set");
  assert.equal(first.payload.order.statusHistory.length, 2);
  const lastEntry = first.payload.order.statusHistory.at(-1);
  assert.equal(lastEntry.from, "confirmed");
  assert.equal(lastEntry.to, "processing");
  assert.equal(typeof lastEntry.changedBy, "string");

  assert.equal(countOutboxEntriesFor(order.customerEmail), 1, "processing email should be attempted exactly once");
  assert.match(latestOutboxEntryFor(order.customerEmail).subject, /processed/i);

  const second = await putOrderStatus(order.id, { status: "processing" });
  assert.equal(second.status, 200);
  assert.equal(second.payload.order.statusHistory.length, 2, "no new history entry when status does not change");
  assert.equal(countOutboxEntriesFor(order.customerEmail), 1, "no duplicate email on re-saving the same status");
});

test("shipped is rejected without courier and tracking details", async () => {
  const order = seedOrder();
  const { status, payload } = await putOrderStatus(order.id, { status: "shipped" });
  assert.equal(status, 400);
  assert.match(payload.error, /curier|tracking/i);
  assert.equal(getOrder(order.id).status, "confirmed");
});

test("shipped succeeds with courier/tracking, sets shippedAt, and the email includes the tracking link", async () => {
  const order = seedOrder();
  const { status, payload } = await putOrderStatus(order.id, {
    status: "shipped",
    courierName: "Sameday",
    trackingNumber: "AWB123456",
    trackingUrl: "https://tracking.example.com/AWB123456",
    estimatedDeliveryDate: "2026-08-01"
  });

  assert.equal(status, 200);
  assert.equal(payload.order.status, "shipped");
  assert.ok(payload.order.shippedAt);
  assert.equal(payload.order.fulfillment.courierName, "Sameday");
  assert.equal(payload.order.fulfillment.trackingNumber, "AWB123456");

  const outboxEntry = latestOutboxEntryFor(order.customerEmail);
  assert.match(outboxEntry.subject, /shipped/i);
  assert.match(outboxEntry.text, /AWB123456/);
  assert.match(outboxEntry.text, /https:\/\/tracking\.example\.com\/AWB123456/);
});

test("delivered sets deliveredAt", async () => {
  const order = seedOrder({ status: "shipped" });
  const { status, payload } = await putOrderStatus(order.id, { status: "delivered" });
  assert.equal(status, 200);
  assert.equal(payload.order.status, "delivered");
  assert.ok(payload.order.deliveredAt);
});

test("cancelled saves the cancellation reason, sets cancelledAt, and the email includes the reason", async () => {
  const order = seedOrder();
  const { status, payload } = await putOrderStatus(order.id, {
    status: "cancelled",
    cancellationReason: "Client a cerut anularea"
  });

  assert.equal(status, 200);
  assert.equal(payload.order.status, "cancelled");
  assert.ok(payload.order.cancelledAt);
  assert.equal(payload.order.cancellationReason, "Client a cerut anularea");

  const outboxEntry = latestOutboxEntryFor(order.customerEmail);
  assert.match(outboxEntry.subject, /cancelled/i);
  assert.match(outboxEntry.text, /Client a cerut anularea/);
});

test("order does not get deleted when cancelled", async () => {
  const order = seedOrder();
  await putOrderStatus(order.id, { status: "cancelled", cancellationReason: "test" });
  assert.ok(getOrder(order.id), "order should still exist after cancellation");
});

test("statusHistory accumulates correctly across a full confirmed -> processing -> shipped -> delivered flow", async () => {
  const order = seedOrder();
  await putOrderStatus(order.id, { status: "processing" });
  await putOrderStatus(order.id, {
    status: "shipped",
    courierName: "Cargus",
    trackingNumber: "AWB999"
  });
  const finalResult = await putOrderStatus(order.id, { status: "delivered" });

  const history = finalResult.payload.order.statusHistory;
  assert.deepEqual(history.map((entry) => `${entry.from || "null"}->${entry.to}`), [
    "null->confirmed",
    "confirmed->processing",
    "processing->shipped",
    "shipped->delivered"
  ]);
});

test("sendEmail:false skips sending but still saves the status and history", async () => {
  const order = seedOrder();
  const { status, payload } = await putOrderStatus(order.id, { status: "processing", sendEmail: false });

  assert.equal(status, 200);
  assert.equal(payload.order.status, "processing");
  assert.equal(payload.order.statusHistory.at(-1).emailSent, false);
  assert.equal(countOutboxEntriesFor(order.customerEmail), 0, "no email should be attempted when sendEmail is false");
});

test("resend-email sends the email again and appends a resend history entry without changing status", async () => {
  const order = seedOrder();
  await putOrderStatus(order.id, { status: "processing" });

  const { status, payload } = await resendOrderEmail(order.id);
  assert.equal(status, 200);
  assert.equal(payload.order.status, "processing");
  assert.equal(countOutboxEntriesFor(order.customerEmail), 2, "processing email plus one resend");

  const lastEntry = payload.order.statusHistory.at(-1);
  assert.equal(lastEntry.from, "processing");
  assert.equal(lastEntry.to, "processing");
  assert.equal(lastEntry.resend, true);
});

test("resend-email requires an admin session", async () => {
  const order = seedOrder({ status: "processing" });
  const { status } = await resendOrderEmail(order.id, null);
  assert.equal(status, 401);
});

test("invalid status value is rejected", async () => {
  const order = seedOrder();
  const { status, payload } = await putOrderStatus(order.id, { status: "not-a-real-status" });
  assert.equal(status, 400);
  assert.match(payload.error, /status/i);
});

test("concurrent status updates on different orders don't clobber each other (regression: production audit)", async () => {
  // Before the withStockLock fix, PUT /api/admin/orders/:id read the whole
  // orders.json array, awaited the (slow) email send, then wrote the whole
  // array back. Two concurrent updates to two DIFFERENT orders could each
  // read the array before either write landed, so whichever wrote last would
  // silently overwrite the other's change with its own stale copy.
  const orderA = seedOrder({ status: "confirmed" });
  const orderB = seedOrder({ status: "confirmed" });

  const [resultA, resultB] = await Promise.all([
    putOrderStatus(orderA.id, { status: "processing" }),
    putOrderStatus(orderB.id, { status: "cancelled", cancellationReason: "test" })
  ]);

  assert.equal(resultA.status, 200);
  assert.equal(resultB.status, 200);

  // Re-read from disk (not the in-memory response payloads) so this actually
  // proves both writes landed, not just that both requests returned 200.
  assert.equal(getOrder(orderA.id).status, "processing", "order A's change must not be lost");
  assert.equal(getOrder(orderB.id).status, "cancelled", "order B's change must not be lost");
});

test("primary-admin role-management gate is not tied to a hardcoded email", async () => {
  // Regression: canManageRoles used to be `session.user.email === "admin@beca.local"`.
  // The bootstrap admin in this test suite is created with a different email
  // (ADMIN_EMAIL above), which is exactly the real-world situation on the live
  // site after the admin account's email was changed - so this only passes if
  // the gate is backed by the persistent isPrimaryAdmin flag, not the email.
  const response = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: adminCookie }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.canManageRoles, true);

  const bootstrapAdmin = payload.users.find((user) => user.email === ADMIN_EMAIL);
  assert.ok(bootstrapAdmin, "bootstrap admin should be in the users list");
  assert.equal(bootstrapAdmin.isPrimaryAdmin, true);
});

test("checkout is rate-limited per IP (regression: production audit - was unthrottled)", async () => {
  // /api/checkout previously had no rate limit at all, unlike login/register/
  // forgot-password. With no payment gate in front of it, that let anyone
  // script repeated orders to drain real stock without paying. The empty-cart
  // 400 still proves the point: the limiter runs before cart/body validation,
  // so if it's wired up, request #11 in a burst comes back 429, not 400.
  const attempts = [];
  for (let i = 0; i < 11; i++) {
    attempts.push(
      fetch(`${baseUrl}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Rate Limit Test",
          customerEmail: "ratelimit@example.com",
          customerPhone: "0700000000",
          customerAddress: "Str. Test 1"
        })
      })
    );
  }
  const responses = await Promise.all(attempts);
  const statuses = responses.map((response) => response.status);
  assert.ok(statuses.includes(429), `expected at least one 429 among ${JSON.stringify(statuses)}`);
});
