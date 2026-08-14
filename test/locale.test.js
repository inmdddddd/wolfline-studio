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
function loadRegion({ languages = ["en-GB"], storage = {}, timeZone = "America/New_York", becaCurrency } = {}) {
  const sandbox = {
    // Pre-seeded like currency.js would have already loaded and cached
    // /api/currencies by the time a real page calls secondaryPriceText -
    // locale.js only ever reads window.BecaCurrency lazily, at call time,
    // so setting it up front here is equivalent to a real async load
    // finishing before the caller's next tick.
    window: { BecaCurrency: becaCurrency },
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

test("detect returns a Romanian profile for ro browser languages once a rate is configured", () => {
  const region = loadRegion({ languages: ["ro-RO", "en-US"] });
  region.setRates({ gbpToRon: 5.85, gbpToRonUpdatedAt: "2026-07-20" });
  const profile = region.detect();

  assert.equal(profile.country, "RO");
  assert.equal(profile.language, "ro");
  assert.equal(profile.currency, "RON");
  assert.equal(profile.rateFromGBP, 5.85);
});

test("without a configured rate, Romanian visitors see the original currency (GBP)", () => {
  const region = loadRegion({ languages: ["ro-RO"] });
  const profile = region.detect();

  assert.equal(profile.country, "RO");
  assert.equal(profile.language, "ro");
  assert.equal(profile.currency, "GBP", "no configured rate => show the original order currency");
  assert.equal(region.convert(10, "GBP"), 10, "no approximate conversion without a rate");
});

test("detect falls back to the UK/GBP profile for non-RO languages", () => {
  const region = loadRegion({ languages: ["en-GB"] });
  const profile = region.detect();

  assert.equal(profile.currency, "GBP");
  assert.equal(profile.language, "en");
  assert.equal(profile.rateFromGBP, 1);
});

test("detect returns the real ISO code GB, not the old 'UK' label", () => {
  // shipping_zones/tax_rates/checkout.js/country_config all key on "GB" -
  // the old "UK" label only ever looked right, it never matched anything
  // real downstream. Covers both branches that used to return it.
  assert.equal(loadRegion({ languages: ["en-GB"] }).detect().country, "GB");
  assert.equal(loadRegion({ languages: ["de-DE"], timeZone: "Europe/Berlin" }).detect().country, "GB");
});

test("detect resolves LANGUAGE from a real country_config mapping once loaded, overriding the RO/default guess", () => {
  const region = loadRegion({ languages: ["ro-RO"] });
  region.setLanguages([
    { code: "en", isDefault: true, active: true },
    { code: "hu", isDefault: false, active: true }
  ]);
  // Admin has explicitly mapped Romania to Hungarian (an unusual but valid
  // choice) - once loaded, this real mapping wins over the built-in
  // RO->ro guess.
  region.setCountryConfig([{ countryCode: "RO", languageCode: "hu", currencyCode: "GBP" }]);
  const profile = region.detect();
  assert.equal(profile.country, "RO");
  assert.equal(profile.language, "hu", "a real country_config mapping overrides the built-in RO->ro guess");
});

test("detect's CURRENCY half stays narrow even once country_config has loaded - never labels an unconverted price with a currency that has no real conversion rate", () => {
  const region = loadRegion({ languages: ["fr-FR"], timeZone: "Europe/Paris" });
  region.setCountryConfig([{ countryCode: "GB", languageCode: "fr", currencyCode: "EUR" }]);
  const profile = region.detect();
  assert.equal(profile.language, "fr", "language DOES follow the real mapping");
  assert.equal(profile.currency, "GBP", "currency does NOT follow it - browsing-price currency stays GBP/RON-only, by design (decision #7)");
});

test("without any country_config loaded yet, detect still resolves RO->ro exactly like before (pre-fetch / test-sandbox safe)", () => {
  const region = loadRegion({ languages: ["ro-RO"] });
  assert.equal(region.detect().language, "ro");
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
  assert.equal(en.text("missingKey"), "", "an unknown key must NEVER surface the raw key itself - the permanent fix, not a per-key patch");

  const ro = loadRegion({ languages: ["ro-RO"] });
  assert.equal(ro.text("addToCart"), "Adauga in cos");
});

test("text's fallback chain: DB override for the active language wins over the code baseline", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  en.setTranslations("en", { addToCart: "Buy now" });
  assert.equal(en.text("addToCart"), "Buy now");
  // A key with no override still falls through to the code baseline.
  assert.equal(en.text("cart"), "Cart");
});

test("text falls back to a DB override for the DEFAULT language, then the English baseline, before giving up", () => {
  const withDefault = loadRegion({
    languages: ["en-GB"],
    storage: { "beca-language-source": "manual", "beca-language": "fr" }
  });
  withDefault.setLanguages([
    { code: "en", isDefault: true, active: true },
    { code: "fr", isDefault: false, active: true }
  ]);
  // "fr" has no code-defined dictionary in this file at all (only en/ro
  // ship a baseline - see decision #4: hardcoded dictionaries are NOT
  // migrated) - a 3rd+ language leans on overrides, then English.
  withDefault.setTranslations("en", { "checkout.free": "Gratis (EN override)" });
  withDefault.setTranslations("fr", {});
  assert.equal(withDefault.language(), "fr", "manual override must resolve to fr for this to actually exercise the fallback chain");
  assert.equal(withDefault.text("checkout.free"), "Gratis (EN override)", "falls through to the default language's own DB override");
  assert.equal(withDefault.text("cart"), "Cart", "falls all the way through to the English code baseline when nothing else matches");
});

test("a DB override for a language with its own code-defined baseline (ro) wins over that baseline", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  ro.setTranslations("ro", { addToCart: "Cumpara acum" });
  assert.equal(ro.text("addToCart"), "Cumpara acum");
});

