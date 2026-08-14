// Standard ISO 3166-1 alpha-2 codes with English short names. Static
// reference data (not admin-configurable business data - what BeCa charges
// per country is what's configurable, and that's fetched from
// /api/checkout-options below), so it lives here rather than round-tripping
// through the server.
const ISO_COUNTRIES = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AD", "Andorra"], ["AO", "Angola"],
  ["AG", "Antigua and Barbuda"], ["AR", "Argentina"], ["AM", "Armenia"], ["AU", "Australia"], ["AT", "Austria"],
  ["AZ", "Azerbaijan"], ["BS", "Bahamas"], ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BB", "Barbados"],
  ["BY", "Belarus"], ["BE", "Belgium"], ["BZ", "Belize"], ["BJ", "Benin"], ["BT", "Bhutan"],
  ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"], ["BW", "Botswana"], ["BR", "Brazil"], ["BN", "Brunei"],
  ["BG", "Bulgaria"], ["BF", "Burkina Faso"], ["BI", "Burundi"], ["KH", "Cambodia"], ["CM", "Cameroon"],
  ["CA", "Canada"], ["CV", "Cabo Verde"], ["CF", "Central African Republic"], ["TD", "Chad"], ["CL", "Chile"],
  ["CN", "China"], ["CO", "Colombia"], ["KM", "Comoros"], ["CG", "Congo"], ["CD", "Congo (DRC)"],
  ["CR", "Costa Rica"], ["CI", "Cote d'Ivoire"], ["HR", "Croatia"], ["CU", "Cuba"], ["CY", "Cyprus"],
  ["CZ", "Czechia"], ["DK", "Denmark"], ["DJ", "Djibouti"], ["DM", "Dominica"], ["DO", "Dominican Republic"],
  ["EC", "Ecuador"], ["EG", "Egypt"], ["SV", "El Salvador"], ["GQ", "Equatorial Guinea"], ["ER", "Eritrea"],
  ["EE", "Estonia"], ["SZ", "Eswatini"], ["ET", "Ethiopia"], ["FJ", "Fiji"], ["FI", "Finland"],
  ["FR", "France"], ["GA", "Gabon"], ["GM", "Gambia"], ["GE", "Georgia"], ["DE", "Germany"],
  ["GH", "Ghana"], ["GR", "Greece"], ["GD", "Grenada"], ["GT", "Guatemala"], ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"], ["GY", "Guyana"], ["HT", "Haiti"], ["HN", "Honduras"], ["HK", "Hong Kong"],
  ["HU", "Hungary"], ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"],
  ["IQ", "Iraq"], ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"], ["JM", "Jamaica"],
  ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"], ["KI", "Kiribati"],
  ["KW", "Kuwait"], ["KG", "Kyrgyzstan"], ["LA", "Laos"], ["LV", "Latvia"], ["LB", "Lebanon"],
  ["LS", "Lesotho"], ["LR", "Liberia"], ["LY", "Libya"], ["LI", "Liechtenstein"], ["LT", "Lithuania"],
  ["LU", "Luxembourg"], ["MO", "Macao"], ["MG", "Madagascar"], ["MW", "Malawi"], ["MY", "Malaysia"],
  ["MV", "Maldives"], ["ML", "Mali"], ["MT", "Malta"], ["MH", "Marshall Islands"], ["MR", "Mauritania"],
  ["MU", "Mauritius"], ["MX", "Mexico"], ["FM", "Micronesia"], ["MD", "Moldova"], ["MC", "Monaco"],
  ["MN", "Mongolia"], ["ME", "Montenegro"], ["MA", "Morocco"], ["MZ", "Mozambique"], ["MM", "Myanmar"],
  ["NA", "Namibia"], ["NR", "Nauru"], ["NP", "Nepal"], ["NL", "Netherlands"], ["NZ", "New Zealand"],
  ["NI", "Nicaragua"], ["NE", "Niger"], ["NG", "Nigeria"], ["MK", "North Macedonia"], ["NO", "Norway"],
  ["OM", "Oman"], ["PK", "Pakistan"], ["PW", "Palau"], ["PA", "Panama"], ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"], ["PE", "Peru"], ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"],
  ["QA", "Qatar"], ["RO", "Romania"], ["RU", "Russia"], ["RW", "Rwanda"], ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"], ["VC", "Saint Vincent and the Grenadines"], ["WS", "Samoa"], ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"], ["SA", "Saudi Arabia"], ["SN", "Senegal"], ["RS", "Serbia"],
  ["SC", "Seychelles"], ["SL", "Sierra Leone"], ["SG", "Singapore"], ["SK", "Slovakia"], ["SI", "Slovenia"],
  ["SB", "Solomon Islands"], ["SO", "Somalia"], ["ZA", "South Africa"], ["KR", "South Korea"], ["SS", "South Sudan"],
  ["ES", "Spain"], ["LK", "Sri Lanka"], ["SD", "Sudan"], ["SR", "Suriname"], ["SE", "Sweden"],
  ["CH", "Switzerland"], ["SY", "Syria"], ["TW", "Taiwan"], ["TJ", "Tajikistan"], ["TZ", "Tanzania"],
  ["TH", "Thailand"], ["TL", "Timor-Leste"], ["TG", "Togo"], ["TO", "Tonga"], ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"], ["TR", "Turkey"], ["TM", "Turkmenistan"], ["TV", "Tuvalu"], ["UG", "Uganda"],
  ["UA", "Ukraine"], ["AE", "United Arab Emirates"], ["GB", "United Kingdom"], ["US", "United States"],
  ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VU", "Vanuatu"], ["VA", "Vatican City"], ["VE", "Venezuela"],
  ["VN", "Vietnam"], ["YE", "Yemen"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"]
];

