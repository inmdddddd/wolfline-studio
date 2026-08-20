const tls = require("tls");
const fs = require("fs");
const path = require("path");
const resendService = require("./resend");

// This module is required independently by server.js and by tests, so it
// resolves its own DATA_DIR and brand config from process.env rather than
// having them passed in - both must derive them the exact same way server.js
// does, or the two would silently disagree about the default DATA_DIR when
// BRAND is set without an explicit DATA_DIR override.
const projectRoot = path.join(__dirname, "..");
const BRAND_ID = String(process.env.BRAND || "beca").trim().toLowerCase();

function loadBrandConfig(brandId) {
  const configPath = path.join(projectRoot, "config", "brands", `${brandId}.json`);
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Nu pot incarca configul de brand pentru "${brandId}" (${configPath}): ${error.message}`);
  }
}

const BRAND = loadBrandConfig(BRAND_ID);

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, BRAND_ID === "beca" ? "data" : `data-${BRAND_ID}`);
const outboxPath = path.join(dataDir, "email-outbox.json");
const MAX_OUTBOX_ENTRIES = 200;
const SMTP_TIMEOUT_MS = 15000;

const STATUS_LABELS_RO = {
  pending: "In asteptare",
  confirmed: "Confirmata",
  processing: "In procesare",
  shipped: "Expediata",
  delivered: "Livrata",
  cancelled: "Anulata"
};

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getConfig() {
  return {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== "false",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
    replyTo: process.env.MAIL_REPLY_TO || process.env.SMTP_USER || ""
  };
}

// Never include config.pass in anything returned, logged or thrown below.
function isConfigured(config) {
  return Boolean(config.host && config.user && config.pass);
}

function readOutbox() {
  try {
    return JSON.parse(fs.readFileSync(outboxPath, "utf8"));
  } catch {
    return [];
  }
}

function writeOutbox(entries) {
  const tempPath = `${outboxPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2));
  fs.renameSync(tempPath, outboxPath);
}

function saveToOutbox(message, reason) {
  try {
    const entries = readOutbox();
    entries.unshift({
      to: message.to,
      subject: message.subject,
      text: message.text,
      reason,
      createdAt: new Date().toISOString()
    });
    writeOutbox(entries.slice(0, MAX_OUTBOX_ENTRIES));
  } catch (error) {
    console.error("[email] Nu am putut salva mesajul in outbox local:", error.message);
  }
}

function encodeSubject(subject) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function formatFromHeader(config) {
  const raw = config.from || config.user;
  if (/<[^>]+>/.test(raw)) return raw;
  const emailMatch = raw.match(/[^\s<>]+@[^\s<>]+/);
  if (emailMatch && emailMatch[0].trim() !== raw.trim()) {
    const name = raw.replace(emailMatch[0], "").trim();
    return name ? `${name} <${emailMatch[0]}>` : emailMatch[0];
  }
  return raw;
}

