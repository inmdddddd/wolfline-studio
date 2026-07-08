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
// migrated in-place on boot for accounts that predate the flag. This test
// reproduces exactly that pre-existing-account shape: an admin user, already on
// disk, with a non-default email and no isPrimaryAdmin field at all.
test("ensureDataFiles migrates a pre-existing admin (non-default email, no flag) to isPrimaryAdmin", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-primary-admin-migration-"));
  const legacyAdminId = crypto.randomUUID();

  fs.writeFileSync(path.join(tempDir, "users.json"), JSON.stringify([
    {
      id: legacyAdminId,
      email: "real-owner@example.com",
      name: "Real Owner",
      role: "admin",
      passwordHash: "irrelevant:forThisTest",
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z"
      // no isPrimaryAdmin field - this is the shape of an account created
      // before the flag existed, exactly like the live site's admin user.
    }
  ], null, 2));

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

    const usersAfterBoot = JSON.parse(fs.readFileSync(path.join(tempDir, "users.json"), "utf8"));
    assert.equal(usersAfterBoot.length, 1, "boot must not create a second admin when one already exists");

    const migrated = usersAfterBoot.find((user) => user.id === legacyAdminId);
    assert.ok(migrated, "the pre-existing admin must still be present");
    assert.equal(migrated.email, "real-owner@example.com", "migration must not touch the account's email");
    assert.equal(migrated.isPrimaryAdmin, true, "the pre-existing admin must be backfilled as primary");
  } finally {
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
