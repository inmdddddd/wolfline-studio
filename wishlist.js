async function wishlistRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function wishlistMoney(value, currency = "GBP") {
  if (window.BecaRegion?.money) return window.BecaRegion.money(value, currency);
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

async function renderWishlistPanel() {
  const list = document.querySelector("[data-wishlist-list]");
  if (!list) return;

  try {
    const { products } = await wishlistRequest("/api/wishlist");
    list.innerHTML = "";

    if (!products.length) {
      const empty = document.createElement("li");
      empty.className = "account-wishlist-empty";
      empty.textContent = "No saved pieces yet.";
      list.appendChild(empty);
      return;
    }

    products.forEach((product) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const name = document.createElement("strong");
      const price = document.createElement("span");
      const remove = document.createElement("button");

      link.href = `/product.html?slug=${encodeURIComponent(product.slug || product.id)}`;
      name.textContent = product.name;
      price.textContent = wishlistMoney(product.price, product.currency);
      remove.type = "button";
      remove.dataset.wishlistRemove = product.id;
      remove.textContent = "Remove";

      link.append(name, price);
      item.append(link, remove);
      list.appendChild(item);
    });
  } catch {
    list.innerHTML = "";
  }
}

document.addEventListener("click", async (event) => {
  const removeButton = event.target.closest("[data-wishlist-remove]");
  if (!removeButton) return;

  await wishlistRequest(`/api/wishlist/${encodeURIComponent(removeButton.dataset.wishlistRemove)}`, { method: "DELETE" });
  renderWishlistPanel();
});

async function initProductWishlistButton(productId) {
  const button = document.querySelector("[data-wishlist-toggle]");
  if (!button || !productId) return;

  async function syncState() {
    try {
      const { products } = await wishlistRequest("/api/wishlist");
      button.classList.toggle("is-saved", products.some((product) => product.id === productId));
    } catch {
      button.classList.remove("is-saved");
    }
  }

  await syncState();

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (button.classList.contains("is-saved")) {
        await wishlistRequest(`/api/wishlist/${encodeURIComponent(productId)}`, { method: "DELETE" });
        button.classList.remove("is-saved");
      } else {
        await wishlistRequest("/api/wishlist", {
          method: "POST",
          body: JSON.stringify({ productId })
        });
        button.classList.add("is-saved");
      }
    } catch (error) {
      if (/login/i.test(error.message)) {
        location.href = "/#register";
      }
    } finally {
      button.disabled = false;
    }
  });
}

renderWishlistPanel();
