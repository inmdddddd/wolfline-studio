const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

// Minimal local-only .env loader (no npm dependency). Real hosting env vars
// (e.g. Render's Environment Variables panel) are set before the process
// starts and always take precedence over .env - this only fills gaps.
//
// BECA_TEST_MODE (set once, process-wide, by test/setup-env.js - every test
// file requires that as a --require preload before its own code runs) skips
// this file entirely. Without that guard, running the suite from inside an
// actual deployment - where a real .env with real secrets sits right next to
// this file - lets any test that clears a var (most do, between scenarios,
// via `delete process.env.X` + a fresh require) silently pull the real value
// back in on its next require("./server.js"), no matter what that test set
// via its own overrides. This is a hard stop, not a per-key allowlist,
// because the failure mode here is "a real secret leaked into a test",
// which a missed key in an allowlist would reproduce just as easily as
// having no guard at all.
(function loadDotEnv() {
  if (process.env.BECA_TEST_MODE) return;
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, "utf8").split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) return;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  });
})();

const email = require("./lib/email");
const square = require("./lib/square");
const { createStorage } = require("./lib/storage");
const { createDb } = require("./lib/db");

// White-label support: this whole codebase (engine, data model, admin, email
// logic) is shared across brands. What differs per brand is: which JSON config
// it loads (name, taglines, legal placeholders, theme colors), which folder it
// serves static files from, and where its data lives. Each brand runs as its
// own process (own BRAND/DATA_DIR/PORT), never two brands in one process, so
// there is no per-request brand switching to get wrong - it's picked once at
// boot from process.env.BRAND and everything below derives from it.
const root = __dirname;
const rootResolved = path.resolve(root);
const BRAND_ID = String(process.env.BRAND || "beca").trim().toLowerCase();

function loadBrandConfig(brandId) {
  const configPath = path.join(root, "config", "brands", `${brandId}.json`);
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Nu pot incarca configul de brand pentru "${brandId}" (${configPath}): ${error.message}`);
  }
}

const BRAND = loadBrandConfig(BRAND_ID);

// Legal/company fields still holding "[COMPLETE...]" placeholders. Surfaced
// as a warning in the admin dashboard; in production it is also logged as a
// critical warning at startup.
function brandLegalPlaceholders() {
  return ["legalCompanyName", "companyNumber", "companyAddress", "supportEmail", "domain"]
    .filter((field) => {
      const value = String(BRAND[field] || "").trim();
      return !value || /\[COMPLET/i.test(value);
    });
}

const GENEALOGY = BRAND.genealogy?.enabled ? BRAND.genealogy : null;
const GENEALOGY_CHAPTERS = Array.isArray(GENEALOGY?.chapters)
  ? GENEALOGY.chapters
      .filter((chapter) => chapter && chapter.id)
      .map((chapter) => ({
        id: String(chapter.id).trim().toLowerCase(),
        number: String(chapter.number || "").padStart(3, "0"),
        name: String(chapter.name || "").trim(),
        subtitle: String(chapter.subtitle || "").trim(),
        description: String(chapter.description || "").trim(),
        status: ["sealed", "open", "closed"].includes(chapter.status) ? chapter.status : "sealed",
        displayOrder: Math.max(0, Number(chapter.display_order ?? chapter.displayOrder) || 0)
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder)
  : [];
const GENEALOGY_CHAPTER_IDS = new Set(GENEALOGY_CHAPTERS.map((chapter) => chapter.id));

function genealogyChapter(chapterId) {
  return GENEALOGY_CHAPTERS.find((chapter) => chapter.id === String(chapterId || "").toLowerCase()) || null;
}

function openGenealogyChapter() {
  return GENEALOGY_CHAPTERS.find((chapter) => chapter.status === "open") || null;
}

function productChapterId(product) {
  return String(product?.chapterId || product?.chapter_id || "origin").toLowerCase();
}

function productChapterOrder(product) {
  const value = Number(product?.chapterProductOrder ?? product?.chapter_product_order ?? 999);
  return Number.isFinite(value) && value >= 0 ? value : 999;
}

function productBelongsToOpenChapter(product) {
  if (!GENEALOGY) return true;
  const openChapter = openGenealogyChapter();
  return Boolean(openChapter && productChapterId(product) === openChapter.id);
}

function productCanBePurchased(product) {
  return product?.status === "live" && productBelongsToOpenChapter(product) && Number(product.stock) > 0;
}

function sortGenealogyProducts(a, b) {
  const orderDifference = productChapterOrder(a) - productChapterOrder(b);
  if (orderDifference) return orderDifference;
  const createdDifference = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  if (createdDifference) return createdDifference;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

// A brand's own public/ directory (BeCa's is "." - the project root itself,
// so this is a no-op and BeCa's file resolution is byte-for-byte unchanged).
const publicRoot = path.resolve(root, BRAND.publicDir || ".");
const publicRootResolved = path.resolve(publicRoot);

// Brands share one .env on a single-host deploy, but several settings must not
// be shared: pointing two brands at one DATA_DIR means the second one serves
// the first one's products and orders. A `<KEY>_<BRAND>` variable therefore
// wins over the plain `<KEY>`, so `DATA_DIR_AETHER=/var/data/aether` can sit
// next to BeCa's `DATA_DIR` in the same file.
const BRAND_ENV_SUFFIX = BRAND_ID.toUpperCase().replace(/[^A-Z0-9]/g, "_");

function brandEnv(key) {
  const scoped = process.env[`${key}_${BRAND_ENV_SUFFIX}`];
  if (typeof scoped === "string" && scoped.trim() !== "") return scoped;
  return process.env[key];
}

const dataDir = brandEnv("DATA_DIR")
  ? path.resolve(brandEnv("DATA_DIR"))
  : path.join(root, BRAND_ID === "beca" ? "data" : `data-${BRAND_ID}`);
// Rolling local snapshots of dataDir (see backupDataFiles below). Sibling of
// dataDir so it follows DATA_DIR overrides; brand-suffixed for every brand
// except BeCa so two brands with default DATA_DIRs never share a folder.
const backupsDir = path.join(dataDir, "..", BRAND_ID === "beca" ? "backups" : `backups-${BRAND_ID}`);
const storage = createStorage({ dataDir, backupsDir });
// users, sessions, products, orders (+items/history/editions/payments/email_logs)
// live in here now - everything else stays on storage's JSON files, above.
const dbPath = path.join(dataDir, `${BRAND_ID}.db`);
const db = createDb({ dbPath });
const uploadDir = brandEnv("UPLOAD_DIR") ? path.resolve(brandEnv("UPLOAD_DIR")) : path.join(publicRoot, "assets", "products");
const uploadDirResolved = path.resolve(uploadDir);
const uploadPublicBase = (brandEnv("UPLOAD_PUBLIC_BASE") || "assets/products").replace(/^\/+|\/+$/g, "");
const uploadRoutePrefix = `/${uploadPublicBase}/`;
const port = Number(brandEnv("PORT") || 4188);
const host = process.env.HOST || "0.0.0.0";
const sessionCookie = "beca_session";
const cartCookie = "beca_cart";
const primaryAdminEmail = BRAND.primaryAdminEmailDefault;
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const cartTtlMs = 1000 * 60 * 60 * 24 * 30;

// How long a pending, unpaid order keeps its stock reserved before it is
// auto-cancelled and the stock restored. Configurable per deployment.
const STOCK_RESERVATION_MS = Math.max(1, Number(process.env.STOCK_RESERVATION_HOURS) || 72) * 60 * 60 * 1000;
// Analytics/PII retention (days).
const ANALYTICS_RETENTION_DAYS = Math.max(1, Number(process.env.ANALYTICS_RETENTION_DAYS) || 90);
const OUTBOX_RETENTION_DAYS = Math.max(1, Number(process.env.OUTBOX_RETENTION_DAYS) || 90);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

let generatedAdminPassword = null;
let generatedAdminEmail = null;

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDirResolved, { recursive: true });

  if (db.countUsers().total === 0) {
    const adminEmail = normalizeEmail(brandEnv("ADMIN_EMAIL") || primaryAdminEmail);
    const adminPassword = brandEnv("ADMIN_PASSWORD") || crypto.randomBytes(12).toString("base64url");
    if (!brandEnv("ADMIN_PASSWORD")) {
      generatedAdminPassword = adminPassword;
      generatedAdminEmail = adminEmail;
    }

    const admin = createUserRecord({
      email: adminEmail,
      name: BRAND.adminDisplayName,
      password: adminPassword,
      role: "admin",
      emailVerified: true,
      isPrimaryAdmin: true
    });
    db.insertUser(admin);
  }

  if (db.countProducts().total === 0) {
    // Not run through sanitizeProduct(): that function enforces the
    // admin-submission rule that a genealogy brand's new product must name a
    // chapter explicitly. The seed product predates any chapter choice by
    // design, so - like every other legacy/system-generated product -
    // defaults to "origin" via productChapterId()'s own fallback, the same
    // default migrateGenealogyData() used to backfill for it.
    const seed = BRAND.seedProduct;
    const seedSizes = Array.isArray(seed.sizes) ? seed.sizes : [];
    const now = new Date().toISOString();
    db.upsertProduct({
      id: crypto.randomUUID(),
      slug: toSlug(seed.name),
      name: String(seed.name || ""),
      nameRo: seed.nameRo || "",
      nameEn: seed.nameEn || "",
      category: seed.category || "",
      status: seed.status || "draft",
      price: Number(seed.price) || 0,
      currency: seed.currency || "GBP",
      stock: Number(seed.stock) || 0,
      sizeStock: seedSizes.length ? distributeStockAcrossSizes(Math.max(0, Math.floor(Number(seed.stock) || 0)), seedSizes) : undefined,
      sizes: seedSizes,
      imageUrl: seed.imageUrl || "",
      color: seed.color || "",
      description: seed.description || "",
      chapterId: "origin",
      chapterProductOrder: 999,
      createdAt: now,
      updatedAt: now
    });
  }

  if (!fs.existsSync(path.join(dataDir, "notifications.json"))) {
    writeJson("notifications.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "carts.json"))) {
    writeJson("carts.json", {});
  }

  if (!fs.existsSync(path.join(dataDir, "content.json"))) {
    writeJson("content.json", { en: {}, ro: {}, branding: {} });
  }

  if (!fs.existsSync(path.join(dataDir, "analytics.json"))) {
    writeJson("analytics.json", { totalPageviews: 0, byDay: {} });
  }

  if (!fs.existsSync(path.join(dataDir, "email-outbox.json"))) {
    writeJson("email-outbox.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "password-resets.json"))) {
    writeJson("password-resets.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "email-verifications.json"))) {
    writeJson("email-verifications.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "wishlists.json"))) {
    writeJson("wishlists.json", {});
  }

  if (!fs.existsSync(path.join(dataDir, "reviews.json"))) {
    writeJson("reviews.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "coupons.json"))) {
    writeJson("coupons.json", []);
  }

  // products.json's sizeStock backfill was removed here: products are
  // SQLite-native now (upsertProduct always computes sizeStock at write
  // time), so the JSON shape this pass repaired can no longer exist.
  migrateLegacyContentClaims();

  // orders.json's legacy-shape migration (completed->delivered rename,
  // paymentStatus/fulfillment/statusHistory backfill) was removed here for
  // the same reason as products' above: orders are SQLite-native now, and
  // the schema's NOT NULL columns make the shape it repaired impossible.

  // The "primary admin" gate used to compare user.email against a hardcoded
  // "admin@beca.local" string. Once that account's email is changed (e.g. to
  // receive real SMTP mail), the comparison silently stops matching anyone and
  // role management becomes unusable. Back it with a persistent flag instead,
  // assigned once here to whichever admin account is oldest if nothing already
  // holds it - this covers accounts created before this flag existed.
  if (db.countUsers().total > 0 && !db.anyAdminHasPrimaryFlag()) {
    const primary = db.oldestAdminUser();
    if (primary) db.updateUser(primary.id, { isPrimaryAdmin: true });
  }
}

// A deployed content.json can still hold the old false commercial claims
// (Stripe, "100% secure payment", "encrypted"), which would override the
// corrected page defaults. Replace ONLY exact matches of the known legacy
// strings with the corrected wording - custom admin copy is never touched.
const LEGACY_CLAIM_REPLACEMENTS = {
  en: {
    "trust.payment": [
      ["100% secure payment", "Order verified & confirmed by our team"]
    ],
    "checkout.trustNote": [
      ["Your details are encrypted and used only to process this order.",
        "Orders are recorded in GBP; prices shown in other currencies are indicative. Your details are used only to process this order."]
    ],
    "privacy.s2.body": [
      ["Account data (name, email, encrypted password), order data (name, email, phone, delivery address) and payment data (processed directly by Stripe; we do not store card numbers).",
        "Account data (name, email, password stored as a secure hash), order data (name, email, phone, delivery address) and technical traffic data (anonymized IP address, page visited, time of visit). No card details are collected on this site."]
    ],
    "privacy.s4.body": [
      ["Payment data is processed by Stripe, under Stripe's own privacy policy. Delivery data may be passed to the chosen courier to complete delivery. We do not share data with other third parties beyond what is strictly necessary to deliver your order and process payment.",
        "Delivery data may be passed to the chosen courier to complete delivery. We do not share data with other third parties beyond what is strictly necessary to deliver your order. No card payments are processed on this site."]
    ]
  },
  ro: {
    "trust.payment": [
      ["Plata 100% securizata", "Comanda verificata si confirmata de echipa noastra"]
    ],
    "checkout.trustNote": [
      ["Datele tale sunt criptate si folosite doar pentru procesarea acestei comenzi.",
        "Comanda se inregistreaza in GBP; preturile afisate in alte monede sunt orientative. Datele tale sunt folosite doar pentru procesarea acestei comenzi."]
    ],
    "privacy.s2.body": [
      ["Date de cont (nume, email, parola criptata), date de comanda (nume, email, telefon, adresa de livrare) si date de plata (procesate direct de Stripe; noi nu stocam numere de card).",
        "Date de cont (nume, email, parola stocata sub forma de hash securizat), date de comanda (nume, email, telefon, adresa de livrare) si date tehnice de trafic (adresa IP anonimizata, pagina accesata, ora vizitei). Pe acest site nu se colecteaza date de card."]
    ],
    "privacy.s4.body": [
      ["Datele de plata sunt procesate de Stripe, conform politicii proprii de confidentialitate a Stripe. Datele de livrare pot fi transmise curierului ales pentru finalizarea livrarii. Nu impartasim date cu alti terti in afara celor strict necesare pentru livrarea comenzii si procesarea platii.",
        "Datele de livrare pot fi transmise curierului ales pentru finalizarea livrarii. Nu impartasim date cu alti terti in afara celor strict necesare pentru livrarea comenzii. Pe acest site nu se proceseaza plati cu cardul."]
    ]
  }
};

function migrateLegacyContentClaims() {
  try {
    const content = readJson("content.json", null);
    if (!content || typeof content !== "object") return;

    let changed = false;
    for (const [lang, keys] of Object.entries(LEGACY_CLAIM_REPLACEMENTS)) {
      const dictionary = content[lang];
      if (!dictionary || typeof dictionary !== "object") continue;
      for (const [key, replacements] of Object.entries(keys)) {
        for (const [oldValue, newValue] of replacements) {
          if (dictionary[key] === oldValue) {
            dictionary[key] = newValue;
            changed = true;
          }
        }
      }
    }
    if (changed) writeJson("content.json", content);
  } catch (error) {
    console.error("[content-migration]", error);
  }
}

function migrateGenealogyData() {
  if (!GENEALOGY) return { enabled: false, updated: 0 };

  const products = readJson("products.json", []);
  let updated = 0;
  const migratedProducts = products.map((product) => {
    const currentChapterId = productChapterId(product);
    const chapterId = GENEALOGY_CHAPTER_IDS.has(currentChapterId) ? currentChapterId : "origin";
    const chapterProductOrder = productChapterOrder(product);
    const alreadyMigrated = product.chapterId === chapterId
      && product.chapterProductOrder === chapterProductOrder
      && product.chapter_id === undefined
      && product.chapter_product_order === undefined;
    if (alreadyMigrated) return product;
    updated += 1;
    const next = { ...product, chapterId, chapterProductOrder };
    delete next.chapter_id;
    delete next.chapter_product_order;
    return next;
  });

  if (updated) writeJson("products.json", migratedProducts);
  return { enabled: true, updated, total: migratedProducts.length };
}

// All JSON persistence goes through lib/storage.js: missing files fall back,
// corrupt files are never silently replaced with an empty fallback (they are
// preserved, restored from the newest valid backup when possible, or the
// operation fails with a server error), and writes are atomic + fsynced.
function readJson(fileName, fallback) {
  return storage.readJson(fileName, fallback);
}

function writeJson(fileName, data) {
  storage.writeJson(fileName, data);
}

function isTrackablePageRequest(pathname) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/admin/")) return false;
  const extension = path.extname(pathname);
  return extension === "" || extension === ".html";
}

// Pageviews are buffered in memory and flushed on a timer rather than written
// per request: writeJson is synchronous through fsync, so a read-modify-write
// of analytics.json on every HTML hit let an unauthenticated request flood
// stall the whole process. Buffering costs at most PAGEVIEW_FLUSH_MS of
// analytics on an unclean kill; admin reads flush first, so the dashboard
// never shows stale numbers.
const PAGEVIEW_FLUSH_MS = 10000;
const PAGEVIEW_BUFFER_LIMIT = 200;
let pendingPageviews = [];

function flushPageviews() {
  if (!pendingPageviews.length) return;
  // Swap first: a throw below must not replay this batch on the next flush.
  const batch = pendingPageviews;
  pendingPageviews = [];

  try {
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {}, recentVisits: [] });
    analytics.byDay = analytics.byDay || {};
    analytics.recentVisits = analytics.recentVisits || [];

    batch.forEach((visit) => {
      analytics.totalPageviews = (analytics.totalPageviews || 0) + 1;

      if (!analytics.byDay[visit.day]) {
        analytics.byDay[visit.day] = { pageviews: 0, paths: {}, referrers: {}, hours: new Array(24).fill(0), locales: {} };
      }
      const dayEntry = analytics.byDay[visit.day];
      dayEntry.pageviews += 1;
      dayEntry.paths[visit.path] = (dayEntry.paths[visit.path] || 0) + 1;
      dayEntry.hours = dayEntry.hours || new Array(24).fill(0);
      dayEntry.hours[visit.hour] = (dayEntry.hours[visit.hour] || 0) + 1;
      dayEntry.referrers = dayEntry.referrers || {};
      dayEntry.referrers[visit.referrer] = (dayEntry.referrers[visit.referrer] || 0) + 1;
      dayEntry.locales = dayEntry.locales || {};
      dayEntry.locales[visit.locale] = (dayEntry.locales[visit.locale] || 0) + 1;

      analytics.recentVisits.unshift({
        path: visit.path,
        ip: visit.ip,
        referrer: visit.referrer,
        locale: visit.locale,
        hour: visit.hour,
        at: visit.at
      });
    });

    analytics.recentVisits = analytics.recentVisits.slice(0, 300);
    writeJson("analytics.json", analytics);
  } catch (error) {
    console.error(error);
  }
}

setInterval(flushPageviews, PAGEVIEW_FLUSH_MS).unref();
process.once("exit", flushPageviews);

function trackPageview(pathname, request) {
  try {
    const now = new Date();

    const referrerHeader = String(request?.headers?.referer || request?.headers?.referrer || "").trim();
    let referrerSource = "direct";
    if (referrerHeader) {
      try {
        referrerSource = new URL(referrerHeader).hostname || "direct";
      } catch {
        referrerSource = "direct";
      }
    }

    pendingPageviews.push({
      path: pathname,
      day: now.toISOString().slice(0, 10),
      hour: now.getHours(),
      referrer: referrerSource,
      locale: String(request?.headers?.["accept-language"] || "").split(",")[0].trim() || "necunoscut",
      ip: request ? anonymizeIp(clientIp(request)) : "unknown",
      at: now.toISOString()
    });

    // Sustained traffic flushes on size instead of waiting for the timer, so
    // the buffer can't grow without bound between ticks.
    if (pendingPageviews.length >= PAGEVIEW_BUFFER_LIMIT) flushPageviews();
  } catch (error) {
    console.error(error);
  }
}

let stockLock = Promise.resolve();

function withStockLock(task) {
  const result = stockLock.then(task, task);
  stockLock = result.then(() => {}, () => {});
  return result;
}

function availableStock(product, size) {
  if (product.sizeStock && size) return Math.max(0, Math.floor(Number(product.sizeStock[size]) || 0));
  return Math.max(0, Math.floor(Number(product.stock) || 0));
}

function makeCartKey(productId, size) {
  return size ? `${productId}::${size}` : productId;
}

function parseCartKey(key) {
  const separatorAt = key.indexOf("::");
  return separatorAt === -1
    ? { productId: key, size: "" }
    : { productId: key.slice(0, separatorAt), size: key.slice(separatorAt + 2) };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored || "").split(":");
  if (!salt || !originalHash) return false;

  const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, "sha512");
  const original = Buffer.from(originalHash, "hex");

  return original.length === hash.length && crypto.timingSafeEqual(original, hash);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Baseline password policy: minimum 10 characters plus basic checks against
// trivially weak choices. Returns an error message or null when acceptable.
const COMMON_WEAK_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "parola1234",
  "1234567890", "12345678910", "qwertyuiop", "1q2w3e4r5t", "asdfghjkl1",
  "iloveyou123", "administrator", "welcome123", "letmein123", "abc1234567"
]);

function passwordPolicyError(password) {
  const value = String(password || "");
  if (value.length < 10) return "Parola trebuie sa aiba minimum 10 caractere.";
  if (/^(.)\1+$/.test(value)) return "Parola nu poate fi un singur caracter repetat.";
  if (COMMON_WEAK_PASSWORDS.has(value.toLowerCase())) return "Parola este prea comuna. Alege una mai greu de ghicit.";
  if (/^\d+$/.test(value)) return "Parola nu poate fi formata doar din cifre.";
  return null;
}

// Removes every other session belonging to the user; the current session id
// (when given) survives. Used after password changes/resets.
function invalidateUserSessions(userId, keepSessionId = null) {
  db.deleteOtherSessionsForUser(userId, keepSessionId);
}

function createUserRecord({ email, name, password, role, emailVerified = false, isPrimaryAdmin = false }) {
  return {
    id: crypto.randomUUID(),
    email: normalizeEmail(email),
    name: String(name || "").trim().slice(0, 80),
    role: role === "admin" ? "admin" : "client",
    passwordHash: hashPassword(password),
    emailVerified: Boolean(emailVerified),
    isPrimaryAdmin: Boolean(isPrimaryAdmin),
    createdAt: new Date().toISOString()
  };
}

function parseCookies(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const splitAt = item.indexOf("=");
      if (splitAt === -1) return cookies;
      cookies[decodeURIComponent(item.slice(0, splitAt))] = decodeURIComponent(item.slice(splitAt + 1));
      return cookies;
    }, {});
}

function readBody(request, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      body += chunk;
      if (size > limit) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });

    request.on("end", () => {
      const contentType = request.headers["content-type"] || "";

      try {
        if (contentType.includes("application/json")) {
          resolve(body ? JSON.parse(body) : {});
          return;
        }

        const form = new URLSearchParams(body);
        resolve(Object.fromEntries(form.entries()));
      } catch {
        reject(new Error("Invalid body"));
      }
    });
  });
}

function readBuffer(request, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Missing multipart boundary");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    if (buffer.slice(partStart, partStart + 2).toString() === "--") break;

    const headersStart = partStart + 2;
    const headersEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), headersStart);
    if (headersEnd === -1) break;

    const nextBoundary = buffer.indexOf(boundary, headersEnd + 4);
    if (nextBoundary === -1) break;

    const headersRaw = buffer.slice(headersStart, headersEnd).toString("utf8");
    const body = buffer.slice(headersEnd + 4, Math.max(headersEnd + 4, nextBoundary - 2));
    const disposition = headersRaw.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || "";
    const mime = headersRaw.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";

    if (name) {
      parts.push({ name, filename, mime, body });
    }

    cursor = nextBoundary;
  }

  return parts.reduce((form, part) => {
    if (part.filename) {
      form.files[part.name] = part;
    } else {
      form.fields[part.name] = part.body.toString("utf8");
    }
    return form;
  }, { fields: {}, files: {} });
}

// The multipart Content-Type header is attacker-controlled, so it can't decide
// what we store: a forged part could claim "image/png" over arbitrary bytes.
// Identify the format from the file's own signature instead and ignore the
// declared type entirely.
const IMAGE_SIGNATURES = [
  { mime: "image/png", extension: ".png", test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", extension: ".jpg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", extension: ".gif", test: (b) => b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a") },
  { mime: "image/webp", extension: ".webp", test: (b) => b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" }
];

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.test(buffer)) || null;
}

function saveProductImage(file) {
  if (!file || !file.body || file.body.length === 0) return "";

  const detected = detectImageType(file.body);

  if (!detected) {
    const error = new Error("Imagine invalida. Foloseste PNG, JPG, WEBP sau GIF.");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(uploadDirResolved, { recursive: true });
  const fileName = `${crypto.randomUUID()}${detected.extension}`;
  fs.writeFileSync(path.join(uploadDirResolved, fileName), file.body);
  return `${uploadPublicBase}/${fileName}`;
}

function fileToImageDataUrl(file) {
  if (!file || !file.body || file.body.length === 0) return "";
  // Same rule as saveProductImage: the bytes decide, not the declared mime -
  // otherwise a forged part could smuggle a non-image into a data: URL that
  // then gets stored as page content.
  const detected = detectImageType(file.body);
  if (!detected) return "";
  return `data:${detected.mime};base64,${file.body.toString("base64")}`;
}

function saveDataUrlImage(dataUrl, prefix = "studio") {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return "";

  const buffer = Buffer.from(match[2], "base64");

  if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
    const error = new Error("Imaginea generata este prea mare.");
    error.statusCode = 400;
    throw error;
  }

  // The data: prefix is just as forgeable as a multipart header, so the
  // stored extension comes from the decoded bytes, not from what the URL says.
  const detected = detectImageType(buffer);
  if (!detected) {
    const error = new Error("Imagine invalida. Foloseste PNG, JPG sau WEBP.");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(uploadDirResolved, { recursive: true });
  const fileName = `${prefix}-${crypto.randomUUID()}${detected.extension}`;
  fs.writeFileSync(path.join(uploadDirResolved, fileName), buffer);
  return `${uploadPublicBase}/${fileName}`;
}

async function readProductPayload(request, existing = {}) {
  const contentType = request.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    const parsed = parseMultipart(await readBuffer(request), contentType);
    const imageUrl = saveProductImage(parsed.files.image);
    return {
      ...parsed.fields,
      imageUrl: imageUrl || parsed.fields.imageUrl || existing.imageUrl || ""
    };
  }

  return readBody(request);
}

// script-src used to carry 'unsafe-inline' because ~17 small inline <script>
// blocks are spread across the brand's pages (Safari sniffing, the file://
// redirect guard, the verify-email/reset-password handlers, and the three.js
// importmap on the admin dashboards) and there is no build step to strip them.
// Instead of rewriting every page, each block's exact body is hashed at
// startup and the hashes go into the policy: those specific scripts keep
// running, anything injected does not. Note CSP ignores 'unsafe-inline' as
// soon as a hash is present, so this list has to be complete - a page whose
// inline script is missing here has that script blocked.
//
// The importmap has to stay inline (browsers do not load external import
// maps), which is what makes hashing the right tool here rather than
// externalising the blocks.
//
// Operationally: hashes are collected once at startup, so editing an inline
// <script> in any .html requires a restart before that page works again -
// deploys already restart, but a hand-edit on a running server would not.
function collectInlineScriptHashes() {
  const hashes = new Set();
  const seenFiles = new Set();
  const searchRoots = [...new Set([publicRootResolved, rootResolved])];
  const skipDirs = new Set(["node_modules", ".git", "data", "backups", "tmp", "assets", "test", "scripts"]);

  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name.startsWith("data-") || entry.name.startsWith("backups-")) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".html") || seenFiles.has(full)) continue;
      seenFiles.add(full);
      let html;
      try {
        html = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      // Only blocks without src= are inline. The hash has to be taken over
      // what the HTML parser ends up with, not the raw file bytes: the parser
      // normalises CRLF (and lone CR) to LF while preprocessing the input
      // stream, so on CRLF checkouts hashing the file verbatim yields a digest
      // that never matches and silently blocks the script.
      const pattern = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const body = match[2].replace(/\r\n?/g, "\n");
        hashes.add(`'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`);
      }
    }
  };

  searchRoots.forEach((dir) => walk(dir, 0));
  return [...hashes];
}

