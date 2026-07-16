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
    "checkout.trustNote": "Your details are encrypted and used only to process this order.",
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
    "design.title": "New graphics. Bold energy. Pieces you'll actually wear.",
    "design.body": "Every release starts from one idea — a symbol, a mood, a typeface. The goal: pieces that hit on launch day and still go months later.",
    "design.note1.title": "Original artwork",
    "design.note1.body": "Every print is designed in-house, drop by drop. Nothing recycled, nothing generic.",
    "design.note2.title": "Easy to style",
    "design.note2.body": "Built around black, white and sharp accent graphics that slot into fits you already wear.",
    "drop.kicker": "Next drop",
    "drop.title": "First look before it goes public.",
    "drop.item1.meta": "Tee / graphic print",
    "drop.item1.title": "Oversized statement tee",
    "drop.item2.meta": "Accessory / limited",
    "drop.item2.title": "Drop-ready accessory",
    "drop.item3.meta": "Locked for now",
    "drop.item3.title": "Next print, coming soon",
    "story.kicker": "The story",
    "story.title": "One obsession: graphics that don't look mass-produced.",
    "story.body": "BeCa started with a simple idea: streetwear could be more original than what's on every rack. Every print is drawn in-house, every run is capped on purpose, and every piece ships from Romania in small, deliberate batches — not a warehouse full of the same shirt.",
    "story.cta": "Read the full story",
    "trust.shipping": "Ships in 2–5 business days",
    "trust.returns": "Easy 14-day returns",
    "trust.payment": "100% secure payment",
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
    "footer.returns": "Returns",
    "footer.shipping": "Shipping",
    "footer.cookies": "Cookies",
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
  ,

    // --- page copy (about / faq / support / product / auth / legal) ---
    "about.hero.kicker": "Our story",
    "about.hero.title": "About BeCa.",
    "about.hero.lede": "One vision: original graphics, limited runs, made for people who want what the mainstream doesn't have.",
    "about.s1.title": "Who we are",
    "about.s1.body1": "BeCa is a Romanian streetwear brand born from a passion for graphic design and urban fashion. Every piece starts as a visual idea — a symbol, a mood, a typeface — and turns into a tee you wear with confidence. The brand system and the 3D shopping experience were built by Wolfline Studio.",
    "about.s1.body2": "We don't do mass production. Every drop is limited in numbers, so each piece stays special.",
    "about.s2.title": "What sets us apart",
    "about.card1.title": "Original design",
    "about.card1.body": "Every graphic is made in house, never pulled from generic stock libraries.",
    "about.card2.title": "Limited runs",
    "about.card2.body": "When a drop sells out, it is never remade the same way. What you wear stays rare.",
    "about.card3.title": "Real quality",
    "about.card3.body": "Fabrics chosen for everyday wear, not just for one photo.",
    "about.cta.title": "Want to be the first to hear about a new drop?",
    "about.cta.button": "Register for access",
    "account.orders": "My orders",
    "account.verifyBanner": "Your account isn't verified yet. Check your email for the confirmation link.",
    "account.resendVerification": "Resend email",
    "account.wishlist": "Wishlist",
    "account.wishlistTitle": "Saved pieces",
    "account.wishlistEmpty": "No saved pieces yet.",
    "faq.hero.kicker": "Quick help",
    "faq.hero.title": "Frequently asked questions.",
    "faq.hero.lede": "Answers to what our customers ask us most often.",
    "faq.q1": "How long does delivery take?",
    "faq.a1": "Orders are usually processed in 1-3 working days and delivered in 2-5 working days, depending on your location.",
    "faq.q2": "What sizes do you have?",
    "faq.a2": "Most pieces come in S, M, L and XL. The exact stock for each size is shown right on the product page.",
    "faq.q3": "Can I return or exchange an order?",
    "faq.a3": "Yes. You have 14 calendar days from receiving the parcel to request a return or exchange, as required by law. Write to our support address with your order number.",
    "faq.q4": "What payment methods do you accept?",
    "faq.a4": "We accept online card payment and, in some areas, cash on delivery.",
    "faq.q5": "How do I find out when a new drop lands?",
    "faq.a5": "Register on the site — your account gets priority access to new drops, before the public launch.",
    "faq.q6": "What if the piece I want is sold out?",
    "faq.a6": "You can press \"Notify me when available\" on the product page and pick your size — we'll let you know if it comes back in stock.",
    "faq.cta.title": "Didn't find the answer you were looking for?",
    "faq.cta.button": "Contact the support team",
    "auth.forgot.kicker": "Client access",
    "auth.forgot.title": "Reset your password.",
    "auth.forgot.button": "Send reset link",
    "auth.backToLogin": "Back to login",
    "auth.forgotPassword": "Forgot password?",
    "auth.reset.kicker": "Client access",
    "auth.reset.title": "Choose a new password.",
    "auth.reset.newPassword": "New password",
    "auth.reset.button": "Set new password",
    "cart.coupon": "Discount code (optional)",
    "privacy.hero.kicker": "Legal",
    "privacy.hero.title": "Privacy policy.",
    "privacy.hero.lede": "Last updated: 5 July 2026. We explain what data we collect, why, and what rights you have over it.",
    "privacy.s1.title": "1. Who the data controller is",
    "privacy.s1.body": "[LEGAL_COMPANY_NAME], a company registered in the United Kingdom, Companies House registration number [LEGAL_REGISTRATION_NUMBER], with its registered office at [LEGAL_COMPANY_ADDRESS], is the controller of the personal data collected through this site. For any question about your data, write to us at contact@beca-wlf.com.",
    "privacy.s2.title": "2. What data we collect",
    "privacy.s2.body": "Account data (name, email, encrypted password), order data (name, email, phone, delivery address), payment data (processed directly by Stripe; we never store card numbers) and technical traffic data (IP address, page visited, time of visit) — detailed in section 8.",
    "privacy.s3.title": "3. Why we collect this data",
    "privacy.s3.body": "We use your data solely to process orders, manage your account, answer support requests and meet legal obligations (accounting, returns). We do not sell or rent your data to third parties for marketing.",
    "privacy.s4.title": "4. Who we share data with",
    "privacy.s4.body": "Payment data is processed by Stripe, under Stripe's own privacy policy. Delivery data may be passed to the chosen courier in order to complete the delivery. We do not share data with any third parties beyond those strictly needed to deliver your order and process the payment.",
    "privacy.s5.title": "5. How long we keep data",
    "privacy.s5.body": "Account data is kept for as long as your account is active. Order data is kept in line with legal accounting retention obligations. You can request deletion of your account at any time, except for data we are legally required to keep.",
    "privacy.s6.title": "6. Your rights",
    "privacy.s6.body": "You have the right to request access to, rectification of, erasure of or restriction of the processing of your data, as well as the right to object to processing or to request data portability. For any request, write to us at contact@beca-wlf.com.",
    "privacy.s7.title": "7. Cookies",
    "privacy.s7.body": "Full details about the cookies we use are in the Terms and conditions, Cookies section.",
    "privacy.s8.title": "8. Technical data and traffic analysis (IP address)",
    "privacy.s8.body": "Besides account and order data, on every visit we automatically collect some technical data: IP address, page visited, time of visit and the referring source. We do not use tracking cookies for this — the data is recorded directly by our server. The purpose is strictly internal: we analyse this data in aggregate (for example, which areas most orders come from) to inform business decisions, including assessing possible physical locations in the future. We do not use this data for targeted advertising and we do not sell or share it with third parties for marketing. The legal basis is our legitimate interest in understanding and improving our commercial activity. You can request information about this data, or its deletion, at any time by writing to contact@beca-wlf.com.",
    "privacy.cta.title": "Questions about your data?",
    "privacy.cta.button": "Write to us at contact@beca-wlf.com",
    "product.previewReason": "Join the list for access before the public. Limited stock.",
    "product.countdown": "Drop unlocks in 12 days",
    "product.materials.title": "Materials & fit",
    "product.materials.fabricLabel": "Fabric",
    "product.materials.fabricValue": "240gsm heavyweight combed cotton, brushed inside for softness.",
    "product.materials.fitLabel": "Fit",
    "product.materials.fitValue": "Oversized, boxy cut. True to size — size down for a tighter fit.",
    "product.materials.careLabel": "Care",
    "product.materials.careValue": "Machine wash cold, inside out. No bleach. Low-heat iron only.",
    "product.reviews.title": "Reviews",
    "product.reviews.rating": "Rating",
    "product.reviews.text": "Your review",
    "product.reviews.submit": "Submit review",
    "support.hero.kicker": "We're here",
    "support.hero.title": "How can we help?",
    "support.hero.lede": "For questions about orders, delivery, returns or anything else, write to us — we reply as fast as we can.",
    "support.email": "contact@beca-wlf.com",
    "support.hours": "Monday – Friday, 10:00 – 18:00",
    "support.responseTime": "Usually within 24 working hours",
    "support.before.title": "Before you write to us",
    "support.before.body": "Many questions are already answered in the Frequently asked questions section. If you need help with an existing order, keep your order number (format BC-0000) handy so we can help you faster.",
    "support.merchant.title": "Merchant details",
    "support.merchant.body": "[LEGAL_COMPANY_NAME], a company registered in the United Kingdom, Companies House registration number [LEGAL_REGISTRATION_NUMBER], with its registered office at [LEGAL_COMPANY_ADDRESS].",
    "support.cta.title": "Write to us directly",
    "support.cta.button": "Send an email",
    "terms.hero.kicker": "Legal",
    "terms.hero.title": "Terms and conditions.",
    "terms.hero.lede": "Last updated: 5 July 2026. Using this site means you agree to the terms below.",
    "terms.s1.title": "1. Orders and prices",
    "terms.s1.body": "Displayed prices include VAT. We reserve the right to change prices and product availability without prior notice, but orders already confirmed are not affected by those changes.",
    "terms.s2.title": "2. Payment",
    "terms.s2.body": "Payment is made online by card or, where available, cash on delivery. An order is considered confirmed once the payment is validated or, for cash on delivery, after confirmation by phone or email.",
    "terms.s3.title": "3. Delivery",
    "terms.s3.body": "Delivery times are estimates and may vary depending on the courier and the location. We are not liable for delays caused by the courier or by events outside our control.",
    "terms.s4.title": "4. Returns and refunds",
    "terms.s4.body": "You have the right to return products within 14 calendar days of receipt, under consumer protection law, provided the products are unworn and still carry their original tags. Refunds are issued within a maximum of 14 days from receiving the returned product.",
    "terms.s5.title": "5. Intellectual property",
    "terms.s5.body": "All graphics, designs and materials on this site belong to BeCa and may not be reproduced without written consent.",
    "terms.s6.title": "6. Cookies",
    "terms.s6.body": "We use strictly necessary cookies for the site to work, not marketing or analytics cookies. These cookies are strictly necessary for the account and the shopping cart to function, which is why they do not require a separate consent banner under the law applicable to technical cookies.",
    "terms.s7.title": "7. Changes to the terms",
    "terms.s7.body": "We may update these terms from time to time. The version in force is always the one published on this page.",
    "terms.cta.title": "Questions about these terms?",
    "terms.cta.button": "Contact us"
  ,

    // --- product spec strip ---
    "product.spec.gsm": "240 GSM",
    "product.spec.cotton": "100% organic cotton",
    "product.spec.weight": "Heavyweight",
    "product.spec.fit": "Oversized",
    "product.spec.preshrunk": "Pre-shrunk",
    "product.spec.print": "DTG premium print"
  },
  ro: {
    "nav.drop": "Drop",
    "nav.quality": "Calitate",
    "nav.contact": "Contact",
    "hero.kicker": "Drop 001 — editie strict limitata",
    "hero.title": "Urmatorul drop se incarca. Prinde‑l inainte sa dispara.",
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
    "checkout.trustNote": "Datele tale sunt criptate si folosite doar pentru procesarea acestei comenzi.",
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
    "design.title": "Grafica noua. Energie indrazneata. Piese pe care chiar le porti.",
    "design.body": "Fiecare lansare porneste de la o singura idee — un simbol, o stare, o tipografie. Scopul: piese care lovesc tare la lansare si inca functioneaza luni mai tarziu.",
    "design.note1.title": "Artwork original",
    "design.note1.body": "Fiecare print e desenat in casa, drop cu drop. Nimic reciclat, nimic generic.",
    "design.note2.title": "Usor de stilizat",
    "design.note2.body": "Construite in jurul negrului, albului si accentelor grafice care merg in orice outfit.",
    "drop.kicker": "Urmatorul drop",
    "drop.title": "Primul preview, inainte sa devina public.",
    "drop.item1.meta": "Tricou / print grafic",
    "drop.item1.title": "Tricou oversized statement",
    "drop.item2.meta": "Accesoriu / limitat",
    "drop.item2.title": "Accesoriu pregatit pentru drop",
    "drop.item3.meta": "Inca blocat",
    "drop.item3.title": "Urmatorul print, in curand",
    "story.kicker": "Povestea",
    "story.title": "O singura obsesie: grafica care nu arata produsa in masa.",
    "story.body": "BeCa a pornit de la o idee simpla: streetwear-ul poate fi mai original decat ce gasesti peste tot. Fiecare print e desenat in casa, fiecare serie e limitata intentionat, iar fiecare piesa pleaca din Romania in loturi mici, gandite cu atentie — nu dintr-un depozit plin cu acelasi tricou.",
    "story.cta": "Citeste povestea completa",
    "trust.shipping": "Livrare in 2-5 zile lucratoare",
    "trust.returns": "Retur usor in 14 zile",
    "trust.payment": "Plata 100% securizata",
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
    "footer.returns": "Retur",
    "footer.shipping": "Livrare",
    "footer.cookies": "Cookie-uri",
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
  ,

    // --- page copy (about / faq / support / product / auth / legal) ---
    "about.hero.kicker": "Povestea noastra",
    "about.hero.title": "Despre BeCa.",
    "about.hero.lede": "O singura viziune: grafica originala, serii limitate, gandite pentru cei care vor ceva ce mainstream-ul nu are.",
    "about.s1.title": "Cine suntem",
    "about.s1.body1": "BeCa este un brand de streetwear romanesc nascut din pasiunea pentru design grafic si moda urbana. Fiecare piesa incepe ca o idee vizuala — un simbol, o stare, o tipografie — si se transforma intr-un tricou pe care il porti cu incredere. Sistemul de brand si experienta de cumparare 3D au fost construite de Wolfline Studio.",
    "about.s1.body2": "Nu facem productie de masa. Fiecare drop e limitat ca numar de bucati, ca fiecare piesa sa ramana speciala.",
    "about.s2.title": "Ce ne diferentiaza",
    "about.card1.title": "Design original",
    "about.card1.body": "Toata grafica e creata in casa, nu preluata din stock-uri generice.",
    "about.card2.title": "Serii limitate",
    "about.card2.body": "Cand un drop se termina, nu se mai reface la fel. Ce porti e rar.",
    "about.card3.title": "Calitate reala",
    "about.card3.body": "Materiale alese pentru purtare zilnica, nu doar pentru o poza.",
    "about.cta.title": "Vrei sa fii primul care afla de un drop nou?",
    "about.cta.button": "Inregistreaza-te pentru acces",
    "account.orders": "Comenzile mele",
    "account.verifyBanner": "Contul tau nu este verificat inca. Verifica emailul pentru linkul de confirmare.",
    "account.resendVerification": "Retrimite emailul",
    "account.wishlist": "Favorite",
    "account.wishlistTitle": "Piese salvate",
    "account.wishlistEmpty": "Nicio piesa salvata inca.",
    "faq.hero.kicker": "Ajutor rapid",
    "faq.hero.title": "Intrebari frecvente.",
    "faq.hero.lede": "Raspunsuri la ce ne intreaba cel mai des clientii nostri.",
    "faq.q1": "Cat dureaza livrarea?",
    "faq.a1": "Comenzile sunt de obicei procesate in 1-3 zile lucratoare si livrate in 2-5 zile lucratoare, in functie de localitate.",
    "faq.q2": "Ce marimi aveti disponibile?",
    "faq.a2": "Majoritatea pieselor vin in S, M, L si XL. Stocul exact pe fiecare marime e afisat direct pe pagina produsului.",
    "faq.q3": "Pot returna sau schimba o comanda?",
    "faq.a3": "Da, ai 14 zile calendaristice de la primirea coletului pentru a solicita retur sau schimb, conform legislatiei in vigoare. Scrie-ne la adresa de suport cu numarul comenzii.",
    "faq.q4": "Ce metode de plata acceptati?",
    "faq.a4": "Acceptam plata online cu cardul si, pentru anumite zone, plata ramburs la livrare.",
    "faq.q5": "Cum aflu cand apare un drop nou?",
    "faq.a5": "Inregistreaza-te pe site — contul tau primeste acces prioritar la drop-urile noi, inainte de lansarea publica.",
    "faq.q6": "Ce fac daca produsul dorit e sold-out?",
    "faq.a6": "Poti apasa \"Anunta-ma cand e disponibil\" pe pagina produsului, alegand marimea preferata — te anuntam daca revine in stoc.",
    "faq.cta.title": "Nu ai gasit raspunsul cautat?",
    "faq.cta.button": "Contacteaza echipa de suport",
    "auth.forgot.kicker": "Acces client",
    "auth.forgot.title": "Reseteaza-ti parola.",
    "auth.forgot.button": "Trimite linkul de resetare",
    "auth.backToLogin": "Inapoi la autentificare",
    "auth.forgotPassword": "Ai uitat parola?",
    "auth.reset.kicker": "Acces client",
    "auth.reset.title": "Alege o parola noua.",
    "auth.reset.newPassword": "Parola noua",
    "auth.reset.button": "Seteaza parola noua",
    "cart.coupon": "Cod de reducere (optional)",
    "privacy.hero.kicker": "Legal",
    "privacy.hero.title": "Politica de confidentialitate.",
    "privacy.hero.lede": "Ultima actualizare: 5 iulie 2026. Explicam ce date colectam, de ce, si ce drepturi ai asupra lor.",
    "privacy.s1.title": "1. Cine este operatorul datelor",
    "privacy.s1.body": "[LEGAL_COMPANY_NAME], societate inregistrata in Marea Britanie, numar de inregistrare Companies House [LEGAL_REGISTRATION_NUMBER], cu sediul la [LEGAL_COMPANY_ADDRESS], este operatorul datelor tale personale colectate prin acest site. Pentru orice intrebare legata de datele tale, ne poti scrie la contact@beca-wlf.com.",
    "privacy.s2.title": "2. Ce date colectam",
    "privacy.s2.body": "Date de cont (nume, email, parola criptata), date de comanda (nume, email, telefon, adresa de livrare), date de plata (procesate direct de Stripe; noi nu stocam numere de card) si date tehnice de trafic (adresa IP, pagina accesata, ora vizitei) — detaliate la punctul 8.",
    "privacy.s3.title": "3. De ce colectam aceste date",
    "privacy.s3.body": "Folosim datele tale exclusiv pentru a procesa comenzi, a-ti gestiona contul, a raspunde solicitarilor de suport si a respecta obligatii legale (contabilitate, retururi). Nu vindem si nu inchiriem datele tale catre terti in scop de marketing.",
    "privacy.s4.title": "4. Cu cine impartasim datele",
    "privacy.s4.body": "Datele de plata sunt procesate de Stripe, conform politicii proprii de confidentialitate a Stripe. Datele de livrare pot fi transmise curierului ales pentru finalizarea livrarii. Nu impartasim date cu alti terti in afara celor strict necesare pentru livrarea comenzii si procesarea platii.",
    "privacy.s5.title": "5. Cat timp pastram datele",
    "privacy.s5.body": "Datele de cont sunt pastrate cat timp contul tau este activ. Datele de comanda sunt pastrate conform obligatiilor legale de arhivare contabila. Poti solicita oricand stergerea contului, cu exceptia datelor pe care suntem obligati legal sa le pastram.",
    "privacy.s6.title": "6. Drepturile tale",
    "privacy.s6.body": "Ai dreptul sa soliciti accesul, rectificarea, stergerea sau restrictionarea prelucrarii datelor tale, precum si dreptul de a te opune prelucrarii sau de a solicita portabilitatea datelor. Pentru orice solicitare, scrie-ne la contact@beca-wlf.com.",
    "privacy.s7.title": "7. Cookie-uri",
    "privacy.s7.body": "Detalii complete despre cookie-urile folosite gasesti in Termeni si conditii, sectiunea Cookie-uri.",
    "privacy.s8.title": "8. Date tehnice si analiza traficului (adresa IP)",
    "privacy.s8.body": "Pe langa datele de cont si comanda, colectam automat, la fiecare vizita, cateva date tehnice: adresa IP, pagina accesata, ora vizitei si sursa de provenienta (referrer). Nu folosim cookie-uri de tracking pentru asta — datele sunt inregistrate direct de serverul nostru. Scopul este strict intern: analizam aceste date agregat (de exemplu, din ce zone vin cele mai multe comenzi) pentru decizii de business, inclusiv evaluarea unor eventuale locatii fizice in viitor. Nu folosim aceste date pentru publicitate tintita si nu le vindem sau impartasim cu terti in scop de marketing. Temeiul legal este interesul nostru legitim de a intelege si imbunatati activitatea comerciala. Poti solicita oricand informatii despre aceste date sau stergerea lor, scriindu-ne la contact@beca-wlf.com.",
    "privacy.cta.title": "Ai intrebari despre datele tale?",
    "privacy.cta.button": "Scrie-ne la contact@beca-wlf.com",
    "product.previewReason": "Intra pe lista pentru acces inainte de public. Stoc limitat.",
    "product.countdown": "Drop-ul se deblocheaza in 12 zile",
    "product.materials.title": "Materiale si croi",
    "product.materials.fabricLabel": "Material",
    "product.materials.fabricValue": "Bumbac pieptanat gros, 240gsm, periat pe interior pentru moliciune.",
    "product.materials.fitLabel": "Croi",
    "product.materials.fitValue": "Croi oversized, boxy. Conform marimii — alege o marime mai mica pentru un fit mai stramt.",
    "product.materials.careLabel": "Intretinere",
    "product.materials.careValue": "Spalare la masina la rece, pe dos. Fara inalbitor. Calcare doar la temperatura mica.",
    "product.reviews.title": "Recenzii",
    "product.reviews.rating": "Nota",
    "product.reviews.text": "Recenzia ta",
    "product.reviews.submit": "Trimite recenzia",
    "support.hero.kicker": "Suntem aici",
    "support.hero.title": "Cum te putem ajuta?",
    "support.hero.lede": "Pentru intrebari despre comenzi, livrare, retur sau orice altceva, scrie-ne — raspundem cat mai repede posibil.",
    "support.email": "contact@beca-wlf.com",
    "support.hours": "Luni – Vineri, 10:00 – 18:00",
    "support.responseTime": "De obicei in maximum 24 de ore lucratoare",
    "support.before.title": "Inainte sa ne scrii",
    "support.before.body": "Multe intrebari au deja raspuns in sectiunea de Intrebari frecvente. Daca ai nevoie de ajutor cu o comanda existenta, ai numarul comenzii (format BC-0000) la indemana, ca sa te putem ajuta mai rapid.",
    "support.merchant.title": "Date despre comerciant",
    "support.merchant.body": "[LEGAL_COMPANY_NAME], societate inregistrata in Marea Britanie, numar de inregistrare Companies House [LEGAL_REGISTRATION_NUMBER], cu sediul la [LEGAL_COMPANY_ADDRESS].",
    "support.cta.title": "Scrie-ne direct",
    "support.cta.button": "Trimite un email",
    "terms.hero.kicker": "Legal",
    "terms.hero.title": "Termeni si conditii.",
    "terms.hero.lede": "Ultima actualizare: 5 iulie 2026. Folosirea acestui site inseamna ca esti de acord cu termenii de mai jos.",
    "terms.s1.title": "1. Comenzi si preturi",
    "terms.s1.body": "Preturile afisate includ TVA. Ne rezervam dreptul de a modifica preturile si disponibilitatea produselor fara notificare prealabila, insa comenzile deja confirmate nu sunt afectate de aceste modificari.",
    "terms.s2.title": "2. Plata",
    "terms.s2.body": "Plata se face online cu cardul sau, acolo unde este disponibil, ramburs la livrare. Comanda este considerata confirmata dupa validarea platii sau dupa confirmarea telefonica/pe email, in cazul rambursului.",
    "terms.s3.title": "3. Livrare",
    "terms.s3.body": "Termenele de livrare sunt estimative si pot varia in functie de curier si locatie. Nu raspundem pentru intarzieri cauzate de curier sau de evenimente in afara controlului nostru.",
    "terms.s4.title": "4. Retur si rambursare",
    "terms.s4.body": "Ai dreptul de a returna produsele in 14 zile calendaristice de la primire, conform legislatiei privind protectia consumatorului, cu conditia ca produsele sa fie nepurtate si cu etichetele originale atasate. Rambursarea se face in maximum 14 zile de la primirea produsului returnat.",
    "terms.s5.title": "5. Proprietate intelectuala",
    "terms.s5.body": "Toate graficele, design-urile si materialele de pe acest site apartin BeCa si nu pot fi reproduse fara acord scris.",
    "terms.s6.title": "6. Cookie-uri",
    "terms.s6.body": "Folosim strict cookie-uri necesare functionarii site-ului, nu cookie-uri de marketing sau analytics. Aceste cookie-uri sunt strict necesare pentru functionarea contului si a cosului de cumparaturi, motiv pentru care nu necesita un banner separat de consimtamant, conform legislatiei aplicabile cookie-urilor tehnice.",
    "terms.s7.title": "7. Modificari ale termenilor",
    "terms.s7.body": "Putem actualiza acesti termeni periodic. Versiunea in vigoare este intotdeauna cea publicata pe aceasta pagina.",
    "terms.cta.title": "Ai intrebari despre acesti termeni?",
    "terms.cta.button": "Contacteaza-ne"
  ,

    // --- product spec strip ---
    "product.spec.gsm": "240 GSM",
    "product.spec.cotton": "100% bumbac organic",
    "product.spec.weight": "Material gros",
    "product.spec.fit": "Croi oversized",
    "product.spec.preshrunk": "Pre-spalat",
    "product.spec.print": "Print DTG premium"
  }
};

