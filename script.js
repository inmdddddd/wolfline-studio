const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let splineViewer = document.querySelector(".spline-scene");

function getGlassDisplacementMap({ height, width, radius, depth }) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg height="${height}" width="${width}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <style>.mix{mix-blend-mode:screen;}</style>
    <defs>
      <linearGradient id="Y" x1="0" x2="0" y1="${Math.ceil((radius / height) * 15)}%" y2="${Math.floor(100 - (radius / height) * 15)}%">
        <stop offset="0%" stop-color="#0F0" />
        <stop offset="100%" stop-color="#000" />
      </linearGradient>
      <linearGradient id="X" x1="${Math.ceil((radius / width) * 15)}%" x2="${Math.floor(100 - (radius / width) * 15)}%" y1="0" y2="0">
        <stop offset="0%" stop-color="#F00" />
        <stop offset="100%" stop-color="#000" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" height="${height}" width="${width}" fill="#808080" />
    <g filter="blur(2px)">
      <rect x="0" y="0" height="${height}" width="${width}" fill="#000080" />
      <rect x="0" y="0" height="${height}" width="${width}" fill="url(#Y)" class="mix" />
      <rect x="0" y="0" height="${height}" width="${width}" fill="url(#X)" class="mix" />
      <rect x="${depth}" y="${depth}" height="${Math.max(0, height - 2 * depth)}" width="${Math.max(0, width - 2 * depth)}" fill="#808080" rx="${radius}" ry="${radius}" filter="blur(${depth}px)" />
    </g>
  </svg>`);
}

function getGlassDisplacementFilter({ height, width, radius, depth, strength, chromaticAberration }) {
  const map = getGlassDisplacementMap({ height, width, radius, depth });
  return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg height="${height}" width="${width}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="displace" color-interpolation-filters="sRGB">
        <feImage x="0" y="0" height="${height}" width="${width}" href="${map}" result="displacementMap" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale="${strength + chromaticAberration * 2}" xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="displacedR" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale="${strength + chromaticAberration}" xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="displacedG" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale="${strength}" xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="displacedB" />
        <feBlend in="displacedR" in2="displacedG" mode="screen" />
        <feBlend in2="displacedB" mode="screen" />
      </filter>
    </defs>
  </svg>`) + "#displace";
}

function applyLiquidGlass() {
  const glassElements = document.querySelectorAll(".beca-hero-copy, .beca-actions a, .language-switch, .floating-cart-button, .cart-drawer-panel, .product-card");

  glassElements.forEach((element) => {
    const isButton = element.matches(".beca-actions a, .language-switch, .floating-cart-button");
    const value = `blur(${isButton ? 16 : 22}px) saturate(${isButton ? 1.28 : 1.38}) brightness(${isButton ? 1.08 : 1.04})`;
    element.classList.add("liquid-glass-real");
    element.style.backdropFilter = value;
    element.style.webkitBackdropFilter = value;
  });
}