const INLINE_SCRIPT_HASHES = collectInlineScriptHashes();

// Square Web Payments SDK domains, Sandbox only (matches SQUARE_ENVIRONMENT
// scope right now - see server.js's own comment near squareEnvironment
// below). Baseline values came from Square's own documented CSP guide, then
// were corrected against what the SDK actually requests in a real browser
// (verified via the test deploy - Square's guide didn't mention the
// cash-f.squarecdn.com font host or that the SDK loads a couple of its own
// icons from sandbox.web.squarecdn.com itself, both of which showed up as
// live CSP violations in the console, not just theoretical gaps): script/
// style/frame load from sandbox.web.squarecdn.com, the card iframe's
// tokenize call goes to the separate PCI-scoped connect endpoint, and the
// SDK's own crash reporting goes to its Sentry project - omitting that last
// one wouldn't break checkout, just spam the console with blocked-request
// noise.
const SQUARE_CSP_ORIGIN = "https://sandbox.web.squarecdn.com";
const SQUARE_CSP_CONNECT = "https://pci-connect.squareupsandbox.com https://o160250.ingest.sentry.io";
const SQUARE_CSP_FONTS = "https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net https://cash-f.squarecdn.com";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASHES.join(" ")} https://unpkg.com ${SQUARE_CSP_ORIGIN}`.replace(/\s+/g, " "),
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${SQUARE_CSP_ORIGIN}`,
  `font-src 'self' https://fonts.gstatic.com ${SQUARE_CSP_FONTS}`,
  `img-src 'self' data: blob: ${SQUARE_CSP_ORIGIN}`,
  `connect-src 'self' https://unpkg.com blob: ${SQUARE_CSP_CONNECT}`,
  "worker-src 'self' blob:",
  "media-src 'self'",
  `frame-src ${SQUARE_CSP_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    ...headers
  });
  response.end(body);
}

function json(response, status, payload, headers = {}) {
  send(response, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function setSessionCookie(request, response, sessionId) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function appendCookie(response, cookieValue) {
  const current = response.getHeader("Set-Cookie");
  if (!current) {
    response.setHeader("Set-Cookie", cookieValue);
    return;
  }

  response.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookieValue] : [current, cookieValue]);
}

function setCartCookie(request, response, cartId) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  appendCookie(response, `${cartCookie}=${encodeURIComponent(cartId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(cartTtlMs / 1000)}${secure}`);
}

function getCartId(request, response) {
  const cookies = parseCookies(request);
  const existing = cookies[cartCookie];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;

  const cartId = crypto.randomBytes(32).toString("hex");
  setCartCookie(request, response, cartId);
  return cartId;
}

// Reading a cart must not write to disk. GET /api/cart runs on nearly every
// page load, and writeJson is synchronous down to fsync, so persisting here
// let any unauthenticated request flood (each cookie-less GET mints a fresh
// cart) block the single-threaded process for every other visitor. A brand-new
// empty cart is never persisted - callers that actually mutate the cart call
// saveCart(), which is what puts it on disk.
function getCart(request, response, session = null) {
  const carts = readJson("carts.json", {});
  const cartId = getCartId(request, response);
  const existing = carts[cartId];
  const cart = existing || { items: {}, updatedAt: new Date().toISOString() };
  let claimedByUser = false;
  if (session && session.user && !cart.userId) {
    cart.userId = session.user.id;
    cart.email = session.user.email;
    claimedByUser = true;
  }
  carts[cartId] = cart;
  // Only an already-stored cart gaining its owner is worth a write of its own;
  // for a new cart this same data lands with the first saveCart().
  if (existing && claimedByUser) writeJson("carts.json", carts);
  return { cartId, cart, carts };
}

function saveCart(cartId, cart, carts) {
  carts[cartId] = {
    ...cart,
    updatedAt: new Date().toISOString()
  };
  writeJson("carts.json", carts);
}

function getSession(request) {
  const sessionId = parseCookies(request)[sessionCookie];
  if (!sessionId) return null;
  return db.getSessionWithUser(sessionId);
}

function createSession(request, response, user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  db.insertSession(sessionId, user.id, Date.now() + sessionTtlMs, new Date().toISOString());
  setSessionCookie(request, response, sessionId);
}

function destroySession(request, response) {
  const sessionId = parseCookies(request)[sessionCookie];
  if (sessionId) db.deleteSession(sessionId);
  clearSessionCookie(response);
}

function safePublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
    isPrimaryAdmin: Boolean(user.isPrimaryAdmin),
    createdAt: user.createdAt
  };
}

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function publicProduct(product) {
  const chapter = genealogyChapter(productChapterId(product));
  return {
    id: product.id,
    slug: product.slug || toSlug(product.name),
    name: product.name,
    nameRo: product.nameRo || "",
    nameEn: product.nameEn || "",
    category: product.category,
    status: product.status,
    price: product.price,
    currency: product.currency,
    stock: product.stock,
    sizeStock: product.sizeStock || null,
    imageUrl: product.imageUrl || "",
    sceneImageUrl: product.sceneImageUrl || "",
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    color: product.color || "",
    description: product.description || "",
    descriptionRo: product.descriptionRo || "",
    descriptionEn: product.descriptionEn || "",
    chapterId: productChapterId(product),
    chapterProductOrder: productChapterOrder(product),
    chapterStatus: chapter?.status || null,
    purchasable: productCanBePurchased(product),
    studio: product.studio ? {
      model: product.studio.model || "assets/models/tshirt-web.glb",
      textureUrl: product.studio.textureUrl || "",
      shirtColor: product.studio.shirtColor || "#ffffff"
    } : null
  };
}

// Attaches the fixed-edition state to a public product payload: how many
// numbered pieces have been assigned so far and the pinned edition total
// (assigned + unsold stock - constant once the first piece sells).
function withEditionInfo(payload, product, editions) {
  const assigned = editions.filter((record) => record.productId === product.id).length;
  return {
    ...payload,
    editionAssigned: assigned,
    editionTotal: assigned + (Number(product.stock) || 0)
  };
}

// The public shape of an edition record: everything a certificate shows,
// nothing that identifies the buyer (order ids stay internal).
function publicEditionRecord(record) {
  const legacyChapter = GENEALOGY_CHAPTERS.find((chapter) => Number(chapter.number) === Number(record.chapter));
  const chapter = genealogyChapter(record.chapterId) || legacyChapter || genealogyChapter("origin");
  return {
    id: record.id,
    productId: record.productId,
    productName: record.productName,
    size: record.size || "",
    number: record.number,
    total: record.total,
    chapter: Number(chapter?.number || record.chapter || 1),
    chapterId: chapter?.id || record.chapterId || "origin",
    chapterName: chapter?.name || record.chapterName || "ORIGIN",
    chapterProductOrder: Number(record.chapterProductOrder ?? 999),
    productStatus: record.productStatus || "sold-out",
    assignedAt: record.assignedAt
  };
}

// --- Order access tokens (guest orders) -------------------------------------
// Guest orders are viewable only with a random, unguessable token issued at
// checkout. Only the SHA-256 hash is stored on the order; the plain token
// travels once in the checkout response / email link. Re-sending an email
// rotates the token (a new one is issued and the stored hash replaced).
function hashOrderToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function generateOrderAccessToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: hashOrderToken(token) };
}

function orderTokenMatches(order, token) {
  if (!order || !order.publicAccessTokenHash || !token) return false;
  const expected = Buffer.from(order.publicAccessTokenHash, "hex");
  const actual = Buffer.from(hashOrderToken(token), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Who may see this order: any admin; the authenticated owner; a guest holding
// the order's public access token.
function canViewOrder(order, session, token) {
  if (session && session.user.role === "admin") return true;
  if (session && order.userId && order.userId === session.user.id) return true;
  return orderTokenMatches(order, token);
}

// --- Order state machine ----------------------------------------------------
const ORDER_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

function isAllowedOrderTransition(from, to) {
  if (from === to) return true;
  return Array.isArray(ORDER_TRANSITIONS[from]) && ORDER_TRANSITIONS[from].includes(to);
}

const PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed"];
const PAYMENT_METHODS = ["cod", "card", "manual"];

function orderCountsAsRevenue(order) {
  return order.paymentStatus === "paid";
}

// --- Cancellation / resource restoration ------------------------------------
// Idempotent: guarded by per-order flags so cancelling twice can never
// restore stock or a coupon use twice. Must be called inside withStockLock.
function restoreOrderResources(order, changedBy) {
  const now = new Date().toISOString();

  if (!order.stockRestored) {
    for (const item of order.items || []) {
      const current = item.productId ? db.getProductById(item.productId) : null;
      if (!current) continue;
      const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
      const nextSizeStock = current.sizeStock && item.size
        ? { ...current.sizeStock, [item.size]: Math.max(0, Math.floor(Number(current.sizeStock[item.size]) || 0)) + qty }
        : current.sizeStock;
      const nextStock = nextSizeStock ? totalStockFromSizeStock(nextSizeStock) : (Math.max(0, Math.floor(Number(current.stock) || 0)) + qty);
      db.upsertProduct({
        ...current,
        stock: nextStock,
        sizeStock: nextSizeStock,
        status: current.status === "sold-out" && nextStock > 0 ? "live" : current.status,
        updatedAt: now
      });
    }
    order.stockRestored = true;
    order.stockRestoredAt = now;
  }

  if (order.couponCode && order.couponConsumed && !order.couponRestored) {
    const coupons = readJson("coupons.json", []);
    const index = coupons.findIndex((coupon) => coupon.code === order.couponCode);
    if (index !== -1) {
      coupons[index] = { ...coupons[index], usedCount: Math.max(0, (coupons[index].usedCount || 0) - 1) };
      writeJson("coupons.json", coupons);
    }
    order.couponRestored = true;
  }

  // Edition numbers are a permanent ledger: never renumbered or reused.
  // Cancelled pieces stay in the table, flagged, and leave the public archive.
  if (!order.editionsCancelled) {
    db.cancelEditionsForOrder(order.id, changedBy, now);
    order.editionsCancelled = true;
  }

  return order;
}

// Consumes the coupon exactly once per order (on confirm or on payment,
// whichever happens first). Must be called inside withStockLock.
function consumeOrderCoupon(order) {
  if (!order.couponCode || order.couponConsumed) return order;
  const coupons = readJson("coupons.json", []);
  const index = coupons.findIndex((coupon) => coupon.code === order.couponCode);
  if (index !== -1) {
    coupons[index] = { ...coupons[index], usedCount: (coupons[index].usedCount || 0) + 1 };
    writeJson("coupons.json", coupons);
  }
  order.couponConsumed = true;
  order.couponRestored = false;
  return order;
}

// Idempotent settle step shared by the synchronous pay route and the Square
// webhook - whichever one learns about a completed charge first "wins": it
// inserts the payments row and drives the order forward; the other finds
// payments.provider_payment_id already recorded (the unique index backs
// this even under a true race) and returns alreadySettled instead of
// duplicating the coupon consumption or the status-history entry.
//
// Entirely synchronous DB work under withStockLock, same boundary every
// other stock/order mutation in this file uses - no network call belongs in
// here (that already happened; the caller hands in Square's answer).
function settlePaidSquarePayment({ orderId, providerPaymentId, amount, currency, rawResponse, changedBy }) {
  return withStockLock(() => {
    const order = db.getOrderById(orderId);
    if (!order) return { error: "order-not-found" };

    const already = db.getPaymentByProviderPaymentId(providerPaymentId);
    if (already) return { order, alreadySettled: true, accessToken: null };

    const now = new Date().toISOString();
    const rotated = generateOrderAccessToken();
    let updatedOrder = order;

    db.withTransaction(() => {
      db.insertPayment({
        id: crypto.randomUUID(),
        orderId,
        provider: "square",
        providerPaymentId,
        kind: "charge",
        amount,
        currency,
        status: "completed",
        rawResponse,
        createdAt: now
      });

      updatedOrder = {
        ...order,
        paymentStatus: "paid",
        paidAt: order.paidAt || now,
        paymentMethod: "card",
        publicAccessTokenHash: rotated.hash,
        updatedAt: now
      };
      updatedOrder = consumeOrderCoupon(updatedOrder);

      // Only advances pending -> confirmed (the same transition a manual
      // admin confirm makes). An order already further along (processing+)
      // or cancelled keeps its status untouched - paymentStatus alone
      // records the truth that money arrived; isAllowedOrderTransition
      // already refuses anything the state machine doesn't allow, so a
      // stray late webhook against a cancelled order can't resurrect it.
      if (isAllowedOrderTransition(updatedOrder.status, "confirmed")) {
        updatedOrder.status = "confirmed";
        updatedOrder.reservation = { ...(updatedOrder.reservation || {}), confirmedAt: now, expiresAt: null };
      }

      db.updateOrder(order.id, updatedOrder);
      db.appendOrderStatusHistory(order.id, {
        from: order.status,
        to: updatedOrder.status,
        payment: { from: order.paymentStatus, to: "paid" },
        changedAt: now,
        changedBy: changedBy || "square",
        emailSent: false
      });
    });

    return { order: db.getOrderById(orderId), alreadySettled: false, accessToken: rotated.token };
  });
}

function publicOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus || "unpaid",
    paymentMethod: order.paymentMethod || "manual",
    currency: order.currency,
    total: order.total,
    discount: order.discount || 0,
    couponCode: order.couponCode || null,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    items: (order.items || []).map((item) => ({
      name: item.name,
      size: item.size || "",
      price: item.price,
      currency: item.currency,
      qty: item.qty,
      subtotal: item.subtotal,
      // Edition numbers are public archive data (never buyer-identifying).
      editionNumbers: item.editionNumbers || [],
      editionTotal: item.editionTotal ?? null
    })),
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    createdAt: order.createdAt
  };
}

// --- Content (inline editor) sanitization -----------------------------------
// Editor overrides are stored as plain text (never HTML) and re-applied in the
// browser via textContent, so stored XSS can't execute. Sanitization runs on
// write AND on read, so payloads already sitting in an old content.json are
// neutralized too.
function stripHtmlToText(value) {
  let text = String(value ?? "");
  // Keep author line breaks from <br> / block closings, drop everything else.
  text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  text = text.replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  // Decode the entities innerHTML-era saves produced so text renders as the
  // author wrote it (it is applied with textContent, so this stays inert).
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, "&");
  return text.slice(0, 4000);
}

// Image override URLs: only local approved paths (assets/ or the upload
// folder) or absolute https URLs. javascript:, data:, protocol-relative and
// traversal are all rejected.
function isApprovedImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 500 || /[\s<>"']/.test(raw)) return false;
  if (/^https:\/\/[^/]+\/.+/i.test(raw)) return true;
  if (raw.includes("..") || raw.includes(":")) return false;
  const cleaned = raw.replace(/^\/+/, "");
  const uploadPrefix = `${uploadPublicBase}/`;
  return cleaned.startsWith("assets/") || cleaned.startsWith(uploadPrefix);
}

// Normalizes one branding entry to a safe record ({t:"text"|"img", v}) or a
// safe plain string. Returns null when the entry must be dropped.
function sanitizeBrandingEntry(key, record) {
  if (typeof record === "string") {
    // Legacy plain-string branding values (logoUrl etc.) are image URLs.
    return /url$/i.test(key) ? (isApprovedImageUrl(record) ? record : null) : stripHtmlToText(record);
  }
  if (!record || typeof record !== "object") return null;
  if (record.t === "img") {
    const url = String(record.v || "").trim();
    return isApprovedImageUrl(url) ? { t: "img", v: url } : null;
  }
  if (record.t === "text") {
    return { t: "text", v: stripHtmlToText(record.v) };
  }
  return null;
}

function sanitizeBranding(branding) {
  const result = {};
  if (!branding || typeof branding !== "object") return result;
  for (const [key, record] of Object.entries(branding)) {
    if (typeof key !== "string" || key.length > 400) continue;
    const safe = sanitizeBrandingEntry(key, record);
    if (safe !== null) result[key] = safe;
  }
  return result;
}

function sanitizeContentDictionary(dictionary) {
  const result = {};
  if (!dictionary || typeof dictionary !== "object") return result;
  for (const [key, value] of Object.entries(dictionary)) {
    if (typeof key !== "string" || key.length > 200) continue;
    result[key] = stripHtmlToText(value);
  }
  return result;
}

function sanitizeContent(content) {
  const base = content && typeof content === "object" ? content : {};
  return {
    en: sanitizeContentDictionary(base.en),
    ro: sanitizeContentDictionary(base.ro),
    branding: sanitizeBranding(base.branding)
  };
}

function sameOriginPost(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const rateLimitBuckets = new Map();

// x-forwarded-for is set by whoever makes the TCP connection to this process -
// on the VPS that's nginx (trusted, connecting from localhost), but if this
// process were ever reachable directly (misconfigured proxy, no proxy at all),
// any client could set that header to any value and pick their own IP, which
// would let them bypass every rate limiter keyed on it below. Only trust the
// header when the actual socket connection comes from localhost, i.e. from a
// reverse proxy on the same machine - not from the public internet.
const TRUSTED_PROXY_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function clientIp(request) {
  const remote = request.socket?.remoteAddress || "";

  if (TRUSTED_PROXY_ADDRESSES.has(remote)) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }

  return remote || "unknown";
}

// Analytics never needs the full address: IPv4 keeps the /24 (last octet
// zeroed), IPv6 keeps only the first 3 groups (~/48 prefix).
function anonymizeIp(ip) {
  const value = String(ip || "").trim();
  if (!value || value === "unknown") return "unknown";

  const mappedV4 = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i);
  if (mappedV4) return `${mappedV4[1]}.0`;

  if (value.includes(":")) {
    const groups = value.split(":");
    return `${groups.slice(0, 3).join(":")}::`;
  }

  const v4 = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.0`;

  return "unknown";
}

