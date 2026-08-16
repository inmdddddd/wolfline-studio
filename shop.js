// Exact mode, not the guess-based BecaRegion.money(): every price on this
// page now comes from /api/products?country=, already server-resolved for
// the visitor's detected country (see loadShop below) - GBP when nothing
// is configured for that country, a real override's own currency when one
// exists. Formatting the currency the response actually carries, with zero
// re-conversion, is what BecaCurrency.formatExact is for; re-guessing via
// money()/convert() here would risk exactly the mislabeling bug that
// function's own comment warns about (a resolved RON amount getting
// re-converted as if it were still GBP).
function shopMoney(value, currency = "GBP") {
  if (window.BecaCurrency?.formatExact) {
    return window.BecaCurrency.formatExact(value, currency);
  }
  if (window.BecaRegion?.money) {
    return window.BecaRegion.money(value, currency);
  }

  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

// Appends the admin-configured secondary currency ("and also ~X lei") when
// one is set up - see locale.js's secondaryPriceText for why this only
// ever applies to the store's own default-currency price, never a
// resolved per-country one.
function shopMoneyWithSecondary(value, currency = "GBP") {
  const primary = shopMoney(value, currency);
  const secondary = window.BecaRegion?.secondaryPriceText?.(value, currency);
  return secondary ? `${primary} (~${secondary})` : primary;
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
  return product.imageUrl || "";
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
  if (!viewer || !textureUrl) {
    return;
  }

  try {
    if (!viewer.model || !viewer.model.materials || !viewer.model.materials.length) {
      await waitForModelReady(viewer);
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
      window.setTimeout(() => applyModelViewerTexture(viewer, textureUrl, attempt + 1), 400);
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
    // Lets the inline editor tie a card back to its catalog entry, so
    // swapping the shot writes to the product rather than to the page.
    card.dataset.productId = product.id;
    media.className = "product-media";
    const imageSource = productImageSrc(product);
    const shouldUseProductShot = Boolean(imageSource) && (isMobileShop || isSafariShop);

    if (shouldUseProductShot) {
      const image = document.createElement("img");
      image.src = imageSource;
      image.alt = display.displayName;
      image.loading = "lazy";
      image.decoding = "async";
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
      image.loading = "lazy";
      image.decoding = "async";
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
      : shopMoneyWithSecondary(product.price, product.currency);
    button.type = "button";
    if (isPreviewProduct(product)) {
      button.dataset.notifyProduct = product.id;
      button.textContent = shopText("notifyMe", "Notify me when available");
    } else {
      button.dataset.addToCart = product.id;
      button.disabled = product.stock <= 0;
      button.textContent = product.stock > 0 ? shopText("addToCart", "Add to cart") : shopText("soldOut", "Sold out");
    }

    const priceGroup = document.createElement("div");
    priceGroup.className = "product-price-group";
    // publicProduct() already only sends compareAtPrice when it's genuinely
    // higher than price, so no re-check is needed here.
    if (!isPreviewProduct(product) && product.compareAtPrice) {
      const comparePrice = document.createElement("del");
      comparePrice.className = "product-compare-price";
      comparePrice.textContent = shopMoney(product.compareAtPrice, product.currency);
      priceGroup.appendChild(comparePrice);
    }
    priceGroup.appendChild(price);

    footer.className = "product-card-footer";
    footer.append(priceGroup, button);
    card.append(media, meta, title, description, specs, sizeHint, footer);
    grid.appendChild(card);
  });
}

// Header cart badge (desktop nav + mobile menu link) - the only "cart
// rendering" this page still does; the cart's own contents live on /cart.
function applyCartBadge(cart) {
  document.querySelectorAll("[data-cart-badge]").forEach((element) => {
    const count = Number(cart.count || 0);
    element.textContent = String(count);
    element.hidden = count === 0;
  });
}

function randomizeHeroShirt(products) {
  const heroViewer = document.querySelector("#tshirtViewer");
  if (!heroViewer) return;

  const liveCandidates = products.filter((product) => product.status === "live" && product.studio?.textureUrl);
  const candidates = liveCandidates.length ? liveCandidates : products.filter((product) => product.studio?.textureUrl);
  if (!candidates.length) return;

  const lastId = sessionStorage.getItem("beca-hero-last");
  const pool = candidates.length > 1 ? candidates.filter((product) => product.id !== lastId) : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  sessionStorage.setItem("beca-hero-last", pick.id);
  applyModelViewerTexture(heroViewer, pick.studio.textureUrl);
}

// The country param is best-effort: whatever detectCountryCode() (via
// window.BecaRegion.detect()) currently knows, which on first paint is
// usually still the timezone/browser-language guess (the real geo-IP
// lookup that beats it is in flight - see loadGeoCountry in locale.js).
// /api/products resolves prices for it if a country_config + price
// override exist, and silently falls back to the base price otherwise -
// never a reason to block this fetch on the geo lookup finishing first.
function productsUrl() {
  const country = window.BecaRegion?.detect?.().country;
  return country ? `/api/products?country=${encodeURIComponent(country)}` : "/api/products";
}

async function loadShop() {
  const [{ products }, { cart }] = await Promise.all([
    shopRequest(productsUrl()),
    shopRequest("/api/cart")
  ]);

  renderProducts(products);
  applyCartBadge(cart);
  randomizeHeroShirt(products);
  window.__BECA_SHOP_STATE__ = { products, cart, country: window.BecaRegion?.detect?.().country || null };
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

  try {
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
      applyCartBadge(cart);
      addButton.textContent = shopText("addedToCart", "Added to cart.");
      window.setTimeout(() => {
        addButton.disabled = false;
        addButton.textContent = shopText("addToCart", "Add to cart");
      }, 1400);
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
  } catch (error) {
    if (addButton) {
      addButton.disabled = false;
      addButton.textContent = error.message;
      window.setTimeout(() => {
        addButton.textContent = shopText("addToCart", "Add to cart");
      }, 1800);
    }
  }
});

loadShop().catch(() => {
  const grid = document.querySelector("[data-product-grid]");
  if (grid) {
    grid.innerHTML = `<article class="shop-loading"><span>${shopText("drop", "Drop")}</span><h3>${shopText("productsLoadFailed", "Products could not load.")}</h3></article>`;
  }
});

// A language/rate override only needs a re-render (the same products,
// reformatted) - but the geo-IP lookup resolving after this page's first
// paint (see loadGeoCountry in locale.js) changes WHICH country the price
// itself should be resolved for, which the already-fetched products don't
// reflect yet. Re-fetching only when the detected country actually moved
// keeps every other beca:locale-change firing (language switch, rates
// loading) exactly as cheap as before.
window.addEventListener("beca:locale-change", async () => {
  const state = window.__BECA_SHOP_STATE__;
  if (!state) return;

  const country = window.BecaRegion?.detect?.().country || null;
  if (country !== state.country) {
    try {
      const { products } = await shopRequest(productsUrl());
      state.products = products;
      state.country = country;
    } catch {
      // Keep showing the previous (still valid, just not re-resolved for
      // the new country) product list rather than blanking the page.
    }
  }

  renderProducts(state.products);
  applyCartBadge(state.cart);
});
