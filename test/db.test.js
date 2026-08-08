const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createDb } = require("../lib/db");

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-db-test-"));
  return path.join(dir, "test.db");
}

function seedUser(db, overrides = {}) {
  const user = {
    id: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    name: "Test User",
    role: "client",
    password_hash: "salt:hash",
    email_verified: 1,
    is_primary_admin: 0,
    created_at: new Date().toISOString(),
    updated_at: null,
    ...overrides
  };
  db.raw
    .prepare(
      `INSERT INTO users (id, email, name, role, password_hash, email_verified, is_primary_admin, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      user.id, user.email, user.name, user.role, user.password_hash,
      user.email_verified, user.is_primary_admin, user.created_at, user.updated_at
    );
  return user;
}

function seedProduct(db, overrides = {}) {
  const product = {
    id: `prod-${Math.random().toString(36).slice(2)}`,
    slug: `slug-${Math.random().toString(36).slice(2)}`,
    name: "Test Tee",
    status: "live",
    price: 59,
    currency: "GBP",
    created_at: new Date().toISOString(),
    ...overrides
  };
  db.raw
    .prepare(
      `INSERT INTO products (id, slug, name, status, price, currency, created_at)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(product.id, product.slug, product.name, product.status, product.price, product.currency, product.created_at);
  return product;
}

test("createDb applies schema and is safe to reopen (idempotent CREATE IF NOT EXISTS)", () => {
  const dbPath = tempDbPath();
  const first = createDb({ dbPath });
  const tables = first.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("orders"));
  assert.ok(tables.includes("order_items"));
  assert.ok(tables.includes("order_status_history"));
  assert.ok(tables.includes("payments"));
  assert.ok(tables.includes("email_logs"));
  assert.ok(tables.includes("sessions"));
  assert.ok(tables.includes("editions"));
  first.close();

  // Reopening an existing file must not throw and must not wipe data.
  const second = createDb({ dbPath });
  seedUser(second);
  second.close();
  const third = createDb({ dbPath });
  const count = third.raw.prepare("SELECT COUNT(*) AS n FROM users").get();
  assert.equal(count.n, 1);
  third.close();
});

test("PRAGMA quick_check passes on a freshly created db", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const integrity = db.raw.prepare("PRAGMA quick_check").get();
  assert.equal(Object.values(integrity)[0], "ok");
  db.close();
});

test("createDb throws a clear DB_CORRUPT error on a garbage file, never silently starts empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-db-corrupt-"));
  const dbPath = path.join(dir, "corrupt.db");
  fs.writeFileSync(dbPath, "this is not a sqlite file, just noise ".repeat(50));
  assert.throws(() => createDb({ dbPath }));
});

test("withTransaction commits on success", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.withTransaction(() => {
    seedUser(db, { id: "u1", email: "u1@example.com" });
  });
  const row = db.raw.prepare("SELECT * FROM users WHERE id = ?").get("u1");
  assert.ok(row);
  assert.equal(row.email, "u1@example.com");
  db.close();
});

