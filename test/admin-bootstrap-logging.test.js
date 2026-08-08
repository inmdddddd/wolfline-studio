const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// Regression tests for: admin credentials must never be printed to logs in
// production (pm2/hosting logs are captured, retained, and get pasted around),
// and the default admin bootstrap must never fire again once any user exists.

function withIsolatedServer(setupFn, testFn) {
  return async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-admin-bootstrap-"));

    const originalEnv = {
      DATA_DIR: process.env.DATA_DIR,
      PORT: process.env.PORT,
      HOST: process.env.HOST,
      NODE_ENV: process.env.NODE_ENV,
      SITE_ORIGIN: process.env.SITE_ORIGIN,
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

    // Runs after the env defaults above so a scenario can set NODE_ENV,
    // ADMIN_PASSWORD etc. without being overwritten.
    setupFn?.(tempDir);

    const originalLog = console.log;
    const logLines = [];
    console.log = (...args) => logLines.push(args.join(" "));

    delete require.cache[require.resolve("../lib/email.js")];
    delete require.cache[require.resolve("../server.js")];
    const server = require("../server.js");
    let httpServer;

    try {
      httpServer = server.start();
      await new Promise((resolve) => httpServer.once("listening", resolve));
      await testFn({ tempDir, logLines });
    } finally {
      console.log = originalLog;
      // Must run before the require.cache delete below - it needs the same
      // cached module instance server.start() used, to close its actual open
      // SQLite connection.
      require("../server.js").stop();
      httpServer?.close();
      delete require.cache[require.resolve("../lib/email.js")];
      delete require.cache[require.resolve("../server.js")];
      fs.rmSync(tempDir, { recursive: true, force: true });

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

test(
  "fresh install outside production logs the generated admin credentials (dev convenience)",
  withIsolatedServer(
    () => { process.env.NODE_ENV = "development"; },
    async ({ logLines }) => {
      const credentialLine = logLines.find((line) => line.includes("Generated admin account"));
      assert.ok(credentialLine, "expected a generated-admin-account log line outside production");
      assert.match(credentialLine, /Generated admin account: .+@.+ \/ \S+/);
    }
  )
);

test(
  "fresh install in production never logs admin credentials",
  withIsolatedServer(
    () => {
      process.env.NODE_ENV = "production";
      // Production now refuses to boot without an explicit ADMIN_PASSWORD
      // (startup validation), so the production scenario must provide one.
      process.env.ADMIN_PASSWORD = "prod-bootstrap-secret-1";
      process.env.SITE_ORIGIN = "https://beca-wlf.com";
    },
    async ({ logLines, tempDir }) => {
      const leaked = logLines.filter((line) => /Generated admin account|password/i.test(line));
      assert.deepEqual(leaked, [], "no log line may mention the generated admin password in production");

      // The password must still exist (bootstrap isn't skipped) - it's just
      // not printed anywhere. Confirm it was actually generated and hashed
      // onto the admin user on disk, so this test can't pass by accident
      // (e.g. bootstrap silently failing to create an admin at all). WAL mode
      // allows this second reader connection alongside the server's own.
      const { createDb } = require("../lib/db");
      const checkDb = createDb({ dbPath: path.join(tempDir, "beca.db") });
      const users = checkDb.listUsers();
      checkDb.close();
      assert.equal(users.length, 1);
      assert.equal(users[0].role, "admin");
      assert.ok(users[0].passwordHash, "admin must still have a real password, just not a logged one");

      assert.ok(
        logLines.some((line) => line.includes("BeCa platform running at")),
        "the platform-running line must still be logged in production"
      );
    }
  )
);

test(
  "an existing admin is never replaced or duplicated by the bootstrap, and nothing is logged for it",
  withIsolatedServer(
    (tempDir) => {
      // Seeded directly against the same beca.db file server.js will open -
      // storage moved from users.json to SQLite, but the scenario (an admin
      // that already exists before boot) is unchanged.
      const { createDb } = require("../lib/db");
      const seedDb = createDb({ dbPath: path.join(tempDir, "beca.db") });
      seedDb.insertUser({
        id: crypto.randomUUID(),
        email: "real-owner@example.com",
        name: "Real Owner",
        role: "admin",
        passwordHash: "salt:realhashvalue",
        emailVerified: true,
        isPrimaryAdmin: true,
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      seedDb.close();
      process.env.NODE_ENV = "development";
    },
    async ({ logLines, tempDir }) => {
      const { createDb } = require("../lib/db");
      const checkDb = createDb({ dbPath: path.join(tempDir, "beca.db") });
      const users = checkDb.listUsers();
      checkDb.close();
      assert.equal(users.length, 1, "bootstrap must not add a second admin when one already exists");
      assert.equal(users[0].email, "real-owner@example.com");
      assert.equal(users[0].passwordHash, "salt:realhashvalue", "the existing admin's password must be untouched");

      const leaked = logLines.filter((line) => /Generated admin account/i.test(line));
      assert.deepEqual(leaked, [], "no credentials should be generated or logged when an admin already exists");
    }
  )
);
