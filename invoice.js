(function () {
  const root = document.querySelector("[data-invoice-root]");
  if (!root) return;

  function money(value, currency) {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
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
        <h1>Factura nu a fost gasita.</h1>
        <p>Linkul poate fi incomplet sau comanda nu mai exista.</p>
        <a href="/">Inapoi acasa</a>
      </div>
    `;
  }

  function brandName() {
    return document.querySelector('meta[name="brand-name"]')?.content || "BeCa";
  }

  function brandSupportEmail() {
    return document.querySelector('meta[name="brand-support-email"]')?.content || "contact@beca-wlf.com";
  }

  function renderInvoice(order, content) {
    const merchantBody = (content.ro && content.ro["support.merchant.body"]) || "";
    const supportEmail = (content.ro && content.ro["support.email"]) || brandSupportEmail();
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
            <h1>Factura</h1>
            <p>Numar: <strong>${escapeHtml(order.number)}</strong></p>
            <p>Data: ${escapeHtml(new Date(order.createdAt).toLocaleDateString("ro-RO"))}</p>
            <p>Status: ${escapeHtml(order.status)}</p>
          </div>
          <div class="invoice-doc-from">
            <strong>${escapeHtml(brandName())}</strong>
            <p>${escapeHtml(merchantBody)}</p>
            <p>${escapeHtml(supportEmail)}</p>
          </div>
        </div>

        <div class="invoice-doc-to">
          <strong>Facturat catre</strong>
          <p>${escapeHtml(order.customerName)}</p>
          <p>${escapeHtml(order.customerEmail || "")}</p>
          <p>${escapeHtml(order.customerPhone || "")}</p>
          <p>${escapeHtml(order.customerAddress)}</p>
        </div>

        <table class="invoice-doc-table">
          <thead>
            <tr><th>Produs</th><th>Cant.</th><th>Pret</th><th>Subtotal</th></tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>

        <div class="invoice-doc-totals">
          <div><span>Subtotal</span><strong>${escapeHtml(money(subtotal, order.currency))}</strong></div>
          ${order.discount ? `<div><span>Reducere${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ""}</span><strong>-${escapeHtml(money(order.discount, order.currency))}</strong></div>` : ""}
          <div class="invoice-doc-total-final"><span>Total</span><strong>${escapeHtml(money(order.total, order.currency))}</strong></div>
        </div>

        <p class="invoice-doc-note">Acest document este generat automat si serveste ca dovada a comenzii. Daca ai nevoie de o factura fiscala completa, contacteaza-ne la ${escapeHtml(supportEmail)}.</p>
      </div>
    `;
  }

  const orderId = new URLSearchParams(window.location.search).get("order");

  if (!orderId) {
    renderNotFound();
    return;
  }

  Promise.all([
    fetch(`/api/orders/${encodeURIComponent(orderId)}`).then((response) => {
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
