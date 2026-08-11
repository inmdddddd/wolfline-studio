const test = require("node:test");
const assert = require("node:assert/strict");

// Unit coverage for lib/resend.js in isolation - no server, no network.
// BECA_TEST_MODE is already set by test/setup-env.js's --require preload
// (see package.json's "test" script), so sendEmail() would throw immediately
// unless resendClient.send is stubbed - exactly the structural guarantee
// this file exercises directly (same pattern as test/square.test.js).

const resend = require("../lib/resend");
const originalSend = resend.resendClient.send;

test.afterEach(() => {
  resend.resendClient.send = originalSend;
  delete process.env.RESEND_API_KEY;
});

test("isConfigured is false with no RESEND_API_KEY set", () => {
  assert.equal(resend.isConfigured(), false);
});

test("isConfigured is true once RESEND_API_KEY is set", () => {
  process.env.RESEND_API_KEY = "re_test_key";
  assert.equal(resend.isConfigured(), true);
});

test("sendEmail rejects invalid input before ever touching the network layer", async () => {
  resend.resendClient.send = async () => {
    throw new Error("must not be called for invalid input");
  };

  assert.deepEqual(await resend.sendEmail({}), { ok: false, reason: "invalid-input" });
  assert.deepEqual(await resend.sendEmail({ to: "a@example.com", subject: "x" }), { ok: false, reason: "invalid-input" });
  assert.deepEqual(await resend.sendEmail({ to: "a@example.com", html: "<p>x</p>" }), { ok: false, reason: "invalid-input" });
});

test("sendEmail refuses to run under BECA_TEST_MODE when resendClient.send was never stubbed", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  resend.resendClient.send = originalSend; // explicit: simulate "forgot to stub"

  await assert.rejects(
    () => resend.sendEmail({ to: "a@example.com", subject: "Test", text: "hello" }),
    /BECA_TEST_MODE/
  );
});

test("sendEmail reports resend-not-configured without ever calling resendClient.send", async () => {
  resend.resendClient.send = async () => {
    throw new Error("must not be called when Resend is not configured");
  };

  const result = await resend.sendEmail({ to: "a@example.com", subject: "Test", text: "hello" });
  assert.deepEqual(result, { ok: false, reason: "resend-not-configured" });
});

test("sendEmail returns ok:true with the id on a stubbed success, and forwards the right payload", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  let received = null;
  resend.resendClient.send = async (payload) => {
    received = payload;
    return { id: "email-id-123" };
  };

  const result = await resend.sendEmail({ to: "buyer@example.com", subject: "Comanda ta", html: "<p>Salut</p>" });

  assert.deepEqual(result, { ok: true, id: "email-id-123" });
  assert.deepEqual(received, { to: "buyer@example.com", subject: "Comanda ta", html: "<p>Salut</p>", text: undefined, from: undefined });
});

test("sendEmail passes through a custom from address instead of the default", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  let received = null;
  resend.resendClient.send = async (payload) => {
    received = payload;
    return { id: "email-id-456" };
  };

  await resend.sendEmail({ to: "buyer@example.com", subject: "x", text: "y", from: "Support <support@beca-wlf.com>" });
  assert.equal(received.from, "Support <support@beca-wlf.com>");
});

test("sendEmail returns a safe, fixed reason (not the raw error) when the send throws", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  resend.resendClient.send = async () => {
    throw new Error("Some internal detail that should not leak to the caller");
  };

  const result = await resend.sendEmail({ to: "buyer@example.com", subject: "x", text: "y" });
  assert.deepEqual(result, { ok: false, reason: "resend-send-failed" });
});

test("DEFAULT_FROM matches the required sender", () => {
  assert.equal(resend.DEFAULT_FROM, "BECA <orders@beca-wlf.com>");
});