const defaultCopy = {
  en: {
    "nav.drop": "Drop",
    "nav.quality": "Craft",
    "nav.contact": "Contact",
    "hero.kicker": "Drop 001 — strictly limited",
    "hero.title": "The next drop is loading. Get in before it's gone.",
    "hero.body": "Bold prints, heavyweight cotton, capped numbers — no restocks, ever. Spin the 3D tee, then lock in early access before the public launch.",
    "hero.primary": "See the drop",
    "hero.secondary": "Get early access",
    "hero.account": "My account",
    "auth.back": "Back",
    "auth.login.tab": "Login",
    "auth.register.tab": "Register",
    "auth.login.kicker": "Client access",
    "auth.combo.title": "Login or register for drops.",
    "auth.login.title": "Login for drop access.",
    "auth.login.button": "Login",
    "auth.register.kicker": "Fresh drop account",
    "auth.register.title": "Register for early access.",
    "auth.register.button": "Create account",
    "auth.name": "Name",
    "auth.email": "Email",
    "auth.password": "Password",
    "cart.title": "Cart",
    "cart.close": "Close",
    "cart.name": "Name",
    "cart.email": "Email",
    "cart.phone": "Phone",
    "cart.address": "Address",
    "cart.checkout": "Checkout",
    "cart.backToCart": "Back to cart",
    "cart.placeOrder": "Place order",
    "previewOnly": "preview",
    "notifyMe": "Notify me when available",
    "notifySaved": "You are on the list.",
    "notifySavedShort": "On the list",
    "mobile.close": "Close",
    "quality.kicker": "No shortcuts",
    "quality.title": "Built to hit different, not just look different.",
    "quality.card1.title": "Heavyweight blanks",
    "quality.card1.body": "Structured, soft cotton picked for daily wear, layering and a fit that actually holds up.",
    "quality.card2.title": "Print-first design",
    "quality.card2.body": "Every graphic is the main character: balanced placement, sharp contrast, zero clutter.",
    "quality.card3.title": "Capped runs",
    "quality.card3.body": "We print tight numbers on purpose. When a drop is gone, it's gone for good.",
    "design.kicker": "Design direction",
    "design.title": "New graphics. Darker energy. Pieces you'll actually wear.",
    "design.body": "Every release starts from one idea — a symbol, a mood, a typeface. The goal: pieces that hit on launch day and still go months later.",
    "design.note1.title": "Original artwork",
    "design.note1.body": "Every print is designed in-house, drop by drop. Nothing recycled, nothing generic.",
    "design.note2.title": "Easy to style",
    "design.note2.body": "Built around black, white and sharp accent graphics that slot into fits you already wear.",
    "drop.kicker": "Next drop",
    "drop.title": "First look before it goes public.",
    "drop.countdownLabel": "Drop unlocks in",
    "drop.countdownValue": "11 days",
    "drop.item1.meta": "Tee / graphic print",
    "drop.item1.title": "Oversized statement tee",
    "drop.item2.meta": "Accessory / limited",
    "drop.item2.title": "Drop-ready accessory",
    "drop.item3.meta": "Locked for now",
    "drop.item3.title": "Next print, coming soon",
    "contact.kicker": "Don't miss it",
    "contact.title": "First access. Capped numbers. No restocks.",
    "contact.button": "Get early access",
    "contact.account": "Open my account",
    "footer.tagline": "Strictly limited streetwear, made in Romania.",
    "footer.company": "Company",
    "footer.help": "Help",
    "footer.legal": "Legal",
    "footer.about": "About us",
    "footer.faq": "FAQ",
    "footer.support": "Support",
    "footer.terms": "Terms & conditions",
    "footer.privacy": "Privacy policy",
    "footer.rights": "All rights reserved.",
    "account.home": "Home",
    "account.admin": "Admin Panel",
    "account.logout": "Logout",
    "account.kicker": "Customer area",
    "account.welcome": "Welcome back,",
    "account.lead": "Your spot for early access, first-look drops and pieces reserved before they go public.",
    "account.memberStatus": "Member status",
    "account.profile": "Profile",
    "account.access": "Access",
    "account.accessValue": "Early drop list",
    "account.preference": "Preference",
    "account.preferenceValue": "Graphic tees / accessories",
    "account.settings": "Settings",
    "account.profileDetails": "Profile details",
    "account.name": "Name",
    "account.saveProfile": "Save profile",
    "account.security": "Security",
    "account.password": "Password",
    "account.currentPassword": "Current password",
    "account.newPassword": "New password",
    "account.updatePassword": "Update password",
    "account.nextDrop": "Next drop",
    "account.nextTitle": "Oversized statement tee",
    "account.previewUnlocked": "Preview unlocked",
    "account.nextBody": "Fresh print direction, capped quantity and first access before the public drop.",
    "account.viewDrop": "View drop preview",
    "account.perks": "Member perks",
    "account.perk1": "Early access before public release.",
    "account.perk2": "Private notes on fit, fabric and print direction.",
    "account.perk3": "Priority on limited pieces when stock runs low.",
    "account.activity": "Activity",
    "account.created": "Account created",
    "account.activeProfile": "Active customer profile",
    "account.nextStep": "Next step",
    "account.watchDrop": "Watch the upcoming drop"
  },
  ro: {
    "nav.drop": "Drop",
    "nav.quality": "Calitate",
    "nav.contact": "Contact",
    "hero.kicker": "Drop 001 — editie strict limitata",
    "hero.title": "Urmatorul drop se incarca. Prinde-l inainte sa dispara.",
    "hero.body": "Printuri indraznete, bumbac gros, numere limitate — fara restock, niciodata. Roteste tricoul 3D, apoi asigura-ti accesul devreme inainte de lansarea publica.",
    "hero.primary": "Vezi dropul",
    "hero.secondary": "Acces devreme",
    "hero.account": "Contul meu",
    "auth.back": "Inapoi",
    "auth.login.tab": "Login",
    "auth.register.tab": "Inregistrare",
    "auth.login.kicker": "Acces client",
    "auth.combo.title": "Login sau inregistrare pentru drop-uri.",
    "auth.login.title": "Intra pentru acces la drop.",
    "auth.login.button": "Intra in cont",
    "auth.register.kicker": "Cont pentru drop",
    "auth.register.title": "Inregistreaza-te pentru acces devreme.",
    "auth.register.button": "Creeaza cont",
    "auth.name": "Nume",
    "auth.email": "Email",
    "auth.password": "Parola",
    "cart.title": "Cos",
    "cart.close": "Inchide",
    "cart.name": "Nume",
    "cart.email": "Email",
    "cart.phone": "Telefon",
    "cart.address": "Adresa",
    "cart.checkout": "Checkout",
    "cart.backToCart": "Inapoi la cos",
    "cart.placeOrder": "Plaseaza comanda",
    "previewOnly": "preview",
    "notifyMe": "Anunta-ma cand e disponibil",
    "notifySaved": "Esti pe lista.",
    "notifySavedShort": "Pe lista",
    "mobile.close": "Inchide",
    "quality.kicker": "Fara compromisuri",
    "quality.title": "Facute sa loveasca altfel, nu doar sa arate altfel.",
    "quality.card1.title": "Materiale grele, de calitate",
    "quality.card1.body": "Bumbac moale si structurat, ales pentru purtare zilnica, layering si un fit care rezista.",
    "quality.card2.title": "Printul e vedeta",
    "quality.card2.body": "Fiecare grafica e personajul principal: pozitionare echilibrata, contrast puternic, zero aglomerare.",
    "quality.card3.title": "Serii limitate, cu adevarat",
    "quality.card3.body": "Printam numere mici intentionat. Cand un drop s-a terminat, s-a terminat definitiv.",
    "design.kicker": "Directie de design",
    "design.title": "Grafica noua. Energie mai dark. Piese pe care chiar le porti.",
    "design.body": "Fiecare lansare porneste de la o singura idee — un simbol, o stare, o tipografie. Scopul: piese care lovesc tare la lansare si inca functioneaza luni mai tarziu.",
    "design.note1.title": "Artwork original",
    "design.note1.body": "Fiecare print e desenat in casa, drop cu drop. Nimic reciclat, nimic generic.",
    "design.note2.title": "Usor de stilizat",
    "design.note2.body": "Construite in jurul negrului, albului si accentelor grafice care merg in orice outfit.",
    "drop.kicker": "Urmatorul drop",
    "drop.title": "Primul preview, inainte sa devina public.",
    "drop.countdownLabel": "Se deblocheaza in",
    "drop.countdownValue": "11 zile",
    "drop.item1.meta": "Tricou / print grafic",
    "drop.item1.title": "Tricou oversized statement",
    "drop.item2.meta": "Accesoriu / limitat",
    "drop.item2.title": "Accesoriu pregatit pentru drop",
    "drop.item3.meta": "Inca blocat",
    "drop.item3.title": "Urmatorul print, in curand",
    "contact.kicker": "Nu rata",
    "contact.title": "Acces devreme. Numere limitate. Fara restock.",
    "contact.button": "Acces devreme",
    "contact.account": "Deschide contul meu",
    "footer.tagline": "Streetwear in editie strict limitata, facut in Romania.",
    "footer.company": "Companie",
    "footer.help": "Ajutor",
    "footer.legal": "Legal",
    "footer.about": "Despre noi",
    "footer.faq": "Intrebari frecvente",
    "footer.support": "Suport",
    "footer.terms": "Termeni si conditii",
    "footer.privacy": "Confidentialitate",
    "footer.rights": "Toate drepturile rezervate.",
    "account.home": "Acasa",
    "account.admin": "Panou admin",
    "account.logout": "Iesire",
    "account.kicker": "Zona client",
    "account.welcome": "Bine ai revenit,",
    "account.lead": "Locul tau pentru acces devreme, preview-uri exclusive si piese rezervate inainte sa devina publice.",
    "account.memberStatus": "Status membru",
    "account.profile": "Profil",
    "account.access": "Acces",
    "account.accessValue": "Lista de drop devreme",
    "account.preference": "Preferinta",
    "account.preferenceValue": "Tricouri grafice / accesorii",
    "account.settings": "Setari",
    "account.profileDetails": "Detalii profil",
    "account.name": "Nume",
    "account.saveProfile": "Salveaza profilul",
    "account.security": "Securitate",
    "account.password": "Parola",
    "account.currentPassword": "Parola actuala",
    "account.newPassword": "Parola noua",
    "account.updatePassword": "Actualizeaza parola",
    "account.nextDrop": "Urmatorul drop",
    "account.nextTitle": "Tricou oversized statement",
    "account.previewUnlocked": "Preview deblocat",
    "account.nextBody": "Directie de print fresh, cantitate limitata si primul acces inainte de lansarea publica.",
    "account.viewDrop": "Vezi preview-ul dropului",
    "account.perks": "Beneficii membru",
    "account.perk1": "Acces devreme inainte de lansarea publica.",
    "account.perk2": "Note private despre fit, material si directia printului.",
    "account.perk3": "Prioritate pentru piese limitate cand stocul e pe terminate.",
    "account.activity": "Activitate",
    "account.created": "Cont creat",
    "account.activeProfile": "Profil client activ",
    "account.nextStep": "Urmatorul pas",
    "account.watchDrop": "Urmareste urmatorul drop"
  }
};

