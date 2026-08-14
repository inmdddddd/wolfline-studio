const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for the shipping-zones/shipping-methods/tax-rates
// system: admin CRUD, the public checkout-options preview, and - most
// importantly - that checkout computes shipping+tax server-side from the
// admin's configuration and never trusts a client-submitted cost/tax/total.

const ADMIN_EMAIL = "admin@shipping-tax-test.local";
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

async function createZone(baseUrl, adminCookie, overrides = {}) {
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "Romania", countries: ["RO"], ...overrides }
  });
  assert.equal(status, 200, `zone create must succeed: ${JSON.stringify(payload)}`);
  return payload.zone;
}

async function createMethod(baseUrl, adminCookie, zoneId, overrides = {}) {
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
    method: "POST",
    cookie: adminCookie,
    body: { zoneId, name: "Standard", price: 15, ...overrides }
  });
  assert.equal(status, 200, `method create must succeed: ${JSON.stringify(payload)}`);
  return payload.method;
}

async function createTaxRate(baseUrl, adminCookie, overrides = {}) {
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/tax-rates", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "TVA", country: "RO", rate: 19, inclusive: true, ...overrides }
  });
  assert.equal(status, 200, `tax rate create must succeed: ${JSON.stringify(payload)}`);
  return payload.taxRate;
}

// Places a checkout for qty 1 of the first live product, letting the caller
// override the request body (country, shippingMethodId, spoofed fields, ...).
async function placeCheckout(baseUrl, overrides = {}) {
  const { payload: productsPayload } = await jsonRequest(baseUrl, "/api/products");
  const product = productsPayload.products[0];
  const size = (product.sizes || [])[0] || "";

  const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ productId: product.id, size, qty: 1 })
  });
  assert.equal(addResponse.status, 200, "cart add must succeed");
  const cookie = cookiesFrom(addResponse);

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({
      customerName: "Shipping Tester",
      customerEmail: `buyer-${Math.random().toString(16).slice(2)}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Iasi",
      customerCountry: "RO",
      customerLanguage: "ro",
      ...overrides
    })
  });
  const payload = await checkoutResponse.json().catch(() => ({}));
  return { status: checkoutResponse.status, payload, product, price: product.price };
}

test("shipping zones/methods: admin CRUD, reorder, cascade delete", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-shipping-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("create zone + method, GET lists them nested and ordered", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Romania", countries: ["ro", "ro"] });
      assert.deepEqual(zone.countries, ["RO"], "countries are uppercased and deduped");

      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Standard", price: 15 });
      const fast = await createMethod(baseUrl, adminCookie, zone.id, { name: "Express", price: 30, sortOrder: 0 });

      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-zones", { cookie: adminCookie });
      assert.equal(status, 200);
      const listed = payload.zones.find((z) => z.id === zone.id);
      assert.ok(listed, "created zone appears in the list");
      assert.equal(listed.methods.length, 2);
      assert.ok(listed.methods.some((m) => m.id === method.id));
      assert.ok(listed.methods.some((m) => m.id === fast.id));
    });

    await t.test("zone create rejects a missing name", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST",
        cookie: adminCookie,
        body: { countries: ["FR"] }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /nume/i);
    });

    await t.test("method create rejects an unknown zoneId", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST",
        cookie: adminCookie,
        body: { zoneId: "does-not-exist", name: "Ghost", price: 10 }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /zona/i);
    });

    await t.test("method create rejects a negative price", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Negative price zone", countries: ["DE"] });
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/shipping-methods", {
        method: "POST",
        cookie: adminCookie,
        body: { zoneId: zone.id, name: "Bad", price: -5 }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /pret/i);
    });

    await t.test("update zone renames, recounties and toggles active", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Old name", countries: ["ES"] });
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/shipping-zones/${zone.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { name: "New name", countries: ["PT"], active: false }
      });
      assert.equal(status, 200);
      assert.equal(payload.zone.name, "New name");
      assert.deepEqual(payload.zone.countries, ["PT"]);
      assert.equal(payload.zone.active, false);
    });

    await t.test("update zone on an unknown id returns 404", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/shipping-zones/00000000-0000-4000-8000-000000000000", {
        method: "PUT",
        cookie: adminCookie,
        body: { name: "X" }
      });
      assert.equal(status, 404);
    });

    await t.test("deleting a zone cascades to its methods", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Cascade zone", countries: ["IT"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Cascade method", price: 5 });

      const del = await jsonRequest(baseUrl, `/api/admin/shipping-zones/${zone.id}`, {
        method: "DELETE",
        cookie: adminCookie
      });
      assert.equal(del.status, 200);

      const zonesAfter = await jsonRequest(baseUrl, "/api/admin/shipping-zones", { cookie: adminCookie });
      assert.ok(!zonesAfter.payload.zones.some((z) => z.id === zone.id), "zone is gone");

      const methodUpdate = await jsonRequest(baseUrl, `/api/admin/shipping-methods/${method.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { name: "Still there?" }
      });
      assert.equal(methodUpdate.status, 404, "method row was cascade-deleted with its zone");
    });

    await t.test("reorder persists the new sortOrder", async () => {
      const zoneA = await createZone(baseUrl, adminCookie, { name: "Reorder A", countries: ["NL"], sortOrder: 0 });
      const zoneB = await createZone(baseUrl, adminCookie, { name: "Reorder B", countries: ["BE"], sortOrder: 1 });

      const { status } = await jsonRequest(baseUrl, "/api/admin/shipping-zones/reorder", {
        method: "POST",
        cookie: adminCookie,
        body: { ids: [zoneB.id, zoneA.id] }
      });
      assert.equal(status, 200);

      const { payload } = await jsonRequest(baseUrl, "/api/admin/shipping-zones", { cookie: adminCookie });
      const orderedIds = payload.zones
        .filter((z) => z.id === zoneA.id || z.id === zoneB.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((z) => z.id);
      assert.deepEqual(orderedIds, [zoneB.id, zoneA.id]);
    });

    await t.test("shipping admin routes require admin auth", async () => {
      const anon = await jsonRequest(baseUrl, "/api/admin/shipping-zones");
      assert.equal(anon.status, 401);

      const anonPost = await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST",
        body: { name: "Nope", countries: ["RO"] }
      });
      assert.equal(anonPost.status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});

