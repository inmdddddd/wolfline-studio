const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const email = require("../lib/email.js");

test("isValidEmail accepts well-formed addresses and rejects the rest", () => {
  assert.equal(email.isValidEmail("client@example.com"), true);
  assert.equal(email.isValidEmail("  client@example.com  "), true);
  assert.equal(email.isValidEmail("not-an-email"), false);
  assert.equal(email.isValidEmail(""), false);
  assert.equal(email.isValidEmail(null), false);
  assert.equal(email.isValidEmail(undefined), false);
});

test("isConfigured requires host, user and pass together", () => {
  assert.equal(email.isConfigured({ host: "", user: "", pass: "" }), false);
  assert.equal(email.isConfigured({ host: "smtp.gmail.com", user: "a@b.com", pass: "" }), false);
  assert.equal(email.isConfigured({ host: "smtp.gmail.com", user: "", pass: "secret" }), false);
  assert.equal(email.isConfigured({ host: "smtp.gmail.com", user: "a@b.com", pass: "secret" }), true);
});

test("buildOrderConfirmationEmail includes order details and no internal fields", () => {
  const order = {
    id: "order-id-123",
    number: "BC-0001",
    customerName: "Ana Pop",
    customerEmail: "ana@example.com",
    customerAddress: "Str. Exemplu 1, Cluj",
    status: "confirmed",
    total: 99,
    currency: "GBP",
    items: [{ name: "WLF TEE", size: "M", qty: 2, subtotal: 99, currency: "GBP" }]
  };

  const message = email.buildOrderConfirmationEmail(order, "https://beca-wlf.com/thank-you.html?order=order-id-123");

  assert.equal(message.to, "ana@example.com");
  assert.match(message.subject, /BC-0001/);
  assert.match(message.text, /Ana Pop/);
  assert.match(message.text, /BC-0001/);
  assert.match(message.text, /WLF TEE/);
  assert.match(message.text, /Str\. Exemplu 1, Cluj/);
  assert.match(message.text, /order-id-123/);
});

test("buildOrderStatusEmail uses the Romanian status label", () => {
  const order = {
    id: "order-id-456",
    number: "BC-0002",
    customerName: "Ion Ionescu",
    customerEmail: "ion@example.com",
    status: "shipped",
    items: []
  };

  const message = email.buildOrderStatusEmail(order, "https://beca-wlf.com/thank-you.html?order=order-id-456");

  assert.match(message.subject, /BC-0002/);
  assert.match(message.text, /Expediata/);
});

test("statusLabelRo falls back to the raw status for unknown values", () => {
  assert.equal(email.statusLabelRo("confirmed"), "Confirmata");
  assert.equal(email.statusLabelRo("weird-status"), "weird-status");
});

test("sendMail saves to the local outbox and reports smtp-not-configured when env vars are missing", async (t) => {
  const originalDataDir = process.env.DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beca-email-test-"));
  process.env.DATA_DIR = tempDir;

  const originalEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS
  };
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  t.after(() => {
    process.env.DATA_DIR = originalDataDir;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Force lib/email.js to recompute its data dir with the temp DATA_DIR above.
  delete require.cache[require.resolve("../lib/email.js")];
  const isolatedEmail = require("../lib/email.js");

  const result = await isolatedEmail.sendMail({ to: "client@example.com", subject: "Test", text: "Hello" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "smtp-not-configured");

  const outbox = isolatedEmail.readOutbox();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "client@example.com");
  assert.equal(outbox[0].reason, "smtp-not-configured");

  delete require.cache[require.resolve("../lib/email.js")];
});

test("sendMail rejects invalid recipient addresses without touching the outbox", async () => {
  const result = await email.sendMail({ to: "not-an-email", subject: "Test", text: "Hello" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-recipient");
});
