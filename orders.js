(function () {
  const root = document.querySelector("[data-orders-root]");
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

  function renderEmpty() {
    root.innerHTML = `
      <div class="orders-empty">
        <strong>Nu ai nicio comanda inca.</strong>
        <p>Cand plasezi o comanda, o vei vedea aici, cu status si factura.</p>
        <a href="/#drop">Vezi dropul curent</a>
      </div>
    `;
  }

  function renderOrders(orders) {
    if (!orders.length) {
      renderEmpty();
      return;
    }

    root.innerHTML = `
      <div class="orders-list">
        ${orders.map((order) => `
          <article class="order-row">
            <div class="order-row-main">
              <strong>${escapeHtml(order.number)}</strong>
              <span class="order-status-badge" data-status="${escapeHtml(order.status)}">${escapeHtml(text(`status.${order.status}`, order.status))}</span>
            </div>
            <p class="order-row-meta">${escapeHtml(new Date(order.createdAt).toLocaleDateString())} &middot; ${escapeHtml(money(order.total, order.currency))}</p>
            <p class="order-row-items">${(order.items || []).map((item) => `${escapeHtml(item.qty)}x ${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ""}`).join(", ")}</p>
            <div class="order-row-actions">
              <a href="/thank-you.html?order=${encodeURIComponent(order.id)}">Detalii comanda</a>
              <a href="/invoice.html?order=${encodeURIComponent(order.id)}">Vezi factura</a>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  fetch("/api/me")
    .then((response) => response.json())
    .then(({ user }) => {
      if (!user) {
        window.location.href = "/login.html";
        return null;
      }
      return fetch("/api/orders").then((response) => response.json());
    })
    .then((payload) => {
      if (!payload) return;
      renderOrders(payload.orders || []);
    })
    .catch(() => {
      root.innerHTML = `<p class="orders-loading">Comenzile nu au putut fi incarcate.</p>`;
    });
})();
