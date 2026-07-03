function productMoney(value, currency = "GBP") {
  if (window.BecaRegion?.money) {
    return window.BecaRegion.money(value, currency);
  }

  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function productText(key, fallback = key, replacements = {}) {
  return window.BecaRegion?.text?.(key, replacements) || fallback;
}

function productDisplay(product) {
  return window.BecaRegion?.displayProduct?.(product) || {
    ...product,
    displayName: product.name,
    displayDescription: product.description || productText("limitedFallback", "Limited piece from the latest drop."),
    displayCategory: product.category || "Piece"
  };
}

async function productRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function applyProductTexture(viewer, textureUrl) {
  if (!viewer || !textureUrl) return;

  async function apply() {
    if (!viewer.model) return;
    const texture = await viewer.createTexture(textureUrl);
    viewer.model.materials.forEach((material) => {
      material.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
      material.pbrMetallicRoughness.setBaseColorFactor([0.94, 0.94, 0.9, 1]);
      material.pbrMetallicRoughness.setMetallicFactor?.(0);
      material.pbrMetallicRoughness.setRoughnessFactor?.(0.98);
    });
  }

  if (viewer.model) {
    await apply();
  } else {
    viewer.addEventListener("load", () => apply().catch(() => {}), { once: true });
  }
}

async function initProductPage() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("slug") || params.get("id");
  const viewer = document.querySelector("[data-product-viewer]");
  const message = document.querySelector("[data-product-message]");

  if (!slug) throw new Error(productText("productMissing", "Product missing."));

  const { product } = await productRequest(`/api/products/${encodeURIComponent(slug)}`);
  const display = productDisplay(product);
  document.title = `${display.displayName} / BeCa x Wolfline Studio`;
  document.querySelector("[data-product-category]").textContent = `${display.displayCategory || productText("piece", "Piece")} / ${window.BecaRegion?.stockText?.(product.stock) || (product.stock > 0 ? `${product.stock} left` : "sold out")}`;
  document.querySelector("[data-product-name]").textContent = display.displayName;
  document.querySelector("[data-product-price]").textContent = productMoney(product.price, product.currency);
  document.querySelector("[data-product-description]").textContent = display.displayDescription || productText("limitedFallback", "Limited piece from the latest drop.");

  const sizes = document.querySelector("[data-product-sizes]");
  sizes.innerHTML = "";
  (product.sizes || []).forEach((size) => {
    const chip = document.createElement("span");
    chip.textContent = size;
    sizes.appendChild(chip);
  });

  if (product.studio?.model) {
    viewer.src = product.studio.model;
    if (product.imageUrl) {
      viewer.setAttribute("poster", product.imageUrl);
    }
    applyProductTexture(viewer, product.studio.textureUrl).catch(() => {});
  }

  const addButton = document.querySelector("[data-product-add]");
  addButton.disabled = product.stock <= 0;
  addButton.textContent = product.stock > 0 ? productText("addToCart", "Add to cart") : productText("soldOut", "Sold out");
  addButton.addEventListener("click", async () => {
    addButton.disabled = true;
    try {
      await productRequest("/api/cart/add", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, qty: 1 })
      });
      message.dataset.type = "success";
      message.textContent = productText("addedToCart", "Added to cart.");
    } catch (error) {
      message.dataset.type = "";
      message.textContent = error.message;
    } finally {
      addButton.disabled = product.stock <= 0;
    }
  });
}

initProductPage().catch((error) => {
  const message = document.querySelector("[data-product-message]");
  if (message) message.textContent = error.message;
});

const productMobileMenu = document.querySelector("[data-mobile-menu]");
const productMobileMenuOpen = document.querySelector("[data-mobile-menu-open]");

function setProductMobileMenu(open) {
  if (!productMobileMenu || !productMobileMenuOpen) return;
  document.body.classList.toggle("is-mobile-menu-open", open);
  productMobileMenu.classList.toggle("is-open", open);
  productMobileMenu.setAttribute("aria-hidden", String(!open));
  productMobileMenuOpen.setAttribute("aria-expanded", String(open));
}

productMobileMenuOpen?.addEventListener("click", () => setProductMobileMenu(true));

document.querySelectorAll("[data-mobile-menu-close], [data-mobile-menu-link]").forEach((element) => {
  element.addEventListener("click", () => setProductMobileMenu(false));
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setProductMobileMenu(false);
});
