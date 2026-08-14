// Shared header cart badge for pages that have no cart-aware script of their
// own (info/legal/account pages). Pages that already fetch the cart for
// other reasons (index.html/shop.js, product.html/product.js, cart.html,
// checkout.html) update the same [data-cart-badge] elements themselves and
// don't need this file - see each script's own applyCartBadge().
(function () {
  const badges = document.querySelectorAll("[data-cart-badge]");
  if (!badges.length) return;

  fetch("/api/cart", { headers: { "Content-Type": "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const count = Number(data?.cart?.count || 0);
      badges.forEach((badge) => {
        badge.textContent = String(count);
        badge.hidden = count === 0;
      });
    })
    .catch(() => {});
})();