// Whether this request is actually arriving over HTTPS - either terminated
// directly on this Node process, or by a reverse proxy on the same machine
// that says so via X-Forwarded-Proto (same trust boundary as clientIp
// above: only trusted when the proxy hop itself is localhost, so a public
// client can't just claim "https" and get a Secure cookie set over plain
// HTTP). Cookies must only get the "Secure" attribute when this is true -
// NODE_ENV alone doesn't tell you that, and a "production" deploy that
// hasn't had TLS set up in front of it yet (or is being smoke-tested via
// http://ip:port) would otherwise have the browser silently discard the
// session/cart cookies, breaking login and cart persistence with no
// visible error.
function isSecureRequest(request) {
  if (request.socket?.encrypted) return true;

  const remote = request.socket?.remoteAddress || "";
  if (TRUSTED_PROXY_ADDRESSES.has(remote)) {
    return String(request.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  }

  return false;
}

function isRateLimited(key, limit = 8, windowMs = 60000) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return recent.length > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitBuckets) {
    if (!timestamps.some((timestamp) => now - timestamp < 15 * 60000)) rateLimitBuckets.delete(key);
  }
}, 10 * 60000).unref();

function parseSizesInput(rawSizes) {
  const sizes = [];
  const seen = new Set();
  const sizeStock = {};
  let hasExplicitStock = false;

  String(rawSizes || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      if (sizes.length >= 12) return;
      const [rawSize, rawQty] = entry.split(":").map((part) => part.trim());
      const size = rawSize.slice(0, 12);
      if (!size || seen.has(size)) return;
      seen.add(size);
      sizes.push(size);
      if (rawQty !== undefined && rawQty !== "") {
        hasExplicitStock = true;
        sizeStock[size] = Math.max(0, Math.floor(Number(rawQty)) || 0);
      }
    });

  return { sizes, sizeStock, hasExplicitStock };
}

function distributeStockAcrossSizes(totalStock, sizes) {
  if (!sizes.length) return {};
  const base = Math.floor(totalStock / sizes.length);
  const remainder = totalStock - base * sizes.length;
  const sizeStock = {};
  sizes.forEach((size, index) => {
    sizeStock[size] = base + (index < remainder ? 1 : 0);
  });
  return sizeStock;
}

function totalStockFromSizeStock(sizeStock) {
  return Object.values(sizeStock).reduce((sum, qty) => sum + Math.max(0, Math.floor(Number(qty) || 0)), 0);
}

function sanitizeProduct(input, existing = {}) {
  const price = Number(input.price);
  const inputStock = Number(input.stock);
  const name = String(input.name || "").trim().slice(0, 100);
  const { sizes: parsedSizes, sizeStock: explicitSizeStock, hasExplicitStock } = parseSizesInput(input.sizes);
  const sizes = parsedSizes.length ? parsedSizes : (Array.isArray(existing.sizes) ? existing.sizes : []);

  let sizeStock;
  if (!sizes.length) {
    sizeStock = undefined;
  } else if (hasExplicitStock) {
    sizeStock = sizes.reduce((map, size) => {
      map[size] = explicitSizeStock[size] ?? existing.sizeStock?.[size] ?? 0;
      return map;
    }, {});
  } else if (Number.isFinite(inputStock)) {
    sizeStock = distributeStockAcrossSizes(Math.max(0, Math.floor(inputStock)), sizes);
  } else if (existing.sizeStock) {
    sizeStock = sizes.reduce((map, size) => {
      map[size] = existing.sizeStock[size] ?? 0;
      return map;
    }, {});
  } else {
    sizeStock = distributeStockAcrossSizes(Math.max(0, Math.floor(Number(existing.stock) || 0)), sizes);
  }

  const stock = sizeStock ? totalStockFromSizeStock(sizeStock) : (Number.isFinite(inputStock) ? Math.max(0, Math.floor(inputStock)) : 0);
  let chapterId = productChapterId(existing);
  let chapterProductOrder = productChapterOrder(existing);

  if (GENEALOGY) {
    const rawChapterId = input.chapterId ?? input.chapter_id;
    if (!existing.id && (rawChapterId === undefined || String(rawChapterId).trim() === "")) {
      const error = new Error("Genealogy chapter is required.");
      error.statusCode = 400;
      throw error;
    }
    if (rawChapterId !== undefined) chapterId = String(rawChapterId).trim().toLowerCase();
    if (!GENEALOGY_CHAPTER_IDS.has(chapterId)) {
      const error = new Error("Select a valid genealogy chapter.");
      error.statusCode = 400;
      throw error;
    }

    const rawOrder = input.chapterProductOrder ?? input.chapter_product_order;
    if (rawOrder !== undefined && String(rawOrder).trim() !== "") {
      const parsedOrder = Number(rawOrder);
      if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
        const error = new Error("Product order must be a non-negative number.");
        error.statusCode = 400;
        throw error;
      }
      chapterProductOrder = parsedOrder;
    } else if (!existing.id) {
      chapterProductOrder = 999;
    }
  }

  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    slug: toSlug(input.slug || name || existing.slug),
    name,
    nameRo: String(input.nameRo || existing.nameRo || "").trim().slice(0, 100),
    nameEn: String(input.nameEn || existing.nameEn || "").trim().slice(0, 100),
    category: String(input.category || "").trim().slice(0, 60),
    status: ["draft", "preview", "live", "sold-out"].includes(input.status) ? input.status : "draft",
    price: Number.isFinite(price) ? Math.max(0, price) : 0,
    currency: String(input.currency || "GBP").trim().slice(0, 8).toUpperCase(),
    stock,
    sizeStock,
    imageUrl: String(input.imageUrl || existing.imageUrl || "").trim().slice(0, 260),
    sizes,
    color: String(input.color || existing.color || "").trim().slice(0, 40),
    description: String(input.description || "").trim().slice(0, 900),
    descriptionRo: String(input.descriptionRo || existing.descriptionRo || "").trim().slice(0, 900),
    descriptionEn: String(input.descriptionEn || existing.descriptionEn || "").trim().slice(0, 900),
    chapterId,
    chapterProductOrder,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function buildCartPayload(cart) {
  const products = db.listProducts();
  const items = Object.entries(cart.items || {})
    .map(([key, qty]) => {
      const { productId, size } = parseCartKey(key);
      const product = products.find((item) => item.id === productId);
      if (!product || !productCanBePurchased(product)) return null;
      const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
      return {
        key,
        size,
        product: publicProduct(product),
        qty: safeQty,
        subtotal: (Number(product.price) || 0) * safeQty
      };
    })
    .filter(Boolean);

  return {
    items,
    count: items.reduce((total, item) => total + item.qty, 0),
    total: items.reduce((total, item) => total + item.subtotal, 0),
    currency: items[0]?.product.currency || "GBP"
  };
}

function sanitizeCheckout(input, session) {
  const user = session && session.user;
  return {
    customerName: String(input.customerName || input.name || user?.name || "").trim().slice(0, 100),
    customerEmail: normalizeEmail(input.customerEmail || input.email || user?.email || ""),
    customerPhone: String(input.customerPhone || input.phone || "").trim().slice(0, 30),
    customerAddress: String(input.customerAddress || input.address || "").trim().slice(0, 500),
    notes: String(input.notes || "").trim().slice(0, 500)
  };
}

// Segment-level blocklist for static serving. Works on normalized path
// segments (not a naive startsWith), so "data-aether", "backups-aether",
// nested "x/data/y" and Windows separators are all covered - for BeCa,
// AETHER and any future brand's data/backup folder naming.
const BLOCKED_STATIC_SEGMENT = /^(data|data-.*|backups|backups-.*|tmp|node_modules|\.git)$/i;

function isBlockedStaticPath(requestedPath) {
  const segments = String(requestedPath || "")
    .split(/[/\\]+/)
    .filter(Boolean);
  return segments.some((segment) =>
    BLOCKED_STATIC_SEGMENT.test(segment)
    || segment.startsWith(".env")
    || segment === ".server.lock"
    || segment.endsWith(".corrupt")
    || /\.corrupt-\d+$/.test(segment)
    || segment.endsWith(".tmp"));
}

// Only the three gated pages below need a session, so `session` may also be a
// resolver function. Static assets - by far the bulk of requests - then never
// pay for the two full JSON reads getSession does.
function canAccessFile(requestedPath, session) {
  if (isBlockedStaticPath(requestedPath)) {
    return false;
  }

  const resolveSession = () => (typeof session === "function" ? session() : session);

  if (requestedPath === "account.html" || requestedPath === "orders.html") {
    return Boolean(resolveSession());
  }

  if (requestedPath === "admin/dashboard.html") {
    const active = resolveSession();
    return Boolean(active && active.user.role === "admin");
  }

  return true;
}

