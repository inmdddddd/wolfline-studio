const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const { createDb } = require("../lib/db");

test.after(() => {
  delete process.env.BRAND;
  delete process.env.DATA_DIR;
});

// The script reads process.env.BRAND/DATA_DIR at module load time (same
// convention as server.js and migrate-genealogy.js), so both must be set
// before each fresh require.
function freshMigrator(dir) {
  process.env.BRAND = "beca";
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve("../scripts/migrate-to-sqlite.js")];
  return require("../scripts/migrate-to-sqlite.js");
}

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-migrate-test-"));
  return dir;
}

function writeJson(dir, fileName, data) {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2));
}

// A deliberately varied fixture set: a sized product, a sizeless product, a
// guest order, a logged-in order, a cancelled order with stockRestored=true
// (idempotency flags must survive), a multi-item order, an edition pointing
// at a since-deleted product, an expired session, and an orphaned session
// (userId that no longer exists) - each exercises a different edge the
// migration script has to get right.
function adversarialFixtures() {
  const now = new Date().toISOString();
  const adminId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const sizedProductId = crypto.randomUUID();
  const sizelessProductId = crypto.randomUUID();
  const deletedProductId = crypto.randomUUID(); // referenced by an order/edition, absent from products.json
  const guestOrderId = crypto.randomUUID();
  const loggedInOrderId = crypto.randomUUID();
  const cancelledOrderId = crypto.randomUUID();

  const users = [
    { id: adminId, email: "admin@example.com", name: "Admin", role: "admin", passwordHash: "salt:hash1", emailVerified: true, isPrimaryAdmin: true, createdAt: now },
    { id: clientId, email: "client@example.com", name: "Client", role: "client", passwordHash: "salt:hash2", emailVerified: true, isPrimaryAdmin: false, createdAt: now }
  ];

  const products = [
    {
      id: sizedProductId, slug: "sized-tee", name: "Sized Tee", status: "live", price: 59, currency: "GBP",
      stock: 7, sizeStock: { S: 2, M: 5 }, sizes: ["S", "M"], imageUrl: "", color: "Black",
      description: "", chapterId: "origin", chapterProductOrder: 1, createdAt: now, updatedAt: now
    },
    {
      id: sizelessProductId, slug: "tote-bag", name: "Tote Bag", status: "live", price: 25, currency: "GBP",
      stock: 12, imageUrl: "", color: "", description: "", chapterId: "origin", chapterProductOrder: 2,
      createdAt: now, updatedAt: now
    }
  ];

  const orders = [
    {
      id: guestOrderId, number: "BC-0001", userId: null,
      customerName: "Guest Buyer", customerEmail: "guest@example.com", customerPhone: "0700000001",
      customerAddress: "Str. Guest 1", notes: "", status: "pending", paymentStatus: "unpaid",
      paymentMethod: "manual", paidAt: null, publicAccessTokenHash: "hash-guest",
      reservation: { expiresAt: new Date(Date.now() + 100000).toISOString() },
      stockRestored: false, couponConsumed: false, couponRestored: false, editionsCancelled: false,
      currency: "GBP", total: 59, discount: 0, couponCode: null,
      items: [{ productId: sizedProductId, name: "Sized Tee", size: "M", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [1], editionTotal: 7 }],
      processedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null,
      fulfillment: { courierName: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", customerNote: "", internalNote: "" },
      cancellationReason: "",
      statusHistory: [{ from: null, to: "pending", changedAt: now, changedBy: null, emailSent: true }],
      createdAt: now
    },
    {
      id: loggedInOrderId, number: "BC-0002", userId: clientId,
      customerName: "Client", customerEmail: "client@example.com", customerPhone: "0700000002",
      customerAddress: "Str. Client 1", notes: "leave at door", status: "delivered", paymentStatus: "paid",
      paymentMethod: "cod", paidAt: now, publicAccessTokenHash: "hash-loggedin",
      reservation: { expiresAt: null, confirmedAt: now },
      stockRestored: false, couponConsumed: true, couponRestored: false, editionsCancelled: false,
      currency: "GBP", total: 84, discount: 0, couponCode: null,
      // Multi-item: one real product, one referencing a product that no longer exists.
      items: [
        { productId: sizelessProductId, name: "Tote Bag", size: "", price: 25, currency: "GBP", qty: 1, subtotal: 25, editionNumbers: [], editionTotal: null },
        { productId: deletedProductId, name: "Discontinued Item", size: "L", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [1], editionTotal: 3 }
      ],
      processedAt: now, shippedAt: now, deliveredAt: now, cancelledAt: null,
      fulfillment: { courierName: "Sameday", trackingNumber: "AWB123", trackingUrl: "", estimatedDeliveryDate: "", customerNote: "", internalNote: "" },
      cancellationReason: "",
      statusHistory: [
        { from: null, to: "pending", changedAt: now, changedBy: null, emailSent: true },
        { from: "pending", to: "confirmed", payment: { from: "unpaid", to: "paid" }, changedAt: now, changedBy: "admin@example.com", emailSent: false },
        { from: "confirmed", to: "processing", changedAt: now, changedBy: "admin@example.com", emailSent: true },
        { from: "processing", to: "shipped", changedAt: now, changedBy: "admin@example.com", emailSent: true },
        { from: "shipped", to: "delivered", changedAt: now, changedBy: "admin@example.com", emailSent: true }
      ],
      createdAt: now
    },
    {
      id: cancelledOrderId, number: "BC-0003", userId: null,
      customerName: "Cancelled Buyer", customerEmail: "cancelled@example.com", customerPhone: "0700000003",
      customerAddress: "Str. Cancelled 1", notes: "", status: "cancelled", paymentStatus: "unpaid",
      paymentMethod: "manual", paidAt: null, publicAccessTokenHash: "hash-cancelled",
      reservation: { expiresAt: null },
      // Idempotency flags already true - migration must preserve them exactly
      // (a bug here could cause a double stock-restore after the cutover).
      stockRestored: true, couponConsumed: false, couponRestored: false, editionsCancelled: true,
      currency: "GBP", total: 59, discount: 0, couponCode: null,
      items: [{ productId: sizedProductId, name: "Sized Tee", size: "S", price: 59, currency: "GBP", qty: 1, subtotal: 59, editionNumbers: [2], editionTotal: 7 }],
      processedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: now,
      fulfillment: { courierName: "", trackingNumber: "", trackingUrl: "", estimatedDeliveryDate: "", customerNote: "", internalNote: "" },
      cancellationReason: "Rezervarea de stoc a expirat fara confirmare.",
      statusHistory: [
        { from: null, to: "pending", changedAt: now, changedBy: null, emailSent: true },
        { from: "pending", to: "cancelled", changedAt: now, changedBy: "system:reservation-expired", emailSent: false }
      ],
      createdAt: now
    }
  ];

  const editions = [
    { id: 1, productId: sizedProductId, productName: "Sized Tee", size: "M", number: 1, total: 7, chapter: 1, chapterId: "origin", chapterName: "ORIGIN", chapterProductOrder: 1, orderId: guestOrderId, assignedAt: now },
    // References a product that has since been deleted from products.json.
    { id: 2, productId: deletedProductId, productName: "Discontinued Item", size: "L", number: 1, total: 3, chapter: 1, chapterId: "origin", chapterName: "ORIGIN", chapterProductOrder: 3, orderId: loggedInOrderId, assignedAt: now },
    { id: 3, productId: sizedProductId, productName: "Sized Tee", size: "S", number: 2, total: 7, chapter: 1, chapterId: "origin", chapterName: "ORIGIN", chapterProductOrder: 1, orderId: cancelledOrderId, assignedAt: now, status: "cancelled", cancelledAt: now, cancelledBy: "system:reservation-expired" }
  ];

  const sessions = {
    "live-session-token": { userId: clientId, expiresAt: Date.now() + 1000 * 60 * 60, createdAt: now },
    "expired-session-token": { userId: clientId, expiresAt: Date.now() - 1000, createdAt: now },
    "orphaned-session-token": { userId: "does-not-exist-anymore", expiresAt: Date.now() + 1000 * 60 * 60, createdAt: now }
  };

  return { users, products, orders, editions, sessions, ids: { adminId, clientId, sizedProductId, sizelessProductId, deletedProductId, guestOrderId, loggedInOrderId, cancelledOrderId } };
}

function seedDataDir(dir, fixtures) {
  writeJson(dir, "users.json", fixtures.users);
  writeJson(dir, "products.json", fixtures.products);
  writeJson(dir, "orders.json", fixtures.orders);
  writeJson(dir, "editions.json", fixtures.editions);
  writeJson(dir, "sessions.json", fixtures.sessions);
}

test("migrate() imports users, products (sized + sizeless), orders, editions, and live sessions correctly", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  const report = migrate({ dryRun: false });

  assert.equal(report.users, 2);
  assert.equal(report.products, 2);
  assert.equal(report.orders, 3);
  assert.equal(report.editions, 3);
  assert.equal(report.sessionsImported, 1);
  assert.equal(report.sessionsSkippedExpired, 1);
  assert.equal(report.sessionsSkippedOrphaned, 1);
  assert.equal(report.productRefsDroppedInItems, 1, "the deleted-product reference in order BC-0002 is dropped, not fatal");

  const db = createDb({ dbPath: path.join(dir, "beca.db") });

  const sizedProduct = db.getProductById(fixtures.ids.sizedProductId);
  assert.deepEqual(sizedProduct.sizeStock, { S: 2, M: 5 });
  assert.equal(sizedProduct.stock, 7);

  const sizelessProduct = db.getProductById(fixtures.ids.sizelessProductId);
  assert.equal(sizelessProduct.sizeStock, undefined);
  assert.equal(sizelessProduct.stock, 12);

  const guestOrder = db.getOrderById(fixtures.ids.guestOrderId);
  assert.equal(guestOrder.userId, null);
  assert.equal(guestOrder.items[0].productId, fixtures.ids.sizedProductId);

  const loggedInOrder = db.getOrderById(fixtures.ids.loggedInOrderId);
  assert.equal(loggedInOrder.userId, fixtures.ids.clientId);
  assert.equal(loggedInOrder.items.length, 2);
  const deletedRefItem = loggedInOrder.items.find((item) => item.name === "Discontinued Item");
  assert.equal(deletedRefItem.productId, null, "reference to the deleted product is nulled, not dropped entirely");
  assert.equal(loggedInOrder.statusHistory.length, 5);

  const cancelledOrder = db.getOrderById(fixtures.ids.cancelledOrderId);
  assert.equal(cancelledOrder.stockRestored, true, "idempotency flags must survive migration exactly");
  assert.equal(cancelledOrder.editionsCancelled, true);

  const cancelledEdition = db.getEditionById(3);
  assert.equal(cancelledEdition.status, "cancelled");
  assert.ok(cancelledEdition.cancelledAt);

  const sessionUser = db.getSessionWithUser("live-session-token");
  assert.equal(sessionUser.user.id, fixtures.ids.clientId);
  assert.equal(db.getSessionWithUser("expired-session-token"), null);
  assert.equal(db.getSessionWithUser("orphaned-session-token"), null);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migrate() resolves duplicate product slugs (real-world data bug) by renaming the older copy, keeping both rows", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  const olderId = crypto.randomUUID();
  const newerId = crypto.randomUUID();
  // Mirrors the real shape found in production: a double-submit creates two
  // drafts with the same name/slug, seconds apart.
  fixtures.products.push(
    { id: olderId, slug: "double-submit", name: "Double Submit", status: "draft", price: 10, currency: "GBP", stock: 0, createdAt: "2026-07-17T09:45:08.091Z" },
    { id: newerId, slug: "double-submit", name: "Double Submit", status: "draft", price: 10, currency: "GBP", stock: 0, createdAt: "2026-07-17T09:45:19.536Z" }
  );
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  const report = migrate({ dryRun: false });

  assert.equal(report.slugCollisionsResolved.length, 1);
  assert.equal(report.slugCollisionsResolved[0].id, olderId, "the OLDER copy (by createdAt) must be the one renamed");
  assert.equal(report.slugCollisionsResolved[0].oldSlug, "double-submit");

  const db = createDb({ dbPath: path.join(dir, "beca.db") });
  const newer = db.getProductById(newerId);
  const older = db.getProductById(olderId);
  assert.equal(newer.slug, "double-submit", "the newer copy keeps the original slug");
  assert.equal(older.slug, "double-submit-dup2", "the older copy gets a unique, deterministic suffix");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM products").get().n, fixtures.products.length, "no product is dropped");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migrate() never touches the source JSON files - byte-identical before and after", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  seedDataDir(dir, fixtures);

  const before = {
    users: fs.readFileSync(path.join(dir, "users.json"), "utf8"),
    products: fs.readFileSync(path.join(dir, "products.json"), "utf8"),
    orders: fs.readFileSync(path.join(dir, "orders.json"), "utf8"),
    editions: fs.readFileSync(path.join(dir, "editions.json"), "utf8"),
    sessions: fs.readFileSync(path.join(dir, "sessions.json"), "utf8")
  };

  const { migrate } = freshMigrator(dir);
  migrate({ dryRun: false });

  assert.equal(fs.readFileSync(path.join(dir, "users.json"), "utf8"), before.users);
  assert.equal(fs.readFileSync(path.join(dir, "products.json"), "utf8"), before.products);
  assert.equal(fs.readFileSync(path.join(dir, "orders.json"), "utf8"), before.orders);
  assert.equal(fs.readFileSync(path.join(dir, "editions.json"), "utf8"), before.editions);
  assert.equal(fs.readFileSync(path.join(dir, "sessions.json"), "utf8"), before.sessions);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("migrate() run twice produces an identical result (idempotent)", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  const firstReport = migrate({ dryRun: false });
  const secondReport = migrate({ dryRun: false });

  assert.deepEqual(firstReport, secondReport);

  const db = createDb({ dbPath: path.join(dir, "beca.db") });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 3);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM order_items").get().n, 4, "3 orders, one with 2 items = 4 total, not 8");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM order_status_history").get().n, 8, "1+5+2 history entries, not doubled");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM editions").get().n, 3);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--dry-run rolls back: report is produced but nothing is persisted", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  const report = migrate({ dryRun: true });

  assert.equal(report.users, 2);
  assert.equal(report.orders, 3);

  const dbPath = path.join(dir, "beca.db");
  const db = createDb({ dbPath });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0, "dry-run must not persist anything");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("validate() aborts on a duplicate user email, before any SQL runs", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  fixtures.users.push({ ...fixtures.users[0], id: crypto.randomUUID() });
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  assert.throws(() => migrate({ dryRun: false }), /Duplicate user email/);

  const db = createDb({ dbPath: path.join(dir, "beca.db") });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0, "a validation failure must leave the db untouched");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("validate() aborts on an order referencing a userId absent from users.json", () => {
  const dir = tempDataDir();
  const fixtures = adversarialFixtures();
  fixtures.orders[0].userId = "ghost-user-id";
  seedDataDir(dir, fixtures);

  const { migrate } = freshMigrator(dir);
  assert.throws(() => migrate({ dryRun: false }), /references userId "ghost-user-id"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
