const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for translated product content and normalized
// categories: admin CRUD for product_translations/categories, the
// resolve-or-create relationship between products.category (still plain
// free text) and the categories table underneath it, and that the public
// product payload carries enough (translations + categoryTranslations) for
// the storefront to actually show translated content.

const ADMIN_EMAIL = "admin@product-translations-test.local";
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

test("translated product content: product_translations CRUD, categories, and public exposure", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-product-translations-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("creating a product with a category resolves-or-creates a categories row automatically", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "Hoodie" });
      assert.equal(product.category, "Hoodie", "the free-text field is untouched");
      assert.ok(product.categoryId, "a categories row must be resolved/created underneath it");

      const categories = await jsonRequest(baseUrl, "/api/admin/categories", { cookie: adminCookie });
      const match = categories.payload.categories.find((c) => c.id === product.categoryId);
      assert.ok(match, "the resolved category must be visible in the admin list");
      assert.equal(match.defaultName, "Hoodie");
      assert.equal(match.slug, "hoodie");
    });

    await t.test("two products with the same category text share ONE categories row, not one each", async () => {
      const a = await createProduct(baseUrl, adminCookie, { category: "Accessory" });
      const b = await createProduct(baseUrl, adminCookie, { category: "Accessory" });
      assert.equal(a.categoryId, b.categoryId, "resolveOrCreateCategory must be idempotent per slug");
    });

    await t.test("editing a product's category text re-resolves categoryId to the new category", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "Original" });
      const originalCategoryId = product.categoryId;

      const updated = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { name: product.name, category: "Renamed", price: 50, currency: "GBP", stock: 10, status: "live" }
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.payload));
      assert.notEqual(updated.payload.product.categoryId, originalCategoryId);

      const categories = await jsonRequest(baseUrl, "/api/admin/categories", { cookie: adminCookie });
      assert.ok(categories.payload.categories.some((c) => c.defaultName === "Renamed"));
    });

    await t.test("bulk setCategory ALSO resolves/creates the category (not just the single-product routes)", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "" });
      const bulk = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie,
        body: { ids: [product.id], action: "setCategory", category: "Bulk Category" }
      });
      assert.equal(bulk.status, 200, JSON.stringify(bulk.payload));

      const products = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const found = products.payload.products.find((p) => p.id === product.id);
      assert.equal(found.category, "Bulk Category");
      assert.ok(found.categoryId, "bulk setCategory must resolve a real categories row, not leave categoryId null");
    });

    await t.test("admin PUT renames a category's default name and sets per-language translations", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "Tee" });
      const rename = await jsonRequest(baseUrl, `/api/admin/categories/${product.categoryId}`, {
        method: "PUT", cookie: adminCookie,
        body: { defaultName: "T-Shirt", translations: [{ languageCode: "ro", name: "Tricou" }] }
      });
      assert.equal(rename.status, 200, JSON.stringify(rename.payload));
      assert.equal(rename.payload.category.defaultName, "T-Shirt");
      assert.equal(rename.payload.category.translations.length, 1);
      assert.equal(rename.payload.category.translations[0].name, "Tricou");

      // A blank translation value for a language must be dropped, not
      // stored as an empty row (category_translations.name is NOT NULL).
      const clear = await jsonRequest(baseUrl, `/api/admin/categories/${product.categoryId}`, {
        method: "PUT", cookie: adminCookie,
        body: { defaultName: "T-Shirt", translations: [{ languageCode: "ro", name: "" }] }
      });
      assert.equal(clear.payload.category.translations.length, 0);
    });

    await t.test("admin PUT rejects an unknown language code and a duplicate language in one submission", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "Gadget" });
      const badLang = await jsonRequest(baseUrl, `/api/admin/categories/${product.categoryId}`, {
        method: "PUT", cookie: adminCookie,
        body: { defaultName: "Gadget", translations: [{ languageCode: "zz", name: "x" }] }
      });
      assert.equal(badLang.status, 400);

      const duplicate = await jsonRequest(baseUrl, `/api/admin/categories/${product.categoryId}`, {
        method: "PUT", cookie: adminCookie,
        body: { defaultName: "Gadget", translations: [{ languageCode: "ro", name: "A" }, { languageCode: "ro", name: "B" }] }
      });
      assert.equal(duplicate.status, 400);
    });

    await t.test("DELETE removes a category; the product's own category text is untouched (graceful degradation, no FK)", async () => {
      const product = await createProduct(baseUrl, adminCookie, { category: "Temp Category" });
      const del = await jsonRequest(baseUrl, `/api/admin/categories/${product.categoryId}`, { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);

      const products = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const found = products.payload.products.find((p) => p.id === product.id);
      assert.equal(found.category, "Temp Category", "the free-text field survives even though the underlying row is gone");

      const publicList = await jsonRequest(baseUrl, "/api/products");
      const publicFound = publicList.payload.products.find((p) => p.id === product.id);
      assert.deepEqual(publicFound.categoryTranslations, {}, "a dangling categoryId must degrade to an empty map, never a 500");
    });

    await t.test("categories admin routes require auth (401 for anonymous)", async () => {
      const get = await jsonRequest(baseUrl, "/api/admin/categories");
      assert.equal(get.status, 401);
    });

    await t.test("admin PUT product translations persists per-language content; GET reflects it", async () => {
      const product = await createProduct(baseUrl, adminCookie, { name: "Golden Hour Tee", description: "EN base description" });
      const put = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: {
          translations: [
            { languageCode: "ro", name: "Tricou Ora de Aur", description: "Descriere RO", shortDescription: "Scurt RO", seoTitle: "SEO RO", seoDescription: "SEO desc RO" }
          ]
        }
      });
      assert.equal(put.status, 200, JSON.stringify(put.payload));
      assert.equal(put.payload.translations.length, 1);
      assert.equal(put.payload.translations[0].name, "Tricou Ora de Aur");

      const get = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, { cookie: adminCookie });
      assert.equal(get.payload.translations[0].description, "Descriere RO");
      assert.equal(get.payload.translations[0].shortDescription, "Scurt RO");
    });

    await t.test("PUT is a wholesale replace per language, and rejects an unknown language / duplicate language", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: { translations: [{ languageCode: "ro", name: "A" }, { languageCode: "en", name: "B" }] }
      });
      const replaced = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: { translations: [{ languageCode: "ro", name: "Only RO now" }] }
      });
      assert.equal(replaced.payload.translations.length, 1, "submitting a smaller set must remove the dropped language's row, not accumulate");

      const badLang = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: { translations: [{ languageCode: "zz", name: "x" }] }
      });
      assert.equal(badLang.status, 400);

      const duplicate = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: { translations: [{ languageCode: "ro", name: "A" }, { languageCode: "ro", name: "B" }] }
      });
      assert.equal(duplicate.status, 400);
    });

    await t.test("public GET /api/products exposes translations without leaking internal metadata shape beyond what's needed", async () => {
      const product = await createProduct(baseUrl, adminCookie, { name: "Studio Draft Tee" });
      await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", cookie: adminCookie,
        body: { translations: [{ languageCode: "ro", name: "Tricou Studio Draft", description: "RO desc" }] }
      });

      const res = await jsonRequest(baseUrl, "/api/products");
      const found = res.payload.products.find((p) => p.id === product.id);
      assert.ok(Array.isArray(found.translations));
      const ro = found.translations.find((entry) => entry.languageCode === "ro");
      assert.equal(ro.name, "Tricou Studio Draft");
      assert.equal(ro.description, "RO desc");
    });

    await t.test("product translation admin routes require auth (401 for anonymous)", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const get = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`);
      assert.equal(get.status, 401);
      const put = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/translations`, {
        method: "PUT", body: { translations: [] }
      });
      assert.equal(put.status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});
