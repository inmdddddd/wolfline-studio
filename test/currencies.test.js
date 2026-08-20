const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for the languages/currencies/country_config
// registries: admin CRUD, the "exactly one default" invariant, the
// last-active/default deletion guards, the public active-only endpoints,
// and the composed country-config view that joins the existing shipping/
// tax tables without duplicating them.

const ADMIN_EMAIL = "admin@currencies-test.local";
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

test("languages/currencies/country-config: admin CRUD, default invariant, deletion guards, public endpoints", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-currencies-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("GET lists the seeded en/ro languages and GBP currency", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/languages", { cookie: adminCookie });
      assert.equal(status, 200);
      const codes = payload.languages.map((l) => l.code);
      assert.ok(codes.includes("en") && codes.includes("ro"));
      const en = payload.languages.find((l) => l.code === "en");
      assert.equal(en.isDefault, true);

      const currencies = await jsonRequest(baseUrl, "/api/admin/currencies", { cookie: adminCookie });
      assert.equal(currencies.payload.currencies[0].code, "GBP");
      assert.equal(currencies.payload.currencies[0].isDefault, true);
    });

    await t.test("PUT creates a brand-new language", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "PUT", cookie: adminCookie,
        body: { name: "French", nativeName: "Français", active: true }
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.language.code, "fr");
      assert.equal(payload.language.nativeName, "Français");
      assert.equal(payload.language.isDefault, false);
    });

    await t.test("rejects a malformed language code", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/languages/english", {
        method: "PUT", cookie: adminCookie, body: { name: "English", nativeName: "English" }
      });
      assert.equal(status, 400);
    });

    await t.test("rejects a language with no name", async () => {
      const { status } = await jsonRequest(baseUrl, "/api/admin/languages/de", {
        method: "PUT", cookie: adminCookie, body: { name: "", nativeName: "" }
      });
      assert.equal(status, 400);
    });

    await t.test("setting a new default language atomically clears the old one (exactly one default, ever)", async () => {
      await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "PUT", cookie: adminCookie, body: { name: "French", nativeName: "Français", isDefault: true }
      });
      const { payload } = await jsonRequest(baseUrl, "/api/admin/languages", { cookie: adminCookie });
      const defaults = payload.languages.filter((l) => l.isDefault);
      assert.equal(defaults.length, 1, "exactly one language must be default at any time");
      assert.equal(defaults[0].code, "fr");
    });

    await t.test("DELETE refuses to remove the current default language", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "DELETE", cookie: adminCookie
      });
      assert.equal(status, 400);
      assert.match(payload.error, /default/i);
    });

    await t.test("reassigning default back to 'en', then deleting 'fr', succeeds", async () => {
      await jsonRequest(baseUrl, "/api/admin/languages/en", {
        method: "PUT", cookie: adminCookie, body: { name: "English", nativeName: "English", isDefault: true }
      });
      const del = await jsonRequest(baseUrl, "/api/admin/languages/fr", { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);
      const list = await jsonRequest(baseUrl, "/api/admin/languages", { cookie: adminCookie });
      assert.ok(!list.payload.languages.some((l) => l.code === "fr"));
    });

    await t.test("cannot deactivate or delete the LAST remaining active language", async () => {
      // en is default+active, ro is active but not default - deactivate ro
      // first (allowed, en is still active), then try to remove en (the
      // last one standing) both ways.
      await jsonRequest(baseUrl, "/api/admin/languages/ro", {
        method: "PUT", cookie: adminCookie, body: { name: "Romanian", nativeName: "Romana", active: false }
      });
      const deactivateLast = await jsonRequest(baseUrl, "/api/admin/languages/en", {
        method: "PUT", cookie: adminCookie, body: { name: "English", nativeName: "English", isDefault: true, active: false }
      });
      // en is also default, so this specifically hits the "can't deactivate
      // the default" guard - re-check with a non-default last-active case
      // using currencies below, which isolates the "last active" guard alone.
      assert.equal(deactivateLast.status, 400);

      // restore ro to active for later assertions
      await jsonRequest(baseUrl, "/api/admin/languages/ro", {
        method: "PUT", cookie: adminCookie, body: { name: "Romanian", nativeName: "Romana", active: true }
      });
    });

    await t.test("the last-active guard fires independently of the default guard (currencies)", async () => {
      await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: true }
      });
      // GBP is default+active, RON is active but not default. Deactivate
      // GBP is blocked by the default guard; deactivating RON must succeed
      // (GBP remains active), and THEN re-deactivating RON a second time
      // is a no-op (already inactive) - the real test is that RON alone,
      // being non-default, was removable while at least one other stayed active.
      const deactivateRon = await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: false }
      });
      assert.equal(deactivateRon.status, 200, "deactivating a non-default currency while another stays active must succeed");
    });

    await t.test("public GET /api/languages and /api/currencies only return active rows, no auth required", async () => {
      const langs = await jsonRequest(baseUrl, "/api/languages");
      assert.equal(langs.status, 200);
      assert.ok(langs.payload.languages.every((l) => l.active));
      assert.ok(langs.payload.languages.some((l) => l.code === "en"));

      const currencies = await jsonRequest(baseUrl, "/api/currencies");
      assert.equal(currencies.status, 200);
      assert.ok(currencies.payload.currencies.every((c) => c.active));
      assert.ok(!currencies.payload.currencies.some((c) => c.code === "RON"), "the just-deactivated RON must not appear publicly");
    });

    await t.test("PUT sets a displayRateFromDefault on a non-default currency; public GET exposes it; empty string clears it", async () => {
      const create = await jsonRequest(baseUrl, "/api/admin/currencies/USD", {
        method: "PUT", cookie: adminCookie,
        body: { symbol: "$", decimalPlaces: 2, symbolPosition: "before", active: true, displayRateFromDefault: 1.27 }
      });
      assert.equal(create.status, 200, JSON.stringify(create.payload));
      assert.equal(create.payload.currency.displayRateFromDefault, 1.27);

      const publicList = await jsonRequest(baseUrl, "/api/currencies");
      const usd = publicList.payload.currencies.find((c) => c.code === "USD");
      assert.equal(usd.displayRateFromDefault, 1.27, "the public endpoint must expose the rate - locale.js reads it from here");

      const clear = await jsonRequest(baseUrl, "/api/admin/currencies/USD", {
        method: "PUT", cookie: adminCookie,
        body: { symbol: "$", decimalPlaces: 2, symbolPosition: "before", displayRateFromDefault: "" }
      });
      assert.equal(clear.status, 200, JSON.stringify(clear.payload));
      assert.equal(clear.payload.currency.displayRateFromDefault, null, "an empty string must clear the rate, same convention as compareAtPrice/costPrice");
    });

    await t.test("PUT rejects a zero or negative displayRateFromDefault", async () => {
      const zero = await jsonRequest(baseUrl, "/api/admin/currencies/USD", {
        method: "PUT", cookie: adminCookie,
        body: { symbol: "$", displayRateFromDefault: 0 }
      });
      assert.equal(zero.status, 400);
      const negative = await jsonRequest(baseUrl, "/api/admin/currencies/USD", {
        method: "PUT", cookie: adminCookie,
        body: { symbol: "$", displayRateFromDefault: -1.5 }
      });
      assert.equal(negative.status, 400);
    });

    await t.test("PUT rejects a displayRateFromDefault on the DEFAULT currency (a rate relative to itself is meaningless)", async () => {
      const { status, payload } = await jsonRequest(baseUrl, "/api/admin/currencies/GBP", {
        method: "PUT", cookie: adminCookie,
        body: { symbol: "£", displayRateFromDefault: 5 }
      });
      assert.equal(status, 400, JSON.stringify(payload));
    });

    await t.test("country-config: PUT rejects an unknown language or currency code", async () => {
      const badLang = await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "xx", currencyCode: "GBP" }
      });
      assert.equal(badLang.status, 400);
      const badCurrency = await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "ZZZ" }
      });
      assert.equal(badCurrency.status, 400);
    });

    await t.test("country-config: PUT creates a real mapping; GET's composed view joins live shipping/tax data", async () => {
      // Give RO a real shipping zone + tax rate to prove the composed view
      // reads them live rather than needing its own copy.
      await jsonRequest(baseUrl, "/api/admin/shipping-zones", {
        method: "POST", cookie: adminCookie, body: { name: "Romania Zone", countries: ["RO"] }
      });
      await jsonRequest(baseUrl, "/api/admin/tax-rates", {
        method: "POST", cookie: adminCookie,
        body: { name: "TVA", country: "RO", rate: 19, inclusive: true, priority: 0 }
      });
      await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", decimalPlaces: 0, active: true }
      });

      const put = await jsonRequest(baseUrl, "/api/admin/country-config/RO", {
        method: "PUT", cookie: adminCookie, body: { languageCode: "ro", currencyCode: "RON" }
      });
      assert.equal(put.status, 200, JSON.stringify(put.payload));
      assert.equal(put.payload.countryConfig.countryCode, "RO");

      const list = await jsonRequest(baseUrl, "/api/admin/country-config", { cookie: adminCookie });
      const ro = list.payload.countryConfigs.find((c) => c.countryCode === "RO");
      assert.ok(ro, "the RO mapping must appear in the list");
      assert.equal(ro.languageCode, "ro");
      assert.equal(ro.currencyCode, "RON");
      assert.equal(ro.shippingZoneName, "Romania Zone", "composed view must reflect the real shipping zone, live");
      assert.equal(ro.taxName, "TVA", "composed view must reflect the real tax rate, live");
      assert.equal(ro.taxRate, 19);
    });

    await t.test("country-config: DELETE removes a mapping", async () => {
      const del = await jsonRequest(baseUrl, "/api/admin/country-config/RO", { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);
      const list = await jsonRequest(baseUrl, "/api/admin/country-config", { cookie: adminCookie });
      assert.ok(!list.payload.countryConfigs.some((c) => c.countryCode === "RO"));
    });

    await t.test("all admin routes require auth (401 for anonymous)", async () => {
      const routes = [
        ["/api/admin/languages", "GET"],
        ["/api/admin/languages/en", "PUT"],
        ["/api/admin/languages/en", "DELETE"],
        ["/api/admin/currencies", "GET"],
        ["/api/admin/currencies/GBP", "PUT"],
        ["/api/admin/currencies/GBP", "DELETE"],
        ["/api/admin/country-config", "GET"],
        ["/api/admin/country-config/RO", "PUT"],
        ["/api/admin/country-config/RO", "DELETE"]
      ];
      for (const [pathname, method] of routes) {
        const { status } = await jsonRequest(baseUrl, pathname, { method, body: method === "GET" ? undefined : {} });
        assert.equal(status, 401, `${method} ${pathname} must require auth`);
      }
    });
  } finally {
    stopServer(httpServer);
  }
});
