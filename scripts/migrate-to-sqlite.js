// One-time (but safe-to-re-run) migration: reads the current data/*.json
// files for a brand and populates its beca.db / aether.db with the same
// data. Never writes JSON - it only calls storage.readJson, so there is no
// code path in this file that could touch the source files at all.
//
// Usage:
//   node scripts/migrate-to-sqlite.js --brand=beca [--data-dir=...] [--dry-run]
//
// --dry-run runs the exact same code path but rolls back instead of
// committing, after printing the report - safe to run repeatedly against a
// copy of real data to sanity-check before ever touching the live DATA_DIR.
const path = require("path");

const brandArg = process.argv.find((argument) => argument.startsWith("--brand="));
const dataArg = process.argv.find((argument) => argument.startsWith("--data-dir="));
const dryRun = process.argv.includes("--dry-run");

process.env.BRAND = brandArg ? brandArg.slice("--brand=".length) : (process.env.BRAND || "beca");
if (dataArg) process.env.DATA_DIR = path.resolve(dataArg.slice("--data-dir=".length));

const BRAND_ID = String(process.env.BRAND).trim().toLowerCase();
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", BRAND_ID === "beca" ? "data" : `data-${BRAND_ID}`);

const { createStorage } = require("../lib/storage");
const { createDb } = require("../lib/db");

// No backupsDir needed - this script never writes JSON, so storage's
// corruption-recovery path (which reads from backups) never triggers.
const storage = createStorage({ dataDir, backupsDir: path.join(dataDir, "..", "unused-backups") });
const dbPath = path.join(dataDir, `${BRAND_ID}.db`);

function readJson(fileName, fallback) {
  return storage.readJson(fileName, fallback);
}

function fail(message) {
  const error = new Error(message);
  error.isMigrationValidationError = true;
  throw error;
}