async function handleAuth(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/me") {
    const session = getSession(request);
    json(response, 200, { user: safePublicUser(session && session.user) });
    return true;
  }

  if (request.method === "PUT" && pathname === "/api/profile") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    if (isRateLimited(`profile:${session.user.id}`, 10, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const nextName = String(body.name || "").trim().slice(0, 80);
    const nextEmail = normalizeEmail(body.email);

    if (nextName.length < 2 || !nextEmail.includes("@")) {
      json(response, 400, { error: "Completeaza nume si email valid." });
      return true;
    }

    const currentUser = db.getUserById(session.user.id);
    if (!currentUser) {
      json(response, 404, { error: "Contul nu exista." });
      return true;
    }

    if (db.emailInUse(nextEmail, session.user.id)) {
      json(response, 409, { error: "Emailul este deja folosit." });
      return true;
    }

    const emailChanged = currentUser.email !== nextEmail;

    const updatedUser = db.updateUser(session.user.id, {
      name: nextName,
      email: nextEmail,
      // A new address is unverified until the owner confirms it. The primary
      // admin keeps its isPrimaryAdmin flag (role management is backed by the
      // flag, not the address), but must re-verify like anyone else.
      emailVerified: emailChanged ? false : currentUser.emailVerified
    });

    if (emailChanged) {
      // Old verification links and password-reset tokens pointed at the old
      // address - none of them may remain usable.
      const verifications = readJson("email-verifications.json", []);
      writeJson("email-verifications.json", verifications.filter((item) => item.userId !== session.user.id));
      const resets = readJson("password-resets.json", []);
      writeJson("password-resets.json", resets.filter((item) => item.userId !== session.user.id));
      sendVerificationEmail(updatedUser);
    }

    json(response, 200, { ok: true, user: safePublicUser(updatedUser) });
    return true;
  }

  if (request.method === "PUT" && pathname === "/api/profile/password") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    if (isRateLimited(`password-change:${session.user.id}`, 5, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const currentPassword = String(body.currentPassword || "");
    const nextPassword = String(body.newPassword || "");
    const currentUser = db.getUserById(session.user.id);

    if (!currentUser || !verifyPassword(currentPassword, currentUser.passwordHash)) {
      json(response, 401, { error: "Parola actuala nu este corecta." });
      return true;
    }

    const policyError = passwordPolicyError(nextPassword);
    if (policyError) {
      json(response, 400, { error: policyError });
      return true;
    }

    db.updateUser(session.user.id, { passwordHash: hashPassword(nextPassword) });

    // Every other session of this account is logged out; only the session
    // that changed the password stays valid.
    invalidateUserSessions(session.user.id, session.id);

    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/logout") {
    destroySession(request, response);
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/forgot-password") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    if (isRateLimited(`forgot:${clientIp(request)}`, 5, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const targetEmail = normalizeEmail(body.email);
    const user = db.getUserByEmail(targetEmail);

    if (user) {
      const resets = readJson("password-resets.json", []);
      const token = crypto.randomBytes(32).toString("hex");
      resets.unshift({
        token,
        userId: user.id,
        expiresAt: Date.now() + 1000 * 60 * 60,
        usedAt: null,
        createdAt: new Date().toISOString()
      });
      writeJson("password-resets.json", resets.slice(0, 500));
      const resetUrl = `${SITE_ORIGIN}/reset-password.html?token=${token}`;
      email.sendMail(email.buildPasswordResetEmail(user, resetUrl)).catch(() => {});
    }

    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/reset-password") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    if (isRateLimited(`reset:${clientIp(request)}`, 8, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const token = String(body.token || "");
    const nextPassword = String(body.password || "");

    const resetPolicyError = passwordPolicyError(nextPassword);
    if (resetPolicyError) {
      json(response, 400, { error: resetPolicyError });
      return true;
    }

    const resets = readJson("password-resets.json", []);
    const entry = resets.find((item) => item.token === token);

    if (!entry || entry.usedAt || Date.now() > entry.expiresAt) {
      json(response, 400, { error: "Linkul de resetare este invalid sau a expirat." });
      return true;
    }

    const resetUser = db.getUserById(entry.userId);
    if (!resetUser) {
      json(response, 404, { error: "Contul nu mai exista." });
      return true;
    }

    db.updateUser(resetUser.id, { passwordHash: hashPassword(nextPassword) });

    entry.usedAt = new Date().toISOString();
    writeJson("password-resets.json", resets);

    // A reset from a link logs out every session - the user logs in again
    // with the new password.
    invalidateUserSessions(resetUser.id, null);

    json(response, 200, { ok: true, redirect: "/login.html" });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/verify-email") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    if (isRateLimited(`verify-email:${clientIp(request)}`, 10, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const token = String(body.token || "");
    const verifications = readJson("email-verifications.json", []);
    const entry = verifications.find((item) => item.token === token);

    if (!entry || Date.now() > entry.expiresAt) {
      json(response, 400, { error: "Linkul de verificare este invalid sau a expirat." });
      return true;
    }

    const verifyUser = db.getUserById(entry.userId);
    if (!verifyUser) {
      json(response, 404, { error: "Contul nu mai exista." });
      return true;
    }

    db.updateUser(verifyUser.id, { emailVerified: true });
    writeJson("email-verifications.json", verifications.filter((item) => item.token !== token));

    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/resend-verification") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }
    if (session.user.emailVerified) {
      json(response, 200, { ok: true, alreadyVerified: true });
      return true;
    }
    if (isRateLimited(`resend-verify:${session.user.id}`, 3, 300000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    sendVerificationEmail(session.user);
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method !== "POST") return false;
  if (!sameOriginPost(request)) {
    json(response, 403, { error: "Request blocked." });
    return true;
  }

  if (pathname === "/auth/register") {
    if (isRateLimited(`register:${clientIp(request)}`, 5, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();

    if (!email.includes("@") || name.length < 2) {
      json(response, 400, { error: "Completeaza nume si email valid." });
      return true;
    }

    const registerPolicyError = passwordPolicyError(password);
    if (registerPolicyError) {
      json(response, 400, { error: registerPolicyError });
      return true;
    }

    if (db.emailInUse(email)) {
      json(response, 409, { error: "Exista deja un cont cu emailul acesta." });
      return true;
    }

    const user = db.insertUser(createUserRecord({ email, name, password, role: "client" }));
    createSession(request, response, user);
    sendVerificationEmail(user);
    json(response, 200, { ok: true, user: safePublicUser(user), redirect: "/" });
    return true;
  }

  if (pathname === "/auth/login" || pathname === "/admin/login") {
    if (isRateLimited(`login:${clientIp(request)}`, 8, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const user = db.getUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      json(response, 401, { error: "Email sau parola gresita." });
      return true;
    }

    if (pathname === "/admin/login" && user.role !== "admin") {
      json(response, 403, { error: "Contul acesta nu are acces admin." });
      return true;
    }

    createSession(request, response, user);
    json(response, 200, {
      ok: true,
      user: safePublicUser(user),
      redirect: user.role === "admin" && pathname === "/admin/login" ? "/admin/dashboard.html" : "/"
    });
    return true;
  }

  return false;
}

async function handleShopApi(request, response, pathname) {
  if (pathname === "/api/content" && request.method === "GET") {
    // Sanitized on the way out too, so anything injected into an old
    // content.json can never reach a browser.
    json(response, 200, sanitizeContent(readJson("content.json", { en: {}, ro: {}, branding: {} })));
    return true;
  }

  // Display-currency configuration. Orders are always recorded in the
  // product currency (GBP); any RON display is an indicative conversion made
  // client-side with this rate. No rate configured => clients show the
  // original currency instead of guessing.
  if (pathname === "/api/region-config" && request.method === "GET") {
    const rate = Number(process.env.GBP_TO_RON_RATE);
    json(response, 200, {
      orderCurrency: "GBP",
      gbpToRon: Number.isFinite(rate) && rate > 0 ? rate : null,
      gbpToRonUpdatedAt: process.env.GBP_TO_RON_UPDATED_AT || null,
      conversionIsIndicative: true
    });
    return true;
  }

  // Non-secret client-side ids for the Square Web Payments SDK. The real
  // access token/webhook key never leave lib/square.js. enabled=false lets
  // the checkout page hide the card step entirely instead of rendering a
  // broken SDK against empty ids - same graceful-degradation shape as
  // /api/region-config above when GBP_TO_RON_RATE isn't set.
  if (pathname === "/api/square-config" && request.method === "GET") {
    const applicationId = brandEnv("SQUARE_APPLICATION_ID") || "";
    const locationId = brandEnv("SQUARE_LOCATION_ID") || "";
    json(response, 200, {
      enabled: Boolean(applicationId && locationId && square.isConfigured()),
      applicationId: applicationId || null,
      locationId: locationId || null,
      environment: String(brandEnv("SQUARE_ENVIRONMENT") || "sandbox").trim().toLowerCase()
    });
    return true;
  }

  if (pathname === "/api/genealogy" && request.method === "GET") {
    json(response, 200, {
      enabled: Boolean(GENEALOGY),
      chapters: GENEALOGY_CHAPTERS,
      openChapter: openGenealogyChapter()
    });
    return true;
  }

  if (pathname === "/api/products" && request.method === "GET") {
    const editions = db.listEditions();
    const products = db.listProducts()
      .filter((product) => (product.status === "live" || product.status === "preview") && productBelongsToOpenChapter(product))
      .sort(sortGenealogyProducts)
      .map((product) => withEditionInfo(publicProduct(product), product, editions));
    const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
    json(response, 200, { products, categories });
    return true;
  }

  const productDetailMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productDetailMatch && request.method === "GET") {
    const key = decodeURIComponent(productDetailMatch[1]);
    const product = db.getProductBySlugOrId(key);

    if (!product || (product.status !== "live" && product.status !== "preview")) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    const editions = db.listEditions();
    json(response, 200, { product: withEditionInfo(publicProduct(product), product, editions) });
    return true;
  }

  // Public archive record: every numbered piece ever sold, without any
  // buyer-identifying data (order ids stay internal).
  if (pathname === "/api/archive" && request.method === "GET") {
    const products = db.listProducts();
    const productById = new Map(products.map((product) => [product.id, product]));
    const pieces = db.listEditions()
      .filter((record) => record.status !== "cancelled")
      .map((record) => {
        const product = productById.get(record.productId);
        return publicEditionRecord({
          ...record,
          chapterId: record.chapterId || productChapterId(product),
          chapterProductOrder: record.chapterProductOrder ?? productChapterOrder(product),
          productStatus: product?.status || record.productStatus || "sold-out"
        });
      })
      .sort((a, b) => a.chapterProductOrder - b.chapterProductOrder || a.number - b.number || a.id - b.id);
    json(response, 200, {
      chapters: GENEALOGY_CHAPTERS,
      openChapter: openGenealogyChapter(),
      pieces,
      count: pieces.length
    });
    return true;
  }

  const archiveDetailMatch = pathname.match(/^\/api\/archive\/(\d{1,6})$/);
  if (archiveDetailMatch && request.method === "GET") {
    const recordId = Number(archiveDetailMatch[1]);
    const record = db.getEditionById(recordId);
    if (!record || record.status === "cancelled") {
      json(response, 404, { error: "This piece is not in the record." });
      return true;
    }
    json(response, 200, { piece: publicEditionRecord(record) });
    return true;
  }

  if (pathname === "/api/notify" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required for drop notifications." });
      return true;
    }

    const body = await readBody(request);
    const productId = String(body.productId || "");
    const preferredSize = String(body.preferredSize || "").trim().slice(0, 12);
    const product = db.getProductById(productId);

    if (!product || (product.status !== "preview" && product.status !== "live") || !productBelongsToOpenChapter(product)) {
      json(response, 404, { error: "Produsul nu este disponibil pentru notificari." });
      return true;
    }

    const notifications = readJson("notifications.json", []);
    const existing = notifications.find((item) => item.productId === product.id && item.userId === session.user.id);
    if (existing) {
      existing.preferredSize = preferredSize || existing.preferredSize || "";
      existing.updatedAt = new Date().toISOString();
      writeJson("notifications.json", notifications);
    } else {
      notifications.unshift({
        id: crypto.randomUUID(),
        productId: product.id,
        productName: product.name,
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
        preferredSize,
        createdAt: new Date().toISOString()
      });
      writeJson("notifications.json", notifications);
    }

    json(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/wishlist" && request.method === "GET") {
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }
    const wishlists = readJson("wishlists.json", {});
    const productIds = wishlists[session.user.id] || [];
    const products = db.listProducts()
      .filter((product) => productIds.includes(product.id))
      .map(publicProduct);
    json(response, 200, { products });
    return true;
  }

  if (pathname === "/api/wishlist" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    const body = await readBody(request);
    const productId = String(body.productId || "");
    const product = db.getProductById(productId);
    if (!product) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    const wishlists = readJson("wishlists.json", {});
    const current = wishlists[session.user.id] || [];
    if (!current.includes(productId)) {
      wishlists[session.user.id] = [...current, productId];
      writeJson("wishlists.json", wishlists);
    }

    json(response, 200, { ok: true });
    return true;
  }

  const wishlistItemMatch = pathname.match(/^\/api\/wishlist\/([^/]+)$/);
  if (wishlistItemMatch && request.method === "DELETE") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    const productId = decodeURIComponent(wishlistItemMatch[1]);
    const wishlists = readJson("wishlists.json", {});
    wishlists[session.user.id] = (wishlists[session.user.id] || []).filter((id) => id !== productId);
    writeJson("wishlists.json", wishlists);

    json(response, 200, { ok: true });
    return true;
  }

  const reviewsMatch = pathname.match(/^\/api\/products\/([^/]+)\/reviews$/);
  if (reviewsMatch && request.method === "GET") {
    const key = decodeURIComponent(reviewsMatch[1]);
    const product = db.getProductBySlugOrId(key);
    if (!product) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    const reviews = readJson("reviews.json", [])
      .filter((review) => review.productId === product.id && review.approved)
      .map((review) => ({ id: review.id, name: review.name, rating: review.rating, text: review.text, createdAt: review.createdAt }));

    const average = reviews.length
      ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
      : 0;

    json(response, 200, { reviews, average, count: reviews.length });
    return true;
  }

  if (reviewsMatch && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    const key = decodeURIComponent(reviewsMatch[1]);
    const product = db.getProductBySlugOrId(key);
    if (!product) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    const body = await readBody(request);
    const rating = Math.max(1, Math.min(5, Math.floor(Number(body.rating) || 0)));
    const text = String(body.text || "").trim().slice(0, 600);

    if (!rating || text.length < 3) {
      json(response, 400, { error: "Adauga o nota si un text de minimum 3 caractere." });
      return true;
    }

    const reviews = readJson("reviews.json", []);
    const existingIndex = reviews.findIndex((review) => review.productId === product.id && review.userId === session.user.id);
    const record = {
      id: existingIndex !== -1 ? reviews[existingIndex].id : crypto.randomUUID(),
      productId: product.id,
      userId: session.user.id,
      name: session.user.name,
      rating,
      text,
      approved: false,
      createdAt: existingIndex !== -1 ? reviews[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      reviews[existingIndex] = record;
    } else {
      reviews.unshift(record);
    }
    writeJson("reviews.json", reviews);

    json(response, 200, { ok: true, pendingApproval: true });
    return true;
  }

  if (pathname === "/api/cart" && request.method === "GET") {
    // Runs on every shop page load and still reads carts.json off disk, so it
    // carries the same per-IP ceiling as the pages that call it.
    if (isRateLimited(`cart-read:${clientIp(request)}`, 90, 60000)) {
      json(response, 429, { error: "Prea multe cereri. Mai asteapta putin." });
      return true;
    }
    const cartSession = getSession(request);
    const { cart } = getCart(request, response, cartSession);
    json(response, 200, { cart: buildCartPayload(cart) });
    return true;
  }

  if (pathname === "/api/cart/add" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const cartSession = getSession(request);
    const body = await readBody(request);
    const productId = String(body.productId || "");
    const size = String(body.size || "").trim();
    const qty = Math.max(1, Math.min(20, Math.floor(Number(body.qty) || 1)));
    const product = db.getProductById(productId);

    if (!product || !productCanBePurchased(product)) {
      json(response, 404, { error: "Produsul nu este disponibil." });
      return true;
    }

    if (Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(size)) {
      json(response, 400, { error: "Alege o marime valida." });
      return true;
    }

    if (availableStock(product, size) <= 0) {
      json(response, 409, { error: "Produsul este sold out." });
      return true;
    }

    const resultCart = await withStockLock(() => {
      const { cartId, cart, carts } = getCart(request, response, cartSession);
      const key = makeCartKey(productId, size);
      const currentQty = Number(cart.items[key] || 0);
      const freshProduct = db.getProductById(productId);
      const cap = freshProduct ? availableStock(freshProduct, size) : availableStock(product, size);
      cart.items[key] = Math.min(cap, currentQty + qty);
      cart.reminderSentAt = null;
      saveCart(cartId, cart, carts);
      return cart;
    });

    json(response, 200, { ok: true, cart: buildCartPayload(resultCart) });
    return true;
  }

  const cartItemMatch = pathname.match(/^\/api\/cart\/items\/([^/]+)$/);
  if (cartItemMatch && (request.method === "PUT" || request.method === "DELETE")) {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const cartSession = getSession(request);
    const key = decodeURIComponent(cartItemMatch[1]);
    const { productId, size } = parseCartKey(key);
    const body = request.method === "PUT" ? await readBody(request) : {};

    const resultCart = await withStockLock(() => {
      const { cartId, cart, carts } = getCart(request, response, cartSession);

      if (request.method === "DELETE") {
        delete cart.items[key];
      } else {
        const qty = Math.floor(Number(body.qty) || 0);
        if (qty <= 0) {
          delete cart.items[key];
        } else {
          const product = db.getProductById(productId);
          const cap = product ? availableStock(product, size) : qty;
          cart.items[key] = Math.min(cap, Math.max(1, qty));
          cart.reminderSentAt = null;
        }
      }

      saveCart(cartId, cart, carts);
      return cart;
    });

    json(response, 200, { ok: true, cart: buildCartPayload(resultCart) });
    return true;
  }

  if (pathname === "/api/checkout" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    // Unlike login/register, checkout had no rate limit at all. With no payment
    // gate in front of it yet, an unthrottled checkout endpoint lets anyone script
    // repeated orders to decrement real stock (and brute-force coupon codes)
    // without ever paying. This doesn't fix the missing payment step, but it
    // closes the easiest automated-abuse path against it.
    if (isRateLimited(`checkout:${clientIp(request)}`, 10, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const session = getSession(request);
    const body = await readBody(request);
    const customer = sanitizeCheckout(body, session);

    if (!customer.customerName || !customer.customerEmail.includes("@") || !customer.customerPhone || !customer.customerAddress) {
      json(response, 400, { error: "Completeaza nume, email, telefon si adresa." });
      return true;
    }

    const outcome = await withStockLock(() => {
      const { cartId, cart, carts } = getCart(request, response, session);
      const payload = buildCartPayload(cart);

      if (!payload.items.length) {
        return { error: "Cartul este gol." };
      }

      let discount = 0;
      let appliedCoupon = null;
      if (body.couponCode) {
        const couponResult = resolveCoupon(body.couponCode, payload.total);
        if (couponResult.error) {
          return { error: couponResult.error };
        }
        discount = couponResult.discount;
        appliedCoupon = couponResult.coupon;
      }

      const finalTotal = Math.max(0, Math.round((payload.total - discount) * 100) / 100);

      // Per-unit edition numbering. Every physical piece sold gets the next
      // number in its product's fixed edition. The edition total is pinned
      // the first time a product sells: numbers already assigned + stock
      // still unsold - a quantity that stays constant afterwards, since
      // each sale moves exactly one unit from "unsold" to "assigned".
      const productUpdates = [];
      const editionMeta = new Map();
      const itemEditions = new Map();

      for (const item of payload.items) {
        const current = db.getProductById(item.product.id);
        if (!current || !productCanBePurchased(current) || availableStock(current, item.size) < item.qty) {
          return { error: `Stoc insuficient pentru ${item.product.name}.` };
        }

        if (!editionMeta.has(current.id)) {
          const assigned = db.countEditionsForProduct(current.id);
          editionMeta.set(current.id, { assigned, total: assigned + current.stock });
        }
        const meta = editionMeta.get(current.id);
        const numbers = [];
        for (let unit = 0; unit < item.qty; unit += 1) {
          meta.assigned += 1;
          numbers.push(meta.assigned);
        }
        itemEditions.set(item, { numbers, total: meta.total });

        const nextSizeStock = current.sizeStock && item.size
          ? { ...current.sizeStock, [item.size]: current.sizeStock[item.size] - item.qty }
          : current.sizeStock;
        const nextStock = nextSizeStock ? totalStockFromSizeStock(nextSizeStock) : current.stock - item.qty;

        productUpdates.push({
          ...current,
          stock: nextStock,
          sizeStock: nextSizeStock,
          status: nextStock <= 0 ? "sold-out" : current.status,
          updatedAt: new Date().toISOString()
        });
      }

      const createdAt = new Date().toISOString();
      const accessToken = generateOrderAccessToken();
      const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "manual";
      const order = {
        id: crypto.randomUUID(),
        number: db.getNextOrderNumber(),
        userId: session?.user.id || null,
        ...customer,
        // No payment processor is integrated yet: every checkout is an order
        // REQUEST. It starts pending/unpaid; stock is held as a reservation
        // that expires (and restores itself) if the order is never confirmed.
        status: "pending",
        paymentStatus: "unpaid",
        paymentMethod,
        paidAt: null,
        publicAccessTokenHash: accessToken.hash,
        reservation: {
          expiresAt: new Date(Date.now() + STOCK_RESERVATION_MS).toISOString()
        },
        stockRestored: false,
        couponConsumed: false,
        couponRestored: false,
        editionsCancelled: false,
        currency: payload.currency,
        total: finalTotal,
        discount,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        items: payload.items.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          size: item.size || "",
          price: item.product.price,
          currency: item.product.currency,
          qty: item.qty,
          subtotal: item.subtotal,
          editionNumbers: itemEditions.get(item)?.numbers || [],
          editionTotal: itemEditions.get(item)?.total || null
        })),
        processedAt: null,
        shippedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        fulfillment: {
          courierName: "",
          trackingNumber: "",
          trackingUrl: "",
          estimatedDeliveryDate: "",
          customerNote: "",
          internalNote: ""
        },
        cancellationReason: "",
        statusHistory: [
          { from: null, to: "pending", changedAt: createdAt, changedBy: null, emailSent: true }
        ],
        createdAt
      };

      // Append one permanent record per physical piece. The record id is a
      // simple global sequence (records are never deleted or renumbered),
      // and doubles as the public certificate URL: /archive/<id>.
      const editionRecords = [];
      let recordSeq = db.getMaxEditionId();
      for (const item of order.items) {
        for (const number of item.editionNumbers) {
          recordSeq += 1;
          const sourceProduct = productUpdates.find((product) => product.id === item.productId);
          const chapter = genealogyChapter(productChapterId(sourceProduct)) || genealogyChapter("origin");
          editionRecords.push({
            id: recordSeq,
            productId: item.productId,
            orderId: order.id,
            productName: item.name,
            size: item.size,
            number,
            total: item.editionTotal,
            chapter: Number(chapter?.number || 1),
            chapterId: chapter?.id || "origin",
            chapterName: chapter?.name || "ORIGIN",
            chapterProductOrder: productChapterOrder(sourceProduct),
            assignedAt: createdAt
          });
        }
      }

      // Products + order + order_items + statusHistory + editions all land in
      // one SQL transaction - a crash partway through can no longer decrement
      // stock with no order to show for it (the JSON-era failure mode this
      // migration exists to close).
      db.withTransaction(() => {
        productUpdates.forEach((product) => db.upsertProduct(product));
        db.insertOrderComplete(order, editionRecords);
      });

      // The coupon's usedCount is only incremented when the order is actually
      // confirmed/paid (see the admin transition handler); pending orders hold
      // a "reservation" on the coupon counted by resolveCoupon instead.

      cart.items = {};
      cart.reminderSentAt = null;
      saveCart(cartId, cart, carts);
      return { order, publicAccessToken: accessToken.token, cart };
    });

    if (outcome.error) {
      const isBadRequest = /gol|cupon|reducere/i.test(outcome.error);
      json(response, isBadRequest ? 400 : 409, { error: outcome.error });
      return true;
    }

    const orderUrl = orderAccessUrl("thank-you.html", outcome.order.id, outcome.publicAccessToken);
    const invoiceUrl = orderAccessUrl("invoice.html", outcome.order.id, outcome.publicAccessToken);
    email.sendMail(email.buildOrderReceivedEmail(outcome.order, orderUrl, invoiceUrl)).catch(() => {});

    // The cart was emptied and saved inside the lock above, so re-reading
    // carts.json here would parse the whole file again to learn what this
    // closure already holds.
    // The plain token is returned exactly once, here; only its hash is stored.
    json(response, 200, {
      ok: true,
      order: publicOrder(outcome.order),
      publicAccessToken: outcome.publicAccessToken,
      cart: buildCartPayload(outcome.cart)
    });
    return true;
  }

  const payMatch = pathname.match(/^\/api\/orders\/([0-9a-f-]{36})\/pay$/);
  if (payMatch && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }
    // Card-decline scripting/guessing target, same reasoning as checkout's
    // own limit - tighter here since a real card auth is on the other end.
    if (isRateLimited(`pay:${clientIp(request)}`, 5, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const order = db.getOrderById(payMatch[1]);
    const session = getSession(request);
    const body = await readBody(request);
    const token = String(body.token || "");

    // Same 404-for-both-missing-and-forbidden shape as the order detail GET
    // route, so an order id can't be probed for existence via this endpoint.
    if (!order || !canViewOrder(order, session, token)) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    if (order.paymentStatus === "paid") {
      json(response, 200, { ok: true, order: publicOrder(order), alreadyPaid: true });
      return true;
    }

    if (order.status === "cancelled" || order.paymentStatus === "refunded") {
      json(response, 409, { error: "Comanda nu mai poate fi platita." });
      return true;
    }

    if (!square.isConfigured()) {
      json(response, 503, { error: "Plata cu cardul nu este momentan disponibila." });
      return true;
    }

    const sourceId = String(body.sourceId || "");
    if (!sourceId) {
      json(response, 400, { error: "Lipseste tokenul de plata." });
      return true;
    }

    // Amount comes from the order already stored in our DB, never from the
    // request body - the client only ever supplies the card token.
    const amountMoney = { amount: Math.round(order.total * 100), currency: order.currency };
    const pendingPaymentId = crypto.randomUUID();

    // Audit row inserted BEFORE calling Square, so there is a local record of
    // the attempt even if the call never returns at all (network death) -
    // this row is never "completed" itself; settlePaidSquarePayment below
    // inserts its own authoritative row once Square actually confirms.
    await withStockLock(() => {
      db.insertPayment({
        id: pendingPaymentId, orderId: order.id, provider: "square", kind: "charge",
        amount: order.total, currency: order.currency, status: "pending", createdAt: new Date().toISOString()
      });
    });

    const result = await square.createPayment({
      sourceId,
      amountMoney,
      idempotencyKey: pendingPaymentId,
      referenceId: order.number
    });

    if (!result.ok) {
      await withStockLock(() => {
        db.updatePaymentStatus(pendingPaymentId, { status: result.ambiguous ? "unknown" : "failed", rawResponse: result });
      });
      if (result.ambiguous) {
        json(response, 502, {
          ambiguous: true,
          error: "Nu am putut confirma plata din cauza unei erori de retea. Nu incerca imediat din nou - verifica peste cateva minute statusul comenzii inainte de a reincerca cardul."
        });
      } else {
        json(response, 402, { error: result.errors?.[0]?.detail || result.errors?.[0]?.code || "Plata a fost refuzata." });
      }
      return true;
    }

    const settled = await settlePaidSquarePayment({
      orderId: order.id,
      providerPaymentId: result.paymentId,
      amount: order.total,
      currency: order.currency,
      rawResponse: result.raw,
      changedBy: session?.user.email || "guest:square-pay"
    });

    if (settled.error) {
      json(response, 404, { error: "Comanda nu mai exista." });
      return true;
    }

    if (!settled.alreadySettled && !db.getEmailLog(settled.order.id, "payment-confirmed")) {
      const orderUrl = orderAccessUrl("thank-you.html", settled.order.id, settled.accessToken);
      const invoiceUrl = orderAccessUrl("invoice.html", settled.order.id, settled.accessToken);
      const emailResult = await email.sendPaymentConfirmedEmail(settled.order, orderUrl, invoiceUrl);
      await withStockLock(() => {
        db.insertEmailLog({
          orderId: settled.order.id, status: "payment-confirmed", sentAt: new Date().toISOString(),
          ok: emailResult.ok, reason: emailResult.reason || null
        });
      });
    }

    // settlePaidSquarePayment rotates the guest access token (see its own
    // comment - the webhook path needs a fresh plaintext token too, and only
    // one token is ever valid at a time). The token this request came in
    // with is therefore already stale by the time we respond - hand back
    // the new one (once, same as checkout does) so the browser's post-pay
    // redirect and any later "view this order" call use a token that
    // actually still works, instead of the one it just spent.
    json(response, 200, {
      ok: true,
      order: publicOrder(settled.order),
      publicAccessToken: settled.accessToken || undefined
    });
    return true;
  }

  if (pathname === "/api/webhooks/square" && request.method === "POST") {
    // Square, not a browser, calls this - no Origin header will be present
    // (sameOriginPost would pass trivially anyway) and no session exists.
    // The HMAC signature below is the only authentication this route has.
    const rawBody = await readBuffer(request);
    const signatureHeader = request.headers["x-square-hmacsha256-signature"];
    const notificationUrl = `${SITE_ORIGIN}/api/webhooks/square`;

    if (!square.verifyWebhookSignature({ rawBody, signatureHeader, notificationUrl })) {
      json(response, 401, { error: "invalid signature" });
      return true;
    }

    let event = null;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      event = null;
    }

    // Once the signature checks out, always answer 200 - Square retries
    // aggressively on non-2xx, and a retry storm doesn't fix a bug in this
    // handler or an order we can't find. Errors are logged for manual
    // reconciliation instead.
    try {
      if (event?.type === "payment.updated") {
        const payment = event.data?.object?.payment;
        if (payment?.status === "COMPLETED" && payment.reference_id) {
          const order = db.getOrderByNumber(payment.reference_id);
          if (!order) {
            console.error("[square-webhook] payment.updated pentru o comanda necunoscuta:", payment.reference_id);
          } else {
            const settled = await settlePaidSquarePayment({
              orderId: order.id,
              providerPaymentId: payment.id,
              amount: (payment.amount_money?.amount || 0) / 100,
              currency: payment.amount_money?.currency || order.currency,
              rawResponse: payment,
              changedBy: "square:webhook"
            });

            if (!settled.error && !settled.alreadySettled && !db.getEmailLog(settled.order.id, "payment-confirmed")) {
              const orderUrl = orderAccessUrl("thank-you.html", settled.order.id, settled.accessToken);
              const invoiceUrl = orderAccessUrl("invoice.html", settled.order.id, settled.accessToken);
              const emailResult = await email.sendPaymentConfirmedEmail(settled.order, orderUrl, invoiceUrl);
              await withStockLock(() => {
                db.insertEmailLog({
                  orderId: settled.order.id, status: "payment-confirmed", sentAt: new Date().toISOString(),
                  ok: emailResult.ok, reason: emailResult.reason || null
                });
              });
            }
          }
        }
      } else if (event?.type === "refund.updated") {
        // Ledger-only: keeps the payments row's status in step with Square's
        // side (RefundPayment's own sync response is typically PENDING, not
        // COMPLETED - see the admin route). No email here; the refund-confirmed
        // email already went out synchronously when the admin triggered it.
        const refund = event.data?.object?.refund;
        if (refund?.status === "COMPLETED" && refund.payment_id) {
          await withStockLock(() => {
            const existingRefundRow = db.getPaymentByProviderPaymentId(refund.id);
            if (existingRefundRow) {
              if (existingRefundRow.status !== "completed") {
                db.updatePaymentStatus(existingRefundRow.id, { status: "completed", rawResponse: refund });
              }
              return;
            }
            // No local row yet (e.g. the refund was issued directly from the
            // Square dashboard rather than through our admin UI) - the
            // charge it refunds must still be one of ours, or this isn't
            // a payment this app should record.
            const chargePayment = db.getPaymentByProviderPaymentId(refund.payment_id);
            if (!chargePayment) return;
            db.insertPayment({
              id: crypto.randomUUID(), orderId: chargePayment.orderId, provider: "square",
              providerPaymentId: refund.id, kind: "refund",
              amount: (refund.amount_money?.amount || 0) / 100, currency: refund.amount_money?.currency || chargePayment.currency,
              status: "completed", rawResponse: refund, createdAt: new Date().toISOString()
            });
          });
        }
      }
    } catch (error) {
      console.error("[square-webhook]", error);
    }

    send(response, 200, "ok");
    return true;
  }

  if (pathname === "/api/orders" && request.method === "GET") {
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    const orders = db.listOrdersForUser(session.user.id).map(publicOrder);

    json(response, 200, { orders });
    return true;
  }

  const orderDetailMatch = pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/);
  if (orderDetailMatch && request.method === "GET") {
    if (isRateLimited(`order-view:${clientIp(request)}`, 30, 60000)) {
      json(response, 429, { error: "Prea multe incercari. Mai asteapta putin." });
      return true;
    }

    const order = db.getOrderById(orderDetailMatch[1]);
    const session = getSession(request);
    const token = new URL(request.url, `http://${request.headers.host || "localhost"}`).searchParams.get("token") || "";

    // Same 404 whether the order is missing or the caller isn't allowed to
    // see it, so order ids can't be probed for existence.
    if (!order || !canViewOrder(order, session, token)) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    json(response, 200, { order: publicOrder(order) });
    return true;
  }

  return false;
}

// Builds the customer-facing link for an order page. The token grants guest
// access; without one the link only works for the logged-in owner or admins.
function orderAccessUrl(page, orderId, token) {
  const tokenPart = token ? `&token=${encodeURIComponent(token)}` : "";
  return `${SITE_ORIGIN}/${page}?order=${encodeURIComponent(orderId)}${tokenPart}`;
}

function paginate(request, list) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const hasPaging = url.searchParams.has("page") || url.searchParams.has("pageSize");

  if (!hasPaging) {
    return { items: list, page: 1, pageSize: list.length, total: list.length };
  }

  const pageSize = Math.min(200, Math.max(1, Math.floor(requestedSize) || 50));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
  const start = (page - 1) * pageSize;
  return { items: list.slice(start, start + pageSize), page, pageSize, total: list.length };
}

function sendVerificationEmail(user) {
  try {
    const verifications = readJson("email-verifications.json", []);
    const filtered = verifications.filter((item) => item.userId !== user.id);
    const token = crypto.randomBytes(32).toString("hex");
    filtered.unshift({
      token,
      userId: user.id,
      expiresAt: Date.now() + 1000 * 60 * 60 * 48,
      createdAt: new Date().toISOString()
    });
    writeJson("email-verifications.json", filtered.slice(0, 500));
    const verifyUrl = `${SITE_ORIGIN}/verify-email.html?token=${token}`;
    email.sendMail(email.buildVerificationEmail(user, verifyUrl)).catch(() => {});
  } catch (error) {
    console.error("[verify-email]", error);
  }
}

function notifyDropLive(product) {
  try {
    const notifications = readJson("notifications.json", []);
    const matches = notifications.filter((item) => item.productId === product.id);
    if (!matches.length) return;

    const productUrl = `${SITE_ORIGIN}/product.html?slug=${encodeURIComponent(product.slug || toSlug(product.name))}`;
    matches.forEach((entry) => {
      email.sendMail(email.buildDropLiveEmail(entry, product, productUrl)).catch(() => {});
    });

    const remaining = notifications.filter((item) => item.productId !== product.id);
    writeJson("notifications.json", remaining);
  } catch (error) {
    console.error("[drop-live]", error);
  }
}

const ABANDONED_CART_DELAY_MS = 1000 * 60 * 60 * 2;

function checkAbandonedCarts() {
  try {
    const carts = readJson("carts.json", {});
    const now = Date.now();
    let changed = false;

    for (const [cartId, cart] of Object.entries(carts)) {
      if (!cart.userId || !cart.email || cart.reminderSentAt) continue;
      if (!cart.items || !Object.keys(cart.items).length) continue;

      const updatedAt = new Date(cart.updatedAt || 0).getTime();
      if (!updatedAt || now - updatedAt < ABANDONED_CART_DELAY_MS) continue;

      const payload = buildCartPayload(cart);
      if (!payload.items.length) continue;

      const cartUrl = `${SITE_ORIGIN}/#drop`;
      email.sendMail(email.buildAbandonedCartEmail(cart, payload, cartUrl)).catch(() => {});
      carts[cartId] = { ...cart, reminderSentAt: new Date().toISOString() };
      changed = true;
    }

    if (changed) writeJson("carts.json", carts);
  } catch (error) {
    console.error("[abandoned-cart]", error);
  }
}

setInterval(checkAbandonedCarts, 1000 * 60 * 30).unref();

// Auto-cancels pending, unpaid orders whose stock reservation expired,
// restoring stock/coupon/editions exactly once (same idempotent path as a
// manual cancellation). Paid orders are never auto-cancelled.
function expireStaleReservations() {
  return withStockLock(() => {
    try {
      const now = Date.now();
      const pendingOrders = db.listOrdersAdmin().filter((order) => order.status === "pending" && order.paymentStatus !== "paid");

      for (const order of pendingOrders) {
        // Same gate the admin path uses, rather than a second inline copy of
        // the rule, so this can't drift from ORDER_TRANSITIONS later.
        if (!isAllowedOrderTransition(order.status, "cancelled")) continue;
        const expiresAt = order.reservation?.expiresAt ? new Date(order.reservation.expiresAt).getTime() : NaN;
        if (!Number.isFinite(expiresAt) || now < expiresAt) continue;

        const stamp = new Date().toISOString();
        let cancelled = {
          ...order,
          status: "cancelled",
          cancelledAt: stamp,
          cancellationReason: order.cancellationReason || "Rezervarea de stoc a expirat fara confirmare.",
          updatedAt: stamp
        };
        cancelled = restoreOrderResources(cancelled, "system:reservation-expired");
        db.updateOrder(order.id, cancelled);
        db.appendOrderStatusHistory(order.id, {
          from: "pending",
          to: "cancelled",
          changedAt: stamp,
          changedBy: "system:reservation-expired",
          emailSent: false
        });
      }
    } catch (error) {
      console.error("[reservations]", error);
    }
  });
}

setInterval(expireStaleReservations, 1000 * 60 * 15).unref();

// Periodic data hygiene: expired sessions/tokens, stale carts, old outbox
// entries and analytics retention. Keeps the JSON files from accumulating
// personal data or dead entries forever.
function runDataMaintenance() {
  try {
    // Land buffered pageviews before the retention pass below prunes
    // analytics.json, so maintenance and the next flush don't write over
    // each other's view of the file.
    flushPageviews();

    const now = Date.now();

    db.deleteExpiredSessions(now);

    const resets = readJson("password-resets.json", []);
    const liveResets = resets.filter((entry) => entry && !entry.usedAt && now <= Number(entry.expiresAt || 0));
    if (liveResets.length !== resets.length) writeJson("password-resets.json", liveResets);

    const verifications = readJson("email-verifications.json", []);
    const liveVerifications = verifications.filter((entry) => entry && now <= Number(entry.expiresAt || 0));
    if (liveVerifications.length !== verifications.length) writeJson("email-verifications.json", liveVerifications);

    const carts = readJson("carts.json", {});
    let cartsChanged = false;
    for (const [cartId, cart] of Object.entries(carts)) {
      const updatedAt = new Date(cart?.updatedAt || 0).getTime();
      if (!updatedAt || now - updatedAt > cartTtlMs) {
        delete carts[cartId];
        cartsChanged = true;
      }
    }
    if (cartsChanged) writeJson("carts.json", carts);

    const outbox = readJson("email-outbox.json", []);
    const outboxCutoff = now - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const liveOutbox = outbox.filter((entry) => new Date(entry?.createdAt || 0).getTime() >= outboxCutoff);
    if (liveOutbox.length !== outbox.length) writeJson("email-outbox.json", liveOutbox);

    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    let analyticsChanged = false;
    const dayCutoff = new Date(now - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const day of Object.keys(analytics.byDay || {})) {
      if (day < dayCutoff) {
        delete analytics.byDay[day];
        analyticsChanged = true;
      }
    }
    const visitCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const recentVisits = (analytics.recentVisits || []).filter((visit) => new Date(visit?.at || 0).getTime() >= visitCutoff);
    if (recentVisits.length !== (analytics.recentVisits || []).length) {
      analytics.recentVisits = recentVisits;
      analyticsChanged = true;
    }
    if (analyticsChanged) writeJson("analytics.json", analytics);
  } catch (error) {
    console.error("[maintenance]", error);
  }
}

setInterval(runDataMaintenance, 1000 * 60 * 60).unref();

// There was previously no backup of data/*.json at all - a bad write, a bug, or
// deleting the wrong folder on the VPS would have taken every order/user/review
// with it, with no way back. This keeps rolling local snapshots so a bad state
// can be rolled back to a recent one. It does NOT protect against losing the
// whole disk/server - that still needs an off-server backup, which this can't
// set up on its own since it has no access to external storage.
// backupsDir is defined near the top (sibling of dataDir, brand-suffixed for
// non-BeCa brands) because the storage layer needs it for corrupt-file
// restoration as well.
const MAX_BACKUPS = 14;

function backupDataFiles() {
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(backupsDir, stamp);
    fs.mkdirSync(target, { recursive: true });

    for (const fileName of fs.readdirSync(dataDir)) {
      if (!fileName.endsWith(".json")) continue;
      fs.copyFileSync(path.join(dataDir, fileName), path.join(target, fileName));
    }

    const existing = fs.readdirSync(backupsDir)
      .filter((name) => fs.statSync(path.join(backupsDir, name)).isDirectory())
      .sort();
    while (existing.length > MAX_BACKUPS) {
      const oldest = existing.shift();
      fs.rmSync(path.join(backupsDir, oldest), { recursive: true, force: true });
    }
  } catch (error) {
    console.error("[backup]", error);
  }
}

