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
  const glassElements = document.querySelectorAll(".beca-hero-copy, .beca-actions a, .language-switch, .cart-panel, .product-card");

  glassElements.forEach((element) => {
    const isButton = element.matches(".beca-actions a, .language-switch");
    const value = `blur(${isButton ? 16 : 22}px) saturate(${isButton ? 1.28 : 1.38}) brightness(${isButton ? 1.08 : 1.04})`;
    element.classList.add("liquid-glass-real");
    element.style.backdropFilter = value;
    element.style.webkitBackdropFilter = value;
  });
}

const defaultCopy = {
  en: {
    "nav.drop": "Shop",
    "nav.about": "About",
    "nav.quality": "Craft",
    "nav.contact": "Contact",
    "nav.register": "Register",
    "nav.callUs": "Call us",
    "about.origin.title": "Where it all began",
    "about.origin.lede": "A story about care, comfort and everyday life.",
    "about.origin.p1": "BeCa didn't start in an office, or with a perfect business plan.",
    "about.origin.p2": "It started at home, with a mother who wanted to find better clothes for her son.",
    "about.origin.p3": "Some fabrics irritated his skin. Clothes could be beautiful, modern and well-cut, but if you didn't feel good in them, what was the point?",
    "about.origin.p4": "That's when we started looking at clothes differently.",
    "about.origin.p5": "We understood they should mean more than looks. They should be comfortable, breathable, soft to the touch and easy to wear.",
    "about.origin.p6": "Above all, they should let you live your day without constantly thinking about what you're wearing.",
    "about.origin.p7": "That's how BeCa began.",
    "about.origin.p8": "From a personal experience, a vision was born: to create clothes people choose not just for how they look, but for how they make them feel.",
    "about.origin.p9": "We started with tees, because a t-shirt is one of the simplest, most versatile pieces in a wardrobe. And that's exactly why we believe it should be one of the best.",
    "about.origin.p10": "Soft-touch cotton, comfort, freedom of movement and a carefully considered design — simple things, but important ones.",
    "about.origin.p11": "Clothes made for real life.",
    "about.origin.p12": "For rushed mornings. For quiet days. For travel. For time spent with family. For warm days. For the moments you laugh, walk, work, or simply enjoy life.",
    "about.origin.p13": "For us, these are the things that matter.",
    "about.origin.p14": "We don't want to make clothes you wear once. We want to create pieces you choose again and again, because they feel good, look good, and become part of your life.",
    "about.origin.p15": "Because BeCa wasn't created just to dress people.",
    "about.origin.p16": "It was created to make their days a little more comfortable.",
    "about.origin.signature": "BeCa. Made with care. Worn with joy. Made for life.",
    "shipping.hero.kicker": "Shipping",
    "shipping.hero.title": "How your piece gets to you.",
    "shipping.hero.lede": "Last updated: July 5, 2026. Every order is prepared with care — here's what to expect after you place it.",
    "shipping.s1.title": "1. Order processing",
    "shipping.s1.body": "Once your order is confirmed, we prepare it and hand it to the courier within 1-2 business days. You'll get an email with your order number right after checkout.",
    "shipping.s2.title": "2. Couriers",
    "shipping.s2.bodyPre": "We work with ",
    "shipping.s2.bodyPost": " for order delivery. Your tracking number (AWB) will be sent by email once your order ships.",
    "shipping.s3.title": "3. Delays",
    "shipping.s3.body": "The timeframes above are estimates and may vary depending on courier, season or location. We're not liable for delays caused by events outside our direct control.",
    "shipping.s4.title": "4. Your order hasn't arrived, or has a problem",
    "shipping.s4.bodyPre": "If tracking shows it as delivered but you haven't received the parcel, or the piece arrived damaged, write to us as soon as possible at ",
    "shipping.s4.bodyPost": " with your order number.",
    "shipping.cta.title": "Have an order on its way?",
    "shipping.cta.button": "Contact us",
    "returns.hero.kicker": "Returns",
    "returns.hero.title": "Return policy.",
    "returns.hero.lede": "Last updated: July 5, 2026. We want you to be confident in your choice — here's how returns work if a piece isn't right for you.",
    "returns.s1.title": "1. Right of return",
    "returns.s1.body": "You have the right to return your products within 14 calendar days of receiving your order, with no need to give a reason, under consumer protection law.",
    "returns.s2.title": "2. Conditions for a return",
    "returns.s2.body": "Products must be unworn, unwashed, with all original tags still attached, and in their original packaging where possible. Since these are limited-edition pieces, a damaged or worn product can't be accepted for return.",
    "returns.s3.title": "3. How to start a return",
    "returns.s3.bodyPre": "Write to us at ",
    "returns.s3.bodyPost": " with your order number (format BC-0000) and the product you'd like to return. We'll send you return instructions within 24 business hours.",
    "returns.s4.title": "4. Refund",
    "returns.s4.body": "Once we receive and check the returned product, the refund is issued within a maximum of 14 calendar days, using the same payment method used for the order.",
    "returns.s5.title": "5. Return shipping cost",
    "returns.cta.title": "Questions about a return?",
    "returns.cta.button": "Contact us",
    "orders.loading": "Loading your orders...",
    "thankYou.loading": "Loading your order...",
    "orders.hero.kicker": "Account",
    "orders.hero.title": "My orders.",
    "orders.hero.lede": "The status and history of your BeCa orders, with a direct link to each invoice.",
    "hero.kicker": "BECA",
    "hero.dropLabel": "Drop 001",
    "hero.title": "Premium streetwear made to be seen.",
    "hero.body": "Bold prints, heavyweight cotton, capped numbers — no restocks, ever. Spin the 3D tee, then lock in early access before the public launch.",
    "hero.primary": "Shop the collection",
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
    "cart.payLater": "I'll pay later",
    "cart.cardDetails": "Card details",
    "cart.payNow": "Pay now",
    "checkout.trustNote": "Your order is recorded in the currency shown at checkout. Your details are used only to process this order.",
    "checkout.paymentTrustNote": "Card details are entered directly with Square and never reach our servers.",
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
    "quality.card3.title": "Small-batch runs",
    "quality.card3.body": "We print in small batches on purpose, so every drop stays intentional.",
    "design.kicker": "Design direction",
    "design.title": "New graphics. Bold energy. Pieces you'll actually wear.",
    "design.body": "Every release starts from one idea — a symbol, a mood, a typeface. The goal: pieces that hit on launch day and still go months later.",
    "design.note1.title": "Original artwork",
    "design.note1.body": "Every print is designed in-house, drop by drop. Nothing recycled, nothing generic.",
    "design.note2.title": "Easy to style",
    "design.note2.body": "Built around black, white and sharp accent graphics that slot into fits you already wear.",
    "drop.kicker": "Drop 001",
    "drop.title": "Shop the current drop.",
    "drop.promo": "First 30 orders get 10% off — code BECA10",
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
    "trust.payment": "Order verified & confirmed by our team",
    "contact.kicker": "Don't miss it",
    "contact.title": "Early access to every new drop.",
    "contact.button": "Get early access",
    "contact.account": "Open my account",
    "footer.tagline": "Premium streetwear, made in Romania.",
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
    "account.dangerZone": "Danger zone",
    "account.deleteAccount": "Delete my account",
    "account.deleteAccountNote": "This permanently removes your login and profile. Past orders are kept for legal/accounting records, exactly as described in our privacy policy.",
    "account.deleteAccountButton": "Delete my account",
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

    // --- cart / checkout / order-confirmation pages ---
    "cart.goToCart": "Go to cart",
    "steps.cart": "Cart",
    "steps.checkout": "Checkout",
    "steps.confirmation": "Confirmation",
    "cart.pageTitle": "Your cart",
    "cart.summary": "Order summary",
    "cart.subtotal": "Subtotal",
    "cart.shipping": "Shipping",
    "cart.shippingFree": "Free",
    "cart.discount": "Discount",
    "cart.total": "Total",
    "cart.proceedToCheckout": "Proceed to checkout",
    "cart.continueShopping": "Continue shopping",
    "cart.emptyTitle": "Your cart is empty",
    "cart.emptyBody": "You don't have any pieces selected yet. Explore the latest drop and find something you'll wear on repeat.",
    "cart.clearCart": "Clear cart",
    "checkout.pageTitle": "Checkout",
    "checkout.contactInfo": "Contact information",
    "checkout.shippingAddress": "Shipping address",
    "checkout.delivery": "Delivery",
    "checkout.payment": "Payment",
    "checkout.country": "Country",
    "checkout.fullName": "Full name",
    "checkout.apartment": "Apartment / suite (optional)",
    "checkout.city": "City",
    "checkout.county": "County / State",
    "checkout.postalCode": "Postal code",
    "checkout.deliveryStandardName": "Standard shipping",
    "confirmation.title": "Order confirmed",
    "confirmation.message": "Thank you — your order has been placed successfully. A confirmation email is on its way.",
    "privacy.hero.kicker": "Legal",
    "privacy.hero.title": "Privacy policy.",
    "privacy.hero.lede": "Last updated: 5 July 2026. We explain what data we collect, why, and what rights you have over it.",
    "privacy.s1.title": "1. Who the data controller is",
    "privacy.s1.body": "BeCa Online shop, a company registered in the United Kingdom, with its registered office at 59 Woodward Road, Rock Ferry, Birkenhead, CH42 1QE, United Kingdom, is the controller of the personal data collected through this site. For any question about your data, write to us at contact@beca-wlf.com.",
    "privacy.s2.title": "2. What data we collect",
    "privacy.s2.body": "Account data (name, email, password stored as a secure hash), order data (name, email, phone, delivery address) and technical traffic data (anonymized IP address, page visited, time of visit) — detailed in section 8. No card details are collected on this site.",
    "privacy.s3.title": "3. Why we collect this data",
    "privacy.s3.body": "We use your data solely to process orders, manage your account, answer support requests and meet legal obligations (accounting, returns). We do not sell or rent your data to third parties for marketing.",
    "privacy.s4.title": "4. Who we share data with",
    "privacy.s4.body": "Delivery data may be passed to the chosen courier in order to complete the delivery. We do not share data with any third parties beyond those strictly needed to deliver your order. No card payments are processed on this site.",
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
    "support.emailLabel": "Email",
    "support.email": "contact@beca-wlf.com",
    "support.phoneLabel": "Phone",
    "support.phone": "+44 7534 490485",
    "support.hoursLabel": "Support hours",
    "support.hours": "Monday – Friday, 10:00 – 18:00",
    "support.responseTimeLabel": "Response time",
    "support.responseTime": "Usually within 24 working hours",
    "shipping.zonesLabel": "Covered areas",
    "shipping.timeLabel": "Estimated time",
    "shipping.time": "2-5 business days from order confirmation",
    "shipping.costLabel": "Delivery cost",
    "privacy.s2.accountLabel": "Account data",
    "privacy.s2.accountBody": "Name, email, password stored as a secure hash — when you create an account.",
    "privacy.s2.orderLabel": "Order data",
    "privacy.s2.orderBody": "Name, email, phone, delivery address — when you place an order.",
    "privacy.s2.paymentLabel": "Payment data",
    "privacy.s2.paymentBody": "No card details are collected or processed on this site. Your order is verified and confirmed by our team.",
    "privacy.s2.technicalLabel": "Technical data",
    "privacy.s2.technicalBody": "IP address, page and time of visit — on every site access. See section 8.",
    "cookies.session.body": "Remembers the account you're logged into. Expires automatically after 7 days.",
    "cookies.cart.body": "Remembers the items in your cart between visits. Expires automatically after 30 days.",
    "error404.kicker": "404 Error",
    "error404.message": "The page you're looking for is gone, just like our stock after every drop. Check the address or head back to the latest collection before that disappears too.",
    "error404.home": "Back home",
    "error404.drop": "See the drop",
    "cookies.hero.kicker": "Cookies",
    "cookies.hero.title": "Cookie policy.",
    "cookies.hero.lede": "Last updated: July 5, 2026. We use a minimal number of cookies, strictly necessary for the site to function.",
    "cookies.s1.title": "1. What is a cookie",
    "cookies.s1.body": "A cookie is a small text file, saved in your browser, that helps the site remember information between visits — for example, that you're logged in or what you've added to your cart.",
    "cookies.s2.title": "2. What cookies we use",
    "cookies.s2.body": "We use exclusively cookies that are strictly necessary for the site to function. We do not use marketing, advertising, or third-party analytics cookies.",
    "cookies.s3.title": "3. Why we don't ask for separate consent",
    "cookies.s3.body": "The cookies above are strictly necessary for your account and shopping cart to work, which is why, under the legislation applicable to technical cookies, they don't require a separate consent banner.",
    "cookies.s4.title": "4. How you can control cookies",
    "cookies.s4.body": "You can delete or block cookies from your browser settings at any time. Note that blocking strictly necessary cookies may affect your account and shopping cart.",
    "cookies.s5.title": "5. Traffic analysis (without cookies)",
    "cookies.s5.bodyPre": "Besides the cookies above, our server automatically records some technical data on every visit — IP address, page accessed and time of visit — without using any cookie. This data is used internally for traffic and order statistics, not for advertising. Full details in ",
    "cookies.s5.link": "Privacy Policy",
    "cookies.s5.bodyPost": ", section 8.",
    "cookies.s6.title": "6. Changes to this policy",
    "cookies.s6.body": "We may update this policy periodically. The version in effect is always the one published on this page.",
    "cookies.cta.title": "Questions about cookies?",
    "cookies.cta.button": "Contact us",
    "support.before.title": "Before you write to us",
    "support.before.body": "Many questions are already answered in the Frequently asked questions section. If you need help with an existing order, keep your order number (format BC-0000) handy so we can help you faster.",
    "support.merchant.title": "Merchant details",
    "support.merchant.body": "BeCa Online shop, a company registered in the United Kingdom, with its registered office at 59 Woodward Road, Rock Ferry, Birkenhead, CH42 1QE, United Kingdom.",
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
  ,

    // --- profile menu ---
    "nav.profile": "My Profile",
    "nav.myOrders": "My Orders",
    "nav.adminPanel": "Admin Panel",
    "nav.settings": "Settings",
    "nav.privacy": "Privacy & Security",
    "nav.help": "Help & Support",
    "nav.logout": "Logout"
  },
  ro: {
    "nav.drop": "Shop",
    "nav.about": "Despre",
    "nav.quality": "Calitate",
    "nav.contact": "Contact",
    "nav.register": "Inregistrare",
    "nav.callUs": "Sună-ne",
    "about.origin.title": "De unde a inceput totul",
    "about.origin.lede": "O poveste despre grija, confort si viata de zi cu zi.",
    "about.origin.p1": "BeCa nu a inceput intr-un birou si nici cu un plan perfect de business.",
    "about.origin.p2": "A inceput acasa, cu o mama care isi dorea sa gaseasca haine mai bune pentru fiul ei.",
    "about.origin.p3": "Unele materiale ii iritau pielea. Hainele puteau fi frumoase, moderne si bine croite, dar daca nu te simteai bine in ele, ce rost aveau?",
    "about.origin.p4": "Atunci am inceput sa privesc hainele altfel.",
    "about.origin.p5": "Am inteles ca ele ar trebui sa insemne mai mult decat aspect. Ar trebui sa fie confortabile, respirabile, placute la atingere si usor de purtat.",
    "about.origin.p6": "Mai presus de toate, ar trebui sa iti permita sa iti traiesti ziua fara sa te gandesti permanent la ceea ce porti.",
    "about.origin.p7": "Asa a inceput BeCa.",
    "about.origin.p8": "Dintr-o experienta personala s-a nascut o viziune: sa cream haine pe care oamenii sa le aleaga nu doar pentru felul in care arata, ci si pentru felul in care ii fac sa se simta.",
    "about.origin.p9": "Am inceput cu tricourile, pentru ca un tricou este una dintre cele mai simple si versatile piese dintr-o garderoba. Si tocmai de aceea credem ca trebuie sa fie una dintre cele mai bune.",
    "about.origin.p10": "Bumbac placut la atingere, confort, libertate de miscare si un design atent gandit — lucruri simple, dar importante.",
    "about.origin.p11": "Haine create pentru viata reala.",
    "about.origin.p12": "Pentru dimineti grabite. Pentru zile linistite. Pentru calatorii. Pentru timp petrecut cu familia. Pentru zile calduroase. Pentru momentele in care razi, te plimbi, muncesti sau pur si simplu te bucuri de viata.",
    "about.origin.p13": "Pentru noi, acestea sunt lucrurile care conteaza.",
    "about.origin.p14": "Nu vrem sa cream haine pe care sa le porti o singura data. Vrem sa cream piese pe care sa le alegi din nou si din nou, pentru ca se simt bine, arata bine si devin parte din viata ta.",
    "about.origin.p15": "Pentru ca BeCa nu a fost creata doar pentru a imbraca oameni.",
    "about.origin.p16": "A fost creata pentru a face zilele lor putin mai confortabile.",
    "about.origin.signature": "BeCa. Creata din grija. Purtata cu placere. Facuta pentru viata.",
    "shipping.hero.kicker": "Livrare",
    "shipping.hero.title": "Cum ajunge piesa la tine.",
    "shipping.hero.lede": "Ultima actualizare: 5 iulie 2026. Fiecare comanda e pregatita cu grija — iata la ce sa te astepti dupa ce plasezi comanda.",
    "shipping.s1.title": "1. Procesarea comenzii",
    "shipping.s1.body": "Dupa ce comanda este confirmata, o pregatim si o predam curierului in termen de 1-2 zile lucratoare. Vei primi un email cu numarul comenzii imediat dupa checkout.",
    "shipping.s2.title": "2. Curieri",
    "shipping.s2.bodyPre": "Lucram cu ",
    "shipping.s2.bodyPost": " pentru livrarea comenzilor. Numarul de urmarire (AWB) iti va fi comunicat pe email dupa ce comanda este expediata.",
    "shipping.s3.title": "3. Intarzieri",
    "shipping.s3.body": "Termenele de mai sus sunt estimative si pot varia in functie de curier, sezon sau locatie. Nu raspundem pentru intarzieri cauzate de evenimente in afara controlului nostru direct.",
    "shipping.s4.title": "4. Comanda nu a ajuns sau are probleme",
    "shipping.s4.bodyPre": "Daca AWB-ul arata livrat dar nu ai primit coletul, sau piesa a ajuns deteriorata, scrie-ne cat mai repede la ",
    "shipping.s4.bodyPost": " cu numarul comenzii.",
    "shipping.cta.title": "Ai o comanda in drum spre tine?",
    "shipping.cta.button": "Contacteaza-ne",
    "returns.hero.kicker": "Retur",
    "returns.hero.title": "Politica de retur.",
    "returns.hero.lede": "Ultima actualizare: 5 iulie 2026. Vrem sa fii sigur pe alegerea ta — daca o piesa nu e potrivita, iata cum o returnezi.",
    "returns.s1.title": "1. Dreptul de retur",
    "returns.s1.body": "Ai dreptul de a returna produsele in 14 zile calendaristice de la primirea comenzii, fara sa fie nevoie sa justifici motivul, conform legislatiei privind protectia consumatorului.",
    "returns.s2.title": "2. Conditii pentru retur",
    "returns.s2.body": "Produsele trebuie sa fie nepurtate, nespalate, cu toate etichetele originale atasate si in ambalajul original, acolo unde este posibil. Fiind piese in editie limitata, un produs deteriorat sau uzat nu poate fi acceptat la retur.",
    "returns.s3.title": "3. Cum initiezi un retur",
    "returns.s3.bodyPre": "Scrie-ne la ",
    "returns.s3.bodyPost": " cu numarul comenzii (format BC-0000) si produsul pe care vrei sa-l returnezi. Iti vom trimite instructiunile de retur in maximum 24 de ore lucratoare.",
    "returns.s4.title": "4. Rambursarea",
    "returns.s4.body": "Dupa ce primim si verificam produsul returnat, rambursarea se face in maximum 14 zile calendaristice, folosind aceeasi metoda de plata utilizata la comanda.",
    "returns.s5.title": "5. Costul returului",
    "returns.cta.title": "Ai intrebari despre un retur?",
    "returns.cta.button": "Contacteaza-ne",
    "orders.loading": "Se incarca comenzile...",
    "thankYou.loading": "Se incarca comanda...",
    "orders.hero.kicker": "Cont",
    "orders.hero.title": "Comenzile mele.",
    "orders.hero.lede": "Statusul si istoricul comenzilor tale BeCa, cu link direct catre factura fiecareia.",
    "hero.kicker": "BECA",
    "hero.dropLabel": "Drop 001",
    "hero.title": "Streetwear premium, facut sa fie vazut.",
    "hero.body": "Printuri indraznete, bumbac gros, numere limitate — fara restock, niciodata. Roteste tricoul 3D, apoi asigura-ti accesul devreme inainte de lansarea publica.",
    "hero.primary": "Cumpara colectia",
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
    "cart.payLater": "Platesc mai tarziu",
    "cart.cardDetails": "Detalii card",
    "cart.payNow": "Plateste acum",
    "checkout.trustNote": "Comanda ta se inregistreaza in moneda afisata la finalizarea comenzii. Datele tale sunt folosite doar pentru procesarea acestei comenzi.",
    "checkout.paymentTrustNote": "Detaliile cardului sunt introduse direct la Square si nu ajung niciodata pe serverele noastre.",
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
    "quality.card3.title": "Serii mici, intentionat",
    "quality.card3.body": "Printam in serii mici intentionat, ca fiecare drop sa ramana special.",
    "design.kicker": "Directie de design",
    "design.title": "Grafica noua. Energie indrazneata. Piese pe care chiar le porti.",
    "design.body": "Fiecare lansare porneste de la o singura idee — un simbol, o stare, o tipografie. Scopul: piese care lovesc tare la lansare si inca functioneaza luni mai tarziu.",
    "design.note1.title": "Artwork original",
    "design.note1.body": "Fiecare print e desenat in casa, drop cu drop. Nimic reciclat, nimic generic.",
    "design.note2.title": "Usor de stilizat",
    "design.note2.body": "Construite in jurul negrului, albului si accentelor grafice care merg in orice outfit.",
    "drop.kicker": "Drop 001",
    "drop.title": "Cumpara dropul curent.",
    "drop.promo": "Primele 30 de comenzi primesc 10% reducere — cod BECA10",
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
    "trust.payment": "Comanda verificata si confirmata de echipa noastra",
    "contact.kicker": "Nu rata",
    "contact.title": "Acces devreme la fiecare drop nou.",
    "contact.button": "Acces devreme",
    "contact.account": "Deschide contul meu",
    "footer.tagline": "Streetwear premium, facut in Romania.",
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
    "account.dangerZone": "Zona de risc",
    "account.deleteAccount": "Sterge contul meu",
    "account.deleteAccountNote": "Aceasta actiune iti sterge permanent datele de login si profilul. Comenzile anterioare raman pastrate pentru evidenta contabila/legala, exact cum este descris in politica de confidentialitate.",
    "account.deleteAccountButton": "Sterge contul meu",
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

    // --- cart / checkout / order-confirmation pages ---
    "cart.goToCart": "Mergi la cos",
    "steps.cart": "Cos",
    "steps.checkout": "Checkout",
    "steps.confirmation": "Confirmare",
    "cart.pageTitle": "Cosul tau",
    "cart.summary": "Sumar comanda",
    "cart.subtotal": "Subtotal",
    "cart.shipping": "Livrare",
    "cart.shippingFree": "Gratuita",
    "cart.discount": "Reducere",
    "cart.total": "Total",
    "cart.proceedToCheckout": "Continua spre checkout",
    "cart.continueShopping": "Continua cumparaturile",
    "cart.emptyTitle": "Cosul tau este gol",
    "cart.emptyBody": "Nu ai nicio piesa selectata inca. Descopera cel mai nou drop si gaseste ceva ce vei purta des.",
    "cart.clearCart": "Goleste cosul",
    "checkout.pageTitle": "Checkout",
    "checkout.contactInfo": "Informatii de contact",
    "checkout.shippingAddress": "Adresa de livrare",
    "checkout.delivery": "Livrare",
    "checkout.payment": "Plata",
    "checkout.country": "Tara",
    "checkout.fullName": "Nume complet",
    "checkout.apartment": "Apartament / bloc (optional)",
    "checkout.city": "Oras",
    "checkout.county": "Judet / Regiune",
    "checkout.postalCode": "Cod postal",
    "checkout.deliveryStandardName": "Livrare standard",
    "confirmation.title": "Comanda confirmata",
    "confirmation.message": "Multumim — comanda ta a fost plasata cu succes. Un email de confirmare este pe drum.",
    "privacy.hero.kicker": "Legal",
    "privacy.hero.title": "Politica de confidentialitate.",
    "privacy.hero.lede": "Ultima actualizare: 5 iulie 2026. Explicam ce date colectam, de ce, si ce drepturi ai asupra lor.",
    "privacy.s1.title": "1. Cine este operatorul datelor",
    "privacy.s1.body": "BeCa Online shop, societate inregistrata in Marea Britanie, cu sediul la 59 Woodward Road, Rock Ferry, Birkenhead, CH42 1QE, Marea Britanie, este operatorul datelor tale personale colectate prin acest site. Pentru orice intrebare legata de datele tale, ne poti scrie la contact@beca-wlf.com.",
    "privacy.s2.title": "2. Ce date colectam",
    "privacy.s2.body": "Date de cont (nume, email, parola stocata sub forma de hash securizat), date de comanda (nume, email, telefon, adresa de livrare) si date tehnice de trafic (adresa IP anonimizata, pagina accesata, ora vizitei) — detaliate la punctul 8. Pe acest site nu se colecteaza date de card.",
    "privacy.s3.title": "3. De ce colectam aceste date",
    "privacy.s3.body": "Folosim datele tale exclusiv pentru a procesa comenzi, a-ti gestiona contul, a raspunde solicitarilor de suport si a respecta obligatii legale (contabilitate, retururi). Nu vindem si nu inchiriem datele tale catre terti in scop de marketing.",
    "privacy.s4.title": "4. Cu cine impartasim datele",
    "privacy.s4.body": "Datele de livrare pot fi transmise curierului ales pentru finalizarea livrarii. Nu impartasim date cu alti terti in afara celor strict necesare pentru livrarea comenzii. Pe acest site nu se proceseaza plati cu cardul.",
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
    "support.emailLabel": "Email",
    "support.email": "contact@beca-wlf.com",
    "support.phoneLabel": "Telefon",
    "support.phone": "+44 7534 490485",
    "support.hoursLabel": "Program suport",
    "support.hours": "Luni – Vineri, 10:00 – 18:00",
    "support.responseTimeLabel": "Timp de raspuns",
    "support.responseTime": "De obicei in maximum 24 de ore lucratoare",
    "shipping.zonesLabel": "Zone acoperite",
    "shipping.timeLabel": "Termen estimativ",
    "shipping.time": "2-5 zile lucratoare de la confirmarea comenzii",
    "shipping.costLabel": "Cost livrare",
    "privacy.s2.accountLabel": "Date de cont",
    "privacy.s2.accountBody": "Nume, email, parola stocata ca hash securizat — cand iti creezi un cont.",
    "privacy.s2.orderLabel": "Date de comanda",
    "privacy.s2.orderBody": "Nume, email, telefon, adresa de livrare — cand plasezi o comanda.",
    "privacy.s2.paymentLabel": "Date de plata",
    "privacy.s2.paymentBody": "Pe acest site nu se colecteaza si nu se proceseaza date de card. Comanda este verificata si confirmata de echipa noastra.",
    "privacy.s2.technicalLabel": "Date tehnice",
    "privacy.s2.technicalBody": "Adresa IP, pagina si ora vizitei — la fiecare accesare a site-ului. Vezi punctul 8.",
    "cookies.session.body": "Retine contul in care esti logat. Expira automat dupa 7 zile.",
    "cookies.cart.body": "Retine produsele din cosul tau intre vizite. Expira automat dupa 30 de zile.",
    "error404.kicker": "Eroare 404",
    "error404.message": "Pagina pe care o cauti a disparut, exact ca stocul nostru dupa fiecare drop. Verifica adresa sau intoarce-te la ultima colectie, inainte sa dispara si aia.",
    "error404.home": "Inapoi acasa",
    "error404.drop": "Vezi dropul",
    "cookies.hero.kicker": "Cookie-uri",
    "cookies.hero.title": "Politica de cookie-uri.",
    "cookies.hero.lede": "Ultima actualizare: 5 iulie 2026. Folosim un numar minim de cookie-uri, strict necesare functionarii site-ului.",
    "cookies.s1.title": "1. Ce este un cookie",
    "cookies.s1.body": "Un cookie este un fisier text mic, salvat in browserul tau, care ajuta site-ul sa retina informatii intre vizite — de exemplu, ca esti logat sau ce ai adaugat in cos.",
    "cookies.s2.title": "2. Ce cookie-uri folosim",
    "cookies.s2.body": "Folosim exclusiv cookie-uri strict necesare functionarii site-ului. Nu folosim cookie-uri de marketing, publicitate sau analytics bazate pe terti.",
    "cookies.s3.title": "3. De ce nu cerem consimtamant separat",
    "cookies.s3.body": "Cookie-urile de mai sus sunt strict necesare pentru functionarea contului si a cosului de cumparaturi, motiv pentru care, conform legislatiei aplicabile cookie-urilor tehnice, nu necesita un banner separat de consimtamant.",
    "cookies.s4.title": "4. Cum poti controla cookie-urile",
    "cookies.s4.body": "Poti sterge sau bloca cookie-urile din setarile browserului tau in orice moment. Retine ca blocarea cookie-urilor strict necesare poate afecta functionarea contului si a cosului de cumparaturi.",
    "cookies.s5.title": "5. Analiza traficului (fara cookie-uri)",
    "cookies.s5.bodyPre": "Pe langa cookie-urile de mai sus, serverul nostru inregistreaza automat cateva date tehnice la fiecare vizita — adresa IP, pagina accesata si ora vizitei — fara sa foloseasca niciun cookie. Aceste date sunt folosite intern pentru statistici de trafic si comenzi, nu pentru publicitate. Detalii complete gasesti in ",
    "cookies.s5.link": "Politica de confidentialitate",
    "cookies.s5.bodyPost": ", punctul 8.",
    "cookies.s6.title": "6. Modificari ale acestei politici",
    "cookies.s6.body": "Putem actualiza aceasta politica periodic. Versiunea in vigoare este intotdeauna cea publicata pe aceasta pagina.",
    "cookies.cta.title": "Ai intrebari despre cookie-uri?",
    "cookies.cta.button": "Contacteaza-ne",
    "support.before.title": "Inainte sa ne scrii",
    "support.before.body": "Multe intrebari au deja raspuns in sectiunea de Intrebari frecvente. Daca ai nevoie de ajutor cu o comanda existenta, ai numarul comenzii (format BC-0000) la indemana, ca sa te putem ajuta mai rapid.",
    "support.merchant.title": "Date despre comerciant",
    "support.merchant.body": "BeCa Online shop, societate inregistrata in Marea Britanie, cu sediul la 59 Woodward Road, Rock Ferry, Birkenhead, CH42 1QE, Marea Britanie.",
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
  ,

    // --- profile menu ---
    "nav.profile": "Profilul meu",
    "nav.myOrders": "Comenzile mele",
    "nav.adminPanel": "Panou admin",
    "nav.settings": "Setari",
    "nav.privacy": "Confidentialitate si securitate",
    "nav.help": "Ajutor si suport",
    "nav.logout": "Deconectare"
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

// Active languages, fetched once below - lets detectLanguage()/setLanguage()
// generalize beyond the old hardcoded "en"/"ro" checks. Until the fetch
// resolves, isKnownLanguageCode()/defaultLanguageCode() fall back to
// exactly today's behavior, so nothing regresses before it loads.
let languagesCache = null;

function isKnownLanguageCode(code) {
  if (!code) return false;
  if (languagesCache) return languagesCache.some((entry) => entry.code === code && entry.active);
  return code === "en" || code === "ro";
}

function defaultLanguageCode() {
  const found = languagesCache?.find((entry) => entry.isDefault);
  return found?.code || "en";
}

// Replaces the static per-page [data-lang] EN/RO buttons inside every
// [aria-label="Language"] container (.language-switch, .mobile-language-row
// - both already share this attribute across every page, so no HTML edit
// is needed here) with one button per active language. A no-op until
// languagesCache has loaded, and a no-op again once the rendered buttons
// already match the active set (avoids rebuilding - and losing focus/
// animation state on - a switcher that hasn't actually changed).
function renderLanguageSwitchers() {
  if (!languagesCache) return;
  const activeLanguages = languagesCache.filter((entry) => entry.active);
  document.querySelectorAll('[aria-label="Language"]').forEach((container) => {
    if (!container.querySelector("[data-lang]")) return;
    const currentCodes = [...container.querySelectorAll("[data-lang]")].map((button) => button.dataset.lang);
    const activeCodes = activeLanguages.map((entry) => entry.code);
    if (currentCodes.length === activeCodes.length && activeCodes.every((code) => currentCodes.includes(code))) return;
    container.innerHTML = "";
    activeLanguages.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.lang = entry.code;
      button.setAttribute("aria-pressed", "false");
      button.textContent = entry.code.toUpperCase();
      container.appendChild(button);
    });
  });
}

