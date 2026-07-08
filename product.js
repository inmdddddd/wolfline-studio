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

function isPreviewProduct(product) {
  return product.status === "preview";
}

function productImageSrc(product) {
  return product.imageUrl || "";
}

function productBrandName() {
  return document.querySelector('meta[name="brand-name"]')?.content || "BeCa";
}

function productSiteOrigin() {
  return document.querySelector('meta[name="brand-origin"]')?.content || "https://beca-wlf.com";
}

const isSafariProduct = Boolean(window.__BECA_IS_SAFARI__) || /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
const isMobileProduct = window.matchMedia?.("(max-width: 760px), (pointer: coarse)")?.matches || /iphone|ipad|android|mobile/i.test(navigator.userAgent);
const PRODUCT_DROP_UNLOCK_AT = new Date("2026-07-16T20:00:00+03:00").getTime();

function productCountdownText() {
  const language = window.BecaRegion?.language?.() === "ro" ? "ro" : "en";
  const remaining = Math.max(0, PRODUCT_DROP_UNLOCK_AT - Date.now());
  if (!remaining) return language === "ro" ? "Drop deblocat" : "Drop unlocked";

  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.ceil(remaining / 3600000);
  const days = Math.ceil(remaining / 86400000);

  if (days > 1) return language === "ro" ? `Se deblocheaza in ${days} zile` : `Drop unlocks in ${days} days`;
  if (days === 1) return language === "ro" ? "Se deblocheaza in 1 zi" : "Drop unlocks in 1 day";
  if (hours > 1) return language === "ro" ? `Se deblocheaza in ${hours} ore` : `Drop unlocks in ${hours} hours`;
  if (hours === 1) return language === "ro" ? "Se deblocheaza in 1 ora" : "Drop unlocks in 1 hour";
  if (minutes > 1) return language === "ro" ? `Se deblocheaza in ${minutes} minute` : `Drop unlocks in ${minutes} minutes`;
  return language === "ro" ? "Se deblocheaza in sub 1 minut" : "Drop unlocks in under 1 minute";
}

function updateProductCountdown() {
  document.querySelectorAll("[data-product-countdown]").forEach((element) => {
    element.textContent = productCountdownText();
  });
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

function waitForProductModelReady(viewer, attemptsLeft = 40) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      if (viewer.model && viewer.model.materials && viewer.model.materials.length) {
        resolve();
        return;
      }
      if (remaining <= 0) {
        reject(new Error("model-viewer never became ready"));
        return;
      }
      setTimeout(() => check(remaining - 1), 250);
    };
    check(attemptsLeft);
  });
}

async function applyProductTexture(viewer, textureUrl, attempt = 0) {
  if (!viewer || !textureUrl) return;

  try {
    if (!viewer.model || !viewer.model.materials || !viewer.model.materials.length) {
      await waitForProductModelReady(viewer);
    }

    const texture = await viewer.createTexture(textureUrl);
    viewer.model.materials.forEach((material) => {
      material.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
      material.pbrMetallicRoughness.setBaseColorFactor([0.94, 0.94, 0.9, 1]);
      material.pbrMetallicRoughness.setMetallicFactor?.(0);
      material.pbrMetallicRoughness.setRoughnessFactor?.(0.98);
    });
    forceModelViewerRepaint(viewer);
  } catch (error) {
    if (attempt < 2) {
      window.setTimeout(() => applyProductTexture(viewer, textureUrl, attempt + 1), 400);
    } else {
      console.warn("[model-viewer texture] gave up after retries", error);
    }
  }
}

function forceModelViewerRepaint(viewer) {
  viewer.requestUpdate?.();
}

async function loadProductReviews(productId) {
  const list = document.querySelector("[data-reviews-list]");
  const summary = document.querySelector("[data-reviews-summary]");
  if (!list || !summary) return;

  const { reviews, average, count } = await productRequest(`/api/products/${encodeURIComponent(productId)}/reviews`);
  summary.textContent = count
    ? `${average} / 5 (${count} ${count === 1 ? "review" : "reviews"})`
    : productText("noReviewsYet", "No reviews yet.");

  list.innerHTML = "";
  reviews.forEach((review) => {
    const item = document.createElement("li");
    const rating = document.createElement("strong");
    const text = document.createElement("p");
    const author = document.createElement("span");

    rating.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    text.textContent = review.text;
    author.textContent = review.name || "";

    item.append(rating, text, author);
    list.appendChild(item);
  });
}

