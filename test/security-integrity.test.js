const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// HTTP/integration coverage for the security & integrity fixes:
// order access control (owner/guest-token/admin), pending checkout with
// reservation + payment fields, state machine + idempotent cancellation,
// coupon limits, stored-XSS neutralization, account security (email change,
// password change/session invalidation), corrupt-JSON handling, CSV formula
// neutralization and static data-folder blocking - on BOTH brands.

const ADMIN_EMAIL = "admin@security-test.local";
const ADMIN_PASSWORD = "admintestpass123";

function freshEnv(overrides) {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  delete process.env.BRAND;
  delete process.env.NODE_ENV;
  Object.assign(process.env, overrides);
}

function requireFreshServer() {
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  return require("../server.js");
}

async function startServer(env) {
  freshEnv(env);
  const server = requireFreshServer();
  const httpServer = server.start();
  await new Promise((resolve) => httpServer.once("listening", resolve));
  return { httpServer, baseUrl: `http://127.0.0.1:${httpServer.address().port}` };
}

function stopServer(httpServer) {
  httpServer?.close();
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  delete process.env.BRAND;
  delete process.env.DATA_DIR;
}

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function jsonRequest(baseUrl, pathname, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, response };
}

async function adminLogin(baseUrl) {
  const { status, response } = await jsonRequest(baseUrl, "/admin/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  assert.equal(status, 200, "admin login must succeed");
  return cookiesFrom(response);
}

async function registerUser(baseUrl, email, name = "Test User") {
  const { status, response, payload } = await jsonRequest(baseUrl, "/auth/register", {
    method: "POST",
    body: { email, password: "integration-pass-123", name }
  });
  assert.equal(status, 200, `register must succeed: ${JSON.stringify(payload)}`);
  return { cookie: cookiesFrom(response), user: payload.user };
}

// Places a guest (or session-bound) checkout for qty 1 of the first live
// product and returns { order, publicAccessToken, cookie, product }.
async function placeCheckout(baseUrl, { cookie = "", couponCode } = {}) {
  const { payload: productsPayload } = await jsonRequest(baseUrl, "/api/products");
  const product = productsPayload.products[0];
  const size = (product.sizes || [])[0] || "";

  const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ productId: product.id, size, qty: 1 })
  });
  assert.equal(addResponse.status, 200, "cart add must succeed");
  const fullCookie = [cookie, cookiesFrom(addResponse)].filter(Boolean).join("; ");

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: fullCookie },
    body: JSON.stringify({
      customerName: "Integration Buyer",
      customerEmail: `buyer-${Math.random().toString(16).slice(2)}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Iasi",
      ...(couponCode ? { couponCode } : {})
    })
  });
  const payload = await checkoutResponse.json().catch(() => ({}));
  return { status: checkoutResponse.status, order: payload.order, publicAccessToken: payload.publicAccessToken, error: payload.error, cookie: fullCookie, product };
}

// ---------------------------------------------------------------------------
// Suite 1 (BRAND=beca): order access control, checkout flow, state machine,
// coupons, revenue, XSS, CSV, static blocking.
// ---------------------------------------------------------------------------

test("beca: orders, checkout, coupons, content and static protections", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-security-test-"));
  const tempDir = path.join(tempRoot, "data");
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: tempDir });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("checkout creates a pending, unpaid order request (not confirmed) and reserves stock", async () => {
      const before = await jsonRequest(baseUrl, "/api/products");
      const stockBefore = before.payload.products[0].stock;

      const { status, order, publicAccessToken } = await placeCheckout(baseUrl);
      assert.equal(status, 200);
      assert.equal(order.status, "pending", "checkout must create a pending order");
      assert.equal(order.paymentStatus, "unpaid");
      assert.equal(order.paymentMethod, "manual");
      assert.ok(publicAccessToken && publicAccessToken.length >= 32, "guest access token issued");
      assert.equal(JSON.stringify(order).includes("publicAccessTokenHash"), false, "hash never leaves the API");

      const after = await jsonRequest(baseUrl, "/api/products");
      assert.equal(after.payload.products[0].stock, stockBefore - 1, "stock is reserved (decremented) at checkout");

      // Stored order keeps only the hash, never the plain token.
      const stored = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8")).find((item) => item.id === order.id);
      assert.ok(stored.publicAccessTokenHash, "hash stored");
      assert.notEqual(stored.publicAccessTokenHash, publicAccessToken, "plain token is not stored");
      assert.ok(stored.reservation?.expiresAt, "stock reservation carries an expiry");

      // The received email says "primita", never "confirmata".
      const outbox = JSON.parse(fs.readFileSync(path.join(tempDir, "email-outbox.json"), "utf8"));
      const received = outbox.find((entry) => entry.subject.includes(order.number));
      assert.ok(received, "order received email saved to outbox");
      assert.match(received.subject, /primita/i);
      assert.doesNotMatch(received.subject, /confirmata/i);
      assert.match(received.text, /verificata si confirmata de echipa/i);
    });

    let guestOrder;
    let guestToken;

    await t.test("guest order access: token required, hash never exposed", async () => {
      const checkout = await placeCheckout(baseUrl);
      guestOrder = checkout.order;
      guestToken = checkout.publicAccessToken;

      const noToken = await jsonRequest(baseUrl, `/api/orders/${guestOrder.id}`);
      assert.equal(noToken.status, 404, "guest without token cannot view the order");

      const badToken = await jsonRequest(baseUrl, `/api/orders/${guestOrder.id}?token=deadbeef${"0".repeat(56)}`);
      assert.equal(badToken.status, 404, "wrong token is rejected");

      const withToken = await jsonRequest(baseUrl, `/api/orders/${guestOrder.id}?token=${guestToken}`);
      assert.equal(withToken.status, 200, "valid token grants access");
      assert.equal(withToken.payload.order.id, guestOrder.id);
      assert.equal(JSON.stringify(withToken.payload).includes("publicAccessTokenHash"), false);
    });

    await t.test("client A cannot see client B's order; owner and admin can", async () => {
      const userA = await registerUser(baseUrl, "client-a@example.com", "Client A");
      const userB = await registerUser(baseUrl, "client-b@example.com", "Client B");

      const checkoutA = await placeCheckout(baseUrl, { cookie: userA.cookie });
      assert.equal(checkoutA.status, 200);
      const orderA = checkoutA.order;

      const asB = await jsonRequest(baseUrl, `/api/orders/${orderA.id}`, { cookie: userB.cookie });
      assert.equal(asB.status, 404, "client B must not see client A's order");

      const asA = await jsonRequest(baseUrl, `/api/orders/${orderA.id}`, { cookie: userA.cookie });
      assert.equal(asA.status, 200, "the owner sees their own order");

      const asAdmin = await jsonRequest(baseUrl, `/api/orders/${orderA.id}`, { cookie: adminCookie });
      assert.equal(asAdmin.status, 200, "admin sees any order");

      const asGuestToken = await jsonRequest(baseUrl, `/api/orders/${orderA.id}?token=${checkoutA.publicAccessToken}`);
      assert.equal(asGuestToken.status, 200, "the checkout token still works for the owner's order");
    });

    await t.test("unpaid orders are excluded from revenue until the admin marks them paid", async () => {
      const summaryBefore = await jsonRequest(baseUrl, "/api/admin/summary", { cookie: adminCookie });
      assert.equal(summaryBefore.payload.revenue, 0, "pending unpaid orders do not count as revenue");

      const markPaid = await jsonRequest(baseUrl, `/api/admin/orders/${guestOrder.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "pending", paymentStatus: "paid", sendEmail: false }
      });
      assert.equal(markPaid.status, 200);
      assert.equal(markPaid.payload.order.paymentStatus, "paid");

      const summaryAfter = await jsonRequest(baseUrl, "/api/admin/summary", { cookie: adminCookie });
      assert.equal(summaryAfter.payload.revenue, guestOrder.total, "paid order now counts as revenue");
    });

    await t.test("state machine blocks invalid transitions", async () => {
      const invalid = await jsonRequest(baseUrl, `/api/admin/orders/${guestOrder.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "shipped", sendEmail: false, courierName: "X", trackingNumber: "1" }
      });
      assert.equal(invalid.status, 400, "pending -> shipped is not allowed");
      assert.match(invalid.payload.error, /Tranzitie invalida/);
    });

    await t.test("cancellation restores stock exactly once (idempotent)", async () => {
      const before = await jsonRequest(baseUrl, "/api/products");
      const stockBefore = before.payload.products[0].stock;

      const checkout = await placeCheckout(baseUrl);
      const mid = await jsonRequest(baseUrl, "/api/products");
      assert.equal(mid.payload.products[0].stock, stockBefore - 1);

      const cancel = await jsonRequest(baseUrl, `/api/admin/orders/${checkout.order.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "cancelled", cancellationReason: "test", sendEmail: false }
      });
      assert.equal(cancel.status, 200);

      const afterCancel = await jsonRequest(baseUrl, "/api/products");
      assert.equal(afterCancel.payload.products[0].stock, stockBefore, "stock restored on cancellation");

      // Saving "cancelled" again must not restore stock a second time.
      const cancelAgain = await jsonRequest(baseUrl, `/api/admin/orders/${checkout.order.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "cancelled", cancellationReason: "test again", sendEmail: false }
      });
      assert.equal(cancelAgain.status, 200);
      const afterSecond = await jsonRequest(baseUrl, "/api/products");
      assert.equal(afterSecond.payload.products[0].stock, stockBefore, "no double restore");

      // Edition records for the cancelled order are flagged, never deleted.
      const editions = JSON.parse(fs.readFileSync(path.join(tempDir, "editions.json"), "utf8"));
      const cancelledRecords = editions.filter((record) => record.orderId === checkout.order.id);
      assert.ok(cancelledRecords.length >= 1);
      assert.ok(cancelledRecords.every((record) => record.status === "cancelled"));
    });

    await t.test("coupons: maxUses is enforced across pending orders; usedCount moves on confirm and restores on cancel", async () => {
      const create = await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST",
        cookie: adminCookie,
        body: { code: "ONCE10", type: "percent", value: 10, maxUses: 1 }
      });
      assert.equal(create.status, 200);

      const first = await placeCheckout(baseUrl, { couponCode: "ONCE10" });
      assert.equal(first.status, 200, "first use of the coupon succeeds");

      const second = await placeCheckout(baseUrl, { couponCode: "ONCE10" });
      assert.equal(second.status, 400, "a pending order already holds the coupon");
      assert.match(second.error, /maximum/i);

      let coupons = JSON.parse(fs.readFileSync(path.join(tempDir, "coupons.json"), "utf8"));
      assert.equal(coupons.find((c) => c.code === "ONCE10").usedCount, 0, "usedCount only moves on confirm/paid");

      const confirm = await jsonRequest(baseUrl, `/api/admin/orders/${first.order.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "confirmed", sendEmail: false }
      });
      assert.equal(confirm.status, 200);
      coupons = JSON.parse(fs.readFileSync(path.join(tempDir, "coupons.json"), "utf8"));
      assert.equal(coupons.find((c) => c.code === "ONCE10").usedCount, 1, "confirm consumes the coupon");

      const cancel = await jsonRequest(baseUrl, `/api/admin/orders/${first.order.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { status: "cancelled", cancellationReason: "test", sendEmail: false }
      });
      assert.equal(cancel.status, 200);
      coupons = JSON.parse(fs.readFileSync(path.join(tempDir, "coupons.json"), "utf8"));
      assert.equal(coupons.find((c) => c.code === "ONCE10").usedCount, 0, "cancellation restores the coupon use");
    });

    await t.test("percent coupons outside 0-100 and invalid expiry dates are rejected", async () => {
      const tooBig = await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST",
        cookie: adminCookie,
        body: { code: "BIG", type: "percent", value: 150 }
      });
      assert.equal(tooBig.status, 400);

      const badDate = await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST",
        cookie: adminCookie,
        body: { code: "BADDATE", type: "fixed", value: 5, expiresAt: "not-a-date" }
      });
      assert.equal(badDate.status, 400);
    });

    await t.test("stored XSS payloads in editor content are neutralized on the server", async () => {
      const put = await jsonRequest(baseUrl, "/api/admin/content", {
        method: "PUT",
        cookie: adminCookie,
        body: {
          branding: {
            "oed::/::body>h1": { t: "text", v: "<script>alert(1)</script>Salut<br>lume" },
            "oed::/::body>img": { t: "img", v: "javascript:alert(1)" },
            "oed::/::body>img2": { t: "img", v: "assets/products/ok.png" },
            "oed::/::body>p": { t: "text", v: "<img src=x onerror=alert(2)>text" },
            "oed::/::body>div": { t: "weird", v: "<iframe src=x></iframe>" }
          },
          en: { "hero.title": "<object data=x></object>Hello" }
        }
      });
      assert.equal(put.status, 200);

      const { payload } = await jsonRequest(baseUrl, "/api/content");
      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, /<script/i);
      assert.doesNotMatch(serialized, /onerror/i);
      assert.doesNotMatch(serialized, /javascript:/i);
      assert.doesNotMatch(serialized, /<iframe/i);
      assert.doesNotMatch(serialized, /<object/i);

      assert.equal(payload.branding["oed::/::body>h1"].v, "alert(1)Salut\nlume", "tags stripped, <br> becomes newline");
      assert.equal(payload.branding["oed::/::body>img"], undefined, "javascript: image URL dropped");
      assert.equal(payload.branding["oed::/::body>img2"].v, "assets/products/ok.png", "approved local image kept");
      assert.equal(payload.branding["oed::/::body>div"], undefined, "unknown record shapes dropped");
      assert.equal(payload.en["hero.title"], "Hello");
    });

    await t.test("CSV export neutralizes spreadsheet formulas", async () => {
      const orders = JSON.parse(fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"));
      orders.unshift({
        id: "11111111-1111-4111-8111-111111111111",
        number: "BC-CSV",
        customerName: "=HYPERLINK(\"http://evil.example\",\"click\")",
        customerEmail: "csv@example.com",
        customerPhone: "+40700000000",
        customerAddress: "@SUM(1+1)",
        status: "pending",
        paymentStatus: "unpaid",
        currency: "GBP",
        total: 1,
        items: [],
        createdAt: new Date().toISOString()
      });
      fs.writeFileSync(path.join(tempDir, "orders.json"), JSON.stringify(orders, null, 2));

      const response = await fetch(`${baseUrl}/api/admin/export/orders.csv`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 200);
      const csv = await response.text();
      assert.match(csv, /'=HYPERLINK/, "leading = is neutralized with an apostrophe");
      assert.match(csv, /'\+40700000000/, "leading + is neutralized");
      assert.match(csv, /'@SUM/, "leading @ is neutralized");
    });

    await t.test("data and backup folders are never served statically", async () => {
      // data/content.json exists in the repo root - it must still be blocked.
      for (const blockedPath of [
        "/data/users.json",
        "/data/content.json",
        "/data/products.json",
        "/data-aether/users.json",
        "/backups/latest/users.json",
        "/backups-aether/latest/users.json",
        "/nested/data/secret.json",
        "/%64%61%74%61/users.json", // "data" URL-encoded
        "/data%2Fusers.json",
        "/data/..%2Fdata/users.json",
        "/.env",
        "/.env.example"
      ]) {
        const response = await fetch(`${baseUrl}${blockedPath}`);
        assert.equal(response.status, 403, `${blockedPath} must be blocked, got ${response.status}`);
      }

      // Traversal out of the public root cannot reach the data dir.
      const traversal = await fetch(`${baseUrl}/assets/%2e%2e/data/users.json`);
      assert.equal(traversal.status, 403, "encoded ../ traversal into data/ is blocked");

      // Regular static files still work.
      const home = await fetch(`${baseUrl}/index.html`);
      assert.equal(home.status, 200);
      const css = await fetch(`${baseUrl}/styles.css`);
      assert.equal(css.status, 200);
    });
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Suite 2 (BRAND=beca, fresh instance): account security.
// ---------------------------------------------------------------------------

test("beca: account security - email change, password change, password policy", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-account-test-"));
  const tempDir = path.join(tempRoot, "data");
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: tempDir });

  try {
    await t.test("weak passwords are rejected at registration", async () => {
      // Two attempts only: registration shares one per-IP rate limit (5/min)
      // with the successful registrations below.
      for (const password of ["short", "1234567890"]) {
        const { status } = await jsonRequest(baseUrl, "/auth/register", {
          method: "POST",
          body: { email: `weak-${Math.random().toString(16).slice(2)}@example.com`, password, name: "Weak Pass" }
        });
        assert.equal(status, 400, `password "${password}" must be rejected`);
      }
    });

    await t.test("changing the email resets verification and invalidates old tokens", async () => {
      const { cookie } = await registerUser(baseUrl, "verify-flow@example.com", "Verify Flow");

      // Simulate a verified account, with an old pending verification token.
      let users = JSON.parse(fs.readFileSync(path.join(tempDir, "users.json"), "utf8"));
      const userId = users.find((u) => u.email === "verify-flow@example.com").id;
      users = users.map((u) => (u.id === userId ? { ...u, emailVerified: true } : u));
      fs.writeFileSync(path.join(tempDir, "users.json"), JSON.stringify(users, null, 2));

      const change = await jsonRequest(baseUrl, "/api/profile", {
        method: "PUT",
        cookie,
        body: { name: "Verify Flow", email: "new-address@example.com" }
      });
      assert.equal(change.status, 200);
      assert.equal(change.payload.user.emailVerified, false, "new address starts unverified");

      const verifications = JSON.parse(fs.readFileSync(path.join(tempDir, "email-verifications.json"), "utf8"));
      const mine = verifications.filter((v) => v.userId === userId);
      assert.equal(mine.length, 1, "exactly one fresh verification token for the new address");

      // Duplicate emails are rejected.
      await registerUser(baseUrl, "taken@example.com", "Taken");
      const duplicate = await jsonRequest(baseUrl, "/api/profile", {
        method: "PUT",
        cookie,
        body: { name: "Verify Flow", email: "taken@example.com" }
      });
      assert.equal(duplicate.status, 409);
    });

    await t.test("changing the password invalidates every other session", async () => {
      const { cookie: firstSession } = await registerUser(baseUrl, "sessions@example.com", "Session Tester");

      const loginResponse = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({ email: "sessions@example.com", password: "integration-pass-123" })
      });
      assert.equal(loginResponse.status, 200);
      const secondSession = cookiesFrom(loginResponse);

      const change = await jsonRequest(baseUrl, "/api/profile/password", {
        method: "PUT",
        cookie: firstSession,
        body: { currentPassword: "integration-pass-123", newPassword: "brand-new-pass-456" }
      });
      assert.equal(change.status, 200);

      const meFirst = await jsonRequest(baseUrl, "/api/me", { cookie: firstSession });
      assert.ok(meFirst.payload.user, "the session that changed the password stays valid");

      const meSecond = await jsonRequest(baseUrl, "/api/me", { cookie: secondSession });
      assert.equal(meSecond.payload.user, null, "every other session is logged out");
    });
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Suite 3 (BRAND=beca, fresh instance): corrupt JSON handling.
// ---------------------------------------------------------------------------

test("beca: corrupt JSON is never replaced with an empty fallback", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-corrupt-test-"));
  const tempDir = path.join(tempRoot, "data");
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: tempDir });
  const backupsDir = path.join(tempRoot, "backups");

  try {
    await t.test("with a valid backup: restore, preserving the corrupt file sideways", async () => {
      const validUsers = fs.readFileSync(path.join(tempDir, "users.json"), "utf8");
      fs.writeFileSync(path.join(tempDir, "users.json"), "{ this is not json !!!");

      const login = await jsonRequest(baseUrl, "/admin/login", {
        method: "POST",
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
      });
      assert.equal(login.status, 200, "login works because users.json was restored from backup");

      const restored = fs.readFileSync(path.join(tempDir, "users.json"), "utf8");
      assert.deepEqual(JSON.parse(restored), JSON.parse(validUsers), "restored content matches the backup");

      const corruptCopies = fs.readdirSync(tempDir).filter((name) => name.includes("users.json.corrupt-"));
      assert.equal(corruptCopies.length, 1, "the corrupt file is preserved, not deleted");
    });

    await t.test("without any backup: the request fails with 500 and the file is untouched", async () => {
      fs.rmSync(backupsDir, { recursive: true, force: true });
      const corruptBody = "{ definitely not json ###";
      fs.writeFileSync(path.join(tempDir, "orders.json"), corruptBody);

      const response = await fetch(`${baseUrl}/api/orders/11111111-1111-4111-8111-111111111111`);
      assert.equal(response.status, 500, "corrupt data file is a server error, not an empty fallback");

      assert.equal(
        fs.readFileSync(path.join(tempDir, "orders.json"), "utf8"),
        corruptBody,
        "the corrupt file must never be overwritten automatically"
      );
    });
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Suite 4 (BRAND=aether): same protections hold on the second brand.
// ---------------------------------------------------------------------------

test("aether: static blocking, pending checkout and guest token access", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aether-security-test-"));
  const tempDir = path.join(tempRoot, "data");
  const { httpServer, baseUrl } = await startServer({ BRAND: "aether", DATA_DIR: tempDir });

  try {
    await t.test("data folders (incl. data-aether) are blocked", async () => {
      for (const blockedPath of [
        "/data-aether/users.json",
        "/data/users.json",
        "/data/content.json",
        "/backups-aether/x/users.json",
        "/%64%61%74%61-aether/users.json"
      ]) {
        const response = await fetch(`${baseUrl}${blockedPath}`);
        assert.equal(response.status, 403, `${blockedPath} must be blocked, got ${response.status}`);
      }

      const home = await fetch(`${baseUrl}/index.html`);
      assert.equal(home.status, 200, "aether homepage still serves");
    });

    await t.test("checkout is pending/unpaid and guest access needs the token", async () => {
      const { status, order, publicAccessToken } = await placeCheckout(baseUrl);
      assert.equal(status, 200);
      assert.equal(order.status, "pending");
      assert.equal(order.paymentStatus, "unpaid");

      const noToken = await jsonRequest(baseUrl, `/api/orders/${order.id}`);
      assert.equal(noToken.status, 404);

      const withToken = await jsonRequest(baseUrl, `/api/orders/${order.id}?token=${publicAccessToken}`);
      assert.equal(withToken.status, 200);
      assert.equal(withToken.payload.order.id, order.id);
    });
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