let copy = defaultCopy;

// Brand copy overrides: a brand page may define window.__BRAND_COPY__
// (e.g. in aether/brand-copy.js, loaded before this script) to replace
// individual strings per language without forking the shared engine
// dictionary. Missing keys fall through to the defaults, and brands
// that don't define it are untouched.
if (window.__BRAND_COPY__) {
  copy = {};
  Object.keys(defaultCopy).forEach((language) => {
    copy[language] = { ...defaultCopy[language], ...(window.__BRAND_COPY__[language] || {}) };
  });
}

function updateHeroGlitchCountdown() {
  const pad = (value) => String(value).padStart(2, "0");
  const glitchValue = (max) => pad(Math.floor(Math.random() * (max + 1)));

  document.querySelectorAll("[data-glitch-hours]").forEach((element) => {
    element.textContent = glitchValue(99);
  });
  document.querySelectorAll("[data-glitch-minutes]").forEach((element) => {
    element.textContent = glitchValue(59);
  });
  document.querySelectorAll("[data-glitch-seconds]").forEach((element) => {
    element.textContent = glitchValue(59);
  });
}

function detectLanguage() {
  // A brand page can pin its language (<html data-force-lang="en">),
  // overriding both the visitor's saved choice and auto-detection -
  // used by single-language brand instances (e.g. ÆTHER ORIGIN is
  // English-only). Brands without the attribute behave as before.
  const forced = document.documentElement.dataset.forceLang;
  if (forced === "ro" || forced === "en") return forced;

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
  window.dispatchEvent(new CustomEvent("beca:locale-change", { detail: { language: activeLanguage } }));
}

setLanguage(detectLanguage(), { source: "auto" });
updateHeroGlitchCountdown();
window.setInterval(updateHeroGlitchCountdown, 120);
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
    // Brand copy overrides stay on top of admin-edited content too - the
    // brand voice keys (trust strip, scarcity wording) are fixed rules,
    // not editable copy. Keys the brand doesn't override behave as before.
    copy = {
      en: { ...defaultCopy.en, ...data.en, ...(window.__BRAND_COPY__?.en || {}) },
      ro: { ...defaultCopy.ro, ...data.ro, ...(window.__BRAND_COPY__?.ro || {}) }
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
