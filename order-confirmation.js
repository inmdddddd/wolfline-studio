(function () {
  const root = document.querySelector("[data-confirmation-root]");
  if (!root) return;

  function text(key, fallback, replacements) {
    return window.BecaRegion?.text?.(key, replacements) || fallback;
  }

  // Exact mode: the total shown here is what was actually charged, never
  // a live-converted display.
  function money(value, currency) {
    return window.BecaCurrency?.formatExact?.(value, currency) || `${currency} ${Number(value || 0).toFixed(2)}`;
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

  // Never renders a confirmed-looking page for a missing/inaccessible order -
  // the only way to reach renderOrder() below is a successful, authorized
  // GET /api/orders/:id response.
  function renderNotFound() {
    root.innerHTML = `
      <section class="info-hero">
        <p class="beca-kicker">${escapeHtml(text("thankYou.kicker", "Order"))}</p>
        <h1>${escapeHtml(text("thankYou.notFoundTitle", "We couldn't find that order."))}</h1>
        <p class="info-lede">${escapeHtml(text("thankYou.notFoundBody", "The link may be incomplete or the order no longer exists. Reach out to support if you think this is a mistake."))}</p>
      </section>
      <section class="info-section confirmation-cta">
        <a class="btn-gold" href="/">${escapeHtml(text("confirmation.continueShopping", "Continue shopping"))}</a>
      </section>
    `;
  }

  function renderOrder(order, accessToken) {
    const itemsHtml = (order.items || []).map((item) => `
      <article>
        <strong>${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ""}</strong>
        <p>${escapeHtml(item.qty)} &times; ${escapeHtml(money(item.price, item.currency))} = ${escapeHtml(money(item.subtotal, item.currency))}</p>
      </article>
    `).join("");

    const invoiceHref = `/invoice.html?order=${encodeURIComponent(order.id)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ""}`;

    root.innerHTML = `
      <section class="info-hero">
        <div class="confirmation-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
        </div>
        <p class="beca-kicker">${escapeHtml(text("thankYou.kicker", "Order confirmed"))}</p>
        <h1>${escapeHtml(text("confirmation.title", "Order confirmed"))}</h1>
        <p class="info-lede">${escapeHtml(text("confirmation.message", "Thank you — your order has been placed successfully. A confirmation email is on its way."))}</p>
      </section>

      <section class="info-section info-grid">
        <article>
          <strong>${escapeHtml(text("thankYou.orderNumber", "Order number"))}</strong>
          <p>${escapeHtml(order.number)}</p>
        </article>
        <article>
          <strong>${escapeHtml(text("thankYou.status", "Status"))}</strong>
          <p>${escapeHtml(text(`status.${order.status}`, order.status))}</p>
        </article>
        <article>
          <strong>${escapeHtml(text("thankYou.shippingTo", "Shipping to"))}</strong>
          <p>${escapeHtml(order.customerName)}<br>${escapeHtml(order.customerAddress)}</p>
        </article>
      </section>

      <section class="info-section">
        <h2>${escapeHtml(text("thankYou.summary", "Order summary"))}</h2>
        <div class="info-grid thank-you-items">${itemsHtml}</div>
        <div class="thank-you-total-row">
          <span>${escapeHtml(text("confirmation.totalPaid", "Total paid"))}</span>
          <strong>${escapeHtml(money(order.total, order.currency))}</strong>
        </div>
      </section>

      <section class="info-section confirmation-cta">
        <a class="btn-gold" href="/">${escapeHtml(text("confirmation.continueShopping", "Continue shopping"))}</a>
        <p class="confirmation-secondary">
          <a href="${invoiceHref}">${escapeHtml(text("thankYou.invoice", "View invoice"))}</a>
          &middot;
          <a href="/support.html">${escapeHtml(text("thankYou.support", "Need help? Contact support"))}</a>
        </p>
      </section>
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

  fetch(`/api/orders/${encodeURIComponent(orderId)}${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ""}`)
    .then((response) => {
      if (!response.ok) throw new Error("Order not found");
      return response.json();
    })
    .then(({ order }) => renderOrder(order, accessToken))
    .catch(() => renderNotFound());
})();
