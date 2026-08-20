const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for POST /api/admin/products/bulk: every
// supported action, manipulated/stale id handling, the "one product's
// delete fails a DB constraint without rolling back the rest of the batch"
// resilience, and auth.

const ADMIN_EMAIL = "admin@bulk-actions-test.local";
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

async function createTag(baseUrl, adminCookie, name) {
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/tags", {
    method: "POST", cookie: adminCookie, body: { name }
  });
  assert.equal(status, 200, `tag create must succeed: ${JSON.stringify(payload)}`);
  return payload.tag;
}

async function createProduct(baseUrl, adminCookie, overrides = {}) {
  const name = overrides.name || `Bulk Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products", {
    method: "POST", cookie: adminCookie,
    body: { price: 50, currency: "GBP", status: "live", stock: 10, ...overrides, name }
  });
  assert.equal(status, 200, `product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

async function placeOrderFor(baseUrl, productId, size) {
  const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ productId, size, qty: 1 })
  });
  assert.equal(addResponse.status, 200, "cart add must succeed");
  const cookie = cookiesFrom(addResponse);

  const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({
      customerName: "Bulk Test Buyer",
      customerEmail: `buyer-${Math.random().toString(16).slice(2)}@example.com`,
      customerPhone: "0700000000",
      customerAddress: "Str. Test 1, Iasi",
      customerCountry: "RO"
    })
  });
  const payload = await checkoutResponse.json();
  assert.equal(checkoutResponse.status, 200, `checkout must succeed: ${JSON.stringify(payload)}`);
  return payload.order;
}