let copy = defaultCopy;

const DROP_UNLOCK_AT = new Date("2026-07-16T20:00:00+03:00").getTime();

function formatDropCountdown(language) {
  const remaining = Math.max(0, DROP_UNLOCK_AT - Date.now());
  if (!remaining) return language === "ro" ? "deblocat" : "unlocked";

  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.ceil(remaining / 3600000);
  const days = Math.ceil(remaining / 86400000);

  if (days > 1) return language === "ro" ? `${days} zile` : `${days} days`;
  if (days === 1) return language === "ro" ? "1 zi" : "1 day";
  if (hours > 1) return language === "ro" ? `${hours} ore` : `${hours} hours`;
  if (hours === 1) return language === "ro" ? "1 ora" : "1 hour";
  if (minutes > 1) return language === "ro" ? `${minutes} minute` : `${minutes} minutes`;
  return language === "ro" ? "sub 1 minut" : "under 1 minute";
}

function updateDropCountdown() {
  const language = document.documentElement.lang === "ro" ? "ro" : "en";
  document.querySelectorAll("[data-drop-countdown]").forEach((element) => {
    element.textContent = formatDropCountdown(language);
  });
}

function detectLanguage() {
  const saved = localStorage.getItem("beca-language");
  const source = localStorage.getItem("beca-language-source");
  if (source === "manual" && (saved === "ro" || saved === "en")) {
    return saved;
  }

  const profile = window.BecaRegion?.detect?.();
  if (profile?.language) return profile.language;

  return "en";
}

