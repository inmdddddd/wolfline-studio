const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// Regression test for the production audit finding: canManageRoles/role-change
// used to gate on `user.email === "admin@beca.local"`, a hardcoded string. The
// live site's admin account had its email changed away from that default (to
// receive real SMTP mail), which silently locked the only admin out of role
// management. The fix backs that gate with a persistent isPrimaryAdmin flag,
// migrated in-place on boot for accounts that predate the flag.
//
// Storage moved from users.json to SQLite (users table), but the scenario this
// guards against is unchanged: an admin account that exists with
// is_primary_admin=0 (the column's default - the SQLite-era equivalent of "the
// JSON record has no isPrimaryAdmin field at all") and nothing else holding the
// flag. Seed that row directly against the same beca.db file server.js will
// open, bypassing the app entirely - exactly like a database migrated from a
// pre-this-feature production JSON export would look on first boot.
test("ensureDataFiles migrates a pre-existing admin (no isPrimaryAdmin flag set) to isPrimaryAdmin", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-primary-admin-migration-"));
  const legacyAdminId = crypto.randomUUID();
  const dbPath = path.join(tempDir, "beca.db");

  const { createDb } = require("../lib/db");
  const seedDb = createDb({ dbPath });
  seedDb.insertUser({
    id: legacyAdminId,
    email: "real-owner@example.com",
    name: "Real Owner",
    role: "admin",
    passwordHash: "irrelevant:forThisTest",
    emailVerified: true,
    isPrimaryAdmin: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  seedDb.close();

  const originalEnv = {
    DATA_DIR: process.env.DATA_DIR,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS
  };

  process.env.DATA_DIR = tempDir;
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";

  delete require.cache[require.resolve("../lib/email.js")];
  delete require.cache[require.resolve("../server.js")];
  const server = require("../server.js");
  const httpServer = server.start();

  try {
    await new Promise((resolve) => httpServer.once("listening", resolve));

    // WAL mode allows a second reader connection alongside the server's own -
    // open one directly against the same file rather than exporting internal
    // state from server.js just for this assertion.
    const checkDb = createDb({ dbPath });
    const usersAfterBoot = checkDb.listUsers();
    checkDb.close();

    assert.equal(usersAfterBoot.length, 1, "boot must not create a second admin when one already exists");

    const migrated = usersAfterBoot.find((user) => user.id === legacyAdminId);
    assert.ok(migrated, "the pre-existing admin must still be present");
    assert.equal(migrated.email, "real-owner@example.com", "migration must not touch the account's email");
    assert.equal(migrated.isPrimaryAdmin, true, "the pre-existing admin must be backfilled as primary");
  } finally {
    require("../server.js").stop();
    httpServer.close();
    delete require.cache[require.resolve("../lib/email.js")];
    delete require.cache[require.resolve("../server.js")];
    fs.rmSync(tempDir, { recursive: true, force: true });

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