test("translateCategory maps known categories and passes others through", () => {
  const en = loadRegion({ languages: ["en-GB"] });
  assert.equal(en.translateCategory("tee"), "Tee");
  assert.equal(en.translateCategory("PIECE"), "Piece");
  assert.equal(en.translateCategory("Hoodie"), "Hoodie");
  assert.equal(en.translateCategory(""), "Piece");
});

test("convert applies the configured GBP<->RON rate based on the active profile", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  ro.setRates({ gbpToRon: 5.85 });
  assert.equal(ro.convert(10, "GBP"), 58.5);
  assert.equal(ro.convert(10, "RON"), 10, "same currency is returned unchanged");

  const uk = loadRegion({ languages: ["en-GB"] });
  uk.setRates({ gbpToRon: 5.85 });
  assert.equal(uk.convert(5.85, "RON"), 1);
  assert.equal(uk.convert(20, "GBP"), 20);
});

test("money formats the converted amount with the profile currency", () => {
  const uk = loadRegion({ languages: ["en-GB"] });
  const formatted = uk.money(20, "GBP");
  assert.match(formatted, /£\s?20\.00/);

  const ro = loadRegion({ languages: ["ro-RO"] });
  ro.setRates({ gbpToRon: 5.85 });
  const roFormatted = ro.money(10, "GBP");
  // RON uses 0 fraction digits, so no decimals should appear
  assert.doesNotMatch(roFormatted, /[.,]\d{2}/);
});

// Mirrors currency.js's real formatWithConfig (symbol + decimalPlaces +
// symbolPosition) closely enough for assertions, without pulling in the
// whole file - this suite only ever exercises locale.js.
function fakeCurrency({ defaultCode = "GBP", secondaryCode = null, secondaryRate = null } = {}) {
  const configs = {
    GBP: { code: "GBP", symbol: "£", decimalPlaces: 2, symbolPosition: "before", isDefault: defaultCode === "GBP" },
    RON: { code: "RON", symbol: "lei", decimalPlaces: 0, symbolPosition: "after", isDefault: defaultCode === "RON", displayRateFromDefault: secondaryCode === "RON" ? secondaryRate : null }
  };
  return {
    getDefaultCurrency: () => configs[defaultCode] || null,
    getSecondaryCurrency: () => (secondaryCode ? configs[secondaryCode] : null),
    formatWithConfig: (amount, config) => {
      const numeral = amount.toFixed(config.decimalPlaces);
      return config.symbolPosition === "after" ? `${numeral} ${config.symbol}` : `${config.symbol}${numeral}`;
    }
  };
}

