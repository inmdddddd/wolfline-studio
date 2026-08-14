const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { toSlug } = require("./slug");

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

const CURRENT_SCHEMA_VERSION = 5;

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
  customer_country TEXT,
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

CREATE TABLE IF NOT EXISTS shipping_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  countries_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shipping_zones_sort ON shipping_zones(sort_order);

CREATE TABLE IF NOT EXISTS shipping_methods (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  free_shipping_threshold REAL,
  estimated_delivery_text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shipping_methods_zone ON shipping_methods(zone_id);

-- inclusive=1 means the rate is already baked into the displayed product
-- price (matches this brand's existing Terms copy, "displayed prices
-- include VAT") - it is informational on the order, not added on top of
-- the total. inclusive=0 rates are added to the total at checkout.
CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT,
  rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
  inclusive INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tax_rates_country ON tax_rates(country);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_tags (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag_id);

-- id is a stable slug (e.g. "order-received") matching one build*Email
-- function in lib/email.js, not a random uuid - that function is always the
-- fallback if a row is missing/inactive/fails to interpolate, so a template
-- misconfigured by an admin can never break the critical order-email flow.
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Enforces "at most one default language" at the DB level, not just by
-- application discipline - setting a new default must clear the old one
-- in the same write or this index rejects the second row outright.
CREATE UNIQUE INDEX IF NOT EXISTS idx_languages_one_default ON languages(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  decimal_places INTEGER NOT NULL DEFAULT 2,
  symbol_position TEXT NOT NULL DEFAULT 'before' CHECK (symbol_position IN ('before','after')),
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_one_default ON currencies(is_default) WHERE is_default = 1;

-- Maps a country to the single language/currency a customer from that
-- country sees - deliberately NOT a shipping/tax zone mapping too:
-- resolveShipping/resolveTax already resolve straight from a country code,
-- so duplicating that here would be a second, competing source of truth.
CREATE TABLE IF NOT EXISTS country_config (
  country_code TEXT PRIMARY KEY,
  language_code TEXT NOT NULL REFERENCES languages(code),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- A product's price for a specific COUNTRY (e.g. "Romania: 250", "United
-- Kingdom: 50"), overriding its base price/currency column - full
-- independent control per country even when two countries share a currency
-- (France/Germany can both be EUR with different prices). country_code
-- references country_config, not currencies directly: a country must have
-- its language/currency mapping configured first (that's where currency_code
-- here is derived from at write time - see server.js's sanitizeCountryPriceEntries)
-- before it can be priced, so there's always one authoritative place a
-- country's currency comes from. currency_code is stored redundantly for
-- convenient reads (avoids a join on every price display) - "just for
-- display", per the admin's own framing; it is never independently chosen.
-- No row for a country = no override; resolveProductPrice falls back to the
-- product's own base price. Never deleted en masse when a product is - ON
-- DELETE CASCADE keeps this table from accumulating orphans.
CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL REFERENCES country_config(country_code),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  price REAL NOT NULL CHECK (price >= 0),
  compare_at_price REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(product_id, country_code)
);
CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id);

-- Same relationship to shipping_methods.price that product_prices has to
-- products.price - resolveShipping's zone/method SELECTION is untouched,
-- this only makes the price NUMBER country-aware once a method is chosen.
CREATE TABLE IF NOT EXISTS shipping_method_prices (
  id TEXT PRIMARY KEY,
  shipping_method_id TEXT NOT NULL REFERENCES shipping_methods(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL REFERENCES country_config(country_code),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  price REAL NOT NULL CHECK (price >= 0),
  free_shipping_threshold REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(shipping_method_id, country_code)
);

-- Replaces products.name_ro/name_en/description_ro/description_en going
-- forward - those columns stay in the table (nothing else forces a rebuild
-- this version) but the application stops reading/writing them once the
-- migration backfills their data in here.
CREATE TABLE IF NOT EXISTS product_translations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  name TEXT,
  description TEXT,
  short_description TEXT,
  seo_title TEXT,
  seo_description TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(product_id, language_code)
);
CREATE INDEX IF NOT EXISTS idx_product_translations_product ON product_translations(product_id);

-- Normalizes products.category (free text) the same way tags normalized
-- out of a comma-separated string - products.category itself stays as the
-- admin-facing free-text field/bulk-action input, unchanged; the server
-- resolves-or-creates a row here underneath it.
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  default_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS category_translations (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(category_id, language_code)
);

-- Optional override layer on top of locale.js's/script.js's hardcoded EN/RO
-- string dictionaries - NOT a migration target for them. A row here wins
-- when present; any gap falls through to the code-defined baseline, exactly
-- like email_templates overrides a hardcoded email. This is what lets a
-- 3rd+ language exist at all (it has no JS-side baseline to fall back to
-- except English) without requiring every existing EN/RO string to be
-- re-entered as data before anything works.
CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  language_code TEXT NOT NULL REFERENCES languages(code),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(key, language_code)
);
CREATE INDEX IF NOT EXISTS idx_translations_language ON translations(language_code);
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

  // Idempotent, unconditional (not version-gated - INSERT OR IGNORE is a
  // cheap no-op on repeat opens, same philosophy as CREATE TABLE IF NOT
  // EXISTS above). Matches current real-world state exactly: an upgraded
  // database shows zero observable change until an admin touches the new
  // admin screens. Runs before every version-gated block below because the
  // v5 email_templates rebuild's backfill needs a default language to exist.
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO languages (code, name, native_name, active, is_default, sort_order, created_at)
     VALUES ('en', 'English', 'English', 1, 1, 0, ?)`
  ).run(nowIso);
  db.prepare(
    `INSERT OR IGNORE INTO languages (code, name, native_name, active, is_default, sort_order, created_at)
     VALUES ('ro', 'Romanian', 'Romana', 1, 0, 1, ?)`
  ).run(nowIso);
  db.prepare(
    `INSERT OR IGNORE INTO currencies (code, symbol, decimal_places, symbol_position, is_default, active, sort_order, created_at)
     VALUES ('GBP', '£', 2, 'before', 1, 1, 0, ?)`
  ).run(nowIso);

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

  // v3: shipping + tax snapshot columns on orders (the order's own record of
  // what was charged, independent of the shipping_methods/tax_rates rows,
  // which can change later); catalog-completeness columns on products.
  // Same reasoning as the v2 guard above - CREATE TABLE ... IF NOT EXISTS
  // can't retroactively add a column to a table that already existed under
  // an older schema, and a brand-new database already has these inline from
  // SCHEMA_SQL, so re-adding here would fail with "duplicate column name".
  if (previousVersion < 3) {
    const orderColumns = db.prepare("PRAGMA table_info(orders)").all();
    const hasOrderColumn = (name) => orderColumns.some((column) => column.name === name);
    if (!hasOrderColumn("customer_country")) db.exec("ALTER TABLE orders ADD COLUMN customer_country TEXT");
    if (!hasOrderColumn("shipping_method_id")) db.exec("ALTER TABLE orders ADD COLUMN shipping_method_id TEXT");
    if (!hasOrderColumn("shipping_method_name")) db.exec("ALTER TABLE orders ADD COLUMN shipping_method_name TEXT");
    if (!hasOrderColumn("shipping_cost")) db.exec("ALTER TABLE orders ADD COLUMN shipping_cost REAL NOT NULL DEFAULT 0");
    if (!hasOrderColumn("tax_rate_id")) db.exec("ALTER TABLE orders ADD COLUMN tax_rate_id TEXT");
    if (!hasOrderColumn("tax_name")) db.exec("ALTER TABLE orders ADD COLUMN tax_name TEXT");
    if (!hasOrderColumn("tax_rate_value")) db.exec("ALTER TABLE orders ADD COLUMN tax_rate_value REAL");
    if (!hasOrderColumn("tax_amount")) db.exec("ALTER TABLE orders ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0");
    if (!hasOrderColumn("tax_inclusive")) db.exec("ALTER TABLE orders ADD COLUMN tax_inclusive INTEGER NOT NULL DEFAULT 0");

    const productColumns = db.prepare("PRAGMA table_info(products)").all();
    const hasProductColumn = (name) => productColumns.some((column) => column.name === name);
    if (!hasProductColumn("sku")) db.exec("ALTER TABLE products ADD COLUMN sku TEXT");
    if (!hasProductColumn("barcode")) db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
    if (!hasProductColumn("weight_grams")) db.exec("ALTER TABLE products ADD COLUMN weight_grams INTEGER");
    if (!hasProductColumn("dimensions_json")) db.exec("ALTER TABLE products ADD COLUMN dimensions_json TEXT");
    if (!hasProductColumn("compare_at_price")) db.exec("ALTER TABLE products ADD COLUMN compare_at_price REAL");
    if (!hasProductColumn("cost_price")) db.exec("ALTER TABLE products ADD COLUMN cost_price REAL");
    if (!hasProductColumn("seo_title")) db.exec("ALTER TABLE products ADD COLUMN seo_title TEXT");
    if (!hasProductColumn("seo_description")) db.exec("ALTER TABLE products ADD COLUMN seo_description TEXT");
    if (!hasProductColumn("canonical_url")) db.exec("ALTER TABLE products ADD COLUMN canonical_url TEXT");
    if (!hasProductColumn("metadata_json")) db.exec("ALTER TABLE products ADD COLUMN metadata_json TEXT");
    if (!hasProductColumn("featured")) db.exec("ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0");
  }

  // v4: bulk actions need an "archived" product status, but status's CHECK
  // constraint is baked into the column definition - SQLite has no ALTER
  // TABLE for that, only the documented rebuild-the-table procedure. Every
  // database (fresh or upgraded) hits this once: SCHEMA_SQL's products
  // table was never updated to include 'archived' directly, so
  // previousVersion < 4 is true even for a database created moments ago.
  // Gated on the version number alone (not a "does this already have
  // archived" check) - safe because this block runs at most once per
  // database, right before user_version is bumped past 4 for good.
  if (previousVersion < 4) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      CREATE TABLE products_v4 (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_ro TEXT,
        name_en TEXT,
        category TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft','preview','live','sold-out','archived')),
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
        updated_at TEXT,
        sku TEXT,
        barcode TEXT,
        weight_grams INTEGER,
        dimensions_json TEXT,
        compare_at_price REAL,
        cost_price REAL,
        seo_title TEXT,
        seo_description TEXT,
        canonical_url TEXT,
        metadata_json TEXT,
        featured INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO products_v4 SELECT
        id, slug, name, name_ro, name_en, category, status, price, currency,
        image_url, scene_image_url, color, description, description_ro, description_en,
        chapter_id, chapter_product_order, studio_json, created_at, updated_at,
        sku, barcode, weight_grams, dimensions_json, compare_at_price, cost_price,
        seo_title, seo_description, canonical_url, metadata_json, featured
      FROM products;
      DROP TABLE products;
      ALTER TABLE products_v4 RENAME TO products;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // v5: internationalization + country-based pricing. category_id/
  // customer_language are plain ALTERs (no REFERENCES clause, matching how
  // orders.shipping_method_id/tax_rate_id were already added - enforced at
  // the application layer only). The categories and product_translations
  // backfills need JS-side UUID/slug generation, so they can't be plain SQL
  // like the payments/orders/products ALTERs above - run by hand with
  // BEGIN/COMMIT since withTransaction isn't defined until after every
  // migration block here has run. email_templates needs a PRIMARY KEY shape
  // change (single id -> composite id+language_code), which SQLite can't
  // ALTER, so it gets the same documented rebuild procedure as v4's
  // products rebuild above, unconditionally for every database.
  if (previousVersion < 5) {
    const productColumnsV5 = db.prepare("PRAGMA table_info(products)").all();
    if (!productColumnsV5.some((column) => column.name === "category_id")) {
      db.exec("ALTER TABLE products ADD COLUMN category_id TEXT");
    }
    const orderColumnsV5 = db.prepare("PRAGMA table_info(orders)").all();
    if (!orderColumnsV5.some((column) => column.name === "customer_language")) {
      db.exec("ALTER TABLE orders ADD COLUMN customer_language TEXT");
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const distinctCategories = db.prepare(
        "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) != ''"
      ).all();
      const insertCategory = db.prepare(
        "INSERT INTO categories (id, slug, default_name, sort_order, created_at) VALUES (?,?,?,0,?)"
      );
      const assignCategory = db.prepare("UPDATE products SET category_id = ? WHERE category = ?");
      // toSlug() lowercases, so two DISTINCT (SQL is case-sensitive here)
      // category values like "Tee"/"TEE" can collide on the same slug -
      // tracked in-memory since this migration only ever runs once over a
      // bounded set, not worth a query-per-candidate.
      const usedSlugs = new Set();
      distinctCategories.forEach((row) => {
        const categoryId = crypto.randomUUID();
        const baseSlug = toSlug(row.category) || categoryId;
        let slug = baseSlug;
        let suffix = 2;
        while (usedSlugs.has(slug)) {
          slug = `${baseSlug}-${suffix}`;
          suffix += 1;
        }
        usedSlugs.add(slug);
        insertCategory.run(categoryId, slug, row.category, nowIso);
        assignCategory.run(categoryId, row.category);
      });

      // The "ro" and "en" inserts below always write different language_code
      // values for a given product_id, so they can never collide with each
      // other on product_translations' UNIQUE(product_id, language_code) -
      // both run unconditionally, independent of which language is default.
      const insertTranslation = db.prepare(
        `INSERT INTO product_translations (id, product_id, language_code, name, description, created_at)
         VALUES (?,?,?,?,?,?)`
      );
      const productsWithRoContent = db.prepare(
        "SELECT id, name_ro, description_ro FROM products WHERE TRIM(COALESCE(name_ro,'')) != '' OR TRIM(COALESCE(description_ro,'')) != ''"
      ).all();
      productsWithRoContent.forEach((row) => {
        insertTranslation.run(crypto.randomUUID(), row.id, "ro", row.name_ro || null, row.description_ro || null, nowIso);
      });
      const productsWithEnContent = db.prepare(
        "SELECT id, name_en, description_en FROM products WHERE TRIM(COALESCE(name_en,'')) != '' OR TRIM(COALESCE(description_en,'')) != ''"
      ).all();
      productsWithEnContent.forEach((row) => {
        insertTranslation.run(crypto.randomUUID(), row.id, "en", row.name_en || null, row.description_en || null, nowIso);
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      CREATE TABLE email_templates_v5 (
        id TEXT NOT NULL,
        language_code TEXT NOT NULL REFERENCES languages(code),
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT,
        updated_by TEXT,
        PRIMARY KEY (id, language_code)
      );
      INSERT INTO email_templates_v5 (id, language_code, name, subject, body, active, updated_at, updated_by)
        SELECT id, (SELECT code FROM languages WHERE is_default = 1 LIMIT 1), name, subject, body, active, updated_at, updated_by
        FROM email_templates;
      DROP TABLE email_templates;
      ALTER TABLE email_templates_v5 RENAME TO email_templates;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
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
      sku: row.sku || "",
      barcode: row.barcode || "",
      weightGrams: row.weight_grams ?? null,
      dimensions: row.dimensions_json ? JSON.parse(row.dimensions_json) : undefined,
      compareAtPrice: row.compare_at_price ?? null,
      costPrice: row.cost_price ?? null,
      seoTitle: row.seo_title || "",
      seoDescription: row.seo_description || "",
      canonicalUrl: row.canonical_url || "",
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      featured: Boolean(row.featured),
      tags: getTagsForProduct(row.id),
      prices: listProductPrices(row.id),
      categoryId: row.category_id || null,
      translations: listProductTranslations(row.id),
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
      `INSERT INTO products (id, slug, name, name_ro, name_en, category, category_id, status, price, currency,
         image_url, scene_image_url, color, description, description_ro, description_en,
         chapter_id, chapter_product_order, studio_json,
         sku, barcode, weight_grams, dimensions_json, compare_at_price, cost_price,
         seo_title, seo_description, canonical_url, metadata_json, featured,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         slug=excluded.slug, name=excluded.name, name_ro=excluded.name_ro, name_en=excluded.name_en,
         category=excluded.category, category_id=excluded.category_id, status=excluded.status, price=excluded.price, currency=excluded.currency,
         image_url=excluded.image_url, scene_image_url=excluded.scene_image_url, color=excluded.color,
         description=excluded.description, description_ro=excluded.description_ro, description_en=excluded.description_en,
         chapter_id=excluded.chapter_id, chapter_product_order=excluded.chapter_product_order,
         studio_json=excluded.studio_json,
         sku=excluded.sku, barcode=excluded.barcode, weight_grams=excluded.weight_grams,
         dimensions_json=excluded.dimensions_json, compare_at_price=excluded.compare_at_price,
         cost_price=excluded.cost_price, seo_title=excluded.seo_title, seo_description=excluded.seo_description,
         canonical_url=excluded.canonical_url, metadata_json=excluded.metadata_json, featured=excluded.featured,
         updated_at=excluded.updated_at`
    ).run(
      product.id, product.slug, product.name, product.nameRo || null, product.nameEn || null,
      product.category || null, product.categoryId || null, product.status, product.price, product.currency,
      product.imageUrl || null, product.sceneImageUrl || null, product.color || null,
      product.description || null, product.descriptionRo || null, product.descriptionEn || null,
      product.chapterId || null, product.chapterProductOrder ?? null,
      product.studio ? JSON.stringify(product.studio) : null,
      product.sku || null, product.barcode || null, product.weightGrams ?? null,
      product.dimensions ? JSON.stringify(product.dimensions) : null,
      product.compareAtPrice ?? null, product.costPrice ?? null,
      product.seoTitle || null, product.seoDescription || null, product.canonicalUrl || null,
      product.metadata ? JSON.stringify(product.metadata) : null, product.featured ? 1 : 0,
      product.createdAt, product.updatedAt || null
    );
    replaceProductVariants(product.id, product.sizeStock, product.stock, product.updatedAt || product.createdAt);
    // Same wholesale-replace convention as variants - sanitizeProduct
    // resolves tagIds to "keep existing" whenever the caller doesn't touch
    // them, so this never silently clears tags on an unrelated edit.
    setProductTags(product.id, product.tagIds || []);
    return getProductById(product.id);
  }

  // Shallow-merge patch (camelCase keys) onto the current row - for callers
  // that only touch a couple of fields (e.g. the scene-image route) rather
  // than running the full sanitizeProduct() pipeline.
  function updateProduct(id, patch) {
    const current = getProductById(id);
    if (!current) return null;
    // current carries tags as full objects (tags), not the tagIds shape
    // upsertProduct/setProductTags expect - without this, any patch that
    // doesn't explicitly set tagIds would fall through to
    // upsertProduct's `product.tagIds || []` and silently wipe every tag
    // on the product (e.g. every scene-image save).
    const next = {
      ...current,
      tagIds: (patch.tagIds !== undefined ? patch.tagIds : current.tags.map((tag) => tag.id)),
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString()
    };
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
      customerCountry: row.customer_country || "",
      customerLanguage: row.customer_language || "",
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
      shipping: {
        methodId: row.shipping_method_id,
        methodName: row.shipping_method_name,
        cost: row.shipping_cost || 0
      },
      tax: {
        rateId: row.tax_rate_id,
        name: row.tax_name,
        rateValue: row.tax_rate_value,
        amount: row.tax_amount || 0,
        inclusive: Boolean(row.tax_inclusive)
      },
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
         customer_country, customer_language, address_id, notes, status, payment_status, payment_method, paid_at, public_access_token_hash,
         reservation_expires_at, reservation_confirmed_at, stock_restored, coupon_consumed, coupon_restored,
         editions_cancelled, currency, total, discount, coupon_code,
         shipping_method_id, shipping_method_name, shipping_cost,
         tax_rate_id, tax_name, tax_rate_value, tax_amount, tax_inclusive,
         processed_at, shipped_at, delivered_at,
         cancelled_at, fulfillment_courier_name, fulfillment_tracking_number, fulfillment_tracking_url,
         fulfillment_estimated_delivery_date, fulfillment_customer_note, fulfillment_internal_note,
         cancellation_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         number=excluded.number, user_id=excluded.user_id, customer_name=excluded.customer_name,
         customer_email=excluded.customer_email, customer_phone=excluded.customer_phone,
         customer_address=excluded.customer_address, customer_country=excluded.customer_country,
         customer_language=excluded.customer_language,
         address_id=excluded.address_id, notes=excluded.notes,
         status=excluded.status, payment_status=excluded.payment_status, payment_method=excluded.payment_method,
         paid_at=excluded.paid_at, public_access_token_hash=excluded.public_access_token_hash,
         reservation_expires_at=excluded.reservation_expires_at, reservation_confirmed_at=excluded.reservation_confirmed_at,
         stock_restored=excluded.stock_restored, coupon_consumed=excluded.coupon_consumed,
         coupon_restored=excluded.coupon_restored, editions_cancelled=excluded.editions_cancelled,
         currency=excluded.currency, total=excluded.total, discount=excluded.discount, coupon_code=excluded.coupon_code,
         shipping_method_id=excluded.shipping_method_id, shipping_method_name=excluded.shipping_method_name,
         shipping_cost=excluded.shipping_cost, tax_rate_id=excluded.tax_rate_id, tax_name=excluded.tax_name,
         tax_rate_value=excluded.tax_rate_value, tax_amount=excluded.tax_amount, tax_inclusive=excluded.tax_inclusive,
         processed_at=excluded.processed_at, shipped_at=excluded.shipped_at, delivered_at=excluded.delivered_at,
         cancelled_at=excluded.cancelled_at, fulfillment_courier_name=excluded.fulfillment_courier_name,
         fulfillment_tracking_number=excluded.fulfillment_tracking_number, fulfillment_tracking_url=excluded.fulfillment_tracking_url,
         fulfillment_estimated_delivery_date=excluded.fulfillment_estimated_delivery_date,
         fulfillment_customer_note=excluded.fulfillment_customer_note, fulfillment_internal_note=excluded.fulfillment_internal_note,
         cancellation_reason=excluded.cancellation_reason, updated_at=excluded.updated_at`
    ).run(
      order.id, order.number, order.userId || null, order.customerName, order.customerEmail,
      order.customerPhone || null, order.customerAddress || null, order.customerCountry || null,
      order.customerLanguage || null,
      order.addressId || null, order.notes || null,
      order.status, order.paymentStatus, order.paymentMethod || null, order.paidAt || null,
      order.publicAccessTokenHash || null, order.reservation?.expiresAt || null, order.reservation?.confirmedAt || null,
      order.stockRestored ? 1 : 0, order.couponConsumed ? 1 : 0, order.couponRestored ? 1 : 0,
      order.editionsCancelled ? 1 : 0, order.currency, order.total, order.discount || 0, order.couponCode || null,
      order.shipping?.methodId || null, order.shipping?.methodName || null, order.shipping?.cost || 0,
      order.tax?.rateId || null, order.tax?.name || null, order.tax?.rateValue ?? null,
      order.tax?.amount || 0, order.tax?.inclusive ? 1 : 0,
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

  // ---------------------------------------------------------------------
  // shipping_zones / shipping_methods
  // ---------------------------------------------------------------------
  function rowToShippingZone(row) {
    if (!row) return null;
    let countries = [];
    try { countries = JSON.parse(row.countries_json || "[]"); } catch { countries = []; }
    return {
      id: row.id,
      name: row.name,
      countries,
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listShippingZones() {
    return db.prepare("SELECT * FROM shipping_zones ORDER BY sort_order ASC, created_at ASC").all().map(rowToShippingZone);
  }

  function getShippingZoneById(id) {
    return rowToShippingZone(db.prepare("SELECT * FROM shipping_zones WHERE id = ?").get(id));
  }

  function upsertShippingZone(zone) {
    db.prepare(
      `INSERT INTO shipping_zones (id, name, countries_json, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, countries_json=excluded.countries_json, active=excluded.active,
         sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    ).run(
      zone.id, zone.name, JSON.stringify(zone.countries || []), zone.active ? 1 : 0,
      zone.sortOrder || 0, zone.createdAt, zone.updatedAt || null
    );
    return getShippingZoneById(zone.id);
  }

  function deleteShippingZone(id) {
    // ON DELETE CASCADE removes its shipping_methods.
    db.prepare("DELETE FROM shipping_zones WHERE id = ?").run(id);
  }

  function rowToShippingMethod(row) {
    if (!row) return null;
    return {
      id: row.id,
      zoneId: row.zone_id,
      name: row.name,
      description: row.description || "",
      price: row.price,
      freeShippingThreshold: row.free_shipping_threshold,
      estimatedDeliveryText: row.estimated_delivery_text || "",
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      prices: listShippingMethodPrices(row.id)
    };
  }

  function listShippingMethods() {
    return db.prepare("SELECT * FROM shipping_methods ORDER BY sort_order ASC, created_at ASC").all().map(rowToShippingMethod);
  }

  function listShippingMethodsForZone(zoneId) {
    return db
      .prepare("SELECT * FROM shipping_methods WHERE zone_id = ? ORDER BY sort_order ASC, created_at ASC")
      .all(zoneId)
      .map(rowToShippingMethod);
  }

  function getShippingMethodById(id) {
    return rowToShippingMethod(db.prepare("SELECT * FROM shipping_methods WHERE id = ?").get(id));
  }

  function upsertShippingMethod(method) {
    db.prepare(
      `INSERT INTO shipping_methods (id, zone_id, name, description, price, free_shipping_threshold,
         estimated_delivery_text, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         zone_id=excluded.zone_id, name=excluded.name, description=excluded.description, price=excluded.price,
         free_shipping_threshold=excluded.free_shipping_threshold, estimated_delivery_text=excluded.estimated_delivery_text,
         active=excluded.active, sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    ).run(
      method.id, method.zoneId, method.name, method.description || null, method.price,
      method.freeShippingThreshold ?? null, method.estimatedDeliveryText || null,
      method.active ? 1 : 0, method.sortOrder || 0, method.createdAt, method.updatedAt || null
    );
    return getShippingMethodById(method.id);
  }

  function deleteShippingMethod(id) {
    db.prepare("DELETE FROM shipping_methods WHERE id = ?").run(id);
  }

  // ---------------------------------------------------------------------
  // tax_rates
  // ---------------------------------------------------------------------
  function rowToTaxRate(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      country: row.country,
      region: row.region || "",
      rate: row.rate,
      inclusive: Boolean(row.inclusive),
      priority: row.priority,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listTaxRates() {
    return db.prepare("SELECT * FROM tax_rates ORDER BY country ASC, priority DESC").all().map(rowToTaxRate);
  }

  function getTaxRateById(id) {
    return rowToTaxRate(db.prepare("SELECT * FROM tax_rates WHERE id = ?").get(id));
  }

  function upsertTaxRate(taxRate) {
    db.prepare(
      `INSERT INTO tax_rates (id, name, country, region, rate, inclusive, priority, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, country=excluded.country, region=excluded.region, rate=excluded.rate,
         inclusive=excluded.inclusive, priority=excluded.priority, active=excluded.active, updated_at=excluded.updated_at`
    ).run(
      taxRate.id, taxRate.name, taxRate.country, taxRate.region || null, taxRate.rate,
      taxRate.inclusive ? 1 : 0, taxRate.priority || 0, taxRate.active ? 1 : 0,
      taxRate.createdAt, taxRate.updatedAt || null
    );
    return getTaxRateById(taxRate.id);
  }

  function deleteTaxRate(id) {
    db.prepare("DELETE FROM tax_rates WHERE id = ?").run(id);
  }

  function rowToTag(row) {
    if (!row) return null;
    return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at };
  }

  function listTags() {
    return db.prepare("SELECT * FROM tags ORDER BY name ASC").all().map(rowToTag);
  }

  function getTagById(id) {
    return rowToTag(db.prepare("SELECT * FROM tags WHERE id = ?").get(id));
  }

  function getTagBySlug(slug) {
    return rowToTag(db.prepare("SELECT * FROM tags WHERE slug = ?").get(slug));
  }

  function insertTag(tag) {
    db.prepare("INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)")
      .run(tag.id, tag.name, tag.slug, tag.createdAt);
    return getTagById(tag.id);
  }

  function renameTag(id, name, slug) {
    db.prepare("UPDATE tags SET name = ?, slug = ? WHERE id = ?").run(name, slug, id);
    return getTagById(id);
  }

  function deleteTag(id) {
    db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  }

  // Every product row's own tag list - joined per-product rather than
  // batched, same tradeoff replaceProductVariants already makes (fine at
  // this catalog's scale, not worth a join+group-by for v1).
  function getTagsForProduct(productId) {
    return db.prepare(
      `SELECT t.* FROM tags t
       JOIN product_tags pt ON pt.tag_id = t.id
       WHERE pt.product_id = ?
       ORDER BY t.name ASC`
    ).all(productId).map(rowToTag);
  }

  // Full-replace, not incremental add/remove - same "wholesale replace on
  // save" convention as replaceProductVariants. Silently dedupes; the
  // caller (sanitizeProduct) is responsible for dropping ids that don't
  // correspond to a real tag before this ever runs.
  function setProductTags(productId, tagIds) {
    db.prepare("DELETE FROM product_tags WHERE product_id = ?").run(productId);
    const insert = db.prepare("INSERT INTO product_tags (product_id, tag_id) VALUES (?,?)");
    [...new Set(tagIds)].forEach((tagId) => insert.run(productId, tagId));
  }

  function listProductIdsForTag(tagId) {
    return db.prepare("SELECT product_id FROM product_tags WHERE tag_id = ?").all(tagId).map((row) => row.product_id);
  }

  function rowToEmailTemplate(row) {
    if (!row) return null;
    return {
      id: row.id,
      languageCode: row.language_code,
      name: row.name,
      subject: row.subject,
      body: row.body,
      active: Boolean(row.active),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
  }

  function getDefaultLanguageCode() {
    const row = db.prepare("SELECT code FROM languages WHERE is_default = 1 LIMIT 1").get();
    return row ? row.code : "en";
  }

  function getDefaultCurrencyCode() {
    const row = db.prepare("SELECT code FROM currencies WHERE is_default = 1 LIMIT 1").get();
    return row ? row.code : "GBP";
  }

  // languageCode omitted => every caller from before templates had a
  // language dimension keeps working unchanged, scoped to the default
  // language (which is also what the v5 migration backfilled every
  // pre-existing row under, so this is a no-op in practice until a second
  // language's templates actually exist).
  function listEmailTemplates(languageCode) {
    const lang = languageCode || getDefaultLanguageCode();
    return db.prepare("SELECT * FROM email_templates WHERE language_code = ? ORDER BY id ASC").all(lang).map(rowToEmailTemplate);
  }

  function getEmailTemplate(id, languageCode) {
    const lang = languageCode || getDefaultLanguageCode();
    return rowToEmailTemplate(db.prepare("SELECT * FROM email_templates WHERE id = ? AND language_code = ?").get(id, lang));
  }

  // id is always one of the fixed, code-defined template slugs (server.js's
  // EMAIL_TEMPLATE_DEFS) - never admin-supplied, so no slug/uniqueness
  // validation is needed here the way tags need one.
  function upsertEmailTemplate(template) {
    const lang = template.languageCode || getDefaultLanguageCode();
    db.prepare(
      `INSERT INTO email_templates (id, language_code, name, subject, body, active, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id, language_code) DO UPDATE SET
         name=excluded.name, subject=excluded.subject, body=excluded.body,
         active=excluded.active, updated_at=excluded.updated_at, updated_by=excluded.updated_by`
    ).run(
      template.id, lang, template.name, template.subject, template.body,
      template.active ? 1 : 0, template.updatedAt, template.updatedBy || null
    );
    return getEmailTemplate(template.id, lang);
  }

  // ---------------------------------------------------------------------
  // languages / currencies / country_config
  // ---------------------------------------------------------------------
  function rowToLanguage(row) {
    if (!row) return null;
    return {
      code: row.code,
      name: row.name,
      nativeName: row.native_name,
      active: Boolean(row.active),
      isDefault: Boolean(row.is_default),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Returns every row (active or not) - callers that only want what a
  // visitor can pick filter on .active themselves, same convention as
  // listShippingZones()/the public checkout-options route above.
  function listLanguages() {
    return db.prepare("SELECT * FROM languages ORDER BY sort_order ASC, code ASC").all().map(rowToLanguage);
  }

  function getLanguageByCode(code) {
    return rowToLanguage(db.prepare("SELECT * FROM languages WHERE code = ?").get(code));
  }

  // code is admin-supplied (an ISO 639-1 code, e.g. "en"), not a generated
  // id, so this is a genuine upsert keyed on the natural key. Like
  // setProductTags below, this does NOT open its own transaction - callers
  // (server.js's admin routes) wrap mutations in withStockLock(() =>
  // db.withTransaction(...)) themselves, same convention as every other
  // multi-statement write in this file. Clearing the old default first is
  // what makes idx_languages_one_default satisfiable when isDefault is
  // true - without it, the second row would collide with the still-default
  // first one and the partial unique index would reject the upsert.
  function upsertLanguage(language) {
    if (language.isDefault) {
      db.prepare("UPDATE languages SET is_default = 0 WHERE is_default = 1 AND code != ?").run(language.code);
    }
    db.prepare(
      `INSERT INTO languages (code, name, native_name, active, is_default, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET
         name=excluded.name, native_name=excluded.native_name, active=excluded.active,
         is_default=excluded.is_default, sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    ).run(
      language.code, language.name, language.nativeName, language.active ? 1 : 0,
      language.isDefault ? 1 : 0, language.sortOrder || 0, language.createdAt, language.updatedAt || null
    );
    return getLanguageByCode(language.code);
  }

  function deleteLanguage(code) {
    db.prepare("DELETE FROM languages WHERE code = ?").run(code);
  }

  function rowToCurrency(row) {
    if (!row) return null;
    return {
      code: row.code,
      symbol: row.symbol,
      decimalPlaces: row.decimal_places,
      symbolPosition: row.symbol_position,
      isDefault: Boolean(row.is_default),
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listCurrencies() {
    return db.prepare("SELECT * FROM currencies ORDER BY sort_order ASC, code ASC").all().map(rowToCurrency);
  }

  function getCurrencyByCode(code) {
    return rowToCurrency(db.prepare("SELECT * FROM currencies WHERE code = ?").get(code));
  }

  // Same "clear the old default first" reasoning as upsertLanguage above -
  // required for idx_currencies_one_default to accept the new default.
  function upsertCurrency(currency) {
    if (currency.isDefault) {
      db.prepare("UPDATE currencies SET is_default = 0 WHERE is_default = 1 AND code != ?").run(currency.code);
    }
    db.prepare(
      `INSERT INTO currencies (code, symbol, decimal_places, symbol_position, is_default, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET
         symbol=excluded.symbol, decimal_places=excluded.decimal_places, symbol_position=excluded.symbol_position,
         is_default=excluded.is_default, active=excluded.active, sort_order=excluded.sort_order, updated_at=excluded.updated_at`
    ).run(
      currency.code, currency.symbol, currency.decimalPlaces ?? 2, currency.symbolPosition || "before",
      currency.isDefault ? 1 : 0, currency.active ? 1 : 0, currency.sortOrder || 0,
      currency.createdAt, currency.updatedAt || null
    );
    return getCurrencyByCode(currency.code);
  }

  function deleteCurrency(code) {
    db.prepare("DELETE FROM currencies WHERE code = ?").run(code);
  }

  function rowToCountryConfig(row) {
    if (!row) return null;
    return {
      countryCode: row.country_code,
      languageCode: row.language_code,
      currencyCode: row.currency_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listCountryConfig() {
    return db.prepare("SELECT * FROM country_config ORDER BY country_code ASC").all().map(rowToCountryConfig);
  }

  function getCountryConfig(countryCode) {
    return rowToCountryConfig(db.prepare("SELECT * FROM country_config WHERE country_code = ?").get(countryCode));
  }

  function upsertCountryConfig(config) {
    db.prepare(
      `INSERT INTO country_config (country_code, language_code, currency_code, created_at, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(country_code) DO UPDATE SET
         language_code=excluded.language_code, currency_code=excluded.currency_code, updated_at=excluded.updated_at`
    ).run(config.countryCode, config.languageCode, config.currencyCode, config.createdAt, config.updatedAt || null);
    return getCountryConfig(config.countryCode);
  }

  function deleteCountryConfig(countryCode) {
    db.prepare("DELETE FROM country_config WHERE country_code = ?").run(countryCode);
  }

  function rowToProductPrice(row) {
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      countryCode: row.country_code,
      currencyCode: row.currency_code,
      price: row.price,
      compareAtPrice: row.compare_at_price,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listProductPrices(productId) {
    return db.prepare("SELECT * FROM product_prices WHERE product_id = ? ORDER BY country_code ASC").all(productId).map(rowToProductPrice);
  }

  function getProductPrice(productId, countryCode) {
    return rowToProductPrice(
      db.prepare("SELECT * FROM product_prices WHERE product_id = ? AND country_code = ?").get(productId, countryCode)
    );
  }

  function upsertProductPrice(entry) {
    db.prepare(
      `INSERT INTO product_prices (id, product_id, country_code, currency_code, price, compare_at_price, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(product_id, country_code) DO UPDATE SET
         currency_code=excluded.currency_code, price=excluded.price, compare_at_price=excluded.compare_at_price,
         active=excluded.active, updated_at=excluded.updated_at`
    ).run(
      entry.id, entry.productId, entry.countryCode, entry.currencyCode, entry.price, entry.compareAtPrice ?? null,
      entry.active !== false ? 1 : 0, entry.createdAt, entry.updatedAt || null
    );
    return getProductPrice(entry.productId, entry.countryCode);
  }

  function deleteProductPrice(productId, countryCode) {
    db.prepare("DELETE FROM product_prices WHERE product_id = ? AND country_code = ?").run(productId, countryCode);
  }

  // Wholesale replace on save - same "delete everything for this parent,
  // re-insert the submitted set" convention as setProductTags, used by the
  // admin's per-product price editor (one row per country, submitted as a
  // full set each time rather than incremental add/remove calls).
  function replaceProductPrices(productId, entries) {
    db.prepare("DELETE FROM product_prices WHERE product_id = ?").run(productId);
    const insert = db.prepare(
      `INSERT INTO product_prices (id, product_id, country_code, currency_code, price, compare_at_price, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    entries.forEach((entry) => {
      insert.run(
        entry.id, productId, entry.countryCode, entry.currencyCode, entry.price, entry.compareAtPrice ?? null,
        entry.active !== false ? 1 : 0, entry.createdAt, entry.updatedAt || null
      );
    });
    return listProductPrices(productId);
  }

  function rowToShippingMethodPrice(row) {
    if (!row) return null;
    return {
      id: row.id,
      shippingMethodId: row.shipping_method_id,
      countryCode: row.country_code,
      currencyCode: row.currency_code,
      price: row.price,
      freeShippingThreshold: row.free_shipping_threshold,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listShippingMethodPrices(shippingMethodId) {
    return db.prepare("SELECT * FROM shipping_method_prices WHERE shipping_method_id = ? ORDER BY country_code ASC")
      .all(shippingMethodId).map(rowToShippingMethodPrice);
  }

  function getShippingMethodPrice(shippingMethodId, countryCode) {
    return rowToShippingMethodPrice(
      db.prepare("SELECT * FROM shipping_method_prices WHERE shipping_method_id = ? AND country_code = ?").get(shippingMethodId, countryCode)
    );
  }

  function replaceShippingMethodPrices(shippingMethodId, entries) {
    db.prepare("DELETE FROM shipping_method_prices WHERE shipping_method_id = ?").run(shippingMethodId);
    const insert = db.prepare(
      `INSERT INTO shipping_method_prices (id, shipping_method_id, country_code, currency_code, price, free_shipping_threshold, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    entries.forEach((entry) => {
      insert.run(
        entry.id, shippingMethodId, entry.countryCode, entry.currencyCode, entry.price, entry.freeShippingThreshold ?? null,
        entry.active !== false ? 1 : 0, entry.createdAt, entry.updatedAt || null
      );
    });
    return listShippingMethodPrices(shippingMethodId);
  }

  // Guards country_config deletion: product_prices/shipping_method_prices
  // both REFERENCE country_config(country_code) with foreign_keys=ON, so an
  // in-use deletion would otherwise fail with a raw SQLite FK error instead
  // of a clear admin-facing message.
  function countryConfigInUse(countryCode) {
    const priceRow = db.prepare("SELECT 1 FROM product_prices WHERE country_code = ? LIMIT 1").get(countryCode);
    if (priceRow) return true;
    const shippingRow = db.prepare("SELECT 1 FROM shipping_method_prices WHERE country_code = ? LIMIT 1").get(countryCode);
    return Boolean(shippingRow);
  }

  // ---------------------------------------------------------------------
  // translations - an OPTIONAL override layer on top of locale.js's/
  // script.js's hardcoded EN/RO dictionaries, not a migration target for
  // them (see the CREATE TABLE comment above). A row here wins when
  // present; any gap falls through to the code-defined baseline.
  // ---------------------------------------------------------------------
  function rowToTranslation(row) {
    if (!row) return null;
    return {
      id: row.id,
      key: row.key,
      languageCode: row.language_code,
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // languageCode omitted => every override row across every language
  // (the admin management view); passed => just that language's overrides
  // (what a storefront page fetches to build its fallback chain).
  function listTranslations(languageCode) {
    if (languageCode) {
      return db.prepare("SELECT * FROM translations WHERE language_code = ? ORDER BY key ASC").all(languageCode).map(rowToTranslation);
    }
    return db.prepare("SELECT * FROM translations ORDER BY language_code ASC, key ASC").all().map(rowToTranslation);
  }

  function getTranslation(key, languageCode) {
    return rowToTranslation(db.prepare("SELECT * FROM translations WHERE key = ? AND language_code = ?").get(key, languageCode));
  }

  function upsertTranslation(entry) {
    db.prepare(
      `INSERT INTO translations (id, key, language_code, value, created_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(key, language_code) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    ).run(entry.id, entry.key, entry.languageCode, entry.value, entry.createdAt, entry.updatedAt || null);
    return getTranslation(entry.key, entry.languageCode);
  }

  function deleteTranslation(key, languageCode) {
    db.prepare("DELETE FROM translations WHERE key = ? AND language_code = ?").run(key, languageCode);
  }

  // ---------------------------------------------------------------------
  // product_translations - replaces products.name_ro/name_en/description_ro/
  // description_en going forward (those columns stay, unused - see the
  // CREATE TABLE comment above). Wholesale-replace on save, same convention
  // as setProductTags/replaceProductPrices - the admin form submits the
  // complete current set of per-language blocks each time.
  // ---------------------------------------------------------------------
  function rowToProductTranslation(row) {
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      languageCode: row.language_code,
      name: row.name || "",
      description: row.description || "",
      shortDescription: row.short_description || "",
      seoTitle: row.seo_title || "",
      seoDescription: row.seo_description || "",
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listProductTranslations(productId) {
    return db.prepare("SELECT * FROM product_translations WHERE product_id = ? ORDER BY language_code ASC")
      .all(productId).map(rowToProductTranslation);
  }

  function getProductTranslation(productId, languageCode) {
    return rowToProductTranslation(
      db.prepare("SELECT * FROM product_translations WHERE product_id = ? AND language_code = ?").get(productId, languageCode)
    );
  }

  function replaceProductTranslations(productId, entries) {
    db.prepare("DELETE FROM product_translations WHERE product_id = ?").run(productId);
    const insert = db.prepare(
      `INSERT INTO product_translations (id, product_id, language_code, name, description, short_description, seo_title, seo_description, metadata_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    entries.forEach((entry) => {
      insert.run(
        entry.id, productId, entry.languageCode, entry.name || null, entry.description || null,
        entry.shortDescription || null, entry.seoTitle || null, entry.seoDescription || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null, entry.createdAt, entry.updatedAt || null
      );
    });
    return listProductTranslations(productId);
  }

  // ---------------------------------------------------------------------
  // categories / category_translations - normalizes products.category
  // (free text) the same way tags normalized out of a comma-separated
  // string. products.category itself stays the admin-facing free-text
  // field; the server resolves-or-creates a row here underneath it.
  // ---------------------------------------------------------------------
  function rowToCategory(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      defaultName: row.default_name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      translations: listCategoryTranslations(row.id)
    };
  }

  function listCategories() {
    return db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, default_name ASC").all().map(rowToCategory);
  }

  function getCategoryById(id) {
    return rowToCategory(db.prepare("SELECT * FROM categories WHERE id = ?").get(id));
  }

  function getCategoryBySlug(slug) {
    return rowToCategory(db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug));
  }

  // slug is computed by the caller (server.js's toSlug), not duplicated
  // here, matching how tags' name->slug resolution already works. Looks up
  // by slug first so re-resolving the same category name is idempotent
  // rather than accumulating duplicate rows.
  function resolveOrCreateCategory(name, slug) {
    const existing = getCategoryBySlug(slug);
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO categories (id, slug, default_name, sort_order, created_at) VALUES (?,?,?,0,?)"
    ).run(id, slug, name, now);
    return getCategoryById(id);
  }

  function updateCategory(id, patch) {
    const current = getCategoryById(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
    db.prepare("UPDATE categories SET default_name=?, sort_order=?, updated_at=? WHERE id=?")
      .run(next.defaultName, next.sortOrder, next.updatedAt, id);
    return getCategoryById(id);
  }

  function deleteCategory(id) {
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }

  function rowToCategoryTranslation(row) {
    if (!row) return null;
    return {
      id: row.id,
      categoryId: row.category_id,
      languageCode: row.language_code,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listCategoryTranslations(categoryId) {
    return db.prepare("SELECT * FROM category_translations WHERE category_id = ? ORDER BY language_code ASC")
      .all(categoryId).map(rowToCategoryTranslation);
  }

  function replaceCategoryTranslations(categoryId, entries) {
    db.prepare("DELETE FROM category_translations WHERE category_id = ?").run(categoryId);
    const insert = db.prepare(
      "INSERT INTO category_translations (id, category_id, language_code, name, created_at, updated_at) VALUES (?,?,?,?,?,?)"
    );
    entries.forEach((entry) => {
      insert.run(entry.id, categoryId, entry.languageCode, entry.name, entry.createdAt, entry.updatedAt || null);
    });
    return listCategoryTranslations(categoryId);
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
    getEmailLog,
    listShippingZones,
    getShippingZoneById,
    upsertShippingZone,
    deleteShippingZone,
    listShippingMethods,
    listShippingMethodsForZone,
    getShippingMethodById,
    upsertShippingMethod,
    deleteShippingMethod,
    listTaxRates,
    getTaxRateById,
    upsertTaxRate,
    deleteTaxRate,
    listTags,
    getTagById,
    getTagBySlug,
    insertTag,
    renameTag,
    deleteTag,
    getTagsForProduct,
    setProductTags,
    listProductIdsForTag,
    listEmailTemplates,
    getEmailTemplate,
    upsertEmailTemplate,
    getDefaultLanguageCode,
    getDefaultCurrencyCode,
    listLanguages,
    getLanguageByCode,
    upsertLanguage,
    deleteLanguage,
    listCurrencies,
    getCurrencyByCode,
    upsertCurrency,
    deleteCurrency,
    listCountryConfig,
    getCountryConfig,
    upsertCountryConfig,
    deleteCountryConfig,
    countryConfigInUse,
    listProductPrices,
    getProductPrice,
    upsertProductPrice,
    deleteProductPrice,
    replaceProductPrices,
    listShippingMethodPrices,
    getShippingMethodPrice,
    replaceShippingMethodPrices,
    listTranslations,
    getTranslation,
    upsertTranslation,
    deleteTranslation,
    listProductTranslations,
    getProductTranslation,
    replaceProductTranslations,
    listCategories,
    getCategoryById,
    getCategoryBySlug,
    resolveOrCreateCategory,
    updateCategory,
    deleteCategory,
    listCategoryTranslations,
    replaceCategoryTranslations
  };
}

module.exports = { createDb, SCHEMA_SQL, CURRENT_SCHEMA_VERSION };
