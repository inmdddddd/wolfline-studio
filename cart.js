function cartMoney(value, currency = "GBP") {
  if (window.BecaRegion?.money) return window.BecaRegion.money(value, currency);
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function cartText(key, fallback = key, replacements = {}) {
  return window.BecaRegion?.text?.(key, replacements) || fallback;
}

function cartDisplayProduct(product) {
  return window.BecaRegion?.displayProduct?.(product) || {
    ...product,
    displayName: product.name,
    displayCategory: product.category || "Piece"
  };
}

function applyCartBadge(cart) {
  document.querySelectorAll("[data-cart-badge]").forEach((element) => {
    const count = Number(cart.count || 0);
    element.textContent = String(count);
    element.hidden = count === 0;
  });
}

async function cartRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

// Product-level category/color plus the size actually picked at add-to-cart
// time - color isn't a separate selectable variant in this catalog (each
// product/SKU is one colorway), so it just rides along on item.product.
function cartRowMeta(item) {
  const display = cartDisplayProduct(item.product);
  const parts = [display.displayCategory, item.product.color, item.size];
  return parts.filter(Boolean).join(" · ");
}

function renderCartPage(cart) {
  applyCartBadge(cart);

  if (cart.droppedCount > 0) {
    setCartMessage(cartText("cart.itemsUnavailable", "Some items in your cart are no longer available and were removed."));
  }

  const itemCountEl = document.querySelector("[data-cart-item-count]");
  if (itemCountEl) {
    itemCountEl.textContent = window.BecaRegion?.itemCountText?.(cart.count) || `${cart.count || 0} items`;
  }

  const filled = document.querySelector("[data-cart-filled]");
  const empty = document.querySelector("[data-cart-empty]");
  const list = document.querySelector("[data-cart-items]");

  if (!cart.items.length) {
    if (filled) filled.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  if (filled) filled.hidden = false;
  if (empty) empty.hidden = true;

  const subtotalEl = document.querySelector("[data-cart-subtotal]");
  const totalEl = document.querySelector("[data-cart-total]");
  // No shipping fee exists in the pricing model and a coupon can only be
  // resolved server-side at checkout submission (see checkout.js) - the
  // cart page's total is exactly the subtotal, same as /api/checkout would
  // charge before any discount code is applied.
  if (subtotalEl) subtotalEl.textContent = cartMoney(cart.total, cart.currency);
  if (totalEl) totalEl.textContent = cartMoney(cart.total, cart.currency);

  if (!list) return;
  list.innerHTML = "";

  cart.items.forEach((item) => {
    const display = cartDisplayProduct(item.product);
    const row = document.createElement("article");
    row.className = "shop-cart-row";

    const media = document.createElement("div");
    media.className = "shop-cart-row-media";
    if (item.product.imageUrl) {
      const image = document.createElement("img");
      image.src = item.product.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      media.appendChild(image);
    }

    const info = document.createElement("div");
    info.className = "shop-cart-row-info";

    const title = document.createElement("h3");
    title.textContent = display.displayName;

    const meta = document.createElement("p");
    meta.className = "shop-cart-row-meta";
    meta.textContent = cartRowMeta(item);

    const controls = document.createElement("div");
    controls.className = "shop-cart-row-controls";

    const stepper = document.createElement("div");
    stepper.className = "qty-stepper";
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.setAttribute("aria-label", "Decrease quantity");
    decrease.textContent = "−";
    decrease.dataset.qtyDecrease = item.key;
    decrease.disabled = item.qty <= 1;
    const qtyValue = document.createElement("span");
    qtyValue.textContent = item.qty;
    const increase = document.createElement("button");
    increase.type = "button";
    increase.setAttribute("aria-label", "Increase quantity");
    increase.textContent = "+";
    increase.dataset.qtyIncrease = item.key;
    increase.disabled = item.qty >= Math.max(1, item.product.stock);
    stepper.append(decrease, qtyValue, increase);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shop-cart-row-remove";
    remove.dataset.removeCart = item.key;
    remove.textContent = cartText("remove", "Remove");

    controls.append(stepper, remove);
    info.append(title, meta, controls);

    const price = document.createElement("strong");
    price.className = "shop-cart-row-price";
    price.textContent = cartMoney(item.subtotal, item.product.currency);

    row.append(media, info, price);
    list.appendChild(row);
  });
}

function setCartMessage(message) {
  const el = document.querySelector("[data-cart-message]");
  if (el) el.textContent = message || "";
}

async function loadCart() {
  const { cart } = await cartRequest("/api/cart");
  window.__BECA_CART_STATE__ = cart;
  renderCartPage(cart);
}

// Rapid clicks on +/-/remove would otherwise all read the same
// not-yet-updated window.__BECA_CART_STATE__ and race each other (two quick
// "+" clicks could both compute qty+1 from the same stale qty and land on
// qty+1 instead of qty+2) - one cart mutation in flight at a time.
let cartActionInFlight = false;

document.addEventListener("click", async (event) => {
  const decreaseButton = event.target.closest("[data-qty-decrease]");
  const increaseButton = event.target.closest("[data-qty-increase]");
  const removeButton = event.target.closest("[data-remove-cart]");
  const clearButton = event.target.closest("[data-clear-cart]");
  if (!decreaseButton && !increaseButton && !removeButton && !clearButton) return;
  if (cartActionInFlight) return;
  cartActionInFlight = true;

  try {
    setCartMessage("");

    if (clearButton) {
      const { cart } = await cartRequest("/api/cart", { method: "DELETE", body: "{}" });
      window.__BECA_CART_STATE__ = cart;
      renderCartPage(cart);
      return;
    }

    if (removeButton) {
      const { cart } = await cartRequest(`/api/cart/items/${encodeURIComponent(removeButton.dataset.removeCart)}`, {
        method: "DELETE",
        body: "{}"
      });
      window.__BECA_CART_STATE__ = cart;
      renderCartPage(cart);
      return;
    }

    const key = decreaseButton ? decreaseButton.dataset.qtyDecrease : increaseButton.dataset.qtyIncrease;
    const currentItem = window.__BECA_CART_STATE__?.items.find((item) => item.key === key);
    if (!currentItem) return;
    const nextQty = decreaseButton ? currentItem.qty - 1 : currentItem.qty + 1;

    const { cart } = await cartRequest(`/api/cart/items/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ qty: nextQty })
    });
    window.__BECA_CART_STATE__ = cart;
    renderCartPage(cart);
  } catch (error) {
    setCartMessage(error.message);
  } finally {
    cartActionInFlight = false;
  }
});

loadCart().catch((error) => {
  setCartMessage(error.message || cartText("productsLoadFailed", "Products could not load."));
});

window.addEventListener("beca:locale-change", () => {
  if (window.__BECA_CART_STATE__) renderCartPage(window.__BECA_CART_STATE__);
});