test("withTransaction rolls back completely on a thrown error (atomicity)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const product = seedProduct(db, { id: "p1" });
  db.raw
    .prepare("INSERT INTO product_variants (id, product_id, size, stock, created_at) VALUES (?,?,?,?,?)")
    .run("v1", product.id, "M", 10, new Date().toISOString());

  assert.throws(() => {
    db.withTransaction(() => {
      // Simulates a checkout: decrement stock, then insert an order, then
      // hit a validation error before the order_items insert - none of this
      // partial work should survive.
      db.raw.prepare("UPDATE product_variants SET stock = stock - 1 WHERE id = ?").run("v1");
      db.raw
        .prepare(
          `INSERT INTO orders (id, number, customer_name, customer_email, status, payment_status, currency, total, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run("o1", "BC-0001", "Buyer", "buyer@example.com", "confirmed", "unpaid", "GBP", 59, new Date().toISOString());
      throw new Error("simulated failure before order_items insert");
    });
  }, /simulated failure/);

  const variant = db.raw.prepare("SELECT stock FROM product_variants WHERE id = ?").get("v1");
  assert.equal(variant.stock, 10, "stock decrement must have been rolled back");
  const order = db.raw.prepare("SELECT * FROM orders WHERE id = ?").get("o1");
  assert.equal(order, undefined, "partially-created order must have been rolled back");
  db.close();
});

test("withTransaction refuses to nest and leaves the connection usable afterward", () => {
  const db = createDb({ dbPath: tempDbPath() });
  assert.throws(() => {
    db.withTransaction(() => {
      db.withTransaction(() => {});
    });
  });
  // Connection must still work for a normal transaction after the failed nesting attempt.
  db.withTransaction(() => {
    seedUser(db, { id: "u-after-nest-failure", email: "after@example.com" });
  });
  const row = db.raw.prepare("SELECT * FROM users WHERE id = ?").get("u-after-nest-failure");
  assert.ok(row);
  db.close();
});

test("foreign_keys enforcement: inserting a variant for a nonexistent product fails", () => {
  const db = createDb({ dbPath: tempDbPath() });
  assert.throws(() => {
    db.raw
      .prepare("INSERT INTO product_variants (id, product_id, size, stock, created_at) VALUES (?,?,?,?,?)")
      .run("v-orphan", "does-not-exist", "M", 1, new Date().toISOString());
  });
  db.close();
});

test("deleting a product cascades to its variants (ON DELETE CASCADE)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const product = seedProduct(db, { id: "p-cascade" });
  db.raw
    .prepare("INSERT INTO product_variants (id, product_id, size, stock, created_at) VALUES (?,?,?,?,?)")
    .run("v-cascade", product.id, "M", 5, new Date().toISOString());
  db.raw.prepare("DELETE FROM products WHERE id = ?").run(product.id);
  const remaining = db.raw.prepare("SELECT * FROM product_variants WHERE id = ?").get("v-cascade");
  assert.equal(remaining, undefined);
  db.close();
});

test("editions: AUTOINCREMENT after an explicit high id continues above it, never reuses it", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  // Simulates the migration script inserting historical editions with their
  // real, pre-existing numeric ids (these are public /archive/<id> URLs and
  // must never be renumbered or collide with a future INSERT).
  db.raw
    .prepare(
      `INSERT INTO editions (id, product_name, size, number, total, status, assigned_at)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(500, "Test Tee", "M", 1, 100, "active", now);

  db.raw
    .prepare(
      `INSERT INTO editions (product_name, size, number, total, status, assigned_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run("Test Tee", "M", 2, 100, "active", now);

  const newest = db.raw.prepare("SELECT id FROM editions ORDER BY id DESC LIMIT 1").get();
  assert.equal(newest.id, 501, "auto-assigned id must be strictly greater than the largest id ever inserted");
  db.close();
});

test("email_logs dedupe query: hasEmailLogFor pattern (order_id, status) finds only matching rows", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO orders (id, number, customer_name, customer_email, status, payment_status, currency, total, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run("order-1", "BC-0001", "Buyer", "buyer@example.com", "shipped", "paid", "GBP", 59, now);
  db.raw
    .prepare("INSERT INTO email_logs (order_id, status, sent_at, ok) VALUES (?,?,?,?)")
    .run("order-1", "shipped", now, 1);

  const found = db.raw
    .prepare("SELECT * FROM email_logs WHERE order_id = ? AND status = ? AND ok = 1")
    .get("order-1", "shipped");
  assert.ok(found, "existing send for this (order, status) must be found");

  const notFound = db.raw
    .prepare("SELECT * FROM email_logs WHERE order_id = ? AND status = ? AND ok = 1")
    .get("order-1", "delivered");
  assert.equal(notFound, undefined, "a different status must not match");
  db.close();
});

test("checkpoint() and close() do not throw on a normal database", () => {
  const db = createDb({ dbPath: tempDbPath() });
  seedUser(db);
  assert.doesNotThrow(() => db.checkpoint());
  assert.doesNotThrow(() => db.close());
});

// ---------------------------------------------------------------------
// users
// ---------------------------------------------------------------------

test("insertUser + getUserById/ByEmail round-trip in the createUserRecord() shape", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  const inserted = db.insertUser({
    id: "u1", email: "alex@example.com", name: "Alex", role: "client",
    passwordHash: "salt:hash", emailVerified: false, isPrimaryAdmin: false, createdAt: now
  });
  assert.equal(inserted.id, "u1");
  assert.equal(inserted.emailVerified, false);

  const byId = db.getUserById("u1");
  const byEmail = db.getUserByEmail("alex@example.com");
  assert.deepEqual(byId, inserted);
  assert.deepEqual(byEmail, inserted);
  assert.equal(db.getUserById("missing"), null);
  assert.equal(db.getUserByEmail("missing@example.com"), null);
  db.close();
});

test("insertUser upserts on id (migration re-run safety), not just first-write", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: now });
  db.insertUser({ id: "u1", email: "a@example.com", name: "Updated Name", role: "admin", passwordHash: "y", createdAt: now });

  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1, "must not create a duplicate row");
  const row = db.getUserById("u1");
  assert.equal(row.name, "Updated Name");
  assert.equal(row.role, "admin");
  db.close();
});

test("updateUser shallow-merges a patch and bumps updatedAt", async () => {
  const db = createDb({ dbPath: tempDbPath() });
  const created = db.insertUser({
    id: "u1", email: "a@example.com", name: "A", role: "client",
    passwordHash: "salt:hash", emailVerified: false, isPrimaryAdmin: false, createdAt: new Date().toISOString()
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = db.updateUser("u1", { name: "New Name", emailVerified: true });
  assert.equal(updated.name, "New Name");
  assert.equal(updated.emailVerified, true);
  assert.equal(updated.email, "a@example.com", "fields not in the patch must survive unchanged");
  assert.notEqual(updated.updatedAt, created.updatedAt);
  assert.equal(db.updateUser("does-not-exist", { name: "x" }), null);
  db.close();
});

test("emailInUse respects the excludeUserId used by the profile-update route", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "taken@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  assert.equal(db.emailInUse("taken@example.com"), true);
  assert.equal(db.emailInUse("taken@example.com", "u1"), false, "a user checking against their own current email must not count as taken");
  assert.equal(db.emailInUse("taken@example.com", "someone-else"), true);
  assert.equal(db.emailInUse("free@example.com"), false);
  db.close();
});

test("countUsers reports total and client-only counts (admin summary route)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "admin", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertUser({ id: "u2", email: "b@example.com", name: "B", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertUser({ id: "u3", email: "c@example.com", name: "C", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  assert.deepEqual(db.countUsers(), { total: 3, clients: 2 });
  db.close();
});

test("anyAdminHasPrimaryFlag / oldestAdminUser back the primary-admin bootstrap logic", () => {
  const db = createDb({ dbPath: tempDbPath() });
  assert.equal(db.anyAdminHasPrimaryFlag(), false);
  db.insertUser({ id: "admin-old", email: "old@example.com", name: "Old", role: "admin", passwordHash: "x", createdAt: "2026-01-01T00:00:00.000Z" });
  db.insertUser({ id: "admin-new", email: "new@example.com", name: "New", role: "admin", passwordHash: "x", createdAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(db.oldestAdminUser().id, "admin-old");
  assert.equal(db.anyAdminHasPrimaryFlag(), false);
  db.updateUser("admin-old", { isPrimaryAdmin: true });
  assert.equal(db.anyAdminHasPrimaryFlag(), true);
  db.close();
});

// ---------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------

test("insertSession + getSessionWithUser returns the {id, user} shape getSession() always returned", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const user = db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertSession("sess1", "u1", Date.now() + 100000, new Date().toISOString());

  const session = db.getSessionWithUser("sess1");
  assert.equal(session.id, "sess1");
  assert.deepEqual(session.user, user);
  assert.equal(db.getSessionWithUser("missing"), null);
  db.close();
});

test("getSessionWithUser deletes and returns null for an expired session", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertSession("sess-expired", "u1", Date.now() - 1000, new Date().toISOString());

  assert.equal(db.getSessionWithUser("sess-expired"), null);
  const row = db.raw.prepare("SELECT * FROM sessions WHERE id = ?").get("sess-expired");
  assert.equal(row, undefined, "expired session must be deleted, matching getSession()'s existing behavior");
  db.close();
});

test("deleteSession removes exactly the one session (logout)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertSession("s1", "u1", Date.now() + 100000, new Date().toISOString());
  db.insertSession("s2", "u1", Date.now() + 100000, new Date().toISOString());
  db.deleteSession("s1");
  assert.equal(db.getSessionWithUser("s1"), null);
  assert.ok(db.getSessionWithUser("s2"));
  db.close();
});

test("deleteOtherSessionsForUser keeps only the given session; null keeps none (logout-everywhere)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.insertSession("keep", "u1", Date.now() + 100000, new Date().toISOString());
  db.insertSession("drop1", "u1", Date.now() + 100000, new Date().toISOString());
  db.insertSession("drop2", "u1", Date.now() + 100000, new Date().toISOString());

  db.deleteOtherSessionsForUser("u1", "keep");
  assert.ok(db.getSessionWithUser("keep"));
  assert.equal(db.getSessionWithUser("drop1"), null);
  assert.equal(db.getSessionWithUser("drop2"), null);

  db.insertSession("also-drop", "u1", Date.now() + 100000, new Date().toISOString());
  db.deleteOtherSessionsForUser("u1", null);
  assert.equal(db.getSessionWithUser("keep"), null);
  assert.equal(db.getSessionWithUser("also-drop"), null);
  db.close();
});

test("deleteExpiredSessions sweeps only expired rows and reports how many (maintenance sweep)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  const now = Date.now();
  db.insertSession("live", "u1", now + 100000, new Date().toISOString());
  db.insertSession("dead1", "u1", now - 1000, new Date().toISOString());
  db.insertSession("dead2", "u1", now - 2000, new Date().toISOString());

  const removed = db.deleteExpiredSessions(now);
  assert.equal(removed, 2);
  assert.ok(db.raw.prepare("SELECT * FROM sessions WHERE id = ?").get("live"));
  assert.equal(db.raw.prepare("SELECT * FROM sessions WHERE id = ?").get("dead1"), undefined);
  db.close();
});

// ---------------------------------------------------------------------
// products / product_variants
// ---------------------------------------------------------------------

test("upsertProduct with a sizeStock map creates one variant row per size, sizes ordered, stock summed", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  const inserted = db.upsertProduct({
    id: "p1", slug: "test-tee", name: "Test Tee", status: "live", price: 59, currency: "GBP",
    sizeStock: { S: 2, M: 5, L: 0 }, sizes: ["S", "M", "L"], createdAt: now, updatedAt: now
  });

  assert.equal(inserted.stock, 7, "stock must be the sum across all sizes");
  assert.deepEqual(inserted.sizeStock, { S: 2, M: 5, L: 0 });
  assert.deepEqual(inserted.sizes, ["S", "M", "L"]);

  const fetched = db.getProductById("p1");
  assert.deepEqual(fetched, inserted);
  const bySlug = db.getProductBySlugOrId("test-tee");
  assert.deepEqual(bySlug, inserted);
  db.close();
});

test("upsertProduct without sizeStock (sizeless product) stores one blank-size variant and round-trips as sizeStock=undefined", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({
    id: "p1", slug: "one-size", name: "Tote Bag", status: "live", price: 25, currency: "GBP",
    stock: 12, sizeStock: undefined, sizes: [], createdAt: now, updatedAt: now
  });

  const fetched = db.getProductById("p1");
  assert.equal(fetched.stock, 12);
  assert.equal(fetched.sizeStock, undefined, "a sizeless product must round-trip with no sizeStock map, matching sanitizeProduct()'s shape");
  assert.deepEqual(fetched.sizes, []);

  const variantRows = db.raw.prepare("SELECT * FROM product_variants WHERE product_id = ?").all("p1");
  assert.equal(variantRows.length, 1, "exactly one placeholder variant row backs a sizeless product");
  assert.equal(variantRows[0].size, "");
  db.close();
});

test("upsertProduct on an existing id replaces its variants instead of accumulating them", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s", name: "N", status: "live", price: 10, currency: "GBP", sizeStock: { S: 1, M: 1 }, createdAt: now });
  db.upsertProduct({ id: "p1", slug: "s", name: "N", status: "live", price: 10, currency: "GBP", sizeStock: { M: 3, L: 4 }, createdAt: now, updatedAt: now });

  const fetched = db.getProductById("p1");
  assert.deepEqual(fetched.sizeStock, { M: 3, L: 4 }, "old sizes (S) must be gone, not merged");
  assert.equal(fetched.stock, 7);
  db.close();
});

test("upsertProduct preserves the studio (3D config) blob through a round-trip", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const studio = { model: "assets/models/tshirt-web.glb", print: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, textureUrl: "", shirtColor: "#ffffff" };
  db.upsertProduct({ id: "p1", slug: "s", name: "N", status: "draft", price: 0, currency: "GBP", stock: 0, studio, createdAt: new Date().toISOString() });
  assert.deepEqual(db.getProductById("p1").studio, studio);
  db.close();
});

test("updateProduct shallow-merges a patch without touching variants (scene-image route)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s", name: "N", status: "live", price: 10, currency: "GBP", sizeStock: { M: 5 }, createdAt: now });
  const updated = db.updateProduct("p1", { imageUrl: "assets/products/new.png", sceneImageUrl: "assets/products/new.png" });
  assert.equal(updated.imageUrl, "assets/products/new.png");
  assert.deepEqual(updated.sizeStock, { M: 5 }, "fields not in the patch, including variants, must survive unchanged");
  assert.equal(db.updateProduct("missing", { imageUrl: "x" }), null);
  db.close();
});

test("deleteProduct removes the product and cascades to its variants", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.upsertProduct({ id: "p1", slug: "s", name: "N", status: "live", price: 10, currency: "GBP", sizeStock: { M: 5 }, createdAt: new Date().toISOString() });
  db.deleteProduct("p1");
  assert.equal(db.getProductById("p1"), null);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?").get("p1").n, 0);
  db.close();
});

test("listProducts returns every product; countProducts breaks totals down by status (admin summary route)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s1", name: "A", status: "live", price: 1, currency: "GBP", stock: 1, createdAt: now });
  db.upsertProduct({ id: "p2", slug: "s2", name: "B", status: "live", price: 1, currency: "GBP", stock: 1, createdAt: now });
  db.upsertProduct({ id: "p3", slug: "s3", name: "C", status: "preview", price: 1, currency: "GBP", stock: 1, createdAt: now });
  db.upsertProduct({ id: "p4", slug: "s4", name: "D", status: "draft", price: 1, currency: "GBP", stock: 1, createdAt: now });

  assert.equal(db.listProducts().length, 4);
  assert.deepEqual(db.countProducts(), { total: 4, live: 2, preview: 1 });
  db.close();
});

test("reorderProducts sets chapterProductOrder to the dropped position, atomically; unknown id changes nothing", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s1", name: "A", status: "live", price: 1, currency: "GBP", stock: 1, createdAt: now });
  db.upsertProduct({ id: "p2", slug: "s2", name: "B", status: "live", price: 1, currency: "GBP", stock: 1, createdAt: now });

  const ok = db.reorderProducts(["p2", "p1"]);
  assert.equal(ok, true);
  assert.equal(db.getProductById("p2").chapterProductOrder, 1);
  assert.equal(db.getProductById("p1").chapterProductOrder, 2);

  const failed = db.reorderProducts(["p1", "does-not-exist"]);
  assert.equal(failed, false);
  assert.equal(db.getProductById("p1").chapterProductOrder, 2, "a failed reorder must not partially apply");
  db.close();
});

// ---------------------------------------------------------------------
// orders / order_items / order_status_history / editions / payments / email_logs
// ---------------------------------------------------------------------

function sampleOrder(overrides = {}) {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2);
  return {
    id: `order-${suffix}`,
    // Unique by default (orders.number is UNIQUE) - tests that care about a
    // specific number (e.g. the BC-#### sequence itself) override this.
    number: `BC-TEST-${suffix}`,
    userId: null,
    customerName: "Test Buyer",
    customerEmail: "buyer@example.com",
    customerPhone: "0700000000",
    customerAddress: "Str. Test 1, Iasi",
    notes: "",
    status: "pending",
    paymentStatus: "unpaid",
    paymentMethod: "manual",
    paidAt: null,
    publicAccessTokenHash: "deadbeef",
    reservation: { expiresAt: now, confirmedAt: null },
    stockRestored: false,
    couponConsumed: false,
    couponRestored: false,
    editionsCancelled: false,
    currency: "GBP",
    total: 59,
    discount: 0,
    couponCode: null,
    // productId left null by default - most of these tests exercise order
    // mechanics, not product linkage, and order_items.product_id's FK would
    // otherwise require every test to seed a matching product first. Tests
    // that specifically care about the product/edition link seed one and
    // override this.
    items: [{ productId: null, name: "Test Tee", size: "M", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [1], editionTotal: 25 }],
    processedAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    fulfillment: { courierName: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", customerNote: "", internalNote: "" },
    cancellationReason: "",
    statusHistory: [{ from: null, to: "pending", changedAt: now, changedBy: null, emailSent: true }],
    createdAt: now,
    updatedAt: null,
    ...overrides
  };
}

test("createOrderWithItemsAndEditions round-trips the full rich order shape (items, statusHistory, reservation, fulfillment)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.upsertProduct({ id: "p1", slug: "s", name: "Test Tee", status: "live", price: 59, currency: "GBP", sizeStock: { M: 4 }, createdAt: new Date().toISOString() });

  const order = sampleOrder({ items: [{ productId: "p1", name: "Test Tee", size: "M", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [1], editionTotal: 25 }] });
  const editions = [{ id: 1, productId: "p1", orderId: order.id, orderItemId: `${order.id}#item#0`, productName: "Test Tee", size: "M", number: 1, total: 25, chapter: 1, chapterId: "origin", chapterName: "ORIGIN", chapterProductOrder: 999, assignedAt: order.createdAt }];

  const created = db.createOrderWithItemsAndEditions(order, editions);
  assert.equal(created.id, order.id);
  assert.equal(created.status, "pending");
  assert.deepEqual(created.items, order.items);
  assert.equal(created.statusHistory.length, 1);
  assert.equal(created.statusHistory[0].to, "pending");
  assert.equal(created.reservation.expiresAt, order.reservation.expiresAt);
  assert.deepEqual(created.fulfillment, order.fulfillment);

  const fetched = db.getOrderById(order.id);
  assert.deepEqual(fetched, created);

  const editionRow = db.raw.prepare("SELECT * FROM editions WHERE id = 1").get();
  assert.equal(editionRow.order_id, order.id);
  assert.equal(editionRow.status, "active");
  db.close();
});

test("createOrderWithItemsAndEditions is all-or-nothing: a bad item rolls back the order row too (atomicity)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder({ items: [{ name: "Bad Item", price: 10, currency: "GBP", qty: 1, subtotal: 10 }, null] });
  assert.throws(() => db.createOrderWithItemsAndEditions(order, []));
  assert.equal(db.getOrderById(order.id), null, "no order row may survive a failed items insert");
  db.close();
});

test("importOrder is safe to re-run: items/history/editions replace rather than duplicate (migration idempotency)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const changedAt = new Date().toISOString();
  const order = sampleOrder({
    items: [{ productId: null, name: "Tee", size: "M", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [1], editionTotal: 10 }],
    statusHistory: [
      { from: null, to: "pending", changedAt, changedBy: null, emailSent: true },
      { from: "pending", to: "confirmed", changedAt, changedBy: "admin@test.local", emailSent: true }
    ]
  });
  const editionRecords = [{ id: 500, orderId: order.id, productName: "Tee", size: "M", number: 1, total: 10, status: "active", assignedAt: order.createdAt }];

  db.importOrder(order, editionRecords);
  db.importOrder(order, editionRecords);
  db.importOrder(order, editionRecords);

  const result = db.getOrderById(order.id);
  assert.equal(result.items.length, 1, "re-running must not duplicate items");
  assert.equal(result.statusHistory.length, 2, "re-running must not duplicate history entries");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM editions WHERE id = 500").get().n, 1, "re-running must not duplicate the edition row");
  db.close();
});

test("insertOrderComplete composes with other writes inside one caller-owned transaction (the checkout pattern)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s", name: "Tee", status: "live", price: 59, currency: "GBP", sizeStock: { M: 5 }, createdAt: now });

  const order = sampleOrder({ items: [{ productId: "p1", name: "Tee", size: "M", price: 59, currency: "GBP", qty: 2, subtotal: 118 }] });
  db.withTransaction(() => {
    db.upsertProduct({ id: "p1", slug: "s", name: "Tee", status: "live", price: 59, currency: "GBP", sizeStock: { M: 3 }, createdAt: now, updatedAt: now });
    db.insertOrderComplete(order, []);
  });

  assert.equal(db.getProductById("p1").sizeStock.M, 3, "product update committed alongside the order, not nested/rejected");
  assert.ok(db.getOrderById(order.id));
});

