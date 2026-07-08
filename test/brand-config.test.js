const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Covers the white-label brand system: each brand (BeCa, AETHER STUDIO) runs
// as its own process, picking BRAND/DATA_DIR once at boot. These tests start
// isolated server instances one at a time (never concurrently - server.js has
// module-level state, so two brands only coexist safely as separate
// processes) and check that: the right config loads, seed data is
// brand-specific, static files fall back from the brand's own public dir to
// the shared engine root, and nothing written under one brand's DATA_DIR is
// visible to the other.

function freshEnv(overrides) {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
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

test("default brand (BRAND unset) boots as BeCa with BeCa's seed product", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-brand-test-"));
  delete process.env.BRAND;
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: tempDir });
  try {
    const homepage = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(homepage, /BeCa/);
    assert.doesNotMatch(homepage, /AETHER STUDIO/);

    const { products } = await fetch(`${baseUrl}/api/products`).then((response) => response.json());
    assert.equal(products.length, 1);
    assert.equal(products[0].name, "Oversized statement tee");
    assert.equal(products[0].currency, "GBP");
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("BRAND=aether boots as AETHER STUDIO with its own seed product and no BeCa text", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-brand-test-"));
  const { httpServer, baseUrl } = await startServer({ BRAND: "aether", DATA_DIR: tempDir });
  try {
    const homepage = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(homepage, /AETHER STUDIO/);
    assert.doesNotMatch(homepage, /BeCa/);

    const { products } = await fetch(`${baseUrl}/api/products`).then((response) => response.json());
    assert.equal(products.length, 1);
    assert.equal(products[0].name, "THE FIRST FORM — 001/001");
    assert.equal(products[0].price, 220);
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("aether static files fall back to the shared engine root but prefer its own theme file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-static-test-"));
  const { httpServer, baseUrl } = await startServer({ BRAND: "aether", DATA_DIR: tempDir });
  try {
    // Shared engine script - not present under aether/, must fall back to the
    // project root copy rather than 404.
    const locale = await fetch(`${baseUrl}/locale.js`);
    assert.equal(locale.status, 200);

    // Brand-owned override file - must resolve directly from aether/, not the
    // (nonexistent) root copy.
    const theme = await fetch(`${baseUrl}/aether-theme.css`);
    assert.equal(theme.status, 200);
    const themeBody = await theme.text();
    assert.match(themeBody, /aether-wordmark/);

    // The brand's own index.html must be served at "/", not the shared root
    // index.html.
    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200);
    const rootBody = await root.text();
    assert.match(rootBody, /AETHER STUDIO/);
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("an unknown BRAND id fails fast instead of silently booting", async () => {
  freshEnv({ BRAND: "does-not-exist" });
  assert.throws(() => requireFreshServer(), /brand/i);
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  delete process.env.BRAND;
});

test("brand data directories never mix: writes under one brand are invisible to the other", async () => {
  const becaDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-isolation-test-"));
  const aetherDir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-isolation-test-"));

  delete process.env.BRAND;
  let session = await startServer({ DATA_DIR: becaDir });
  stopServer(session.httpServer);

  session = await startServer({ BRAND: "aether", DATA_DIR: aetherDir });
  stopServer(session.httpServer);

  const becaProducts = JSON.parse(fs.readFileSync(path.join(becaDir, "products.json"), "utf8"));
  const aetherProducts = JSON.parse(fs.readFileSync(path.join(aetherDir, "products.json"), "utf8"));
  const becaUsers = JSON.parse(fs.readFileSync(path.join(becaDir, "users.json"), "utf8"));
  const aetherUsers = JSON.parse(fs.readFileSync(path.join(aetherDir, "users.json"), "utf8"));

  assert.equal(becaProducts.length, 1);
  assert.equal(aetherProducts.length, 1);
  assert.notEqual(becaProducts[0].name, aetherProducts[0].name);

  const becaAdmin = becaUsers.find((user) => user.role === "admin");
  const aetherAdmin = aetherUsers.find((user) => user.role === "admin");
  assert.equal(becaAdmin.email, "admin@beca.local");
  assert.equal(aetherAdmin.email, "admin@aether.local");
  assert.notEqual(becaAdmin.id, aetherAdmin.id);

  fs.rmSync(becaDir, { recursive: true, force: true });
  fs.rmSync(aetherDir, { recursive: true, force: true });
});