function detectLanguage() {
  // A brand page can pin its language (<html data-force-lang="en">),
  // overriding both the visitor's saved choice and auto-detection -
  // used by single-language brand instances (e.g. ÆTHER ORIGIN is
  // English-only). Brands without the attribute behave as before.
  const forced = document.documentElement.dataset.forceLang;
  if (isKnownLanguageCode(forced)) return forced;

  const saved = localStorage.getItem("beca-language");
  const source = localStorage.getItem("beca-language-source");
  if (source === "manual" && isKnownLanguageCode(saved)) {
    return saved;
  }

  const profile = window.BecaRegion?.detect?.();
  if (profile?.language) return profile.language;

  return defaultLanguageCode();
}

function setLanguage(language, options = {}) {
  const activeLanguage = copy[language] ? language : defaultLanguageCode();
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
applyLiquidGlass();

function applyBrandingImages(branding) {
  if (!branding) return;
  document.querySelectorAll("[data-content-img]").forEach((element) => {
    const key = element.dataset.contentImg;
    if (branding[key]) element.src = branding[key];
  });
}

Promise.all([
  fetch("/api/languages").then((response) => (response.ok ? response.json() : null)).catch(() => null),
  fetch("/api/content").then((response) => (response.ok ? response.json() : null)).catch(() => null)
])
  .then(async ([languagesData, data]) => {
    languagesCache = Array.isArray(languagesData?.languages) ? languagesData.languages : null;
    renderLanguageSwitchers();

    if (!data) return;

    // One override fetch per active language (falls back to en/ro if the
    // languages list itself failed to load) - the translations table is a
    // flat key/value layer on top of content.json's structured per-section
    // fields, for copy that schema doesn't cover (see lib/db.js's
    // translations table comment). Brand copy overrides stay on top of
    // both - the brand voice keys (trust strip, scarcity wording) are
    // fixed rules, not editable copy.
    const activeCodes = languagesCache?.filter((entry) => entry.active).map((entry) => entry.code) || ["en", "ro"];
    const translationsByLang = {};
    await Promise.all(activeCodes.map((code) =>
      fetch(`/api/translations?lang=${encodeURIComponent(code)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => { translationsByLang[code] = (payload && payload.translations) || {}; })
        .catch(() => { translationsByLang[code] = {}; })
    ));

    const nextCopy = {};
    activeCodes.forEach((code) => {
      nextCopy[code] = {
        ...(defaultCopy[code] || defaultCopy.en),
        ...(data[code] || {}),
        ...(translationsByLang[code] || {}),
        ...(window.__BRAND_COPY__?.[code] || {})
      };
    });
    copy = nextCopy;

    setLanguage(detectLanguage(), { source: "auto" });
    applyBrandingImages(data.branding);
  })
  .catch(() => {});
let glassResizeTimer;

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lang]");
  if (!button) return;
  setLanguage(button.dataset.lang, { source: "manual" });
  requestAnimationFrame(applyLiquidGlass);
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
  if (event.key !== "Escape") return;
  setMobileMenu(false);
  // The hero login/register panel opens over the page like the menu does, so
  // Escape should dismiss it too rather than leaving it as the one overlay
  // that can only be closed by clicking.
  closeHeroAuth();
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
