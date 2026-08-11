const { Resend } = require("resend");

/* Transactional email via Resend (https://resend.com). This is a NEW,
   separate service - it does not touch lib/email.js (the existing raw-SMTP
   sender) or any of its call sites. Nothing currently wired to lib/email.js
   changes behavior because this file exists.

   RESEND_API_KEY is read exclusively from process.env - no brandEnv()
   scoping, no fallback, per explicit requirement. Never log it: the SDK
   only ever sends it as an Authorization header and never echoes it back in
   responses or errors (verified against the installed SDK source), but this
   module also never logs a raw error/response object either, only .message
   strings, so a future SDK change couldn't introduce a leak here either.

   Order-lifecycle templates (received, payment confirmed, processing,
   shipped, delivered) are intentionally NOT built yet - add them the same
   way lib/email.js does: a buildXEmail(order, ...) function that returns
   {to, subject, html, text}, plus a thin sendXEmail() wrapper calling
   sendEmail() below. */

const DEFAULT_FROM = "BECA <orders@beca-wlf.com>";

function apiKey() {
  return process.env.RESEND_API_KEY || "";
}

function isConfigured() {
  return Boolean(apiKey());
}

// new Resend(key) throws synchronously if key is falsy (and process.env
// also has nothing) - this must only ever be reached after isConfigured()
// has already been checked by the caller (see sendEmail below).
let cachedClient = null;
let cachedKey = null;
function client() {
  const key = apiKey();
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Resend(key);
    cachedKey = key;
  }
  return cachedClient;
}

// Low-level primitive, isolated behind resendClient.send (not a local
// function reference) so tests can replace it with a stub - createPayment/
// refundPayment in lib/square.js use the identical pattern. guardTestMode()
// below detects "nobody stubbed it" by identity comparison against this
// function.
async function realSend({ to, subject, html, text, from }) {
  const { data, error } = await client().emails.send({
    from: from || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {})
  });
  if (error) {
    const wrapped = new Error(error.message || "Resend a returnat o eroare.");
    wrapped.resendErrorName = error.name;
    throw wrapped;
  }
  return { id: data?.id };
}

const resendClient = { send: realSend };

// BECA_TEST_MODE is a hard stop, the same shape as lib/square.js's own
// guard: if a test forgets to stub resendClient.send, any real call throws
// immediately instead of letting the SDK attempt a live network request.
function guardTestMode() {
  if (process.env.BECA_TEST_MODE && resendClient.send === realSend) {
    throw new Error(
      "[resend] BECA_TEST_MODE este activ si resendClient.send nu a fost inlocuit cu un stub. " +
      "Testele nu trebuie sa poata trimite emailuri reale - vezi test/resend.test.js pentru pattern."
    );
  }
}

// to: string or array of strings. Requires html and/or text (Resend needs
// at least one). Returns {ok:true, id} or {ok:false, reason} - reason is
// always a short machine-readable string, safe to log or store, never a raw
// error/response object.
async function sendEmail({ to, subject, html, text, from } = {}) {
  if (!to || !subject || (!html && !text)) {
    return { ok: false, reason: "invalid-input" };
  }

  guardTestMode();

  if (!isConfigured()) {
    console.error("[resend] RESEND_API_KEY nu este setat - email netrimis catre", Array.isArray(to) ? to.join(", ") : to);
    return { ok: false, reason: "resend-not-configured" };
  }

  try {
    const result = await resendClient.send({ to, subject, html, text, from });
    return { ok: true, id: result.id };
  } catch (error) {
    // error.message only - never the raw error/response object, and the
    // SDK never puts the API key in either, but this keeps it safe even if
    // that ever changed upstream.
    console.error("[resend] Trimiterea a esuat:", error.message || "eroare necunoscuta");
    return { ok: false, reason: "resend-send-failed" };
  }
}

module.exports = {
  sendEmail,
  isConfigured,
  DEFAULT_FROM,
  resendClient
};
