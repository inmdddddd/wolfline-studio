(function () {
  // Single source of truth for "how do I print this amount in this
  // currency" - replaces the ~8 independent `${currency} ${value.toFixed(2)}`
  // implementations that used to be copy-pasted across cart.js, checkout.js,
  // admin.js, invoice.js, product.js, shop.js, wishlist.js, and the
  // order-confirmation/thank-you/orders trio.
  //
  // Deliberately does NOT use Intl.NumberFormat(locale, {style:"currency",
  // currency: code}) - that throws a RangeError for any code the JS
  // engine's ICU data doesn't recognize, and currencies.code is
  // admin-entered free text (same trust level products.currency already
  // has - see server.js's sanitizeCurrency). style:"decimal" never throws
  // regardless of the code, and the admin's own symbol/decimalPlaces/
  // symbolPosition config does the rest - makes that config load-bearing
  // instead of decorative, and immune to an admin typo crashing a page.

  let cache = null;
  let loadPromise = null;

  function fallbackFormat(amount, currencyCode) {
    // Same shape the naive per-file implementations always used - keeps
    // behavior identical to today until the real currency list has loaded,
    // and never worse than today for a currency code with no config row.
    return `${currencyCode || ""} ${Number(amount || 0).toFixed(2)}`.trim();
  }

  function formatWithConfig(amount, config) {
    const value = Number(amount || 0);
    const numeral = new Intl.NumberFormat(undefined, {
      style: "decimal",
      minimumFractionDigits: config.decimalPlaces,
      maximumFractionDigits: config.decimalPlaces
    }).format(value);
    return config.symbolPosition === "after" ? `${numeral} ${config.symbol}` : `${config.symbol}${numeral}`;
  }

  // Renders a KNOWN (amount, currencyCode) pair exactly as configured -
  // zero conversion, zero viewer-profile involvement. For amounts that are
  // already resolved/charged/historical (admin dashboards, invoices, order
  // confirmations) - never for a browsing price that should reflect the
  // current visitor's language/currency choice (that's locale.js's job).
  function formatExact(amount, currencyCode) {
    const code = String(currencyCode || "").toUpperCase();
    const config = cache?.find((currency) => currency.code === code);
    if (!config) return fallbackFormat(amount, code);
    return formatWithConfig(amount, config);
  }

  function getCurrencyConfig(currencyCode) {
    const code = String(currencyCode || "").toUpperCase();
    return cache?.find((currency) => currency.code === code) || null;
  }

  async function ensureLoaded() {
    if (cache) return cache;
    if (!loadPromise) {
      loadPromise = fetch("/api/currencies", { headers: { Accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : { currencies: [] }))
        .then((data) => {
          cache = Array.isArray(data.currencies) ? data.currencies : [];
          return cache;
        })
        .catch(() => {
          cache = [];
          return cache;
        });
    }
    return loadPromise;
  }

  // Fire-and-forget at load time (mirrors locale.js's own loadRates()
  // pattern) so formatExact/getCurrencyConfig usually have real config
  // available immediately; ensureLoaded() is there for call sites that
  // need to actively await the first load (e.g. before rendering a page
  // that's currency-config-dependent from the very first paint).
  ensureLoaded();

  window.BecaCurrency = { formatExact, formatWithConfig, getCurrencyConfig, ensureLoaded };
})();
