const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const http = require("http");

// Coverage for minifyIfApplicable(): the same site-audit tool run that
// flagged "Uncompressed JavaScript and CSS files" (fixed separately, see
// test/response-compression.test.js) also flagged "Unminified JavaScript and
// CSS files" on 60 pages - compression shrinks bytes in transit, minification
// shrinks the source itself, and the tool checks for both independently.
// Verifies real size reduction, that the minified JS is still syntactically
// valid (parseable, not corrupted), and that the mtime-keyed cache serves
// byte-identical output on repeat requests.

function freshEnv(overrides) {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_EMAIL = "admin@minify-test.local";
  process.env.ADMIN_PASSWORD = "admintestpass123";
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

function rawRequest(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

test("asset minification: real size reduction, valid syntax, stable caching", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-minify-test-"));
  freshEnv({ DATA_DIR: path.join(tempRoot, "data") });
  const server = requireFreshServer();
  const httpServer = server.start();
  await new Promise((resolve) => httpServer.once("listening", resolve));
  const port = httpServer.address().port;

  try {
    await t.test("script.js is meaningfully smaller minified, and still parses as valid JS", async () => {
      const rawOnDisk = fs.readFileSync(path.join(__dirname, "..", "script.js"));
      const served = await rawRequest(port, "/script.js");

      assert.equal(served.status, 200);
      assert.ok(served.body.length < rawOnDisk.length * 0.85, `expected at least ~15% reduction, got ${rawOnDisk.length} -> ${served.body.length}`);

      // Doesn't execute it (script.js references browser globals like window/
      // document that don't exist here) - just confirms esbuild's minifier
      // didn't emit anything a JS parser would reject, which is exactly the
      // kind of corruption a bad minification pass would produce.
      assert.doesNotThrow(() => new vm.Script(served.body.toString("utf8")), "minified script.js must still be syntactically valid JS");
    });

    await t.test("styles.css is meaningfully smaller minified", async () => {
      const rawOnDisk = fs.readFileSync(path.join(__dirname, "..", "styles.css"));
      const served = await rawRequest(port, "/styles.css");

      assert.equal(served.status, 200);
      assert.ok(served.body.length < rawOnDisk.length * 0.85, `expected at least ~15% reduction, got ${rawOnDisk.length} -> ${served.body.length}`);
    });

    await t.test("repeat requests for the same file serve byte-identical cached output", async () => {
      const first = await rawRequest(port, "/script.js");
      const second = await rawRequest(port, "/script.js");
      assert.deepEqual(first.body, second.body);
    });

    await t.test("HTML is left alone - minification only targets .js/.css", async () => {
      const rawOnDisk = fs.readFileSync(path.join(__dirname, "..", "index.html"));
      const served = await rawRequest(port, "/");
      assert.equal(served.body.length, rawOnDisk.length, "index.html must be served byte-for-byte unminified");
    });
  } finally {
    server.stop();
    httpServer.close();
    delete require.cache[require.resolve("../lib/email.js")];
    delete require.cache[require.resolve("../server.js")];
    delete process.env.DATA_DIR;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
