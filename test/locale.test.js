const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const localeSource = fs.readFileSync(path.join(__dirname, "..", "locale.js"), "utf8");

function createLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    }
  };
}

// Stubs Intl.DateTimeFormat().resolvedOptions().timeZone so tests don't
// depend on the host machine's real system timezone (locale.js uses the
// timezone, alongside browser language, to detect the visitor's region).
// Everything else (NumberFormat, etc.) still delegates to the real Intl.
function createIntlStub(timeZone) {
  return new Proxy(Intl, {
    get(target, prop) {
      if (prop === "DateTimeFormat") {
        return (...args) => {
          const formatter = new target.DateTimeFormat(...args);
          return new Proxy(formatter, {
            get(formatterTarget, formatterProp) {
              if (formatterProp === "resolvedOptions") {
                return () => ({ ...formatterTarget.resolvedOptions(), timeZone });
              }
              const value = formatterTarget[formatterProp];
              return typeof value === "function" ? value.bind(formatterTarget) : value;
            }
          });
        };
      }
      return target[prop];
    }
  });
}

// Loads locale.js in an isolated sandbox with stubbed browser globals and
// returns the window.BecaRegion API it exposes. timeZone defaults to a
// neutral, non-RO/non-UK zone so language stubs are what actually drive
// detection in tests, regardless of the machine running them.
function loadRegion({ languages = ["en-GB"], storage = {}, timeZone = "America/New_York" } = {}) {
  const sandbox = {
    window: {},
    navigator: { languages, language: languages[0] || "" },
    localStorage: createLocalStorage(storage),
    Intl: createIntlStub(timeZone),
    Date,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(localeSource, sandbox);
  return sandbox.window.BecaRegion;
}

test("detect returns a Romanian profile for ro browser languages", () => {
  const region = loadRegion({ languages: ["ro-RO", "en-US"] });
  const profile = region.detect();

  assert.equal(profile.country, "RO");
  assert.equal(profile.language, "ro");
  assert.equal(profile.currency, "RON");
  assert.equal(profile.rateFromGBP, 5.85);
});

test("detect falls back to the UK/GBP profile for non-RO languages", () => {
  const region = loadRegion({ languages: ["en-GB"] });
  const profile = region.detect();

  assert.equal(profile.currency, "GBP");
  assert.equal(profile.language, "en");
  assert.equal(profile.rateFromGBP, 1);
});

test("getProfile honours a manual language override stored in localStorage", () => {
  const region = loadRegion({
    languages: ["en-GB"],
    storage: { "beca-language-source": "manual", "beca-language": "ro" }
  });

  const profile = region.getProfile();
  assert.equal(profile.language, "ro");
  assert.equal(profile.locale, "ro-RO");
  // currency still reflects detected region, only language is overridden
  assert.equal(profile.currency, "GBP");
});

test("manual override is ignored when the source is not 'manual'", () => {
  const region = loadRegion({
    languages: ["en-GB"],
    storage: { "beca-language": "ro" }
  });
  assert.equal(region.language(), "en");
});

test("text looks up the active language and applies replacements", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  assert.equal(en.text("addToCart"), "Add to cart");
  assert.equal(en.text("orderReceived", { number: "42" }), "Order 42 received.");
  assert.equal(en.text("missingKey"), "missingKey", "unknown keys fall through to the key itself");

  const ro = loadRegion({ languages: ["ro-RO"] });
  assert.equal(ro.text("addToCart"), "Adauga in cos");
});

test("translateCategory maps known categories and passes others through", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  assert.equal(en.translateCategory("tee"), "Tee");
  assert.equal(en.translateCategory("PIECE"), "Piece");
  assert.equal(en.translateCategory("Hoodie"), "Hoodie");
  assert.equal(en.translateCategory(""), "Piece");
});

test("convert applies the GBP<->RON rate based on the active profile", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  assert.equal(ro.convert(10, "GBP"), 58.5);
  assert.equal(ro.convert(10, "RON"), 10, "same currency is returned unchanged");

  const uk = loadRegion({ languages: ["en-GB"] });
  assert.equal(uk.convert(5.85, "RON"), 1);
  assert.equal(uk.convert(20, "GBP"), 20);
});

test("money formats the converted amount with the profile currency", () => {
  const uk = loadRegion({ languages: ["en-GB"] });
  const formatted = uk.money(20, "GBP");
  assert.match(formatted, /£\s?20\.00/);

  const ro = loadRegion({ languages: ["ro-RO"] });
  const roFormatted = ro.money(10, "GBP");
  // RON uses 0 fraction digits, so no decimals should appear
  assert.doesNotMatch(roFormatted, /[.,]\d{2}/);
});

test("stockText and countText pluralize based on the number", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  assert.equal(en.stockText(3), "3 left");
  assert.equal(en.stockText(0), "sold out");
  assert.equal(en.countText(1), "1 piece");
  assert.equal(en.countText(4), "4 pieces");
});

test("displayProduct picks localized names, descriptions and category", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  const display = ro.displayProduct({
    name: "Golden Hour Tee",
    nameRo: "Tricou Ora de Aur",
    category: "tee"
  });

  assert.equal(display.displayName, "Tricou Ora de Aur");
  assert.equal(display.displayCategory, "Tricou");
  assert.ok(display.displayDescription.length > 0);
  assert.equal(display.name, "Golden Hour Tee", "original fields are preserved");
});

test("displayProduct falls back to the base name when a locale name is absent", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  const display = en.displayProduct({ name: "Instinct", category: "tee" });
  assert.equal(display.displayName, "Instinct");
});
