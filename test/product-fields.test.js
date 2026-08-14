const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for the extended product data model (SKU,
// barcode, weight, dimensions, compare-at/cost price, SEO fields, metadata,
// featured flag): admin validation, persistence, and what the public API
// is and isn't allowed to expose (costPrice must never leak).

const ADMIN_EMAIL = "admin@product-fields-test.local";
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
  // sanitizeProduct derives a brand-new product's slug from its name, and
  // products.slug is UNIQUE - every call needs its own name or the second
  // "Test Tee" in a test file collides with the first.
  const name = overrides.name || `Test Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products", {
    method: "POST",
    cookie: adminCookie,
    body: { price: 50, currency: "GBP", status: "live", stock: 10, ...overrides, name }
  });
  assert.equal(status, 200, `product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

test("product data model: admin CRUD, validation, and public exposure", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-product-fields-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("create with all new fields persists and round-trips via admin GET", async () => {
      const product = await createProduct(baseUrl, adminCookie, {
        sku: "TEE-001",
        barcode: "5012345678900",
        weightGrams: 250,
        dimensionsLength: 30, dimensionsWidth: 20, dimensionsHeight: 2, dimensionsUnit: "cm",
        compareAtPrice: 70,
        costPrice: 20,
        seoTitle: "Statement tee",
        seoDescription: "A limited run graphic tee.",
        canonicalUrl: "/product.html?id=statement-tee",
        metadataText: "Material: 100% cotton\nCare: Machine wash cold",
        featured: "on"
      });

      assert.equal(product.sku, "TEE-001");
      assert.equal(product.barcode, "5012345678900");
      assert.equal(product.weightGrams, 250);
      assert.deepEqual(product.dimensions, { length: 30, width: 20, height: 2, unit: "cm" });
      assert.equal(product.compareAtPrice, 70);
      assert.equal(product.costPrice, 20);
      assert.equal(product.seoTitle, "Statement tee");
      assert.equal(product.canonicalUrl, "/product.html?id=statement-tee");
      assert.deepEqual(product.metadata, { Material: "100% cotton", Care: "Machine wash cold" });
      assert.equal(product.featured, true);

      const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const stored = payload.products.find((p) => p.id === product.id);
      assert.equal(stored.sku, "TEE-001", "survives a full reload from the database, not just the create response");
    });

    await t.test("costPrice is never exposed on the public products API", async () => {
      const product = await createProduct(baseUrl, adminCookie, { costPrice: 15, status: "live" });
      const { payload } = await jsonRequest(baseUrl, "/api/products");
      const publicOne = payload.products.find((p) => p.id === product.id);
      assert.ok(publicOne, "product is listed publicly");
      assert.equal(publicOne.costPrice, undefined, "costPrice must never reach the public API");
    });

    await t.test("compareAtPrice is only shown publicly when it's actually higher than price", async () => {
      const higher = await createProduct(baseUrl, adminCookie, { price: 50, compareAtPrice: 70, status: "live" });
      const lowerOrEqual = await createProduct(baseUrl, adminCookie, { price: 50, compareAtPrice: 40, status: "live" });

      const { payload } = await jsonRequest(baseUrl, "/api/products");
      const higherPublic = payload.products.find((p) => p.id === higher.id);
      const lowerPublic = payload.products.find((p) => p.id === lowerOrEqual.id);

      assert.equal(higherPublic.compareAtPrice, 70);
      assert.equal(lowerPublic.compareAtPrice, null, "a compare-at price at or below the real price would be a fake discount");
    });

    await t.test("rejects a negative compare-at price, cost price, and weight", async () => {
      const negCompare = await jsonRequest(baseUrl, "/api/admin/products", {
        method: "POST", cookie: adminCookie,
        body: { name: "Bad", price: 10, compareAtPrice: -5 }
      });
      assert.equal(negCompare.status, 400);

      const negCost = await jsonRequest(baseUrl, "/api/admin/products", {
        method: "POST", cookie: adminCookie,
        body: { name: "Bad", price: 10, costPrice: -1 }
      });
      assert.equal(negCost.status, 400);

      const negWeight = await jsonRequest(baseUrl, "/api/admin/products", {
        method: "POST", cookie: adminCookie,
        body: { name: "Bad", price: 10, weightGrams: -1 }
      });
      assert.equal(negWeight.status, 400);
    });

    await t.test("clears an optional numeric field via empty string", async () => {
      const product = await createProduct(baseUrl, adminCookie, { compareAtPrice: 70 });
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { ...product, compareAtPrice: "" }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.product.compareAtPrice, null);
    });

    await t.test("clears an optional numeric field via JSON null (regression: echoing the product's own public payload back must not 400)", async () => {
      const product = await createProduct(baseUrl, adminCookie, { compareAtPrice: 70, status: "live" });
      const { payload: publicPayload } = await jsonRequest(baseUrl, "/api/products");
      const publicProduct = publicPayload.products.find((p) => p.id === product.id);
      assert.equal(publicProduct.compareAtPrice, 70);

      // Simulate an admin client that fetched the public shape (compareAtPrice
      // could be null there) and PUTs it straight back without editing it.
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { ...product, compareAtPrice: null, costPrice: null, weightGrams: null }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.product.compareAtPrice, null);
      assert.equal(payload.product.costPrice, null);
      assert.equal(payload.product.weightGrams, null);
    });

    await t.test("dimensions require all three parts; a partial set is dropped rather than stored broken", async () => {
      const product = await createProduct(baseUrl, adminCookie, {
        dimensionsLength: 10
        // width/height omitted
      });
      assert.equal(product.dimensions, undefined);
    });

    await t.test("rejects a dangerous canonical URL and silently drops it rather than storing it", async () => {
      const product = await createProduct(baseUrl, adminCookie, { canonicalUrl: "javascript:alert(1)" });
      assert.equal(product.canonicalUrl, "", "a rejected canonical URL is dropped, not stored as-is");
    });

    await t.test("accepts a same-origin relative canonical URL and an https absolute one", async () => {
      const relative = await createProduct(baseUrl, adminCookie, { canonicalUrl: "/product.html?id=x" });
      assert.equal(relative.canonicalUrl, "/product.html?id=x");

      const absolute = await createProduct(baseUrl, adminCookie, { canonicalUrl: "https://beca-wlf.com/product.html?id=x" });
      assert.equal(absolute.canonicalUrl, "https://beca-wlf.com/product.html?id=x");
    });

    await t.test("metadata parser skips a malformed line within the first 20", async () => {
      const lines = ["this line has no colon so it is skipped", "Material: Cotton", "Care: Cold wash"];
      const product = await createProduct(baseUrl, adminCookie, { metadataText: lines.join("\n") });
      assert.deepEqual(product.metadata, { Material: "Cotton", Care: "Cold wash" }, "only the 2 well-formed lines produce entries");
    });

    await t.test("metadata parser caps input at the first 20 lines", async () => {
      const lines = Array.from({ length: 25 }, (_, i) => `Key${i}: Value${i}`);
      const product = await createProduct(baseUrl, adminCookie, { metadataText: lines.join("\n") });
      assert.equal(Object.keys(product.metadata).length, 20, "lines beyond the 20th are never considered");
      assert.equal(product.metadata.Key19, "Value19");
      assert.equal(product.metadata.Key20, undefined, "the 21st line falls outside the cap");
    });

    await t.test("unchecking featured on an existing product actually clears it (not just omitted)", async () => {
      const product = await createProduct(baseUrl, adminCookie, { featured: "on" });
      assert.equal(product.featured, true);

      // Admin form sends featured="" (not omitted) when unchecked - see
      // admin.js's formData.set("featured", ...) fix.
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { ...product, featured: "" }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.product.featured, false);
    });

    await t.test("editing a product without touching optional fields preserves their existing values", async () => {
      const product = await createProduct(baseUrl, adminCookie, { sku: "KEEP-ME", compareAtPrice: 70 });
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { name: "Renamed only", price: product.price, status: product.status }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.product.sku, "KEEP-ME", "fields not present in the patch must survive untouched");
      assert.equal(payload.product.compareAtPrice, 70);
    });

    await t.test("product admin routes require admin auth", async () => {
      const anon = await jsonRequest(baseUrl, "/api/admin/products", {
        method: "POST",
        body: { name: "Nope", price: 10 }
      });
      assert.equal(anon.status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});
