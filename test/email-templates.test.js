const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for admin-editable email templates: listing the
// fixed template slots, saving/activating/deactivating, preview and
// test-send, the {{variable}} interpolation engine (never eval/new
// Function - a malicious payload must render as inert text), and - the
// most important guarantee - that a missing/inactive/broken template can
// never break the real order-email flow (falls back to the original
// hardcoded email untouched).

const ADMIN_EMAIL = "admin@email-templates-test.local";
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
  require("../server.js").stop();
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

// Reads whatever the (offline, SMTP-unconfigured) test environment
// captured in the local outbox - same pattern test/email.test.js already
// uses for asserting on sent content.
function readOutbox() {
  delete require.cache[require.resolve("../lib/email.js")];
  return require("../lib/email.js").readOutbox();
}

// The seed product only carries 25 units of stock (spread across 4 sizes),
// and this file's language-fallback coverage places many more orders
// against it than the original single-language tests did. A full round-trip
// PUT (spread the admin's own current product back, only stock changed) is
// the only safe way to bump it - sanitizeProduct has no partial-update mode,
// so sending just {stock} would blank out name/category/description too.
async function ensureAmpleStock(baseUrl, adminCookie) {
  const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
  const product = payload.products[0];
  const { status } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
    method: "PUT", cookie: adminCookie,
    body: { ...product, stock: 500 }
  });
  assert.equal(status, 200, "stock top-up must succeed or every placeOrder() call below is unreliable");
}