function populateCountrySelect() {
  const select = document.querySelector("[data-address-country]");
  if (!select || select.dataset.populated) return;
  select.dataset.populated = "true";

  ISO_COUNTRIES.forEach(([code, name]) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  });
}

// Every call site here displays an amount the SERVER already resolved
// (base cart pricing, or /api/checkout-options once a country is picked) -
// never a pre-resolution browsing price - so this must render in EXACT
// mode (the known currency, zero conversion), not BecaRegion.money()'s
// PROFILE mode (the viewer's own browser-detected currency, converting only
// if a rate happens to be configured for that specific pair). Using PROFILE
// mode here previously mislabeled correctly-resolved amounts with whatever
// currency the viewer's browser looked like it wanted - e.g. a RON total
// shown as "GBP" for a GBP-profile visitor, since no GBP<->RON rate was
// configured and profile mode silently keeps the number but swaps the label.
function checkoutMoney(value, currency = "GBP") {
  if (window.BecaCurrency?.formatExact) return window.BecaCurrency.formatExact(value, currency);
  if (window.BecaRegion?.money) return window.BecaRegion.money(value, currency);
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function checkoutText(key, fallback = key, replacements = {}) {
  return window.BecaRegion?.text?.(key, replacements) || fallback;
}

function checkoutDisplayProduct(product) {
  return window.BecaRegion?.displayProduct?.(product) || {
    ...product,
    displayName: product.name
  };
}

function applyCartBadge(cart) {
  document.querySelectorAll("[data-cart-badge]").forEach((element) => {
    const count = Number(cart.count || 0);
    element.textContent = String(count);
    element.hidden = count === 0;
  });
}

async function checkoutRequest(url, options = {}) {
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

// Populated by loadCheckoutOptions() once a country is selected. This is a
// PREVIEW only - server.js's resolveShipping/resolveTax/computeOrderTotals
// are the sole source of truth for what actually gets charged; the server
// never trusts anything computed here.
let checkoutOptions = { shippingMethods: [], tax: null };
let selectedShippingMethodId = null;

function selectedShippingMethod() {
  return checkoutOptions.shippingMethods.find((method) => method.id === selectedShippingMethodId) || null;
}

// Mirrors resolveShipping's free-shipping-threshold check in server.js.
// cartTotal here is the pre-discount subtotal (no live coupon preview
// exists client-side, same limitation the total display already had before
// shipping/tax existed - a coupon's effect is only known after submission).
function previewShippingCost(cartTotal) {
  const method = selectedShippingMethod();
  if (!method) return 0;
  if (method.freeShippingThreshold != null && cartTotal >= method.freeShippingThreshold) return 0;
  return method.price;
}

// Mirrors computeOrderTotals's tax math in server.js: an inclusive rate is
// already baked into cartTotal (informational only, not added again); an
// exclusive rate is added on top.
function previewTax(cartTotal) {
  const tax = checkoutOptions.tax;
  if (!tax || !tax.rate) return { amount: 0, addOn: 0 };
  const base = Math.max(0, cartTotal);
  const amount = Math.round((tax.inclusive ? base - base / (1 + tax.rate / 100) : base * (tax.rate / 100)) * 100) / 100;
  return { amount, addOn: tax.inclusive ? 0 : amount };
}

function renderDeliveryOptions() {
  const container = document.querySelector("[data-delivery-options]");
  if (!container) return;

  const methods = checkoutOptions.shippingMethods;

  if (!methods.length) {
    selectedShippingMethodId = null;
    container.innerHTML = `<p class="delivery-option-meta">${escapeHtml(checkoutText("checkout.freeShippingNote", "Free shipping to this destination."))}</p>`;
    return;
  }

  if (!methods.some((method) => method.id === selectedShippingMethodId)) {
    selectedShippingMethodId = methods[0].id;
  }

  // Every method's price here is already resolved server-side in
  // checkoutOptions.currency (see /api/checkout-options), never the base
  // cart's own currency - using the wrong label would pair a correct
  // number with the wrong currency symbol, worse than a stale one.
  const currency = checkoutOptions.currency || window.__BECA_CHECKOUT_CART__?.currency || "GBP";
  container.innerHTML = methods.map((method) => `
    <label class="delivery-option">
      <div class="delivery-option-main">
        <input type="radio" name="shippingMethodId" value="${method.id}" ${method.id === selectedShippingMethodId ? "checked" : ""}>
        <div>
          <span class="delivery-option-name">${escapeHtml(method.name)}</span>
          ${method.estimatedDeliveryText ? `<span class="delivery-option-meta">${escapeHtml(method.estimatedDeliveryText)}</span>` : ""}
        </div>
      </div>
      <span class="delivery-option-price">${method.price > 0 ? checkoutMoney(method.price, currency) : checkoutText("checkout.free", "Free")}</span>
    </label>
  `).join("");
}

async function loadCheckoutOptions(country) {
  const container = document.querySelector("[data-delivery-options]");
  if (!country) {
    checkoutOptions = { shippingMethods: [], tax: null };
    selectedShippingMethodId = null;
    if (container) container.innerHTML = `<p class="delivery-option-meta">${escapeHtml(checkoutText("checkout.selectCountryForDelivery", "Select a country above to see delivery options."))}</p>`;
    if (window.__BECA_CHECKOUT_CART__) renderSummary(window.__BECA_CHECKOUT_CART__);
    return;
  }

  if (container) container.innerHTML = `<p class="delivery-option-meta">${escapeHtml(checkoutText("checkout.loadingDelivery", "Loading delivery options..."))}</p>`;

  try {
    checkoutOptions = await checkoutRequest(`/api/checkout-options?country=${encodeURIComponent(country)}`);
  } catch {
    checkoutOptions = { shippingMethods: [], tax: null };
  }

  renderDeliveryOptions();
  if (window.__BECA_CHECKOUT_CART__) renderSummary(window.__BECA_CHECKOUT_CART__);
}

function renderSummary(cart) {
  applyCartBadge(cart);

  // Once a country is picked, checkoutOptions carries the REAL server-
  // resolved currency/prices for this exact cart (loadCheckoutOptions
  // below) - preferred over cart's own numbers (always the store's base
  // currency, since /api/cart never resolves one) whenever it's populated,
  // so the summary never shows a browsing-currency total right before the
  // customer is actually charged in a different one. Before any country is
  // selected, checkoutOptions.items is empty and this falls back to cart -
  // today's exact behavior, unchanged.
  const resolved = checkoutOptions.items?.length === cart.items.length && checkoutOptions.items.length
    ? checkoutOptions
    : null;
  const currency = resolved ? resolved.currency : cart.currency;
  const subtotal = resolved ? resolved.total : cart.total;
  const resolvedItemByKey = resolved ? new Map(resolved.items.map((item) => [item.key, item])) : null;

  const itemsList = document.querySelector("[data-summary-items]");
  if (itemsList) {
    itemsList.innerHTML = "";
    cart.items.forEach((item) => {
      const display = checkoutDisplayProduct(item.product);
      const row = document.createElement("div");
      row.className = "shop-summary-row";
      const label = document.createElement("span");
      label.textContent = `${item.qty}× ${display.displayName}${item.size ? ` (${item.size})` : ""}`;
      const price = document.createElement("span");
      const resolvedItem = resolvedItemByKey?.get(item.key);
      price.textContent = resolvedItem
        ? checkoutMoney(resolvedItem.subtotal, currency)
        : checkoutMoney(item.subtotal, item.product.currency);
      row.append(label, price);
      itemsList.appendChild(row);
    });
  }

  const shippingCost = previewShippingCost(subtotal);
  const tax = previewTax(subtotal);
  const total = Math.round((subtotal + shippingCost + tax.addOn) * 100) / 100;

  const subtotalEl = document.querySelector("[data-checkout-subtotal]");
  const totalEl = document.querySelector("[data-checkout-total]");
  const shippingEl = document.querySelector("[data-checkout-shipping]");
  const taxRow = document.querySelector("[data-checkout-tax-row]");
  const taxLabelEl = document.querySelector("[data-checkout-tax-label]");
  const taxEl = document.querySelector("[data-checkout-tax]");

  if (subtotalEl) subtotalEl.textContent = checkoutMoney(subtotal, currency);
  if (totalEl) totalEl.textContent = checkoutMoney(total, currency);
  if (shippingEl) {
    shippingEl.textContent = shippingCost > 0 ? checkoutMoney(shippingCost, currency) : checkoutText("checkout.free", "Free");
  }

  if (taxRow && taxLabelEl && taxEl) {
    if (tax.amount > 0) {
      taxRow.hidden = false;
      taxLabelEl.textContent = checkoutOptions.tax?.inclusive
        ? checkoutText("checkout.taxIncluded", "VAT (included)")
        : checkoutText("checkout.tax", "Tax");
      taxEl.textContent = checkoutMoney(tax.amount, currency);
    } else {
      taxRow.hidden = true;
    }
  }
}

async function hydrateContactFromUser() {
  const form = document.querySelector("[data-checkout-form]");
  if (!form) return;

  const { user } = await checkoutRequest("/api/me");
  if (!user) return;

  if (!form.elements.customerName.value) form.elements.customerName.value = user.name || "";
  if (!form.elements.customerEmail.value) form.elements.customerEmail.value = user.email || "";
}

function composeAddress(form) {
  const line = String(form.elements.addressLine.value || "").trim();
  const apartment = String(form.elements.addressApartment.value || "").trim();
  const city = String(form.elements.addressCity.value || "").trim();
  const county = String(form.elements.addressCounty.value || "").trim();
  const postalCode = String(form.elements.addressPostalCode.value || "").trim();
  // The select's value is the ISO code (what checkout submits as
  // customerCountry); the composed human-readable address uses the full
  // country name from the chosen option instead.
  const countrySelect = form.elements.addressCountry;
  const country = countrySelect.selectedOptions[0]?.textContent?.trim() || "";

  return [
    line,
    apartment,
    [city, county].filter(Boolean).join(", "),
    postalCode,
    country
  ].filter(Boolean).join("\n");
}

// Lazily initialized once per page load - Square's card element is
// expensive to (re)attach and this page only ever needs one.
let squareCard = null;
let squareSdkLoadPromise = null;

function loadSquareSdk(environment) {
  if (window.Square) return Promise.resolve();
  if (squareSdkLoadPromise) return squareSdkLoadPromise;

  squareSdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Square SDK script failed to load"));
    document.head.appendChild(script);
  });
  return squareSdkLoadPromise;
}