function resolveCoupon(rawCode, total) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { coupon: null, discount: 0 };

  const coupons = readJson("coupons.json", []);
  const index = coupons.findIndex((coupon) => coupon.code === code);
  if (index === -1) return { error: "Cod de reducere invalid." };

  const coupon = coupons[index];
  if (!coupon.active) return { error: "Codul de reducere nu mai este activ." };
  if (coupon.expiresAt) {
    const expiresAtMs = new Date(coupon.expiresAt).getTime();
    // An unparseable expiry date must fail closed, not act as "never expires".
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return { error: "Codul de reducere a expirat." };
    }
  }

  if (coupon.maxUses) {
    // usedCount only counts confirmed/paid orders; pending orders hold the
    // coupon too, so count them as well - otherwise N parallel checkouts
    // could all pass this check and push usage past maxUses on confirm.
    const pendingHolds = db.countPendingCouponHolds(code);
    if ((coupon.usedCount || 0) + pendingHolds >= coupon.maxUses) {
      return { error: "Codul de reducere a fost folosit de maximum de ori." };
    }
  }

  // Percent coupons are clamped to 0-100 even if legacy data holds a larger
  // value; fixed coupons can never exceed the order total.
  const discount = coupon.type === "fixed"
    ? Math.min(total, Math.max(0, Number(coupon.value) || 0))
    : Math.round(total * (Math.min(100, Math.max(0, Number(coupon.value) || 0)) / 100) * 100) / 100;

  return { coupon, discount };
}