test("insertOrderComplete: if it fails mid-transaction, the caller's other writes in that same transaction roll back too", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const now = new Date().toISOString();
  db.upsertProduct({ id: "p1", slug: "s", name: "Tee", status: "live", price: 59, currency: "GBP", sizeStock: { M: 5 }, createdAt: now });

  const badOrder = sampleOrder({ items: [null] });
  assert.throws(() => {
    db.withTransaction(() => {
      db.upsertProduct({ id: "p1", slug: "s", name: "Tee", status: "live", price: 59, currency: "GBP", sizeStock: { M: 3 }, createdAt: now, updatedAt: now });
      db.insertOrderComplete(badOrder, []);
    });
  });

  assert.equal(db.getProductById("p1").sizeStock.M, 5, "the product update must roll back too - this is the checkout atomicity guarantee");
  assert.equal(db.getOrderById(badOrder.id), null);
  db.close();
});

test("updateOrder shallow-merges flat fields without touching items/statusHistory", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder();
  db.createOrderWithItemsAndEditions(order, []);

  const updated = db.updateOrder(order.id, { status: "confirmed", paymentStatus: "paid", paidAt: new Date().toISOString() });
  assert.equal(updated.status, "confirmed");
  assert.equal(updated.paymentStatus, "paid");
  assert.equal(updated.items.length, 1, "items must survive an unrelated field update");
  assert.equal(updated.statusHistory.length, 1, "statusHistory must survive an unrelated field update");
  assert.equal(db.updateOrder("does-not-exist", { status: "confirmed" }), null);
  db.close();
});

