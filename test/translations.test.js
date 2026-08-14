const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// HTTP/integration coverage for the translations override layer: admin
// CRUD, the public per-language lookup locale.js/script.js actually fetch,
// and that it stays a pure ADD-ON (never required for the store to work -
// an unknown/inactive language or a missing key both degrade gracefully,
// never a 500 or a raw error).

const ADMIN_EMAIL = "admin@translations-test.local";
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

test("translations: admin CRUD, public lookup, and graceful fallback for unknown input", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-translations-test-"));
  const { httpServer, baseUrl } = await startServer({ DATA_DIR: path.join(tempRoot, "data") });
  const adminCookie = await adminLogin(baseUrl);

  try {
    await t.test("public GET /api/languages and /api/country-config work with no auth (needed by locale.js/script.js)", async () => {
      const languages = await jsonRequest(baseUrl, "/api/languages");
      assert.equal(languages.status, 200);
      assert.ok(languages.payload.languages.some((l) => l.code === "en"));

      const countryConfig = await jsonRequest(baseUrl, "/api/country-config");
      assert.equal(countryConfig.status, 200);
      assert.deepEqual(countryConfig.payload.countryConfigs, [], "no mappings configured yet in a fresh instance");
    });

    await t.test("public GET /api/translations?lang= returns an empty map before any override exists", async () => {
      const res = await jsonRequest(baseUrl, "/api/translations?lang=en");
      assert.equal(res.status, 200);
      assert.deepEqual(res.payload.translations, {});
    });

    await t.test("admin POST creates a translation; public GET reflects it as a flat {key: value} map", async () => {
      const create = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie,
        body: { key: "checkout.free", languageCode: "en", value: "Complimentary" }
      });
      assert.equal(create.status, 200, JSON.stringify(create.payload));
      assert.equal(create.payload.translation.key, "checkout.free");
      assert.equal(create.payload.translation.languageCode, "en");
      assert.equal(create.payload.translation.value, "Complimentary");

      const publicLookup = await jsonRequest(baseUrl, "/api/translations?lang=en");
      assert.deepEqual(publicLookup.payload.translations, { "checkout.free": "Complimentary" });
    });

    await t.test("admin POST on the same key+language is an upsert, not a duplicate", async () => {
      await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie,
        body: { key: "cart", languageCode: "ro", value: "Cosul meu" }
      });
      const second = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie,
        body: { key: "cart", languageCode: "ro", value: "Coșul tău" }
      });
      assert.equal(second.status, 200);

      const list = await jsonRequest(baseUrl, "/api/admin/translations", { cookie: adminCookie });
      const matches = list.payload.translations.filter((entry) => entry.key === "cart" && entry.languageCode === "ro");
      assert.equal(matches.length, 1, "must upsert in place, never accumulate duplicate rows");
      assert.equal(matches[0].value, "Coșul tău");
    });

    await t.test("admin POST rejects a missing key, an unknown language, and an empty value", async () => {
      const noKey = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { languageCode: "en", value: "x" }
      });
      assert.equal(noKey.status, 400);

      const badLang = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "cart", languageCode: "zz", value: "x" }
      });
      assert.equal(badLang.status, 400);
      assert.match(badLang.payload.error, /limba/i);

      const emptyValue = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "cart", languageCode: "en", value: "" }
      });
      assert.equal(emptyValue.status, 400);
    });

    await t.test("admin GET lists every language's overrides together; public GET stays scoped to one language", async () => {
      await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "addToCart", languageCode: "ro", value: "Cumpara" }
      });
      const adminList = await jsonRequest(baseUrl, "/api/admin/translations", { cookie: adminCookie });
      assert.ok(adminList.payload.translations.some((e) => e.languageCode === "en"));
      assert.ok(adminList.payload.translations.some((e) => e.languageCode === "ro"));

      const publicEn = await jsonRequest(baseUrl, "/api/translations?lang=en");
      assert.equal(publicEn.payload.translations.addToCart, undefined, "an en request must never leak a ro-only override");
      const publicRo = await jsonRequest(baseUrl, "/api/translations?lang=ro");
      assert.equal(publicRo.payload.translations.addToCart, "Cumpara");
    });

    await t.test("DELETE removes exactly the one {key, language} pair, leaving the other language's override intact", async () => {
      await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "shared.key", languageCode: "en", value: "EN value" }
      });
      await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "shared.key", languageCode: "ro", value: "RO value" }
      });
      const del = await jsonRequest(baseUrl, "/api/admin/translations/en/shared.key", { method: "DELETE", cookie: adminCookie });
      assert.equal(del.status, 200);

      const afterEn = await jsonRequest(baseUrl, "/api/translations?lang=en");
      assert.equal(afterEn.payload.translations["shared.key"], undefined);
      const afterRo = await jsonRequest(baseUrl, "/api/translations?lang=ro");
      assert.equal(afterRo.payload.translations["shared.key"], "RO value", "deleting the en override must not touch ro's");
    });

    await t.test("an inactive or unrecognized ?lang= returns an empty map, never an error", async () => {
      await jsonRequest(baseUrl, "/api/admin/currencies/RON", {
        method: "PUT", cookie: adminCookie, body: { symbol: "lei", active: true }
      });
      const putLang = await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "PUT", cookie: adminCookie, body: { name: "French", nativeName: "Francais", active: false }
      });
      assert.equal(putLang.status, 200);
      await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", cookie: adminCookie, body: { key: "cart", languageCode: "fr", value: "Panier" }
      });

      const inactiveLang = await jsonRequest(baseUrl, "/api/translations?lang=fr");
      assert.equal(inactiveLang.status, 200);
      assert.deepEqual(inactiveLang.payload.translations, {}, "an inactive language's overrides must not be served, even though rows exist");

      const unknownLang = await jsonRequest(baseUrl, "/api/translations?lang=zz");
      assert.equal(unknownLang.status, 200);
      assert.deepEqual(unknownLang.payload.translations, {});

      const missingLang = await jsonRequest(baseUrl, "/api/translations");
      assert.equal(missingLang.status, 200);
      assert.deepEqual(missingLang.payload.translations, {});
    });

    await t.test("admin translations routes require auth (401 for anonymous)", async () => {
      const get = await jsonRequest(baseUrl, "/api/admin/translations");
      assert.equal(get.status, 401);
      const post = await jsonRequest(baseUrl, "/api/admin/translations", {
        method: "POST", body: { key: "x", languageCode: "en", value: "x" }
      });
      assert.equal(post.status, 401);
      const del = await jsonRequest(baseUrl, "/api/admin/translations/en/x", { method: "DELETE" });
      assert.equal(del.status, 401);
    });

    await t.test("/api/admin/content PUT preserves an existing non-en/ro language's content, not just en/ro (the old hardcoded merge would have dropped it)", async () => {
      await jsonRequest(baseUrl, "/api/admin/languages/fr", {
        method: "PUT", cookie: adminCookie, body: { name: "French", nativeName: "Francais", active: true }
      });
      const first = await jsonRequest(baseUrl, "/api/admin/content", {
        method: "PUT", cookie: adminCookie, body: { fr: { "hero.title": "Bonjour" } }
      });
      assert.equal(first.status, 200, JSON.stringify(first.payload));
      assert.equal(first.payload.content.fr["hero.title"], "Bonjour");

      // A second save that only touches "en" must not wipe fr's content.
      const second = await jsonRequest(baseUrl, "/api/admin/content", {
        method: "PUT", cookie: adminCookie, body: { en: { "hero.title": "Hello" } }
      });
      assert.equal(second.status, 200);
      assert.equal(second.payload.content.en["hero.title"], "Hello");
      assert.equal(second.payload.content.fr["hero.title"], "Bonjour", "fr content must survive a save that never mentioned fr");
    });
  } finally {
    stopServer(httpServer);
  }
});
