async function requestJson(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const { headers: optionHeaders = {}, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: isFormData ? optionHeaders : { "Content-Type": "application/json", ...optionHeaders }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function money(product) {
  const currency = product.currency || "GBP";
  const amount = Number(product.price || product.total || 0);
  return window.BecaCurrency ? window.BecaCurrency.formatExact(amount, currency) : `${currency} ${amount.toFixed(2)}`;
}

function adminImageSrc(src = "") {
  if (!src) return "";
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  return `/${src}`;
}

function productImageSrc(product) {
  return product.imageUrl || "";
}

// Writes text into a slot if the page has it. This file is shared by both
// brands' dashboards, so a slot missing from one copy of the HTML must not
// throw and abort the rest of the render.
function setSlotText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function renderSummary(summary) {
  setSlotText("[data-summary-users]", summary.users);
  setSlotText("[data-summary-products]", summary.products);
  setSlotText("[data-summary-live]", summary.liveProducts);
  setSlotText("[data-summary-preview]", summary.previewProducts || 0);
  setSlotText("[data-summary-notifications]", summary.notifications || 0);
  setSlotText("[data-summary-orders]", summary.orders);
  setSlotText("[data-summary-pageviews]", summary.pageviewsToday || 0);
}

function renderAnalytics(analytics) {
  const dayFormatter = new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit" });
  const daysList = document.querySelector("[data-analytics-days]");
  daysList.innerHTML = (analytics.last14Days || [])
    .map((day) => `<li><span>${dayFormatter.format(new Date(`${day.date}T00:00:00`))}</span><strong>${day.pageviews}</strong></li>`)
    .join("");

  const pagesList = document.querySelector("[data-analytics-top-pages]");
  const topPages = analytics.topPages || [];
  pagesList.innerHTML = topPages.length
    ? topPages.map((page) => `<li><span>${page.path}</span><strong>${page.count}</strong></li>`).join("")
    : "<li><span>Fara date inca</span></li>";
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

function renderStatRows(list, rows, emptyLabel = "Fara date inca") {
  if (!rows.length) {
    list.innerHTML = `<li><span>${escapeHtml(emptyLabel)}</span></li>`;
    return;
  }

  list.innerHTML = rows
    .map(({ label, value }) => `<li title="${escapeHtml(label)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`)
    .join("");
}

function renderStats(revenue, topProducts, traffic) {
  const revenueEl = document.querySelector("[data-stats-revenue]");
  if (!revenueEl) return;

  setSlotText("[data-stats-revenue]", revenue.totalRevenue);
  setSlotText("[data-stats-aov]", revenue.averageOrderValue);
  setSlotText("[data-stats-orders]", revenue.totalOrders);
  setSlotText("[data-stats-conversion]", `${revenue.conversionRate}%`);

  const dayFormatter = new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit" });
  renderStatRows(
    document.querySelector("[data-stats-revenue-days]"),
    (revenue.last14Days || []).map((day) => ({
      label: dayFormatter.format(new Date(`${day.date}T00:00:00`)),
      value: `${day.revenue} · ${day.orders} com.`
    }))
  );

  renderStatRows(
    document.querySelector("[data-stats-top-products]"),
    (topProducts.topProducts || []).map((entry) => ({
      label: `${entry.name}${entry.size ? ` (${entry.size})` : ""}`,
      value: `${entry.qty} buc · ${entry.revenue}`
    }))
  );

  renderStatRows(
    document.querySelector("[data-stats-referrers]"),
    (traffic.topReferrers || []).map((entry) => ({ label: entry.source, value: entry.count }))
  );

  renderStatRows(
    document.querySelector("[data-stats-locales]"),
    (traffic.topLocales || []).map((entry) => ({ label: entry.locale, value: entry.count }))
  );

  renderStatRows(
    document.querySelector("[data-stats-hours]"),
    (traffic.hours || []).map((count, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: count }))
  );

  renderStatRows(
    document.querySelector("[data-stats-visits]"),
    (traffic.recentVisits || []).slice(0, 20).map((visit) => ({
      label: `${visit.path} · ${visit.referrer} · ${visit.locale}`,
      value: visit.ip
    }))
  );
}

function renderReviewsAdmin(reviews) {
  const list = document.querySelector("[data-reviews-admin]");
  if (!list) return;

  list.innerHTML = "";

  if (!reviews.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>No reviews yet</strong><span>Customer reviews will appear here for moderation.</span>";
    list.appendChild(empty);
    return;
  }

  reviews.forEach((review) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const text = document.createElement("p");
    const controls = document.createElement("div");
    const approveButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = `${review.productName} / ${"*".repeat(review.rating)} / ${new Date(review.createdAt).toLocaleString()}`;
    title.textContent = review.name || "Client";
    text.textContent = review.text;

    approveButton.type = "button";
    approveButton.dataset.reviewApprove = review.id;
    approveButton.dataset.approved = review.approved ? "false" : "true";
    approveButton.textContent = review.approved ? "Ascunde" : "Aproba";

    deleteButton.type = "button";
    deleteButton.dataset.reviewDelete = review.id;
    deleteButton.textContent = "Sterge";

    info.append(meta, title, text);
    controls.append(approveButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderCoupons(coupons) {
  const list = document.querySelector("[data-coupons-list]");
  if (!list) return;

  list.innerHTML = "";

  if (!coupons.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>No coupons yet</strong><span>Create a discount code above.</span>";
    list.appendChild(empty);
    return;
  }

  coupons.forEach((coupon) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const usage = document.createElement("p");
    const controls = document.createElement("div");
    const toggleButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = coupon.type === "fixed" ? `${coupon.value} fix` : `${coupon.value}%`;
    title.textContent = coupon.code;
    usage.textContent = `Folosit ${coupon.usedCount || 0}${coupon.maxUses ? ` / ${coupon.maxUses}` : ""}${coupon.minOrderValue ? ` / min. GBP ${coupon.minOrderValue}` : ""}${coupon.expiresAt ? ` / expira ${new Date(coupon.expiresAt).toLocaleDateString()}` : ""}`;

    toggleButton.type = "button";
    toggleButton.dataset.couponToggle = coupon.id;
    toggleButton.dataset.active = coupon.active ? "false" : "true";
    toggleButton.textContent = coupon.active ? "Dezactiveaza" : "Activeaza";

    deleteButton.type = "button";
    deleteButton.dataset.couponDelete = coupon.id;
    deleteButton.textContent = "Sterge";

    info.append(meta, title, usage);
    controls.append(toggleButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function shippingMethodRowHtml(method) {
  // shipping_methods.price has no currency column of its own yet - it's
  // always denominated in the store's current default currency (see
  // server.js's resolveShipping/the future shipping_method_prices table
  // for the per-currency override), so the default currency's own
  // formatting config applies here, not a hardcoded "GBP".
  const defaultCurrency = currenciesState.find((currency) => currency.isDefault)?.code || "GBP";
  const bits = [money({ price: method.price, currency: defaultCurrency })];
  if (method.freeShippingThreshold != null) bits.push(`gratuit peste ${money({ price: method.freeShippingThreshold, currency: defaultCurrency })}`);
  if (method.estimatedDeliveryText) bits.push(escapeHtml(method.estimatedDeliveryText));

  // Was silently "" (no editor, no explanation) when no country was
  // configured yet - looked like the per-country price feature didn't
  // exist at all rather than just needing its one prerequisite set up.
  const pricesEditor = countryConfigState.length > 0 ? `
    <details class="admin-price-editor">
      <summary>Preturi pe tari${method.prices?.length ? ` (${method.prices.length} configurate)` : ""}</summary>
      <div class="admin-price-editor-body">
        <div class="admin-price-rows" data-shipping-method-price-rows="${method.id}">
          ${countryPriceRowsHtml(method.prices, countryConfigState, { withFreeShippingThreshold: true })}
        </div>
        <button type="button" data-save-shipping-method-prices="${method.id}">Salveaza preturile</button>
        <span class="form-message" data-shipping-method-prices-message="${method.id}"></span>
      </div>
    </details>
  ` : `<p class="admin-form-hint">Adauga cel putin o tara in "Limbi &amp; Monede" ca sa poti seta preturi de livrare pe tari.</p>`;

  return `
    <div class="admin-shipping-method-row">
      <div>
        <strong>${escapeHtml(method.name)}${method.active ? "" : " (dezactivata)"}</strong>
        <span>${bits.join(" &middot; ")}</span>
      </div>
      <div>
        <button type="button" data-shipping-method-toggle="${method.id}" data-active="${method.active ? "false" : "true"}">${method.active ? "Dezactiveaza" : "Activeaza"}</button>
        <button type="button" data-shipping-method-delete="${method.id}">Sterge</button>
      </div>
    </div>
    ${pricesEditor}
  `;
}

function renderShippingZones(zones) {
  const list = document.querySelector("[data-shipping-zones-list]");
  if (!list) return;

  list.innerHTML = "";

  if (!zones.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio zona de livrare</strong><span>Adauga o zona mai sus - fara nicio zona, toate tarile primesc livrare gratuita.</span>";
    list.appendChild(empty);
    return;
  }

  zones.forEach((zone) => {
    const item = document.createElement("article");
    item.className = "admin-product admin-order admin-shipping-zone";

    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const countries = document.createElement("div");
    const methodsBox = document.createElement("div");
    const controls = document.createElement("div");
    const toggleButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    meta.textContent = zone.active ? "Activa" : "Dezactivata";
    title.textContent = zone.name;

    countries.className = "admin-shipping-zone-countries";
    countries.innerHTML = zone.countries.length
      ? zone.countries.map((code) => `<span>${escapeHtml(code)}</span>`).join("")
      : "<span>Restul lumii</span>";

    methodsBox.className = "admin-shipping-methods";
    methodsBox.innerHTML = `
      <strong>Metode</strong>
      ${(zone.methods || []).map(shippingMethodRowHtml).join("") || "<span>Nicio metoda inca.</span>"}
      <form class="admin-inline-form" data-shipping-method-form data-zone-id="${zone.id}">
        <label>Nume<input name="name" placeholder="Standard" required></label>
        <label>Pret<input name="price" type="number" min="0" step="0.01" required></label>
        <label>Prag livrare gratuita (optional)<input name="freeShippingThreshold" type="number" min="0" step="0.01"></label>
        <label>Livrare estimata (optional)<input name="estimatedDeliveryText" placeholder="2-5 zile"></label>
        <button type="submit">Adauga metoda</button>
        <span class="form-message" data-shipping-method-message></span>
      </form>
    `;

    toggleButton.type = "button";
    toggleButton.dataset.shippingZoneToggle = zone.id;
    toggleButton.dataset.active = zone.active ? "false" : "true";
    toggleButton.textContent = zone.active ? "Dezactiveaza" : "Activeaza";

    deleteButton.type = "button";
    deleteButton.dataset.shippingZoneDelete = zone.id;
    deleteButton.dataset.deleteName = zone.name;
    deleteButton.textContent = "Sterge zona";

    info.append(meta, title, countries, methodsBox);
    controls.append(toggleButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderTaxRates(taxRates) {
  const list = document.querySelector("[data-tax-rates-list]");
  if (!list) return;

  list.innerHTML = "";

  if (!taxRates.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio cota de taxa</strong><span>Adauga o cota mai sus.</span>";
    list.appendChild(empty);
    return;
  }

  taxRates.forEach((rate) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const controls = document.createElement("div");
    const toggleButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = rate.active ? "Activa" : "Dezactivata";
    title.textContent = `${rate.name} - ${rate.country}${rate.region ? ` / ${rate.region}` : ""}`;
    detail.textContent = `${rate.rate}% - ${rate.inclusive ? "inclusa in pret" : "adaugata la total"}${rate.priority ? ` - prioritate ${rate.priority}` : ""}`;

    toggleButton.type = "button";
    toggleButton.dataset.taxRateToggle = rate.id;
    toggleButton.dataset.active = rate.active ? "false" : "true";
    toggleButton.textContent = rate.active ? "Dezactiveaza" : "Activeaza";

    deleteButton.type = "button";
    deleteButton.dataset.taxRateDelete = rate.id;
    deleteButton.textContent = "Sterge";

    info.append(meta, title, detail);
    controls.append(toggleButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderLanguages(languages) {
  const list = document.querySelector("[data-languages-list]");
  if (!list) return;
  list.innerHTML = "";

  if (!languages.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio limba</strong><span>Adauga o limba mai sus.</span>";
    list.appendChild(empty);
    return;
  }

  languages.forEach((language) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const controls = document.createElement("div");
    const defaultButton = document.createElement("button");
    const toggleButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = [language.active ? "Activa" : "Dezactivata", language.isDefault ? "Implicita" : ""].filter(Boolean).join(" - ");
    title.textContent = `${language.name} (${language.code}) - ${language.nativeName}`;

    defaultButton.type = "button";
    defaultButton.dataset.languageSetDefault = language.code;
    defaultButton.textContent = "Seteaza implicita";
    defaultButton.disabled = language.isDefault;

    toggleButton.type = "button";
    toggleButton.dataset.languageToggle = language.code;
    toggleButton.dataset.active = language.active ? "false" : "true";
    toggleButton.textContent = language.active ? "Dezactiveaza" : "Activeaza";

    deleteButton.type = "button";
    deleteButton.dataset.languageDelete = language.code;
    deleteButton.dataset.deleteName = language.name;
    deleteButton.textContent = "Sterge";

    info.append(meta, title);
    controls.append(defaultButton, toggleButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderCurrencies(currencies) {
  const list = document.querySelector("[data-currencies-list]");
  if (!list) return;
  list.innerHTML = "";

  if (!currencies.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio moneda</strong><span>Adauga o moneda mai sus.</span>";
    list.appendChild(empty);
    return;
  }

  currencies.forEach((currency) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const controls = document.createElement("div");
    const defaultButton = document.createElement("button");
    const toggleButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = [currency.active ? "Activa" : "Dezactivata", currency.isDefault ? "Implicita" : ""].filter(Boolean).join(" - ");
    title.textContent = `${currency.code} (${currency.symbol})`;
    detail.textContent = [
      `${currency.decimalPlaces} zecimale - simbol ${currency.symbolPosition === "after" ? "dupa" : "inainte"}`,
      currency.displayRateFromDefault ? `pret secundar activ (curs ${currency.displayRateFromDefault})` : ""
    ].filter(Boolean).join(" - ");

    defaultButton.type = "button";
    defaultButton.dataset.currencySetDefault = currency.code;
    defaultButton.textContent = "Seteaza implicita";
    defaultButton.disabled = currency.isDefault;

    toggleButton.type = "button";
    toggleButton.dataset.currencyToggle = currency.code;
    toggleButton.dataset.active = currency.active ? "false" : "true";
    toggleButton.textContent = currency.active ? "Dezactiveaza" : "Activeaza";

    deleteButton.type = "button";
    deleteButton.dataset.currencyDelete = currency.code;
    deleteButton.dataset.deleteName = currency.code;
    deleteButton.textContent = "Sterge";

    info.append(meta, title, detail);
    controls.append(defaultButton, toggleButton, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderCountryConfig(countryConfigs) {
  const list = document.querySelector("[data-country-config-list]");
  if (!list) return;
  list.innerHTML = "";

  if (!countryConfigs.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio mapare de tara</strong><span>Adauga una mai sus - fara mapare, o tara foloseste automat limba si moneda implicita.</span>";
    list.appendChild(empty);
    return;
  }

  countryConfigs.forEach((config) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const deleteButton = document.createElement("button");

    item.className = "admin-product admin-order";
    meta.textContent = config.countryCode;
    title.textContent = `Limba: ${config.languageCode} - Moneda: ${config.currencyCode}`;
    const shippingText = config.shippingZoneName ? `Zona livrare: ${config.shippingZoneName}` : "Fara zona de livrare configurata (livrare gratuita)";
    const taxText = config.taxName ? `Taxa: ${config.taxName} (${config.taxRate}%)` : "Fara taxa configurata";
    detail.textContent = `${shippingText} - ${taxText}`;

    deleteButton.type = "button";
    deleteButton.dataset.countryConfigDelete = config.countryCode;
    deleteButton.dataset.deleteName = config.countryCode;
    deleteButton.textContent = "Sterge maparea";

    info.append(meta, title, detail);
    item.append(info, deleteButton);
    list.appendChild(item);
  });
}

// Fills the language/currency <select> elements in the country-config form -
// called on every loadDashboard() refresh so a newly added language/currency
// shows up without a page reload.
function syncCountryConfigSelects(languages, currencies) {
  const languageSelect = document.querySelector("[data-country-config-language-select]");
  const currencySelect = document.querySelector("[data-country-config-currency-select]");
  if (languageSelect) {
    const previous = languageSelect.value;
    languageSelect.innerHTML = languages.map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`).join("");
    if (languages.some((l) => l.code === previous)) languageSelect.value = previous;
  }
  if (currencySelect) {
    const previous = currencySelect.value;
    currencySelect.innerHTML = currencies.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} (${escapeHtml(c.symbol)})</option>`).join("");
    if (currencies.some((c) => c.code === previous)) currencySelect.value = previous;
  }
  const translationSelect = document.querySelector("[data-translation-language-select]");
  if (translationSelect) {
    const previous = translationSelect.value;
    translationSelect.innerHTML = languages.map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`).join("");
    if (languages.some((l) => l.code === previous)) translationSelect.value = previous;
  }
}

// Flat, free-form key/value override list (unlike the structured
// per-section Continut editor) - grouped by language for readability, one
// row per {key, languageCode} pair (matches translations' own UNIQUE
// constraint in lib/db.js).
function renderTranslations(translations) {
  const list = document.querySelector("[data-translations-list]");
  if (!list) return;
  list.innerHTML = "";

  if (!translations.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio traducere inca</strong><span>Adauga una mai sus - fara ea, textul respectiv foloseste automat varianta standard (engleza, daca limba nu are alta implicita).</span>";
    list.appendChild(empty);
    return;
  }

  const byLanguage = new Map();
  translations.forEach((entry) => {
    if (!byLanguage.has(entry.languageCode)) byLanguage.set(entry.languageCode, []);
    byLanguage.get(entry.languageCode).push(entry);
  });

  [...byLanguage.keys()].sort().forEach((languageCode) => {
    const group = document.createElement("article");
    group.className = "admin-product admin-order";
    const title = document.createElement("h3");
    title.textContent = languageCode.toUpperCase();
    const rows = document.createElement("div");
    byLanguage.get(languageCode).sort((a, b) => a.key.localeCompare(b.key)).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "admin-translation-row";
      const key = document.createElement("code");
      key.textContent = entry.key;
      const value = document.createElement("span");
      value.textContent = entry.value;
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.dataset.translationDelete = languageCode;
      deleteButton.dataset.translationKey = entry.key;
      deleteButton.dataset.deleteName = `${languageCode}:${entry.key}`;
      deleteButton.textContent = "Sterge";
      row.append(key, value, deleteButton);
      rows.appendChild(row);
    });
    group.append(title, rows);
    list.appendChild(group);
  });
}

// Categories are born from products' free-text category field
// (resolveOrCreateCategory in server.js) - this panel never creates one
// directly, only renames the default (fallback) name and manages
// per-language translations, mirroring decision #6's "the admin UX for
// setting a product's category does not change" constraint.
function renderCategories(categories) {
  const list = document.querySelector("[data-categories-list]");
  if (!list) return;
  list.innerHTML = "";

  if (!categories.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Nicio categorie inca</strong><span>Categoriile apar automat cand un produs primeste o valoare la campul \"Category\".</span>";
    list.appendChild(empty);
    return;
  }

  const activeLanguages = languagesState.filter((language) => language.active);

  categories.forEach((category) => {
    const item = document.createElement("article");
    item.className = "admin-product admin-order";

    const byLang = new Map(category.translations.map((t) => [t.languageCode, t.name]));
    const langInputs = activeLanguages.map((language) => `
      <label>${escapeHtml(language.name)} (${escapeHtml(language.code)})
        <input name="translation-${escapeHtml(language.code)}" value="${escapeHtml(byLang.get(language.code) || "")}" placeholder="Optional">
      </label>
    `).join("");

    item.innerHTML = `
      <div>
        <span>${escapeHtml(category.slug)}</span>
        <form class="admin-inline-form" data-category-form="${escapeHtml(category.id)}">
          <label>Nume implicit<input name="defaultName" value="${escapeHtml(category.defaultName)}" required></label>
          ${langInputs}
          <button type="submit">Salveaza</button>
          <span class="form-message" data-category-message="${escapeHtml(category.id)}"></span>
        </form>
      </div>
      <button type="button" data-category-delete="${escapeHtml(category.id)}" data-delete-name="${escapeHtml(category.defaultName)}">Sterge</button>
    `;
    list.appendChild(item);
  });
}

function renderTagsManager(tags) {
  const list = document.querySelector("[data-tags-list]");
  const filterSelect = document.querySelector("[data-tag-filter]");
  if (list) {
    list.innerHTML = "";
    if (!tags.length) {
      const empty = document.createElement("span");
      empty.className = "form-message";
      empty.textContent = "Nicio eticheta inca.";
      list.appendChild(empty);
    } else {
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "admin-tag-chip";
        const label = document.createElement("span");
        label.textContent = tag.name;
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.dataset.tagRename = tag.id;
        renameButton.title = "Redenumeste";
        renameButton.textContent = "✎";
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.dataset.tagDelete = tag.id;
        deleteButton.dataset.deleteName = tag.name;
        deleteButton.title = "Sterge";
        deleteButton.textContent = "×";
        chip.append(label, renameButton, deleteButton);
        list.appendChild(chip);
      });
    }
  }

  if (filterSelect) {
    const previousValue = filterSelect.value;
    filterSelect.innerHTML = "<option value=\"\">Toate produsele</option>";
    tags.forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag.id;
      option.textContent = tag.name;
      filterSelect.appendChild(option);
    });
    // tags.some guards against a filter left pointed at a tag that was
    // just deleted - falls back to "all products" instead of a select
    // showing a blank/stale value.
    filterSelect.value = tags.some((tag) => tag.id === previousValue) ? previousValue : "";
    productTagFilter = filterSelect.value;
  }
}

function renderEmailTemplates(templates) {
  const list = document.querySelector("[data-email-templates-list]");
  if (!list) return;

  list.innerHTML = templates.map((template) => {
    const updatedLine = template.updatedAt
      ? `<small class="admin-email-template-updated">Ultima actualizare: ${escapeHtml(new Date(template.updatedAt).toLocaleString("ro-RO"))}</small>`
      : "";
    const variableChips = template.variables.map((name) => (
      `<button type="button" class="admin-tag-chip" data-insert-variable="${escapeHtml(name)}">{{${escapeHtml(name)}}}</button>`
    )).join("");

    return `
      <details class="admin-email-template" data-email-template="${escapeHtml(template.id)}" ${template.id === openEmailTemplateId ? "open" : ""}>
        <summary>
          <span class="admin-email-template-title">
            <strong>${escapeHtml(template.name)}</strong>
            <small>${escapeHtml(template.description)}</small>
          </span>
          <span class="admin-email-template-badges">
            <span class="admin-email-badge" data-state="${template.active ? "active" : "inactive"}">${template.active ? "Activ" : "Inactiv"}</span>
            ${template.isCustomized ? "<span class=\"admin-email-badge\" data-state=\"customized\">Personalizat</span>" : ""}
          </span>
        </summary>
        <div class="admin-email-template-body">
          <form class="admin-edit-form" data-email-template-form="${escapeHtml(template.id)}">
            <label>Subiect<input name="subject" value="${escapeHtml(template.subject)}" maxlength="200" required></label>
            <label>Continut<textarea name="body" rows="8" maxlength="5000" required>${escapeHtml(template.body)}</textarea></label>
            <div class="admin-email-template-vars">
              <small>Variabile disponibile (click pentru a insera in campul activ):</small>
              <div>${variableChips}</div>
            </div>
            <label data-checkbox-label><input type="checkbox" name="active" ${template.active ? "checked" : ""}> Activ (inlocuieste emailul standard trimis automat)</label>
            <div class="admin-email-template-actions">
              <button type="submit">Salveaza</button>
              <button type="button" data-email-preview="${escapeHtml(template.id)}">Previzualizare</button>
              <button type="button" data-email-test-send="${escapeHtml(template.id)}">Trimite email de test</button>
            </div>
            <span class="form-message" data-email-template-message></span>
          </form>
          <div class="admin-email-preview" data-email-preview-box hidden>
            <strong data-email-preview-subject></strong>
            <pre data-email-preview-text></pre>
          </div>
          ${updatedLine}
        </div>
      </details>
    `;
  }).join("");
}

// Fills the email-templates language <select> - called on every
// loadDashboard() refresh so a newly added language shows up without a page
// reload. Sticky like syncCountryConfigSelects, except the fallback when the
// previous selection no longer exists is emailTemplateLanguageState (already
// reconciled to the server's actual response) rather than the browser's
// leftover <select> value.
function syncEmailTemplateLanguageSelect(languages) {
  const select = document.querySelector("[data-email-template-language-select]");
  if (!select) return;
  select.innerHTML = languages.map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`).join("");
  if (languages.some((l) => l.code === emailTemplateLanguageState)) {
    select.value = emailTemplateLanguageState;
  } else if (languages.length) {
    emailTemplateLanguageState = languages[0].code;
    select.value = emailTemplateLanguageState;
  }
}

// Fills an EXISTING container in place (never replaces the node) - shared by
// the static "add product" slot and every freshly-created inline
// product-edit form, so a page with several tag-checkbox groups on screen
// at once never risks a selector match landing on the wrong one.
function fillTagCheckboxes(container, selectedTagIds = []) {
  container.innerHTML = "";
  if (!tagsState.length) {
    const hint = document.createElement("span");
    hint.className = "form-message";
    hint.textContent = "Nicio eticheta creata inca.";
    container.appendChild(hint);
    return;
  }
  tagsState.forEach((tag) => {
    const field = createCheckboxField(tag.name, "tagIds", selectedTagIds.includes(tag.id));
    field.querySelector("input").dataset.tagCheckbox = tag.id;
    container.appendChild(field);
  });
}

function createTagCheckboxesContainer(selectedTagIds = []) {
  const container = document.createElement("div");
  container.className = "admin-tag-checkboxes";
  fillTagCheckboxes(container, selectedTagIds);
  return container;
}

function syncAddProductTagCheckboxes() {
  const slot = document.querySelector("[data-product-tag-checkboxes]");
  if (slot) fillTagCheckboxes(slot);
}

function setAdminView(view) {
  const activeView = view || "overview";

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.adminTab === activeView);
  });

  document.querySelectorAll("[data-admin-view]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.adminView === activeView);
  });

  if (activeView === "studio") {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("beca:studio-visible")));
  }

  if (activeView === "photo-studio") {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("beca:photo-studio-visible"));
      syncPhotoControls();
    });
  }
}

// Shared by the per-product and per-shipping-method price editors below -
// one row per CONFIGURED country (countryConfigState - a country needs a
// language/currency mapping on the "Limbi & Monede" tab before it can be
// priced, since that mapping is where the row's currency comes from),
// pre-filled from whatever override already exists. The currency shown per
// row is read-only (derived from that country's mapping, "just for
// display") - the admin only ever types a price. An empty price field on
// save means "no override for this country", not "zero" -
// collectCountryPriceEntries (below) is what turns a filled-in row into a
// submitted entry.
function countryPriceRowsHtml(existingEntries, countryConfigs, { withCompareAt = false, withFreeShippingThreshold = false } = {}) {
  const byCode = new Map((existingEntries || []).map((entry) => [entry.countryCode, entry]));
  return countryConfigs.map((config) => {
    const existing = byCode.get(config.countryCode);
    return `
      <div class="admin-price-row" data-country-row="${escapeHtml(config.countryCode)}">
        <strong>${escapeHtml(config.countryCode)} <small>(${escapeHtml(config.currencyCode)})</small></strong>
        <input name="price-${escapeHtml(config.countryCode)}" type="number" min="0" step="0.01"
          value="${existing ? existing.price : ""}" placeholder="Pret ${escapeHtml(config.currencyCode)}">
        ${withCompareAt ? `<input name="compareAt-${escapeHtml(config.countryCode)}" type="number" min="0" step="0.01" value="${existing?.compareAtPrice ?? ""}" placeholder="Compara la (optional)">` : ""}
        ${withFreeShippingThreshold ? `<input name="freeShipping-${escapeHtml(config.countryCode)}" type="number" min="0" step="0.01" value="${existing?.freeShippingThreshold ?? ""}" placeholder="Prag gratuit (optional)">` : ""}
        <label data-checkbox-label><input name="active-${escapeHtml(config.countryCode)}" type="checkbox" ${!existing || existing.active ? "checked" : ""}> Activ</label>
      </div>
    `;
  }).join("");
}

// Reads a countryPriceRowsHtml()-rendered form back into the [{countryCode,
// price, ...}] shape /api/admin/products/:id/prices (and the shipping-method
// equivalent) expect - only countries with a real, non-empty price entered
// are included; leaving the field blank is how an admin removes an override.
// currencyCode is never collected here - the server derives it from
// country_config, the admin never chooses it directly.
function collectCountryPriceEntries(container, countryConfigs, { withCompareAt = false, withFreeShippingThreshold = false } = {}) {
  return countryConfigs
    .map((config) => {
      const priceInput = container.querySelector(`[name="price-${config.countryCode}"]`);
      if (!priceInput || priceInput.value === "") return null;
      const entry = {
        countryCode: config.countryCode,
        price: Number(priceInput.value),
        active: container.querySelector(`[name="active-${config.countryCode}"]`)?.checked !== false
      };
      if (withCompareAt) {
        const compareAt = container.querySelector(`[name="compareAt-${config.countryCode}"]`)?.value;
        entry.compareAtPrice = compareAt ? Number(compareAt) : null;
      }
      if (withFreeShippingThreshold) {
        const threshold = container.querySelector(`[name="freeShipping-${config.countryCode}"]`)?.value;
        entry.freeShippingThreshold = threshold ? Number(threshold) : null;
      }
      return entry;
    })
    .filter(Boolean);
}

// One <fieldset> per active NON-DEFAULT language (the default language's
// content is the product's own base name/description fields, already in
// the main form above) - name/description/short description/SEO title+
// description/attributes, pre-filled from any existing product_translations
// row. escapeHtml everywhere a value lands in an attribute or text node;
// textarea content is escaped too since its value would otherwise close
// early on a literal </textarea> in saved copy.
function productTranslationBlocksHtml(existingTranslations, languages) {
  const byLang = new Map((existingTranslations || []).map((entry) => [entry.languageCode, entry]));
  return languages.map((language) => {
    const existing = byLang.get(language.code);
    return `
      <fieldset class="admin-translation-block" data-translation-lang="${escapeHtml(language.code)}">
        <legend>${escapeHtml(language.name)} (${escapeHtml(language.code)})</legend>
        <div class="admin-form-grid">
          <label>Nume<input name="name" value="${escapeHtml(existing?.name || "")}"></label>
          <label>Descriere scurta<input name="shortDescription" value="${escapeHtml(existing?.shortDescription || "")}"></label>
          <label>SEO titlu<input name="seoTitle" value="${escapeHtml(existing?.seoTitle || "")}"></label>
        </div>
        <label>Descriere<textarea name="description" rows="3">${escapeHtml(existing?.description || "")}</textarea></label>
        <label>SEO descriere<textarea name="seoDescription" rows="2">${escapeHtml(existing?.seoDescription || "")}</textarea></label>
        <label>Atribute - "cheie: valoare" pe fiecare linie<textarea name="metadataText" rows="2">${escapeHtml(metadataToText(existing?.metadata))}</textarea></label>
      </fieldset>
    `;
  }).join("");
}

// Reads a productTranslationBlocksHtml()-rendered container back into the
// [{languageCode, name, ...}] shape /api/admin/products/:id/translations
// expects - unlike price rows, every language is always included (a
// translation row with every field blank round-trips as an empty override,
// harmless and simpler than tracking which blocks were "touched").
function collectProductTranslationEntries(container) {
  return [...container.querySelectorAll("[data-translation-lang]")].map((fieldset) => ({
    languageCode: fieldset.dataset.translationLang,
    name: fieldset.querySelector('[name="name"]')?.value || "",
    description: fieldset.querySelector('[name="description"]')?.value || "",
    shortDescription: fieldset.querySelector('[name="shortDescription"]')?.value || "",
    seoTitle: fieldset.querySelector('[name="seoTitle"]')?.value || "",
    seoDescription: fieldset.querySelector('[name="seoDescription"]')?.value || "",
    metadataText: fieldset.querySelector('[name="metadataText"]')?.value || ""
  }));
}

function renderProducts(products) {
  const list = document.querySelector("[data-products]");
  list.innerHTML = "";

  const visibleProducts = productTagFilter
    ? products.filter((product) => (product.tags || []).some((tag) => tag.id === productTagFilter))
    : products;

  visibleProducts.forEach((product) => {
    const item = document.createElement("article");
    const select = document.createElement("label");
    const selectInput = document.createElement("input");
    const info = document.createElement("div");
    const media = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const productTags = document.createElement("div");
    const controls = document.createElement("div");
    const price = document.createElement("strong");
    const stock = document.createElement("small");
    const form = document.createElement("form");
    const deleteButton = document.createElement("button");
    const saveButton = document.createElement("button");

    item.className = "admin-product";
    // Explicit class, not ":last-child" - the price-editor/translations/hint
    // sections appended after info+controls below would otherwise silently
    // steal the "last child" match and leave this column unstyled the
    // moment any of them exists (which is effectively always, since "ro"
    // is a seeded active non-default language from day one).
    controls.className = "admin-product-controls";
    select.className = "admin-product-select";
    selectInput.type = "checkbox";
    selectInput.dataset.bulkProductSelect = product.id;
    selectInput.checked = bulkSelectedIds.has(product.id);
    select.appendChild(selectInput);
    media.className = "admin-product-media";
    const imageSource = productImageSrc(product);
    if (imageSource) {
      const image = document.createElement("img");
      image.src = adminImageSrc(imageSource);
      image.alt = product.name;
      media.appendChild(image);
    } else {
      media.textContent = product.category || "Drop";
    }

    meta.textContent = product.category || "Drop";
    title.textContent = product.name;
    description.textContent = product.description || "No description yet.";
    productTags.className = "admin-product-tags";
    (product.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag.name;
      productTags.appendChild(chip);
    });
    price.textContent = money(product);
    const sizeBreakdown = product.sizeStock
      ? (product.sizes || []).map((size) => `${size}:${product.sizeStock[size] ?? 0}`).join(", ")
      : "";
    stock.textContent = `${product.stock} stock / ${product.status}${sizeBreakdown ? ` / ${sizeBreakdown}` : (product.sizes?.length ? ` / ${product.sizes.join(", ")}` : "")}`;
    deleteButton.type = "button";
    deleteButton.dataset.delete = product.id;
    // Carried so the confirmation can name the exact piece being removed.
    deleteButton.dataset.deleteName = product.name || "";
    deleteButton.textContent = "Delete";
    saveButton.type = "submit";
    saveButton.textContent = "Save changes";

    form.className = "admin-edit-form";
    form.dataset.editProduct = product.id;
    const genealogyFields = genealogyState.enabled
      ? [createChapterField(product.chapterId), createProductOrderField(product.chapterProductOrder)]
      : [];
    form.append(
      createField("Name", "name", product.name, true),
      createField("Category", "category", product.category || ""),
      createField("Price", "price", product.price, false, "number", "0.01"),
      createField("Currency", "currency", product.currency || "GBP"),
      createField("Stock", "stock", product.stock, false, "number", "1"),
      createField("Image URL", "imageUrl", product.imageUrl || ""),
      createField("Sizes (e.g. S:5, M:8, L:6, XL:2)", "sizes", sizeBreakdown || (Array.isArray(product.sizes) ? product.sizes.join(", ") : "")),
      createField("Color", "color", product.color || ""),
      createStatusField(product.status),
      ...genealogyFields,
      createFileField(),
      // The default-language content (today, English) - per-language
      // translations for every OTHER active language are a separate block
      // below, submitted to /api/admin/products/:id/translations, not as
      // flat form fields (this used to be mislabeled "Description EN" while
      // actually double as whichever language happened to be default -
      // real bug, see the i18n audit).
      createTextarea("Description", "description", product.description || ""),
      createField("SKU", "sku", product.sku || ""),
      createField("Barcode", "barcode", product.barcode || ""),
      createField("Compare-at price (optional)", "compareAtPrice", product.compareAtPrice ?? "", false, "number", "0.01"),
      createField("Cost price (optional, internal only)", "costPrice", product.costPrice ?? "", false, "number", "0.01"),
      createField("Weight in grams (optional)", "weightGrams", product.weightGrams ?? "", false, "number", "1"),
      createField("Length (optional)", "dimensionsLength", product.dimensions?.length ?? "", false, "number", "0.1"),
      createField("Width (optional)", "dimensionsWidth", product.dimensions?.width ?? "", false, "number", "0.1"),
      createField("Height (optional)", "dimensionsHeight", product.dimensions?.height ?? "", false, "number", "0.1"),
      createField("Dimension unit", "dimensionsUnit", product.dimensions?.unit || "cm"),
      createField("SEO title (optional)", "seoTitle", product.seoTitle || ""),
      createTextarea("SEO description (optional)", "seoDescription", product.seoDescription || ""),
      createField("Canonical URL (optional)", "canonicalUrl", product.canonicalUrl || ""),
      createTextarea("Attributes - one \"key: value\" per line (optional)", "metadataText", metadataToText(product.metadata)),
      createCheckboxField("Featured", "featured", product.featured),
      createTagCheckboxesContainer((product.tags || []).map((tag) => tag.id)),
      saveButton
    );

    info.append(select, media, meta, title, description, productTags, form);
    controls.append(price, stock, deleteButton);
    item.append(info, controls);

    if (countryConfigState.length > 0) {
      const pricesDetails = document.createElement("details");
      pricesDetails.className = "admin-price-editor";
      pricesDetails.innerHTML = `
        <summary>Preturi pe tari${product.prices?.length ? ` (${product.prices.length} configurate)` : ""}</summary>
        <div class="admin-price-editor-body">
          <div class="admin-price-rows" data-product-price-rows="${product.id}">
            ${countryPriceRowsHtml(product.prices, countryConfigState, { withCompareAt: true })}
          </div>
          <button type="button" data-save-product-prices="${product.id}">Salveaza preturile</button>
          <span class="form-message" data-product-prices-message="${product.id}"></span>
        </div>
      `;
      item.appendChild(pricesDetails);
    } else {
      // Was silently absent (no section, no explanation) when no country
      // was configured yet - looked like there was no way at all to price a
      // product per country/currency, rather than one missing prerequisite.
      const hint = document.createElement("p");
      hint.className = "admin-form-hint";
      hint.textContent = "Adauga cel putin o tara in \"Limbi & Monede\" (ex: Romania -> RON) ca sa poti seta aici un pret separat pentru acea tara.";
      item.appendChild(hint);
    }

    const nonDefaultLanguages = languagesState.filter((language) => language.active && !language.isDefault);
    if (nonDefaultLanguages.length > 0) {
      const translationsDetails = document.createElement("details");
      translationsDetails.className = "admin-price-editor";
      translationsDetails.innerHTML = `
        <summary>Traduceri${product.translations?.length ? ` (${product.translations.length} configurate)` : ""}</summary>
        <div class="admin-price-editor-body">
          <div data-product-translation-blocks="${product.id}">
            ${productTranslationBlocksHtml(product.translations, nonDefaultLanguages)}
          </div>
          <button type="button" data-save-product-translations="${product.id}">Salveaza traducerile</button>
          <span class="form-message" data-product-translations-message="${product.id}"></span>
        </div>
      `;
      item.appendChild(translationsDetails);
    }

    list.appendChild(item);
  });

  if (!visibleProducts.length && products.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>Niciun produs cu aceasta eticheta</strong><span>Alege alta eticheta sau reseteaza filtrul.</span>";
    list.appendChild(empty);
  }

  // A reload can drop a product that was selected (e.g. it was just bulk
  // deleted in a prior action) - prune stale ids so the count/select-all
  // checkbox never lies about what's actually still on screen.
  const visibleIds = new Set(products.map((product) => product.id));
  Array.from(bulkSelectedIds).forEach((id) => {
    if (!visibleIds.has(id)) bulkSelectedIds.delete(id);
  });
  syncBulkToolbar();
}

function syncBulkToolbar() {
  const toolbar = document.querySelector("[data-bulk-actions]");
  if (!toolbar) return;

  const countEl = toolbar.querySelector("[data-bulk-selected-count]");
  if (countEl) countEl.textContent = `${bulkSelectedIds.size} selectate`;

  const selectAll = toolbar.querySelector("[data-bulk-select-all]");
  const visibleCheckboxes = document.querySelectorAll("[data-bulk-product-select]");
  if (selectAll) {
    selectAll.checked = visibleCheckboxes.length > 0 && Array.from(visibleCheckboxes).every((cb) => cb.checked);
  }

  const tagSelect = toolbar.querySelector("[data-bulk-tag-value]");
  if (tagSelect) {
    const previousValue = tagSelect.value;
    tagSelect.innerHTML = "";
    tagsState.forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag.id;
      option.textContent = tag.name;
      tagSelect.appendChild(option);
    });
    if (tagsState.some((tag) => tag.id === previousValue)) tagSelect.value = previousValue;
  }

  const actionSelect = toolbar.querySelector("[data-bulk-action]");
  const applyButton = toolbar.querySelector("[data-bulk-apply]");
  if (applyButton && actionSelect) {
    applyButton.disabled = bulkSelectedIds.size === 0 || !actionSelect.value;
  }
}

const photoState = {
  products: [],
  selectedId: "",
  x: 0,
  y: 0,
  size: 58,
  glow: 42,
  angle: 0,
  pose: "back"
};

function getSelectedPhotoProduct() {
  return photoState.products.find((product) => product.id === photoState.selectedId) || photoState.products[0] || null;
}

function syncPhotoControls() {
  const product = getSelectedPhotoProduct();
  const stage = document.querySelector("[data-photo-stage]");
  const viewer = document.querySelector("[data-photo-viewer]");
  if (!stage || !viewer) return;

  if (!product) {
    viewer.dataset.empty = "true";
    return;
  }

  viewer.dataset.empty = "false";
  stage.style.setProperty("--photo-glow", `${photoState.glow / 100}`);
  stage.dataset.productName = product.name || "";
  document.querySelectorAll("[data-photo-pose]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.photoPose === photoState.pose);
  });

  if (window.BecaPhotoStudio3D) {
    window.BecaPhotoStudio3D.loadProduct(product);
    window.BecaPhotoStudio3D.update(photoState);
  }
}

function renderPhotoProducts(products = []) {
  const list = document.querySelector("[data-photo-products]");
  if (!list) return;

  photoState.products = products;
  if (!photoState.selectedId || !products.some((product) => product.id === photoState.selectedId)) {
    photoState.selectedId = products[0]?.id || "";
  }

  list.innerHTML = "";

  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>No products yet</strong><span>Create a product first, then build a scene shot here.</span>";
    list.appendChild(empty);
    syncPhotoControls();
    return;
  }

  products.forEach((product) => {
    const button = document.createElement("button");
    const thumb = document.createElement("span");
    const info = document.createElement("span");
    const name = document.createElement("strong");
    const meta = document.createElement("small");

    button.type = "button";
    button.className = "photo-product-button";
    button.classList.toggle("is-active", product.id === photoState.selectedId);
    button.dataset.photoProduct = product.id;
    thumb.className = "photo-product-thumb";
    const imageSource = productImageSrc(product);
    if (imageSource) {
      thumb.style.backgroundImage = `url("${adminImageSrc(imageSource)}")`;
    }
    name.textContent = product.name || "Untitled";
    meta.textContent = `${product.category || "Piece"} / ${product.status || "draft"}`;

    info.append(name, meta);
    button.append(thumb, info);
    list.appendChild(button);
  });

  syncPhotoControls();
}

function loadImageForCanvas(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(ctx, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

async function buildSceneImage() {
  const product = getSelectedPhotoProduct();
  if (!product) throw new Error("Alege un produs.");
  if (!window.BecaPhotoStudio3D) throw new Error("Photo Studio 3D nu este incarcat inca.");

  await window.BecaPhotoStudio3D.loadProduct(product);
  window.BecaPhotoStudio3D.update(photoState);

  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  const background = await loadImageForCanvas("/assets/studio-stage-bg.png?v=2");
  const productLayer = await loadImageForCanvas(window.BecaPhotoStudio3D.capture(canvas.width, canvas.height));

  drawCover(ctx, background, canvas.width, canvas.height);

  ctx.save();
  ctx.shadowColor = `rgba(232, 184, 75, ${0.38 * (photoState.glow / 100)})`;
  ctx.shadowBlur = 36 * (photoState.glow / 100);
  ctx.drawImage(productLayer, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  return {
    product,
    dataUrl: canvas.toDataURL("image/jpeg", 0.96)
  };
}

async function downloadSceneImage() {
  const { product, dataUrl } = await buildSceneImage();
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${(product.slug || product.name || "product").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-scene.jpg`;
  link.click();
}

async function saveSceneImage() {
  const message = document.querySelector("[data-photo-message]");
  const { product, dataUrl } = await buildSceneImage();
  if (message) {
    message.dataset.type = "info";
    message.textContent = "Saving scene image...";
  }

  const result = await requestJson(`/api/admin/products/${product.id}/scene-image`, {
    method: "POST",
    body: JSON.stringify({ image: dataUrl })
  });

  if (message) {
    message.dataset.type = "success";
    message.textContent = "Saved as product image.";
  }

  photoState.selectedId = result.product.id;
  await loadDashboard();
  renderPhotoProducts(photoState.products);
  setAdminView("photo-studio");
}

function createField(labelText, name, value = "", required = false, type = "text", step = "") {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = labelText;
  input.name = name;
  input.type = type;
  input.value = value ?? "";
  if (required) input.required = true;
  if (step) input.step = step;
  if (type === "number") input.min = "0";
  label.appendChild(input);
  return label;
}

function createTextarea(labelText, name, value = "") {
  const label = document.createElement("label");
  const textarea = document.createElement("textarea");
  label.textContent = labelText;
  textarea.name = name;
  textarea.rows = 3;
  textarea.value = value;
  label.appendChild(textarea);
  return label;
}

function createStatusField(value = "draft") {
  const label = document.createElement("label");
  const select = document.createElement("select");
  label.textContent = "Status";
  select.name = "status";
  ["draft", "preview", "live", "sold-out", "archived"].forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === value;
    select.appendChild(option);
  });
  label.appendChild(select);
  return label;
}

function createFileField() {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = "Replace image";
  input.name = "image";
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  label.appendChild(input);
  return label;
}

function createCheckboxField(labelText, name, checked = false) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.dataset.checkboxLabel = "true";
  input.type = "checkbox";
  input.name = name;
  input.checked = Boolean(checked);
  label.append(input, document.createTextNode(labelText));
  return label;
}

// Inverse of server.js's parseProductMetadata - renders the stored object
// back into the same "key: value" per line shape the textarea round-trips.
function metadataToText(metadata) {
  if (!metadata) return "";
  return Object.entries(metadata).map(([key, value]) => `${key}: ${value}`).join("\n");
}

let genealogyState = { enabled: false, chapters: [], openChapter: null };

function chapterOptionLabel(chapter) {
  return `${chapter.number} — ${chapter.name}`;
}

function createChapterField(value) {
  const label = document.createElement("label");
  const select = document.createElement("select");
  label.textContent = "Genealogy chapter";
  select.name = "chapterId";
  select.required = true;
  genealogyState.chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapterOptionLabel(chapter);
    option.selected = chapter.id === value;
    select.appendChild(option);
  });
  label.appendChild(select);
  return label;
}

function createProductOrderField(value) {
  const label = createField("Product order", "chapterProductOrder", value ?? 999, false, "number", "1");
  const input = label.querySelector("input");
  input.min = "0";
  const helper = document.createElement("small");
  helper.textContent = "Controls the product's position inside its chapter in Sanctuary.";
  label.appendChild(helper);
  return label;
}

function hydrateGenealogySelects() {
  document.querySelectorAll("[data-chapter-select]").forEach((select) => {
    const current = select.value;
    select.innerHTML = "";
    genealogyState.chapters.forEach((chapter) => {
      const option = document.createElement("option");
      option.value = chapter.id;
      option.textContent = chapterOptionLabel(chapter);
      option.selected = chapter.id === current || (!current && chapter.status === "open");
      select.appendChild(option);
    });
  });
}

function renderNotifications(notifications) {
  const list = document.querySelector("[data-notifications]");
  if (!list) return;

  list.innerHTML = "";

  if (!notifications.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>No waitlist yet</strong><span>Preview product notifications will appear here.</span>";
    list.appendChild(empty);
    return;
  }

  notifications.forEach((entry) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const customer = document.createElement("p");
    const controls = document.createElement("div");
    const time = document.createElement("strong");

    item.className = "admin-product admin-order";
    meta.textContent = `${entry.productName || "Preview piece"} / ${new Date(entry.createdAt).toLocaleString()}`;
    title.textContent = entry.name || "Client";
    customer.textContent = `${entry.email || ""}${entry.preferredSize ? ` / size ${entry.preferredSize}` : ""}`;
    time.textContent = "Notify";
    info.append(meta, title, customer);
    controls.append(time);
    item.append(info, controls);
    list.appendChild(item);
  });
}

const ORDER_STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
const ORDER_STATUS_FLOW = ["confirmed", "processing", "shipped", "delivered"];
// Mirrors the server-side state machine - the select only offers reachable states.
const ORDER_ALLOWED_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};
const PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed"];
const orderExpandedState = new Set();

function orderFieldsVisibleFor(status) {
  return {
    shipped: status === "shipped",
    cancelled: status === "cancelled"
  };
}

function computeSkipWarning(currentStatus, nextStatus) {
  if (nextStatus === "cancelled") {
    if (currentStatus === "shipped" || currentStatus === "delivered") {
      return `Comanda e deja "${currentStatus}" - anularea dupa acest pas iese din fluxul obisnuit, dar poti continua.`;
    }
    return "";
  }

  const currentIndex = ORDER_STATUS_FLOW.indexOf(currentStatus);
  const nextIndex = ORDER_STATUS_FLOW.indexOf(nextStatus);
  if (currentIndex === -1 || nextIndex === -1) return "";
  if (nextIndex - currentIndex > 1) {
    const skipped = ORDER_STATUS_FLOW.slice(currentIndex + 1, nextIndex).join(", ");
    return `Sari peste pasul/pasii: ${skipped}. Poti continua, dar clientul nu va primi emailul pentru ${skipped}.`;
  }
  if (nextIndex !== -1 && currentIndex !== -1 && nextIndex < currentIndex) {
    return "Muti comanda inapoi in flux fata de statusul curent.";
  }
  return "";
}

function renderOrderTimeline(order) {
  const entries = order.statusHistory || [];
  if (!entries.length) return "<p class=\"order-timeline-empty\">Fara istoric inca.</p>";

  return `<ul class="order-timeline-list">${entries.slice().reverse().map((entry) => `
    <li>
      <span>${entry.from ? `${entry.from} &rarr; ${entry.to}` : `creata (${entry.to})`}${entry.resend ? " &middot; retrimis manual" : ""}</span>
      <small>${new Date(entry.changedAt).toLocaleString()}${entry.changedBy ? ` &middot; ${entry.changedBy}` : ""} &middot; email: ${entry.emailSent ? "trimis" : "netrimis"}</small>
    </li>
  `).join("")}</ul>`;
}

function createOrderDetailPanel(order) {
  const panel = document.createElement("div");
  panel.className = "order-detail-panel";
  panel.hidden = !orderExpandedState.has(order.id);

  const form = document.createElement("form");
  form.className = "order-status-form";
  form.dataset.orderStatusForm = order.id;

  const statusLabel = document.createElement("label");
  const statusSelect = document.createElement("select");
  statusSelect.name = "status";
  statusSelect.dataset.orderStatusSelect = order.id;
  const reachableStatuses = [order.status, ...(ORDER_ALLOWED_TRANSITIONS[order.status] || ORDER_STATUSES)];
  ORDER_STATUSES.filter((value) => reachableStatuses.includes(value)).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = order.status === value;
    statusSelect.appendChild(option);
  });
  statusLabel.textContent = "New status";
  statusLabel.appendChild(statusSelect);

  const paymentLabel = document.createElement("label");
  const paymentSelect = document.createElement("select");
  paymentSelect.name = "paymentStatus";
  PAYMENT_STATUSES.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "paid" ? "paid (platita)" : value;
    option.selected = (order.paymentStatus || "unpaid") === value;
    paymentSelect.appendChild(option);
  });
  paymentLabel.textContent = "Payment status";
  paymentLabel.appendChild(paymentSelect);

  const noteLabel = document.createElement("label");
  const noteInput = document.createElement("textarea");
  noteInput.name = "customerNote";
  noteInput.rows = 2;
  noteInput.placeholder = "Vizibila clientului in email (optional)";
  noteInput.value = order.fulfillment?.customerNote || "";
  noteLabel.textContent = "Note pentru client (optional)";
  noteLabel.appendChild(noteInput);

  const shippedFields = document.createElement("div");
  shippedFields.className = "order-fields-shipped";
  shippedFields.dataset.fieldsFor = "shipped";
  shippedFields.append(
    createField("Courier", "courierName", order.fulfillment?.courierName || ""),
    createField("AWB / Tracking number", "trackingNumber", order.fulfillment?.trackingNumber || ""),
    createField("Tracking URL", "trackingUrl", order.fulfillment?.trackingUrl || ""),
    createField("Estimated delivery date", "estimatedDeliveryDate", order.fulfillment?.estimatedDeliveryDate || "", false, "date"),
    createTextarea("Internal note (nu apare in email)", "internalNote", order.fulfillment?.internalNote || "")
  );

  const cancelledFields = document.createElement("div");
  cancelledFields.className = "order-fields-cancelled";
  cancelledFields.dataset.fieldsFor = "cancelled";
  cancelledFields.appendChild(createTextarea("Motiv anulare", "cancellationReason", order.cancellationReason || ""));

  const warning = document.createElement("span");
  warning.className = "order-skip-warning";
  warning.dataset.orderSkipWarning = order.id;
  warning.hidden = true;

  const sendEmailLabel = document.createElement("label");
  sendEmailLabel.className = "order-send-email-check";
  const sendEmailCheckbox = document.createElement("input");
  sendEmailCheckbox.type = "checkbox";
  sendEmailCheckbox.name = "sendEmail";
  sendEmailCheckbox.checked = true;
  sendEmailLabel.append(sendEmailCheckbox, document.createTextNode(" Send customer email"));

  const actions = document.createElement("div");
  actions.className = "order-detail-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Save status";
  const resendButton = document.createElement("button");
  resendButton.type = "button";
  resendButton.dataset.orderResend = order.id;
  resendButton.textContent = "Resend last email";
  actions.append(saveButton, resendButton);

  const message = document.createElement("span");
  message.className = "form-message";
  message.dataset.orderFormMessage = order.id;

  form.append(statusLabel, paymentLabel, noteLabel, shippedFields, cancelledFields, warning, sendEmailLabel, actions, message);

  const timeline = document.createElement("div");
  timeline.className = "order-timeline";
  timeline.innerHTML = `<strong>Istoric</strong>${renderOrderTimeline(order)}`;

  panel.append(form, timeline);
  syncOrderFieldVisibility(panel, order.status);
  return panel;
}

function syncOrderFieldVisibility(panel, status) {
  const visibility = orderFieldsVisibleFor(status);
  panel.querySelector("[data-fields-for='shipped']").hidden = !visibility.shipped;
  panel.querySelector("[data-fields-for='cancelled']").hidden = !visibility.cancelled;
}

function renderOrders(orders) {
  const list = document.querySelector("[data-orders]");
  if (!list) return;

  list.innerHTML = "";

  if (!orders.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty-state";
    empty.innerHTML = "<strong>No orders yet</strong><span>New checkout orders will appear here with customer details, products and status.</span>";
    list.appendChild(empty);
    return;
  }

  orders.forEach((order) => {
    const item = document.createElement("article");
    const summary = document.createElement("div");
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const customer = document.createElement("p");
    const products = document.createElement("small");
    const tracking = document.createElement("small");
    const controls = document.createElement("div");
    const total = document.createElement("strong");
    const statusBadge = document.createElement("span");
    const expandButton = document.createElement("button");

    item.className = "admin-product admin-order";
    item.dataset.orderCard = order.id;
    summary.className = "order-summary-row";

    meta.textContent = `${order.number || order.id} / ${new Date(order.createdAt).toLocaleString()}`;
    title.textContent = order.customerName;
    customer.textContent = `${order.customerEmail} / ${order.customerPhone} / ${order.customerAddress}`;
    products.textContent = (order.items || []).map((entry) => `${entry.qty}x ${entry.name}${entry.size ? ` (${entry.size})` : ""}`).join(", ");

    if (order.fulfillment?.courierName || order.fulfillment?.trackingNumber) {
      tracking.textContent = `${order.fulfillment.courierName || ""} ${order.fulfillment.trackingNumber || ""}`.trim();
    } else {
      tracking.hidden = true;
    }

    total.textContent = money(order);
    statusBadge.className = "order-status-badge";
    statusBadge.dataset.status = order.status;
    statusBadge.textContent = `${order.status} · ${order.paymentStatus || "unpaid"}`;

    expandButton.type = "button";
    expandButton.dataset.orderExpandToggle = order.id;
    expandButton.textContent = orderExpandedState.has(order.id) ? "Ascunde detalii" : "Detalii";

    info.append(meta, title, customer, products, tracking);
    controls.append(total, statusBadge, expandButton);
    summary.append(info, controls);

    const detailPanel = createOrderDetailPanel(order);

    item.append(summary, detailPanel);
    list.appendChild(item);
  });
}

let canManageUserRoles = false;

function renderUsers(users, options = {}) {
  canManageUserRoles = Boolean(options.canManageRoles);
  const list = document.querySelector("[data-users]");
  list.innerHTML = "";

  users.forEach((user) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const email = document.createElement("span");
    const role = document.createElement("em");
    const roleControls = document.createElement("div");

    name.textContent = user.name;
    email.textContent = user.email;

    if (canManageUserRoles && !user.isPrimaryAdmin) {
      const select = document.createElement("select");
      const save = document.createElement("button");

      select.dataset.userRole = user.id;
      save.dataset.saveRole = user.id;
      save.type = "button";
      save.textContent = "Save role";
      ["client", "admin"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === "client" ? "customer" : "admin";
        option.selected = user.role === value;
        select.appendChild(option);
      });

      roleControls.className = "admin-role-controls";
      roleControls.append(select, save);
    } else {
      role.textContent = user.role === "client" ? "customer" : user.role;
      roleControls.appendChild(role);
    }

    item.append(name, email, roleControls);
    list.appendChild(item);
  });
}

const CONTENT_SCHEMA = [
  { group: "Homepage — Hero", fields: [
    { key: "hero.kicker", label: "Kicker", bilingual: true },
    { key: "hero.title", label: "Titlu", bilingual: true, textarea: true },
    { key: "hero.body", label: "Text", bilingual: true, textarea: true },
    { key: "hero.primary", label: "Buton principal", bilingual: true },
    { key: "hero.secondary", label: "Buton secundar", bilingual: true }
  ] },
  { group: "Homepage — Calitate", fields: [
    { key: "quality.kicker", label: "Kicker", bilingual: true },
    { key: "quality.title", label: "Titlu", bilingual: true },
    { key: "quality.card1.title", label: "Card 1 - titlu", bilingual: true },
    { key: "quality.card1.body", label: "Card 1 - text", bilingual: true, textarea: true },
    { key: "quality.card2.title", label: "Card 2 - titlu", bilingual: true },
    { key: "quality.card2.body", label: "Card 2 - text", bilingual: true, textarea: true },
    { key: "quality.card3.title", label: "Card 3 - titlu", bilingual: true },
    { key: "quality.card3.body", label: "Card 3 - text", bilingual: true, textarea: true }
  ] },
  { group: "Homepage — Design", fields: [
    { key: "design.kicker", label: "Kicker", bilingual: true },
    { key: "design.title", label: "Titlu", bilingual: true },
    { key: "design.body", label: "Text", bilingual: true, textarea: true },
    { key: "design.note1.title", label: "Nota 1 - titlu", bilingual: true },
    { key: "design.note1.body", label: "Nota 1 - text", bilingual: true },
    { key: "design.note2.title", label: "Nota 2 - titlu", bilingual: true },
    { key: "design.note2.body", label: "Nota 2 - text", bilingual: true }
  ] },
  { group: "Homepage — Drop", fields: [
    { key: "drop.kicker", label: "Kicker", bilingual: true },
    { key: "drop.title", label: "Titlu", bilingual: true }
  ] },
  { group: "Homepage — Contact", fields: [
    { key: "contact.kicker", label: "Kicker", bilingual: true },
    { key: "contact.title", label: "Titlu", bilingual: true },
    { key: "contact.button", label: "Buton", bilingual: true }
  ] },
  { group: "Despre noi", fields: [
    { key: "about.hero.kicker", label: "Kicker" },
    { key: "about.hero.title", label: "Titlu" },
    { key: "about.hero.lede", label: "Introducere", textarea: true },
    { key: "about.s1.title", label: "Sectiune 1 - titlu" },
    { key: "about.s1.body1", label: "Sectiune 1 - paragraf 1", textarea: true },
    { key: "about.s1.body2", label: "Sectiune 1 - paragraf 2", textarea: true },
    { key: "about.s2.title", label: "Sectiune 2 - titlu" },
    { key: "about.card1.title", label: "Card 1 - titlu" },
    { key: "about.card1.body", label: "Card 1 - text", textarea: true },
    { key: "about.card2.title", label: "Card 2 - titlu" },
    { key: "about.card2.body", label: "Card 2 - text", textarea: true },
    { key: "about.card3.title", label: "Card 3 - titlu" },
    { key: "about.card3.body", label: "Card 3 - text", textarea: true },
    { key: "about.cta.title", label: "CTA - titlu" },
    { key: "about.cta.button", label: "CTA - buton" }
  ] },
  { group: "Intrebari frecvente", fields: [
    { key: "faq.hero.kicker", label: "Kicker" },
    { key: "faq.hero.title", label: "Titlu" },
    { key: "faq.hero.lede", label: "Introducere", textarea: true },
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
      { key: `faq.q${n}`, label: `Intrebare ${n}${n > 6 ? " (optional)" : ""}` },
      { key: `faq.a${n}`, label: `Raspuns ${n}`, textarea: true }
    ]),
    { key: "faq.cta.title", label: "CTA - titlu" },
    { key: "faq.cta.button", label: "CTA - buton" }
  ] },
  { group: "Suport", fields: [
    { key: "support.hero.kicker", label: "Kicker" },
    { key: "support.hero.title", label: "Titlu" },
    { key: "support.hero.lede", label: "Introducere", textarea: true },
    { key: "support.email", label: "Email" },
    { key: "support.hours", label: "Program" },
    { key: "support.responseTime", label: "Timp de raspuns" },
    { key: "support.before.title", label: "Sectiune - titlu" },
    { key: "support.before.body", label: "Sectiune - text", textarea: true },
    { key: "support.merchant.title", label: "Date comerciant - titlu" },
    { key: "support.merchant.body", label: "Date comerciant - text", textarea: true },
    { key: "support.cta.title", label: "CTA - titlu" },
    { key: "support.cta.button", label: "CTA - buton" }
  ] },
  { group: "Termeni si conditii", fields: [
    { key: "terms.hero.kicker", label: "Kicker" },
    { key: "terms.hero.title", label: "Titlu" },
    { key: "terms.hero.lede", label: "Introducere", textarea: true },
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
      { key: `terms.s${n}.title`, label: `Sectiune ${n} - titlu${n === 8 ? " (optional)" : ""}` },
      { key: `terms.s${n}.body`, label: `Sectiune ${n} - text`, textarea: true }
    ]),
    { key: "terms.cta.title", label: "CTA - titlu" },
    { key: "terms.cta.button", label: "CTA - buton" }
  ] },
  { group: "Confidentialitate", fields: [
    { key: "privacy.hero.kicker", label: "Kicker" },
    { key: "privacy.hero.title", label: "Titlu" },
    { key: "privacy.hero.lede", label: "Introducere", textarea: true },
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
      { key: `privacy.s${n}.title`, label: `Sectiune ${n} - titlu${n === 8 ? " (optional)" : ""}` },
      { key: `privacy.s${n}.body`, label: `Sectiune ${n} - text`, textarea: true }
    ]),
    { key: "privacy.cta.title", label: "CTA - titlu" },
    { key: "privacy.cta.button", label: "CTA - buton" }
  ] }
];

function contentFieldValue(content, lang, key) {
  return (content[lang] && content[lang][key]) || "";
}

// languagesState (active languages) replaces the old hardcoded ["en","ro"] -
// a "both" (non-bilingual) field's displayed value now comes from the
// store's DEFAULT language rather than a hardcoded "ro", consistent with
// every other default-language fallback in this codebase (email templates,
// product_translations backfill, etc).
function renderContentEditor(content) {
  const container = document.querySelector("[data-content-editor]");
  if (!container) return;
  container.innerHTML = "";

  const activeLanguages = languagesState.filter((language) => language.active);
  const defaultLang = languagesState.find((language) => language.isDefault)?.code || "en";

  CONTENT_SCHEMA.forEach((group) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group.group;
    fieldset.appendChild(legend);

    const grid = document.createElement("div");
    grid.className = "admin-form-grid";

    group.fields.forEach((field) => {
      if (field.bilingual) {
        activeLanguages.forEach((language) => {
          const label = document.createElement("label");
          label.textContent = `${field.label} (${language.code.toUpperCase()})`;
          const input = document.createElement(field.textarea ? "textarea" : "input");
          input.name = `${language.code}:${field.key}`;
          input.value = contentFieldValue(content, language.code, field.key);
          if (field.textarea) input.rows = 3;
          label.appendChild(input);
          grid.appendChild(label);
        });
      } else {
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = document.createElement(field.textarea ? "textarea" : "input");
        input.name = `both:${field.key}`;
        input.value = contentFieldValue(content, defaultLang, field.key);
        if (field.textarea) input.rows = 3;
        label.appendChild(input);
        grid.appendChild(label);
      }
    });

    fieldset.appendChild(grid);
    container.appendChild(fieldset);
  });
}

async function uploadBrandingImage(file, key) {
  const formData = new FormData();
  formData.append("image", file);
  const { url } = await requestJson("/api/admin/content/image", { method: "POST", body: formData });
  await requestJson("/api/admin/content", {
    method: "PUT",
    body: JSON.stringify({ branding: { [key]: url } })
  });
  return url;
}

let tagsState = [];
let allProductsState = [];
let currenciesState = [];
let countryConfigState = [];
let languagesState = [];
// Which language's email templates are currently shown/edited - "" until
// the first load resolves it to the server's default language (see
// renderEmailTemplates' select sync below).
let emailTemplateLanguageState = "";
let productTagFilter = "";
const bulkSelectedIds = new Set();
// Survives the full list rebuild on every loadDashboard() so saving one
// template's edits doesn't collapse it back shut.
let openEmailTemplateId = null;

async function loadDashboard() {
  const [
    summary, { products }, usersPayload, { orders }, { notifications },
    content, analytics, revenue, topProducts, traffic, { reviews },
    { zones }, { taxRates }, { coupons }, { tags }, { templates: emailTemplates, languageCode: emailTemplatesLanguageCode },
    { languages }, { currencies }, { countryConfigs }, { translations }, { categories }
  ] = await Promise.all([
    requestJson("/api/admin/summary"),
    requestJson("/api/admin/products"),
    requestJson("/api/admin/users"),
    requestJson("/api/admin/orders"),
    requestJson("/api/admin/notifications"),
    requestJson("/api/admin/content"),
    requestJson("/api/admin/analytics"),
    requestJson("/api/admin/stats/revenue"),
    requestJson("/api/admin/stats/products"),
    requestJson("/api/admin/stats/traffic"),
    requestJson("/api/admin/reviews"),
    requestJson("/api/admin/shipping-zones"),
    requestJson("/api/admin/tax-rates"),
    requestJson("/api/admin/coupons"),
    requestJson("/api/admin/tags"),
    requestJson(`/api/admin/email-templates${emailTemplateLanguageState ? `?lang=${encodeURIComponent(emailTemplateLanguageState)}` : ""}`),
    requestJson("/api/admin/languages"),
    requestJson("/api/admin/currencies"),
    requestJson("/api/admin/country-config"),
    requestJson("/api/admin/translations"),
    requestJson("/api/admin/categories")
  ]);
  tagsState = tags;
  allProductsState = products;
  currenciesState = currencies;
  countryConfigState = countryConfigs;
  languagesState = languages;
  // The server always echoes back which language it actually used (falls
  // back to the default when emailTemplateLanguageState was still "" or
  // named an inactive/unknown code) - keeps the select in sync with reality
  // rather than assuming the request param was honoured verbatim.
  emailTemplateLanguageState = emailTemplatesLanguageCode || emailTemplateLanguageState;

  // Genealogy is optional chrome, not an auth-gated resource. Keeping it
  // out of the critical Promise.all means an old server that lacks
  // /api/genealogy (e.g. static files pulled but the Node process not yet
  // restarted) can't reject the whole load and bounce an authenticated
  // admin back to /admin/login.html.
  try {
    genealogyState = await requestJson("/api/genealogy");
  } catch {
    genealogyState = { enabled: false, chapters: [], openChapter: null };
  }
  hydrateGenealogySelects();
  renderSummary(summary);
  renderTagsManager(tags);
  renderProducts(products);
  syncAddProductTagCheckboxes();
  renderPhotoProducts(products);
  renderUsers(usersPayload.users, {
    canManageRoles: usersPayload.canManageRoles
  });
  renderOrders(orders);
  renderNotifications(notifications);
  renderContentEditor(content);
  renderAnalytics(analytics);
  renderStats(revenue, topProducts, traffic);
  renderReviewsAdmin(reviews);
  renderCoupons(coupons);
  renderShippingZones(zones);
  renderTaxRates(taxRates);
  renderEmailTemplates(emailTemplates);
  syncEmailTemplateLanguageSelect(languages);
  renderLanguages(languages);
  renderCurrencies(currencies);
  renderCountryConfig(countryConfigs);
  syncCountryConfigSelects(languages, currencies);
  renderTranslations(translations);
  renderCategories(categories);
}

const productForm = document.querySelector("[data-product-form]");
const productMessage = document.querySelector("[data-product-message]");

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminTab));
});

document.querySelectorAll("[data-admin-tab-target]").forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminTabTarget));
});

document.addEventListener("click", async (event) => {
  const photoProduct = event.target.closest("[data-photo-product]");
  const downloadButton = event.target.closest("[data-photo-download]");
  const saveButton = event.target.closest("[data-photo-save]");
  const poseButton = event.target.closest("[data-photo-pose]");

  if (photoProduct) {
    photoState.selectedId = photoProduct.dataset.photoProduct;
    renderPhotoProducts(photoState.products);
  }

  if (poseButton) {
    photoState.pose = poseButton.dataset.photoPose || "custom";
    photoState.angle = Number(poseButton.dataset.angle || 180);
    syncPhotoControls();
  }

  if (downloadButton) {
    downloadButton.disabled = true;
    try {
      await downloadSceneImage();
    } finally {
      downloadButton.disabled = false;
    }
  }

  if (saveButton) {
    saveButton.disabled = true;
    try {
      await saveSceneImage();
    } catch (error) {
      const message = document.querySelector("[data-photo-message]");
      if (message) {
        message.dataset.type = "";
        message.textContent = error.message;
      }
    } finally {
      saveButton.disabled = false;
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-photo-x]")) photoState.x = Number(event.target.value || 0);
  if (event.target.matches("[data-photo-y]")) photoState.y = Number(event.target.value || 0);
  if (event.target.matches("[data-photo-size]")) photoState.size = Number(event.target.value || 58);
  if (event.target.matches("[data-photo-glow]")) photoState.glow = Number(event.target.value || 42);
  if (event.target.matches("[data-photo-x], [data-photo-y], [data-photo-size], [data-photo-glow]")) {
    syncPhotoControls();
  }
});

// Native FormData keeps every checked box as its own entry under the same
// "tagIds" name, but parseMultipart on the server only keeps the LAST
// value for a repeated field name - collapse to one comma-joined field
// (the same convention "sizes" already uses) before sending.
function consolidateTagCheckboxes(form, formData) {
  const checkedIds = Array.from(form.querySelectorAll("[data-tag-checkbox]:checked")).map((input) => input.dataset.tagCheckbox);
  formData.set("tagIds", checkedIds.join(","));
}

if (productForm) {
  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    productMessage.textContent = "Saving...";

    try {
      const formData = new FormData(productForm);
      consolidateTagCheckboxes(productForm, formData);
      await requestJson("/api/admin/products", {
        method: "POST",
        body: formData
      });
      productForm.reset();
      productMessage.textContent = "Saved.";
      await loadDashboard();
      setAdminView("products");
    } catch (error) {
      productMessage.textContent = error.message;
    }
  });
}

document.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (!deleteButton) return;

  // Deleting a product is irreversible and the button sits right next to the
  // edit form, so it asks first. If the browser has suppressed dialogs,
  // confirm() returns false and nothing is deleted - the safe direction.
  const name = deleteButton.dataset.deleteName;
  const confirmed = window.confirm(
    `Stergi definitiv ${name ? `"${name}"` : "acest produs"}?\n\nActiunea nu poate fi anulata.`
  );
  if (!confirmed) return;

  const originalLabel = deleteButton.textContent;
  deleteButton.disabled = true;
  deleteButton.textContent = "Se sterge...";

  try {
    await requestJson(`/api/admin/products/${deleteButton.dataset.delete}`, { method: "DELETE" });
    await loadDashboard();
  } catch (error) {
    // The row survives a failed delete, so put the button back rather than
    // leaving a dead control behind.
    deleteButton.disabled = false;
    deleteButton.textContent = originalLabel;
    window.alert(`Produsul nu a putut fi sters: ${error.message}`);
  }
});

document.addEventListener("click", async (event) => {
  const approveButton = event.target.closest("[data-review-approve]");
  const deleteReviewButton = event.target.closest("[data-review-delete]");

  if (approveButton) {
    await requestJson(`/api/admin/reviews/${approveButton.dataset.reviewApprove}`, {
      method: "PUT",
      body: JSON.stringify({ approved: approveButton.dataset.approved === "true" })
    });
    await loadDashboard();
  }

  if (deleteReviewButton) {
    await requestJson(`/api/admin/reviews/${deleteReviewButton.dataset.reviewDelete}`, { method: "DELETE" });
    await loadDashboard();
  }
});

document.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest("[data-coupon-toggle]");
  const deleteCouponButton = event.target.closest("[data-coupon-delete]");

  if (toggleButton) {
    await requestJson(`/api/admin/coupons/${toggleButton.dataset.couponToggle}`, {
      method: "PUT",
      body: JSON.stringify({ active: toggleButton.dataset.active === "true" })
    });
    await loadDashboard();
  }

  if (deleteCouponButton) {
    await requestJson(`/api/admin/coupons/${deleteCouponButton.dataset.couponDelete}`, { method: "DELETE" });
    await loadDashboard();
  }
});

document.querySelector("[data-coupon-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-coupon-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson("/api/admin/coupons", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Cupon adaugat.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const zoneToggle = event.target.closest("[data-shipping-zone-toggle]");
  const zoneDelete = event.target.closest("[data-shipping-zone-delete]");
  const methodToggle = event.target.closest("[data-shipping-method-toggle]");
  const methodDelete = event.target.closest("[data-shipping-method-delete]");
  const taxToggle = event.target.closest("[data-tax-rate-toggle]");
  const taxDelete = event.target.closest("[data-tax-rate-delete]");

  if (zoneToggle) {
    await requestJson(`/api/admin/shipping-zones/${zoneToggle.dataset.shippingZoneToggle}`, {
      method: "PUT",
      body: JSON.stringify({ active: zoneToggle.dataset.active === "true" })
    });
    await loadDashboard();
  }

  if (zoneDelete) {
    // Deleting a zone cascades to every method inside it, unlike a single
    // coupon/tax-rate row - worth an explicit confirm, same reasoning as
    // the irreversible product-delete button.
    const confirmed = window.confirm(
      `Stergi definitiv zona "${zoneDelete.dataset.deleteName || ""}" si toate metodele ei de livrare?\n\nActiunea nu poate fi anulata.`
    );
    if (!confirmed) return;
    await requestJson(`/api/admin/shipping-zones/${zoneDelete.dataset.shippingZoneDelete}`, { method: "DELETE" });
    await loadDashboard();
  }

  if (methodToggle) {
    await requestJson(`/api/admin/shipping-methods/${methodToggle.dataset.shippingMethodToggle}`, {
      method: "PUT",
      body: JSON.stringify({ active: methodToggle.dataset.active === "true" })
    });
    await loadDashboard();
  }

  if (methodDelete) {
    await requestJson(`/api/admin/shipping-methods/${methodDelete.dataset.shippingMethodDelete}`, { method: "DELETE" });
    await loadDashboard();
  }

  if (taxToggle) {
    await requestJson(`/api/admin/tax-rates/${taxToggle.dataset.taxRateToggle}`, {
      method: "PUT",
      body: JSON.stringify({ active: taxToggle.dataset.active === "true" })
    });
    await loadDashboard();
  }

  if (taxDelete) {
    await requestJson(`/api/admin/tax-rates/${taxDelete.dataset.taxRateDelete}`, { method: "DELETE" });
    await loadDashboard();
  }
});

document.addEventListener("click", async (event) => {
  const langDefault = event.target.closest("[data-language-set-default]");
  const langToggle = event.target.closest("[data-language-toggle]");
  const langDelete = event.target.closest("[data-language-delete]");
  const currDefault = event.target.closest("[data-currency-set-default]");
  const currToggle = event.target.closest("[data-currency-toggle]");
  const currDelete = event.target.closest("[data-currency-delete]");
  const configDelete = event.target.closest("[data-country-config-delete]");

  try {
    if (langDefault) {
      await requestJson(`/api/admin/languages/${langDefault.dataset.languageSetDefault}`, {
        method: "PUT", body: JSON.stringify({ isDefault: true })
      });
      await loadDashboard();
    }
    if (langToggle) {
      await requestJson(`/api/admin/languages/${langToggle.dataset.languageToggle}`, {
        method: "PUT", body: JSON.stringify({ active: langToggle.dataset.active === "true" })
      });
      await loadDashboard();
    }
    if (langDelete) {
      const confirmed = window.confirm(`Stergi definitiv limba "${langDelete.dataset.deleteName || ""}"?\n\nActiunea nu poate fi anulata.`);
      if (!confirmed) return;
      await requestJson(`/api/admin/languages/${langDelete.dataset.languageDelete}`, { method: "DELETE" });
      await loadDashboard();
    }
    if (currDefault) {
      await requestJson(`/api/admin/currencies/${currDefault.dataset.currencySetDefault}`, {
        method: "PUT", body: JSON.stringify({ isDefault: true })
      });
      await loadDashboard();
    }
    if (currToggle) {
      await requestJson(`/api/admin/currencies/${currToggle.dataset.currencyToggle}`, {
        method: "PUT", body: JSON.stringify({ active: currToggle.dataset.active === "true" })
      });
      await loadDashboard();
    }
    if (currDelete) {
      const confirmed = window.confirm(`Stergi definitiv moneda "${currDelete.dataset.deleteName || ""}"?\n\nActiunea nu poate fi anulata.`);
      if (!confirmed) return;
      await requestJson(`/api/admin/currencies/${currDelete.dataset.currencyDelete}`, { method: "DELETE" });
      await loadDashboard();
    }
    if (configDelete) {
      await requestJson(`/api/admin/country-config/${configDelete.dataset.countryConfigDelete}`, { method: "DELETE" });
      await loadDashboard();
    }
  } catch (error) {
    window.alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-product-prices]");
  if (!button) return;

  const productId = button.dataset.saveProductPrices;
  const container = document.querySelector(`[data-product-price-rows="${productId}"]`);
  const message = button.parentElement.querySelector("[data-product-prices-message]");
  const entries = collectCountryPriceEntries(container, countryConfigState, { withCompareAt: true });

  button.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson(`/api/admin/products/${productId}/prices`, {
      method: "PUT",
      body: JSON.stringify({ prices: entries })
    });
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-product-translations]");
  if (!button) return;

  const productId = button.dataset.saveProductTranslations;
  const container = document.querySelector(`[data-product-translation-blocks="${productId}"]`);
  const message = button.parentElement.querySelector("[data-product-translations-message]");
  const entries = collectProductTranslationEntries(container);

  button.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson(`/api/admin/products/${productId}/translations`, {
      method: "PUT",
      body: JSON.stringify({ translations: entries })
    });
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-shipping-method-prices]");
  if (!button) return;

  const methodId = button.dataset.saveShippingMethodPrices;
  const container = document.querySelector(`[data-shipping-method-price-rows="${methodId}"]`);
  const message = button.parentElement.querySelector("[data-shipping-method-prices-message]");
  const entries = collectCountryPriceEntries(container, countryConfigState, { withFreeShippingThreshold: true });

  button.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson(`/api/admin/shipping-methods/${methodId}/prices`, {
      method: "PUT",
      body: JSON.stringify({ prices: entries })
    });
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("[data-language-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-language-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    const code = String(fields.code || "").trim().toLowerCase();
    await requestJson(`/api/admin/languages/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: JSON.stringify({ name: fields.name, nativeName: fields.nativeName })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Limba adaugata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("[data-currency-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-currency-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    const code = String(fields.code || "").trim().toUpperCase();
    await requestJson(`/api/admin/currencies/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: JSON.stringify({
        symbol: fields.symbol,
        decimalPlaces: fields.decimalPlaces,
        symbolPosition: fields.symbolPosition,
        displayRateFromDefault: fields.displayRateFromDefault === "" ? null : fields.displayRateFromDefault
      })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Moneda adaugata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("[data-country-config-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-country-config-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    const countryCode = String(fields.countryCode || "").trim().toUpperCase();
    await requestJson(`/api/admin/country-config/${encodeURIComponent(countryCode)}`, {
      method: "PUT",
      body: JSON.stringify({ languageCode: fields.languageCode, currencyCode: fields.currencyCode })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Mapare salvata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("[data-translation-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-translation-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    await requestJson("/api/admin/translations", {
      method: "POST",
      body: JSON.stringify({ key: fields.key, languageCode: fields.languageCode, value: fields.value })
    });
    form.querySelector('[name="key"]').value = "";
    form.querySelector('[name="value"]').value = "";
    message.dataset.type = "success";
    message.textContent = "Traducere salvata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-translation-delete]");
  if (!button) return;
  try {
    await requestJson(`/api/admin/translations/${encodeURIComponent(button.dataset.translationDelete)}/${encodeURIComponent(button.dataset.translationKey)}`, {
      method: "DELETE"
    });
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-category-form]");
  if (!form) return;
  event.preventDefault();

  const categoryId = form.dataset.categoryForm;
  const message = form.querySelector("[data-category-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    const translations = languagesState
      .filter((language) => language.active)
      .map((language) => ({ languageCode: language.code, name: fields[`translation-${language.code}`] || "" }));
    await requestJson(`/api/admin/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify({ defaultName: fields.defaultName, translations })
    });
    message.dataset.type = "success";
    message.textContent = "Salvat.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-category-delete]");
  if (!button) return;
  const confirmed = window.confirm(`Stergi definitiv categoria "${button.dataset.deleteName || ""}"?\n\nProdusele care o foloseau raman neschimbate, doar traducerea categoriei se pierde.`);
  if (!confirmed) return;
  try {
    await requestJson(`/api/admin/categories/${button.dataset.categoryDelete}`, { method: "DELETE" });
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
  }
});

document.querySelector("[data-shipping-zone-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-shipping-zone-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    await requestJson("/api/admin/shipping-zones", {
      method: "POST",
      body: JSON.stringify({
        name: fields.name,
        countries: String(fields.countries || "").split(",").map((code) => code.trim()).filter(Boolean)
      })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Zona adaugata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

// Delegated (not queried once at load) because a method-add form is
// rendered fresh inside every shipping zone card on each loadDashboard()
// call - a form queried up front would go stale the moment the list re-renders.
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-shipping-method-form]");
  if (!form) return;
  event.preventDefault();

  const message = form.querySelector("[data-shipping-method-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    await requestJson("/api/admin/shipping-methods", {
      method: "POST",
      body: JSON.stringify({
        zoneId: form.dataset.zoneId,
        name: fields.name,
        price: fields.price,
        freeShippingThreshold: fields.freeShippingThreshold || null,
        estimatedDeliveryText: fields.estimatedDeliveryText || ""
      })
    });
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});

document.querySelector("[data-tax-rate-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-tax-rate-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    await requestJson("/api/admin/tax-rates", {
      method: "POST",
      body: JSON.stringify({
        name: fields.name,
        country: fields.country,
        region: fields.region || "",
        rate: fields.rate,
        inclusive: form.elements.inclusive.checked,
        priority: fields.priority || 0
      })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Cota adaugata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

// Remembers which <details> card was open so a save (which reloads the
// whole dashboard) doesn't visually slam every template shut again.
document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLElement) || !details.matches("[data-email-template]")) return;
  openEmailTemplateId = details.open ? details.dataset.emailTemplate : null;
}, true);

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-email-template-form]");
  if (!form) return;
  event.preventDefault();

  const id = form.dataset.emailTemplateForm;
  const message = form.querySelector("[data-email-template-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson(`/api/admin/email-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        subject: form.elements.subject.value,
        body: form.elements.body.value,
        active: form.elements.active.checked,
        languageCode: emailTemplateLanguageState
      })
    });
    openEmailTemplateId = id;
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-email-preview]");
  if (!button) return;

  const form = button.closest("form");
  const previewBox = button.closest("[data-email-template]").querySelector("[data-email-preview-box]");
  const message = form.querySelector("[data-email-template-message]");
  button.disabled = true;

  try {
    const result = await requestJson(`/api/admin/email-templates/${button.dataset.emailPreview}/preview`, {
      method: "POST",
      body: JSON.stringify({ subject: form.elements.subject.value, body: form.elements.body.value })
    });
    previewBox.querySelector("[data-email-preview-subject]").textContent = result.subject;
    previewBox.querySelector("[data-email-preview-text]").textContent = result.text;
    previewBox.hidden = false;
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-email-test-send]");
  if (!button) return;

  const form = button.closest("form");
  const message = form.querySelector("[data-email-template-message]");
  button.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se trimite...";

  try {
    await requestJson(`/api/admin/email-templates/${button.dataset.emailTestSend}/test-send`, {
      method: "POST",
      body: JSON.stringify({ subject: form.elements.subject.value, body: form.elements.body.value })
    });
    message.dataset.type = "success";
    message.textContent = "Email de test trimis catre adresa contului tau de admin.";
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// A variable chip is a formatting tool, not a navigation target - keeping
// the subject/body field focused (instead of losing focus to the chip
// button on mousedown) is what makes selectionStart/selectionEnd below
// still point at the field's real cursor position.
document.addEventListener("mousedown", (event) => {
  if (event.target.closest("[data-insert-variable]")) {
    event.preventDefault();
  }
});

document.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-insert-variable]");
  if (!chip) return;

  const form = chip.closest("form");
  const focused = document.activeElement;
  const target = (focused && form.contains(focused) && (focused.name === "subject" || focused.name === "body"))
    ? focused
    : form.elements.body;

  const insertion = `{{${chip.dataset.insertVariable}}}`;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.value = target.value.slice(0, start) + insertion + target.value.slice(end);
  target.focus();
  target.selectionStart = target.selectionEnd = start + insertion.length;
});