// Mounts the Square card field up front (rather than after checkout
// succeeds) so Payment reads as just another section on one page. Returns
// true if a real card field is now attached; false means the caller should
// fall back to the no-card path (order stays pending/unpaid for manual
// confirmation) - same graceful degradation as the pre-Square drawer flow.
async function initSquareCard() {
  const label = document.querySelector("[data-square-card-label]");
  const note = document.querySelector("[data-payment-note]");

  try {
    const config = await checkoutRequest("/api/square-config");
    if (!config.enabled) throw new Error("not-configured");

    await loadSquareSdk(config.environment);
    if (!window.Square) throw new Error("sdk-unavailable");

    const payments = window.Square.payments(config.applicationId, config.locationId);
    const card = await payments.card();
    await card.attach("[data-square-card]");
    squareCard = card;
    return true;
  } catch (error) {
    // "not-configured" is the expected/normal state on any deploy without
    // Square set up (this local instance included) - still logged so a
    // genuine bug here (a thrown TypeError, say) doesn't look identical to
    // that expected case in the console.
    console.warn("[checkout] card payment unavailable:", error.message || error);
    if (label) label.hidden = true;
    if (note) note.textContent = checkoutText(
      "checkout.noCardNote",
      "Card payment isn't available right now — we'll confirm your order and payment details by email."
    );
    return false;
  }
}

