const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

// Minimal local-only .env loader (no npm dependency). Real hosting env vars
// (e.g. Render's Environment Variables panel) are set before the process
// starts and always take precedence over .env - this only fills gaps.
(function loadDotEnv() {
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

const root = __dirname;
const rootResolved = path.resolve(root);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(root, "assets", "products");
const uploadDirResolved = path.resolve(uploadDir);
const uploadPublicBase = (process.env.UPLOAD_PUBLIC_BASE || "assets/products").replace(/^\/+|\/+$/g, "");
const uploadRoutePrefix = `/${uploadPublicBase}/`;
const port = Number(process.env.PORT || 4188);
const host = process.env.HOST || "0.0.0.0";
const sessionCookie = "beca_session";
const cartCookie = "beca_cart";
const primaryAdminEmail = "admin@beca.local";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const cartTtlMs = 1000 * 60 * 60 * 24 * 30;
const isProduction = process.env.NODE_ENV === "production";

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
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

let generatedAdminPassword = null;
let generatedAdminEmail = null;

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDirResolved, { recursive: true });

  const existingUsers = readJson("users.json", []);
  if (!Array.isArray(existingUsers) || existingUsers.length === 0) {
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || primaryAdminEmail);
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
    if (!process.env.ADMIN_PASSWORD) {
      generatedAdminPassword = adminPassword;
      generatedAdminEmail = adminEmail;
    }

    const admin = createUserRecord({
      email: adminEmail,
      name: "BeCa Admin",
      password: adminPassword,
      role: "admin",
      emailVerified: true,
      isPrimaryAdmin: true
    });
    writeJson("users.json", [admin]);
  }

  if (!fs.existsSync(path.join(dataDir, "products.json"))) {
    writeJson("products.json", [
      {
        id: crypto.randomUUID(),
        name: "Oversized statement tee",
        category: "Tee",
        status: "live",
        price: 59,
        currency: "GBP",
        stock: 25,
        imageUrl: "assets/beca-logo.png",
        sizes: ["S", "M", "L", "XL"],
        color: "White",
        description: "Fresh graphic tee prepared for the next limited drop.",
        createdAt: new Date().toISOString()
      }
    ]);
  }

  if (!fs.existsSync(path.join(dataDir, "orders.json"))) {
    writeJson("orders.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "notifications.json"))) {
    writeJson("notifications.json", []);
  }

  if (!fs.existsSync(path.join(dataDir, "carts.json"))) {
    writeJson("carts.json", {});
  }

  if (!fs.existsSync(path.join(dataDir, "sessions.json"))) {
    writeJson("sessions.json", {});
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

  const products = readJson("products.json", []);
  let migrated = false;
  const migratedProducts = products.map((product) => {
    if (!Array.isArray(product.sizes) || !product.sizes.length || product.sizeStock) return product;
    migrated = true;
    return { ...product, sizeStock: distributeStockAcrossSizes(Math.max(0, Math.floor(Number(product.stock) || 0)), product.sizes) };
  });
  if (migrated) writeJson("products.json", migratedProducts);

  const orders = readJson("orders.json", []);
  let migratedOrders = false;
  const migratedOrdersList = orders.map((order) => {
    let next = order;
    if (next.status === "completed") {
      migratedOrders = true;
      next = { ...next, status: "delivered" };
    }
    if (!next.fulfillment || !Array.isArray(next.statusHistory)) {
      migratedOrders = true;
      next = {
        ...next,
        processedAt: next.processedAt || null,
        shippedAt: next.shippedAt || null,
        deliveredAt: next.deliveredAt || null,
        cancelledAt: next.cancelledAt || null,
        fulfillment: next.fulfillment || {
          courierName: "",
          trackingNumber: "",
          trackingUrl: "",
          estimatedDeliveryDate: "",
          customerNote: "",
          internalNote: ""
        },
        cancellationReason: next.cancellationReason || "",
        statusHistory: Array.isArray(next.statusHistory) ? next.statusHistory : [
          { from: null, to: next.status, changedAt: next.createdAt || new Date().toISOString(), changedBy: null, emailSent: true }
        ]
      };
    }
    return next;
  });
  if (migratedOrders) writeJson("orders.json", migratedOrdersList);

  const users = readJson("users.json", []);
  let migratedUsers = false;
  const migratedUsersList = users.map((user) => {
    if (typeof user.emailVerified === "boolean") return user;
    migratedUsers = true;
    return { ...user, emailVerified: true };
  });
  if (migratedUsers) writeJson("users.json", migratedUsersList);

  // The "primary admin" gate used to compare user.email against a hardcoded
  // "admin@beca.local" string. Once that account's email is changed (e.g. to
  // receive real SMTP mail), the comparison silently stops matching anyone and
  // role management becomes unusable. Back it with a persistent flag instead,
  // assigned once here to whichever admin account is oldest if nothing already
  // holds it - this covers accounts created before this flag existed.
  const usersForPrimaryFlag = readJson("users.json", []);
  if (usersForPrimaryFlag.length && !usersForPrimaryFlag.some((user) => user.isPrimaryAdmin)) {
    const admins = usersForPrimaryFlag
      .filter((user) => user.role === "admin")
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const primary = admins[0];
    if (primary) {
      writeJson("users.json", usersForPrimaryFlag.map((user) => (
        user.id === primary.id ? { ...user, isPrimaryAdmin: true } : user
      )));
    }
  }
}

function readJson(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, fileName), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, data) {
  const filePath = path.join(dataDir, fileName);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function isTrackablePageRequest(pathname) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/admin/")) return false;
  const extension = path.extname(pathname);
  return extension === "" || extension === ".html";
}