function normalizeLineEndings(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

function dotStuff(text) {
  return text.split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}

function buildMimeMessage(config, message) {
  const headers = [
    `From: ${formatFromHeader(config)}`,
    `To: ${message.to}`,
    `Reply-To: ${config.replyTo}`,
    `Subject: ${encodeSubject(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    `Date: ${new Date().toUTCString()}`
  ].join("\r\n");

  const body = dotStuff(normalizeLineEndings(message.text));
  return `${headers}\r\n\r\n${body}\r\n`;
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    }

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\r\n")) return;
      const lines = buffer.split("\r\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(lastLine)) return;
      cleanup();
      resolve({ code: Number(lastLine.slice(0, 3)), lines });
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

function writeSmtpLine(socket, line) {
  socket.write(`${line}\r\n`);
}

async function expectSmtp(socket, expectedCodes) {
  const response = await readSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    // response.lines come from the SMTP server only - never contains our SMTP_PASS.
    throw new Error(`Raspuns SMTP neasteptat (${response.code}): ${response.lines[response.lines.length - 1]}`);
  }
  return response;
}

function sendViaSmtp(config, message) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: config.host, port: config.port, servername: config.host });
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }

    socket.setTimeout(SMTP_TIMEOUT_MS, () => finish(new Error("Timeout la conectarea SMTP.")));
    socket.once("error", (error) => finish(error));

    socket.once("secureConnect", async () => {
      try {
        await expectSmtp(socket, [220]);

        writeSmtpLine(socket, `EHLO ${config.host}`);
        await expectSmtp(socket, [250]);

        writeSmtpLine(socket, "AUTH LOGIN");
        await expectSmtp(socket, [334]);
        writeSmtpLine(socket, Buffer.from(config.user, "utf8").toString("base64"));
        await expectSmtp(socket, [334]);
        writeSmtpLine(socket, Buffer.from(config.pass, "utf8").toString("base64"));
        await expectSmtp(socket, [235]);

        writeSmtpLine(socket, `MAIL FROM:<${config.user}>`);
        await expectSmtp(socket, [250]);

        writeSmtpLine(socket, `RCPT TO:<${message.to}>`);
        await expectSmtp(socket, [250, 251]);

        writeSmtpLine(socket, "DATA");
        await expectSmtp(socket, [354]);

        socket.write(buildMimeMessage(config, message));
        writeSmtpLine(socket, ".");
        await expectSmtp(socket, [250]);

        writeSmtpLine(socket, "QUIT");
        finish();
      } catch (error) {
        finish(error);
      }
    });
  });
}

async function sendMail({ to, subject, text }) {
  if (!isValidEmail(to)) {
    console.error("[email] Adresa destinatarului este invalida, mesajul nu a fost trimis.");
    return { ok: false, reason: "invalid-recipient" };
  }

  const message = { to: to.trim(), subject: String(subject || "").trim(), text: String(text || "") };

  // Resend is the preferred channel whenever RESEND_API_KEY is set - every
  // existing caller (checkout, order status transitions, Square payment/
  // refund confirmations, password reset, etc.) picks this up automatically,
  // no call site changes needed. Falls through to the SMTP path below only
  // when Resend isn't configured at all, so this can never make an already-
  // working SMTP setup worse - it can only add a working channel where SMTP
  // was broken or unset.
  if (resendService.isConfigured()) {
    const result = await resendService.sendEmail({ to: message.to, subject: message.subject, text: message.text });
    if (!result.ok) saveToOutbox(message, result.reason);
    return result;
  }

  const config = getConfig();

  if (!isConfigured(config)) {
    saveToOutbox(message, "smtp-not-configured");
    return { ok: false, reason: "smtp-not-configured" };
  }

  try {
    await sendViaSmtp(config, message);
    return { ok: true };
  } catch (error) {
    // error.message is built only from our own text and the SMTP server's response lines,
    // so it can never contain SMTP_PASS - safe to log as-is.
    console.error("[email] Trimiterea a esuat:", error.message);
    saveToOutbox(message, "send-failed");
    return { ok: false, reason: "send-failed" };
  }
}

function statusLabelRo(status) {
  return STATUS_LABELS_RO[status] || status;
}

function formatOrderItemsList(order) {
  return (order.items || [])
    .map((item) => `- ${item.qty} x ${item.name}${item.size ? ` (${item.size})` : ""} - ${item.subtotal} ${item.currency}`)
    .join("\n");
}

// Sent right after checkout. There is no payment processor yet, so checkout
// only REGISTERS an order request - this email must say "received", never
// "confirmed"/"payment confirmed". language defaults to "ro" (this file's
// original, still the default language on a fresh install) so every
// existing call site that doesn't pass one keeps behaving identically;
// anything other than "en" falls back to Romanian too, same "unknown input
// degrades to the safe known default" posture as the rest of this session's
// language handling.
function buildOrderReceivedEmail(order, orderUrl, invoiceUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `We've received your ${BRAND.brandShortName} order. It will be reviewed and confirmed by our team.`,
      "",
      `Order number: ${order.number}`,
      order.discount ? `Discount (${order.couponCode || "coupon"}): -${order.discount} ${order.currency}` : null,
      `Total: ${order.total} ${order.currency}`,
      "",
      "Items:",
      formatOrderItemsList(order),
      "",
      `Shipping to: ${order.customerAddress}`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      invoiceUrl ? "" : null,
      invoiceUrl ? "Order summary (you can save it as a PDF from your browser):" : null,
      invoiceUrl || null,
      "",
      `Thank you for choosing ${BRAND.brandShortName}.`,
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: `Your ${BRAND.brandShortName} order ${order.number} has been received`, text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Am primit comanda ta ${BRAND.brandShortName}. Comanda va fi verificata si confirmata de echipa noastra.`,
    "",
    `Numar comanda: ${order.number}`,
    order.discount ? `Reducere (${order.couponCode || "cupon"}): -${order.discount} ${order.currency}` : null,
    `Total: ${order.total} ${order.currency}`,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Livrare la: ${order.customerAddress}`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    invoiceUrl ? "" : null,
    invoiceUrl ? "Rezumatul comenzii (poti salva ca PDF din browser):" : null,
    invoiceUrl || null,
    "",
    `Multumim ca ai ales ${BRAND.brandShortName}.`,
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} a fost primita`, text };
}

// Internal ops notification, not a customer-lifecycle email - always
// Romanian (every admin surface in this codebase is), never routed through
// the admin-editable email_templates override system the 8 customer emails
// use (nothing customer-facing to reword here), and sent once per admin
// recipient by the caller (sendMail's `to` is a single address, not a
// list - see server.js's checkout handler).
function buildAdminNewOrderEmail(order, adminUrl) {
  const text = [
    `Comanda noua ${BRAND.brandShortName}: ${order.number}`,
    "",
    `Client: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    `Telefon: ${order.customerPhone}`,
    "",
    `Total: ${order.total} ${order.currency}`,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Livrare la: ${order.customerAddress}`,
    "",
    "Vezi comanda in admin:",
    adminUrl
  ].join("\n");

  return { subject: `Comanda noua ${BRAND.brandShortName}: ${order.number} (${order.total} ${order.currency})`, text };
}

function buildCrashAlertEmail(error, context) {
  const text = [
    `Serverul ${BRAND.brandShortName} a intampinat o eroare neasteptata si s-a oprit.`,
    "",
    `Mesaj: ${error && error.message ? error.message : String(error)}`,
    `Tip: ${context || "uncaughtException"}`,
    "",
    "pm2 il reporneste automat, dar daca acest email vine repetat, ceva ramane stricat intre restarturi si merita verificat direct pe server (pm2 logs).",
    "",
    (error && error.stack) ? error.stack.split("\n").slice(0, 10).join("\n") : ""
  ].join("\n");

  return { subject: `${BRAND.brandShortName}: serverul a picat neasteptat`, text };
}

function buildOrderConfirmationEmail(order, orderUrl, invoiceUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `Your ${BRAND.brandShortName} order has been confirmed.`,
      "",
      `Order number: ${order.number}`,
      order.discount ? `Discount (${order.couponCode || "coupon"}): -${order.discount} ${order.currency}` : null,
      `Total: ${order.total} ${order.currency}`,
      "",
      "Items:",
      formatOrderItemsList(order),
      "",
      `Shipping to: ${order.customerAddress}`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      invoiceUrl ? "" : null,
      invoiceUrl ? "Order invoice (you can save it as a PDF from your browser):" : null,
      invoiceUrl || null,
      "",
      `Thank you for choosing ${BRAND.brandShortName}.`,
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: `Your ${BRAND.brandShortName} order ${order.number} has been confirmed`, text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Comanda ta ${BRAND.brandShortName} a fost confirmata.`,
    "",
    `Numar comanda: ${order.number}`,
    order.discount ? `Reducere (${order.couponCode || "cupon"}): -${order.discount} ${order.currency}` : null,
    `Total: ${order.total} ${order.currency}`,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Livrare la: ${order.customerAddress}`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    invoiceUrl ? "" : null,
    invoiceUrl ? "Factura comenzii (poti salva ca PDF din browser):" : null,
    invoiceUrl || null,
    "",
    `Multumim ca ai ales ${BRAND.brandShortName}.`,
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} a fost confirmata`, text };
}

