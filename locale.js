(function () {
  /* Display-currency conversion. Orders are always recorded in the product
     currency (GBP); RON is only an indicative display conversion. The rate
     is no longer hardcoded: it comes from the server (/api/region-config,
     backed by the GBP_TO_RON_RATE env var). Until a rate is loaded - or when
     none is configured - prices are shown in the original currency. */
  let gbpToRonRate = null;
  let gbpToRonUpdatedAt = null;

  function setRates(rates) {
    const value = Number(rates && rates.gbpToRon);
    gbpToRonRate = Number.isFinite(value) && value > 0 ? value : null;
    gbpToRonUpdatedAt = (rates && rates.gbpToRonUpdatedAt) || null;
  }

  function loadRates() {
    if (typeof fetch !== "function") return;
    fetch("/api/region-config", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (!config) return;
        setRates(config);
        if (typeof document !== "undefined" && typeof CustomEvent === "function") {
          document.dispatchEvent(new CustomEvent("beca:rates-loaded"));
        }
      })
      .catch(() => {});
  }

  const LANGUAGE_KEY = "beca-language";
  const LANGUAGE_SOURCE_KEY = "beca-language-source";

  // Active languages + the country->language(->currency) mapping, fetched
  // once and cached - lets detect()/language() generalize beyond the old
  // inline RO/EN special case without every call site becoming async.
  // Until the fetch resolves, isKnownLanguage()/defaultLanguageCode() fall
  // back to exactly today's hardcoded en/ro behavior, so nothing regresses
  // on a slow connection or the very first paint.
  let languagesCache = null;
  let countryConfigCache = null;

  function loadLanguages() {
    if (typeof fetch !== "function") return;
    fetch("/api/languages", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setLanguages(data?.languages))
      .catch(() => {});
  }

  function loadCountryConfig() {
    if (typeof fetch !== "function") return;
    fetch("/api/country-config", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setCountryConfig(data?.countryConfigs);
        if (typeof document !== "undefined" && typeof CustomEvent === "function") {
          document.dispatchEvent(new CustomEvent("beca:locale-change"));
        }
      })
      .catch(() => {});
  }

  // Exposed on window.BecaRegion alongside setRates - both the real
  // fetch-then-cache loaders above and this file's own unit tests
  // (test/locale.test.js, which run in a sandbox with no `fetch` global)
  // use these to prime detection without a network round trip.
  function setLanguages(list) {
    languagesCache = Array.isArray(list) ? list : null;
  }

  function setCountryConfig(list) {
    countryConfigCache = Array.isArray(list) ? list : null;
  }

  function defaultLanguageCode() {
    const found = languagesCache?.find((entry) => entry.isDefault);
    return found?.code || "en";
  }

  function isKnownLanguage(code) {
    if (!code) return false;
    if (languagesCache) return languagesCache.some((entry) => entry.code === code && entry.active);
    return code === "en" || code === "ro";
  }

  // Optional override layer on top of the dictionary below (see the
  // translations table's comment in lib/db.js) - fetched lazily per
  // language the first time text() actually needs it, not eagerly for
  // every active language up front. Undefined (not yet requested/loaded)
  // reads as "no override" until the fetch resolves and a
  // beca:locale-change re-render picks it up, exactly like gbpToRonRate's
  // own load-then-event pattern above.
  const translationOverrides = {};
  const translationLoadStarted = {};

  function ensureTranslationsLoaded(lang) {
    if (!lang || translationLoadStarted[lang] || typeof fetch !== "function") return;
    translationLoadStarted[lang] = true;
    fetch(`/api/translations?lang=${encodeURIComponent(lang)}`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        translationOverrides[lang] = (data && data.translations) || {};
        if (typeof document !== "undefined" && typeof CustomEvent === "function") {
          document.dispatchEvent(new CustomEvent("beca:locale-change"));
        }
      })
      .catch(() => {
        translationOverrides[lang] = {};
      });
  }

  // Test-only injection point (mirrors setLanguages/setCountryConfig above)
  // - also marks the language as already-loaded so text() won't attempt a
  // real fetch for it afterward.
  function setTranslations(lang, map) {
    if (!lang) return;
    translationOverrides[lang] = map && typeof map === "object" ? map : {};
    translationLoadStarted[lang] = true;
  }

  const dictionary = {
    en: {
      piece: "Piece",
      tee: "Tee",
      drop: "Drop",
      left: "left",
      soldOut: "sold out",
      addToCart: "Add to cart",
      previewOnly: "preview",
      notifyMe: "Notify me when available",
      unknownYet: "Unknown yet",
      notifySaved: "You are on the list.",
      notifySavedShort: "On the list",
      previewReason: "Join the list for access before the public drop. Limited stock.",
      preferredSize: "Preferred size",
      dropUnlocks: "Drop unlocks in 12 days",
      remove: "Remove",
      cart: "Cart",
      close: "Close",
      name: "Name",
      email: "Email",
      phone: "Phone",
      address: "Address",
      checkout: "Checkout",
      backToCart: "Back to cart",
      placeOrder: "Place order",
      sendingOrder: "Sending order...",
      payAmountDue: "Amount due: ",
      processingPayment: "Processing payment...",
      cardDeclined: "Card was declined.",
      orderReceived: "Order {number} received.",
      noPieces: "No pieces selected yet.",
      noLivePieces: "No live pieces yet.",
      productsLoadFailed: "Products could not load.",
      limitedFallback: "Limited piece from the latest drop.",
      productMissing: "Product missing.",
      addedToCart: "Added to cart.",
      selectSize: "Choose a size first.",
      noReviewsYet: "No reviews yet.",
      sending: "Sending...",
      reviewSubmitted: "Thanks. Your review will show once approved.",
      pieceSingular: "piece",
      piecePlural: "pieces",
      "thankYou.kicker": "Order confirmed",
      "thankYou.title": "Your drop is locked in.",
      "thankYou.lede": "We've got your order — here's everything for your records.",
      "thankYou.orderNumber": "Order number",
      "thankYou.status": "Status",
      "thankYou.summary": "Order summary",
      "thankYou.shippingTo": "Shipping to",
      "thankYou.backHome": "Back to home",
      "thankYou.invoice": "View invoice",
      "thankYou.viewShop": "Keep exploring",
      "thankYou.support": "Need help? Contact support",
      "thankYou.loading": "Loading your order...",
      "thankYou.notFoundTitle": "We couldn't find that order.",
      "thankYou.notFoundBody": "The link may be incomplete or the order no longer exists. Reach out to support if you think this is a mistake.",
      "thankYou.subtotal": "Subtotal",
      "thankYou.total": "Total",
      "status.pending": "Pending",
      "status.confirmed": "Confirmed",
      "status.processing": "Processing",
      "status.shipped": "Shipped",
      "status.delivered": "Delivered",
      "status.cancelled": "Cancelled",
      itemSingular: "item",
      itemPlural: "items",
      "confirmation.title": "Order confirmed",
      "confirmation.message": "Thank you — your order has been placed successfully. A confirmation email is on its way.",
      "cart.itemsUnavailable": "Some items in your cart are no longer available and were removed.",
      "confirmation.totalPaid": "Total paid",
      "confirmation.continueShopping": "Continue shopping",
      "checkout.noCardNote": "Card payment isn't available right now — we'll confirm your order and payment details by email.",
      "checkout.selectCountry": "Select a country",
      "checkout.selectCountryForDelivery": "Select a country above to see delivery options.",
      "checkout.loadingDelivery": "Loading delivery options...",
      "checkout.freeShippingNote": "Free shipping to this destination.",
      "checkout.free": "Free",
      "checkout.tax": "Tax",
      "checkout.taxIncluded": "VAT (included)"
    },
    ro: {
      piece: "Piesa",
      tee: "Tricou",
      drop: "Drop",
      left: "ramase",
      soldOut: "sold out",
      addToCart: "Adauga in cos",
      previewOnly: "preview",
      notifyMe: "Anunta-ma cand e disponibil",
      unknownYet: "Pret in curand",
      notifySaved: "Esti pe lista.",
      notifySavedShort: "Pe lista",
      previewReason: "Intra pe lista pentru acces inainte de public. Stoc limitat.",
      preferredSize: "Marime preferata",
      dropUnlocks: "Drop unlocks in 12 days",
      remove: "Sterge",
      cart: "Cos",
      close: "Inchide",
      name: "Nume",
      email: "Email",
      phone: "Telefon",
      address: "Adresa",
      checkout: "Checkout",
      backToCart: "Inapoi la cos",
      placeOrder: "Plaseaza comanda",
      sendingOrder: "Se trimite comanda...",
      payAmountDue: "Suma de plata: ",
      processingPayment: "Se proceseaza plata...",
      cardDeclined: "Cardul a fost refuzat.",
      orderReceived: "Comanda {number} a fost primita.",
      noPieces: "Nu ai selectat nicio piesa.",
      noLivePieces: "Nu exista piese live inca.",
      productsLoadFailed: "Produsele nu au putut fi incarcate.",
      limitedFallback: "Piesa limitata din cel mai nou drop.",
      productMissing: "Produsul lipseste.",
      addedToCart: "Adaugat in cos.",
      selectSize: "Alege o marime.",
      noReviewsYet: "Nicio recenzie inca.",
      sending: "Se trimite...",
      reviewSubmitted: "Multumim. Recenzia ta va aparea dupa aprobare.",
      pieceSingular: "piesa",
      piecePlural: "piese",
      "thankYou.kicker": "Comanda confirmata",
      "thankYou.title": "Piesa ta e rezervata.",
      "thankYou.lede": "Am primit comanda ta — aici gasesti tot ce trebuie sa stii.",
      "thankYou.orderNumber": "Numar comanda",
      "thankYou.status": "Status",
      "thankYou.summary": "Sumar comanda",
      "thankYou.shippingTo": "Livrare la",
      "thankYou.backHome": "Inapoi acasa",
      "thankYou.invoice": "Vezi factura",
      "thankYou.viewShop": "Continua sa explorezi",
      "thankYou.support": "Ai nevoie de ajutor? Contacteaza suportul",
      "thankYou.loading": "Se incarca comanda...",
      "thankYou.notFoundTitle": "Nu am gasit aceasta comanda.",
      "thankYou.notFoundBody": "Link-ul poate fi incomplet sau comanda nu mai exista. Scrie-ne daca crezi ca e o greseala.",
      "thankYou.subtotal": "Subtotal",
      "thankYou.total": "Total",
      "status.pending": "In asteptare",
      "status.confirmed": "Confirmata",
      "status.processing": "In procesare",
      "status.shipped": "Expediata",
      "status.delivered": "Livrata",
      "status.cancelled": "Anulata",
      itemSingular: "articol",
      itemPlural: "articole",
      "confirmation.title": "Comanda confirmata",
      "confirmation.message": "Multumim — comanda ta a fost plasata cu succes. Un email de confirmare este pe drum.",
      "cart.itemsUnavailable": "Unele produse din cosul tau nu mai sunt disponibile si au fost eliminate.",
      "confirmation.totalPaid": "Total platit",
      "confirmation.continueShopping": "Continua cumparaturile",
      "checkout.noCardNote": "Plata cu cardul nu este momentan disponibila — iti confirmam comanda si detaliile de plata prin email.",
      "checkout.selectCountry": "Selecteaza o tara",
      "checkout.selectCountryForDelivery": "Selecteaza o tara mai sus pentru a vedea optiunile de livrare.",
      "checkout.loadingDelivery": "Se incarca optiunile de livrare...",
      "checkout.freeShippingNote": "Livrare gratuita pentru aceasta destinatie.",
      "checkout.free": "Gratuita",
      "checkout.tax": "Taxa",
      "checkout.taxIncluded": "TVA (inclus)"
    }
  };

  const collectionDescriptions = {
    en: {
      golden: "Capturing the fleeting warmth of the golden hour. The GOLDEN HOUR tee blends delicate floral imagery with sharp, astral geometry, creating a piece that feels both grounded and celestial. Designed to bring light into the everyday, this is wearable art for those who gravitate toward the sun.",
      aura: "Where celestial geometry meets the organic beauty of nature. The AURA BLOOM tee is a fusion of ethereal aesthetics and modern design, crafted for those who embrace growth and luminosity. A sophisticated statement piece that bridges the gap between the structured and the untamed.",
      studio: "An exploration of form and frequency. The STUDIO DRAFT tee breaks the conventional layout with bold vertical typography and sharp geometric wolf motifs. It is a piece designed for those who view fashion as a blueprint, constructed with precision, worn with intent.",
      lonely: "In a world that never stops connecting, sometimes the only clear signal is the one you find within. The LONELY MODE tee is a meditation on digital isolation, featuring fluid geometric lines and a clean, brutalist aesthetic. Engineered for the observer, the coder, and the creator who operates on their own frequency.",
      instinct: "The blank canvas of the digital age. Featuring the signature Wolfline Studio branding and geometric precision, this piece is a testament to minimalist design. Crisp, clean, and engineered for those who value clarity in a world of noise."
    },
    ro: {
      golden: "Prinde caldura scurta a orei de aur. Tricoul GOLDEN HOUR imbina detalii florale delicate cu geometrie astrala precisa, intr-o piesa care se simte in acelasi timp naturala si celesta. Arta purtabila pentru cei care graviteaza spre lumina.",
      aura: "Geometrie celesta intalnita cu frumusetea organica a naturii. Tricoul AURA BLOOM combina o estetica eterica cu design modern, creat pentru cei care cauta crestere, luminozitate si o prezenta vizuala rafinata.",
      studio: "O explorare intre forma si frecventa. Tricoul STUDIO DRAFT rupe layoutul clasic prin tipografie verticala si motive geometrice Wolfline. O piesa construita cu precizie, pentru cei care vad moda ca pe un blueprint purtat cu intentie.",
      lonely: "Intr-o lume care nu se opreste din conectare, uneori singurul semnal clar este cel gasit in tine. Tricoul LONELY MODE vorbeste despre izolare digitala prin linii fluide, geometrie curata si o estetica brutalista.",
      instinct: "Canvasul curat al erei digitale. Cu branding Wolfline Studio si precizie geometrica, piesa merge pe minimalism, claritate si contrast pentru cei care cauta ordine intr-o lume plina de zgomot."
    }
  };

  function getTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }

  function getUtcOffsetHours() {
    return -new Date().getTimezoneOffset() / 60;
  }

  // Same narrow two-way heuristic as before ("looks Romanian" vs everything
  // else) - real geo-IP / a general detectable-country list is explicitly
  // out of scope (this only ever needs to distinguish one market from the
  // rest). Returns the real ISO code "GB" now, not "UK" - a genuine bug fix:
  // shipping_zones/tax_rates/checkout.js/country_config all key on "GB",
  // so the old label only ever looked right, it never actually matched
  // anything real.
  function detectCountryCode() {
    const timeZone = getTimeZone();
    const offset = getUtcOffsetHours();
    const languages = navigator.languages || [navigator.language || ""];
    const browserIsRomanian = languages.some((language) => language.toLowerCase().startsWith("ro"));

    if (timeZone === "Europe/Bucharest" || browserIsRomanian) return "RO";
    if (timeZone === "Europe/London" || offset <= 1) return "GB";
    return "GB";
  }

  function detect() {
    const country = detectCountryCode();
    const mapping = countryConfigCache?.find((entry) => entry.countryCode === country);
    // A real country_config mapping wins once loaded; until then (or if
    // this country has none), fall back to the exact RO->ro / else->default
    // guess this file has always made - not defaultLanguageCode() alone,
    // which would show English to a Romanian visitor for as long as the
    // country-config fetch is still in flight (or in non-fetch contexts,
    // like this file's own unit tests).
    const language = mapping?.languageCode || (country === "RO" ? "ro" : defaultLanguageCode());
    const locale = language === "ro" ? "ro-RO" : "en-GB";

    // The CURRENCY half stays exactly as narrow/opt-in as it always was,
    // deliberately NOT generalized to "whatever country_config says" -
    // this profile only ever backs the PRE-checkout browsing preview
    // (product/shop/cart pages), which never resolves a real per-country
    // price (see resolveProductPrice/resolveOrderPricing in server.js -
    // that only ever runs at checkout). Labeling an unconverted browsing
    // price with a currency country_config maps to, with no actual
    // conversion rate behind it, would be exactly the mislabeling bug
    // checkout.js's checkoutMoney() was fixed for this session - so this
    // half of detect() intentionally still only ever returns GBP, or RON
    // when the admin has explicitly configured a GBP_TO_RON_RATE.
    if (country === "RO") {
      return { country, language, currency: gbpToRonRate ? "RON" : "GBP", locale, rateFromGBP: gbpToRonRate || 1 };
    }
    return { country, language, currency: "GBP", locale, rateFromGBP: 1 };
  }

  function getForcedLanguage() {
    // Same page-level pin as script.js: <html data-force-lang="en">.
    // Single-language brand instances set it so auto-detection and any
    // previously saved manual choice can't flip their copy. Currency
    // detection is unaffected - only the language is pinned. The typeof
    // guard keeps this loadable in non-DOM contexts (unit tests).
    if (typeof document === "undefined") return "";
    const forced = document.documentElement?.dataset?.forceLang;
    return isKnownLanguage(forced) ? forced : "";
  }

  function getProfile() {
    const profile = detect();
    const forcedLanguage = getForcedLanguage();
    if (forcedLanguage) return { ...profile, language: forcedLanguage, locale: forcedLanguage === "ro" ? "ro-RO" : "en-GB" };
    const manualLanguage = getManualLanguage();
    if (manualLanguage) return { ...profile, language: manualLanguage, locale: manualLanguage === "ro" ? "ro-RO" : "en-GB" };
    return profile;
  }

  function getManualLanguage() {
    try {
      if (localStorage.getItem(LANGUAGE_SOURCE_KEY) !== "manual") return "";
      const value = localStorage.getItem(LANGUAGE_KEY);
      return isKnownLanguage(value) ? value : "";
    } catch {
      return "";
    }
  }

  function language() {
    return getProfile().language || defaultLanguageCode();
  }

  // Fallback chain: brand override (aether/brand-copy.js, if the page sets
  // one - highest priority, unchanged) -> DB override for the resolved
  // language -> code-defined baseline for it -> DB override for the
  // store's default language -> code-defined English baseline -> "" (never
  // the raw key - the permanent fix for the old "shows cart.shippingFree"
  // class of bug, not a per-key patch). ensureTranslationsLoaded is a cheap
  // no-op once a language's overrides are cached/in-flight; a fetch that
  // resolves later re-renders via the shared beca:locale-change event.
  function text(key, replacements = {}) {
    const lang = language();
    const defaultLang = defaultLanguageCode();
    ensureTranslationsLoaded(lang);
    if (defaultLang !== lang) ensureTranslationsLoaded(defaultLang);

    const brandOverride = window.__BRAND_COPY__?.[lang]?.[key];
    const dbOverride = translationOverrides[lang]?.[key];
    // No `|| dictionary.en` fallback here - a language with NO code-defined
    // dictionary at all (a real 3rd+ language; only en/ro ship one) must
    // still fall through to dbOverrideDefault below before landing on
    // English, not skip straight past it the way `dictionary[lang] ||
    // dictionary.en` would.
    const codeBaseline = dictionary[lang]?.[key];
    const dbOverrideDefault = translationOverrides[defaultLang]?.[key];
    const codeBaselineEn = dictionary.en[key];

    let value = brandOverride || dbOverride || codeBaseline || dbOverrideDefault || codeBaselineEn || "";
    Object.entries(replacements).forEach(([name, replacement]) => {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), replacement);
    });
    return value;
  }

  function translateCategory(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "tee") return text("tee");
    if (normalized === "piece") return text("piece");
    if (normalized === "drop") return text("drop");
    return value || text("piece");
  }

  function collectionKey(product) {
    const name = String(product?.name || "").toLowerCase();
    if (name.includes("golden hour")) return "golden";
    if (name.includes("aura bloom")) return "aura";
    if (name.includes("lonely mode")) return "lonely";
    if (name.includes("instinct")) return "instinct";
    if (name.includes("studio")) return "studio";
    return "";
  }

  // productTranslation(product, lang) looks up the NEW normalized
  // product_translations row (server.js's publicProduct embeds it as
  // product.translations) - the highest-priority source once an admin has
  // actually translated something, since it is what the current admin
  // form writes to. Everything below it (nameRo/descriptionRo/nameEn/
  // descriptionEn, then collectionDescriptions) is the pre-existing
  // fallback chain, kept exactly as it was for content that predates this
  // table - in particular collectionDescriptions.en still holds the only
  // real English copy for the 5 original seed products (their name_en/
  // description_en columns were always empty, a bug fixed this session
  // but with nothing to backfill from), so it is NOT retired even though
  // the RO half of that same data did get backfilled into product_translations.
  function productTranslation(product, lang) {
    return (product?.translations || []).find((entry) => entry.languageCode === lang);
  }

  function translateDescription(product) {
    if (!product) return "";
    const translated = productTranslation(product, language())?.description;
    if (translated) return translated;
    const key = collectionKey(product);
    const lang = language();
    if (lang === "ro" && product.descriptionRo) return product.descriptionRo;
    if (lang === "en" && product.descriptionEn) return product.descriptionEn;
    if (key && collectionDescriptions[lang]?.[key]) return collectionDescriptions[lang][key];
    return product.description || text("limitedFallback");
  }

  function displayProduct(product) {
    const lang = language();
    const translated = productTranslation(product, lang);
    return {
      ...product,
      displayName: translated?.name || (lang === "ro" ? (product.nameRo || product.name) : (product.nameEn || product.name)),
      displayDescription: translateDescription(product),
      displayShortDescription: translated?.shortDescription || "",
      displayCategory: product?.categoryTranslations?.[lang] || translateCategory(product.category || "Piece")
    };
  }

  function stockText(stock) {
    const count = Number(stock || 0);
    return count > 0 ? `${count} ${text("left")}` : text("soldOut");
  }

  function countText(count) {
    const amount = Number(count || 0);
    return `${amount} ${text(amount === 1 ? "pieceSingular" : "piecePlural")}`;
  }

  function itemCountText(count) {
    const amount = Number(count || 0);
    return `${amount} ${text(amount === 1 ? "itemSingular" : "itemPlural")}`;
  }

  function convert(value, fromCurrency = "GBP") {
    const amount = Number(value || 0);
    const profile = getProfile();
    const source = String(fromCurrency || "GBP").toUpperCase();

    if (profile.currency === source) return amount;
    if (source === "GBP" && profile.currency === "RON" && gbpToRonRate) return amount * gbpToRonRate;
    if (source === "RON" && profile.currency === "GBP" && gbpToRonRate) return amount / gbpToRonRate;
    return amount;
  }

  function money(value, fromCurrency = "GBP") {
    const profile = getProfile();
    const converted = convert(value, fromCurrency);

    // Admin-configured symbol/decimalPlaces (currency.js) whenever a row
    // exists for this currency - never Intl.NumberFormat's style:"currency"
    // directly against an admin-typed code, which throws a RangeError for
    // anything the JS engine's ICU data doesn't recognize (see currency.js's
    // own comment). Once currency.js has loaded real config, this covers
    // every currency the SAME safe way, GBP/RON included.
    const config = window.BecaCurrency?.getCurrencyConfig?.(profile.currency);
    if (config && window.BecaCurrency?.formatWithConfig) {
      return window.BecaCurrency.formatWithConfig(converted, config);
    }

    // currency.js not loaded yet, or no config row for this currency. GBP/
    // RON are the only two values detect() could ever produce before this
    // session's country_config-driven language resolution existed, and
    // both are real ISO codes Intl always recognizes - safe to keep the
    // exact original formatting for them. Anything else reaching this path
    // (a newly admin-added currency, before its config has loaded) gets the
    // same crash-proof plain fallback BecaCurrency.formatExact uses, rather
    // than risking a thrown RangeError on an unrecognized code.
    if (profile.currency === "GBP" || profile.currency === "RON") {
      const decimalPlaces = profile.currency === "RON" ? 0 : 2;
      return new Intl.NumberFormat(profile.locale, {
        style: "currency",
        currency: profile.currency,
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces
      }).format(converted);
    }
    return `${profile.currency} ${converted.toFixed(2)}`;
  }

  // The "option for two prices" hint: an always-on "and also ~X" secondary
  // price next to a browsing amount, independent of the visitor's detected
  // language (unlike money()'s PROFILE-mode swap, which shows ONE currency
  // based on who's looking). Admin-configured via the currencies panel
  // (Currency.displayRateFromDefault), not an env var. Only ever applied to
  // an amount already in the store's DEFAULT currency - a real per-country
  // resolved price is a real number, not something to pair with a second,
  // approximate one. Returns "" (never throws, never a raw NaN) whenever
  // nothing is configured or the pairing doesn't apply, so callers can
  // splice the result in unconditionally.
  function secondaryPriceText(amount, fromCurrency = "GBP") {
    const defaultCurrency = window.BecaCurrency?.getDefaultCurrency?.();
    const secondary = window.BecaCurrency?.getSecondaryCurrency?.();
    if (!defaultCurrency || !secondary) return "";
    if (String(fromCurrency || "").toUpperCase() !== defaultCurrency.code) return "";
    const rate = Number(secondary.displayRateFromDefault);
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return window.BecaCurrency.formatWithConfig(Number(amount || 0) * rate, secondary);
  }

  window.BecaRegion = {
    detect,
    getProfile,
    money,
    convert,
    language,
    text,
    translateCategory,
    displayProduct,
    stockText,
    countText,
    itemCountText,
    secondaryPriceText,
    setRates,
    getRates: () => ({ gbpToRon: gbpToRonRate, gbpToRonUpdatedAt }),
    setLanguages,
    setCountryConfig,
    setTranslations
  };

  loadRates();
  loadLanguages();
  loadCountryConfig();
})();
