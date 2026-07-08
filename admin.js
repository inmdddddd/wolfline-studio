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
  return `${product.currency || "GBP"} ${Number(product.price || product.total || 0).toFixed(2)}`;
}

function adminImageSrc(src = "") {
  if (!src) return "";
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  return `/${src}`;
}

function productImageSrc(product) {
  return product.imageUrl || "";
}

function renderSummary(summary) {
  document.querySelector("[data-summary-users]").textContent = summary.users;
  document.querySelector("[data-summary-products]").textContent = summary.products;
  document.querySelector("[data-summary-live]").textContent = summary.liveProducts;
  document.querySelector("[data-summary-preview]").textContent = summary.previewProducts || 0;
  document.querySelector("[data-summary-notifications]").textContent = summary.notifications || 0;
  document.querySelector("[data-summary-orders]").textContent = summary.orders;
  document.querySelector("[data-summary-pageviews]").textContent = summary.pageviewsToday || 0;
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

  document.querySelector("[data-stats-revenue]").textContent = revenue.totalRevenue;
  document.querySelector("[data-stats-aov]").textContent = revenue.averageOrderValue;
  document.querySelector("[data-stats-orders]").textContent = revenue.totalOrders;
  document.querySelector("[data-stats-conversion]").textContent = `${revenue.conversionRate}%`;

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
    usage.textContent = `Folosit ${coupon.usedCount || 0}${coupon.maxUses ? ` / ${coupon.maxUses}` : ""}${coupon.expiresAt ? ` / expira ${new Date(coupon.expiresAt).toLocaleDateString()}` : ""}`;

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

function renderProducts(products) {
  const list = document.querySelector("[data-products]");
  list.innerHTML = "";

  products.forEach((product) => {
    const item = document.createElement("article");
    const info = document.createElement("div");
    const media = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const controls = document.createElement("div");
    const price = document.createElement("strong");
    const stock = document.createElement("small");
    const form = document.createElement("form");
    const deleteButton = document.createElement("button");
    const saveButton = document.createElement("button");

    item.className = "admin-product";
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
    price.textContent = money(product);
    const sizeBreakdown = product.sizeStock
      ? (product.sizes || []).map((size) => `${size}:${product.sizeStock[size] ?? 0}`).join(", ")
      : "";
    stock.textContent = `${product.stock} stock / ${product.status}${sizeBreakdown ? ` / ${sizeBreakdown}` : (product.sizes?.length ? ` / ${product.sizes.join(", ")}` : "")}`;
    deleteButton.type = "button";
    deleteButton.dataset.delete = product.id;
    deleteButton.textContent = "Delete";
    saveButton.type = "submit";
    saveButton.textContent = "Save changes";

    form.className = "admin-edit-form";
    form.dataset.editProduct = product.id;
    form.append(
      createField("Name", "name", product.name, true),
      createField("Name RO", "nameRo", product.nameRo || ""),
      createField("Category", "category", product.category || ""),
      createField("Price", "price", product.price, false, "number", "0.01"),
      createField("Currency", "currency", product.currency || "GBP"),
      createField("Stock", "stock", product.stock, false, "number", "1"),
      createField("Image URL", "imageUrl", product.imageUrl || ""),
      createField("Sizes (e.g. S:5, M:8, L:6, XL:2)", "sizes", sizeBreakdown || (Array.isArray(product.sizes) ? product.sizes.join(", ") : "")),
      createField("Color", "color", product.color || ""),
      createStatusField(product.status),
      createFileField(),
      createTextarea("Description EN", "description", product.description || ""),
      createTextarea("Description RO", "descriptionRo", product.descriptionRo || ""),
      saveButton
    );

    info.append(media, meta, title, description, form);
    controls.append(price, stock, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
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
  ["draft", "preview", "live", "sold-out"].forEach((status) => {
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
  ORDER_STATUSES.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = order.status === value;
    statusSelect.appendChild(option);
  });
  statusLabel.textContent = "New status";
  statusLabel.appendChild(statusSelect);

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

  form.append(statusLabel, noteLabel, shippedFields, cancelledFields, warning, sendEmailLabel, actions, message);

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
    statusBadge.textContent = order.status;

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
  const primaryAdminEmail = options.primaryAdminEmail || "admin@beca.local";
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

    if (canManageUserRoles && user.email !== primaryAdminEmail) {
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

function renderContentEditor(content) {
  const container = document.querySelector("[data-content-editor]");
  if (!container) return;
  container.innerHTML = "";

  CONTENT_SCHEMA.forEach((group) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group.group;
    fieldset.appendChild(legend);

    const grid = document.createElement("div");
    grid.className = "admin-form-grid";

    group.fields.forEach((field) => {
      if (field.bilingual) {
        ["en", "ro"].forEach((lang) => {
          const label = document.createElement("label");
          label.textContent = `${field.label} (${lang.toUpperCase()})`;
          const input = document.createElement(field.textarea ? "textarea" : "input");
          input.name = `${lang}:${field.key}`;
          input.value = contentFieldValue(content, lang, field.key);
          if (field.textarea) input.rows = 3;
          label.appendChild(input);
          grid.appendChild(label);
        });
      } else {
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = document.createElement(field.textarea ? "textarea" : "input");
        input.name = `both:${field.key}`;
        input.value = contentFieldValue(content, "ro", field.key);
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

async function loadDashboard() {
  const [
    summary, { products }, usersPayload, { orders }, { notifications },
    content, analytics, revenue, topProducts, traffic, { reviews }, { coupons }
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
    requestJson("/api/admin/coupons")
  ]);

  renderSummary(summary);
  renderProducts(products);
  renderPhotoProducts(products);
  renderUsers(usersPayload.users, {
    canManageRoles: usersPayload.canManageRoles,
    primaryAdminEmail: usersPayload.primaryAdminEmail
  });
  renderOrders(orders);
  renderNotifications(notifications);
  renderContentEditor(content);
  renderAnalytics(analytics);
  renderStats(revenue, topProducts, traffic);
  renderReviewsAdmin(reviews);
  renderCoupons(coupons);
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

if (productForm) {
  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    productMessage.textContent = "Saving...";

    try {
      const formData = new FormData(productForm);
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

  await requestJson(`/api/admin/products/${deleteButton.dataset.delete}`, { method: "DELETE" });
  await loadDashboard();
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
    await requestJson(`/api/admin/products/${editForm.dataset.editProduct}`, {
      method: "PUT",
      body: new FormData(editForm)
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

  const payload = { en: {}, ro: {} };
  form.querySelectorAll("[data-content-editor] input, [data-content-editor] textarea").forEach((field) => {
    const [scope, key] = field.name.split(":");
    if (!scope || !key) return;
    if (scope === "both") {
      payload.en[key] = field.value;
      payload.ro[key] = field.value;
    } else {
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