// Sent once a Square charge actually settles (sync pay route or webhook,
// whichever gets there first - see settlePaidSquarePayment in server.js).
// Unlike buildOrderReceivedEmail this can say "confirmed", not just
// "received": money has genuinely changed hands by the time this is built.
function buildPaymentConfirmedEmail(order, orderUrl, invoiceUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `We've received payment for your ${BRAND.brandShortName} order ${order.number}. Your order is confirmed and now being prepared.`,
      "",
      `Order number: ${order.number}`,
      order.discount ? `Discount (${order.couponCode || "coupon"}): -${order.discount} ${order.currency}` : null,
      `Total paid: ${order.total} ${order.currency}`,
      "",
      "Items:",
      formatOrderItemsList(order),
      "",
      `Shipping to: ${order.customerAddress}`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      invoiceUrl ? "" : null,
      invoiceUrl ? "Order invoice (you can save it as a PDF from your browser):" : null,
      invoiceUrl || null,
      "",
      `Thank you for choosing ${BRAND.brandShortName}.`,
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: `Payment confirmed - ${BRAND.brandShortName} order ${order.number}`, text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Am primit plata pentru comanda ta ${BRAND.brandShortName} ${order.number}. Comanda este confirmata si intra in pregatire.`,
    "",
    `Numar comanda: ${order.number}`,
    order.discount ? `Reducere (${order.couponCode || "cupon"}): -${order.discount} ${order.currency}` : null,
    `Total platit: ${order.total} ${order.currency}`,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Livrare la: ${order.customerAddress}`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    invoiceUrl ? "" : null,
    invoiceUrl ? "Factura comenzii (poti salva ca PDF din browser):" : null,
    invoiceUrl || null,
    "",
    `Multumim ca ai ales ${BRAND.brandShortName}.`,
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Plata confirmata - comanda ${BRAND.brandShortName} ${order.number}`, text };
}

// Sent right after an admin triggers a Square refund on a paid order (see
// the admin order-update route). Square's own RefundPayment call typically
// returns status PENDING, not COMPLETED - this email is sent on Square
// accepting the request, not on final settlement, same latitude the rest of
// this app already gives paymentStatus (an admin-controlled label, not a
// verified-settled fact even for non-Square orders).
function buildRefundConfirmedEmail(order, refundAmount, orderUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `We've processed a refund for your ${BRAND.brandShortName} order ${order.number}.`,
      "",
      `Amount refunded: ${refundAmount} ${order.currency}`,
      "",
      "The refund may take a few business days to appear on your account or card, depending on your bank.",
      "",
      `If you have any questions, reach out to us at ${BRAND.supportEmail}.`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      "",
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: `Refund processed - ${BRAND.brandShortName} order ${order.number}`, text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Am procesat o rambursare pentru comanda ta ${BRAND.brandShortName} ${order.number}.`,
    "",
    `Suma rambursata: ${refundAmount} ${order.currency}`,
    "",
    "Rambursarea poate dura cateva zile lucratoare pana apare pe contul sau cardul tau, in functie de banca.",
    "",
    `Daca ai intrebari, scrie-ne la ${BRAND.supportEmail}.`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Rambursare procesata - comanda ${BRAND.brandShortName} ${order.number}`, text };
}