function setLanguage(language, options = {}) {
  const activeLanguage = copy[language] ? language : "en";
  document.documentElement.lang = activeLanguage;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (copy[activeLanguage][key]) {
      element.textContent = copy[activeLanguage][key];
    }
  });

  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === activeLanguage));
  });

  document.querySelectorAll("[data-optional-if-empty]").forEach((element) => {
    const key = element.dataset.optionalIfEmpty;
    element.hidden = !copy[activeLanguage][key];
  });

  document.querySelectorAll("[data-i18n-mailto]").forEach((element) => {
    const key = element.dataset.i18nMailto;
    const value = copy[activeLanguage][key];
    if (value) element.href = `mailto:${value}`;
  });

  if (options.source === "manual") {
    localStorage.setItem("beca-language", activeLanguage);
    localStorage.setItem("beca-language-source", "manual");
  }
  updateDropCountdown();
  window.dispatchEvent(new CustomEvent("beca:locale-change", { detail: { language: activeLanguage } }));
}

setLanguage(detectLanguage(), { source: "auto" });
window.setInterval(updateDropCountdown, 60000);
applyLiquidGlass();

function applyBrandingImages(branding) {
  if (!branding) return;
  document.querySelectorAll("[data-content-img]").forEach((element) => {
    const key = element.dataset.contentImg;
    if (branding[key]) element.src = branding[key];
  });
}

fetch("/api/content")
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => {
    if (!data) return;
    copy = {
      en: { ...defaultCopy.en, ...data.en },
      ro: { ...defaultCopy.ro, ...data.ro }
    };
    setLanguage(detectLanguage(), { source: "auto" });
    applyBrandingImages(data.branding);
  })
  .catch(() => {});
let glassResizeTimer;

