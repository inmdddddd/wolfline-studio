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

const copy = {
  en: {
    "nav.drop": "Drop",
    "nav.quality": "Quality",
    "nav.contact": "Contact",
    "hero.kicker": "Fresh drops / limited pieces",
    "hero.title": "Fresh graphics on clean everyday silhouettes.",
    "hero.body": "Limited clothing and accessories built around sharp prints, strong contrast and a premium streetwear feel. Explore the 3D tee, then move into the latest drop.",
    "hero.primary": "Explore latest pieces",
    "hero.secondary": "Register",
    "hero.account": "My account",
    "auth.back": "Back",
    "auth.login.tab": "Login",
    "auth.register.tab": "Register",
    "auth.login.kicker": "Client access",
    "auth.login.title": "Login for drop access.",
    "auth.login.button": "Login",
    "auth.register.kicker": "Fresh drop account",
    "auth.register.title": "Register for early access.",
    "auth.register.button": "Create account",
    "auth.name": "Name",
    "auth.email": "Email",
    "auth.password": "Password",
    "quality.kicker": "Quality first",
    "quality.title": "Built to feel good, not just look good.",
    "quality.card1.title": "Clean blanks",
    "quality.card1.body": "Soft, structured pieces chosen for daily wear, layering and a stronger fit on body.",
    "quality.card2.title": "Print focus",
    "quality.card2.body": "Graphics are treated as the main object: balanced placement, sharp contrast and clear visual rhythm.",
    "quality.card3.title": "Limited runs",
    "quality.card3.body": "Drops stay tight, so each release feels intentional instead of mass-produced.",
    "design.kicker": "Design direction",
    "design.title": "New graphics, darker energy, wearable pieces.",
    "design.body": "Each release starts from a visual idea: symbol, mood, typography or texture. The goal is simple: pieces that feel fresh on launch day and still work months later.",
    "design.note1.title": "Fresh visuals",
    "design.note1.body": "Original artwork and print concepts for every drop.",
    "design.note2.title": "Easy styling",
    "design.note2.body": "Built around black, white and accent graphics that fit real outfits.",
    "drop.kicker": "Latest drop",
    "drop.title": "Preview the next release.",
    "drop.item1.meta": "Tee / graphic print",
    "drop.item1.title": "Oversized statement tee",
    "drop.item2.meta": "Accessory / limited",
    "drop.item2.title": "Drop-ready accessory",
    "drop.item3.meta": "Coming soon",
    "drop.item3.title": "Fresh print concept",
    "contact.kicker": "Stay close",
    "contact.title": "First look, early access, limited quantities.",
    "contact.button": "Register for drop access",
    "contact.account": "Open my account"
  },
  ro: {
    "nav.drop": "Drop",
    "nav.quality": "Calitate",
    "nav.contact": "Contact",
    "hero.kicker": "Drop-uri fresh / piese limitate",
    "hero.title": "Grafica fresh pe siluete curate de zi cu zi.",
    "hero.body": "Haine si accesorii limitate construite in jurul printurilor clare, contrastului puternic si unui feeling premium de streetwear. Exploreaza tricoul 3D, apoi intra in cel mai nou drop.",
    "hero.primary": "Exploreaza piesele",
    "hero.secondary": "Inregistreaza-te",
    "hero.account": "Contul meu",
    "auth.back": "Inapoi",
    "auth.login.tab": "Login",
    "auth.register.tab": "Inregistrare",
    "auth.login.kicker": "Acces client",
    "auth.login.title": "Intra pentru acces la drop.",
    "auth.login.button": "Intra in cont",
    "auth.register.kicker": "Cont pentru drop",
    "auth.register.title": "Inregistreaza-te pentru acces devreme.",
    "auth.register.button": "Creeaza cont",
    "auth.name": "Nume",
    "auth.email": "Email",
    "auth.password": "Parola",
    "quality.kicker": "Calitate prima data",
    "quality.title": "Facute sa se simta bine, nu doar sa arate bine.",
    "quality.card1.title": "Piese curate",
    "quality.card1.body": "Materiale moi si structurate, alese pentru purtare zilnica, layering si fit mai puternic pe corp.",
    "quality.card2.title": "Focus pe print",
    "quality.card2.body": "Grafica e tratata ca piesa centrala: pozitionare echilibrata, contrast clar si ritm vizual.",
    "quality.card3.title": "Serii limitate",
    "quality.card3.body": "Drop-urile raman restranse, ca fiecare lansare sa se simta intentionata, nu produsa in masa.",
    "design.kicker": "Directie de design",
    "design.title": "Grafica noua, energie dark, piese usor de purtat.",
    "design.body": "Fiecare lansare porneste de la o idee vizuala: simbol, mood, tipografie sau textura. Scopul e simplu: piese care se simt fresh la lansare si inca functioneaza luni mai tarziu.",
    "design.note1.title": "Vizual fresh",
    "design.note1.body": "Artwork original si concepte de print pentru fiecare drop.",
    "design.note2.title": "Usor de stilizat",
    "design.note2.body": "Construite in jurul negrului, albului si accentelor grafice care merg in outfituri reale.",
    "drop.kicker": "Cel mai nou drop",
    "drop.title": "Preview pentru urmatoarea lansare.",
    "drop.item1.meta": "Tricou / print grafic",
    "drop.item1.title": "Tricou oversized statement",
    "drop.item2.meta": "Accesoriu / limitat",
    "drop.item2.title": "Accesoriu pregatit pentru drop",
    "drop.item3.meta": "In curand",
    "drop.item3.title": "Concept fresh de print",
    "contact.kicker": "Ramai aproape",
    "contact.title": "Primul preview, acces devreme, cantitati limitate.",
    "contact.button": "Inregistreaza-te pentru drop",
    "contact.account": "Deschide contul meu"
  }
};

function detectLanguage() {
  const saved = localStorage.getItem("beca-language");
  if (saved === "ro" || saved === "en") {
    return saved;
  }

  const browserLanguage = navigator.language || "";
  const languages = navigator.languages || [browserLanguage];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const looksRomanian = languages.some((language) => language.toLowerCase().startsWith("ro")) || timeZone === "Europe/Bucharest";

  return looksRomanian ? "ro" : "en";
}

function setLanguage(language) {
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

  localStorage.setItem("beca-language", activeLanguage);
}

setLanguage(detectLanguage());
applyLiquidGlass();
let glassResizeTimer;

document.querySelectorAll("[data-lang]").forEach((button) => {
  button.addEventListener("click", () => {
    setLanguage(button.dataset.lang);
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