document.querySelector("[data-tag-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector("[data-tag-message]");
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = "Se salveaza...";

  try {
    await requestJson("/api/admin/tags", {
      method: "POST",
      body: JSON.stringify({ name: form.elements.name.value })
    });
    form.reset();
    message.dataset.type = "success";
    message.textContent = "Eticheta adaugata.";
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-tag-filter]")) return;
  productTagFilter = event.target.value;
  renderProducts(allProductsState);
});

document.addEventListener("change", async (event) => {
  if (!event.target.matches("[data-email-template-language-select]")) return;
  emailTemplateLanguageState = event.target.value;
  openEmailTemplateId = null;
  await loadDashboard();
});

document.addEventListener("click", async (event) => {
  const renameButton = event.target.closest("[data-tag-rename]");
  const deleteButton = event.target.closest("[data-tag-delete]");

  if (renameButton) {
    const currentTag = tagsState.find((tag) => tag.id === renameButton.dataset.tagRename);
    const nextName = window.prompt("Numele noii etichete:", currentTag?.name || "");
    if (!nextName || nextName === currentTag?.name) return;

    try {
      await requestJson(`/api/admin/tags/${renameButton.dataset.tagRename}`, {
        method: "PUT",
        body: JSON.stringify({ name: nextName })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(`Eticheta nu a putut fi redenumita: ${error.message}`);
    }
  }

  if (deleteButton) {
    // Deleting a tag detaches it from every product that had it - worth an
    // explicit confirm, same reasoning as the shipping-zone delete.
    const confirmed = window.confirm(
      `Stergi definitiv eticheta "${deleteButton.dataset.deleteName || ""}"?\n\nVa fi eliminata de pe toate produsele care o folosesc.`
    );
    if (!confirmed) return;

    try {
      await requestJson(`/api/admin/tags/${deleteButton.dataset.tagDelete}`, { method: "DELETE" });
      await loadDashboard();
    } catch (error) {
      window.alert(`Eticheta nu a putut fi stearsa: ${error.message}`);
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-bulk-select-all]")) {
    const checked = event.target.checked;
    document.querySelectorAll("[data-bulk-product-select]").forEach((cb) => {
      cb.checked = checked;
      if (checked) bulkSelectedIds.add(cb.dataset.bulkProductSelect);
      else bulkSelectedIds.delete(cb.dataset.bulkProductSelect);
    });
    syncBulkToolbar();
  }

  if (event.target.matches("[data-bulk-product-select]")) {
    if (event.target.checked) bulkSelectedIds.add(event.target.dataset.bulkProductSelect);
    else bulkSelectedIds.delete(event.target.dataset.bulkProductSelect);
    syncBulkToolbar();
  }

  if (event.target.matches("[data-bulk-action]")) {
    const action = event.target.value;
    const categoryInput = document.querySelector("[data-bulk-category-value]");
    const tagSelect = document.querySelector("[data-bulk-tag-value]");
    if (categoryInput) categoryInput.hidden = action !== "setCategory";
    if (tagSelect) tagSelect.hidden = action !== "addTags" && action !== "removeTags";
    syncBulkToolbar();
  }
});

document.querySelector("[data-bulk-apply]")?.addEventListener("click", async () => {
  const toolbar = document.querySelector("[data-bulk-actions]");
  const action = toolbar.querySelector("[data-bulk-action]").value;
  const message = toolbar.querySelector("[data-bulk-message]");
  const applyButton = toolbar.querySelector("[data-bulk-apply]");
  const ids = Array.from(bulkSelectedIds);

  if (!ids.length || !action) return;

  const actionLabel = toolbar.querySelector("[data-bulk-action]").selectedOptions[0]?.textContent || action;
  if (action === "delete") {
    const confirmed = window.confirm(
      `Stergi definitiv ${ids.length} produs(e)?\n\nProdusele care au fost deja comandate nu pot fi sterse (istoricul comenzilor ramane intact) si vor fi omise automat.\n\nActiunea nu poate fi anulata.`
    );
    if (!confirmed) return;
  }

  const body = { ids, action };
  if (action === "setCategory") {
    body.category = toolbar.querySelector("[data-bulk-category-value]").value;
  }
  if (action === "addTags" || action === "removeTags") {
    const tagSelect = toolbar.querySelector("[data-bulk-tag-value]");
    if (!tagSelect.value) {
      message.dataset.type = "";
      message.textContent = "Alege o eticheta.";
      return;
    }
    body.tagIds = [tagSelect.value];
  }

  applyButton.disabled = true;
  message.dataset.type = "info";
  message.textContent = `Se aplica "${actionLabel}"...`;

  try {
    const result = await requestJson("/api/admin/products/bulk", {
      method: "POST",
      body: JSON.stringify(body)
    });
    bulkSelectedIds.clear();
    message.dataset.type = "success";
    message.textContent = result.skipped.length
      ? `Aplicat pe ${result.applied} produse. ${result.skipped.length} omise (nu exista sau nu pot fi modificate - de ex. produse deja comandate).`
      : `Aplicat pe ${result.applied} produse.`;
    await loadDashboard();
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    applyButton.disabled = bulkSelectedIds.size === 0;
  }
});

document.addEventListener("click", async (event) => {
  const roleButton = event.target.closest("[data-save-role]");
  if (!roleButton) return;

  const select = document.querySelector(`[data-user-role="${roleButton.dataset.saveRole}"]`);
  if (!select) return;

  roleButton.disabled = true;
  roleButton.textContent = "Saving...";

  try {
    await requestJson(`/api/admin/users/${roleButton.dataset.saveRole}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: select.value })
    });
    await loadDashboard();
  } catch (error) {
    roleButton.textContent = error.message;
    window.setTimeout(() => {
      roleButton.disabled = false;
      roleButton.textContent = "Save role";
    }, 1800);
  }
});

document.addEventListener("submit", async (event) => {
  const editForm = event.target.closest("[data-edit-product]");
  if (!editForm) return;

  event.preventDefault();
  const submitButton = editForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  try {
    const formData = new FormData(editForm);
    // An unchecked checkbox is simply absent from FormData, not sent as
    // false - without this, unchecking "Featured" and saving would leave
    // the field untouched server-side instead of actually clearing it.
    formData.set("featured", editForm.elements.featured.checked ? "on" : "");
    consolidateTagCheckboxes(editForm, formData);
    await requestJson(`/api/admin/products/${editForm.dataset.editProduct}`, {
      method: "PUT",
      body: formData
    });
    await loadDashboard();
  } catch (error) {
    submitButton.textContent = error.message;
    window.setTimeout(() => {
      submitButton.disabled = false;
      submitButton.textContent = "Save changes";
    }, 1600);
  }
});

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-order-expand-toggle]");
  if (!toggle) return;

  const orderId = toggle.dataset.orderExpandToggle;
  const card = toggle.closest("[data-order-card]");
  const panel = card?.querySelector(".order-detail-panel");
  if (!panel) return;

  const isOpen = orderExpandedState.has(orderId);
  if (isOpen) {
    orderExpandedState.delete(orderId);
    panel.hidden = true;
    toggle.textContent = "Detalii";
  } else {
    orderExpandedState.add(orderId);
    panel.hidden = false;
    toggle.textContent = "Ascunde detalii";
  }
});

document.addEventListener("change", (event) => {
  const select = event.target.closest("[data-order-status-select]");
  if (!select) return;

  const orderId = select.dataset.orderStatusSelect;
  const panel = select.closest(".order-detail-panel");
  if (!panel) return;

  syncOrderFieldVisibility(panel, select.value);

  const card = document.querySelector(`[data-order-card="${orderId}"]`);
  const currentStatus = card?.querySelector(".order-status-badge")?.dataset.status;
  const warning = panel.querySelector(`[data-order-skip-warning="${orderId}"]`);
  if (warning && currentStatus) {
    const message = computeSkipWarning(currentStatus, select.value);
    warning.textContent = message;
    warning.hidden = !message;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-order-status-form]");
  if (!form) return;

  event.preventDefault();
  const orderId = form.dataset.orderStatusForm;
  const message = form.querySelector(`[data-order-form-message="${orderId}"]`);
  const saveButton = form.querySelector("button[type='submit']");
  saveButton.disabled = true;
  if (message) {
    message.dataset.type = "info";
    message.textContent = "Se salveaza...";
  }

  const formData = new FormData(form);
  const payload = {
    status: formData.get("status"),
    customerNote: formData.get("customerNote") || "",
    sendEmail: formData.get("sendEmail") === "on"
  };
  if (formData.has("paymentStatus")) payload.paymentStatus = formData.get("paymentStatus");
  if (formData.has("courierName")) payload.courierName = formData.get("courierName");
  if (formData.has("trackingNumber")) payload.trackingNumber = formData.get("trackingNumber");
  if (formData.has("trackingUrl")) payload.trackingUrl = formData.get("trackingUrl");
  if (formData.has("estimatedDeliveryDate")) payload.estimatedDeliveryDate = formData.get("estimatedDeliveryDate");
  if (formData.has("internalNote")) payload.internalNote = formData.get("internalNote");
  if (formData.has("cancellationReason")) payload.cancellationReason = formData.get("cancellationReason");

  try {
    const result = await requestJson(`/api/admin/orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    orderExpandedState.add(orderId);
    if (message) {
      message.dataset.type = "success";
      message.textContent = result.emailSent ? "Salvat. Email trimis." : "Salvat.";
    }
    await loadDashboard();
  } catch (error) {
    if (message) {
      message.dataset.type = "";
      message.textContent = error.message;
    }
  } finally {
    saveButton.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const resendButton = event.target.closest("[data-order-resend]");
  if (!resendButton) return;

  const orderId = resendButton.dataset.orderResend;
  const form = resendButton.closest("form");
  const message = form?.querySelector(`[data-order-form-message="${orderId}"]`);
  resendButton.disabled = true;
  if (message) {
    message.dataset.type = "info";
    message.textContent = "Se retrimite emailul...";
  }

  try {
    const result = await requestJson(`/api/admin/orders/${orderId}/resend-email`, { method: "POST" });
    orderExpandedState.add(orderId);
    if (message) {
      message.dataset.type = result.ok ? "success" : "";
      message.textContent = result.ok ? "Email retrimis." : `Retrimiterea a esuat (${result.reason || "eroare"}).`;
    }
    await loadDashboard();
  } catch (error) {
    if (message) {
      message.dataset.type = "";
      message.textContent = error.message;
    }
  } finally {
    resendButton.disabled = false;
  }
});

document.querySelector("[data-content-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const message = form.querySelector("[data-content-message]");
  submitButton.disabled = true;
  submitButton.textContent = "Se salveaza...";

  const activeCodes = languagesState.filter((language) => language.active).map((language) => language.code);
  const payload = {};
  activeCodes.forEach((code) => { payload[code] = {}; });
  form.querySelectorAll("[data-content-editor] input, [data-content-editor] textarea").forEach((field) => {
    const [scope, key] = field.name.split(":");
    if (!scope || !key) return;
    if (scope === "both") {
      activeCodes.forEach((code) => { payload[code][key] = field.value; });
    } else {
      payload[scope] = payload[scope] || {};
      payload[scope][key] = field.value;
    }
  });

  try {
    await requestJson("/api/admin/content", { method: "PUT", body: JSON.stringify(payload) });
    message.dataset.type = "success";
    message.textContent = "Salvat.";
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Salveaza continutul";
  }
});

document.querySelectorAll("[data-branding-upload]").forEach((input) => {
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const key = input.dataset.brandingUpload;
    const message = document.querySelector("[data-content-message]");
    try {
      const url = await uploadBrandingImage(file, key);
      const preview = document.querySelector(`[data-branding-preview="${key}"]`);
      if (preview) preview.src = url;
      if (message) {
        message.dataset.type = "success";
        message.textContent = "Imagine actualizata.";
      }
    } catch (error) {
      if (message) {
        message.dataset.type = "";
        message.textContent = error.message;
      }
    }
  });
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    await requestJson("/auth/logout", {
      method: "POST",
      body: "{}"
    });
    window.location.href = "/";
  });
});

document.querySelectorAll("[data-email-test]").forEach((button) => {
  button.addEventListener("click", async () => {
    const message = button.parentElement.querySelector("[data-email-test-message]");
    button.disabled = true;
    if (message) {
      message.dataset.type = "";
      message.textContent = "Se trimite...";
    }

    try {
      const result = await requestJson("/api/admin/email/test", { method: "POST" });
      if (!message) return;
      if (!result.configured) {
        message.textContent = "SMTP nu este configurat (lipsesc variabilele de mediu).";
      } else if (result.ok) {
        message.dataset.type = "success";
        message.textContent = "Email trimis. Verifica inbox-ul.";
      } else {
        message.textContent = `Trimiterea a esuat (${result.reason}). Verifica data/email-outbox.json.`;
      }
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
});

loadDashboard().catch(() => {
  window.location.href = "/admin/login.html";
});

window.addEventListener("beca:admin-refresh", () => {
  loadDashboard().catch(() => {});
});

window.addEventListener("beca:photo-studio-ready", syncPhotoControls);