function buildPasswordResetEmail(user, resetUrl) {
  const text = [
    `Salut ${user.name},`,
    "",
    `Am primit o cerere de resetare a parolei pentru contul tau ${BRAND.brandShortName}.`,
    "",
    "Acceseaza linkul de mai jos ca sa iti setezi o parola noua (valabil 1 ora):",
    resetUrl,
    "",
    "Daca nu ai cerut tu resetarea, poti ignora acest email - parola ta ramane neschimbata.",
    "",
    `Echipa ${BRAND.brandShortName}`
  ].join("\n");

  return { to: user.email, subject: `Resetare parola ${BRAND.brandShortName}`, text };
}

function buildVerificationEmail(user, verifyUrl) {
  const text = [
    `Salut ${user.name},`,
    "",
    `Multumim ca ti-ai creat cont pe ${BRAND.brandShortName}. Confirma adresa de email accesand linkul de mai jos (valabil 48 de ore):`,
    verifyUrl,
    "",
    "Daca nu ai creat tu acest cont, poti ignora acest email.",
    "",
    `Echipa ${BRAND.brandShortName}`
  ].join("\n");

  return { to: user.email, subject: `Confirma emailul pentru contul ${BRAND.brandShortName}`, text };
}

function buildAbandonedCartEmail(cart, cartPayload, cartUrl) {
  const itemsList = (cartPayload.items || [])
    .map((item) => `- ${item.qty} x ${item.product.name}${item.size ? ` (${item.size})` : ""}`)
    .join("\n");

  const text = [
    "Salut,",
    "",
    `Ai lasat cateva piese in cosul ${BRAND.brandShortName}. Inca sunt rezervate pentru tine cat timp mai sunt pe stoc.`,
    "",
    "In cos:",
    itemsList,
    "",
    `Total: ${cartPayload.total} ${cartPayload.currency}`,
    "",
    "Continua de unde ai ramas:",
    cartUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].join("\n");

  return { to: cart.email, subject: `Ti-a ramas cosul neterminat pe ${BRAND.brandShortName}`, text };
}