test("bulk product actions: every action, manipulated ids, partial-failure resilience, auth", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-bulk-actions-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("publish/unpublish/archive set status across the batch", async () => {
      const a = await createProduct(baseUrl, adminCookie, { status: "draft" });
      const b = await createProduct(baseUrl, adminCookie, { status: "draft" });

      const publish = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [a.id, b.id], action: "publish" }
      });
      assert.equal(publish.status, 200);
      assert.equal(publish.payload.applied, 2);

      const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const reloadedA = payload.products.find((p) => p.id === a.id);
      const reloadedB = payload.products.find((p) => p.id === b.id);
      assert.equal(reloadedA.status, "live");
      assert.equal(reloadedB.status, "live");

      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [a.id], action: "archive" }
      });
      const afterArchive = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      assert.equal(afterArchive.payload.products.find((p) => p.id === a.id).status, "archived");

      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [b.id], action: "unpublish" }
      });
      const afterUnpublish = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      assert.equal(afterUnpublish.payload.products.find((p) => p.id === b.id).status, "draft");
    });

    await t.test("archived products are excluded from the public storefront, same as draft", async () => {
      const product = await createProduct(baseUrl, adminCookie, { status: "live" });
      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [product.id], action: "archive" }
      });
      const { payload } = await jsonRequest(baseUrl, "/api/products");
      assert.ok(!payload.products.some((p) => p.id === product.id));
    });

    await t.test("feature/unfeature toggles the featured flag without touching other fields", async () => {
      const product = await createProduct(baseUrl, adminCookie, { sku: "KEEP-SKU" });
      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [product.id], action: "feature" }
      });
      let reloaded = (await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie }))
        .payload.products.find((p) => p.id === product.id);
      assert.equal(reloaded.featured, true);
      assert.equal(reloaded.sku, "KEEP-SKU", "unrelated fields survive the bulk update");

      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [product.id], action: "unfeature" }
      });
      reloaded = (await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie }))
        .payload.products.find((p) => p.id === product.id);
      assert.equal(reloaded.featured, false);
    });

    await t.test("setCategory updates category across the batch", async () => {
      const a = await createProduct(baseUrl, adminCookie, { category: "Old" });
      const b = await createProduct(baseUrl, adminCookie, { category: "Old" });
      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [a.id, b.id], action: "setCategory", category: "New Category" }
      });
      const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      assert.equal(payload.products.find((p) => p.id === a.id).category, "New Category");
      assert.equal(payload.products.find((p) => p.id === b.id).category, "New Category");
    });

    await t.test("addTags applies a tag to every product in the batch without disturbing each product's other tags", async () => {
      const sharedTag = await createTag(baseUrl, adminCookie, "BulkShared");
      const existingTag = await createTag(baseUrl, adminCookie, "AlreadyHasThis");
      const a = await createProduct(baseUrl, adminCookie, { tagIds: existingTag.id });
      const b = await createProduct(baseUrl, adminCookie);

      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [a.id, b.id], action: "addTags", tagIds: [sharedTag.id] }
      });
      assert.equal(status, 200, JSON.stringify(payload));

      const products = (await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie })).payload.products;
      const reloadedA = products.find((p) => p.id === a.id);
      const reloadedB = products.find((p) => p.id === b.id);
      assert.equal(reloadedA.tags.length, 2, "kept its existing tag and gained the shared one");
      assert.ok(reloadedA.tags.some((t) => t.id === existingTag.id));
      assert.ok(reloadedA.tags.some((t) => t.id === sharedTag.id));
      assert.equal(reloadedB.tags.length, 1);
      assert.equal(reloadedB.tags[0].id, sharedTag.id);
    });

    await t.test("removeTags detaches a tag from every product in the batch", async () => {
      const tag = await createTag(baseUrl, adminCookie, "ToRemove");
      const a = await createProduct(baseUrl, adminCookie, { tagIds: tag.id });
      const b = await createProduct(baseUrl, adminCookie, { tagIds: tag.id });

      await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [a.id, b.id], action: "removeTags", tagIds: [tag.id] }
      });

      const products = (await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie })).payload.products;
      assert.deepEqual(products.find((p) => p.id === a.id).tags, []);
      assert.deepEqual(products.find((p) => p.id === b.id).tags, []);
    });

    await t.test("addTags/removeTags reject a batch whose tagIds are entirely unknown/manipulated", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie,
        body: { ids: [product.id], action: "addTags", tagIds: ["00000000-0000-4000-8000-000000000000"] }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /tag/i);
    });

    await t.test("a manipulated/stale product id is reported as skipped, not fatal to the rest of the batch", async () => {
      const real = await createProduct(baseUrl, adminCookie, { status: "draft" });
      const fakeId = "00000000-0000-4000-8000-000000000001";

      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [real.id, fakeId], action: "publish" }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.applied, 1);
      assert.equal(payload.skipped.length, 1);
      assert.equal(payload.skipped[0].id, fakeId);
      assert.equal(payload.skipped[0].reason, "not_found");

      const reloaded = (await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie }))
        .payload.products.find((p) => p.id === real.id);
      assert.equal(reloaded.status, "live", "the real product's action still applied");
    });

    await t.test("bulk delete on a batch where one product has real order history skips only that one, deletes the rest", async () => {
      const ordered = await createProduct(baseUrl, adminCookie, { status: "live", sizes: undefined, sizeStock: undefined });
      const deletable = await createProduct(baseUrl, adminCookie, { status: "live" });

      await placeOrderFor(baseUrl, ordered.id, "");

      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [ordered.id, deletable.id], action: "delete" }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.applied, 1, "only the never-ordered product could actually be deleted");
      assert.equal(payload.skipped.length, 1);
      assert.equal(payload.skipped[0].id, ordered.id);
      assert.equal(payload.skipped[0].reason, "failed");

      const { payload: afterPayload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      assert.ok(afterPayload.products.some((p) => p.id === ordered.id), "the ordered product survives - its order history is never orphaned");
      assert.ok(!afterPayload.products.some((p) => p.id === deletable.id), "the deletable product is actually gone, not rolled back by the other one's failure");
    });

    await t.test("rejects an empty id list", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [], action: "publish" }
      });
      assert.equal(status, 400);
    });

    await t.test("rejects an unknown action", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const { status } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", cookie: adminCookie, body: { ids: [product.id], action: "nuke-everything" }
      });
      assert.equal(status, 400);
    });

    await t.test("bulk endpoint requires admin auth", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/products/bulk", {
        method: "POST", body: { ids: ["x"], action: "publish" }
      });
      assert.equal(status, 401);
    });
  } finally {
    stopServer(httpServer);
  }
});
