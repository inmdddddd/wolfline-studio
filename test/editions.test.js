const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Covers per-unit edition numbering: every physical piece sold at checkout
// gets the next number in its product's fixed edition, an append-only
// record lands in editions.json, and the public archive endpoints expose
// the record (without buyer data) plus a certificate page per piece.

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

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

test("checkout assigns per-unit edition numbers and exposes the public archive record", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-editions-test-"));
  const { httpServer, baseUrl } = await startServer({ BRAND: "aether", DATA_DIR: tempDir });
  try {
    // Before any sale: the seed product reports a pinned edition with
    // nothing claimed yet.
    const before = await fetch(`${baseUrl}/api/products`).then((r) => r.json());
    const product = before.products[0];
    assert.equal(product.editionAssigned, 0);
    assert.equal(product.editionTotal, product.stock);

    const size = product.sizes[0] || "";

    const addResponse = await fetch(`${baseUrl}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ productId: product.id, size, qty: 1 })
    });
    assert.equal(addResponse.status, 200);
    const cookie = cookiesFrom(addResponse);
    assert.ok(cookie.includes("beca_cart"), "cart cookie set");

    const checkoutResponse = await fetch(`${baseUrl}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
      body: JSON.stringify({
        customerName: "Edition Tester",
        customerEmail: "editions@example.com",
        customerPhone: "0700000000",
        customerAddress: "Str. Test 1, Bucuresti"
      })
    });
    assert.equal(checkoutResponse.status, 200);
    const { order } = await checkoutResponse.json();

    // The order item carries its assigned numbers and the fixed total.
    assert.deepEqual(order.items[0].editionNumbers, [1]);
    assert.equal(order.items[0].editionTotal, product.editionTotal);

    // The record is persisted, publicly listed, and carries no order id.
    const editions = JSON.parse(fs.readFileSync(path.join(tempDir, "editions.json"), "utf8"));
    assert.equal(editions.length, 1);
    assert.equal(editions[0].orderId, order.id);

    const archive = await fetch(`${baseUrl}/api/archive`).then((r) => r.json());
    assert.equal(archive.count, 1);
    assert.equal(archive.pieces[0].number, 1);
    assert.equal(archive.pieces[0].total, product.editionTotal);
    assert.equal(archive.pieces[0].chapterName, "ORIGIN");
    assert.equal(archive.pieces[0].orderId, undefined, "buyer data stays internal");

    const piece = await fetch(`${baseUrl}/api/archive/${archive.pieces[0].id}`).then((r) => r.json());
    assert.equal(piece.piece.productName, product.name);

    // The pretty certificate URL serves the brand's certificate shell.
    const certificate = await fetch(`${baseUrl}/archive/${archive.pieces[0].id}`);
    assert.equal(certificate.status, 200);
    const certificateBody = await certificate.text();
    assert.match(certificateBody, /data-certificate/);

    // Unknown records 404 on the API.
    const missing = await fetch(`${baseUrl}/api/archive/999`);
    assert.equal(missing.status, 404);
  } finally {
    stopServer(httpServer);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
