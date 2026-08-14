const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Cross-cutting integration coverage: every i18n/country-pricing piece
// exercised TOGETHER in one realistic purchase, the way the individual
// per-feature test files (product-pricing, translations, product-translations,
// email-templates) deliberately never combine them. A Romanian customer
// orders a product that has a RO price override, RO shipping override, and
// RO/category translations; the whole chain - checkout resolution, the
// order record, the CUSTOMER-facing (token-gated, not admin) order lookup
// used by invoice.html/thank-you.html, and the confirmation email - must
// all agree on the exact RON amount and the Romanian language, with no
// currency conversion and no untranslated leakage anywhere along the way.

const ADMIN_EMAIL = "admin@i18n-integration-test.local";
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

function readOutbox() {
  delete require.cache[require.resolve("../lib/email.js")];
  return require("../lib/email.js").readOutbox();
}

test("cross-cutting integration: a Romanian customer's purchase resolves currency, translations, and language together, with no conversion anywhere in the chain", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-i18n-integration-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("full scenario: RON currency + RO country mapping + RO price/shipping overrides + RO product/category translations + Romanian checkout", async () => {
      // --- 1. Currency + country configuration (admin-driven, no hardcoded
      // country logic anywhere in the frontend) ---
      const currency = await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 2, active: true }
      });
      assert.equal(currency.status, 200, JSON.stringify(currency.payload));

      const countryConfig = await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "RON" }
      });
      assert.equal(countryConfig.status, 200, JSON.stringify(countryConfig.payload));

      // --- 2. A paid RO shipping method with its OWN RON override (not the
      // free-shipping shortcut other tests lean on - this proves the
      // shipping_method_prices resolution path is really wired end-to-end) ---
      const zone = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Romania", countries: ["RO"] }
      });
      assert.equal(zone.status, 200, JSON.stringify(zone.payload));
      const method = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST", cookie: adminCookie, body: { zoneId: zone.payload.zone.id, name: "Curier", price: 15 }
      });
      assert.equal(method.status, 200, JSON.stringify(method.payload));
      const shippingPrice = await jsonRequest(baseUrl, `/api/admin/shipping-methods/${method.payload.method.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 20 }] }
      });
      assert.equal(shippingPrice.status, 200, JSON.stringify(shippingPrice.payload));

      // --- 3. A product with a base GBP price, a RO price override, and a
      // translated (non-default-language) category ---
      const product = await jsonRequest(baseUrl, "/api/admin/products", {
        method: "POST", cookie: adminCookie,
        body: {
          name: "Golden Hour Tee", category: "Tricouri", price: 50, currency: "GBP",
          status: "live", stock: 10, description: "EN base description"
        }
      });
      assert.equal(product.status, 200, JSON.stringify(product.payload));
      const productId = product.payload.product.id;
      const categoryId = product.payload.product.categoryId;
      assert.ok(categoryId, "creating a product must resolve-or-create its category row underneath the free-text field");

      const priceOverride = await jsonRequest(baseUrl, `/api/admin/products/${productId}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 275, compareAtPrice: 320 }] }
      });
      assert.equal(priceOverride.status, 200, JSON.stringify(priceOverride.payload));
      assert.equal(priceOverride.payload.prices[0].currencyCode, "RON", "the price row's currency must be derived from RO's country_config, not chosen independently");

      const productTranslations = await jsonRequest(baseUrl, `/api/admin/products/${productId}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: {
          translations: [{
            languageCode: "ro",
            name: "Tricou Ora de Aur",
            description: "Descriere completa in romana.",
            shortDescription: "Scurt RO",
            seoTitle: "SEO RO",
            seoDescription: "SEO descriere RO"
          }]
        }
      });
      assert.equal(productTranslations.status, 200, JSON.stringify(productTranslations.payload));

      const categoryTranslation = await jsonRequest(baseUrl, `/api/admin/categories/${categoryId}`, {
        method: "PUT", cookie: adminCookie,
        body: { defaultName: "Tricouri", translations: [{ languageCode: "ro", name: "Tricouri" }] }
      });
      assert.equal(categoryTranslation.status, 200, JSON.stringify(categoryTranslation.payload));

      // --- 4. Public storefront payload: country pricing AND translations
      // must coexist correctly on the SAME product response - proves
      // resolving one never clobbers or hides the other. ---
      const publicList = await jsonRequest(baseUrl, "/api/products?country=RO");
      const publicProduct = publicList.payload.products.find((p) => p.id === productId);
      assert.ok(publicProduct, "the product must be visible in the public country-scoped listing");
      assert.equal(publicProduct.price, 275, "public listing must show the RO-resolved price");
      assert.equal(publicProduct.currency, "RON");
      assert.equal(publicProduct.compareAtPrice, 320);
      const roTranslation = publicProduct.translations.find((entry) => entry.languageCode === "ro");
      assert.ok(roTranslation, "the ro product translation must still be exposed alongside country pricing");
      assert.equal(roTranslation.name, "Tricou Ora de Aur");
      assert.equal(publicProduct.categoryTranslations.ro, "Tricouri");

      // --- 5. Real checkout, as a Romanian customer, in Romanian, paying
      // for RO-priced shipping - the actual purchase. ---
      const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({ productId, size: "", qty: 2 })
      });
      assert.equal(addResponse.status, 200, JSON.stringify(await addResponse.clone().json().catch(() => ({}))));
      const cartCookie = cookiesFrom(addResponse);

      const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cartCookie },
        body: JSON.stringify({
          customerName: "Ana Popescu",
          customerEmail: `ana-${Math.random().toString(16).slice(2)}@example.com`,
          customerPhone: "0722000000",
          customerAddress: "Str. Exemplu 10, Cluj-Napoca",
          customerCountry: "RO",
          customerLanguage: "ro",
          shippingMethodId: method.payload.method.id
        })
      });
      const checkoutPayload = await checkoutResponse.json();
      assert.equal(checkoutResponse.status, 200, `checkout must succeed: ${JSON.stringify(checkoutPayload)}`);

      const order = checkoutPayload.order;
      assert.equal(order.currency, "RON", "the whole order must resolve to RON - product AND shipping both had RO overrides");
      assert.equal(order.items[0].currency, "RON");
      assert.equal(order.items[0].price, 275, "server-computed price, from the admin RO override - never client-submitted");
      assert.equal(order.shipping.cost, 20, "shipping must use its own RO override, not the base GBP price");
      assert.equal(order.total, 275 * 2 + 20, "total = 2x resolved item price + resolved shipping, no conversion, no tax configured for RO");
      // customerLanguage isn't part of publicOrder()'s surface (same
      // narrow-by-design omission as customerCountry) - checked below via
      // the admin order view instead, where it does live.

      // --- 6. The CUSTOMER-facing read path (token-gated, anonymous, no
      // admin cookie) - the same endpoint invoice.html/thank-you.html call
      // client-side. Distinct from the admin order view other test files
      // already check: this proves the exact amount survives all the way
      // out to what the buyer themselves can see, unauthenticated. ---
      const token = checkoutPayload.publicAccessToken;
      assert.ok(token, "checkout must return a guest access token for the confirmation/invoice pages");
      const customerView = await jsonRequest(baseUrl, `/api/orders/${order.id}?token=${encodeURIComponent(token)}`);
      assert.equal(customerView.status, 200, JSON.stringify(customerView.payload));
      assert.equal(customerView.payload.order.currency, "RON", "the customer-facing order lookup must show the same RON currency, no re-conversion");
      assert.equal(customerView.payload.order.total, 275 * 2 + 20, "the customer-facing total must be the exact charged amount");
      assert.equal(customerView.payload.order.items[0].price, 275);
      assert.equal(customerView.payload.order.shipping.cost, 20);

      // --- 7. The order-received email: no admin template override exists
      // for either "ro" or the store's default language, so this is rung 3
      // (the hardcoded original) - and because the customer's own language
      // is Romanian, it must render in Romanian, matching this store's
      // historical (pre-i18n) behavior exactly. ---
      const outbox = readOutbox();
      const sent = outbox.find((entry) => entry.subject.includes(order.number));
      assert.ok(sent, "an order-received email must have been sent");
      assert.match(sent.subject, /primita/, "a Romanian customer with no admin override gets the Romanian hardcoded original");
      assert.match(sent.text, /Salut Ana Popescu/, "the email body itself must be Romanian, not the store's English default");

      // --- 8. Cross-check via the admin order view too, so every reader of
      // this order (admin dashboard, customer invoice link, outbound email)
      // agrees on the identical number. ---
      const adminOrders = await jsonRequest(baseUrl, "/api/admin/orders", { cookie: adminCookie });
      const stored = adminOrders.payload.orders.find((o) => o.id === order.id);
      assert.equal(stored.currency, "RON");
      assert.equal(stored.total, 275 * 2 + 20);
      assert.equal(stored.customerLanguage, "ro");
    });
  } finally {
    stopServer(httpServer);
  }
});