async function placeOrder(baseUrl, overrides = {}) {
  const { payload: productsPayload } = await jsonRequest(baseUrl, "/api/products");
  const product = productsPayload.products[0];
  const size = (product.sizes || [])[0] || "";

  const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ productId: product.id, size, qty: 1 })
  });
  assert.equal(addResponse.status, 200);
  const cookie = cookiesFrom(addResponse);

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({
      customerName: "Template Test Buyer",
      customerEmail: `buyer-${Math.random().toString(16).slice(2)}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Iasi",
      customerCountry: "RO",
      // Explicit, not incidental: this file's fallback-content assertions
      // check the Romanian hardcoded wording specifically. Callers testing
      // the language dimension override it via `overrides`.
      customerLanguage: "ro",
      ...overrides
    })
  });
  const payload = await checkoutResponse.json();
  assert.equal(checkoutResponse.status, 200, `checkout must succeed: ${JSON.stringify(payload)}`);
  return payload.order;
}

test("email templates: admin CRUD, interpolation safety, preview/test-send, and the fallback guarantee", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-email-templates-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await ensureAmpleStock(baseUrl, adminCookie);

    await t.test("GET lists all 8 fixed template slots with default content, none customized yet", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/email-templates", { cookie: adminCookie });
      assert.equal(status, 200);
      assert.equal(payload.templates.length, 8);
      assert.ok(payload.templates.every((t) => !t.isCustomized));
      assert.ok(payload.templates.some((t) => t.id === "order-received"));
      assert.ok(payload.templates.some((t) => t.id === "order-shipped"));
      const received = payload.templates.find((t) => t.id === "order-received");
      assert.ok(received.subject.length > 0, "has a default subject to start from");
      assert.ok(received.variables.includes("customerName"));
    });

    await t.test("PUT saves a custom subject/body and GET reflects it as customized", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "Custom subject {{orderNumber}}", body: "Custom body for {{customerName}}.", active: true }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.template.subject, "Custom subject {{orderNumber}}");
      assert.equal(payload.template.active, true);

      const list = await jsonRequest(baseUrl, "/api/admin/email-templates", { cookie: adminCookie });
      const received = list.payload.templates.find((t) => t.id === "order-received");
      assert.equal(received.isCustomized, true);
      assert.equal(received.subject, "Custom subject {{orderNumber}}");
    });

    await t.test("rejects an empty subject or body", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie, body: { subject: "", body: "x", active: true }
      });
      assert.equal(status, 400);
    });

    await t.test("rejects an unknown template id", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/email-templates/not-a-real-template", {
        method: "PUT", cookie: adminCookie, body: { subject: "x", body: "y", active: true }
      });
      assert.equal(status, 404);
    });

    await t.test("preview interpolates {{variables}} with sample data, using unsaved body if provided", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received/preview", {
        method: "POST", cookie: adminCookie,
        body: { subject: "Preview for {{customerName}}", body: "Order {{orderNumber}}, total {{total}}." }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.subject, "Preview for Ana Popescu");
      assert.match(payload.text, /Order BC-0042, total 128 GBP\./);
    });

    await t.test("preview leaves an unknown placeholder as literal text instead of silently dropping it", async () => {
      const { payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received/preview", {
        method: "POST", cookie: adminCookie,
        body: { subject: "Subject", body: "Value: {{thisIsNotARealVariable}}" }
      });
      assert.equal(payload.text, "Value: {{thisIsNotARealVariable}}");
    });

    await t.test("SECURITY: interpolation never executes template content as code, only ever produces text", async () => {
      const maliciousPayload = "{{constructor.constructor('return 1+1')()}}";
      const { payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received/preview", {
        method: "POST", cookie: adminCookie,
        body: { subject: "Subject", body: `Attempt: ${maliciousPayload} end` }
      });
      // If this were ever eval'd it would render "2" - it must instead be
      // treated as just another unrecognized {{...}} placeholder and left
      // untouched, because the key "constructor.constructor(...)" doesn't
      // match the [a-zA-Z0-9_]+ variable-name pattern at all.
      assert.equal(payload.text, `Attempt: ${maliciousPayload} end`);
      assert.doesNotMatch(payload.text, /^Attempt: 2 end$/);
    });

    await t.test("test-send delivers to the admin's own address, not a customer's", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received/test-send", {
        method: "POST", cookie: adminCookie,
        body: { subject: "Test {{orderNumber}}", body: "Hello {{customerName}}" }
      });
      assert.equal(status, 502, "smtp is unconfigured in the test env, so sendMail itself reports failure");
      assert.equal(payload.reason, "smtp-not-configured");

      const outbox = readOutbox();
      const sent = outbox[0];
      assert.equal(sent.to, ADMIN_EMAIL, "goes to the logged-in admin, never a real customer");
      assert.match(sent.subject, /^\[TEST\] Test BC-0042/);
      assert.match(sent.text, /Hello Ana Popescu/);
    });

    await t.test("test-send is rate-limited", async () => {
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const { status } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received/test-send", {
          method: "POST", cookie: adminCookie, body: { subject: "x", body: "y" }
        });
        lastStatus = status;
      }
      assert.equal(lastStatus, 429);
    });

    await t.test("email-template routes require admin auth", async () => {
      const list = await jsonRequest(baseUrl, "/api/admin/email-templates");
      assert.equal(list.status, 401);
      const put = await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", body: { subject: "x", body: "y" }
      });
      assert.equal(put.status, 401);
    });

    await t.test("REGRESSION/SAFETY: an active custom template actually overrides the real order-received email", async () => {
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "OVERRIDE {{orderNumber}}", body: "OVERRIDDEN BODY for {{customerName}}, total {{total}}.", active: true }
      });

      const order = await placeOrder(baseUrl);
      const outbox = readOutbox();
      const sent = outbox.find((entry) => entry.subject.includes(order.number));
      assert.ok(sent, "an email was actually captured for this order");
      assert.equal(sent.subject, `OVERRIDE ${order.number}`);
      assert.match(sent.text, /OVERRIDDEN BODY for Template Test Buyer, total/);
    });

    await t.test("SAFETY: deactivating the template falls straight back to the original hardcoded email, no re-typing needed to restore it", async () => {
      // Deactivate (not delete) - the custom text from the previous test
      // stays saved in the DB row, just inert.
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "OVERRIDE {{orderNumber}}", body: "OVERRIDDEN BODY for {{customerName}}, total {{total}}.", active: false }
      });

      const order = await placeOrder(baseUrl);
      const outbox = readOutbox();
      const sent = outbox.find((entry) => entry.subject.includes(order.number));
      assert.ok(sent, "an email was still sent");
      assert.doesNotMatch(sent.subject, /^OVERRIDE/, "inactive template must not be used");
      assert.match(sent.subject, /primita/, "falls back to the real buildOrderReceivedEmail wording");
    });

    await t.test("SAFETY: a template active but with a body that isn't valid text still can't break the order flow", async () => {
      // There's no way to make interpolateEmailTemplate throw (it's a plain
      // String(...).replace(...) call - never JSON.parse, never eval), so
      // this proves the *practical* worst case: an admin saves something
      // bizarre and the flow still completes and still delivers an email.
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "{{{{{{ malformed", body: "}}}} {{ {{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{", active: true }
      });

      const { status, payload } = await jsonRequest(baseUrl, "/api/checkout", { method: "POST" });
      // Not asserting on this particular call (missing cart etc.) - the
      // real assertion is the one below: checkout as a whole still works.
      void status; void payload;

      const order = await placeOrder(baseUrl);
      assert.ok(order.id, "checkout still completes end-to-end with a malformed template active");
    });

    await t.test("language-aware admin routes: GET ?lang= scopes saved rows independently per language", async () => {
      const roBefore = await jsonRequest(baseUrl, "/api/admin/email-templates?lang=ro", { cookie: adminCookie });
      assert.equal(roBefore.payload.languageCode, "ro");
      assert.equal(roBefore.payload.templates.find((t) => t.id === "order-shipped").isCustomized, false);

      await jsonRequest(baseUrl, "/api/admin/email-templates/order-shipped", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "RO SHIPPED {{orderNumber}}", body: "Corp RO", active: true, languageCode: "ro" }
      });

      const roAfter = await jsonRequest(baseUrl, "/api/admin/email-templates?lang=ro", { cookie: adminCookie });
      assert.equal(roAfter.payload.templates.find((t) => t.id === "order-shipped").isCustomized, true);
      assert.equal(roAfter.payload.templates.find((t) => t.id === "order-shipped").subject, "RO SHIPPED {{orderNumber}}");

      const enAfter = await jsonRequest(baseUrl, "/api/admin/email-templates?lang=en", { cookie: adminCookie });
      assert.equal(
        enAfter.payload.templates.find((t) => t.id === "order-shipped").isCustomized,
        false,
        "the en row is a completely independent slot from the ro save"
      );

      const noParam = await jsonRequest(baseUrl, "/api/admin/email-templates", { cookie: adminCookie });
      assert.equal(noParam.payload.languageCode, "en", "omitting ?lang= resolves to the store's default language");

      const unknownLang = await jsonRequest(baseUrl, "/api/admin/email-templates?lang=zz", { cookie: adminCookie });
      assert.equal(unknownLang.payload.languageCode, "en", "an unrecognized ?lang= falls back to the default language rather than erroring");
    });

    await t.test("PUT rejects a languageCode that isn't a real language", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/email-templates/order-shipped", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "x", body: "y", active: true, languageCode: "zz" }
      });
      assert.equal(status, 400, JSON.stringify(payload));
    });

    await t.test("PUT with no languageCode saves under the store's default language", async () => {
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-cancelled", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "DEFAULT LANG CANCELLED {{orderNumber}}", body: "body", active: true }
      });
      const list = await jsonRequest(baseUrl, "/api/admin/email-templates?lang=en", { cookie: adminCookie });
      assert.equal(
        list.payload.templates.find((t) => t.id === "order-cancelled").isCustomized,
        true,
        "an omitted languageCode defaults to the store's default language, not a random/null one"
      );
    });

    await t.test("3-rung fallback end-to-end: customer-language override beats default-language override beats the hardcoded original", async () => {
      // Clean slate for order-received specifically - earlier tests in this
      // file left it active under the default language ("en"), which would
      // make this test's rung-1-vs-rung-2 distinction ambiguous.
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "EN DEFAULT LANG OVERRIDE {{orderNumber}}", body: "en default body", active: true, languageCode: "en" }
      });

      // Rung 2: a Romanian customer has no ro-specific row yet, so the
      // default-language (en) override is used - better than an
      // unconditional Romanian default for a language with no row at all.
      const roOrderRung2 = await placeOrder(baseUrl, { customerLanguage: "ro" });
      const sent1 = readOutbox().find((entry) => entry.subject.includes(roOrderRung2.number));
      assert.equal(sent1.subject, `EN DEFAULT LANG OVERRIDE ${roOrderRung2.number}`, "falls through to the default-language override (rung 2)");

      // Rung 1: now a ro-specific row exists too - it must win over the
      // default-language row for a Romanian customer.
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "RO SPECIFIC OVERRIDE {{orderNumber}}", body: "ro specific body", active: true, languageCode: "ro" }
      });
      const roOrderRung1 = await placeOrder(baseUrl, { customerLanguage: "ro" });
      const sent2 = readOutbox().find((entry) => entry.subject.includes(roOrderRung1.number));
      assert.equal(sent2.subject, `RO SPECIFIC OVERRIDE ${roOrderRung1.number}`, "the customer's own language row wins over the default-language row (rung 1)");

      // An English customer's rung 1 is the en row saved above, distinct
      // from the ro-specific row.
      const enOrder = await placeOrder(baseUrl, { customerLanguage: "en" });
      const sent3 = readOutbox().find((entry) => entry.subject.includes(enOrder.number));
      assert.equal(sent3.subject, `EN DEFAULT LANG OVERRIDE ${enOrder.number}`, "an English customer's own-language row (rung 1) is used, not the ro row");

      // Rung 3: deactivate both rows - only the hardcoded original is left,
      // and it must speak the customer's own language (ro vs en variant).
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "RO SPECIFIC OVERRIDE {{orderNumber}}", body: "ro specific body", active: false, languageCode: "ro" }
      });
      await jsonRequest(baseUrl, "/api/admin/email-templates/order-received", {
        method: "PUT", cookie: adminCookie,
        body: { subject: "EN DEFAULT LANG OVERRIDE {{orderNumber}}", body: "en default body", active: false, languageCode: "en" }
      });

      const roHardcoded = await placeOrder(baseUrl, { customerLanguage: "ro" });
      const roSent = readOutbox().find((entry) => entry.subject.includes(roHardcoded.number));
      assert.match(roSent.subject, /primita/, "rung 3, Romanian customer: the hardcoded Romanian original");

      const enHardcoded = await placeOrder(baseUrl, { customerLanguage: "en" });
      const enSent = readOutbox().find((entry) => entry.subject.includes(enHardcoded.number));
      assert.match(enSent.subject, /has been received/i, "rung 3, English customer: the hardcoded English variant, not a Romanian default");
    });

    await t.test("KNOWN LIMITATION, documented: rung 3 only has ro/en variants, so a 3rd active language with no admin override still gets the Romanian original", async () => {
      await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "PUT", cookie: adminCookie,
        body: { name: "French", nativeName: "Francais", active: true }
      });

      // order-received's ro/en rows are both inactive from the previous
      // test, and no fr-specific row exists, so this genuinely reaches
      // rung 3 with a language the hardcoded fallback doesn't know.
      const frOrder = await placeOrder(baseUrl, { customerLanguage: "fr" });
      const frSent = readOutbox().find((entry) => entry.subject.includes(frOrder.number));
      assert.match(frSent.subject, /primita/, "documents actual behavior: rung 3 has no French variant, so it speaks Romanian, not French or English");
    });
  } finally {
    stopServer(httpServer);
  }
});