test("appendOrderStatusHistory adds one entry without disturbing earlier ones, preserving payment/resend shape", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder();
  db.createOrderWithItemsAndEditions(order, []);

  db.appendOrderStatusHistory(order.id, { from: "pending", to: "confirmed", changedAt: new Date().toISOString(), changedBy: "admin@test.local", emailSent: true });
  db.appendOrderStatusHistory(order.id, { from: "confirmed", to: "confirmed", payment: { from: "unpaid", to: "paid" }, changedAt: new Date().toISOString(), changedBy: "admin@test.local", emailSent: false });
  db.appendOrderStatusHistory(order.id, { from: "confirmed", to: "confirmed", changedAt: new Date().toISOString(), changedBy: "admin@test.local", emailSent: true, resend: true });

  const history = db.getOrderById(order.id).statusHistory;
  assert.equal(history.length, 4, "original entry plus three appended");
  assert.equal(history[1].to, "confirmed");
  assert.deepEqual(history[2].payment, { from: "unpaid", to: "paid" });
  assert.equal(history[2].resend, undefined, "a non-resend entry must not carry resend:true");
  assert.equal(history[3].resend, true);
  db.close();
});

test("cancelEditionsForOrder cancels only that order's active editions, is idempotent", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder();
  db.createOrderWithItemsAndEditions(order, [
    { id: 1, orderId: order.id, productName: "A", size: "M", number: 1, assignedAt: order.createdAt },
    { id: 2, orderId: order.id, productName: "A", size: "M", number: 2, assignedAt: order.createdAt }
  ]);
  db.raw.prepare("INSERT INTO editions (id, order_id, product_name, size, number, status, assigned_at) VALUES (3, ?, 'A', 'M', 3, 'active', ?)").run(order.id, order.createdAt);

  const now = new Date().toISOString();
  db.cancelEditionsForOrder(order.id, "admin@test.local", now);
  const rows = db.raw.prepare("SELECT * FROM editions WHERE order_id = ?").all(order.id);
  assert.ok(rows.every((r) => r.status === "cancelled" && r.cancelled_at === now));

  // Idempotent: cancelling again must not throw or change already-cancelled rows.
  assert.doesNotThrow(() => db.cancelEditionsForOrder(order.id, "admin@test.local", new Date().toISOString()));
  db.close();
});

