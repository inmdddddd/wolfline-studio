// Preloaded via `node --test --require ./test/setup-env.js` (see
// package.json's "test" script) - runs once per test file (node:test runs
// each file as its own process), before that file's own code.
//
// server.js's own .env loader fills any process.env key that's completely
// ABSENT at require time from the real .env file sitting next to it
// (`if (!(key in process.env)) process.env[key] = value`). That's exactly
// right for a real deploy, but it means running the test suite from inside
// an actual deployment - where a real .env with real secrets exists - lets
// any test that ever clears a var (most do, resetting state between
// scenarios via `delete process.env.X` + a fresh require) silently pull the
// real value back in on its NEXT require("./server.js"), regardless of what
// that one test file sets for itself. Two concrete incidents this caused:
// `npm test` created a beca.db in the live DATA_DIR (a test that only needed
// server.js's exported pure functions never touched DATA_DIR at all), and
// NODE_ENV=production leaking in - via a `delete process.env.NODE_ENV` reset
// pattern used between sub-tests in one file - made validateStartupConfig()
// enforce production-only checks (a real SITE_ORIGIN, a real ADMIN_PASSWORD)
// against scenarios no test ever intended to run in production mode.
//
// BECA_TEST_MODE is the fix: server.js checks it and skips reading the real
// .env file entirely for the rest of this process, however many times a
// test deletes/re-sets individual keys afterward - a hard stop, not a
// per-key allowlist, so there's no specific variable to remember to guard.
//
// Deliberately NOT presetting DATA_DIR/DATA_DIR_AETHER here too: a couple of
// existing brand-isolation tests specifically exercise what happens when
// DATA_DIR_AETHER is *unset* (falls back to the bare DATA_DIR) - a file-wide
// default would win over that intentional gap via brandEnv()'s scoping and
// break the exact behavior those tests check. BECA_TEST_MODE alone already
// removes the only way an unset DATA_DIR could resolve to something real;
// each test file still sets its own tempdir DATA_DIR as before.
process.env.BECA_TEST_MODE = "1";
process.env.NODE_ENV = "test";