test("tax rates: admin CRUD and validation", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-tax-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("create + list a tax rate", async () => {
      const rate = await createTaxRate(baseUrl, adminCookie, { country: "RO", rate: 19, inclusive: true });
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/tax-rates", { cookie: adminCookie });
      assert.equal(status, 200);
      assert.ok(payload.taxRates.some((t) => t.id === rate.id));
    });

    await t.test("rejects an invalid (non-2-letter) country", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/tax-rates", {
        method: "POST",
        cookie: adminCookie,
        body: { name: "Bad", country: "Romania", rate: 19 }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /tara|taxa/i);
    });

    await t.test("rejects a negative rate", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/tax-rates", {
        method: "POST",
        cookie: adminCookie,
        body: { name: "Bad", country: "FR", rate: -1 }
      });
      assert.equal(status, 400);
    });

    await t.test("update toggles active and changes the rate", async () => {
      const rate = await createTaxRate(baseUrl, adminCookie, { country: "DE", rate: 19 });
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/tax-rates/${rate.id}`, {
        method: "PUT",
        cookie: adminCookie,
        body: { rate: 21, active: false }
      });
      assert.equal(status, 200);
      assert.equal(payload.taxRate.rate, 21);
      assert.equal(payload.taxRate.active, false);
    });

    await t.test("delete removes the rate", async () => {
      const rate = await createTaxRate(baseUrl, adminCookie, { country: "AT", rate: 20 });
      const del = await jsonRequest(baseUrl, `/api/admin/tax-rates/${rate.id}`, { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);
      const { payload } = await jsonRequest(baseUrl, "/api/admin/tax-rates", { cookie: adminCookie });
      assert.ok(!payload.taxRates.some((t) => t.id === rate.id));
    });

    await t.test("tax admin routes require admin auth", async () => {
      const anon = await jsonRequest(baseUrl, "/api/admin/tax-rates");
      assert.equal(anon.status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});

test("checkout-options: public preview of shipping methods + tax for a country", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-checkout-options-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    const zone = await createZone(baseUrl, adminCookie, { name: "Romania", countries: ["RO"] });
    await createMethod(baseUrl, adminCookie, zone.id, { name: "Standard", price: 15, estimatedDeliveryText: "2-5 zile" });
    await createTaxRate(baseUrl, adminCookie, { country: "RO", rate: 19, inclusive: true });

    await t.test("returns configured methods and tax for a covered country", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/checkout-options?country=RO");
      assert.equal(status, 200);
      assert.equal(payload.shippingMethods.length, 1);
      assert.equal(payload.shippingMethods[0].name, "Standard");
      assert.equal(payload.shippingMethods[0].estimatedDeliveryText, "2-5 zile");
      assert.ok(payload.tax);
      assert.equal(payload.tax.rate, 19);
      assert.equal(payload.tax.inclusive, true);
    });

    await t.test("returns an empty list (not an error) for an unconfigured country", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/checkout-options?country=JP");
      assert.equal(status, 200);
      assert.deepEqual(payload.shippingMethods, []);
      assert.equal(payload.tax, null);
    });

    await t.test("rejects a malformed country parameter", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/checkout-options?country=Romania");
      assert.equal(status, 400);
    });

    await t.test("rejects a missing country parameter", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/checkout-options");
      assert.equal(status, 400);
    });
  } finally {
    stopServer(httpServer);
  }
});

test("checkout: server-side shipping + tax calculation", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-checkout-shiptax-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("rejects checkout with no country submitted", async () => {
      const { status, payload } = await placeCheckout(baseUrl, { customerCountry: "" });
      assert.equal(status, 400);
      assert.match(payload.error, /tara/i);
    });

    await t.test("a country with no configured zone falls back to free shipping (no regression)", async () => {
      const { status, payload, price } = await placeCheckout(baseUrl, { customerCountry: "JP" });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.shipping.cost, 0);
      assert.equal(payload.order.shipping.methodName, null);
      assert.equal(payload.order.total, price, "with no shipping/tax configured, total is exactly the item price - matches pre-shipping-system behavior");
    });

    await t.test("inclusive tax: total is subtotal + shipping, tax is informational only (not added on top)", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Romania", countries: ["RO"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Standard", price: 15 });
      await createTaxRate(baseUrl, adminCookie, { country: "RO", rate: 19, inclusive: true });

      const { status, payload, price } = await placeCheckout(baseUrl, {
        customerCountry: "RO",
        shippingMethodId: method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.shipping.cost, 15);
      assert.equal(payload.order.shipping.methodName, "Standard");
      assert.equal(
        payload.order.total,
        Math.round((price + 15) * 100) / 100,
        "inclusive VAT must not be added on top of the subtotal"
      );
      assert.equal(payload.order.tax.inclusive, true);
      assert.ok(payload.order.tax.amount > 0, "the VAT portion is still reported for the receipt");
    });

    await t.test("exclusive tax: adds on top of subtotal + shipping", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "United Kingdom", countries: ["GB"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Royal Post", price: 10 });
      await createTaxRate(baseUrl, adminCookie, { name: "VAT", country: "GB", rate: 20, inclusive: false });

      const { status, payload, price } = await placeCheckout(baseUrl, {
        customerCountry: "GB",
        shippingMethodId: method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      const expectedTax = Math.round(price * 0.2 * 100) / 100;
      assert.equal(payload.order.tax.amount, expectedTax);
      assert.equal(payload.order.tax.inclusive, false);
      assert.equal(
        payload.order.total,
        Math.round((price + 10 + expectedTax) * 100) / 100,
        "exclusive tax is added on top of subtotal + shipping"
      );
    });

    await t.test("free-shipping threshold zeroes the cost once reached", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Free ship zone", countries: ["SE"] });
      const { payload: productsPayload } = await jsonRequest(baseUrl, "/api/products");
      const price = productsPayload.products[0].price;
      const method = await createMethod(baseUrl, adminCookie, zone.id, {
        name: "Standard",
        price: 15,
        freeShippingThreshold: Math.max(0, price - 1)
      });

      const { status, payload } = await placeCheckout(baseUrl, {
        customerCountry: "SE",
        shippingMethodId: method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.shipping.cost, 0, "subtotal already clears the free-shipping threshold");
    });

    await t.test("rejects a shippingMethodId that does not belong to the resolved zone (tamper attempt)", async () => {
      const zoneRo = await createZone(baseUrl, adminCookie, { name: "RO only", countries: ["RO"] });
      await createMethod(baseUrl, adminCookie, zoneRo.id, { name: "RO standard", price: 12 });
      const zoneFr = await createZone(baseUrl, adminCookie, { name: "FR only", countries: ["FR"] });
      const frMethod = await createMethod(baseUrl, adminCookie, zoneFr.id, { name: "FR standard", price: 3 });

      // Checking out to RO but supplying FR's (cheaper) method id.
      const { status, payload } = await placeCheckout(baseUrl, {
        customerCountry: "RO",
        shippingMethodId: frMethod.id
      });
      assert.equal(status, 400);
      assert.match(payload.error, /livrare/i);
    });

    await t.test("rejects an inactive method's id when an active alternative exists in the same zone", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Mixed active zone", countries: ["PL"] });
      const disabled = await createMethod(baseUrl, adminCookie, zone.id, { name: "Disabled", price: 9, active: false });
      await createMethod(baseUrl, adminCookie, zone.id, { name: "Active alt", price: 20 });

      const { status, payload } = await placeCheckout(baseUrl, {
        customerCountry: "PL",
        shippingMethodId: disabled.id
      });
      assert.equal(status, 400);
      assert.match(payload.error, /livrare/i);
    });

    await t.test("a zone whose only method is inactive degrades to free shipping, like an unconfigured zone", async () => {
      // No active method exists to choose from at all - same as the
      // no-zone-for-this-country case, not a client tampering attempt.
      const zone = await createZone(baseUrl, adminCookie, { name: "All-inactive zone", countries: ["PT"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Disabled", price: 9, active: false });

      const { status, payload } = await placeCheckout(baseUrl, {
        customerCountry: "PT",
        shippingMethodId: method.id
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.shipping.cost, 0);
    });

    await t.test("ignores client-submitted shipping cost / tax / total and recomputes them", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Spoof test zone", countries: ["FI"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Standard", price: 15 });

      const { status, payload, price } = await placeCheckout(baseUrl, {
        customerCountry: "FI",
        shippingMethodId: method.id,
        // Attacker-controlled fields the server must never trust.
        total: 0.01,
        shippingCost: 0,
        shipping: { cost: 0 },
        tax: { amount: 0 }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.order.shipping.cost, 15, "server-resolved shipping cost, not the spoofed 0");
      assert.equal(payload.order.total, Math.round((price + 15) * 100) / 100, "server-computed total, not the spoofed 0.01");
    });

    await t.test("order history keeps its shipping/tax snapshot after the zone and method are deleted", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Snapshot zone", countries: ["DK"] });
      const method = await createMethod(baseUrl, adminCookie, zone.id, { name: "Snapshot method", price: 22 });
      await createTaxRate(baseUrl, adminCookie, { name: "Snapshot VAT", country: "DK", rate: 25, inclusive: true });

      const { status, payload } = await placeCheckout(baseUrl, { customerCountry: "DK", shippingMethodId: method.id });
      assert.equal(status, 200, JSON.stringify(payload));

      await jsonRequest(baseUrl, `/api/admin/shipping-zones/${zone.id}`, { method: "DELETE", cookie: adminCookie });

      const { status: orderStatus, payload: orderPayload } = await jsonRequest(
        baseUrl,
        `/api/admin/orders`,
        { cookie: adminCookie }
      );
      assert.equal(orderStatus, 200);
      const stored = orderPayload.orders.find((o) => o.id === payload.order.id);
      assert.ok(stored, "order still exists after the shipping zone was deleted");
      assert.equal(stored.shipping.methodName, "Snapshot method", "order kept its own snapshot, unaffected by the zone deletion");
      assert.equal(stored.shipping.cost, 22);
      assert.equal(stored.tax.name, "Snapshot VAT");
    });

    await t.test("concurrent shipping-method creation on the same zone does not corrupt or crash", async () => {
      const zone = await createZone(baseUrl, adminCookie, { name: "Concurrency zone", countries: ["NO"] });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          jsonRequest(baseUrl, "/api/admin/shipping-methods", {
            method: "POST",
            cookie: adminCookie,
            body: { zoneId: zone.id, name: `Concurrent ${i}`, price: i }
          }))
      );
      assert.ok(results.every((r) => r.status === 200), "every concurrent create must succeed");
      const ids = new Set(results.map((r) => r.payload.method.id));
      assert.equal(ids.size, 5, "every created method has a distinct id");

      const { payload } = await jsonRequest(baseUrl, "/api/admin/shipping-zones", { cookie: adminCookie });
      const listed = payload.zones.find((z) => z.id === zone.id);
      assert.equal(listed.methods.length, 5, "all five methods are actually persisted");
    });
  } finally {
    stopServer(httpServer);
  }
});