test("countPendingCouponHolds counts only pending, not-yet-consumed orders for that code", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "pending", couponCode: "SAVE10", couponConsumed: false }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "pending", couponCode: "SAVE10", couponConsumed: false }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "confirmed", couponCode: "SAVE10", couponConsumed: true }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "pending", couponCode: "OTHER", couponConsumed: false }), []);

  assert.equal(db.countPendingCouponHolds("SAVE10"), 2);
  assert.equal(db.countPendingCouponHolds("NOBODY-USES-THIS"), 0);
  db.close();
});

test("getOrderSummary reports total, pending count, and revenue from paid orders only (admin dashboard)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "pending", paymentStatus: "unpaid", total: 10 }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "pending", paymentStatus: "unpaid", total: 20 }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "confirmed", paymentStatus: "paid", total: 30 }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ status: "delivered", paymentStatus: "paid", total: 40 }), []);

  assert.deepEqual(db.getOrderSummary(), { total: 4, pending: 2, revenue: 70 });
  db.close();
});

test("getNextOrderNumber continues past the highest existing BC-#### and starts at BC-0001 when empty", () => {
  const db = createDb({ dbPath: tempDbPath() });
  assert.equal(db.getNextOrderNumber(), "BC-0001");
  db.createOrderWithItemsAndEditions(sampleOrder({ number: "BC-0001" }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ number: "BC-0007" }), []);
  assert.equal(db.getNextOrderNumber(), "BC-0008", "must continue from the highest number, not just the row count");
  db.close();
});

