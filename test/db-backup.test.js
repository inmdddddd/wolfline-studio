const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

// Coverage for backupDataFiles()'s database snapshot: this predates the
// SQLite migration and used to only copy data/*.json, silently leaving the
// actual order/product/user data (which has lived in <brand>.db since the
// migration) out of every rolling backup. Confirms the fix actually lands a
// complete, valid database file next to the JSON snapshot - not just that a
// file with the right name exists.

const ADMIN_EMAIL = "admin@db-backup-test.local";
const ADMIN_PASSWORD = "admintestpass123";

function freshEnv(overrides) {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  delete process.env.BRAND;
  delete process.env.NODE_ENV;
  Object.assign(process.env, overrides);
}

function requireFreshServer() {
  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  return require("../server.js");
}

test("backupDataFiles() includes a valid SQLite snapshot, not just the legacy JSON files", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-db-backup-test-"));
  const dataDir = path.join(tempRoot, "data");
  freshEnv({ DATA_DIR: dataDir });
  const server = requireFreshServer();
  const httpServer = server.start();
  await new Promise((resolve) => httpServer.once("listening", resolve));

  try {
    const backupsDir = path.join(dataDir, "..", "backups");
    const generations = fs.readdirSync(backupsDir);
    assert.equal(generations.length, 1, "one backup generation from the immediate startup call");

    const snapshotDir = path.join(backupsDir, generations[0]);
    const files = fs.readdirSync(snapshotDir);

    await t.test("the snapshot has a .db file alongside the JSON files", () => {
      assert.ok(files.includes("beca.db"), `expected beca.db among: ${files.join(", ")}`);
      assert.ok(files.some((f) => f.endsWith(".json")), "legacy JSON backup still happens too");
    });

    await t.test("the backed-up database is a complete, valid, openable snapshot", () => {
      const backupDbPath = path.join(snapshotDir, "beca.db");
      const db = new DatabaseSync(backupDbPath, { readOnly: true });
      try {
        const integrity = db.prepare("PRAGMA integrity_check").get();
        assert.equal(integrity.integrity_check, "ok");

        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
        assert.ok(tables.includes("products"), "real schema, not an empty file");
        assert.ok(tables.includes("orders"));
        assert.ok(tables.includes("users"));
      } finally {
        db.close();
      }
    });

    await t.test("the live database is untouched by the backup (readOnly snapshot, not a move)", () => {
      const liveDbPath = path.join(dataDir, "beca.db");
      assert.ok(fs.existsSync(liveDbPath), "the source database still exists at its original path");
      const db = new DatabaseSync(liveDbPath, { readOnly: true });
      try {
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      } finally {
        db.close();
      }
    });
  } finally {
    server.stop();
    httpServer.close();
    delete require.cache[require.resolve("../lib/email.js")];
    delete require.cache[require.resolve("../server.js")];
    delete process.env.DATA_DIR;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