function toCsvValue(value) {
  // Genuine numbers are safe and must stay numeric for spreadsheets.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  let str = String(value ?? "");
  // Neutralize spreadsheet formula injection: a leading =, +, -, @, tab or
  // carriage return would make Excel/Sheets evaluate the cell as a formula.
  // A leading apostrophe forces text interpretation.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(rows, columns) {
  const header = columns.map((col) => toCsvValue(col.label)).join(",");
  const lines = rows.map((row) => columns.map((col) => toCsvValue(col.value(row))).join(","));
  return [header, ...lines].join("\r\n");
}

function sendCsv(response, filename, csv) {
  send(response, 200, `﻿${csv}`, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
}

async function handleAdminApi(request, response, pathname) {
  if (!pathname.startsWith("/api/admin/")) return false;

  const session = getSession(request);
  if (!session || session.user.role !== "admin") {
    json(response, 401, { error: "Admin login required." });
    return true;
  }

  if (request.method !== "GET" && !sameOriginPost(request)) {
    json(response, 403, { error: "Request blocked." });
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "GET") {
    json(response, 200, sanitizeContent(readJson("content.json", { en: {}, ro: {}, branding: {} })));
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "PUT") {
    const body = await readBody(request);
    const current = sanitizeContent(readJson("content.json", { en: {}, ro: {}, branding: {} }));
    // Incoming values are sanitized before merging: text becomes plain text
    // (no tags, no event handlers), branding accepts only known record shapes
    // with approved image URLs - arbitrary values are dropped.
    const incoming = sanitizeContent(body);
    const next = {
      en: { ...current.en, ...incoming.en },
      ro: { ...current.ro, ...incoming.ro },
      branding: { ...current.branding, ...incoming.branding }
    };
    writeJson("content.json", next);
    json(response, 200, { ok: true, content: next });
    return true;
  }

  if (pathname === "/api/admin/content/image" && request.method === "POST") {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      json(response, 400, { error: "Trimite imaginea ca multipart/form-data." });
      return true;
    }

    const parsed = parseMultipart(await readBuffer(request), contentType);
    const url = saveProductImage(parsed.files.image);
    if (!url) {
      json(response, 400, { error: "Imagine invalida." });
      return true;
    }

    json(response, 200, { ok: true, url: `/${url}` });
    return true;
  }

  if (pathname === "/api/admin/summary" && request.method === "GET") {
    flushPageviews();
    const userCounts = db.countUsers();
    const productCounts = db.countProducts();
    const orderSummary = db.getOrderSummary();
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const today = new Date().toISOString().slice(0, 10);
    json(response, 200, {
      users: userCounts.total,
      clients: userCounts.clients,
      products: productCounts.total,
      liveProducts: productCounts.live,
      previewProducts: productCounts.preview,
      notifications: readJson("notifications.json", []).length,
      orders: orderSummary.total,
      pendingOrders: orderSummary.pending,
      // Revenue counts only paid orders - a pending, unpaid order request is
      // not income.
      revenue: orderSummary.revenue,
      pageviewsToday: analytics.byDay[today] ? analytics.byDay[today].pageviews : 0,
      legalPlaceholders: brandLegalPlaceholders()
    });
    return true;
  }

  if (pathname === "/api/admin/analytics" && request.method === "GET") {
    flushPageviews();
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const days = [];
    const pathTotals = {};
    const today = new Date();

    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      const entry = analytics.byDay[key];
      days.push({ date: key, pageviews: entry ? entry.pageviews : 0 });
      if (entry) {
        for (const [path, count] of Object.entries(entry.paths)) {
          pathTotals[path] = (pathTotals[path] || 0) + count;
        }
      }
    }

    const topPages = Object.entries(pathTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }));

    json(response, 200, {
      totalPageviews: analytics.totalPageviews || 0,
      last14Days: days,
      topPages
    });
    return true;
  }

  // Per-page numbers for the in-page stats popover. The dashboard endpoint
  // above only exposes site-wide daily totals plus a top-8 list, so a page
  // outside that list has nothing to show - but byDay[day].paths already
  // holds the per-path counts. Views are tracked by pathname only, so
  // /product.html here means every product, not one slug.
  if (pathname === "/api/admin/analytics/page" && request.method === "GET") {
    flushPageviews();
    const target = new URL(request.url, `http://${request.headers.host}`).searchParams.get("path") || "/";
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const today = new Date();
    const days = [];
    let total = 0;
    let siteTotal = 0;
    let best = 0;

    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      const entry = analytics.byDay[key];
      const views = (entry && entry.paths && entry.paths[target]) || 0;
      days.push({ date: key, views });
      total += views;
      siteTotal += (entry && entry.pageviews) || 0;
      if (views > best) best = views;
    }

    // Where this page ranks against every other page over the same window.
    const totals = {};
    days.forEach((_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (13 - index));
      const entry = analytics.byDay[date.toISOString().slice(0, 10)];
      if (!entry || !entry.paths) return;
      for (const [key, count] of Object.entries(entry.paths)) {
        totals[key] = (totals[key] || 0) + count;
      }
    });
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    json(response, 200, {
      path: target,
      last14Days: days,
      total14: total,
      today: days[days.length - 1].views,
      peak: best,
      siteTotal14: siteTotal,
      rank: ranked.findIndex(([key]) => key === target) + 1 || null,
      pagesTracked: ranked.length
    });
    return true;
  }

  if (pathname === "/api/admin/email/test" && request.method === "POST") {
    const config = email.getConfig();
    const configured = email.isConfigured(config);

    if (!configured) {
      json(response, 200, { ok: false, configured: false, reason: "smtp-not-configured" });
      return true;
    }

    const result = await email.sendMail({
      to: session.user.email,
      subject: `Test SMTP ${BRAND.brandShortName}`,
      text: `Acesta este un email de test trimis din panoul admin ${BRAND.brandShortName} pentru a confirma ca SMTP-ul functioneaza.`
    });

    json(response, 200, { ...result, configured: true });
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const users = db.listUsers().map(safePublicUser);
    const { items, page, pageSize, total } = paginate(request, users);
    json(response, 200, {
      users: items,
      page,
      pageSize,
      total,
      canManageRoles: Boolean(session.user.isPrimaryAdmin)
    });
    return true;
  }

  const userRoleMatch = pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/role$/);
  if (userRoleMatch && request.method === "PUT") {
    if (!session.user.isPrimaryAdmin) {
      json(response, 403, { error: "Doar admin-ul principal poate modifica roluri." });
      return true;
    }

    const body = await readBody(request);
    const role = String(body.role || "").trim();

    if (!["admin", "client"].includes(role)) {
      json(response, 400, { error: "Rol invalid." });
      return true;
    }

    const targetUser = db.getUserById(userRoleMatch[1]);

    if (!targetUser) {
      json(response, 404, { error: "Userul nu exista." });
      return true;
    }

    if (targetUser.isPrimaryAdmin && role !== "admin") {
      json(response, 400, { error: "Admin-ul principal trebuie sa ramana admin." });
      return true;
    }

    const updatedTarget = db.updateUser(targetUser.id, { role });
    json(response, 200, { ok: true, user: safePublicUser(updatedTarget) });
    return true;
  }

  if (pathname === "/api/admin/products" && request.method === "GET") {
    const products = db.listProducts();
    const { items, page, pageSize, total } = paginate(request, products);
    json(response, 200, { products: items, page, pageSize, total });
    return true;
  }

  if (pathname === "/api/admin/orders" && request.method === "GET") {
    const orders = db.listOrdersAdmin();
    const { items, page, pageSize, total } = paginate(request, orders);
    json(response, 200, { orders: items, page, pageSize, total });
    return true;
  }

  if (pathname === "/api/admin/notifications" && request.method === "GET") {
    const notifications = readJson("notifications.json", []);
    const { items, page, pageSize, total } = paginate(request, notifications);
    json(response, 200, { notifications: items, page, pageSize, total });
    return true;
  }

  if (pathname === "/api/admin/reviews" && request.method === "GET") {
    const products = db.listProducts();
    const reviews = readJson("reviews.json", []).map((review) => ({
      ...review,
      productName: products.find((product) => product.id === review.productId)?.name || "Produs sters"
    }));
    const { items, page, pageSize, total } = paginate(request, reviews);
    json(response, 200, { reviews: items, page, pageSize, total });
    return true;
  }

  const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([a-f0-9-]+)$/);
  if (reviewMatch && request.method === "PUT") {
    const body = await readBody(request);
    const reviews = readJson("reviews.json", []);
    const index = reviews.findIndex((review) => review.id === reviewMatch[1]);
    if (index === -1) {
      json(response, 404, { error: "Recenzia nu exista." });
      return true;
    }
    reviews[index] = { ...reviews[index], approved: Boolean(body.approved), updatedAt: new Date().toISOString() };
    writeJson("reviews.json", reviews);
    json(response, 200, { ok: true, review: reviews[index] });
    return true;
  }

  if (reviewMatch && request.method === "DELETE") {
    const reviews = readJson("reviews.json", []);
    writeJson("reviews.json", reviews.filter((review) => review.id !== reviewMatch[1]));
    json(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/coupons" && request.method === "GET") {
    const coupons = readJson("coupons.json", []);
    json(response, 200, { coupons });
    return true;
  }

  if (pathname === "/api/admin/coupons" && request.method === "POST") {
    const body = await readBody(request);
    const code = String(body.code || "").trim().toUpperCase().slice(0, 24);
    const type = body.type === "fixed" ? "fixed" : "percent";
    const value = Math.max(0, Number(body.value) || 0);

    if (!code || !value) {
      json(response, 400, { error: "Cod si valoare sunt obligatorii." });
      return true;
    }

    if (type === "percent" && (value <= 0 || value > 100)) {
      json(response, 400, { error: "Cuponul procentual trebuie sa fie intre 0 si 100." });
      return true;
    }

    if (body.expiresAt && !Number.isFinite(new Date(body.expiresAt).getTime())) {
      json(response, 400, { error: "Data de expirare este invalida." });
      return true;
    }

    // Shares the lock every other coupon writer uses, so a duplicate-code
    // check can't be overtaken by a concurrent create between read and write.
    const outcome = await withStockLock(() => {
      const coupons = readJson("coupons.json", []);
      if (coupons.some((existing) => existing.code === code)) return { conflict: true };

      const coupon = {
        id: crypto.randomUUID(),
        code,
        type,
        value,
        maxUses: body.maxUses ? Math.max(1, Math.floor(Number(body.maxUses))) : null,
        usedCount: 0,
        expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
        active: true,
        createdAt: new Date().toISOString()
      };
      coupons.unshift(coupon);
      writeJson("coupons.json", coupons);
      return { coupon };
    });

    if (outcome.conflict) {
      json(response, 409, { error: "Exista deja un cupon cu acest cod." });
      return true;
    }

    json(response, 200, { ok: true, coupon: outcome.coupon });
    return true;
  }

  const couponMatch = pathname.match(/^\/api\/admin\/coupons\/([a-f0-9-]+)$/);
  if (couponMatch && request.method === "PUT") {
    const body = await readBody(request);
    const updated = await withStockLock(() => {
      const coupons = readJson("coupons.json", []);
      const index = coupons.findIndex((coupon) => coupon.id === couponMatch[1]);
      if (index === -1) return null;
      // Only the active flag is editable here; spreading the stored record
      // keeps usedCount intact even if a checkout just incremented it.
      coupons[index] = { ...coupons[index], active: Boolean(body.active) };
      writeJson("coupons.json", coupons);
      return coupons[index];
    });

    if (!updated) {
      json(response, 404, { error: "Cuponul nu exista." });
      return true;
    }

    json(response, 200, { ok: true, coupon: updated });
    return true;
  }

  if (couponMatch && request.method === "DELETE") {
    await withStockLock(() => {
      const coupons = readJson("coupons.json", []);
      writeJson("coupons.json", coupons.filter((coupon) => coupon.id !== couponMatch[1]));
    });
    json(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/stats/revenue" && request.method === "GET") {
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const validOrders = db.listOrdersAdmin().filter(orderCountsAsRevenue);
    const totalRevenue = validOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const averageOrderValue = validOrders.length ? Math.round((totalRevenue / validOrders.length) * 100) / 100 : 0;

    const byDay = {};
    validOrders.forEach((order) => {
      const day = String(order.createdAt || "").slice(0, 10);
      if (!day) return;
      byDay[day] = (byDay[day] || 0) + (Number(order.total) || 0);
    });

    const days = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      days.push({
        date: key,
        revenue: Math.round((byDay[key] || 0) * 100) / 100,
        orders: validOrders.filter((order) => String(order.createdAt || "").slice(0, 10) === key).length
      });
    }

    const totalPageviews = analytics.totalPageviews || 0;
    const conversionRate = totalPageviews ? Math.round((validOrders.length / totalPageviews) * 10000) / 100 : 0;

    json(response, 200, {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageOrderValue,
      totalOrders: validOrders.length,
      conversionRate,
      last14Days: days
    });
    return true;
  }

  if (pathname === "/api/admin/stats/products" && request.method === "GET") {
    const orders = db.listOrdersAdmin().filter(orderCountsAsRevenue);
    const totals = new Map();

    orders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const key = `${item.productId || item.name}::${item.size || ""}`;
        const current = totals.get(key) || { productId: item.productId, name: item.name, size: item.size || "", qty: 0, revenue: 0 };
        current.qty += (Number(item.qty) || 0);
        current.revenue += (Number(item.subtotal) || 0);
        totals.set(key, current);
      });
    });

    const topProducts = [...totals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20)
      .map((entry) => ({ ...entry, revenue: Math.round(entry.revenue * 100) / 100 }));

    json(response, 200, { topProducts });
    return true;
  }

  if (pathname === "/api/admin/stats/traffic" && request.method === "GET") {
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const referrers = {};
    const hours = new Array(24).fill(0);
    const locales = {};

    Object.values(analytics.byDay || {}).forEach((day) => {
      Object.entries(day.referrers || {}).forEach(([ref, count]) => {
        referrers[ref] = (referrers[ref] || 0) + count;
      });
      (day.hours || []).forEach((count, hour) => {
        hours[hour] += count || 0;
      });
      Object.entries(day.locales || {}).forEach(([locale, count]) => {
        locales[locale] = (locales[locale] || 0) + count;
      });
    });

    const topReferrers = Object.entries(referrers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([source, count]) => ({ source, count }));
    const topLocales = Object.entries(locales).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([locale, count]) => ({ locale, count }));

    json(response, 200, {
      hours,
      topReferrers,
      topLocales,
      recentVisits: (analytics.recentVisits || []).slice(0, 100)
    });
    return true;
  }

  if (pathname === "/api/admin/export/orders.csv" && request.method === "GET") {
    const orders = db.listOrdersAdmin();
    const csv = toCsv(orders, [
      { label: "Numar", value: (o) => o.number },
      { label: "Status", value: (o) => o.status },
      { label: "Client", value: (o) => o.customerName },
      { label: "Email", value: (o) => o.customerEmail },
      { label: "Telefon", value: (o) => o.customerPhone },
      { label: "Adresa", value: (o) => o.customerAddress },
      { label: "Total", value: (o) => o.total },
      { label: "Moneda", value: (o) => o.currency },
      { label: "Reducere", value: (o) => o.discount || 0 },
      { label: "Cupon", value: (o) => o.couponCode || "" },
      { label: "Produse", value: (o) => (o.items || []).map((item) => `${item.qty}x ${item.name}${item.size ? ` (${item.size})` : ""}`).join("; ") },
      { label: "Creat la", value: (o) => o.createdAt }
    ]);
    sendCsv(response, "comenzi.csv", csv);
    return true;
  }

  if (pathname === "/api/admin/export/users.csv" && request.method === "GET") {
    const users = db.listUsers();
    const csv = toCsv(users, [
      { label: "Nume", value: (u) => u.name },
      { label: "Email", value: (u) => u.email },
      { label: "Rol", value: (u) => u.role },
      { label: "Email verificat", value: (u) => (u.emailVerified ? "da" : "nu") },
      { label: "Creat la", value: (u) => u.createdAt }
    ]);
    sendCsv(response, "useri.csv", csv);
    return true;
  }

  if (pathname === "/api/admin/export/notifications.csv" && request.method === "GET") {
    const notifications = readJson("notifications.json", []);
    const csv = toCsv(notifications, [
      { label: "Produs", value: (n) => n.productName },
      { label: "Nume", value: (n) => n.name },
      { label: "Email", value: (n) => n.email },
      { label: "Marime preferata", value: (n) => n.preferredSize || "" },
      { label: "Creat la", value: (n) => n.createdAt }
    ]);
    sendCsv(response, "waitlist.csv", csv);
    return true;
  }

  if (pathname === "/api/admin/products" && request.method === "POST") {
    const body = await readProductPayload(request);
    const product = sanitizeProduct(body);

    if (!product.name) {
      json(response, 400, { error: "Produsul are nevoie de nume." });
      return true;
    }

    await withStockLock(() => {
      db.upsertProduct(product);
    });
    json(response, 200, { ok: true, product });
    return true;
  }

  if (pathname === "/api/admin/studio-products" && request.method === "POST") {
    const body = await readBody(request);
    const imageUrl = saveDataUrlImage(body.previewImage || "", "studio-product");
    const textureUrl = saveDataUrlImage(body.textureImage || "", "studio-texture");
    const product = sanitizeProduct({
      ...body,
      imageUrl: imageUrl || body.imageUrl || "",
      status: body.status || "draft"
    });

    if (!product.name) {
      json(response, 400, { error: "Produsul are nevoie de nume." });
      return true;
    }

    const modelUrl = String(body.modelUrl || "assets/models/tshirt-web.glb")
      .replace(/^\.\.\//, "")
      .replace(/^\/+/, "");

    product.studio = {
      model: modelUrl || "assets/models/tshirt-web.glb",
      print: {
        x: Number(body.printX || 0),
        y: Number(body.printY || 0),
        scale: Number(body.printScale || 1),
        rotation: Number(body.printRotation || 0),
        opacity: Number(body.printOpacity || 1)
      },
      textureUrl: textureUrl || String(body.textureUrl || ""),
      shirtColor: String(body.shirtColor || "#ffffff").slice(0, 24)
    };

    await withStockLock(() => {
      db.upsertProduct(product);
    });
    json(response, 200, { ok: true, product });
    return true;
  }

  // Drag-to-reorder from the grid. /api/products already sorts on
  // chapterProductOrder, but sanitizeProduct only writes that field for
  // brands with genealogy - BeCa has none, so every product sat on the 999
  // default and the grid fell back to creation date. Set the field directly
  // from the order the admin dropped the cards in.
  if (pathname === "/api/admin/products/reorder" && request.method === "POST") {
    const body = await readBody(request);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];

    if (!ids.length) {
      json(response, 400, { error: "Lipseste ordinea produselor." });
      return true;
    }

    // reorderProducts is itself all-or-nothing (one SQL transaction); the
    // withStockLock wrapper here only serializes it against other product
    // writes in this process, same as every other product route.
    const reordered = await withStockLock(() => db.reorderProducts(ids));

    if (!reordered) {
      json(response, 404, { error: "Un produs din lista nu exista." });
      return true;
    }

    json(response, 200, { ok: true, reordered: ids.length });
    return true;
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]+)$/);
  if (productMatch && request.method === "PUT") {
    const productId = productMatch[1];
    const existingForBody = db.getProductById(productId);

    if (!existingForBody) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    // Body reading (readProductPayload can wait on a slow multipart image upload) stays
    // outside the lock; only the read-modify-write of the product row is serialized, so a
    // slow upload doesn't stall checkout/other admin writes touching the same product.
    const body = await readProductPayload(request, existingForBody);

    const result = await withStockLock(() => {
      const current = db.getProductById(productId);
      if (!current) return null;

      const previousStatus = current.status;
      const updated = db.upsertProduct(sanitizeProduct(body, current));
      return { product: updated, previousStatus };
    });

    if (!result) {
      json(response, 404, { error: "Produsul nu mai exista." });
      return true;
    }

    if (result.previousStatus !== "live" && result.product.status === "live") {
      notifyDropLive(result.product);
    }

    json(response, 200, { ok: true, product: result.product });
    return true;
  }

  const productSceneMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]+)\/scene-image$/);
  if (productSceneMatch && request.method === "POST") {
    const productId = productSceneMatch[1];
    const body = await readBody(request);
    const imageUrl = saveDataUrlImage(body.image || "", "scene-product");

    if (!imageUrl) {
      json(response, 400, { error: "Imaginea scenei lipseste." });
      return true;
    }

    const result = await withStockLock(() => {
      if (!db.getProductById(productId)) return null;
      return db.updateProduct(productId, { imageUrl, sceneImageUrl: imageUrl });
    });

    if (!result) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    json(response, 200, { ok: true, product: result });
    return true;
  }

  if (productMatch && request.method === "DELETE") {
    const productId = productMatch[1];
    await withStockLock(() => {
      db.deleteProduct(productId);
    });
    json(response, 200, { ok: true });
    return true;
  }

  const orderMatch = pathname.match(/^\/api\/admin\/orders\/([a-f0-9-]+)$/);
  if (orderMatch && request.method === "PUT") {
    const body = await readBody(request);
    const status = String(body.status || "");
    const allowedStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      json(response, 400, { error: "Status invalid." });
      return true;
    }

    if (body.paymentStatus !== undefined && !PAYMENT_STATUSES.includes(String(body.paymentStatus))) {
      json(response, 400, { error: "Status de plata invalid." });
      return true;
    }

    // A target of "refunded" against an order with a completed Square charge
    // must actually call Square BEFORE anything is written - unlike every
    // other paymentStatus value (an unverified admin label, same as today),
    // this one moves real money and must not be set optimistically ahead of
    // Square's answer. Runs here, outside any lock, since it's a network
    // call; phase1 below only ever performs synchronous DB writes.
    let squareRefundResult = null;
    if (body.paymentStatus === "refunded") {
      const existingForRefundCheck = db.getOrderById(orderMatch[1]);
      if (existingForRefundCheck && existingForRefundCheck.paymentStatus !== "refunded") {
        const chargePayment = db.listPaymentsForOrder(orderMatch[1])
          .find((payment) => payment.kind === "charge" && payment.status === "completed" && payment.provider === "square");

        if (chargePayment) {
          if (!square.isConfigured()) {
            json(response, 503, { error: "Square nu este configurat - nu pot procesa rambursarea." });
            return true;
          }
          const refundResult = await square.refundPayment({
            paymentId: chargePayment.providerPaymentId,
            amountMoney: { amount: Math.round(chargePayment.amount * 100), currency: chargePayment.currency },
            idempotencyKey: crypto.randomUUID(),
            reason: body.cancellationReason ? String(body.cancellationReason).trim().slice(0, 190) : undefined
          });

          if (!refundResult.ok) {
            json(response, refundResult.ambiguous ? 502 : 402, {
              error: refundResult.ambiguous
                ? "Nu am putut confirma rambursarea din cauza unei erori de retea. Verifica manual in Square inainte de a reincerca."
                : (refundResult.errors?.[0]?.detail || refundResult.errors?.[0]?.code || "Rambursarea a fost refuzata de Square.")
            });
            return true;
          }
          squareRefundResult = { chargePayment, refund: refundResult };
        }
      }
    }

    // Phase 1 runs under the data lock so a second concurrent order update (another
    // admin, another tab, a double-click) can't read the same pre-update array and
    // overwrite this one's write. It only does synchronous JSON read/write - the slow
    // part (sending the email, up to SMTP_TIMEOUT_MS) happens after the lock is
    // released, so a slow/down SMTP server doesn't stall every other order update.
    const phase1 = await withStockLock(() => {
      const existing = db.getOrderById(orderMatch[1]);

      if (!existing) {
        return { error: "Comanda nu exista.", status: 404 };
      }

      const previousStatus = existing.status;
      const existingFulfillment = existing.fulfillment || {};

      // Enforce the order state machine: no resurrecting delivered/cancelled
      // orders, no skipping forward outside the allowed flow.
      if (!isAllowedOrderTransition(previousStatus, status)) {
        return { error: `Tranzitie invalida: ${previousStatus} -> ${status}.`, status: 400 };
      }

      const nextFulfillment = {
        courierName: body.courierName !== undefined ? String(body.courierName).trim().slice(0, 120) : (existingFulfillment.courierName || ""),
        trackingNumber: body.trackingNumber !== undefined ? String(body.trackingNumber).trim().slice(0, 120) : (existingFulfillment.trackingNumber || ""),
        trackingUrl: body.trackingUrl !== undefined ? String(body.trackingUrl).trim().slice(0, 400) : (existingFulfillment.trackingUrl || ""),
        estimatedDeliveryDate: body.estimatedDeliveryDate !== undefined ? String(body.estimatedDeliveryDate).trim().slice(0, 40) : (existingFulfillment.estimatedDeliveryDate || ""),
        customerNote: body.customerNote !== undefined ? String(body.customerNote).trim().slice(0, 400) : (existingFulfillment.customerNote || ""),
        internalNote: body.internalNote !== undefined ? String(body.internalNote).trim().slice(0, 400) : (existingFulfillment.internalNote || "")
      };

      if (status === "shipped" && !(nextFulfillment.courierName && (nextFulfillment.trackingNumber || nextFulfillment.trackingUrl))) {
        return { error: "Adauga curier si tracking (AWB sau link) inainte de a marca comanda drept expediata.", status: 400 };
      }

      const cancellationReason = body.cancellationReason !== undefined
        ? String(body.cancellationReason).trim().slice(0, 500)
        : (existing.cancellationReason || "");

      const isTransition = previousStatus !== status;
      const now = new Date().toISOString();

      let updatedOrder = {
        ...existing,
        status,
        fulfillment: nextFulfillment,
        cancellationReason,
        updatedAt: now,
        processedAt: isTransition && status === "processing" ? now : existing.processedAt || null,
        shippedAt: isTransition && status === "shipped" ? now : existing.shippedAt || null,
        deliveredAt: isTransition && status === "delivered" ? now : existing.deliveredAt || null,
        cancelledAt: isTransition && status === "cancelled" ? now : existing.cancelledAt || null
      };

      // Explicit payment updates from the admin ("mark as paid" etc.). This
      // history entry is appended immediately (unlike the transition entry
      // below, which waits on the email) since there's no async work gating it.
      let paymentHistoryEntry = null;
      const previousPaymentStatus = existing.paymentStatus || "unpaid";
      if (body.paymentStatus !== undefined && body.paymentStatus !== previousPaymentStatus) {
        updatedOrder.paymentStatus = body.paymentStatus;
        updatedOrder.paidAt = body.paymentStatus === "paid" ? now : existing.paidAt || null;
        if (body.paymentStatus === "paid") {
          updatedOrder = consumeOrderCoupon(updatedOrder);
        }
        if (squareRefundResult) {
          db.insertPayment({
            id: crypto.randomUUID(),
            orderId: existing.id,
            provider: "square",
            providerPaymentId: squareRefundResult.refund.refundId,
            kind: "refund",
            amount: squareRefundResult.chargePayment.amount,
            currency: squareRefundResult.chargePayment.currency,
            status: squareRefundResult.refund.status === "COMPLETED" ? "completed" : "pending",
            rawResponse: squareRefundResult.refund.raw,
            createdAt: now
          });
        }
        paymentHistoryEntry = {
          from: previousStatus,
          to: status,
          payment: { from: previousPaymentStatus, to: body.paymentStatus },
          changedAt: now,
          changedBy: session.user.email,
          emailSent: false
        };
      }

      if (isTransition && status === "confirmed") {
        // Manual confirmation turns the stock reservation into a sale and
        // consumes the coupon (once).
        updatedOrder = consumeOrderCoupon(updatedOrder);
        updatedOrder.reservation = { ...(updatedOrder.reservation || {}), confirmedAt: now, expiresAt: null };
      }

      if (isTransition && status === "cancelled") {
        // Idempotent restoration of stock, coupon usage and edition numbers.
        updatedOrder = restoreOrderResources(updatedOrder, session.user.email);
      }

      // When a customer email will go out, rotate the guest access token so
      // the link in that email works - only the hash is ever stored. Needed
      // whenever EITHER a status-transition email OR the refund email below
      // will be sent - the refund case is intentionally independent of
      // isTransition (a refund on an already-delivered order usually leaves
      // status unchanged, so isTransition alone would miss it).
      let accessToken = null;
      if ((isTransition || squareRefundResult) && body.sendEmail !== false) {
        const rotated = generateOrderAccessToken();
        updatedOrder.publicAccessTokenHash = rotated.hash;
        accessToken = rotated.token;
      }

      db.updateOrder(existing.id, updatedOrder);
      if (paymentHistoryEntry) db.appendOrderStatusHistory(existing.id, paymentHistoryEntry);

      return { updatedOrder: db.getOrderById(existing.id), isTransition, previousStatus, now, accessToken };
    });

    if (phase1.error) {
      json(response, phase1.status, { error: phase1.error });
      return true;
    }

    const { updatedOrder, isTransition, previousStatus, now } = phase1;
    const sendEmailRequested = body.sendEmail !== false;
    let attemptedEmail = false;
    let emailResult = { ok: false };

    if (isTransition && sendEmailRequested) {
      const orderUrl = orderAccessUrl("thank-you.html", updatedOrder.id, phase1.accessToken);

      if (status === "processing") {
        attemptedEmail = true;
        emailResult = await email.sendOrderProcessingEmail(updatedOrder, orderUrl);
      } else if (status === "shipped") {
        attemptedEmail = true;
        emailResult = await email.sendOrderShippedEmail(updatedOrder, orderUrl);
      } else if (status === "delivered") {
        attemptedEmail = true;
        const singleProductId = updatedOrder.items.length === 1 ? updatedOrder.items[0].productId : null;
        const reviewUrl = singleProductId ? `${SITE_ORIGIN}/product.html?id=${singleProductId}` : null;
        emailResult = await email.sendOrderDeliveredEmail(updatedOrder, orderUrl, reviewUrl);
      } else if (status === "cancelled") {
        attemptedEmail = true;
        emailResult = await email.sendOrderCancelledEmail(updatedOrder, orderUrl);
      }
    }

    // Independent of isTransition (status itself usually doesn't change on a
    // refund - only paymentStatus does) and fire-and-forget like checkout's
    // "received" email: the payment-history entry inserted in phase1 above is
    // the authoritative record of the refund, this is only a courtesy notice.
    if (squareRefundResult && sendEmailRequested) {
      const refundOrderUrl = orderAccessUrl("thank-you.html", updatedOrder.id, phase1.accessToken);
      email.sendRefundConfirmedEmail(updatedOrder, squareRefundResult.chargePayment.amount, refundOrderUrl).catch(() => {});
    }

    if (!isTransition) {
      json(response, 200, { ok: true, order: updatedOrder, emailSent: false });
      return true;
    }

    // Phase 2 re-reads under the lock again (rather than reusing the phase-1 object)
    // so it only ever appends onto whatever the freshest state is, even if another
    // request wrote in between while we were waiting on the email above.
    const finalOrder = await withStockLock(() => {
      if (!db.getOrderById(orderMatch[1])) return null;
      db.appendOrderStatusHistory(orderMatch[1], {
        from: previousStatus,
        to: status,
        changedAt: now,
        changedBy: session.user.email,
        emailSent: attemptedEmail ? Boolean(emailResult.ok) : false
      });
      return db.getOrderById(orderMatch[1]);
    });

    if (!finalOrder) {
      json(response, 404, { error: "Comanda nu mai exista." });
      return true;
    }

    json(response, 200, { ok: true, order: finalOrder, emailSent: attemptedEmail ? Boolean(emailResult.ok) : false });
    return true;
  }

  const orderResendMatch = pathname.match(/^\/api\/admin\/orders\/([a-f0-9-]+)\/resend-email$/);
  if (orderResendMatch && request.method === "POST") {
    // Rotate the guest access token under the lock so the re-sent email
    // carries a working link while only the hash is stored.
    const rotated = generateOrderAccessToken();
    const order = await withStockLock(() => {
      if (!db.getOrderById(orderResendMatch[1])) return null;
      return db.updateOrder(orderResendMatch[1], { publicAccessTokenHash: rotated.hash });
    });

    if (!order) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    const orderUrl = orderAccessUrl("thank-you.html", order.id, rotated.token);
    const invoiceUrl = orderAccessUrl("invoice.html", order.id, rotated.token);
    let emailResult;

    if (order.status === "processing") {
      emailResult = await email.sendOrderProcessingEmail(order, orderUrl);
    } else if (order.status === "shipped") {
      emailResult = await email.sendOrderShippedEmail(order, orderUrl);
    } else if (order.status === "delivered") {
      const singleProductId = order.items.length === 1 ? order.items[0].productId : null;
      const reviewUrl = singleProductId ? `${SITE_ORIGIN}/product.html?id=${singleProductId}` : null;
      emailResult = await email.sendOrderDeliveredEmail(order, orderUrl, reviewUrl);
    } else if (order.status === "cancelled") {
      emailResult = await email.sendOrderCancelledEmail(order, orderUrl);
    } else if (order.status === "confirmed") {
      emailResult = await email.sendMail(email.buildOrderConfirmationEmail(order, orderUrl, invoiceUrl));
    } else {
      // pending: the order is only received, not confirmed - say exactly that.
      emailResult = await email.sendMail(email.buildOrderReceivedEmail(order, orderUrl, invoiceUrl));
    }

    const historyEntry = {
      from: order.status,
      to: order.status,
      changedAt: new Date().toISOString(),
      changedBy: session.user.email,
      emailSent: Boolean(emailResult.ok),
      resend: true
    };

    // Re-read fresh under the lock instead of reusing the `order` read before the
    // (potentially slow) email send above, so this only ever appends onto the
    // latest state instead of silently reverting a concurrent status change.
    const finalOrder = await withStockLock(() => {
      if (!db.getOrderById(orderResendMatch[1])) return null;
      db.appendOrderStatusHistory(orderResendMatch[1], historyEntry);
      return db.getOrderById(orderResendMatch[1]);
    });

    if (!finalOrder) {
      json(response, 404, { error: "Comanda nu mai exista." });
      return true;
    }

    json(response, 200, { ok: emailResult.ok, order: finalOrder, reason: emailResult.reason || null });
    return true;
  }

  return false;
}

