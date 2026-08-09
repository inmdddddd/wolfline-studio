const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

/* SQLite storage layer (one file per brand), replacing data/*.json for the
   entities listed in SCHEMA_SQL below. Everything else (coupons, reviews,
   wishlists, notifications, content.json, analytics.json, carts.json,
   email-outbox.json, password-resets.json, email-verifications.json) stays
   on lib/storage.js's JSON files - unchanged, on purpose.

   - withTransaction wraps BEGIN IMMEDIATE/COMMIT/ROLLBACK. node:sqlite is
     synchronous, so a transaction must never span an `await` - callers that
     need to await (e.g. sending an email) must close the transaction first,
     do the async work outside, then open a second transaction to record the
     result. See server.js's order-status route for the concrete pattern.
   - Schema is applied with CREATE TABLE/INDEX IF NOT EXISTS, guarded by
     PRAGMA user_version so re-opening an existing db is a cheap no-op.
   - checkpoint() must run immediately before any file-level copy of the .db
     (backups) - WAL mode means recent writes can live in a "-wal" sidecar
     file, and a plain copy of the main file alone can miss them. */

const CURRENT_SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','client')),
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  is_primary_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_ro TEXT,
  name_en TEXT,
  category TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','preview','live','sold-out')),
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  image_url TEXT,
  scene_image_url TEXT,
  color TEXT,
  description TEXT,
  description_ro TEXT,
  description_en TEXT,
  chapter_id TEXT,
  chapter_product_order INTEGER,
  studio_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(product_id, size)
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  region TEXT,
  postal_code TEXT,
  country TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  address_id TEXT REFERENCES addresses(id),
  notes TEXT,
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_method TEXT,
  paid_at TEXT,
  public_access_token_hash TEXT,
  reservation_expires_at TEXT,
  reservation_confirmed_at TEXT,
  stock_restored INTEGER NOT NULL DEFAULT 0,
  coupon_consumed INTEGER NOT NULL DEFAULT 0,
  coupon_restored INTEGER NOT NULL DEFAULT 0,
  editions_cancelled INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  total REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  coupon_code TEXT,
  processed_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  fulfillment_courier_name TEXT,
  fulfillment_tracking_number TEXT,
  fulfillment_tracking_url TEXT,
  fulfillment_estimated_delivery_date TEXT,
  fulfillment_customer_note TEXT,
  fulfillment_internal_note TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  name TEXT NOT NULL,
  size TEXT,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  subtotal REAL NOT NULL,
  edition_numbers_json TEXT,
  edition_total INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  payment_from TEXT,
  payment_to TEXT,
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  email_sent INTEGER NOT NULL DEFAULT 0,
  is_resend INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_status_history_order ON order_status_history(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  kind TEXT NOT NULL DEFAULT 'charge',
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
-- A charge and its refund are separate rows with different provider_payment_id
-- values (Square mints a new id for each) - this is the authoritative
-- idempotency guard: whichever caller (sync route or webhook) settles a given
-- Square payment/refund first wins, the other finds this row already here.
-- Partial (WHERE ... NOT NULL) so the pre-call audit row a payment starts as
-- (see server.js's pay route - inserted before Square is ever called, with
-- no provider id yet) never collides with anything.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT REFERENCES orders(id),
  status TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_logs_order_status ON email_logs(order_id, status);

-- expires_at is an epoch-ms integer (Date.now() + sessionTtlMs), matching
-- how server.js has always computed/compared it - NOT an ISO string like
-- every other *_at column in this schema.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  order_id TEXT REFERENCES orders(id),
  order_item_id TEXT REFERENCES order_items(id),
  product_name TEXT,
  size TEXT,
  number INTEGER,
  total INTEGER,
  chapter TEXT,
  chapter_id TEXT,
  chapter_name TEXT,
  chapter_product_order INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  assigned_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_editions_order ON editions(order_id);
CREATE INDEX IF NOT EXISTS idx_editions_product ON editions(product_id);
`;

function createDb({ dbPath }) {
  // node:sqlite opens (and implicitly creates) the file eagerly, unlike
  // lib/storage.js's JSON reads/writes which create dataDir lazily on first
  // write - so, unless dbPath is ":memory:" (tests), the parent directory
  // must already exist before DatabaseSync's constructor runs.
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");

  // Read the stored version BEFORE SCHEMA_SQL runs - a never-before-seen file
  // and a pre-v2 file both report 0 here, so telling them apart for the
  // ALTER TABLE below can't rely on this number alone (see the table_info
  // check that follows).
  const previousVersion = db.prepare("PRAGMA user_version").get()?.user_version ?? 0;

  db.exec(SCHEMA_SQL);

  // CREATE TABLE IF NOT EXISTS above is a cheap no-op against a table that
  // already exists, so it can't retroactively add a column to a database
  // created under an older schema version - that needs an explicit ALTER.
  // Guarded by an actual column check, not just previousVersion < 2: a
  // brand-new database also reports previousVersion 0, but its payments
  // table was just created WITH kind already inline (from SCHEMA_SQL above),
  // so re-adding it here would fail with "duplicate column name".
  if (previousVersion < 2) {
    const paymentsColumns = db.prepare("PRAGMA table_info(payments)").all();
    if (!paymentsColumns.some((column) => column.name === "kind")) {
      db.exec("ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'charge'");
    }
  }

  if (previousVersion < CURRENT_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  }

  const integrity = db.prepare("PRAGMA quick_check").get();
  const integrityOk = integrity && Object.values(integrity)[0] === "ok";
  if (!integrityOk) {
    const error = new Error(`Baza de date ${dbPath} a esuat verificarea de integritate: ${JSON.stringify(integrity)}`);
    error.code = "DB_CORRUPT";
    throw error;
  }

  let inTransaction = false;

  function withTransaction(fn) {
    if (inTransaction) {
      // node:sqlite has one connection; a nested BEGIN would throw anyway,
      // but fail with a clear message instead of SQLite's raw error.
      throw new Error("withTransaction: o tranzactie este deja deschisa pe aceasta conexiune (nu poate fi imbricata).");
    }
    db.exec("BEGIN IMMEDIATE");
    inTransaction = true;
    try {
      const result = fn();
      db.exec("COMMIT");
      inTransaction = false;
      return result;
    } catch (error) {
      inTransaction = false;
      try {
        db.exec("ROLLBACK");
      } catch {
        // if COMMIT itself failed, there may be nothing left to roll back
      }
      throw error;
    }
  }

  // Must run right before any file-level copy of dbPath (backups) - WAL mode
  // means recent commits can still be sitting in the "-wal" sidecar file.
  function checkpoint() {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  function close() {
    db.close();
  }

  // ---------------------------------------------------------------------
  // users - row shape matches createUserRecord()'s camelCase output exactly
  // (id, email, name, role, passwordHash, emailVerified, isPrimaryAdmin,
  // createdAt, updatedAt) so every existing consumer (safePublicUser, etc.)
  // keeps working unchanged regardless of where the record came from.
  // ---------------------------------------------------------------------
  function rowToUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      passwordHash: row.password_hash,
      emailVerified: Boolean(row.email_verified),
      isPrimaryAdmin: Boolean(row.is_primary_admin),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getUserById(id) {
    return rowToUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  }

  function getUserByEmail(email) {
    return rowToUser(db.prepare("SELECT * FROM users WHERE email = ?").get(email));
  }

  function listUsers() {
    return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all().map(rowToUser);
  }

  function countUsers() {
    const row = db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN role = 'client' THEN 1 ELSE 0 END) AS clients FROM users")
      .get();
    return { total: row.total || 0, clients: row.clients || 0 };
  }

  function emailInUse(emailAddress, excludeUserId = null) {
    const row = excludeUserId
      ? db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(emailAddress, excludeUserId)
      : db.prepare("SELECT id FROM users WHERE email = ?").get(emailAddress);
    return Boolean(row);
  }

  // Upsert on id: every live call site (register, admin bootstrap) passes a
  // freshly generated id, so ON CONFLICT never fires there - it exists so
  // scripts/migrate-to-sqlite.js can call this directly and be safe to re-run.
  function insertUser(user) {
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, email_verified, is_primary_admin, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         email=excluded.email, name=excluded.name, role=excluded.role, password_hash=excluded.password_hash,
         email_verified=excluded.email_verified, is_primary_admin=excluded.is_primary_admin, updated_at=excluded.updated_at`
    ).run(
      user.id, user.email, user.name, user.role, user.passwordHash,
      user.emailVerified ? 1 : 0, user.isPrimaryAdmin ? 1 : 0, user.createdAt, user.updatedAt || null
    );
    return getUserById(user.id);
  }

  // Shallow-merges patch (camelCase keys) onto the current row and writes
  // every column back - mirrors the JSON call sites' `{...users[i], ...}` +
  // writeJson pattern exactly, including their each-call `updatedAt` bump.
  function updateUser(id, patch) {
    const current = getUserById(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
    db.prepare(
      `UPDATE users SET email=?, name=?, role=?, password_hash=?, email_verified=?, is_primary_admin=?, updated_at=?
       WHERE id=?`
    ).run(next.email, next.name, next.role, next.passwordHash, next.emailVerified ? 1 : 0, next.isPrimaryAdmin ? 1 : 0, next.updatedAt, id);
    return getUserById(id);
  }

  function anyAdminHasPrimaryFlag() {
    return Boolean(db.prepare("SELECT 1 FROM users WHERE is_primary_admin = 1 LIMIT 1").get());
  }

  function oldestAdminUser() {
    return rowToUser(db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get());
  }

  // ---------------------------------------------------------------------
  // sessions
  // ---------------------------------------------------------------------
  function getSessionWithUser(sessionId) {
    const row = db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at,
                u.id AS user_id, u.email, u.name, u.role, u.password_hash,
                u.email_verified, u.is_primary_admin, u.created_at, u.updated_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`
      )
      .get(sessionId);
    if (!row) return null;
    if (Date.now() > Number(row.expires_at)) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      return null;
    }
    return {
      id: row.session_id,
      user: rowToUser({
        id: row.user_id, email: row.email, name: row.name, role: row.role,
        password_hash: row.password_hash, email_verified: row.email_verified,
        is_primary_admin: row.is_primary_admin, created_at: row.created_at, updated_at: row.updated_at
      })
    };
  }

  // Upsert on id, same reasoning as insertUser above (live call sites always
  // pass a freshly generated id; the ON CONFLICT branch only matters for a
  // re-run of scripts/migrate-to-sqlite.js).
  function insertSession(sessionId, userId, expiresAt, createdAt) {
    db.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, expires_at=excluded.expires_at`
    ).run(sessionId, userId, expiresAt, createdAt);
  }

  function deleteSession(sessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  // keepSessionId=null deletes every session for the user (matches
  // invalidateUserSessions(userId, null)'s "log out everywhere" semantics).
  function deleteOtherSessionsForUser(userId, keepSessionId = null) {
    if (keepSessionId) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepSessionId);
    } else {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    }
  }

  function deleteExpiredSessions(now) {
    return db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
  }

  // ---------------------------------------------------------------------
  // products / product_variants - row shape matches sanitizeProduct()'s
  // camelCase output (id, slug, name, ..., stock, sizeStock, sizes, studio,
  // createdAt, updatedAt) so every existing consumer (publicProduct,
  // availableStock, productCanBePurchased, sanitizeProduct itself when
  // called again with `existing`, etc.) keeps working unchanged.
  //
  // sizeStock is a map derived from this product's variant rows; a product
  // with no real sizes still has exactly one variant row (size="") holding
  // the plain total - that row is collapsed back to sizeStock=undefined /
  // stock=<that row's count>, matching what sanitizeProduct() has always
  // produced for a sizeless product.
  // ---------------------------------------------------------------------
  function rowToProduct(row) {
    if (!row) return null;
    const variantRows = db
      .prepare("SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, size ASC")
      .all(row.id);
    const sizedRows = variantRows.filter((v) => v.size);
    const stock = variantRows.reduce((sum, v) => sum + v.stock, 0);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      nameRo: row.name_ro || "",
      nameEn: row.name_en || "",
      category: row.category || "",
      status: row.status,
      price: row.price,
      currency: row.currency,
      stock,
      sizeStock: sizedRows.length ? sizedRows.reduce((map, v) => ({ ...map, [v.size]: v.stock }), {}) : undefined,
      imageUrl: row.image_url || "",
      sceneImageUrl: row.scene_image_url || "",
      sizes: sizedRows.map((v) => v.size),
      color: row.color || "",
      description: row.description || "",
      descriptionRo: row.description_ro || "",
      descriptionEn: row.description_en || "",
      chapterId: row.chapter_id,
      chapterProductOrder: row.chapter_product_order,
      studio: row.studio_json ? JSON.parse(row.studio_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getProductById(id) {
    return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
  }

  function getProductBySlugOrId(key) {
    return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ? OR slug = ?").get(key, key));
  }

  function listProducts() {
    // One extra query per product for its variants - fine at this catalog's
    // scale (a boutique's worth of products, not a marketplace); not worth a
    // join+group-by for v1.
    return db.prepare("SELECT * FROM products ORDER BY created_at ASC").all().map((row) => rowToProduct(row));
  }

  function countProducts() {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS live,
                SUM(CASE WHEN status = 'preview' THEN 1 ELSE 0 END) AS preview
         FROM products`
      )
      .get();
    return { total: row.total || 0, live: row.live || 0, preview: row.preview || 0 };
  }

  function replaceProductVariants(productId, sizeStock, fallbackStock, timestamp) {
    db.prepare("DELETE FROM product_variants WHERE product_id = ?").run(productId);
    const now = timestamp || new Date().toISOString();
    if (sizeStock && typeof sizeStock === "object") {
      Object.entries(sizeStock).forEach(([size, qty], index) => {
        db.prepare(
          `INSERT INTO product_variants (id, product_id, size, stock, sort_order, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)`
        ).run(crypto.randomUUID(), productId, size, Math.max(0, Math.floor(Number(qty) || 0)), index, now, now);
      });
    } else {
      db.prepare(
        `INSERT INTO product_variants (id, product_id, size, stock, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(crypto.randomUUID(), productId, "", Math.max(0, Math.floor(Number(fallbackStock) || 0)), 0, now, now);
    }
  }

  // Full-object upsert - matches how sanitizeProduct() has always been used
  // at every call site (it returns a complete replacement product, not a
  // patch). Covers both create (product.id is fresh) and edit.
  function upsertProduct(product) {
    db.prepare(
      `INSERT INTO products (id, slug, name, name_ro, name_en, category, status, price, currency,
         image_url, scene_image_url, color, description, description_ro, description_en,
         chapter_id, chapter_product_order, studio_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         slug=excluded.slug, name=excluded.name, name_ro=excluded.name_ro, name_en=excluded.name_en,
         category=excluded.category, status=excluded.status, price=excluded.price, currency=excluded.currency,
         image_url=excluded.image_url, scene_image_url=excluded.scene_image_url, color=excluded.color,
         description=excluded.description, description_ro=excluded.description_ro, description_en=excluded.description_en,
         chapter_id=excluded.chapter_id, chapter_product_order=excluded.chapter_product_order,
         studio_json=excluded.studio_json, updated_at=excluded.updated_at`
    ).run(
      product.id, product.slug, product.name, product.nameRo || null, product.nameEn || null,
      product.category || null, product.status, product.price, product.currency,
      product.imageUrl || null, product.sceneImageUrl || null, product.color || null,
      product.description || null, product.descriptionRo || null, product.descriptionEn || null,
      product.chapterId || null, product.chapterProductOrder ?? null,
      product.studio ? JSON.stringify(product.studio) : null, product.createdAt, product.updatedAt || null
    );
    replaceProductVariants(product.id, product.sizeStock, product.stock, product.updatedAt || product.createdAt);
    return getProductById(product.id);
  }

  // Shallow-merge patch (camelCase keys) onto the current row - for callers
  // that only touch a couple of fields (e.g. the scene-image route) rather
  // than running the full sanitizeProduct() pipeline.
  function updateProduct(id, patch) {
    const current = getProductById(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
    return upsertProduct(next);
  }

  function deleteProduct(id) {
    // ON DELETE CASCADE removes its product_variants.
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
  }

  // Drag-to-reorder: sets chapterProductOrder to the dropped position for
  // each id, all-or-nothing. Returns false if any id doesn't exist (caller
  // maps that to 404, matching the JSON-era route's behavior).
  function reorderProducts(ids) {
    return withTransaction(() => {
      const now = new Date().toISOString();
      for (const id of ids) {
        const exists = db.prepare("SELECT 1 FROM products WHERE id = ?").get(id);
        if (!exists) return false;
      }
      ids.forEach((id, index) => {
        db.prepare("UPDATE products SET chapter_product_order = ?, updated_at = ? WHERE id = ?").run(index + 1, now, id);
      });
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // orders / order_items / order_status_history / editions / payments /
  // email_logs - rowToOrder reconstructs the exact rich camelCase shape the
  // JSON-era order object always had (items[], statusHistory[], reservation{},
  // fulfillment{}, etc.), so publicOrder(), the email templates,
  // restoreOrderResources() and every route below keep working unchanged.
  // ---------------------------------------------------------------------
  function rowToOrder(row) {
    if (!row) return null;
    const itemRows = db
      .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order ASC")
      .all(row.id);
    const historyRows = db
      .prepare("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC")
      .all(row.id);
    return {
      id: row.id,
      number: row.number,
      userId: row.user_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      customerAddress: row.customer_address,
      notes: row.notes || "",
      status: row.status,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      paidAt: row.paid_at,
      publicAccessTokenHash: row.public_access_token_hash,
      reservation: { expiresAt: row.reservation_expires_at, confirmedAt: row.reservation_confirmed_at },
      stockRestored: Boolean(row.stock_restored),
      couponConsumed: Boolean(row.coupon_consumed),
      couponRestored: Boolean(row.coupon_restored),
      editionsCancelled: Boolean(row.editions_cancelled),
      currency: row.currency,
      total: row.total,
      discount: row.discount,
      couponCode: row.coupon_code,
      items: itemRows.map((item) => ({
        productId: item.product_id,
        name: item.name,
        size: item.size || "",
        price: item.price,
        currency: item.currency,
        qty: item.qty,
        subtotal: item.subtotal,
        editionNumbers: item.edition_numbers_json ? JSON.parse(item.edition_numbers_json) : [],
        editionTotal: item.edition_total
      })),
      processedAt: row.processed_at,
      shippedAt: row.shipped_at,
      deliveredAt: row.delivered_at,
      cancelledAt: row.cancelled_at,
      fulfillment: {
        courierName: row.fulfillment_courier_name || "",
        trackingNumber: row.fulfillment_tracking_number || "",
        trackingUrl: row.fulfillment_tracking_url || "",
        estimatedDeliveryDate: row.fulfillment_estimated_delivery_date || "",
        customerNote: row.fulfillment_customer_note || "",
        internalNote: row.fulfillment_internal_note || ""
      },
      cancellationReason: row.cancellation_reason || "",
      statusHistory: historyRows.map((entry) => ({
        from: entry.from_status,
        to: entry.to_status,
        changedAt: entry.changed_at,
        changedBy: entry.changed_by,
        emailSent: Boolean(entry.email_sent),
        payment: (entry.payment_from !== null || entry.payment_to !== null)
          ? { from: entry.payment_from, to: entry.payment_to }
          : undefined,
        resend: entry.is_resend ? true : undefined
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getOrderById(id) {
    return rowToOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
  }

  // Square payments carry a reference_id we set to the order's human-facing
  // number at creation time (see server.js's pay route) - this is how a
  // webhook, which only ever hands back Square's own identifiers, maps back
  // to one of our orders.
  function getOrderByNumber(number) {
    return rowToOrder(db.prepare("SELECT * FROM orders WHERE number = ?").get(number));
  }

  function listOrdersForUser(userId) {
    return db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(rowToOrder);
  }

  function listOrdersAdmin() {
    return db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map(rowToOrder);
  }

  function countPendingCouponHolds(code) {
    return db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE coupon_code = ? AND status = 'pending' AND coupon_consumed = 0")
      .get(code).n;
  }

  // "BC-0001" style, fixed prefix regardless of brand (matches the JSON-era
  // literal) - each brand's own orders table makes its own independent
  // sequence, so no cross-brand collision risk despite the shared prefix.
  // Admin dashboard counts - a plain aggregate query rather than
  // listOrdersAdmin().filter(...), which would pay for every order's
  // items/history joins just to produce three numbers.
  function getOrderSummary() {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END) AS revenue
         FROM orders`
      )
      .get();
    return { total: row.total || 0, pending: row.pending || 0, revenue: row.revenue || 0 };
  }

  function getNextOrderNumber() {
    const row = db
      .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(number, 4) AS INTEGER)), 0) AS maxNumber FROM orders WHERE number LIKE 'BC-%'")
      .get();
    return `BC-${String(row.maxNumber + 1).padStart(4, "0")}`;
  }

  function insertOrderRow(order) {
    db.prepare(
      `INSERT INTO orders (id, number, user_id, customer_name, customer_email, customer_phone, customer_address,
         address_id, notes, status, payment_status, payment_method, paid_at, public_access_token_hash,
         reservation_expires_at, reservation_confirmed_at, stock_restored, coupon_consumed, coupon_restored,
         editions_cancelled, currency, total, discount, coupon_code, processed_at, shipped_at, delivered_at,
         cancelled_at, fulfillment_courier_name, fulfillment_tracking_number, fulfillment_tracking_url,
         fulfillment_estimated_delivery_date, fulfillment_customer_note, fulfillment_internal_note,
         cancellation_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         number=excluded.number, user_id=excluded.user_id, customer_name=excluded.customer_name,
         customer_email=excluded.customer_email, customer_phone=excluded.customer_phone,
         customer_address=excluded.customer_address, address_id=excluded.address_id, notes=excluded.notes,
         status=excluded.status, payment_status=excluded.payment_status, payment_method=excluded.payment_method,
         paid_at=excluded.paid_at, public_access_token_hash=excluded.public_access_token_hash,
         reservation_expires_at=excluded.reservation_expires_at, reservation_confirmed_at=excluded.reservation_confirmed_at,
         stock_restored=excluded.stock_restored, coupon_consumed=excluded.coupon_consumed,
         coupon_restored=excluded.coupon_restored, editions_cancelled=excluded.editions_cancelled,
         currency=excluded.currency, total=excluded.total, discount=excluded.discount, coupon_code=excluded.coupon_code,
         processed_at=excluded.processed_at, shipped_at=excluded.shipped_at, delivered_at=excluded.delivered_at,
         cancelled_at=excluded.cancelled_at, fulfillment_courier_name=excluded.fulfillment_courier_name,
         fulfillment_tracking_number=excluded.fulfillment_tracking_number, fulfillment_tracking_url=excluded.fulfillment_tracking_url,
         fulfillment_estimated_delivery_date=excluded.fulfillment_estimated_delivery_date,
         fulfillment_customer_note=excluded.fulfillment_customer_note, fulfillment_internal_note=excluded.fulfillment_internal_note,
         cancellation_reason=excluded.cancellation_reason, updated_at=excluded.updated_at`
    ).run(
      order.id, order.number, order.userId || null, order.customerName, order.customerEmail,
      order.customerPhone || null, order.customerAddress || null, order.addressId || null, order.notes || null,
      order.status, order.paymentStatus, order.paymentMethod || null, order.paidAt || null,
      order.publicAccessTokenHash || null, order.reservation?.expiresAt || null, order.reservation?.confirmedAt || null,
      order.stockRestored ? 1 : 0, order.couponConsumed ? 1 : 0, order.couponRestored ? 1 : 0,
      order.editionsCancelled ? 1 : 0, order.currency, order.total, order.discount || 0, order.couponCode || null,
      order.processedAt || null, order.shippedAt || null, order.deliveredAt || null, order.cancelledAt || null,
      order.fulfillment?.courierName || null, order.fulfillment?.trackingNumber || null, order.fulfillment?.trackingUrl || null,
      order.fulfillment?.estimatedDeliveryDate || null, order.fulfillment?.customerNote || null, order.fulfillment?.internalNote || null,
      order.cancellationReason || null, order.createdAt, order.updatedAt || null
    );
  }

  function insertOrderItems(orderId, items) {
    items.forEach((item, index) => {
      db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, variant_id, name, size, price, currency, qty, subtotal,
           edition_numbers_json, edition_total, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        `${orderId}#item#${index}`, orderId, item.productId || null, item.variantId || null, item.name,
        item.size || "", item.price, item.currency, item.qty, item.subtotal,
        JSON.stringify(item.editionNumbers || []), item.editionTotal ?? null, index
      );
    });
  }

  function appendOrderStatusHistory(orderId, entry) {
    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, payment_from, payment_to,
         changed_at, changed_by, email_sent, is_resend)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      orderId, entry.from ?? null, entry.to, entry.payment?.from ?? null, entry.payment?.to ?? null,
      entry.changedAt, entry.changedBy ?? null, entry.emailSent ? 1 : 0, entry.resend ? 1 : 0
    );
  }

  // Editions are never deleted/renumbered, so MAX(id) is always the count
  // too - kept as MAX rather than COUNT purely to be robust to that
  // invariant (this function doesn't have to trust it).
  function getMaxEditionId() {
    return db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM editions").get().maxId;
  }

  function countEditionsForProduct(productId) {
    return db.prepare("SELECT COUNT(*) AS n FROM editions WHERE product_id = ?").get(productId).n;
  }

  function insertEditions(records) {
    records.forEach((record) => {
      db.prepare(
        `INSERT INTO editions (id, product_id, order_id, order_item_id, product_name, size, number, total,
           chapter, chapter_id, chapter_name, chapter_product_order, status, assigned_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        record.id, record.productId || null, record.orderId || null, record.orderItemId || null,
        record.productName || null, record.size || "", record.number, record.total ?? null,
        record.chapter ?? null, record.chapterId ?? null, record.chapterName ?? null,
        record.chapterProductOrder ?? null, "active", record.assignedAt
      );
    });
  }

  // Raw insert, no transaction of its own: order row + its items + its one
  // initial status-history entry + the per-unit edition records checkout
  // assigned for it. Exposed separately from createOrderWithItemsAndEditions
  // below so checkout can call it inside the SAME transaction as its product
  // stock updates - withTransaction refuses to nest, so the caller that
  // needs a wider atomic unit must be the one that opens it.
  function insertOrderComplete(order, editionRecords) {
    insertOrderRow(order);
    insertOrderItems(order.id, order.items);
    order.statusHistory.forEach((entry) => appendOrderStatusHistory(order.id, entry));
    if (editionRecords?.length) insertEditions(editionRecords);
    return getOrderById(order.id);
  }

  // scripts/migrate-to-sqlite.js only. Unlike insertOrderComplete (which
  // *appends* items/history/editions - correct for checkout creating a brand
  // new order), this *replaces* them: delete whatever this order_id already
  // has, then insert the complete set from the source JSON. That's what makes
  // re-running the migration against the same order produce the same result
  // instead of duplicating every item/history entry on each run. The order
  // row and each edition are upserted (editions carry their real historical
  // id and must never collide with each other across orders).
  function importOrder(order, editionRecords) {
    insertOrderRow(order);
    // Editions reference order_items via order_item_id (FK, default NO
    // ACTION on delete) - clear this order's editions BEFORE deleting its
    // items, or a re-run's item delete is blocked by editions still
    // pointing at the rows about to be removed.
    db.prepare("DELETE FROM editions WHERE order_id = ?").run(order.id);
    db.prepare("DELETE FROM order_items WHERE order_id = ?").run(order.id);
    insertOrderItems(order.id, order.items);
    db.prepare("DELETE FROM order_status_history WHERE order_id = ?").run(order.id);
    order.statusHistory.forEach((entry) => appendOrderStatusHistory(order.id, entry));
    (editionRecords || []).forEach((record) => {
      db.prepare(
        `INSERT INTO editions (id, product_id, order_id, order_item_id, product_name, size, number, total,
           chapter, chapter_id, chapter_name, chapter_product_order, status, assigned_at, cancelled_at, cancelled_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           product_id=excluded.product_id, order_id=excluded.order_id, order_item_id=excluded.order_item_id,
           product_name=excluded.product_name, size=excluded.size, number=excluded.number, total=excluded.total,
           chapter=excluded.chapter, chapter_id=excluded.chapter_id, chapter_name=excluded.chapter_name,
           chapter_product_order=excluded.chapter_product_order, status=excluded.status,
           cancelled_at=excluded.cancelled_at, cancelled_by=excluded.cancelled_by`
      ).run(
        record.id, record.productId || null, record.orderId || null, record.orderItemId || null,
        record.productName || null, record.size || "", record.number, record.total ?? null,
        record.chapter ?? null, record.chapterId ?? null, record.chapterName ?? null,
        record.chapterProductOrder ?? null, record.status === "cancelled" ? "cancelled" : "active",
        record.assignedAt, record.cancelledAt ?? null, record.cancelledBy ?? null
      );
    });
    return getOrderById(order.id);
  }

  // Self-contained atomic version for any caller that only needs the order
  // itself committed (not bundled with other writes) - migration script,
  // tests, or any future non-checkout order-creation path.
  function createOrderWithItemsAndEditions(order, editionRecords) {
    return withTransaction(() => insertOrderComplete(order, editionRecords));
  }

  // Full-row update for the order's flat fields (status, fulfillment,
  // payment, reservation, idempotency flags, etc.) - does not touch
  // items/statusHistory/editions, which have their own append-only functions.
  function updateOrder(id, patch) {
    const current = getOrderById(id);
    if (!current) return null;
    insertOrderRow({ ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() });
    return getOrderById(id);
  }

  function cancelEditionsForOrder(orderId, cancelledBy, now) {
    db.prepare(
      `UPDATE editions SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?
       WHERE order_id = ? AND status != 'cancelled'`
    ).run(now, cancelledBy || null, orderId);
  }

  function rowToPayment(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      rawResponse: row.raw_response_json ? JSON.parse(row.raw_response_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function insertPayment(payment) {
    db.prepare(
      `INSERT INTO payments (id, order_id, provider, provider_payment_id, kind, amount, currency, status,
         raw_response_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      payment.id, payment.orderId, payment.provider, payment.providerPaymentId || null, payment.kind || "charge",
      payment.amount, payment.currency, payment.status, payment.rawResponse ? JSON.stringify(payment.rawResponse) : null,
      payment.createdAt, payment.updatedAt || null
    );
    return rowToPayment(db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id));
  }

  // The authoritative idempotency lookup: whichever of the sync pay route or
  // the webhook settles a given Square payment/refund id first, the other
  // finds it here and no-ops instead of double-processing.
  function getPaymentByProviderPaymentId(providerPaymentId) {
    return rowToPayment(db.prepare("SELECT * FROM payments WHERE provider_payment_id = ?").get(providerPaymentId));
  }

  function listPaymentsForOrder(orderId) {
    return db.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC").all(orderId).map(rowToPayment);
  }

  // Patch-style update for a payment row already inserted (e.g. moving the
  // pre-call "pending" audit row to "failed" once Square cleanly declines,
  // or a refund row from "pending" to "completed" once refund.updated
  // confirms it). Unlike updateOrder this never touches provider_payment_id
  // once set - that column is the identity a caller uses to find this row.
  function updatePaymentStatus(id, patch) {
    const current = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!current) return null;
    const status = patch.status ?? current.status;
    const providerPaymentId = patch.providerPaymentId ?? current.provider_payment_id;
    const rawResponseJson = patch.rawResponse !== undefined ? JSON.stringify(patch.rawResponse) : current.raw_response_json;
    const updatedAt = patch.updatedAt || new Date().toISOString();
    db.prepare(
      "UPDATE payments SET status = ?, provider_payment_id = ?, raw_response_json = ?, updated_at = ? WHERE id = ?"
    ).run(status, providerPaymentId, rawResponseJson, updatedAt, id);
    return rowToPayment(db.prepare("SELECT * FROM payments WHERE id = ?").get(id));
  }

  function rowToEdition(row) {
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      orderId: row.order_id,
      productName: row.product_name,
      size: row.size || "",
      number: row.number,
      total: row.total,
      chapter: row.chapter,
      chapterId: row.chapter_id,
      chapterName: row.chapter_name,
      chapterProductOrder: row.chapter_product_order,
      status: row.status,
      assignedAt: row.assigned_at,
      cancelledAt: row.cancelled_at,
      cancelledBy: row.cancelled_by
    };
  }

  // Public archive endpoints list every piece ever assigned (filtering
  // cancelled ones is the caller's job, same as the JSON-era array) - small
  // enough at this catalog's scale to fetch whole and filter/sort in JS.
  function listEditions() {
    return db.prepare("SELECT * FROM editions ORDER BY id ASC").all().map(rowToEdition);
  }

  function getEditionById(id) {
    return rowToEdition(db.prepare("SELECT * FROM editions WHERE id = ?").get(id));
  }

  function insertEmailLog(entry) {
    db.prepare(
      "INSERT INTO email_logs (order_id, status, sent_at, ok, reason) VALUES (?,?,?,?,?)"
    ).run(entry.orderId || null, entry.status, entry.sentAt, entry.ok ? 1 : 0, entry.reason || null);
  }

  // Dedup check for a given order+status email (e.g. "payment-confirmed"):
  // any prior attempt at all counts, successful or not - this app never
  // auto-retries a failed send (a failed one is saved to the local outbox
  // instead, same as every other transactional email here), so "already
  // attempted" is the right question, not "already delivered".
  function getEmailLog(orderId, status) {
    const row = db
      .prepare("SELECT * FROM email_logs WHERE order_id = ? AND status = ? ORDER BY id DESC LIMIT 1")
      .get(orderId, status);
    if (!row) return null;
    return { id: row.id, orderId: row.order_id, status: row.status, sentAt: row.sent_at, ok: Boolean(row.ok), reason: row.reason };
  }

  return {
    raw: db,
    withTransaction,
    checkpoint,
    close,
    getUserById,
    getUserByEmail,
    listUsers,
    countUsers,
    emailInUse,
    insertUser,
    updateUser,
    anyAdminHasPrimaryFlag,
    oldestAdminUser,
    getSessionWithUser,
    insertSession,
    deleteSession,
    deleteOtherSessionsForUser,
    deleteExpiredSessions,
    getProductById,
    getProductBySlugOrId,
    listProducts,
    countProducts,
    upsertProduct,
    updateProduct,
    deleteProduct,
    reorderProducts,
    getOrderById,
    getOrderByNumber,
    listOrdersForUser,
    listOrdersAdmin,
    countPendingCouponHolds,
    getOrderSummary,
    getNextOrderNumber,
    getMaxEditionId,
    countEditionsForProduct,
    insertOrderComplete,
    createOrderWithItemsAndEditions,
    importOrder,
    updateOrder,
    appendOrderStatusHistory,
    cancelEditionsForOrder,
    insertPayment,
    getPaymentByProviderPaymentId,
    listPaymentsForOrder,
    updatePaymentStatus,
    listEditions,
    getEditionById,
    insertEmailLog,
    getEmailLog
  };
}

module.exports = { createDb, SCHEMA_SQL, CURRENT_SCHEMA_VERSION };
