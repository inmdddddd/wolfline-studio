// ÆTHER ORIGIN copy overrides. Loaded BEFORE locale.js/script.js on every
// aether page; both engines merge window.__BRAND_COPY__ over their default
// dictionaries (missing keys fall through, other brands are untouched).
//
// Voice rules (from the brand strategy): ritual, precise, austere. No
// e-commerce cliches, no invented guarantees. An edition that sells out is
// closed permanently - never "back in stock". Loading/error states speak
// plainly, without technical jargon.
window.__BRAND_COPY__ = {
  en: {
    // Scarcity: sold out means closed forever. "Notify me" only ever refers
    // to a chapter that has not opened yet - never to a restock.
    soldOut: "edition closed",
    notifyMe: "Notify me at the unveiling",
    notifySaved: "Your name is recorded.",
    notifySavedShort: "Recorded",
    previewReason: "Enter your name for access before the chapter opens. Fixed quantity.",
    dropUnlocks: "The chapter opens soon",

    // Quiet, non-technical loading and error states.
    productsLoadFailed: "The sanctuary could not be reached. Reload to try again.",
    productMissing: "This piece is not in the record.",
    noLivePieces: "The sanctuary is between chapters.",
    noPieces: "Nothing is held yet.",
    limitedFallback: "A fragment from the current chapter.",
    "thankYou.loading": "Preparing your record…",

    // Trust strip: only claims this build can actually keep. Shipping and
    // return terms mirror shipping.html / returns.html; the third line
    // states the brand's real differentiator instead of an unverifiable
    // "100% secure payment" boast.
    "trust.shipping": "Dispatched in 2–5 working days",
    "trust.returns": "14-day right of return",
    "trust.payment": "Fixed, numbered editions",

    // Footer tagline (pages that render it via i18n).
    "footer.tagline": "Cut once. Numbered once. Never again.",
    "footer.about": "About",
    "footer.privacy": "Privacy"
  }
};
