const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Coverage for server.js's uncaughtException/unhandledRejection handler
// (handleFatalError): logs, emails every admin once, then exits so pm2
// restarts cleanly - with a cooldown so a crash LOOP doesn't resend on every
// restart (the exact failure mode that let Aether's crash-loop run
// unnoticed - see server.js's comment above CRASH_ALERT_COOLDOWN_MS).
//
// This has to run as a real child process, not server.start() in-process
// like every other test file here: the whole point of the handler is that
// it calls process.exit() on a genuine uncaught exception, which would take
// the entire test run down with it if triggered in-process. The handler is
// also deliberately disabled whenever BECA_TEST_MODE is set (see server.js),
// which every in-process test implicitly has via this suite's own
// --require setup-env.js preload - so an out-of-process spawn with that var
// stripped is the only way to exercise the real code path at all.

const ADMIN_EMAIL = "admin@crash-alert-test.local";
const ADMIN_PASSWORD = "admintestpass123";
const SERVER_PATH = path.join(__dirname, "..", "server.js");

function crashingServerScript(message) {
  return `
    const server = require(${JSON.stringify(SERVER_PATH)});
    server.start();
    setTimeout(() => {
      setImmediate(() => { throw new Error(${JSON.stringify(message)}); });
    }, 300);
  `;
}

function runCrashingServer(dataDir, message) {
  const env = { ...process.env };
  delete env.BECA_TEST_MODE;
  delete env.NODE_ENV;
  Object.assign(env, {
    PORT: "0",
    HOST: "127.0.0.1",
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    DATA_DIR: dataDir,
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASS: ""
  });
  delete env.BRAND;

  return spawnSync(process.execPath, ["-e", crashingServerScript(message)], { env, timeout: 10000, encoding: "utf8" });
}

function readOutbox(dataDir) {
  const outboxPath = path.join(dataDir, "email-outbox.json");
  if (!fs.existsSync(outboxPath)) return [];
  return JSON.parse(fs.readFileSync(outboxPath, "utf8"));
}

test("crash alerting: logs, emails admins once, exits cleanly - with a cooldown against crash loops", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beca-crash-alert-test-"));
  const dataDir = path.join(tempRoot, "data");

  await t.test("a genuine uncaught exception alerts the admin and exits non-zero", () => {
    const result = runCrashingServer(dataDir, "first crash - real bug simulation");
    assert.equal(result.status, 1, `process should exit 1, got: ${result.status} / stderr: ${result.stderr}`);
    assert.match(result.stderr, /\[fatal:uncaughtException\]/);
    assert.match(result.stderr, /first crash - real bug simulation/);

    const outbox = readOutbox(dataDir);
    assert.equal(outbox.length, 1, "exactly one alert email");
    assert.equal(outbox[0].to, ADMIN_EMAIL);
    assert.match(outbox[0].subject, /serverul a picat/);
    assert.match(outbox[0].text, /first crash - real bug simulation/);

    assert.ok(fs.existsSync(path.join(dataDir, ".crash-alert-sent")), "cooldown marker written");
  });

  await t.test("an immediate second crash (crash-loop) does not send a duplicate alert", () => {
    const result = runCrashingServer(dataDir, "second crash - simulated loop");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /second crash - simulated loop/, "still logs every crash, alert or not");

    const outbox = readOutbox(dataDir);
    assert.equal(outbox.length, 1, "cooldown suppressed the second email - still just one");
  });

  await t.test("once the cooldown window has passed, the next crash alerts again", () => {
    const markerPath = path.join(dataDir, ".crash-alert-sent");
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(markerPath, twentyMinutesAgo, twentyMinutesAgo);

    const result = runCrashingServer(dataDir, "third crash - after cooldown");
    assert.equal(result.status, 1);

    const outbox = readOutbox(dataDir);
    assert.equal(outbox.length, 2, "cooldown expired, so this one sends a fresh alert");
    assert.match(outbox[0].text, /third crash - after cooldown/, "outbox is newest-first (unshift)");
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