document.querySelectorAll("[data-lang]").forEach((button) => {
  button.addEventListener("click", () => {
    setLanguage(button.dataset.lang, { source: "manual" });
    requestAnimationFrame(applyLiquidGlass);
  });
});

const heroAccess = document.querySelector("#heroAccess");

function setHeroAuthMode(mode = "register") {
  if (!heroAccess) return;

  const activeMode = mode === "login" ? "login" : "register";
  document.body.dataset.heroAuth = activeMode;
  document.body.classList.remove("is-auth-transitioning");
  void document.body.offsetWidth;
  document.body.classList.add("is-auth-transitioning");
  window.setTimeout(() => document.body.classList.remove("is-auth-transitioning"), 920);
  heroAccess.dataset.authMode = activeMode;
  heroAccess.querySelector("[data-hero-view='intro']")?.classList.remove("is-active");
  const authView = heroAccess.querySelector("[data-hero-view='auth']");
  authView?.classList.add("is-active");
  authView?.setAttribute("aria-hidden", "false");

  heroAccess.querySelectorAll("[data-auth-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.authPanel === activeMode);
  });

  heroAccess.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authTab === activeMode));
  });

  heroAccess.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function closeHeroAuth() {
  if (!heroAccess) return;

  document.body.removeAttribute("data-hero-auth");
  document.body.classList.remove("is-auth-transitioning");
  heroAccess.removeAttribute("data-auth-mode");
  heroAccess.querySelector("[data-hero-view='intro']")?.classList.add("is-active");
  const authView = heroAccess.querySelector("[data-hero-view='auth']");
  authView?.classList.remove("is-active");
  authView?.setAttribute("aria-hidden", "true");
}

document.querySelectorAll("[data-auth-open]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    setHeroAuthMode(trigger.dataset.authOpen);
  });
});

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setHeroAuthMode(button.dataset.authTab));
});

document.querySelector("[data-auth-close]")?.addEventListener("click", closeHeroAuth);

const mobileMenu = document.querySelector("[data-mobile-menu]");
const mobileMenuOpen = document.querySelector("[data-mobile-menu-open]");

function setMobileMenu(open) {
  if (!mobileMenu || !mobileMenuOpen) return;
  document.body.classList.toggle("is-mobile-menu-open", open);
  mobileMenu.classList.toggle("is-open", open);
  mobileMenu.setAttribute("aria-hidden", String(!open));
  mobileMenuOpen.setAttribute("aria-expanded", String(open));
}

mobileMenuOpen?.addEventListener("click", () => setMobileMenu(true));

document.querySelectorAll("[data-mobile-menu-close], [data-mobile-menu-link]").forEach((element) => {
  element.addEventListener("click", () => setMobileMenu(false));
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMobileMenu(false);
});

if (location.hash === "#login" || location.hash === "#register") {
  window.requestAnimationFrame(() => setHeroAuthMode(location.hash.slice(1)));
}

window.addEventListener("hashchange", () => {
  if (location.hash === "#login" || location.hash === "#register") {
    setHeroAuthMode(location.hash.slice(1));
  }
});

window.addEventListener("resize", () => {
  window.clearTimeout(glassResizeTimer);
  glassResizeTimer = window.setTimeout(() => {
    window.requestAnimationFrame(applyLiquidGlass);
  }, 160);
}, { passive: true });