function trackPageview(pathname, request) {
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {}, recentVisits: [] });
    analytics.totalPageviews = (analytics.totalPageviews || 0) + 1;

    if (!analytics.byDay[day]) {
      analytics.byDay[day] = { pageviews: 0, paths: {}, referrers: {}, hours: new Array(24).fill(0), locales: {} };
    }
    const dayEntry = analytics.byDay[day];
    dayEntry.pageviews += 1;
    dayEntry.paths[pathname] = (dayEntry.paths[pathname] || 0) + 1;
    dayEntry.hours = dayEntry.hours || new Array(24).fill(0);
    dayEntry.hours[hour] = (dayEntry.hours[hour] || 0) + 1;

    const referrerHeader = String(request?.headers?.referer || request?.headers?.referrer || "").trim();
    let referrerSource = "direct";
    if (referrerHeader) {
      try {
        referrerSource = new URL(referrerHeader).hostname || "direct";
      } catch {
        referrerSource = "direct";
      }
    }
    dayEntry.referrers = dayEntry.referrers || {};
    dayEntry.referrers[referrerSource] = (dayEntry.referrers[referrerSource] || 0) + 1;

    const localeHint = String(request?.headers?.["accept-language"] || "").split(",")[0].trim() || "necunoscut";
    dayEntry.locales = dayEntry.locales || {};
    dayEntry.locales[localeHint] = (dayEntry.locales[localeHint] || 0) + 1;

    analytics.recentVisits = analytics.recentVisits || [];
    analytics.recentVisits.unshift({
      path: pathname,
      ip: request ? clientIp(request) : "unknown",
      referrer: referrerSource,
      locale: localeHint,
      hour,
      at: now.toISOString()
    });
    analytics.recentVisits = analytics.recentVisits.slice(0, 300);

    writeJson("analytics.json", analytics);
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

function saveProductImage(file) {
  if (!file || !file.body || file.body.length === 0) return "";

  const allowed = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const extension = allowed[file.mime];

  if (!extension) {
    const error = new Error("Imagine invalida. Foloseste PNG, JPG, WEBP sau GIF.");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(uploadDirResolved, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(uploadDirResolved, fileName), file.body);
  return `${uploadPublicBase}/${fileName}`;
}

function fileToImageDataUrl(file) {
  if (!file || !file.body || file.body.length === 0 || !file.mime) return "";
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.mime)) return "";
  return `data:${file.mime};base64,${file.body.toString("base64")}`;
}