let currentOrder = null;

async function payForCurrentOrder(message, button) {
  try {
    const tokenResult = await squareCard.tokenize();
    if (tokenResult.status !== "OK") {
      throw new Error(tokenResult.errors?.[0]?.message || checkoutText("cardDeclined", "Card was declined."));
    }

    message.dataset.type = "info";
    message.textContent = checkoutText("processingPayment", "Processing payment...");

    const { order, publicAccessToken } = await checkoutRequest(`/api/orders/${encodeURIComponent(currentOrder.id)}/pay`, {
      method: "POST",
      body: JSON.stringify({ sourceId: tokenResult.token, token: currentOrder.token })
    });

    const redirectToken = publicAccessToken || currentOrder.token;
    const tokenPart = redirectToken ? `&token=${encodeURIComponent(redirectToken)}` : "";
    window.location.href = `/order-confirmation?order=${encodeURIComponent(order.id)}${tokenPart}`;
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    button.disabled = false;
  }
}

// Runs once /api/checkout has created the order: its snapshot of the
// address/coupon is already locked in server-side, so further edits here
// wouldn't do anything - disable them rather than leave a false affordance
// during a payment retry.
function lockAddressFields(form) {
  Array.from(form.elements).forEach((element) => {
    if (element.name && !element.closest("[data-payment-section]")) {
      element.disabled = true;
    }
  });
}

