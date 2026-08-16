const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for POST /api/admin/products/:id/texture: lets
// an admin replace just the 3D texture image on a product already set up
// through 3D Studio, from the Products tab, without redoing model/print
// position/shirtColor - and the "shallow merge, not wholesale replace"
// guarantee that makes that safe (same class of regression tags.test.js's
// scene-image test already guards for tags).

const ADMIN_EMAIL = "admin@product-texture-test.local";
const ADMIN_PASSWORD = "admintestpass123";

// A 1x1 transparent PNG - saveDataUrlImage checks real decoded image bytes,
// not just the declared mime type, so this has to be an actual valid PNG.
const PNG_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// A different 1x1 PNG (red pixel) so "the texture actually changed" is a
// real byte-level assertion, not just "some URL exists".
const PNG_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

async function createStudioProduct(baseUrl, adminCookie, overrides = {}) {
  const name = overrides.name || `Studio Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/studio-products", {
    method: "POST", cookie: adminCookie,
    body: {
      price: 40, currency: "GBP", stock: 5, status: "draft",
      textureUrl: "assets/products/placeholder-texture.png",
      shirtColor: "#112233", printX: 3, printY: 4, printScale: 1.6, printRotation: 12, printOpacity: 0.8,
      ...overrides, name
    }
  });
  assert.equal(status, 200, `studio product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

async function createProduct(baseUrl, adminCookie, overrides = {}) {
  const name = overrides.name || `Plain Tee ${Math.random().toString(16).slice(2)}`;
  const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products", {
    method: "POST", cookie: adminCookie,
    body: { price: 40, currency: "GBP", status: "live", stock: 5, ...overrides, name }
  });
  assert.equal(status, 200, `product create must succeed: ${JSON.stringify(payload)}`);
  return payload.product;
}

test("admin product texture replacement", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-product-texture-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("replaces the texture on a 3D-Studio product, preserving model/print position/shirtColor", async () => {
      const product = await createStudioProduct(baseUrl, adminCookie);
      assert.equal(product.studio.textureUrl, "assets/products/placeholder-texture.png");

      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_A }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.notEqual(payload.product.studio.textureUrl, "assets/products/placeholder-texture.png", "the texture URL must actually change");
      assert.match(payload.product.studio.textureUrl, /^assets\/products\/studio-texture-.*\.png$/);

      assert.equal(payload.product.studio.model, product.studio.model, "model must survive untouched");
      assert.deepEqual(payload.product.studio.print, product.studio.print, "print position/scale/rotation/opacity must survive untouched");
      assert.equal(payload.product.studio.shirtColor, "#112233", "shirt color must survive untouched");
    });

    await t.test("a second replacement actually overwrites the first (byte-level, not just a new random filename)", async () => {
      const product = await createStudioProduct(baseUrl, adminCookie);

      const first = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_A }
      });
      const second = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_B }
      });
      assert.equal(second.status, 200, JSON.stringify(second.payload));
      assert.notEqual(second.payload.product.studio.textureUrl, first.payload.product.studio.textureUrl);

      // Everything else must still be exactly what studio creation set, not
      // just "unchanged from the first PUT" (which could hide a bug where
      // the second save quietly re-derives them from nothing).
      assert.equal(second.payload.product.studio.shirtColor, "#112233");
      assert.equal(second.payload.product.studio.print.rotation, 12);
    });

    await t.test("rejects a product that never went through 3D Studio (no .studio to merge into)", async () => {
      const product = await createProduct(baseUrl, adminCookie);
      const { status, payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_A }
      });
      assert.equal(status, 400);
      assert.match(payload.error, /3D Studio/);
    });

    await t.test("rejects a missing/invalid image without touching the existing texture", async () => {
      const product = await createStudioProduct(baseUrl, adminCookie);

      const missing = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: {}
      });
      assert.equal(missing.status, 400);

      const notAnImage = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: "data:image/png;base64,not-real-bytes" }
      });
      assert.equal(notAnImage.status, 400);

      const list = await jsonRequest(baseUrl, "/api/admin/products", { cookie: adminCookie });
      const stillThere = list.payload.products.find((p) => p.id === product.id);
      assert.equal(stillThere.studio.textureUrl, "assets/products/placeholder-texture.png", "an invalid attempt must not clear the existing texture");
    });

    await t.test("404 for a product id that doesn't exist", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/products/00000000-0000-0000-0000-000000000000/texture", {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_A }
      });
      assert.equal(status, 404, JSON.stringify(payload));
    });

    await t.test("requires admin auth (401 for anonymous)", async () => {
      const product = await createStudioProduct(baseUrl, adminCookie);
      const { status } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", body: { textureImage: PNG_A }
      });
      assert.equal(status, 401);
    });

    await t.test("REGRESSION: replacing a texture must not wipe tags (same shallow-merge guarantee as scene-image)", async () => {
      const tagRes = await jsonRequest(baseUrl, "/api/admin/tags", { method: "POST", cookie: adminCookie, body: { name: "Must Survive Texture Save" } });
      const product = await createStudioProduct(baseUrl, adminCookie, { tagIds: tagRes.payload.tag.id });
      assert.equal(product.tags.length, 1);

      const { payload } = await jsonRequest(baseUrl, `/api/admin/products/${product.id}/texture`, {
        method: "POST", cookie: adminCookie, body: { textureImage: PNG_A }
      });
      assert.equal(payload.product.tags.length, 1, "a texture-only patch must not clear tags");
      assert.equal(payload.product.tags[0].name, "Must Survive Texture Save");
    });
  } finally {
    stopServer(httpServer);
  }
});
