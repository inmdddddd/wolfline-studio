function shopMoney(value, currency = "GBP") {
  if (window.BecaRegion?.money) {
    return window.BecaRegion.money(value, currency);
  }

  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function shopText(key, fallback = key, replacements = {}) {
  return window.BecaRegion?.text?.(key, replacements) || fallback;
}

function shopProduct(product) {
  return window.BecaRegion?.displayProduct?.(product) || {
    ...product,
    displayName: product.name,
    displayDescription: product.description || shopText("limitedFallback", "Limited piece from the latest drop."),
    displayCategory: product.category || "Piece"
  };
}

function isPreviewProduct(product) {
  return product.status === "preview";
}

function productImageSrc(product) {
  return product.imageDataUrl || product.sceneImageDataUrl || product.imageUrl || "";
}

const isSafariShop = Boolean(window.__BECA_IS_SAFARI__) || /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
const isMobileShop = window.matchMedia?.("(max-width: 760px), (pointer: coarse)")?.matches || /iphone|ipad|android|mobile/i.test(navigator.userAgent);

const modelViewerLazyObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const viewer = entry.target;
        modelViewerLazyObserver.unobserve(viewer);
        viewer.src = viewer.dataset.lazySrc;
        applyModelViewerTexture(viewer, viewer.dataset.lazyTexture);
      });
    }, { rootMargin: "200px" })
  : null;

function lazyLoadModelViewer(viewer, modelUrl, textureUrl) {
  if (!modelViewerLazyObserver) {
    viewer.src = modelUrl;
    applyModelViewerTexture(viewer, textureUrl);
    return;
  }

  viewer.dataset.lazySrc = modelUrl;
  viewer.dataset.lazyTexture = textureUrl || "";
  modelViewerLazyObserver.observe(viewer);
}