test("listOrdersForUser / listOrdersAdmin filter and sort correctly (newest first)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  db.insertUser({ id: "u1", email: "a@example.com", name: "A", role: "client", passwordHash: "x", createdAt: new Date().toISOString() });
  db.createOrderWithItemsAndEditions(sampleOrder({ id: "o1", userId: "u1", createdAt: "2026-01-01T00:00:00.000Z", number: "BC-0001" }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ id: "o2", userId: "u1", createdAt: "2026-02-01T00:00:00.000Z", number: "BC-0002" }), []);
  db.createOrderWithItemsAndEditions(sampleOrder({ id: "o3", userId: null, createdAt: "2026-01-15T00:00:00.000Z", number: "BC-0003" }), []);

  const mine = db.listOrdersForUser("u1");
  assert.equal(mine.length, 2);
  assert.equal(mine[0].id, "o2", "newest first");

  assert.equal(db.listOrdersAdmin().length, 3);
  db.close();
});

test("insertPayment stores a Square-shaped record without ever needing card data", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder();
  db.createOrderWithItemsAndEditions(order, []);

  db.insertPayment({
    id: "pay1", orderId: order.id, provider: "square", providerPaymentId: "sq_abc123",
    amount: 59, currency: "GBP", status: "completed", rawResponse: { id: "sq_abc123", status: "COMPLETED" },
    createdAt: new Date().toISOString()
  });

  const row = db.raw.prepare("SELECT * FROM payments WHERE id = ?").get("pay1");
  assert.equal(row.provider, "square");
  assert.equal(row.provider_payment_id, "sq_abc123");
  assert.deepEqual(JSON.parse(row.raw_response_json), { id: "sq_abc123", status: "COMPLETED" });
  db.close();
});

test("insertEmailLog records a send for dedupe lookups by (order_id, status)", () => {
  const db = createDb({ dbPath: tempDbPath() });
  const order = sampleOrder();
  db.createOrderWithItemsAndEditions(order, []);

  db.insertEmailLog({ orderId: order.id, status: "shipped", sentAt: new Date().toISOString(), ok: true });
  const row = db.raw.prepare("SELECT * FROM email_logs WHERE order_id = ? AND status = ?").get(order.id, "shipped");
  assert.ok(row);
  assert.equal(row.ok, 1);
  db.close();
});
