const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const rootResolved = path.resolve(root);
const dataDir = path.join(root, "data");
const port = Number(process.env.PORT || 4188);
const host = process.env.HOST || "0.0.0.0";
const sessionCookie = "beca_session";
const cartCookie = "beca_cart";
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
  ".glb": "model/gltf-binary"
};

function ensureDataFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(root, "assets", "products"), { recursive: true });

  if (!fs.existsSync(path.join(dataDir, "users.json"))) {
    const admin = createUserRecord({
      email: "admin@beca.local",
      name: "BeCa Admin",
      password: "BecaAdmin2026!",
      role: "admin"
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

  if (!fs.existsSync(path.join(dataDir, "carts.json"))) {
    writeJson("carts.json", {});
  }

  if (!fs.existsSync(path.join(dataDir, "sessions.json"))) {
    writeJson("sessions.json", {});
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

function createUserRecord({ email, name, password, role }) {
  return {
    id: crypto.randomUUID(),
    email: normalizeEmail(email),
    name: String(name || "").trim().slice(0, 80),
    role: role === "admin" ? "admin" : "client",
    passwordHash: hashPassword(password),
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

function readBuffer(request, limit = 5 * 1024 * 1024) {
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

  const uploadDir = path.join(root, "assets", "products");
  fs.mkdirSync(uploadDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(uploadDir, fileName), file.body);
  return `assets/products/${fileName}`;
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

  const uploadDir = path.join(root, "assets", "products");
  fs.mkdirSync(uploadDir, { recursive: true });
  const fileName = `${prefix}-${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(uploadDir, fileName), buffer);
  return `assets/products/${fileName}`;
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

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
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

function getCart(request, response) {
  const carts = readJson("carts.json", {});
  const cartId = getCartId(request, response);
  const cart = carts[cartId] || { items: {}, updatedAt: new Date().toISOString() };
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
    category: product.category,
    status: product.status,
    price: product.price,
    currency: product.currency,
    stock: product.stock,
    imageUrl: product.imageUrl || "",
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    color: product.color || "",
    description: product.description || "",
    studio: product.studio ? {
      model: product.studio.model || "assets/models/tshirt-web.glb",
      textureUrl: product.studio.textureUrl || "",
      shirtColor: product.studio.shirtColor || "#ffffff"
    } : null
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

function sanitizeProduct(input, existing = {}) {
  const price = Number(input.price);
  const stock = Number(input.stock);
  const name = String(input.name || "").trim().slice(0, 100);
  const sizes = String(input.sizes || "")
    .split(",")
    .map((size) => size.trim())
    .filter(Boolean)
    .slice(0, 12);

  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    slug: toSlug(input.slug || name || existing.slug),
    name,
    category: String(input.category || "").trim().slice(0, 60),
    status: ["draft", "live", "sold-out"].includes(input.status) ? input.status : "draft",
    price: Number.isFinite(price) ? Math.max(0, price) : 0,
    currency: String(input.currency || "GBP").trim().slice(0, 8).toUpperCase(),
    stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
    imageUrl: String(input.imageUrl || existing.imageUrl || "").trim().slice(0, 260),
    sizes: sizes.length ? sizes : (Array.isArray(existing.sizes) ? existing.sizes : []),
    color: String(input.color || existing.color || "").trim().slice(0, 40),
    description: String(input.description || "").trim().slice(0, 420),
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function buildCartPayload(cart) {
  const products = readJson("products.json", []);
  const items = Object.entries(cart.items || {})
    .map(([productId, qty]) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return null;
      const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
      return {
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

  if (requestedPath === "account.html") {
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

  if (request.method !== "POST") return false;
  if (!sameOriginPost(request)) {
    json(response, 403, { error: "Request blocked." });
    return true;
  }

  if (pathname === "/auth/register") {
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
    json(response, 200, { ok: true, user: safePublicUser(user), redirect: "/" });
    return true;
  }

  if (pathname === "/auth/login" || pathname === "/admin/login") {
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
  if (pathname === "/api/products" && request.method === "GET") {
    const products = readJson("products.json", [])
      .filter((product) => product.status === "live")
      .map(publicProduct);
    const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
    json(response, 200, { products, categories });
    return true;
  }

  const productDetailMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productDetailMatch && request.method === "GET") {
    const key = decodeURIComponent(productDetailMatch[1]);
    const product = readJson("products.json", [])
      .filter((item) => item.status === "live")
      .find((item) => item.id === key || (item.slug || toSlug(item.name)) === key);

    if (!product) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    json(response, 200, { product: publicProduct(product) });
    return true;
  }

  if (pathname === "/api/cart" && request.method === "GET") {
    const { cart } = getCart(request, response);
    json(response, 200, { cart: buildCartPayload(cart) });
    return true;
  }

  if (pathname === "/api/cart/add" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const body = await readBody(request);
    const productId = String(body.productId || "");
    const qty = Math.max(1, Math.min(20, Math.floor(Number(body.qty) || 1)));
    const product = readJson("products.json", []).find((item) => item.id === productId);

    if (!product || product.status !== "live") {
      json(response, 404, { error: "Produsul nu este disponibil." });
      return true;
    }

    if (product.stock <= 0) {
      json(response, 409, { error: "Produsul este sold out." });
      return true;
    }

    const { cartId, cart, carts } = getCart(request, response);
    const currentQty = Number(cart.items[productId] || 0);
    cart.items[productId] = Math.min(product.stock, currentQty + qty);
    saveCart(cartId, cart, carts);
    json(response, 200, { ok: true, cart: buildCartPayload(cart) });
    return true;
  }

  const cartItemMatch = pathname.match(/^\/api\/cart\/items\/([a-f0-9-]+)$/);
  if (cartItemMatch && (request.method === "PUT" || request.method === "DELETE")) {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const productId = cartItemMatch[1];
    const { cartId, cart, carts } = getCart(request, response);

    if (request.method === "DELETE") {
      delete cart.items[productId];
    } else {
      const body = await readBody(request);
      const qty = Math.floor(Number(body.qty) || 0);
      if (qty <= 0) {
        delete cart.items[productId];
      } else {
        const product = readJson("products.json", []).find((item) => item.id === productId);
        cart.items[productId] = Math.min(product?.stock || qty, Math.max(1, qty));
      }
    }

    saveCart(cartId, cart, carts);
    json(response, 200, { ok: true, cart: buildCartPayload(cart) });
    return true;
  }

  if (pathname === "/api/checkout" && request.method === "POST") {
    if (!sameOriginPost(request)) {
      json(response, 403, { error: "Request blocked." });
      return true;
    }

    const session = getSession(request);
    const body = await readBody(request);
    const customer = sanitizeCheckout(body, session);
    const { cartId, cart, carts } = getCart(request, response);
    const payload = buildCartPayload(cart);

    if (!payload.items.length) {
      json(response, 400, { error: "Cartul este gol." });
      return true;
    }

    if (!customer.customerName || !customer.customerEmail.includes("@") || !customer.customerPhone || !customer.customerAddress) {
      json(response, 400, { error: "Completeaza nume, email, telefon si adresa." });
      return true;
    }

    const products = readJson("products.json", []);
    const productUpdates = [...products];

    for (const item of payload.items) {
      const productIndex = productUpdates.findIndex((product) => product.id === item.product.id);
      if (productIndex === -1 || productUpdates[productIndex].status !== "live" || productUpdates[productIndex].stock < item.qty) {
        json(response, 409, { error: `Stoc insuficient pentru ${item.product.name}.` });
        return true;
      }

      productUpdates[productIndex] = {
        ...productUpdates[productIndex],
        stock: productUpdates[productIndex].stock - item.qty,
        status: productUpdates[productIndex].stock - item.qty <= 0 ? "sold-out" : productUpdates[productIndex].status,
        updatedAt: new Date().toISOString()
      };
    }

    const orders = readJson("orders.json", []);
    const order = {
      id: crypto.randomUUID(),
      number: `BC-${String(orders.length + 1).padStart(4, "0")}`,
      userId: session?.user.id || null,
      ...customer,
      status: "pending",
      currency: payload.currency,
      total: payload.total,
      items: payload.items.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        price: item.product.price,
        currency: item.product.currency,
        qty: item.qty,
        subtotal: item.subtotal
      })),
      createdAt: new Date().toISOString()
    };

    orders.unshift(order);
    writeJson("products.json", productUpdates);
    writeJson("orders.json", orders);
    cart.items = {};
    saveCart(cartId, cart, carts);
    json(response, 200, { ok: true, order, cart: buildCartPayload(cart) });
    return true;
  }

  return false;
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

  if (pathname === "/api/admin/summary" && request.method === "GET") {
    const users = readJson("users.json", []);
    const products = readJson("products.json", []);
    const orders = readJson("orders.json", []);
    json(response, 200, {
      users: users.length,
      clients: users.filter((user) => user.role === "client").length,
      products: products.length,
      liveProducts: products.filter((product) => product.status === "live").length,
      orders: orders.length,
      revenue: orders.filter((order) => order.status !== "cancelled").reduce((total, order) => total + Number(order.total || 0), 0)
    });
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    json(response, 200, { users: readJson("users.json", []).map(safePublicUser) });
    return true;
  }

  if (pathname === "/api/admin/products" && request.method === "GET") {
    json(response, 200, { products: readJson("products.json", []) });
    return true;
  }

  if (pathname === "/api/admin/orders" && request.method === "GET") {
    json(response, 200, { orders: readJson("orders.json", []) });
    return true;
  }

  if (pathname === "/api/admin/products" && request.method === "POST") {
    const body = await readProductPayload(request);
    const products = readJson("products.json", []);
    const product = sanitizeProduct(body);

    if (!product.name) {
      json(response, 400, { error: "Produsul are nevoie de nume." });
      return true;
    }

    products.unshift(product);
    writeJson("products.json", products);
    json(response, 200, { ok: true, product });
    return true;
  }

  if (pathname === "/api/admin/studio-products" && request.method === "POST") {
    const body = await readBody(request);
    const products = readJson("products.json", []);
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

    products.unshift(product);
    writeJson("products.json", products);
    json(response, 200, { ok: true, product });
    return true;
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]+)$/);
  if (productMatch && request.method === "PUT") {
    const productId = productMatch[1];
    const products = readJson("products.json", []);
    const index = products.findIndex((product) => product.id === productId);

    if (index === -1) {
      json(response, 404, { error: "Produsul nu exista." });
      return true;
    }

    const body = await readProductPayload(request, products[index]);
    products[index] = sanitizeProduct(body, products[index]);
    writeJson("products.json", products);
    json(response, 200, { ok: true, product: products[index] });
    return true;
  }

  if (productMatch && request.method === "DELETE") {
    const productId = productMatch[1];
    const products = readJson("products.json", []);
    writeJson("products.json", products.filter((product) => product.id !== productId));
    json(response, 200, { ok: true });
    return true;
  }

  const orderMatch = pathname.match(/^\/api\/admin\/orders\/([a-f0-9-]+)$/);
  if (orderMatch && request.method === "PUT") {
    const body = await readBody(request);
    const status = String(body.status || "");
    const allowedStatuses = ["pending", "processing", "shipped", "completed", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      json(response, 400, { error: "Status invalid." });
      return true;
    }

    const orders = readJson("orders.json", []);
    const index = orders.findIndex((order) => order.id === orderMatch[1]);

    if (index === -1) {
      json(response, 404, { error: "Comanda nu exista." });
      return true;
    }

    orders[index] = {
      ...orders[index],
      status,
      updatedAt: new Date().toISOString()
    };
    writeJson("orders.json", orders);
    json(response, 200, { ok: true, order: orders[index] });
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
    if (publicPath === "account.html") {
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
      send(response, 404, "Not found");
      return;
    }

    send(response, 200, data, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-store" : "public, max-age=3600"
    });
  });
}

ensureDataFiles();

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (await handleAuth(request, response, pathname)) return;
    if (await handleShopApi(request, response, pathname)) return;
    if (await handleAdminApi(request, response, pathname)) return;

    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method not allowed");
      return;
    }

    serveFile(request, response, pathname);
  } catch (error) {
    console.error(error);
    json(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Server error." });
  }
}).listen(port, host, () => {
  console.log(`BeCa platform running at http://127.0.0.1:${port}`);
  console.log("Default admin: admin@beca.local / BecaAdmin2026!");
});
