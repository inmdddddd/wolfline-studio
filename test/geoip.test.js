const test = require("node:test");
const assert = require("node:assert/strict");

// Unit coverage for lib/geoip.js in isolation - no server, no real network.
// BECA_TEST_MODE is already set by test/setup-env.js's --require preload
// (see package.json's "test" script), so resolveCountry() would throw
// immediately for any non-private IP unless geoip.request is stubbed -
// same pattern as test/resend.test.js / test/square.test.js.

const geoipModule = require("../lib/geoip");
const originalRequest = geoipModule.geoip.request;

test.afterEach(() => {
  geoipModule.geoip.request = originalRequest;
});

test("isPrivateOrLocalIp recognizes loopback, private ranges, and empty/unknown input", () => {
  assert.equal(geoipModule.isPrivateOrLocalIp(""), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("unknown"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("127.0.0.1"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("::1"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("10.0.0.5"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("192.168.1.20"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("172.16.0.1"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("172.31.255.255"), true);
  assert.equal(geoipModule.isPrivateOrLocalIp("172.32.0.1"), false);
  assert.equal(geoipModule.isPrivateOrLocalIp("86.24.0.1"), false);
  assert.equal(geoipModule.isPrivateOrLocalIp("8.8.8.8"), false);
});

test("resolveCountry never calls the network for a private/local ip, and returns null", async () => {
  geoipModule.geoip.request = async () => {
    throw new Error("must not be called for a private ip");
  };

  assert.equal(await geoipModule.resolveCountry("127.0.0.1"), null);
  assert.equal(await geoipModule.resolveCountry("192.168.0.5"), null);
  assert.equal(await geoipModule.resolveCountry(""), null);
});

test("resolveCountry refuses to run under BECA_TEST_MODE when geoip.request was never stubbed", async () => {
  geoipModule.geoip.request = originalRequest; // explicit: simulate "forgot to stub"

  await assert.rejects(
    () => geoipModule.resolveCountry("203.0.113.9"),
    /BECA_TEST_MODE/
  );
});

test("resolveCountry returns the stubbed country code for a public ip", async () => {
  geoipModule.geoip.request = async (ip) => {
    assert.equal(ip, "203.0.113.10");
    return "RO";
  };

  assert.equal(await geoipModule.resolveCountry("203.0.113.10"), "RO");
});

test("resolveCountry caches a resolved ip - a second lookup within the TTL never calls request again", async () => {
  let calls = 0;
  geoipModule.geoip.request = async () => {
    calls += 1;
    return "GB";
  };

  assert.equal(await geoipModule.resolveCountry("203.0.113.11"), "GB");
  assert.equal(await geoipModule.resolveCountry("203.0.113.11"), "GB");
  assert.equal(await geoipModule.resolveCountry("203.0.113.11"), "GB");
  assert.equal(calls, 1, "the second and third lookups for the same ip should be served from cache");
});

test("resolveCountry treats a different ip as an independent cache entry", async () => {
  const seen = [];
  geoipModule.geoip.request = async (ip) => {
    seen.push(ip);
    return ip.endsWith(".20") ? "RO" : "GB";
  };

  assert.equal(await geoipModule.resolveCountry("203.0.113.20"), "RO");
  assert.equal(await geoipModule.resolveCountry("203.0.113.21"), "GB");
  assert.deepEqual(seen, ["203.0.113.20", "203.0.113.21"]);
});

test("resolveCountry returns null (and caches null) when the lookup throws, without propagating the error", async () => {
  let calls = 0;
  geoipModule.geoip.request = async () => {
    calls += 1;
    throw new Error("upstream is down");
  };

  assert.equal(await geoipModule.resolveCountry("203.0.113.30"), null);
  assert.equal(await geoipModule.resolveCountry("203.0.113.30"), null);
  assert.equal(calls, 1, "a failed lookup should still be cached so a flaky upstream can't be hammered by repeat visits");
});

test("resolveCountry returns null for a malformed/ambiguous response instead of a garbage value", async () => {
  geoipModule.geoip.request = async () => null;
  assert.equal(await geoipModule.resolveCountry("203.0.113.40"), null);
});