// Looks in the current brand's own public folder first, falling back to the
// shared project root for brand-neutral assets (UI chrome icons, 3D models,
// favicon) that don't need a separate copy per brand. For BeCa, publicRoot IS
// root, so this is a single lookup exactly as before.
const dataDirResolved = path.resolve(dataDir);
const backupsDirResolved = path.resolve(backupsDir);

// Path-prefix check that can't be fooled by sibling folders sharing a prefix
// (e.g. "/app/data-aether" vs "/app/data").
function isInsideDir(candidate, dir) {
  return candidate === dir || candidate.startsWith(dir + path.sep);
}

// Never serve anything that lives inside the data or backups directories,
// wherever DATA_DIR points (it may be outside the project root or - worse -
// inside the public folder on a misconfigured deploy).
function isProtectedRealPath(resolvedPath) {
  return isInsideDir(resolvedPath, dataDirResolved) || isInsideDir(resolvedPath, backupsDirResolved);
}

function resolveStaticFilePath(safePath) {
  if (isBlockedStaticPath(safePath)) return null;

  const brandPath = path.resolve(publicRoot, safePath);
  if (isInsideDir(brandPath, publicRootResolved) && !isProtectedRealPath(brandPath)) {
    try {
      if (fs.statSync(brandPath).isFile()) return brandPath;
    } catch {
      // fall through to the shared-root lookup below
    }
  }

  if (publicRootResolved !== rootResolved) {
    const sharedPath = path.resolve(root, safePath);
    if (isInsideDir(sharedPath, rootResolved) && !isProtectedRealPath(sharedPath)) {
      try {
        if (fs.statSync(sharedPath).isFile()) return sharedPath;
      } catch {
        // neither location has it - caller treats this as a 404
      }
    }
  }

  return null;
}