// Belt-and-braces alongside button.disabled below: a disabled submit button
// can still theoretically be raced by a second Enter-key submit dispatched
// before the disable takes effect, and that path must never double-run
// /api/checkout (duplicate order, double stock decrement).
let checkoutSubmitInFlight = false;

document.querySelector("[data-checkout-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (checkoutSubmitInFlight) return;
  checkoutSubmitInFlight = true;

  const form = event.currentTarget;
  const message = form.querySelector("[data-checkout-message]");
  const button = form.querySelector("[data-checkout-submit]");
  button.disabled = true;

  try {
    // A prior submit already created the order (e.g. the card was declined)
    // - retry payment only, never re-run /api/checkout, or this would create
    // a duplicate order and double-decrement stock.
    if (currentOrder) {
      message.dataset.type = "info";
      message.textContent = checkoutText("processingPayment", "Processing payment...");
      await payForCurrentOrder(message, button);
      return;
    }

    message.dataset.type = "info";
    message.textContent = checkoutText("sendingOrder", "Sending order...");

    const data = {
      customerName: form.elements.customerName.value,
      customerEmail: form.elements.customerEmail.value,
      customerPhone: form.elements.customerPhone.value,
      customerAddress: composeAddress(form),
      customerCountry: form.elements.addressCountry.value,
      // Which language to send order-lifecycle emails in - the customer's
      // own active site language right now, independent of shipping
      // country. Server-validated against active languages, falls back to
      // the store default for anything else.
      customerLanguage: window.BecaRegion?.language?.(),
      shippingMethodId: selectedShippingMethodId || undefined,
      couponCode: form.elements.couponCode.value
    };

    const { order, publicAccessToken } = await checkoutRequest("/api/checkout", {
      method: "POST",
      body: JSON.stringify(data)
    });

    currentOrder = { id: order.id, token: publicAccessToken };
    lockAddressFields(form);

    if (squareCard) {
      await payForCurrentOrder(message, button);
    } else {
      const tokenPart = publicAccessToken ? `&token=${encodeURIComponent(publicAccessToken)}` : "";
      window.location.href = `/order-confirmation?order=${encodeURIComponent(order.id)}${tokenPart}`;
    }
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    button.disabled = false;
  } finally {
    checkoutSubmitInFlight = false;
  }
});

async function initCheckout() {
  let cart;
  try {
    ({ cart } = await checkoutRequest("/api/cart"));
  } catch {
    // Can't tell an empty cart from a transient network failure from here -
    // either way there's nothing to check out, and /cart can retry the fetch.
    window.location.href = "/cart";
    return;
  }

  if (!cart.items.length) {
    window.location.href = "/cart";
    return;
  }
  window.__BECA_CHECKOUT_CART__ = cart;
  populateCountrySelect();
  renderSummary(cart);
}

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-address-country]")) {
    loadCheckoutOptions(event.target.value);
  }

  if (event.target.matches("[name='shippingMethodId']")) {
    selectedShippingMethodId = event.target.value;
    if (window.__BECA_CHECKOUT_CART__) renderSummary(window.__BECA_CHECKOUT_CART__);
  }
});

Promise.all([
  initCheckout(),
  hydrateContactFromUser().catch(() => {}),
  initSquareCard()
]).catch((error) => {
  const message = document.querySelector("[data-checkout-message]");
  if (message) message.textContent = error.message;
});

window.addEventListener("beca:locale-change", () => {
  // Delivery-option rows format money/labels independently of the summary
  // panel (both read from checkoutOptions, already fetched - no network
  // call needed), so a language/region toggle must refresh both or the two
  // panels show the same shipping cost in two different formats.
  renderDeliveryOptions();
  if (window.__BECA_CHECKOUT_CART__) renderSummary(window.__BECA_CHECKOUT_CART__);
});