function saveDataUrlImage(dataUrl, prefix = "studio") {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return "";

  const extension = match[1].toLowerCase() === "jpeg" ? ".jpg" : `.${match[1].toLowerCase()}`;
  const buffer = Buffer.from(match[2], "base64");

  if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
    const error = new Error("Imaginea generata este prea mare.");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(uploadDirResolved, { recursive: true });
  const fileName = `${prefix}-${crypto.randomUUID()}${extension}`;
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

// TODO(security, etapa 2): script-src 'unsafe-inline' is needed because a handful of pages
// have small inline <script> blocks (Safari sniffing, the file:// redirect guard, the
// three.js importmap on admin/dashboard.html) and no nonce/hash pipeline exists yet since
// there's no build step. Move those blocks into external files (or add a per-request nonce)
// and drop 'unsafe-inline' from script-src once that's done.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://unpkg.com blob:",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "frame-src 'none'",
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

function setSessionCookie(response, sessionId) {
  const secure = isProduction ? "; Secure" : "";
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

function setCartCookie(response, cartId) {
  const secure = isProduction ? "; Secure" : "";
  appendCookie(response, `${cartCookie}=${encodeURIComponent(cartId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(cartTtlMs / 1000)}${secure}`);
}

function getCartId(request, response) {
  const cookies = parseCookies(request);
  const existing = cookies[cartCookie];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;

  const cartId = crypto.randomBytes(32).toString("hex");
  setCartCookie(response, cartId);
  return cartId;
}

function getCart(request, response, session = null) {
  const carts = readJson("carts.json", {});
  const cartId = getCartId(request, response);
  const cart = carts[cartId] || { items: {}, updatedAt: new Date().toISOString() };
  if (session && session.user && !cart.userId) {
    cart.userId = session.user.id;
    cart.email = session.user.email;
  }
  carts[cartId] = cart;
  writeJson("carts.json", carts);
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

  const sessions = readJson("sessions.json", {});
  const session = sessions[sessionId];

  if (!session || Date.now() > session.expiresAt) {
    delete sessions[sessionId];
    writeJson("sessions.json", sessions);
    return null;
  }

  const users = readJson("users.json", []);
  const user = users.find((item) => item.id === session.userId);
  if (!user) return null;

  return { id: sessionId, user };
}

function createSession(response, user) {
  const sessions = readJson("sessions.json", {});
  const sessionId = crypto.randomBytes(32).toString("hex");

  sessions[sessionId] = {
    userId: user.id,
    expiresAt: Date.now() + sessionTtlMs,
    createdAt: new Date().toISOString()
  };

  writeJson("sessions.json", sessions);
  setSessionCookie(response, sessionId);
}

function destroySession(request, response) {
  const sessionId = parseCookies(request)[sessionCookie];
  const sessions = readJson("sessions.json", {});
  delete sessions[sessionId];
  writeJson("sessions.json", sessions);
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
    studio: product.studio ? {
      model: product.studio.model || "assets/models/tshirt-web.glb",
      textureUrl: product.studio.textureUrl || "",
      shirtColor: product.studio.shirtColor || "#ffffff"
    } : null
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
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
      subtotal: item.subtotal
    })),
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    createdAt: order.createdAt
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
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function buildCartPayload(cart) {
  const products = readJson("products.json", []);
  const items = Object.entries(cart.items || {})
    .map(([key, qty]) => {
      const { productId, size } = parseCartKey(key);
      const product = products.find((item) => item.id === productId);
      if (!product || product.status !== "live") return null;
      const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
      return {
        key,
        size,
        product: publicProduct(product),
        qty: safeQty,
        subtotal: Number(product.price || 0) * safeQty
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

function canAccessFile(requestedPath, session) {
  if (requestedPath.startsWith("data/") || requestedPath.startsWith("tmp/") || requestedPath.includes("\\data\\")) {
    return false;
  }

  if (requestedPath === "account.html" || requestedPath === "orders.html") {
    return Boolean(session);
  }

  if (requestedPath === "admin/dashboard.html") {
    return Boolean(session && session.user.role === "admin");
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

    const body = await readBody(request);
    const nextName = String(body.name || "").trim().slice(0, 80);
    const nextEmail = normalizeEmail(body.email);

    if (nextName.length < 2 || !nextEmail.includes("@")) {
      json(response, 400, { error: "Completeaza nume si email valid." });
      return true;
    }

    const users = readJson("users.json", []);
    const userIndex = users.findIndex((user) => user.id === session.user.id);
    if (userIndex === -1) {
      json(response, 404, { error: "Contul nu exista." });
      return true;
    }

    if (users.some((user) => user.id !== session.user.id && user.email === nextEmail)) {
      json(response, 409, { error: "Emailul este deja folosit." });
      return true;
    }

    users[userIndex] = {
      ...users[userIndex],
      name: nextName,
      email: nextEmail,
      updatedAt: new Date().toISOString()
    };
    writeJson("users.json", users);
    json(response, 200, { ok: true, user: safePublicUser(users[userIndex]) });
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

    const body = await readBody(request);
    const currentPassword = String(body.currentPassword || "");
    const nextPassword = String(body.newPassword || "");
    const users = readJson("users.json", []);
    const userIndex = users.findIndex((user) => user.id === session.user.id);

    if (userIndex === -1 || !verifyPassword(currentPassword, users[userIndex].passwordHash)) {
      json(response, 401, { error: "Parola actuala nu este corecta." });
      return true;
    }

    if (nextPassword.length < 8) {
      json(response, 400, { error: "Parola noua trebuie sa aiba minimum 8 caractere." });
      return true;
    }

    users[userIndex] = {
      ...users[userIndex],
      passwordHash: hashPassword(nextPassword),
      updatedAt: new Date().toISOString()
    };
    writeJson("users.json", users);
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
    const users = readJson("users.json", []);
    const user = users.find((item) => item.email === targetEmail);

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

    if (nextPassword.length < 8) {
      json(response, 400, { error: "Parola trebuie sa aiba minimum 8 caractere." });
      return true;
    }

    const resets = readJson("password-resets.json", []);
    const entry = resets.find((item) => item.token === token);

    if (!entry || entry.usedAt || Date.now() > entry.expiresAt) {
      json(response, 400, { error: "Linkul de resetare este invalid sau a expirat." });
      return true;
    }

    const users = readJson("users.json", []);
    const userIndex = users.findIndex((item) => item.id === entry.userId);
    if (userIndex === -1) {
      json(response, 404, { error: "Contul nu mai exista." });
      return true;
    }

    users[userIndex] = {
      ...users[userIndex],
      passwordHash: hashPassword(nextPassword),
      updatedAt: new Date().toISOString()
    };
    writeJson("users.json", users);

    entry.usedAt = new Date().toISOString();
    writeJson("password-resets.json", resets);

    const sessions = readJson("sessions.json", {});
    for (const [sessionId, sessionEntry] of Object.entries(sessions)) {
      if (sessionEntry.userId === users[userIndex].id) delete sessions[sessionId];
    }
    writeJson("sessions.json", sessions);

    json(response, 200, { ok: true, redirect: "/login.html" });
    return true;
  }

  if (request.method === "POST" && pathname === "/auth/verify-email") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
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

    const users = readJson("users.json", []);
    const userIndex = users.findIndex((item) => item.id === entry.userId);
    if (userIndex === -1) {
      json(response, 404, { error: "Contul nu mai exista." });
      return true;
    }

    users[userIndex] = { ...users[userIndex], emailVerified: true, updatedAt: new Date().toISOString() };
    writeJson("users.json", users);
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

    if (!email.includes("@") || password.length < 8 || name.length < 2) {
      json(response, 400, { error: "Completeaza nume, email si parola de minimum 8 caractere." });
      return true;
    }

    const users = readJson("users.json", []);
    if (users.some((user) => user.email === email)) {
      json(response, 409, { error: "Exista deja un cont cu emailul acesta." });
      return true;
    }

    const user = createUserRecord({ email, name, password, role: "client" });
    users.push(user);
    writeJson("users.json", users);
    createSession(response, user);
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
    const users = readJson("users.json", []);
    const user = users.find((item) => item.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      json(response, 401, { error: "Email sau parola gresita." });
      return true;
    }

    if (pathname === "/admin/login" && user.role !== "admin") {
      json(response, 403, { error: "Contul acesta nu are acces admin." });
      return true;
    }

    createSession(response, user);
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
    json(response, 200, readJson("content.json", { en: {}, ro: {}, branding: {} }));
    return true;
  }

  if (pathname === "/api/products" && request.method === "GET") {
    const products = readJson("products.json", [])
      .filter((product) => product.status === "live" || product.status === "preview")
      .map(publicProduct);
    const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
    json(response, 200, { products, categories });
    return true;
  }

  const productDetailMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productDetailMatch && request.method === "GET") {
    const key = decodeURIComponent(productDetailMatch[1]);
    const product = readJson("products.json", [])
      .filter((item) => item.status === "live" || item.status === "preview")
      .find((item) => item.id === key || (item.slug || toSlug(item.name)) === key);

    if (!product) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    json(response, 200, { product: publicProduct(product) });
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
    const product = readJson("products.json", []).find((item) => item.id === productId);

    if (!product || (product.status !== "preview" && product.status !== "live")) {
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
    const products = readJson("products.json", [])
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
    const product = readJson("products.json", []).find((item) => item.id === productId);
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
    const product = readJson("products.json", []).find((item) => item.id === key || (item.slug || toSlug(item.name)) === key);
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
    const product = readJson("products.json", []).find((item) => item.id === key || (item.slug || toSlug(item.name)) === key);
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
    const product = readJson("products.json", []).find((item) => item.id === productId);

    if (!product || product.status !== "live") {
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
      const freshProduct = readJson("products.json", []).find((item) => item.id === productId);
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
          const product = readJson("products.json", []).find((item) => item.id === productId);
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

      const products = readJson("products.json", []);
      const productUpdates = [...products];

      for (const item of payload.items) {
        const productIndex = productUpdates.findIndex((product) => product.id === item.product.id);
        const current = productIndex !== -1 ? productUpdates[productIndex] : null;
        if (!current || current.status !== "live" || availableStock(current, item.size) < item.qty) {
          return { error: `Stoc insuficient pentru ${item.product.name}.` };
        }

        const nextSizeStock = current.sizeStock && item.size
          ? { ...current.sizeStock, [item.size]: current.sizeStock[item.size] - item.qty }
          : current.sizeStock;
        const nextStock = nextSizeStock ? totalStockFromSizeStock(nextSizeStock) : current.stock - item.qty;

        productUpdates[productIndex] = {
          ...current,
          stock: nextStock,
          sizeStock: nextSizeStock,
          status: nextStock <= 0 ? "sold-out" : current.status,
          updatedAt: new Date().toISOString()
        };
      }

      const orders = readJson("orders.json", []);
      const createdAt = new Date().toISOString();
      const order = {
        id: crypto.randomUUID(),
        number: `BC-${String(orders.length + 1).padStart(4, "0")}`,
        userId: session?.user.id || null,
        ...customer,
        status: "confirmed",
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
          subtotal: item.subtotal
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
          { from: null, to: "confirmed", changedAt: createdAt, changedBy: null, emailSent: true }
        ],
        createdAt
      };

      orders.unshift(order);
      writeJson("products.json", productUpdates);
      writeJson("orders.json", orders);

      if (appliedCoupon) {
        const coupons = readJson("coupons.json", []);
        const couponIndex = coupons.findIndex((coupon) => coupon.id === appliedCoupon.id);
        if (couponIndex !== -1) {
          coupons[couponIndex] = { ...coupons[couponIndex], usedCount: (coupons[couponIndex].usedCount || 0) + 1 };
          writeJson("coupons.json", coupons);
        }
      }

      cart.items = {};
      cart.reminderSentAt = null;
      saveCart(cartId, cart, carts);
      return { order };
    });

    if (outcome.error) {
      const isBadRequest = /gol|cupon|reducere/i.test(outcome.error);
      json(response, isBadRequest ? 400 : 409, { error: outcome.error });
      return true;
    }

    const orderUrl = `${SITE_ORIGIN}/thank-you.html?order=${outcome.order.id}`;
    const invoiceUrl = `${SITE_ORIGIN}/invoice.html?order=${outcome.order.id}`;
    email.sendMail(email.buildOrderConfirmationEmail(outcome.order, orderUrl, invoiceUrl)).catch(() => {});

    const { cart } = getCart(request, response, session);
    json(response, 200, { ok: true, order: outcome.order, cart: buildCartPayload(cart) });
    return true;
  }

  if (pathname === "/api/orders" && request.method === "GET") {
    const session = getSession(request);
    if (!session) {
      json(response, 401, { error: "Login required." });
      return true;
    }

    const orders = readJson("orders.json", [])
      .filter((order) => order.userId === session.user.id)
      .map(publicOrder);

    json(response, 200, { orders });
    return true;
  }

  const orderDetailMatch = pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/);
  if (orderDetailMatch && request.method === "GET") {
    const order = readJson("orders.json", []).find((item) => item.id === orderDetailMatch[1]);

    if (!order) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    json(response, 200, { order: publicOrder(order) });
    return true;
  }

  return false;
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

// There was previously no backup of data/*.json at all - a bad write, a bug, or
// deleting the wrong folder on the VPS would have taken every order/user/review
// with it, with no way back. This keeps rolling local snapshots so a bad state
// can be rolled back to a recent one. It does NOT protect against losing the
// whole disk/server - that still needs an off-server backup, which this can't
// set up on its own since it has no access to external storage.
// Sibling of dataDir (not root) so this follows DATA_DIR when it's overridden -
// otherwise an isolated/test DATA_DIR would still write backups into the real
// project checkout instead of next to the data it's actually backing up.
const backupsDir = path.join(dataDir, "..", "backups");
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
  if (coupon.expiresAt && Date.now() > new Date(coupon.expiresAt).getTime()) {
    return { error: "Codul de reducere a expirat." };
  }
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return { error: "Codul de reducere a fost folosit de maximum de ori." };
  }

  const discount = coupon.type === "fixed"
    ? Math.min(total, coupon.value)
    : Math.round(total * (coupon.value / 100) * 100) / 100;

  return { coupon, discount };
}