// Runs entirely in JS, before any SQL is executed, so a bad row is reported
// with an actionable message instead of surfacing as an opaque SQLite
// "FOREIGN KEY constraint failed" with no indication of which row.
function validate({ users, products, orders }) {
  const problems = [];

  const emailCounts = new Map();
  for (const user of users) {
    const email = String(user.email || "").toLowerCase();
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }
  for (const [email, count] of emailCounts) {
    if (count > 1) problems.push(`Duplicate user email "${email}" appears ${count} times in users.json (violates UNIQUE(email)).`);
  }

  const userIds = new Set(users.map((user) => user.id));
  for (const order of orders) {
    if (order.userId && !userIds.has(order.userId)) {
      problems.push(`Order ${order.number || order.id} references userId "${order.userId}", which is not in users.json. This should never happen.`);
    }
    const allowedStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
    if (!allowedStatuses.includes(order.status)) {
      problems.push(`Order ${order.number || order.id} has unrecognized status "${order.status}".`);
    }
    const allowedPaymentStatuses = ["unpaid", "paid", "refunded", "failed"];
    if (!allowedPaymentStatuses.includes(order.paymentStatus)) {
      problems.push(`Order ${order.number || order.id} has unrecognized paymentStatus "${order.paymentStatus}".`);
    }
    for (const item of order.items || []) {
      if (!(Number(item.qty) > 0)) problems.push(`Order ${order.number || order.id} has an item with qty <= 0.`);
      if (Number(item.price) < 0) problems.push(`Order ${order.number || order.id} has an item with a negative price.`);
    }
  }

  for (const product of products) {
    if (!["draft", "preview", "live", "sold-out"].includes(product.status)) {
      problems.push(`Product ${product.id} has unrecognized status "${product.status}".`);
    }
  }

  if (problems.length) {
    fail(`Migration validation failed with ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
}

function migrate({ dryRun: isDryRun = false } = {}) {
  const users = readJson("users.json", []);
  const products = readJson("products.json", []);
  const orders = readJson("orders.json", []);
  const editions = readJson("editions.json", []);
  const sessions = readJson("sessions.json", {});

  validate({ users, products, orders });

  const productIds = new Set(products.map((product) => product.id));
  const userIds = new Set(users.map((user) => user.id));
  const now = Date.now();

  const report = {
    users: 0,
    products: 0,
    orders: 0,
    editions: 0,
    sessionsImported: 0,
    sessionsSkippedExpired: 0,
    sessionsSkippedOrphaned: 0,
    productRefsDroppedInItems: 0,
    editionsWithoutMatchingOrder: 0
  };

  const db = createDb({ dbPath });

  try {
    db.withTransaction(() => {
      for (const user of users) {
        db.insertUser(user);
        report.users += 1;
      }

      for (const product of products) {
        db.upsertProduct(product);
        report.products += 1;
      }

      const editionsByOrderId = new Map();
      for (const record of editions) {
        const list = editionsByOrderId.get(record.orderId) || [];
        list.push(record);
        editionsByOrderId.set(record.orderId, list);
      }
      const seenOrderIds = new Set();

      for (const order of orders) {
        const items = (order.items || []).map((item) => {
          if (item.productId && !productIds.has(item.productId)) report.productRefsDroppedInItems += 1;
          return {
            ...item,
            productId: item.productId && productIds.has(item.productId) ? item.productId : null
          };
        });

        const orderForImport = { ...order, items };
        const orderEditions = (editionsByOrderId.get(order.id) || []).map((record) => {
          const itemIndex = items.findIndex((item) => item.productId === record.productId && (item.size || "") === (record.size || ""));
          return {
            ...record,
            productId: record.productId && productIds.has(record.productId) ? record.productId : null,
            orderItemId: itemIndex >= 0 ? `${order.id}#item#${itemIndex}` : null
          };
        });

        db.importOrder(orderForImport, orderEditions);
        report.orders += 1;
        report.editions += orderEditions.length;
        seenOrderIds.add(order.id);
      }

      for (const record of editions) {
        if (!seenOrderIds.has(record.orderId)) report.editionsWithoutMatchingOrder += 1;
      }

      for (const [sessionId, session] of Object.entries(sessions)) {
        if (!session || !userIds.has(session.userId)) {
          report.sessionsSkippedOrphaned += 1;
          continue;
        }
        if (now > Number(session.expiresAt || 0)) {
          report.sessionsSkippedExpired += 1;
          continue;
        }
        db.insertSession(sessionId, session.userId, session.expiresAt, session.createdAt);
        report.sessionsImported += 1;
      }

      if (isDryRun) {
        // Deliberately abort the transaction after doing all the work above,
        // so every INSERT ran (and would have thrown on a bad row) but
        // nothing is actually persisted.
        throw { isDryRunAbort: true };
      }
    });
  } catch (error) {
    if (error && error.isDryRunAbort) {
      // Expected control-flow for --dry-run - not a real failure.
    } else {
      throw error;
    }
  } finally {
    db.close();
  }

  return report;
}

function printReport(report, isDryRun) {
  const lines = [
    `${isDryRun ? "[DRY RUN] " : ""}Migration report for brand "${BRAND_ID}" (${dataDir} -> ${dbPath})`,
    `  users:                         ${report.users}`,
    `  products:                      ${report.products}`,
    `  orders:                        ${report.orders}`,
    `  editions:                      ${report.editions}`,
    `  sessions imported:             ${report.sessionsImported}`,
    `  sessions skipped (expired):    ${report.sessionsSkippedExpired}`,
    `  sessions skipped (orphaned):   ${report.sessionsSkippedOrphaned}`
  ];
  if (report.productRefsDroppedInItems) {
    lines.push(`  NOTE: ${report.productRefsDroppedInItems} order item(s) referenced a since-deleted product - imported with product_id=NULL (expected/harmless).`);
  }
  if (report.editionsWithoutMatchingOrder) {
    lines.push(`  WARNING: ${report.editionsWithoutMatchingOrder} edition record(s) had no matching order in orders.json and were NOT imported. This should not happen - investigate before trusting this run.`);
  }
  lines.push(isDryRun ? "  Nothing was written (rolled back). Source JSON files were never touched." : "  Committed. Source JSON files were never touched.");
  console.log(lines.join("\n"));
}

if (require.main === module) {
  try {
    const report = migrate({ dryRun });
    printReport(report, dryRun);
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { migrate, validate };
