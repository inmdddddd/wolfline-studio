/* Zero-dependency IP -> country lookup (mirrors lib/square.js's style: only
   Node core/globals, no npm package - uses the global fetch() that ships
   with Node >=22.13).

   Backs the storefront's "show RON to a Romanian visitor, GBP to everyone
   else, before they ever reach checkout" request - locale.js's existing
   timezone/browser-language guess stays as the fallback (see detect() in
   that file), this is a more accurate signal layered on top, not a
   replacement of the whole detection path (the guess must keep working
   with this lookup slow, failing, or exhausted).

   Provider is ipwho.is: free, HTTPS, no API key. If it's ever
   unreachable/rate-limited, resolveCountry() returns null and the caller
   falls back to the existing guess - this must never be able to break a
   page load or throw an unhandled rejection.

   In-memory only, per-process cache (not persisted, not shared across the
   wolfline-studio/wolfline-studio-test/aether processes) - a repeat visitor
   within the TTL costs zero network calls, a restart just starts cold. */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1500;
const MAX_CACHE_ENTRIES = 5000;

const cache = new Map();

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  const value = String(ip).trim();
  if (!value || value === "unknown") return true;
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value) ||
    value.startsWith("fc") ||
    value.startsWith("fd")
  );
}

// The real network call, isolated behind module.exports.request (not a local
// function reference) so tests can replace `geoip.request` with a stub and
// have resolveCountry() - which always calls `geoip.request(...)`, never the
// local realRequest directly - pick it up. guardTestMode() below detects
// "nobody replaced it" by identity comparison against this function.
async function realRequest(ip) {
  const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  });
  const payload = await response.json();
  if (!response.ok || !payload || payload.success === false) return null;
  const code = String(payload.country_code || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

const geoip = { request: realRequest };

function guardTestMode() {
  if (process.env.BECA_TEST_MODE && geoip.request === realRequest) {
    throw new Error(
      "[geoip] BECA_TEST_MODE este activ si geoip.request nu a fost inlocuit cu un stub. " +
      "Testele nu trebuie sa poata face cereri de retea reale - vezi test/geoip.test.js pentru pattern."
    );
  }
}

function pruneCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Cheapest possible eviction: Map preserves insertion order, so the first
  // key is the oldest entry - good enough for a best-effort cache that only
  // exists to cut down on repeat lookups, not a correctness guarantee.
  const oldestKey = cache.keys().next().value;
  cache.delete(oldestKey);
}

// Always resolves - never throws, never rejects. Returns an ISO-3166 alpha-2
// country code, or null if the ip is private/local, the lookup failed, timed
// out, or came back ambiguous.
async function resolveCountry(ip) {
  if (isPrivateOrLocalIp(ip)) return null;

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.countryCode;

  guardTestMode();

  let countryCode = null;
  try {
    countryCode = await geoip.request(ip);
  } catch (error) {
    console.error("[geoip] Lookup esuat pentru", ip, ":", error.message || error);
    countryCode = null;
  }

  cache.set(ip, { countryCode, expiresAt: Date.now() + CACHE_TTL_MS });
  pruneCacheIfNeeded();
  return countryCode;
}

module.exports = { resolveCountry, isPrivateOrLocalIp, geoip };
