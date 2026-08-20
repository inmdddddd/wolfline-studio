const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for country-based pricing: admin CRUD on
// product_prices/shipping_method_prices (keyed by COUNTRY, not currency -
// "Romania price" and "United Kingdom price" are independent knobs even
// when two countries share a currency), and - the actual point of this
// system - that /api/checkout resolves a price source ONCE per order,
// server-side, from the customer's country, and never mixes currencies
// within one order even when only some of its items/shipping have a real
// override for the resolved country.

const ADMIN_EMAIL = "admin@product-pricing-test.local";
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

async function createProduct(baseUrl, adminCookie, overrides = {}) {
  const name = overrides.name || `Test Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products", {
    method: "POST",
    cookie: adminCookie,
    body: { price: 50, currency: "GBP", status: "live", stock: 10, ...overrides, name }
  });
  assert.equal(status, 200, `product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

async function addToCart(baseUrl, productId, qty = 1) {
  const addRes = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ productId, size: "", qty })
  });
  assert.equal(addRes.status, 200, "cart add must succeed");
  return cookiesFrom(addRes);
}

async function checkout(baseUrl, cookie, overrides = {}) {
  const res = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({
      customerName: "Test Buyer",
      customerEmail: `buyer-${Math.random().toString(16).slice(2)}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Bucuresti",
      customerCountry: "RO",
      ...overrides
    })
  });
  const payload = await res.json();
  return { status: res.status, payload };
}

test("country-based pricing: product/shipping price overrides, all-or-nothing resolution", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-product-pricing-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  // Shared setup: RON currency, RO -> RON country mapping, a RO shipping
  // zone with a free-shipping method (so shipping never blocks resolution
  // in the tests that don't specifically target it).
  await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
    method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: true }
  });
  await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
    method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "RON" }
  });
  const zoneRes = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
    method: "POST", cookie: adminCookie, body: { name: "Romania", countries: ["RO"] }
  });
  const zoneId = zoneRes.payload.zone.id;
  const methodRes = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
    method: "POST", cookie: adminCookie, body: { zoneId, name: "Standard", price: 0 }
  });
  const freeShippingMethodId = methodRes.payload.method.id;

  try {
    await t.test("admin CRUD: PUT product prices persists, GET reflects it, currency is derived from country_config", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const put = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie,
        body: { prices: [{ countryCode: "RO", price: 250, compareAtPrice: 300 }] }
      });
      assert.equal(put.status, 200, JSON.stringify(put.payload));
      assert.equal(put.payload.prices.length, 1);
      assert.equal(put.payload.prices[0].price, 250);
      assert.equal(put.payload.prices[0].countryCode, "RO");
      assert.equal(put.payload.prices[0].currencyCode, "RON", "currency must be derived from RO's country_config mapping, not submitted");

      const get = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, { cookie: adminCookie });
      assert.equal(get.payload.prices[0].countryCode, "RO");
      assert.equal(get.payload.prices[0].currencyCode, "RON");
      assert.equal(get.payload.prices[0].compareAtPrice, 300);
    });

    await t.test("admin CRUD: rejects a country with no language/currency mapping configured", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie,
        body: { prices: [{ countryCode: "ZZ", price: 100 }] }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /ZZ/);
    });

    await t.test("admin CRUD: rejects a negative price and a duplicate country in one submission", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const negative = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: -5 }] }
      });
      assert.equal(negative.status, 400);

      const duplicate = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie,
        body: { prices: [{ countryCode: "RO", price: 100 }, { countryCode: "RO", price: 200 }] }
      });
      assert.equal(duplicate.status, 400);
    });

    await t.test("admin CRUD: PUT is a wholesale replace, not an incremental add", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 100 }] }
      });
      const second = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [] }
      });
      assert.equal(second.payload.prices.length, 0, "submitting an empty set must clear existing overrides");
    });

    await t.test("two countries sharing the same currency get fully independent prices", async () => {
      // The whole point of country-keyed (not currency-keyed) pricing:
      // France and Germany can both be EUR yet carry different numbers.
      await jsonRequest(baseUrl, "/api/admin/currencies/EUR", {
        method: "PUT", cookie: adminCookie, body: { symbol: "€", decimalPlaces: 2, active: true }
      });
      await jsonRequest(baseUrl, "/api/admin/country-config/FR", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "EUR" }
      });
      await jsonRequest(baseUrl, "/api/admin/country-config/DE", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "EUR" }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      const put = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie,
        body: { prices: [{ countryCode: "FR", price: 55 }, { countryCode: "DE", price: 60 }] }
      });
      assert.equal(put.status, 200, JSON.stringify(put.payload));
      const byCountry = Object.fromEntries(put.payload.prices.map((p) => [p.countryCode, p]));
      assert.equal(byCountry.FR.price, 55);
      assert.equal(byCountry.FR.currencyCode, "EUR");
      assert.equal(byCountry.DE.price, 60);
      assert.equal(byCountry.DE.currencyCode, "EUR");
    });

    await t.test("checkout end-to-end: a fully-covered order resolves to the mapped country/currency, server-side, everywhere", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });

      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, { shippingMethodId: freeShippingMethodId });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "RON", "order.currency must be the resolved currency");
      assert.equal(payload.order.items[0].currency, "RON", "every order item must agree with the order's currency");
      assert.equal(payload.order.items[0].price, 250, "the item's price must be the admin-configured RO override, not the base GBP price");
      assert.equal(payload.order.total, 250, "the order total must be computed from the resolved override, not converted");

      // Cross-check via the admin order view too, not just the checkout
      // response - confirms the DB row itself, not just what the API
      // happened to echo back.
      const adminOrders = await jsonRequest(baseUrl, "/api/admin/orders", { cookie: adminCookie });
      const stored = adminOrders.payload.orders.find((o) => o.id === payload.order.id);
      assert.equal(stored.currency, "RON");
    });

    await t.test("checkout ignores any client-submitted price - the server never trusts anything but its own product/price lookup", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      // Smuggle in fields no legitimate client would ever need to send -
      // total/items/price - and confirm they have zero effect.
      const { status, payload } = await checkout(baseUrl, cookie, {
        shippingMethodId: freeShippingMethodId,
        total: 1,
        items: [{ price: 1, currency: "RON" }],
        price: 1
      });
      assert.equal(status, 200);
      assert.equal(payload.order.total, 250, "a spoofed total must be completely ignored");
      assert.equal(payload.order.items[0].price, 250, "a spoofed item price must be completely ignored");
    });

    await t.test("all-or-nothing: one item missing a RO override falls the WHOLE order back to base pricing, never mixed", async () => {
      const covered = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${covered.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });
      const uncovered = await createProduct(baseUrl, adminCookie, { price: 30, currency: "GBP" });
      // uncovered gets no RO override at all.

      const cookie1 = await addToCart(baseUrl, covered.id);
      const addRes = await fetch(`${baseUrl}/api/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie1 },
        body: JSON.stringify({ productId: uncovered.id, size: "", qty: 1 })
      });
      const cookie2 = cookiesFrom(addRes) || cookie1;

      const { status, payload } = await checkout(baseUrl, cookie2, { shippingMethodId: freeShippingMethodId });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "GBP", "must fall back to the default currency, not partially resolve");
      assert.ok(payload.order.items.every((item) => item.currency === "GBP"), "every item must agree - never a mixed-currency order");
      assert.equal(payload.order.total, 80, "totals must reflect base GBP pricing (50 + 30), not a partial RON total");
    });

    await t.test("all-or-nothing: shipping without a country-price override also falls the whole order back", async () => {
      const paidZoneRes = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Romania Paid", countries: [] }
      });
      // Countries: [] makes this the catch-all zone, so it'll be matched
      // ahead of the free "Romania" zone above is NOT guaranteed - use a
      // fresh distinct country instead to avoid fighting the shared RO zone.
      await jsonRequest(baseUrl, "/api/admin/country-config/MD", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "RON" }
      });
      const zone2 = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Moldova", countries: ["MD"] }
      });
      const paidMethod = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST", cookie: adminCookie, body: { zoneId: zone2.payload.zone.id, name: "Standard", price: 10 }
      });
      // No shipping_method_prices override added for this method at all.

      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "MD", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, {
        customerCountry: "MD",
        shippingMethodId: paidMethod.payload.method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "GBP", "a paid shipping method with no MD price override must block resolution entirely");
      assert.equal(payload.order.shipping.cost, 10, "shipping cost must be the base GBP price, not a guess");

      // Now add the missing override and confirm the SAME order now
      // resolves to RON, cost included - proves the fallback was really
      // about the missing override, not something else.
      await jsonRequest(baseUrl, `/api/admin/shipping-methods/${paidMethod.payload.method.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "MD", price: 40 }] }
      });
      const cookie2 = await addToCart(baseUrl, product.id);
      const second = await checkout(baseUrl, cookie2, {
        customerCountry: "MD",
        shippingMethodId: paidMethod.payload.method.id
      });
      assert.equal(second.payload.order.currency, "RON");
      assert.equal(second.payload.order.shipping.cost, 40, "shipping cost must come from the country-specific override once one exists");
    });

    await t.test("a stale price row (country's currency changed since the price was saved) is treated as no override, not silently charged", async () => {
      await jsonRequest(baseUrl, "/api/admin/currencies/EUR", {
        method: "PUT", cookie: adminCookie, body: { symbol: "€", decimalPlaces: 2, active: true }
      });
      await jsonRequest(baseUrl, "/api/admin/country-config/PL", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "RON" }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "PL", price: 250 }] }
      });
      // Admin repoints PL from RON to EUR WITHOUT re-saving the product's
      // price row - that row is now stored as currency_code=RON while
      // country_config says PL is EUR: a mismatch, not a valid override.
      await jsonRequest(baseUrl, "/api/admin/country-config/PL", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "EUR" }
      });
      const zone = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Poland", countries: ["PL"] }
      });
      const method = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST", cookie: adminCookie, body: { zoneId: zone.payload.zone.id, name: "Standard", price: 0 }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, {
        customerCountry: "PL",
        shippingMethodId: method.payload.method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "GBP", "a currency-mismatched (stale) price row must never be charged as-is");
      assert.equal(payload.order.total, 50, "must fall back to the base price, not the stale RON number relabeled EUR");
    });

    await t.test("fixed-amount coupon forces the default currency, even when every item would otherwise qualify for RON", async () => {
      await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST", cookie: adminCookie,
        body: { code: "FIXED10", type: "fixed", value: 10 }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, {
        shippingMethodId: freeShippingMethodId,
        couponCode: "FIXED10"
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "GBP", "a fixed discount is only meaningful in the currency it was configured in");
      assert.equal(payload.order.total, 40, "50 - 10 fixed discount, in GBP");
      assert.equal(payload.order.discount, 10);
    });

    await t.test("percent coupon scales correctly when the order DOES resolve to a non-default country/currency", async () => {
      await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST", cookie: adminCookie,
        body: { code: "PERCENT10", type: "percent", value: 10 }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, {
        shippingMethodId: freeShippingMethodId,
        couponCode: "PERCENT10"
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "RON");
      assert.equal(payload.order.discount, 25, "10% of the RESOLVED 250 RON total, not 10% of the base 50 GBP price");
      assert.equal(payload.order.total, 225);
    });

    await t.test("coupon minOrderValue is always checked against the DEFAULT-currency subtotal, never the resolved one", async () => {
      // A cheap RON-priced item that would clear a RON-scaled minimum but
      // not the real GBP-denominated one configured here.
      await jsonRequest(baseUrl, "/api/admin/coupons", {
        method: "POST", cookie: adminCookie,
        body: { code: "MINVAL", type: "percent", value: 10, minOrderValue: 40 }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 20, currency: "GBP" });
      // A RO override that's numerically large (would clear a 40-unit
      // minimum if minOrderValue were ever mistakenly checked against the
      // resolved RON total instead of the GBP one).
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 500 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const { status, payload } = await checkout(baseUrl, cookie, {
        shippingMethodId: freeShippingMethodId,
        couponCode: "MINVAL"
      });
      assert.equal(status, 400, "the 20 GBP base subtotal must fail the 40 GBP minimum, regardless of the much larger RON number");
      assert.match(payload.error, /minimum/i);
    });

    await t.test("public GET /api/products?country= resolves prices without leaking cost/prices internals", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP", costPrice: 5 });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250, compareAtPrice: 300 }] }
      });
      const res = await jsonRequest(baseUrl, `/api/products?country=RO`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(found.price, 250);
      assert.equal(found.currency, "RON");
      assert.equal(found.compareAtPrice, 300);
      assert.equal(found.costPrice, undefined, "costPrice must never appear in the public payload, country-resolved or not");
      assert.equal(found.prices, undefined, "the raw prices array must never appear in the public payload");
    });

    await t.test("an unconfigured ?country= is silently ignored, falling back to base pricing rather than erroring", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      const res = await jsonRequest(baseUrl, `/api/products?country=ZZ`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(res.status, 200);
      assert.equal(found.price, 50);
      assert.equal(found.currency, "GBP");
    });

    await t.test("/api/checkout-options preview reflects the same resolved country/currency checkout will actually use", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const preview = await fetch(`${baseUrl}/api/checkout-options?country=RO`, { headers: { Cookie: cookie } });
      const previewPayload = await preview.json();
      assert.equal(preview.status, 200);
      assert.equal(previewPayload.currency, "RON");
      assert.equal(previewPayload.total, 250);
    });

    await t.test("/api/checkout-options shipping method prices resolve for the SAME country as items/total, never mixed", async () => {
      const zone = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Mixed-check zone", countries: ["FI"] }
      });
      await jsonRequest(baseUrl, "/api/admin/country-config/FI", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "RON" }
      });
      const method = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST", cookie: adminCookie, body: { zoneId: zone.payload.zone.id, name: "Standard", price: 15 }
      });
      await jsonRequest(baseUrl, `/api/admin/shipping-methods/${method.payload.method.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "FI", price: 60 }] }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "FI", price: 250 }] }
      });
      const cookie = await addToCart(baseUrl, product.id);
      const preview = await fetch(`${baseUrl}/api/checkout-options?country=FI`, { headers: { Cookie: cookie } });
      const previewPayload = await preview.json();
      assert.equal(previewPayload.currency, "RON");
      assert.equal(
        previewPayload.shippingMethods[0].price, 60,
        "the shipping method's FI override must be shown, not its base GBP price, once the preview itself resolved to it"
      );
    });

    await t.test("deleting a country_config with prices attached is blocked with a clear error, not a raw FK failure", async () => {
      await jsonRequest(baseUrl, "/api/admin/country-config/AT", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "RON" }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 50, currency: "GBP" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "AT", price: 250 }] }
      });
      const del = await jsonRequest(baseUrl, "/api/admin/country-config/AT", { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 400);
      assert.match(del.payload.error, /price/i);

      // Clearing the price row first must let the deletion succeed.
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [] }
      });
      const del2 = await jsonRequest(baseUrl, "/api/admin/country-config/AT", { method: "DELETE", cookie: adminCookie });
      assert.equal(del2.status, 200);
    });

    await t.test("price-override admin routes require auth (401 for anonymous)", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const get = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`);
      assert.equal(get.status, 401);
      const put = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", body: { prices: [] }
      });
      assert.equal(put.status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});

// Exchange-rate auto-conversion (currencies.displayRateFromDefault) as a
// fallback price source when no admin has set an explicit per-country
// product_prices row - the actual point being that the number a customer
// sees while browsing and the number they get charged at checkout are
// always the exact same one, never a generic display-only estimate that
// reverts to the default currency the moment they submit an order.
test("country-based pricing: exchange-rate auto-conversion fallback", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-product-pricing-autoconvert-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  // Currency must exist before a country can be mapped to it.
  await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
    method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: true }
  });
  await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
    method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "RON" }
  });
  const zoneRes = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
    method: "POST", cookie: adminCookie, body: { name: "Romania", countries: ["RO"] }
  });
  const methodRes = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
    method: "POST", cookie: adminCookie, body: { zoneId: zoneRes.payload.zone.id, name: "Standard", price: 0 }
  });
  const freeShippingMethodId = methodRes.payload.method.id;

  try {
    await t.test("with no rate configured, a product with no override still falls back to the base price/currency", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 59 });
      const res = await jsonRequest(baseUrl, `/api/products?country=RO`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(found.currency, "GBP");
      assert.equal(found.price, 59);
    });

    await t.test("with a rate configured, a product with no override auto-converts on the public API", async () => {
      await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: true, displayRateFromDefault: 5 }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 59, compareAtPrice: 79 });

      const list = await jsonRequest(baseUrl, `/api/products?country=RO`);
      const found = list.payload.products.find((p) => p.id === product.id);
      assert.equal(found.currency, "RON");
      assert.equal(found.price, 295, "59 * 5, rounded to RON's 0 decimal places");
      assert.equal(found.compareAtPrice, 395, "compareAtPrice converts with the same rate");

      const detail = await jsonRequest(baseUrl, `/api/products/${product.id}?country=RO`);
      assert.equal(detail.payload.product.currency, "RON");
      assert.equal(detail.payload.product.price, 295);
    });

    await t.test("an explicit per-country override still wins over the exchange-rate conversion", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 59 });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/prices`, {
        method: "PUT", cookie: adminCookie, body: { prices: [{ countryCode: "RO", price: 249 }] }
      });

      const res = await jsonRequest(baseUrl, `/api/products?country=RO`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(found.price, 249, "the admin-set 249 must win over 59*5=295");
      assert.equal(found.currency, "RON");
    });

    await t.test("checkout actually charges the auto-converted amount, matching what checkout-options previewed", async () => {
      const product = await createProduct(baseUrl, adminCookie, { price: 59 });
      const cartCookie = await addToCart(baseUrl, product.id, 1);

      const preview = await jsonRequest(baseUrl, "/api/checkout-options?country=RO", { cookie: cartCookie });
      assert.equal(preview.payload.currency, "RON", "the preview must show the same currency the order will actually charge");

      const { status, payload } = await checkout(baseUrl, cartCookie, { shippingMethodId: freeShippingMethodId });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.currency, "RON", "the real order must charge in RON, not silently revert to GBP");
      assert.equal(payload.order.total, 295);
      assert.equal(payload.order.items[0].currency, "RON");
      assert.equal(payload.order.items[0].price, 295);
    });

    await t.test("a product not priced in the store's default currency is never auto-converted", async () => {
      // EUR is neither the default (GBP) nor RON - displayRateFromDefault is
      // only ever defined as "from the default currency", so there is no
      // rate this could apply here even if one existed for RON.
      const product = await createProduct(baseUrl, adminCookie, { price: 59, currency: "EUR" });
      const res = await jsonRequest(baseUrl, `/api/products?country=RO`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(found.currency, "EUR");
      assert.equal(found.price, 59);
    });

    await t.test("a currency with 2 decimal places rounds the conversion to cents, not whole units", async () => {
      await jsonRequest(baseUrl, "/api/admin/currencies/USD", {
        method: "PUT", cookie: adminCookie, body: { symbol: "$", decimalPlaces: 2, active: true, displayRateFromDefault: 1.27 }
      });
      await jsonRequest(baseUrl, "/api/admin/country-config/US", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "en", currencyCode: "USD" }
      });
      const product = await createProduct(baseUrl, adminCookie, { price: 10 });

      const res = await jsonRequest(baseUrl, `/api/products?country=US`);
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.equal(found.currency, "USD");
      assert.equal(found.price, 12.7, "10 * 1.27, rounded to 2 decimal places");
    });
  } finally {
    stopServer(httpServer);
  }
});