function waitForModelReady(viewer, attemptsLeft = 40) {
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

async function applyModelViewerTexture(viewer, textureUrl, attempt = 0) {
  const tag = viewer?.id ? `[HERO-DEBUG #${viewer.id}]` : "[HERO-DEBUG]";
  console.log(`${tag} applyModelViewerTexture called, attempt=${attempt}, textureUrl=${textureUrl}`);
  if (!viewer || !textureUrl) {
    console.log(`${tag} bailing: no viewer or no textureUrl`);
    return;
  }

  try {
    if (!viewer.model || !viewer.model.materials || !viewer.model.materials.length) {
      console.log(`${tag} model not ready yet, polling...`);
      await waitForModelReady(viewer);
      console.log(`${tag} model is now ready`);
    }

    console.log(`${tag} creating texture...`);
    const texture = await viewer.createTexture(textureUrl);
    console.log(`${tag} texture created:`, texture, "materials count:", viewer.model.materials.length);
    viewer.model.materials.forEach((material, index) => {
      material.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
      material.pbrMetallicRoughness.setBaseColorFactor([0.94, 0.94, 0.9, 1]);
      material.pbrMetallicRoughness.setMetallicFactor?.(0);
      material.pbrMetallicRoughness.setRoughnessFactor?.(0.98);
      console.log(`${tag} material[${index}] texture set`);
    });
    forceModelViewerRepaint(viewer);
    console.log(`${tag} done, repaint requested`);
  } catch (error) {
    console.log(`${tag} error on attempt ${attempt}:`, error);
    if (attempt < 2) {
      window.setTimeout(() => applyModelViewerTexture(viewer, textureUrl, attempt + 1), 400);
    } else {
      console.warn(`${tag} gave up after retries`, error);
    }
  }
}

function forceModelViewerRepaint(viewer) {
  viewer.requestUpdate?.();
}

async function shopRequest(url, options = {}) {
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

function renderProducts(products = []) {
  const grid = document.querySelector("[data-product-grid]");
  if (!grid) return;

  grid.innerHTML = "";

  if (!products.length) {
    const empty = document.createElement("article");
    empty.className = "shop-loading";
    empty.innerHTML = `<span>${shopText("drop", "Drop")}</span><h3>${shopText("noLivePieces", "No live pieces yet.")}</h3>`;
    grid.appendChild(empty);
    return;
  }

  products.forEach((product) => {
    const display = shopProduct(product);
    const card = document.createElement("article");
    const media = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const specs = document.createElement("div");
    const footer = document.createElement("div");
    const price = document.createElement("strong");
    const button = document.createElement("button");

    card.className = "product-card";
    card.classList.toggle("is-preview", isPreviewProduct(product));
    media.className = "product-media";
    const imageSource = productImageSrc(product);
    const shouldUseProductShot = Boolean(imageSource) && (isMobileShop || isSafariShop);

    if (shouldUseProductShot) {
      const image = document.createElement("img");
      image.src = imageSource;
      image.alt = display.displayName;
      image.onerror = () => {
        image.src = "assets/tshirt-3d-poster.png";
      };
      media.classList.add("has-product-shot");
      media.appendChild(image);
    } else if (product.studio?.model && !isSafariShop && !isMobileShop) {
      const viewer = document.createElement("model-viewer");
      viewer.alt = display.displayName;
      viewer.setAttribute("camera-orbit", "180deg 82deg 1.05m");
      viewer.setAttribute("min-camera-orbit", "auto 82deg 1.05m");
      viewer.setAttribute("max-camera-orbit", "auto 82deg 1.05m");
      viewer.setAttribute("field-of-view", "19deg");
      viewer.setAttribute("min-field-of-view", "19deg");
      viewer.setAttribute("max-field-of-view", "19deg");
      viewer.setAttribute("auto-rotate", "");
      viewer.setAttribute("rotation-per-second", "18deg");
      viewer.setAttribute("interaction-prompt", "none");
      viewer.setAttribute("shadow-intensity", "0.95");
      viewer.setAttribute("exposure", "0.92");
      media.appendChild(viewer);
      lazyLoadModelViewer(viewer, product.studio.model, product.studio.textureUrl);
    } else if (imageSource) {
      const image = document.createElement("img");
      image.src = imageSource;
      image.alt = display.displayName;
      image.onerror = () => {
        image.src = "assets/tshirt-3d-poster.png";
      };
      media.classList.add("has-product-shot");
      media.appendChild(image);
    } else if (product.studio?.model) {
      const fallback = document.createElement("img");
      fallback.src = "assets/tshirt-3d-poster.png";
      fallback.alt = display.displayName;
      media.classList.add("has-product-shot");
      media.appendChild(fallback);
    } else {
      media.textContent = display.displayCategory || shopText("drop", "Drop");
    }

    meta.textContent = isPreviewProduct(product)
      ? `${display.displayCategory || shopText("piece", "Piece")} / ${shopText("previewOnly", "preview")}`
      : `${display.displayCategory || shopText("piece", "Piece")} / ${window.BecaRegion?.stockText?.(product.stock) || (product.stock > 0 ? `${product.stock} left` : "sold out")}`;
    title.textContent = display.displayName;
    title.addEventListener("click", () => {
      location.href = `/product.html?slug=${encodeURIComponent(product.slug || product.id)}`;
    });
    media.addEventListener("click", () => {
      location.href = `/product.html?slug=${encodeURIComponent(product.slug || product.id)}`;
    });
    description.textContent = display.displayDescription || shopText("limitedFallback", "Limited piece from the latest drop.");
    specs.className = "product-specs";
    if (product.color) {
      const color = document.createElement("span");
      color.textContent = product.color;
      specs.appendChild(color);
    }
    (product.sizes || []).forEach((size) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.dataset.size = size;
      chip.textContent = size;
      chip.setAttribute("aria-pressed", "false");
      if (product.sizeStock && Number(product.sizeStock[size] || 0) <= 0) chip.disabled = true;
      chip.addEventListener("click", () => {
        specs.querySelectorAll("[data-size]").forEach((other) => {
          other.classList.toggle("is-selected", other === chip);
          other.setAttribute("aria-pressed", String(other === chip));
        });
        specs.dataset.selectedSize = size;
        specs.classList.remove("needs-size");
        sizeHint.hidden = true;
      });
      specs.appendChild(chip);
    });
    const sizeHint = document.createElement("span");
    sizeHint.className = "product-size-hint";
    sizeHint.hidden = true;
    sizeHint.textContent = shopText("selectSize", "Choose a size first.");
    price.textContent = isPreviewProduct(product)
      ? shopText("unknownYet", "Unknown yet")
      : shopMoney(product.price, product.currency);
    button.type = "button";
    if (isPreviewProduct(product)) {
      button.dataset.notifyProduct = product.id;
      button.textContent = shopText("notifyMe", "Notify me when available");
    } else {
      button.dataset.addToCart = product.id;
      button.disabled = product.stock <= 0;
      button.textContent = product.stock > 0 ? shopText("addToCart", "Add to cart") : shopText("soldOut", "Sold out");
    }

    footer.className = "product-card-footer";
    footer.append(price, button);
    card.append(media, meta, title, description, specs, sizeHint, footer);
    grid.appendChild(card);
  });
}

function renderCart(cart) {
  const counts = document.querySelectorAll("[data-cart-count]");
  const totals = document.querySelectorAll("[data-cart-total]");
  const list = document.querySelector("[data-cart-items]");
  const cartToggles = document.querySelectorAll("[data-cart-toggle]");
  const cartActions = document.querySelector("[data-cart-actions]");

  if (!counts.length || !totals.length || !list) return;
  window.__BECA_LAST_CART_COUNT__ = cart.count || 0;

  cartToggles.forEach((toggle) => {
    toggle.hidden = !cart.count;
  });
  if (cartActions) {
    cartActions.hidden = !cart.count;
  }

  counts.forEach((count) => {
    count.textContent = window.BecaRegion?.countText?.(cart.count) || `${cart.count || 0} ${cart.count === 1 ? "piece" : "pieces"}`;
  });
  totals.forEach((total) => {
    total.textContent = shopMoney(cart.total, cart.currency);
  });
  list.innerHTML = "";

  if (!cart.items.length) {
    const empty = document.createElement("span");
    empty.className = "cart-empty";
    empty.textContent = shopText("noPieces", "No pieces selected yet.");
    list.appendChild(empty);
    setCartMode("cart");
    return;
  }

  cart.items.forEach((item) => {
    const row = document.createElement("div");
    const info = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const controls = document.createElement("div");
    const qty = document.createElement("input");
    const remove = document.createElement("button");
    const display = shopProduct(item.product);

    row.className = "cart-row";
    title.textContent = item.size ? `${display.displayName} (${item.size})` : display.displayName;
    meta.textContent = `${item.qty} x ${shopMoney(item.product.price, item.product.currency)}`;
    qty.type = "number";
    qty.min = "1";
    qty.max = String(Math.max(1, item.product.stock));
    qty.value = item.qty;
    qty.dataset.cartQty = item.key;
    remove.type = "button";
    remove.dataset.removeCart = item.key;
    remove.textContent = shopText("remove", "Remove");

    info.append(title, meta);
    controls.append(qty, remove);
    row.append(info, controls);
    list.appendChild(row);
  });
}

function setCartMode(mode = "cart") {
  const drawer = document.querySelector("[data-cart-drawer]");
  const checkoutPanel = document.querySelector("[data-checkout-panel]");
  const cartActions = document.querySelector("[data-cart-actions]");
  if (!drawer) return;

  const isCheckout = mode === "checkout";
  const hasItems = Number(window.__BECA_LAST_CART_COUNT__ || 0) > 0;
  drawer.dataset.cartMode = isCheckout ? "checkout" : "cart";
  if (checkoutPanel) checkoutPanel.hidden = !isCheckout;
  if (cartActions) cartActions.hidden = isCheckout || !hasItems;
}

function setCartDrawer(open) {
  const drawer = document.querySelector("[data-cart-drawer]");
  const toggle = document.querySelector("[data-cart-toggle]");
  if (!drawer || !toggle) return;

  drawer.classList.toggle("is-open", open);
  document.body.classList.toggle("is-cart-open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  toggle.setAttribute("aria-expanded", String(open));
  if (!open) setCartMode("cart");
}

function randomizeHeroShirt(products) {
  const heroViewer = document.querySelector("#tshirtViewer");
  console.log("[HERO-DEBUG] randomizeHeroShirt called, heroViewer found:", Boolean(heroViewer), "products count:", products.length);
  if (!heroViewer) return;

  const liveCandidates = products.filter((product) => product.status === "live" && product.studio?.textureUrl);
  const candidates = liveCandidates.length ? liveCandidates : products.filter((product) => product.studio?.textureUrl);
  console.log("[HERO-DEBUG] candidates:", candidates.length, "(live-only:", liveCandidates.length, ")");
  if (!candidates.length) return;

  const lastId = sessionStorage.getItem("beca-hero-last");
  const pool = candidates.length > 1 ? candidates.filter((product) => product.id !== lastId) : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  console.log("[HERO-DEBUG] picked product:", pick.id, pick.name, "textureUrl:", pick.studio.textureUrl);
  sessionStorage.setItem("beca-hero-last", pick.id);
  applyModelViewerTexture(heroViewer, pick.studio.textureUrl);
}

async function loadShop() {
  const [{ products }, { cart }] = await Promise.all([
    shopRequest("/api/products"),
    shopRequest("/api/cart")
  ]);

  renderProducts(products);
  renderCart(cart);
  randomizeHeroShirt(products);
  window.__BECA_SHOP_STATE__ = { products, cart };
}

async function hydrateCheckoutFromUser() {
  const form = document.querySelector("[data-checkout-form]");
  if (!form) return;

  const { user } = await shopRequest("/api/me");
  if (!user) return;

  if (!form.elements.customerName.value) form.elements.customerName.value = user.name || "";
  if (!form.elements.customerEmail.value) form.elements.customerEmail.value = user.email || "";
}

async function notifyForProduct(productId, button, preferredSize = "") {
  button.disabled = true;
  try {
    await shopRequest("/api/notify", {
      method: "POST",
      body: JSON.stringify({ productId, preferredSize })
    });
    button.textContent = shopText("notifySaved", "You are on the list.");
  } catch (error) {
    if (/login/i.test(error.message)) {
      location.href = "/#register";
      return;
    }
    button.textContent = error.message;
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = shopText("notifyMe", "Notify me when available");
    }, 1800);
    return;
  }
}

