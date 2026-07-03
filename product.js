function productMoney(value, currency = "GBP") {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
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

  if (!slug) throw new Error("Product missing.");

  const { product } = await productRequest(`/api/products/${encodeURIComponent(slug)}`);
  document.title = `${product.name} / BeCa x Wolfline Studio`;
  document.querySelector("[data-product-category]").textContent = `${product.category || "Piece"} / ${product.stock > 0 ? `${product.stock} left` : "sold out"}`;
  document.querySelector("[data-product-name]").textContent = product.name;
  document.querySelector("[data-product-price]").textContent = productMoney(product.price, product.currency);
  document.querySelector("[data-product-description]").textContent = product.description || "Limited piece from the latest drop.";

  const sizes = document.querySelector("[data-product-sizes]");
  sizes.innerHTML = "";
  (product.sizes || []).forEach((size) => {
    const chip = document.createElement("span");
    chip.textContent = size;
    sizes.appendChild(chip);
  });

  if (product.studio?.model) {
    viewer.src = product.studio.model;
    applyProductTexture(viewer, product.studio.textureUrl).catch(() => {});
  }

  const addButton = document.querySelector("[data-product-add]");
  addButton.disabled = product.stock <= 0;
  addButton.textContent = product.stock > 0 ? "Add to cart" : "Sold out";
  addButton.addEventListener("click", async () => {
    addButton.disabled = true;
    try {
      await productRequest("/api/cart/add", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, qty: 1 })
      });
      message.dataset.type = "success";
      message.textContent = "Added to cart.";
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