function toCsvValue(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
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
    json(response, 200, readJson("content.json", { en: {}, ro: {}, branding: {} }));
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "PUT") {
    const body = await readBody(request);
    const current = readJson("content.json", { en: {}, ro: {}, branding: {} });
    const next = {
      en: { ...current.en, ...(body.en && typeof body.en === "object" ? body.en : {}) },
      ro: { ...current.ro, ...(body.ro && typeof body.ro === "object" ? body.ro : {}) },
      branding: { ...current.branding, ...(body.branding && typeof body.branding === "object" ? body.branding : {}) }
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
    const users = readJson("users.json", []);
    const products = readJson("products.json", []);
    const orders = readJson("orders.json", []);
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const today = new Date().toISOString().slice(0, 10);
    json(response, 200, {
      users: users.length,
      clients: users.filter((user) => user.role === "client").length,
      products: products.length,
      liveProducts: products.filter((product) => product.status === "live").length,
      previewProducts: products.filter((product) => product.status === "preview").length,
      notifications: readJson("notifications.json", []).length,
      orders: orders.length,
      revenue: orders.filter((order) => order.status !== "cancelled").reduce((total, order) => total + Number(order.total || 0), 0),
      pageviewsToday: analytics.byDay[today] ? analytics.byDay[today].pageviews : 0
    });
    return true;
  }

  if (pathname === "/api/admin/analytics" && request.method === "GET") {
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

  if (pathname === "/api/admin/email/test" && request.method === "POST") {
    const config = email.getConfig();
    const configured = email.isConfigured(config);

    if (!configured) {
      json(response, 200, { ok: false, configured: false, reason: "smtp-not-configured" });
      return true;
    }

    const result = await email.sendMail({
      to: session.user.email,
      subject: "Test SMTP BeCa",
      text: "Acesta este un email de test trimis din panoul admin BeCa pentru a confirma ca SMTP-ul functioneaza."
    });

    json(response, 200, { ...result, configured: true });
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const users = readJson("users.json", []).map(safePublicUser);
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

    const users = readJson("users.json", []);
    const index = users.findIndex((user) => user.id === userRoleMatch[1]);

    if (index === -1) {
      json(response, 404, { error: "Userul nu exista." });
      return true;
    }

    if (users[index].isPrimaryAdmin && role !== "admin") {
      json(response, 400, { error: "Admin-ul principal trebuie sa ramana admin." });
      return true;
    }

    users[index] = {
      ...users[index],
      role,
      updatedAt: new Date().toISOString()
    };
    writeJson("users.json", users);
    json(response, 200, { ok: true, user: safePublicUser(users[index]) });
    return true;
  }

  if (pathname === "/api/admin/products" && request.method === "GET") {
    const products = readJson("products.json", []);
    const { items, page, pageSize, total } = paginate(request, products);
    json(response, 200, { products: items, page, pageSize, total });
    return true;
  }

  if (pathname === "/api/admin/orders" && request.method === "GET") {
    const orders = readJson("orders.json", []);
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
    const products = readJson("products.json", []);
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

    const coupons = readJson("coupons.json", []);
    if (coupons.some((coupon) => coupon.code === code)) {
      json(response, 409, { error: "Exista deja un cupon cu acest cod." });
      return true;
    }

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
    json(response, 200, { ok: true, coupon });
    return true;
  }

  const couponMatch = pathname.match(/^\/api\/admin\/coupons\/([a-f0-9-]+)$/);
  if (couponMatch && request.method === "PUT") {
    const body = await readBody(request);
    const coupons = readJson("coupons.json", []);
    const index = coupons.findIndex((coupon) => coupon.id === couponMatch[1]);
    if (index === -1) {
      json(response, 404, { error: "Cuponul nu exista." });
      return true;
    }
    coupons[index] = { ...coupons[index], active: Boolean(body.active) };
    writeJson("coupons.json", coupons);
    json(response, 200, { ok: true, coupon: coupons[index] });
    return true;
  }

  if (couponMatch && request.method === "DELETE") {
    const coupons = readJson("coupons.json", []);
    writeJson("coupons.json", coupons.filter((coupon) => coupon.id !== couponMatch[1]));
    json(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/stats/revenue" && request.method === "GET") {
    const orders = readJson("orders.json", []);
    const analytics = readJson("analytics.json", { totalPageviews: 0, byDay: {} });
    const validOrders = orders.filter((order) => order.status !== "cancelled");
    const totalRevenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const averageOrderValue = validOrders.length ? Math.round((totalRevenue / validOrders.length) * 100) / 100 : 0;

    const byDay = {};
    validOrders.forEach((order) => {
      const day = String(order.createdAt || "").slice(0, 10);
      if (!day) return;
      byDay[day] = (byDay[day] || 0) + Number(order.total || 0);
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
    const orders = readJson("orders.json", []).filter((order) => order.status !== "cancelled");
    const totals = new Map();

    orders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const key = `${item.productId || item.name}::${item.size || ""}`;
        const current = totals.get(key) || { productId: item.productId, name: item.name, size: item.size || "", qty: 0, revenue: 0 };
        current.qty += Number(item.qty || 0);
        current.revenue += Number(item.subtotal || 0);
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
    const orders = readJson("orders.json", []);
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
    const users = readJson("users.json", []);
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
      const products = readJson("products.json", []);
      products.unshift(product);
      writeJson("products.json", products);
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
      const products = readJson("products.json", []);
      products.unshift(product);
      writeJson("products.json", products);
    });
    json(response, 200, { ok: true, product });
    return true;
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]+)$/);
  if (productMatch && request.method === "PUT") {
    const productId = productMatch[1];
    const existingForBody = readJson("products.json", []).find((product) => product.id === productId);

    if (!existingForBody) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    // Body reading (readProductPayload can wait on a slow multipart image upload) stays
    // outside the lock; only the read-modify-write of products.json is serialized, so a
    // slow upload doesn't stall checkout/other admin writes touching the same file.
    const body = await readProductPayload(request, existingForBody);

    const result = await withStockLock(() => {
      const products = readJson("products.json", []);
      const index = products.findIndex((product) => product.id === productId);
      if (index === -1) return null;

      const previousStatus = products[index].status;
      products[index] = sanitizeProduct(body, products[index]);
      writeJson("products.json", products);
      return { product: products[index], previousStatus };
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
      const products = readJson("products.json", []);
      const index = products.findIndex((product) => product.id === productId);
      if (index === -1) return null;

      products[index] = {
        ...products[index],
        imageUrl,
        sceneImageUrl: imageUrl,
        updatedAt: new Date().toISOString()
      };
      writeJson("products.json", products);
      return products[index];
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
      const products = readJson("products.json", []);
      writeJson("products.json", products.filter((product) => product.id !== productId));
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

    // Phase 1 runs under the data lock so a second concurrent order update (another
    // admin, another tab, a double-click) can't read the same pre-update array and
    // overwrite this one's write. It only does synchronous JSON read/write - the slow
    // part (sending the email, up to SMTP_TIMEOUT_MS) happens after the lock is
    // released, so a slow/down SMTP server doesn't stall every other order update.
    const phase1 = await withStockLock(() => {
      const orders = readJson("orders.json", []);
      const index = orders.findIndex((order) => order.id === orderMatch[1]);

      if (index === -1) {
        return { error: "Comanda nu exista.", status: 404 };
      }

      const existing = orders[index];
      const previousStatus = existing.status;
      const existingFulfillment = existing.fulfillment || {};

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

      const updatedOrder = {
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

      orders[index] = updatedOrder;
      writeJson("orders.json", orders);

      return { updatedOrder, isTransition, previousStatus, now };
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
      const orderUrl = `${SITE_ORIGIN}/thank-you.html?order=${updatedOrder.id}`;

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

    if (!isTransition) {
      json(response, 200, { ok: true, order: updatedOrder, emailSent: false });
      return true;
    }

    // Phase 2 re-reads under the lock again (rather than reusing the phase-1 array)
    // so it only ever appends onto whatever the freshest state is, even if another
    // request wrote in between while we were waiting on the email above.
    const finalOrder = await withStockLock(() => {
      const historyEntry = {
        from: previousStatus,
        to: status,
        changedAt: now,
        changedBy: session.user.email,
        emailSent: attemptedEmail ? Boolean(emailResult.ok) : false
      };

      const orders = readJson("orders.json", []);
      const index = orders.findIndex((order) => order.id === orderMatch[1]);
      if (index === -1) return null;

      orders[index] = {
        ...orders[index],
        statusHistory: [...(orders[index].statusHistory || []), historyEntry]
      };
      writeJson("orders.json", orders);
      return orders[index];
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
    const order = readJson("orders.json", []).find((item) => item.id === orderResendMatch[1]);

    if (!order) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    const orderUrl = `${SITE_ORIGIN}/thank-you.html?order=${order.id}`;
    const invoiceUrl = `${SITE_ORIGIN}/invoice.html?order=${order.id}`;
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
    } else {
      emailResult = await email.sendMail(email.buildOrderConfirmationEmail(order, orderUrl, invoiceUrl));
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
      const orders = readJson("orders.json", []);
      const index = orders.findIndex((item) => item.id === orderResendMatch[1]);
      if (index === -1) return null;

      orders[index] = {
        ...orders[index],
        statusHistory: [...(orders[index].statusHistory || []), historyEntry]
      };
      writeJson("orders.json", orders);
      return orders[index];
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

function serveFile(request, response, pathname) {
  const session = getSession(request);
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const publicPath = safePath.replace(/\\/g, "/");
  const filePath = path.resolve(root, safePath);

  if (!filePath.startsWith(rootResolved) || !canAccessFile(publicPath, session)) {
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

  fs.readFile(filePath, (error, data) => {
    if (error) {
      const extension = path.extname(filePath);
      if (extension === "" || extension === ".html") {
        fs.readFile(path.resolve(root, "404.html"), (notFoundError, notFoundData) => {
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

    send(response, 200, data, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-store" : "public, max-age=3600"
    });
  });
}

const SITE_ORIGIN = "https://beca-wlf.com";

function serveSitemap(response) {
  const products = readJson("products.json", []);
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

function start() {
  ensureDataFiles();
  backupDataFiles();
  setInterval(backupDataFiles, 1000 * 60 * 60 * 6).unref();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && isTrackablePageRequest(pathname)) {
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
      serveFile(request, response, pathname);
    } catch (error) {
      console.error(error);
      json(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Server error." });
    }
  }).listen(port, host, () => {
    console.log(`BeCa platform running at http://127.0.0.1:${port}`);

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

if (require.main === module) {
  start();
}

module.exports = {
  start,
  hashPassword,
  verifyPassword,
  normalizeEmail,
  createUserRecord,
  parseCookies,
  parseMultipart,
  fileToImageDataUrl,
  saveDataUrlImage,
  safePublicUser,
  toSlug,
  publicProduct,
  sameOriginPost,
  sanitizeProduct,
  parseSizesInput,
  sanitizeCheckout,
  canAccessFile,
  clientIp
};