document.addEventListener("click", async (event) => {
  const addButton = event.target.closest("[data-add-to-cart]");
  const notifyButton = event.target.closest("[data-notify-product]");
  const removeButton = event.target.closest("[data-remove-cart]");
  const cartToggle = event.target.closest("[data-cart-toggle]");
  const cartClose = event.target.closest("[data-cart-close]");
  const checkoutOpen = event.target.closest("[data-checkout-open]");
  const checkoutBack = event.target.closest("[data-checkout-back]");

  try {
    if (cartToggle) {
      setCartDrawer(true);
    }

    if (cartClose) {
      setCartDrawer(false);
    }

    if (checkoutOpen) {
      setCartMode("checkout");
      await hydrateCheckoutFromUser();
    }

    if (checkoutBack) {
      setCartMode("cart");
    }

    if (addButton) {
      const card = addButton.closest(".product-card");
      const specs = card?.querySelector(".product-specs");
      const sizeHint = card?.querySelector(".product-size-hint");
      const hasSizes = Boolean(specs?.querySelector("[data-size]"));
      const selectedSize = specs?.dataset.selectedSize || "";

      if (hasSizes && !selectedSize) {
        specs.classList.add("needs-size");
        if (sizeHint) sizeHint.hidden = false;
        return;
      }

      addButton.disabled = true;
      const { cart } = await shopRequest("/api/cart/add", {
        method: "POST",
        body: JSON.stringify({ productId: addButton.dataset.addToCart, qty: 1, size: selectedSize })
      });
      renderCart(cart);
      setCartDrawer(true);
      addButton.disabled = false;
    }

    if (notifyButton) {
      const card = notifyButton.closest(".product-card");
      const specs = card?.querySelector(".product-specs");
      const sizeHint = card?.querySelector(".product-size-hint");
      const hasSizes = Boolean(specs?.querySelector("[data-size]"));
      const selectedSize = specs?.dataset.selectedSize || "";

      if (hasSizes && !selectedSize) {
        specs.classList.add("needs-size");
        if (sizeHint) sizeHint.hidden = false;
      } else {
        await notifyForProduct(notifyButton.dataset.notifyProduct, notifyButton, selectedSize);
      }
    }

    if (removeButton) {
      const { cart } = await shopRequest(`/api/cart/items/${encodeURIComponent(removeButton.dataset.removeCart)}`, {
        method: "DELETE",
        body: "{}"
      });
      renderCart(cart);
    }
  } catch (error) {
    const message = document.querySelector("[data-checkout-message]");
    if (message) message.textContent = error.message;
    if (addButton) addButton.disabled = false;
  }
});