function serveFile(request, response, pathname) {
  // Resolved at most once per request, and only if a gated page asks for it.
  let cachedSession = null;
  let sessionResolved = false;
  const sessionOnce = () => {
    if (!sessionResolved) {
      cachedSession = getSession(request);
      sessionResolved = true;
    }
    return cachedSession;
  };

  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const publicPath = safePath.replace(/\\/g, "/");

  if (!canAccessFile(publicPath, sessionOnce)) {
    if (publicPath === "account.html" || publicPath === "orders.html") {
      redirect(response, "/login.html");
      return;
    }

    if (publicPath === "admin/dashboard.html") {
      redirect(response, "/admin/login.html");
      return;
    }

    send(response, 403, "Forbidden");
    return;
  }

  const filePath = resolveStaticFilePath(safePath);

  if (!filePath) {
    const extension = path.extname(safePath);
    if (extension === "" || extension === ".html") {
      const notFoundPath = resolveStaticFilePath("404.html");
      if (!notFoundPath) {
        send(response, 404, "Not found");
        return;
      }
      fs.readFile(notFoundPath, (notFoundError, notFoundData) => {
        if (notFoundError) {
          send(response, 404, "Not found");
          return;
        }
        send(response, 404, notFoundData, { "Content-Type": types[".html"], "Cache-Control": "no-store" });
      });
      return;
    }
    send(response, 404, "Not found");
    return;
  }

  const contentType = types[path.extname(filePath)] || "application/octet-stream";
  const cacheControl = path.extname(filePath) === ".html" ? "no-store" : "public, max-age=3600";

  // HTTP Range support. Without this, every request for a file (whatever
  // Range header it sends) always got the whole file back with a plain 200
  // - which browsers generally tolerate for images/scripts, but not for
  // <video>: seeking (exactly what the Aether hero's loop does every few
  // seconds) normally works by requesting a specific byte range, and a
  // browser that asks for a range and gets an unexpected full-file 200
  // back can respond by restarting playback from the beginning instead of
  // resuming at the seeked position - which looked like "the loop doesn't
  // work, it just restarts from 0".
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      send(response, 404, "Not found");
      return;
    }

    const rangeHeader = request.headers.range;
    const rangeMatch = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

    if (rangeMatch) {
      const [, startText, endText] = rangeMatch;
      let start = startText ? parseInt(startText, 10) : Math.max(0, stats.size - parseInt(endText || "0", 10));
      let end = startText ? (endText ? parseInt(endText, 10) : stats.size - 1) : stats.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
        response.writeHead(416, {
          "Content-Range": `bytes */${stats.size}`,
          "X-Content-Type-Options": "nosniff"
        });
        response.end();
        return;
      }

      end = Math.min(end, stats.size - 1);

      response.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", () => response.end());
      stream.pipe(response);
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        send(response, 404, "Not found");
        return;
      }

      send(response, 200, data, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "Accept-Ranges": "bytes"
      });
    });
  });
}

const SITE_ORIGIN = brandEnv("SITE_ORIGIN") || BRAND.siteOrigin;

function serveSitemap(response) {
  const products = db.listProducts();
  const staticEntries = [
    { path: "/", priority: "1.0" },
    { path: "/about.html", priority: "0.7" },
    { path: "/faq.html", priority: "0.5" },
    { path: "/support.html", priority: "0.5" }
  ];
  const productEntries = products
    .filter((product) => product.status === "live" || product.status === "preview")
    .map((product) => ({
      path: `/product.html?slug=${encodeURIComponent(product.slug)}`,
      priority: "0.8",
      lastmod: product.updatedAt
    }));

  const urls = [...staticEntries, ...productEntries].map((entry) => {
    const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod.slice(0, 10)}</lastmod>` : "";
    return `  <url>\n    <loc>${SITE_ORIGIN}${entry.path}</loc>${lastmod}\n    <priority>${entry.priority}</priority>\n  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  send(response, 200, xml, { "Content-Type": "application/xml; charset=utf-8" });
}

function serveUploadedProductFile(response, pathname) {
  if (!pathname.startsWith(uploadRoutePrefix)) return false;

  const fileName = path.basename(pathname);
  const filePath = path.resolve(uploadDirResolved, fileName);

  if (!filePath.startsWith(uploadDirResolved)) {
    send(response, 403, "Forbidden");
    return true;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }

    send(response, 200, data, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    });
  });

  return true;
}

// Production misconfigurations that must stop the process before it serves a
// single request; in development they only warn.
function validateStartupConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  const problems = [];

  if (isProduction) {
    if (!brandEnv("ADMIN_PASSWORD")) {
      problems.push("ADMIN_PASSWORD nu este setat. In productie parola de admin trebuie setata explicit prin environment.");
    }

    const origin = String(brandEnv("SITE_ORIGIN") || BRAND.siteOrigin || "").trim();
    if (!origin || /example|localhost|127\.0\.0\.1|\[COMPLET/i.test(origin)) {
      problems.push(`SITE_ORIGIN este placeholder sau lipseste ("${origin}"). Seteaza SITE_ORIGIN la domeniul real (https://...).`);
    }

    // The whole project root is servable as static fallback, so data must
    // live outside it in production (e.g. a persistent disk mount).
    if (isInsideDir(dataDirResolved, publicRootResolved) || isInsideDir(dataDirResolved, rootResolved)) {
      problems.push(`DATA_DIR (${dataDirResolved}) se afla in directorul public/servabil. In productie seteaza DATA_DIR in afara proiectului (ex. /var/data/${BRAND_ID}).`);
    }

    // Square is opt-in and can be configured incrementally without ever
    // being unsafe - square.isConfigured() (accessToken + locationId both
    // set) already gates every route that touches it, so a partial setup
    // (e.g. token set, location id not obtained yet) just means checkout
    // skips the payment step, exactly like Square being unset entirely.
    // NODE_ENV=production is a Node runtime setting (secure cookies, etc.),
    // not a signal that this is the real live site taking real money - a
    // production-configured staging/test deploy using Sandbox Square
    // credentials, exactly like this one, is legitimate and must boot
    // cleanly. The one combination that's genuinely dangerous rather than
    // just incomplete: SQUARE_ENVIRONMENT=production (real money) with no
    // way to verify webhooks - that's the only thing worth refusing to boot
    // over.
    if (brandEnv("SQUARE_ACCESS_TOKEN")) {
      const squareEnvironment = String(brandEnv("SQUARE_ENVIRONMENT") || "sandbox").trim().toLowerCase();
      if (squareEnvironment === "production" && !brandEnv("SQUARE_WEBHOOK_SIGNATURE_KEY")) {
        problems.push("SQUARE_ENVIRONMENT este \"production\" dar SQUARE_WEBHOOK_SIGNATURE_KEY lipseste - webhook-urile Square nu pot fi verificate cu bani reali in joc.");
      }
    }
  }

  const legalMissing = brandLegalPlaceholders();
  if (legalMissing.length) {
    const message = `[config] ATENTIE (critic pentru functionare legala): datele de firma lipsesc sau sunt placeholder in config/brands/${BRAND_ID}.json: ${legalMissing.join(", ")}.`;
    console.warn(message);
  }

  if (problems.length) {
    const error = new Error(`Configuratie de productie invalida:\n- ${problems.join("\n- ")}`);
    error.code = "INVALID_PRODUCTION_CONFIG";
    throw error;
  }
}

// A data directory belongs to exactly one brand. The process lock only catches
// two brands running at once; this catches the quieter case where one is
// stopped and the other boots onto its DATA_DIR - which would silently serve
// the wrong brand's products and orders under this brand's name.
function assertDataDirBelongsToBrand() {
  fs.mkdirSync(dataDir, { recursive: true });
  const markerPath = path.join(dataDir, ".brand");

  let owner = "";
  try {
    owner = fs.readFileSync(markerPath, "utf8").trim().toLowerCase();
  } catch {
    owner = "";
  }

  if (owner && owner !== BRAND_ID) {
    const error = new Error(
      `DATA_DIR (${dataDir}) contine datele brandului "${owner}", nu "${BRAND_ID}". `
      + `Seteaza DATA_DIR_${BRAND_ENV_SUFFIX} catre directorul propriu al acestui brand.`
    );
    error.code = "DATA_DIR_BRAND_MISMATCH";
    throw error;
  }

  // Unmarked directory: adopt it (existing installs predate this check).
  if (!owner) fs.writeFileSync(markerPath, BRAND_ID);
}

function start() {
  validateStartupConfig();
  assertDataDirBelongsToBrand();
  // One process per DATA_DIR: refuse to start if another live process
  // already writes these data files.
  storage.acquireProcessLock();
  ensureDataFiles();
  runDataMaintenance();
  // The 15-minute timer only starts ticking now, so without this a restart
  // leaves already-expired reservations holding stock (and a coupon slot) for
  // up to another full interval.
  expireStaleReservations();
  backupDataFiles();
  setInterval(backupDataFiles, 1000 * 60 * 60 * 6).unref();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && isTrackablePageRequest(pathname)) {
      // Page loads are the one thing anyone can trigger without a session, so
      // they get the same per-IP guard as login/checkout. The ceiling sits far
      // above human browsing (3/s sustained) - it exists to stop a flood
      // monopolising the event loop, not to police normal visitors.
      if (isRateLimited(`page:${clientIp(request)}`, 180, 60000)) {
        send(response, 429, "Prea multe cereri. Incearca din nou intr-un minut.");
        return;
      }
      trackPageview(pathname, request);
    }

    try {
      if (await handleAuth(request, response, pathname)) return;
      if (await handleShopApi(request, response, pathname)) return;
      if (await handleAdminApi(request, response, pathname)) return;

      if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "Method not allowed");
        return;
      }

      if (pathname === "/sitemap.xml") {
        serveSitemap(response);
        return;
      }

      if (serveUploadedProductFile(response, pathname)) return;

      // Pretty certificate URLs: /archive/14 renders the brand's
      // archive-piece.html shell (the page itself fetches
      // /api/archive/14). Only rewrites when the brand actually ships
      // that page - brands without one keep their normal 404.
      if (/^\/archive\/\d{1,6}$/.test(pathname) && resolveStaticFilePath("archive-piece.html")) {
        serveFile(request, response, "/archive-piece.html");
        return;
      }

      serveFile(request, response, pathname);
    } catch (error) {
      console.error(error);
      json(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Server error." });
    }
  }).listen(port, host, () => {
    console.log(`${BRAND.brandName} platform running at http://127.0.0.1:${port}`);

    // Never print admin credentials in production - pm2/hosting logs are
    // captured, retained and often shared (including by pasting them into
    // chat), so anything logged here should be treated as effectively public.
    // This is dev-only convenience for a fresh local install; a production
    // deploy must set ADMIN_PASSWORD explicitly via the environment instead
    // of relying on the auto-generated one ever being recoverable.
    if (generatedAdminPassword && process.env.NODE_ENV !== "production") {
      console.log(`Generated admin account: ${generatedAdminEmail} / ${generatedAdminPassword}`);
      console.log("Log in and change this password immediately (Account > Security).");
    }
  });
}

// Closes the SQLite connection. Unlike lib/storage.js's JSON reads/writes
// (open-read/write-close per call, nothing persistent to release), node:sqlite
// holds one open file handle for the process's lifetime - tests that spin up
// a fresh server per tempDir must call this before removing that tempDir, or
// the .db file can still be locked (Windows in particular fails to delete an
// open file) when cleanup runs.
function stop() {
  db.close();
}

if (require.main === module) {
  start();
}

module.exports = {
  start,
  stop,
  hashPassword,
  verifyPassword,
  normalizeEmail,
  createUserRecord,
  parseCookies,
  parseMultipart,
  detectImageType,
  // Lets maintenance scripts resolve the same directories the server uses
  // instead of re-deriving the brand/env rules and drifting from them.
  dataPaths: () => ({ dataDir, uploadDir: uploadDirResolved, publicRoot: publicRootResolved }),
  fileToImageDataUrl,
  saveDataUrlImage,
  safePublicUser,
  toSlug,
  publicProduct,
  sameOriginPost,
  sanitizeProduct,
  parseSizesInput,
  sanitizeCheckout,
  migrateGenealogyData,
  openGenealogyChapter,
  productBelongsToOpenChapter,
  productCanBePurchased,
  canAccessFile,
  isBlockedStaticPath,
  clientIp,
  anonymizeIp,
  passwordPolicyError,
  stripHtmlToText,
  isApprovedImageUrl,
  sanitizeContent,
  hashOrderToken,
  isAllowedOrderTransition,
  toCsvValue,
  resolveCoupon
};
