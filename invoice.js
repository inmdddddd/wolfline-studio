(function () {
  const root = document.querySelector("[data-invoice-root]");
  if (!root) return;

  // Exact mode: an invoice is a record of what was actually charged, never
  // a live-converted display - zero conversion, ever.
  function money(value, currency) {
    return window.BecaCurrency ? window.BecaCurrency.formatExact(value, currency) : `${currency} ${Number(value || 0).toFixed(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function renderNotFound() {
    root.innerHTML = `
      <div class="invoice-error">
        <h1>Invoice not found.</h1>
        <p>The link may be incomplete or the order no longer exists.</p>
        <a href="/">Back home</a>
      </div>
    `;
  }

  function brandName() {
    return document.querySelector('meta[name="brand-name"]')?.content || "BeCa";
  }

  function brandSupportEmail() {
    return document.querySelector('meta[name="brand-support-email"]')?.content || "contact@beca-wlf.com";
  }

  // Falls back to the same English text script.js's own dictionary carries
  // for this key (see defaultCopy.en["support.merchant.body"]) if no
  // content.json override exists - this file has no locale.js on the page
  // to read that dictionary directly, so the fallback is kept in sync by
  // hand rather than duplicating the whole i18n resolution chain for one
  // string.
  const MERCHANT_BODY_FALLBACK = "BeCa Online shop, a company registered in the United Kingdom, with its registered office at 59 Woodward Road, Rock Ferry, Birkenhead, CH42 1QE, United Kingdom.";

  function renderInvoice(order, content) {
    const merchantBody = (content.en && content.en["support.merchant.body"]) || MERCHANT_BODY_FALLBACK;
    const supportEmail = (content.en && content.en["support.email"]) || brandSupportEmail();
    const subtotal = (order.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);

    const itemsRows = (order.items || []).map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ""}</td>
        <td>${escapeHtml(item.qty)}</td>
        <td>${escapeHtml(money(item.price, item.currency))}</td>
        <td>${escapeHtml(money(item.subtotal, item.currency))}</td>
      </tr>
    `).join("");

    root.innerHTML = `
      <div class="invoice-doc">
        <div class="invoice-doc-head">
          <div>
            <h1>Invoice</h1>
            <p>Number: <strong>${escapeHtml(order.number)}</strong></p>
            <p>Date: ${escapeHtml(new Date(order.createdAt).toLocaleDateString())}</p>
            <p>Status: ${escapeHtml(order.status)}</p>
          </div>
          <div class="invoice-doc-from">
            <strong>${escapeHtml(brandName())}</strong>
            <p>${escapeHtml(merchantBody)}</p>
            <p>${escapeHtml(supportEmail)}</p>
          </div>
        </div>

        <div class="invoice-doc-to">
          <strong>Billed to</strong>
          <p>${escapeHtml(order.customerName)}</p>
          <p>${escapeHtml(order.customerEmail || "")}</p>
          <p>${escapeHtml(order.customerPhone || "")}</p>
          <p>${escapeHtml(order.customerAddress)}</p>
        </div>

        <table class="invoice-doc-table">
          <thead>
            <tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>

        <div class="invoice-doc-totals">
          <div><span>Subtotal</span><strong>${escapeHtml(money(subtotal, order.currency))}</strong></div>
          ${order.discount ? `<div><span>Discount${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ""}</span><strong>-${escapeHtml(money(order.discount, order.currency))}</strong></div>` : ""}
          <div class="invoice-doc-total-final"><span>Total</span><strong>${escapeHtml(money(order.total, order.currency))}</strong></div>
        </div>

        <p class="invoice-doc-note">This document is generated automatically and serves as proof of order. If you need a full tax invoice, contact us at ${escapeHtml(supportEmail)}.</p>
      </div>
    `;
  }

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order");
  // Guest access token issued at checkout; only its hash is stored server-side.
  const accessToken = params.get("token") || "";

  if (!orderId) {
    renderNotFound();
    return;
  }

  Promise.all([
    fetch(`/api/orders/${encodeURIComponent(orderId)}${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ""}`).then((response) => {
      if (!response.ok) throw new Error("Order not found");
      return response.json();
    }),
    fetch("/api/content").then((response) => response.json())
  ])
    .then(([{ order }, content]) => renderInvoice(order, content))
    .catch(() => renderNotFound());

  document.querySelector("[data-invoice-print]")?.addEventListener("click", () => {
    window.print();
  });
})();