async function initProductPage() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("slug") || params.get("id");
  const viewer = document.querySelector("[data-product-viewer]");
  const message = document.querySelector("[data-product-message]");

  if (!slug) throw new Error(productText("productMissing", "Product missing."));

  const { product } = await productRequest(`/api/products/${encodeURIComponent(slug)}`);
  const display = productDisplay(product);
  const brandName = productBrandName();
  const siteOrigin = productSiteOrigin();
  document.title = `${display.displayName} / ${brandName}`;
  const metaDescription = display.displayDescription || productText("limitedFallback", "Limited piece from the latest drop.");
  document.querySelector("[data-product-meta-description]")?.setAttribute("content", metaDescription);
  document.querySelector("[data-product-og-title]")?.setAttribute("content", `${display.displayName} / ${brandName}`);
  document.querySelector("[data-product-og-description]")?.setAttribute("content", metaDescription);
  document.querySelector("[data-product-og-url]")?.setAttribute("content", `${siteOrigin}/product.html?slug=${encodeURIComponent(slug)}`);
  const ogImage = productImageSrc(product);
  if (ogImage && !ogImage.startsWith("data:")) {
    document.querySelector("[data-product-og-image]")?.setAttribute("content", new URL(ogImage, `${siteOrigin}/`).href);
  }
  document.querySelector("[data-product-category]").textContent = isPreviewProduct(product)
    ? `${display.displayCategory || productText("piece", "Piece")} / ${productText("previewOnly", "preview")}`
    : `${display.displayCategory || productText("piece", "Piece")} / ${window.BecaRegion?.stockText?.(product.stock) || (product.stock > 0 ? `${product.stock} left` : "sold out")}`;
  document.querySelector("[data-product-name]").textContent = display.displayName;
  document.querySelector("[data-product-price]").textContent = isPreviewProduct(product)
    ? productText("unknownYet", "Unknown yet")
    : productMoney(product.price, product.currency);
  document.querySelector("[data-product-description]").textContent = display.displayDescription || productText("limitedFallback", "Limited piece from the latest drop.");

  const sizes = document.querySelector("[data-product-sizes]");
  const previewNote = document.querySelector("[data-preview-note]");
  sizes.innerHTML = "";
  delete sizes.dataset.selectedSize;
  (product.sizes || []).forEach((size) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.size = size;
    chip.textContent = size;
    chip.setAttribute("aria-pressed", "false");
    const sizeIsOut = product.sizeStock && Number(product.sizeStock[size] || 0) <= 0;
    if (sizeIsOut) chip.disabled = true;
    chip.addEventListener("click", () => {
      sizes.querySelectorAll("[data-size]").forEach((other) => {
        other.classList.toggle("is-selected", other === chip);
        other.setAttribute("aria-pressed", String(other === chip));
      });
      sizes.dataset.selectedSize = size;
      sizes.classList.remove("needs-size");
    });
    sizes.appendChild(chip);
  });

  if (previewNote) {
    previewNote.hidden = !isPreviewProduct(product);
    previewNote.querySelector("span").textContent = productText("previewReason", "Join the list for access before the public drop. Limited stock.");
    updateProductCountdown();
  }

  if (typeof initProductWishlistButton === "function") {
    initProductWishlistButton(product.id);
  }
  loadProductReviews(product.id).catch(() => {});
  const reviewForm = document.querySelector("[data-review-form]");
  if (reviewForm) {
    reviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const reviewMessage = reviewForm.querySelector("[data-review-message]");
      const submitButton = reviewForm.querySelector("button[type='submit']");
      submitButton.disabled = true;
      reviewMessage.dataset.type = "info";
      reviewMessage.textContent = productText("sending", "Sending...");

      try {
        await productRequest(`/api/products/${encodeURIComponent(product.id)}/reviews`, {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(reviewForm).entries()))
        });
        reviewMessage.dataset.type = "success";
        reviewMessage.textContent = productText("reviewSubmitted", "Thanks. Your review will show once approved.");
        reviewForm.reset();
      } catch (error) {
        reviewMessage.dataset.type = "";
        if (/login/i.test(error.message)) {
          location.href = "/#register";
          return;
        }
        reviewMessage.textContent = error.message;
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  if (product.studio?.model) {
    viewer.src = product.studio.model;
    if ((isMobileProduct || isSafariProduct) && productImageSrc(product)) {
      viewer.setAttribute("poster", productImageSrc(product));
    } else {
      viewer.removeAttribute("poster");
    }
    applyProductTexture(viewer, product.studio.textureUrl).catch(() => {});
  }

  const addButton = document.querySelector("[data-product-add]");
  addButton.disabled = !isPreviewProduct(product) && product.stock <= 0;
  addButton.textContent = isPreviewProduct(product)
    ? productText("notifyMe", "Notify me when available")
    : (product.stock > 0 ? productText("addToCart", "Add to cart") : productText("soldOut", "Sold out"));
  addButton.addEventListener("click", async () => {
    let notifySaved = false;
    addButton.disabled = true;
    try {
      if ((product.sizes || []).length && !sizes.dataset.selectedSize) {
        sizes.classList.add("needs-size");
        message.dataset.type = "";
        message.textContent = productText("selectSize", "Choose a size first.");
        return;
      }

      if (isPreviewProduct(product)) {
        await productRequest("/api/notify", {
          method: "POST",
          body: JSON.stringify({
            productId: product.id,
            preferredSize: sizes.dataset.selectedSize || ""
          })
        });
        message.dataset.type = "success";
        message.textContent = productText("notifySaved", "You are on the list.");
        addButton.textContent = productText("notifySavedShort", "On the list");
        notifySaved = true;
        return;
      }

      await productRequest("/api/cart/add", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, qty: 1, size: sizes.dataset.selectedSize || "" })
      });
      message.dataset.type = "success";
      message.textContent = productText("addedToCart", "Added to cart.");
    } catch (error) {
      if (/login/i.test(error.message)) {
        location.href = "/#register";
        return;
      }
      message.dataset.type = "";
      message.textContent = error.message;
    } finally {
      addButton.disabled = notifySaved || (!isPreviewProduct(product) && product.stock <= 0);
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

window.addEventListener("beca:locale-change", updateProductCountdown);
window.setInterval(updateProductCountdown, 60000);
