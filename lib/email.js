const tls = require("tls");
const fs = require("fs");
const path = require("path");

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
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

function buildOrderConfirmationEmail(order, orderUrl) {
  const text = [
    `Salut ${order.customerName},`,
    "",
    "Comanda ta BeCa a fost confirmata.",
    "",
    `Numar comanda: ${order.number}`,
    `Total: ${order.total} ${order.currency}`,
    "",
    "Produse:",
    formatOrderItemsList(order),
    "",
    `Livrare la: ${order.customerAddress}`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    "Multumim ca ai ales BeCa.",
    "Echipa BeCa"
  ].join("\n");

  return { to: order.customerEmail, subject: `Comanda ta BeCa ${order.number} a fost confirmata`, text };
}

function buildOrderStatusEmail(order, orderUrl) {
  const text = [
    `Salut ${order.customerName},`,
    "",
    `Statusul comenzii tale BeCa ${order.number} a fost actualizat la: ${statusLabelRo(order.status)}.`,
    "",
    "Poti vedea oricand detaliile comenzii aici:",
    orderUrl,
    "",
    "Echipa BeCa"
  ].join("\n");

  return { to: order.customerEmail, subject: `Comanda ta BeCa ${order.number}: status actualizat`, text };
}

module.exports = {
  isValidEmail,
  getConfig,
  isConfigured,
  sendMail,
  buildOrderConfirmationEmail,
  buildOrderStatusEmail,
  statusLabelRo,
  readOutbox
};
