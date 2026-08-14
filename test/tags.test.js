const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for the normalized product-tags system: admin
// CRUD, attach/detach on products, cascade-on-delete, public exposure +
// ?tag= filtering, and the tag-wipe regression a shallow-merge caller
// (updateProduct, used by the scene-image route) could silently reintroduce.

const ADMIN_EMAIL = "admin@tags-test.local";
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
  const name = overrides.name || `Test Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products", {
    method: "POST", cookie: adminCookie,
    body: { price: 50, currency: "GBP", status: "live", stock: 10, ...overrides, name }
  });
  assert.equal(status, 200, `product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

test("tags: admin CRUD, product attach/detach, cascade, and public filtering", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-tags-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("create + list a tag", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Limited");
      assert.equal(tag.name, "Limited");
      assert.equal(tag.slug, "limited");

      const { payload } = await jsonRequest(baseUrl, "/api/admin/tags", { cookie: adminCookie });
      assert.ok(payload.tags.some((t) => t.id === tag.id));
    });

    await t.test("rejects a duplicate tag name with 409, not a raw SQL error", async () => {
      await createTag(baseUrl, adminCookie, "Sale");
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/tags", {
        method: "POST", cookie: adminCookie, body: { name: "Sale" }
      });
      assert.equal(status, 409);
      assert.match(payload.error, /exista/i);
    });

    await t.test("rejects an empty tag name", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/tags", {
        method: "POST", cookie: adminCookie, body: { name: "   " }
      });
      assert.equal(status, 400);
    });

    await t.test("rename a tag", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Old Name");
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/tags/${tag.id}`, {
        method: "PUT", cookie: adminCookie, body: { name: "New Name" }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.tag.name, "New Name");
      assert.equal(payload.tag.slug, "new-name");
    });

    await t.test("renaming to another tag's name is rejected with 409", async () => {
      await createTag(baseUrl, adminCookie, "TagA");
      const tagB = await createTag(baseUrl, adminCookie, "TagB");
      const { status } = await jsonRequest(baseUrl, `/api/admin/tags/${tagB.id}`, {
        method: "PUT", cookie: adminCookie, body: { name: "TagA" }
      });
      assert.equal(status, 409);
    });

    await t.test("attaching tags on create persists and returns full tag objects (not just ids)", async () => {
      const tagA = await createTag(baseUrl, adminCookie, "Streetwear");
      const tagB = await createTag(baseUrl, adminCookie, "New Drop");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: `${tagA.id},${tagB.id}` });

      assert.equal(product.tags.length, 2, "create response carries full tag objects, not the pre-save tagIds shape");
      assert.deepEqual(new Set(product.tags.map((t) => t.name)), new Set(["Streetwear", "New Drop"]));

      const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const reloaded = payload.products.find((p) => p.id === product.id);
      assert.equal(reloaded.tags.length, 2, "survives a full reload from the database");
    });

    await t.test("editing a product without touching tagIds preserves its existing tags", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Preserve Me");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: tag.id });
      assert.equal(product.tags.length, 1);

      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { name: "Renamed only", price: product.price, status: product.status }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.product.tags.length, 1, "tags survive an edit that never mentions tagIds");
      assert.equal(payload.product.tags[0].name, "Preserve Me");
    });

    await t.test("REGRESSION: saving a scene image (updateProduct's shallow merge) must not wipe existing tags", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Must Survive");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: tag.id });
      assert.equal(product.tags.length, 1);

      // The real route: POST .../scene-image with a data: URL image, which
      // internally calls db.updateProduct(id, { imageUrl, sceneImageUrl })
      // - a patch that never mentions tags at all. A 1x1 transparent PNG,
      // since saveDataUrlImage checks real image bytes, not just the
      // declared mime type.
      const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/scene-image`, {
        method: "POST", cookie: adminCookie, body: { image: pngDataUrl }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.ok(payload.product.sceneImageUrl, "scene image was actually saved");
      assert.equal(payload.product.tags.length, 1, "a patch that never touches tags must not clear them");
      assert.equal(payload.product.tags[0].name, "Must Survive");
    });

    await t.test("changing tagIds on edit replaces the set (detach + attach in one save)", async () => {
      const tagA = await createTag(baseUrl, adminCookie, "Will Detach");
      const tagB = await createTag(baseUrl, adminCookie, "Will Attach");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: tagA.id });

      const { payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { ...product, tagIds: tagB.id }
      });
      assert.equal(payload.product.tags.length, 1);
      assert.equal(payload.product.tags[0].name, "Will Attach");
    });

    await t.test("clearing tagIds via an empty string detaches every tag", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Detach All");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: tag.id });

      const { payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}`, {
        method: "PUT", cookie: adminCookie,
        body: { ...product, tagIds: "" }
      });
      assert.deepEqual(payload.product.tags, []);
    });

    await t.test("an unknown/stale tag id is silently dropped, not rejected", async () => {
      const product = await createProduct(baseUrl, adminCookie, { tagIds: "00000000-0000-4000-8000-000000000000" });
      assert.deepEqual(product.tags, [], "unknown id never blocks the save, just doesn't attach anything");
    });

    await t.test("deleting a tag cascades off products without deleting the product", async () => {
      const tag = await createTag(baseUrl, adminCookie, "Doomed Tag");
      const product = await createProduct(baseUrl, adminCookie, { tagIds: tag.id, status: "live" });

      const del = await jsonRequest(baseUrl, `/api/admin/tags/${tag.id}`, { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);

      const { payload } = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const stillThere = payload.products.find((p) => p.id === product.id);
      assert.ok(stillThere, "the product itself survives");
      assert.deepEqual(stillThere.tags, [], "the deleted tag is gone from the product");
    });

    await t.test("tag admin routes require admin auth", async () => {
      const anon = await jsonRequest(baseUrl, "/api/admin/tags");
      assert.equal(anon.status, 401);
      const anonPost = await jsonRequest(baseUrl, "/api/admin/tags", { method: "POST", body: { name: "Nope" } });
      assert.equal(anonPost.status, 401);
    });

    await t.test("public API exposes tags on products and supports ?tag= filtering", async () => {
      const tag = await createTag(baseUrl, adminCookie, "PublicFilterTag");
      const tagged = await createProduct(baseUrl, adminCookie, { tagIds: tag.id, status: "live" });
      const untagged = await createProduct(baseUrl, adminCookie, { status: "live" });

      const all = await jsonRequest(baseUrl, "/api/products");
      const publicTagged = all.payload.products.find((p) => p.id === tagged.id);
      assert.ok(publicTagged.tags.some((t) => t.slug === "publicfiltertag"));

      const filtered = await jsonRequest(baseUrl, "/api/products?tag=publicfiltertag");
      assert.ok(filtered.payload.products.some((p) => p.id === tagged.id));
      assert.ok(!filtered.payload.products.some((p) => p.id === untagged.id), "untagged product excluded");
    });

    await t.test("an unknown ?tag= slug returns zero results, not the unfiltered list", async () => {
      const { payload } = await jsonRequest(baseUrl, "/api/products?tag=does-not-exist-at-all");
      assert.deepEqual(payload.products, []);
    });
  } finally {
    stopServer(httpServer);
  }
});