if (splineViewer && !prefersReducedMotion) {
  const splineSource = splineViewer.getAttribute("url");
  let splineWasResetAtTop = true;
  const sceneFrames = [
    { p: 0, x: 6, y: 4, scale: 0.9, rotate: -1, brightness: 1.08, saturation: 1.72 },
    { p: 0.16, x: 4, y: 8, scale: 0.96, rotate: 0, brightness: 1.1, saturation: 1.76 },
    { p: 0.32, x: -4, y: 12, scale: 1.02, rotate: 2, brightness: 1.13, saturation: 1.8 },
    { p: 0.48, x: 6, y: 18, scale: 1.08, rotate: 5, brightness: 1.16, saturation: 1.82 },
    { p: 0.64, x: -3, y: 14, scale: 1.14, rotate: 8, brightness: 1.12, saturation: 1.8 },
    { p: 0.78, x: 8, y: 10, scale: 1.2, rotate: 11, brightness: 1.15, saturation: 1.82 },
    { p: 0.9, x: -7, y: 20, scale: 1.26, rotate: 15, brightness: 1.1, saturation: 1.86 },
    { p: 1, x: 4, y: 16, scale: 1.32, rotate: 18, brightness: 1.08, saturation: 1.88 },
  ];
  let targetProgress = 0;
  let currentProgress = 0;
  let splineAnimationRunning = false;
  let splineScrollQueued = false;

  function easeProgress(value) {
    return value * value * (3 - 2 * value);
  }

  function mix(start, end, amount) {
    return start + (end - start) * amount;
  }

  function readSceneFrame(progress) {
    for (let index = 0; index < sceneFrames.length - 1; index += 1) {
      const current = sceneFrames[index];
      const next = sceneFrames[index + 1];

      if (progress >= current.p && progress <= next.p) {
        const local = easeProgress((progress - current.p) / (next.p - current.p));

        return {
          x: mix(current.x, next.x, local),
          y: mix(current.y, next.y, local),
          scale: mix(current.scale, next.scale, local),
          rotate: mix(current.rotate, next.rotate, local),
          brightness: mix(current.brightness, next.brightness, local),
          saturation: mix(current.saturation, next.saturation, local),
        };
      }
    }

    return sceneFrames[sceneFrames.length - 1];
  }

  function resetSplineViewer() {
    if (!splineViewer || !splineSource) return;

    const freshViewer = splineViewer.cloneNode(false);
    freshViewer.setAttribute("url", splineSource);
    freshViewer.removeAttribute("events-target");
    splineViewer.replaceWith(freshViewer);
    splineViewer = freshViewer;
    splineWasResetAtTop = true;
    currentProgress = 0;
    targetProgress = 0;
  }

  function updateSplineTarget() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    targetProgress = window.scrollY < 40 ? 0 : Math.min(1, Math.max(0, window.scrollY / maxScroll));

    if (targetProgress === 0 && !splineWasResetAtTop) {
      resetSplineViewer();
    } else if (targetProgress > 0.02) {
      splineWasResetAtTop = false;
    }

    startSplineAnimation();
  }

  function startSplineAnimation() {
    if (splineAnimationRunning) return;
    splineAnimationRunning = true;
    requestAnimationFrame(animateSplineScene);
  }

  function animateSplineScene() {
    const isReturning = targetProgress < currentProgress;
    const easing = targetProgress === 0 ? 0.42 : isReturning ? 0.18 : 0.026;
    currentProgress += (targetProgress - currentProgress) * easing;

    if (Math.abs(targetProgress - currentProgress) < 0.0016) {
      currentProgress = targetProgress;
    }

    if (targetProgress === 0 && currentProgress < 0.018) {
      currentProgress = 0;
    }

    const frame = readSceneFrame(currentProgress);
    const viewportUnit = Math.min(window.innerWidth, window.innerHeight) / 100;

    splineViewer.style.setProperty("--spline-x", `${(frame.x * viewportUnit).toFixed(2)}px`);
    splineViewer.style.setProperty("--spline-y", `${(frame.y * viewportUnit).toFixed(2)}px`);
    splineViewer.style.setProperty("--spline-scale", frame.scale.toFixed(3));
    splineViewer.style.setProperty("--spline-rotate", `${frame.rotate.toFixed(2)}deg`);
    splineViewer.style.setProperty("--spline-brightness", frame.brightness.toFixed(3));
    splineViewer.style.setProperty("--spline-saturation", frame.saturation.toFixed(3));

    if (Math.abs(targetProgress - currentProgress) > 0.001) {
      requestAnimationFrame(animateSplineScene);
    } else {
      splineAnimationRunning = false;
    }
  }

  updateSplineTarget();
  window.addEventListener("scroll", () => {
    if (splineScrollQueued) return;
    splineScrollQueued = true;
    requestAnimationFrame(() => {
      splineScrollQueued = false;
      updateSplineTarget();
    });
  }, { passive: true });
  window.addEventListener("resize", updateSplineTarget);
  startSplineAnimation();
}

if (!prefersReducedMotion) {
  let cursorQueued = false;
  let cursorX = 0;
  let cursorY = 0;

  window.addEventListener("pointermove", (event) => {
    cursorX = event.clientX;
    cursorY = event.clientY;

    if (cursorQueued) return;
    cursorQueued = true;

    requestAnimationFrame(() => {
      cursorQueued = false;
      document.documentElement.style.setProperty("--cursor-x", `${cursorX}px`);
      document.documentElement.style.setProperty("--cursor-y", `${cursorY}px`);
    });
  }, { passive: true });
}
