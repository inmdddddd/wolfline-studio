(function () {
  const GBP_TO_RON = 5.85;
  const LANGUAGE_KEY = "beca-language";
  const LANGUAGE_SOURCE_KEY = "beca-language-source";

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
      "status.cancelled": "Cancelled"
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
      unknownYet: "Unknown yet",
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
      "status.cancelled": "Anulata"
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

  function detect() {
    const timeZone = getTimeZone();
    const offset = getUtcOffsetHours();
    const languages = navigator.languages || [navigator.language || ""];
    const browserIsRomanian = languages.some((language) => language.toLowerCase().startsWith("ro"));

    if (timeZone === "Europe/Bucharest" || browserIsRomanian) {
      return {
        country: "RO",
        language: "ro",
        currency: "RON",
        locale: "ro-RO",
        rateFromGBP: GBP_TO_RON
      };
    }

    if (timeZone === "Europe/London" || offset <= 1) {
      return {
        country: "UK",
        language: "en",
        currency: "GBP",
        locale: "en-GB",
        rateFromGBP: 1
      };
    }

    return {
      country: "UK",
      language: "en",
      currency: "GBP",
      locale: "en-GB",
      rateFromGBP: 1
    };
  }

  function getForcedLanguage() {
    // Same page-level pin as script.js: <html data-force-lang="en">.
    // Single-language brand instances set it so auto-detection and any
    // previously saved manual choice can't flip their copy. Currency
    // detection is unaffected - only the language is pinned. The typeof
    // guard keeps this loadable in non-DOM contexts (unit tests).
    if (typeof document === "undefined") return "";
    const forced = document.documentElement?.dataset?.forceLang;
    return forced === "ro" || forced === "en" ? forced : "";
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
      return value === "ro" || value === "en" ? value : "";
    } catch {
      return "";
    }
  }

  function language() {
    return getProfile().language || "en";
  }

  function text(key, replacements = {}) {
    const lang = language();
    const overrides = window.__BRAND_COPY__?.[lang] || {};
    const pack = dictionary[lang] || dictionary.en;
    let value = overrides[key] || pack[key] || dictionary.en[key] || key;
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

  function translateDescription(product) {
    if (!product) return "";
    const key = collectionKey(product);
    const lang = language();
    if (lang === "ro" && product.descriptionRo) return product.descriptionRo;
    if (lang === "en" && product.descriptionEn) return product.descriptionEn;
    if (key && collectionDescriptions[lang]?.[key]) return collectionDescriptions[lang][key];
    return product.description || text("limitedFallback");
  }

  function displayProduct(product) {
    const lang = language();
    return {
      ...product,
      displayName: lang === "ro" ? (product.nameRo || product.name) : (product.nameEn || product.name),
      displayDescription: translateDescription(product),
      displayCategory: translateCategory(product.category || "Piece")
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

  function convert(value, fromCurrency = "GBP") {
    const amount = Number(value || 0);
    const profile = getProfile();
    const source = String(fromCurrency || "GBP").toUpperCase();

    if (profile.currency === source) return amount;
    if (source === "GBP" && profile.currency === "RON") return amount * profile.rateFromGBP;
    if (source === "RON" && profile.currency === "GBP") return amount / GBP_TO_RON;
    return amount;
  }

  function money(value, fromCurrency = "GBP") {
    const profile = getProfile();
    const converted = convert(value, fromCurrency);
    return new Intl.NumberFormat(profile.locale, {
      style: "currency",
      currency: profile.currency,
      maximumFractionDigits: profile.currency === "RON" ? 0 : 2
    }).format(converted);
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
    countText
  };
})();