document.addEventListener("change", async (event) => {
  const qty = event.target.closest("[data-cart-qty]");
  if (!qty) return;

  const { cart } = await shopRequest(`/api/cart/items/${encodeURIComponent(qty.dataset.cartQty)}`, {
    method: "PUT",
    body: JSON.stringify({ qty: qty.value })
  });
  renderCart(cart);
});

document.querySelector("[data-checkout-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-checkout-message]");
  const button = form.querySelector("button");
  const data = Object.fromEntries(new FormData(form).entries());

  message.dataset.type = "info";
  message.textContent = shopText("sendingOrder", "Sending order...");
  button.disabled = true;

  try {
    const { order, cart } = await shopRequest("/api/checkout", {
      method: "POST",
      body: JSON.stringify(data)
    });
    message.dataset.type = "success";
    message.textContent = shopText("orderReceived", `Order ${order.number} received.`, { number: order.number });
    renderCart(cart);
    setCartMode("cart");
    await loadShop();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

loadShop().catch(() => {
  const grid = document.querySelector("[data-product-grid]");
  if (grid) {
    grid.innerHTML = `<article class="shop-loading"><span>${shopText("drop", "Drop")}</span><h3>${shopText("productsLoadFailed", "Products could not load.")}</h3></article>`;
  }
});
hydrateCheckoutFromUser().catch(() => {});

window.addEventListener("beca:locale-change", () => {
  const state = window.__BECA_SHOP_STATE__;
  if (!state) return;
  renderProducts(state.products);
  renderCart(state.cart);
});
