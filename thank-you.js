(function () {
  const root = document.querySelector("[data-thank-you-root]");
  if (!root) return;

  function text(key, fallback, replacements) {
    return window.BecaRegion?.text?.(key, replacements) || fallback;
  }

  function money(value, currency) {
    return window.BecaRegion?.money?.(value, currency) || `${currency} ${Number(value || 0).toFixed(2)}`;
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
      <section class="info-hero">
        <p class="beca-kicker">${escapeHtml(text("thankYou.kicker", "Order"))}</p>
        <h1>${escapeHtml(text("thankYou.notFoundTitle", "We couldn't find that order."))}</h1>
        <p class="info-lede">${escapeHtml(text("thankYou.notFoundBody", "The link may be incomplete or the order no longer exists. Reach out to support if you think this is a mistake."))}</p>
      </section>
      <section class="info-section info-cta">
        <div class="info-cta-actions">
          <a href="/">${escapeHtml(text("thankYou.backHome", "Back to home"))}</a>
        </div>
      </section>
    `;
  }

  function renderOrder(order) {
    const itemsHtml = (order.items || []).map((item) => `
      <article>
        <strong>${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ""}</strong>
        <p>${escapeHtml(item.qty)} &times; ${escapeHtml(money(item.price, item.currency))} = ${escapeHtml(money(item.subtotal, item.currency))}</p>
      </article>
    `).join("");

    root.innerHTML = `
      <section class="info-hero">
        <p class="beca-kicker">${escapeHtml(text("thankYou.kicker", "Order confirmed"))}</p>
        <h1>${escapeHtml(text("thankYou.title", "Your drop is locked in."))}</h1>
        <p class="info-lede">${escapeHtml(text("thankYou.lede", "We've got your order — here's everything for your records."))}</p>
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
          <span>${escapeHtml(text("thankYou.total", "Total"))}</span>
          <strong>${escapeHtml(money(order.total, order.currency))}</strong>
        </div>
      </section>

      <section class="info-section info-cta">
        <h2>${escapeHtml(text("thankYou.viewShop", "Keep exploring"))}</h2>
        <div class="info-cta-actions">
          <a href="/">${escapeHtml(text("thankYou.backHome", "Back to home"))}</a>
          <a href="/invoice.html?order=${encodeURIComponent(order.id)}">${escapeHtml(text("thankYou.invoice", "View invoice"))}</a>
          <a href="/support.html">${escapeHtml(text("thankYou.support", "Need help? Contact support"))}</a>
        </div>
      </section>
    `;
  }

  const orderId = new URLSearchParams(window.location.search).get("order");

  if (!orderId) {
    renderNotFound();
    return;
  }

  fetch(`/api/orders/${encodeURIComponent(orderId)}`)
    .then((response) => {
      if (!response.ok) throw new Error("Order not found");
      return response.json();
    })
    .then(({ order }) => renderOrder(order))
    .catch(() => renderNotFound());
})();