function buildDropLiveEmail(entry, product, productUrl) {
  const text = [
    `Salut ${entry.name || ""},`.trim(),
    "",
    `${product.name} este acum live pe ${BRAND.brandShortName}.`,
    entry.preferredSize ? `Ai fost interesat de marimea ${entry.preferredSize} - verifica stocul cat mai repede, piesele sunt limitate.` : "Stocul este limitat.",
    "",
    "Vezi produsul aici:",
    productUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].join("\n");

  return { to: entry.email, subject: `${product.name} este acum disponibil pe ${BRAND.brandShortName}`, text };
}

function buildOrderStatusEmail(order, orderUrl, invoiceUrl) {
  const text = [
    `Salut ${order.customerName},`,
    "",
    `Statusul comenzii tale ${BRAND.brandShortName} ${order.number} a fost actualizat la: ${statusLabelRo(order.status)}.`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    invoiceUrl ? "" : null,
    invoiceUrl ? "Factura comenzii:" : null,
    invoiceUrl || null,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number}: status actualizat`, text };
}

// NOTE (this session): these last 4 functions' subject lines were already
// hardcoded English while their body text was Romanian - a pre-existing
// mismatch, not something introduced here. Adding a real language param
// fixes it as a side effect: the "ro" branch now gets a proper Romanian
// subject to match its body, and "en" gets a fully English email.
function buildOrderProcessingEmail(order, orderUrl, language = "ro") {
  const customerNote = order.fulfillment && order.fulfillment.customerNote;
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `Your ${BRAND.brandShortName} order ${order.number} is being processed - we're preparing it for shipment.`,
      customerNote ? "" : null,
      customerNote ? `Note: ${customerNote}` : null,
      "",
      "Items:",
      formatOrderItemsList(order),
      "",
      `Total: ${order.total} ${order.currency}`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      "",
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: "Your order is being processed", text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Comanda ta ${BRAND.brandShortName} ${order.number} este in curs de procesare - o pregatim pentru expediere.`,
    customerNote ? "" : null,
    customerNote ? `Nota: ${customerNote}` : null,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Total: ${order.total} ${order.currency}`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} este in procesare`, text };
}

function buildOrderShippedEmail(order, orderUrl, language = "ro") {
  const fulfillment = order.fulfillment || {};
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `Your ${BRAND.brandShortName} order ${order.number} has been shipped.`,
      "",
      fulfillment.courierName ? `Courier: ${fulfillment.courierName}` : null,
      fulfillment.trackingNumber ? `Tracking / AWB: ${fulfillment.trackingNumber}` : null,
      fulfillment.trackingUrl ? `Tracking link: ${fulfillment.trackingUrl}` : null,
      fulfillment.estimatedDeliveryDate ? `Estimated delivery date: ${fulfillment.estimatedDeliveryDate}` : null,
      fulfillment.customerNote ? "" : null,
      fulfillment.customerNote ? `Note: ${fulfillment.customerNote}` : null,
      "",
      "Items:",
      formatOrderItemsList(order),
      "",
      "You can view your order details anytime here:",
      orderUrl,
      "",
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: "Your order has been shipped", text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Comanda ta ${BRAND.brandShortName} ${order.number} a fost expediata.`,
    "",
    fulfillment.courierName ? `Curier: ${fulfillment.courierName}` : null,
    fulfillment.trackingNumber ? `AWB / tracking: ${fulfillment.trackingNumber}` : null,
    fulfillment.trackingUrl ? `Link tracking: ${fulfillment.trackingUrl}` : null,
    fulfillment.estimatedDeliveryDate ? `Data estimata de livrare: ${fulfillment.estimatedDeliveryDate}` : null,
    fulfillment.customerNote ? "" : null,
    fulfillment.customerNote ? `Nota: ${fulfillment.customerNote}` : null,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} a fost expediata`, text };
}

function buildOrderDeliveredEmail(order, orderUrl, reviewUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `Your ${BRAND.brandShortName} order ${order.number} has been delivered successfully. Thank you for choosing ${BRAND.brandShortName}!`,
      reviewUrl ? "" : null,
      reviewUrl ? "It would help us a lot if you left a review of the piece you received:" : null,
      reviewUrl || null,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      "",
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: "Your order was delivered", text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Comanda ta ${BRAND.brandShortName} ${order.number} a fost livrata cu succes. Multumim ca ai ales ${BRAND.brandShortName}!`,
    reviewUrl ? "" : null,
    reviewUrl ? "Ne-ar ajuta enorm o recenzie despre piesa primita:" : null,
    reviewUrl || null,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} a fost livrata`, text };
}

function buildOrderCancelledEmail(order, orderUrl, language = "ro") {
  if (language === "en") {
    const text = [
      `Hi ${order.customerName},`,
      "",
      `Your ${BRAND.brandShortName} order ${order.number} has been cancelled.`,
      order.cancellationReason ? `Reason: ${order.cancellationReason}` : null,
      "",
      `If you have any questions, reach out to us at ${BRAND.supportEmail}.`,
      "",
      "You can view your order details anytime here:",
      orderUrl,
      "",
      `The ${BRAND.brandShortName} team`
    ].filter((line) => line !== null).join("\n");

    return { to: order.customerEmail, subject: "Your order was cancelled", text };
  }

  const text = [
    `Salut ${order.customerName},`,
    "",
    `Comanda ta ${BRAND.brandShortName} ${order.number} a fost anulata.`,
    order.cancellationReason ? `Motiv: ${order.cancellationReason}` : null,
    "",
    `Daca ai intrebari, scrie-ne la ${BRAND.supportEmail}.`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    `Echipa ${BRAND.brandShortName}`
  ].filter((line) => line !== null).join("\n");

  return { to: order.customerEmail, subject: `Comanda ta ${BRAND.brandShortName} ${order.number} a fost anulata`, text };
}

function sendOrderProcessingEmail(order, orderUrl) {
  return sendMail(buildOrderProcessingEmail(order, orderUrl));
}

function sendOrderShippedEmail(order, orderUrl) {
  return sendMail(buildOrderShippedEmail(order, orderUrl));
}

function sendOrderDeliveredEmail(order, orderUrl, reviewUrl) {
  return sendMail(buildOrderDeliveredEmail(order, orderUrl, reviewUrl));
}

function sendOrderCancelledEmail(order, orderUrl) {
  return sendMail(buildOrderCancelledEmail(order, orderUrl));
}

function sendPaymentConfirmedEmail(order, orderUrl, invoiceUrl) {
  return sendMail(buildPaymentConfirmedEmail(order, orderUrl, invoiceUrl));
}

function sendRefundConfirmedEmail(order, refundAmount, orderUrl) {
  return sendMail(buildRefundConfirmedEmail(order, refundAmount, orderUrl));
}

module.exports = {
  isValidEmail,
  getConfig,
  isConfigured,
  sendMail,
  buildOrderReceivedEmail,
  buildAdminNewOrderEmail,
  buildCrashAlertEmail,
  buildOrderConfirmationEmail,
  buildOrderStatusEmail,
  buildOrderProcessingEmail,
  buildOrderShippedEmail,
  buildOrderDeliveredEmail,
  buildOrderCancelledEmail,
  sendOrderProcessingEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
  buildPaymentConfirmedEmail,
  buildRefundConfirmedEmail,
  sendPaymentConfirmedEmail,
  sendRefundConfirmedEmail,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildAbandonedCartEmail,
  buildDropLiveEmail,
  statusLabelRo,
  readOutbox
};
