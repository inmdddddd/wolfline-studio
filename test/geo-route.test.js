const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for GET /api/geo: the route wiring, response
// shape, and that it actually consults geoip.resolveCountry with the
// request's real client ip (trusting x-forwarded-for only from a trusted
// proxy address, same rule test/server.test.js already covers for
// clientIp() directly) - not just that lib/geoip.js works in isolation
// (see test/geoip.test.js for that).

function freshEnv(overrides) {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
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

async function getJson(baseUrl, pathname, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { Origin: baseUrl, ...headers } });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

// server.js requires ./lib/geoip once; since this test runs in-process
// (require("../server.js"), not a spawned child), the exact same module
// object is reachable here via require("../lib/geoip") - stubbing .request
// on it is picked up by whatever the running server does internally.
const geoipModule = require("../lib/geoip");
const originalRequest = geoipModule.geoip.request;
test.afterEach(() => {
  geoipModule.geoip.request = originalRequest;
});

test("GET /api/geo returns {country: null} for a direct localhost request, without ever touching the network", async () => {
  geoipModule.geoip.request = async () => {
    throw new Error("must not be called - the test client's own connection is loopback");
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-geo-route-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  try {
    const { status, payload } = await getJson(baseUrl, "/api/geo");
    assert.equal(status, 200);
    assert.deepEqual(payload, { country: null });
  } finally {
    stopServer(httpServer);
  }
});

test("GET /api/geo resolves via a trusted x-forwarded-for (test client connects from loopback, the trusted-proxy case)", async () => {
  geoipModule.geoip.request = async (ip) => {
    assert.equal(ip, "203.0.113.50");
    return "RO";
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-geo-route-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  try {
    const { status, payload } = await getJson(baseUrl, "/api/geo", { "X-Forwarded-For": "203.0.113.50" });
    assert.equal(status, 200);
    assert.deepEqual(payload, { country: "RO" });
  } finally {
    stopServer(httpServer);
  }
});

test("GET /api/geo returns {country: null} rather than an error when the lookup fails", async () => {
  geoipModule.geoip.request = async () => {
    throw new Error("upstream unreachable");
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-geo-route-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  try {
    const { status, payload } = await getJson(baseUrl, "/api/geo", { "X-Forwarded-For": "203.0.113.51" });
    assert.equal(status, 200);
    assert.deepEqual(payload, { country: null });
  } finally {
    stopServer(httpServer);
  }
});

test("GET /api/geo is rate-limited per ip", async () => {
  geoipModule.geoip.request = async () => "GB";

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-geo-route-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  try {
    const headers = { "X-Forwarded-For": "203.0.113.52" };
    let sawTooMany = false;
    for (let i = 0; i < 25; i++) {
      const { status } = await getJson(baseUrl, "/api/geo", headers);
      if (status === 429) { sawTooMany = true; break; }
    }
    assert.equal(sawTooMany, true, "expected a 429 within 25 requests from the same ip");
  } finally {
    stopServer(httpServer);
  }
});