test("secondaryPriceText returns an empty string, never throws, before currency.js has loaded (window.BecaCurrency undefined)", () => {
  const region = loadRegion({ languages: ["en-GB"] });
  assert.equal(region.secondaryPriceText(59, "GBP"), "");
});

test("secondaryPriceText returns an empty string when no secondary currency has a rate configured", () => {
  const region = loadRegion({ languages: ["en-GB"], becaCurrency: fakeCurrency({ defaultCode: "GBP", secondaryCode: null }) });
  assert.equal(region.secondaryPriceText(59, "GBP"), "");
});

test("secondaryPriceText renders the configured secondary currency next to a default-currency amount", () => {
  const region = loadRegion({
    languages: ["en-GB"],
    becaCurrency: fakeCurrency({ defaultCode: "GBP", secondaryCode: "RON", secondaryRate: 5 })
  });
  assert.equal(region.secondaryPriceText(59, "GBP"), "295 lei");
});

test("secondaryPriceText returns empty for an amount that is NOT in the store's default currency - a real resolved price never gets a fake second number spliced on", () => {
  const region = loadRegion({
    languages: ["en-GB"],
    becaCurrency: fakeCurrency({ defaultCode: "GBP", secondaryCode: "RON", secondaryRate: 5 })
  });
  assert.equal(region.secondaryPriceText(295, "RON"), "", "an already-RON amount (e.g. a real per-country override) must not get a second RON number appended to itself");
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

test("displayProduct prefers the normalized product_translations row over nameRo/descriptionRo (the new admin form's own data source)", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  const display = ro.displayProduct({
    name: "Golden Hour Tee",
    nameRo: "Tricou Ora de Aur (vechi)",
    descriptionRo: "Descriere veche",
    category: "tee",
    translations: [
      { languageCode: "ro", name: "Tricou Ora de Aur (nou)", description: "Descriere noua", shortDescription: "Scurt" }
    ]
  });

  assert.equal(display.displayName, "Tricou Ora de Aur (nou)", "product_translations must win over the legacy nameRo column");
  assert.equal(display.displayDescription, "Descriere noua");
  assert.equal(display.displayShortDescription, "Scurt");
});

test("displayProduct falls back to nameRo/descriptionRo when no product_translations row exists for the active language", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  const display = ro.displayProduct({
    name: "Golden Hour Tee",
    nameRo: "Tricou Ora de Aur",
    descriptionRo: "Descriere RO",
    category: "tee",
    translations: [{ languageCode: "en", name: "Golden Hour Tee (EN)" }]
  });

  assert.equal(display.displayName, "Tricou Ora de Aur", "no ro translation row -> falls through to the legacy column, not the en row");
  assert.equal(display.displayDescription, "Descriere RO");
});

test("displayProduct prefers categoryTranslations over the hardcoded tee/piece/drop matching", () => {
  const ro = loadRegion({ languages: ["ro-RO"] });
  const display = ro.displayProduct({
    name: "Custom Piece",
    category: "Hoodie",
    categoryTranslations: { ro: "Hanorac", en: "Hoodie" }
  });
  assert.equal(display.displayCategory, "Hanorac");

  // A category with no translations row for this language falls through
  // to the old hardcoded matching (still correct for "tee"/"piece"/"drop").
  const untranslated = ro.displayProduct({ name: "Tee", category: "tee", categoryTranslations: {} });
  assert.equal(untranslated.displayCategory, "Tricou");
});
