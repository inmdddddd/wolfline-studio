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

function renderSummary(summary) {
  document.querySelector("[data-summary-users]").textContent = summary.users;
  document.querySelector("[data-summary-products]").textContent = summary.products;
  document.querySelector("[data-summary-live]").textContent = summary.liveProducts;
  document.querySelector("[data-summary-orders]").textContent = summary.orders;
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
    if (product.imageUrl) {
      const image = document.createElement("img");
      image.src = adminImageSrc(product.imageUrl);
      image.alt = product.name;
      media.appendChild(image);
    } else {
      media.textContent = product.category || "Drop";
    }

    meta.textContent = product.category || "Drop";
    title.textContent = product.name;
    description.textContent = product.description || "No description yet.";
    price.textContent = money(product);
    stock.textContent = `${product.stock} stock / ${product.status}${product.sizes?.length ? ` / ${product.sizes.join(", ")}` : ""}`;
    deleteButton.type = "button";
    deleteButton.dataset.delete = product.id;
    deleteButton.textContent = "Delete";
    saveButton.type = "submit";
    saveButton.textContent = "Save changes";

    form.className = "admin-edit-form";
    form.dataset.editProduct = product.id;
    form.append(
      createField("Name", "name", product.name, true),
      createField("Category", "category", product.category || ""),
      createField("Price", "price", product.price, false, "number", "0.01"),
      createField("Currency", "currency", product.currency || "GBP"),
      createField("Stock", "stock", product.stock, false, "number", "1"),
      createField("Image URL", "imageUrl", product.imageUrl || ""),
      createField("Sizes", "sizes", Array.isArray(product.sizes) ? product.sizes.join(", ") : ""),
      createField("Color", "color", product.color || ""),
      createStatusField(product.status),
      createFileField(),
      createTextarea("Description", "description", product.description || ""),
      saveButton
    );

    info.append(media, meta, title, description, form);
    controls.append(price, stock, deleteButton);
    item.append(info, controls);
    list.appendChild(item);
  });
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
  ["draft", "live", "sold-out"].forEach((status) => {
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
    const info = document.createElement("div");
    const meta = document.createElement("span");
    const title = document.createElement("h3");
    const customer = document.createElement("p");
    const products = document.createElement("small");
    const controls = document.createElement("div");
    const total = document.createElement("strong");
    const status = document.createElement("select");

    item.className = "admin-product admin-order";
    meta.textContent = `${order.number || order.id} / ${new Date(order.createdAt).toLocaleString()}`;
    title.textContent = order.customerName;
    customer.textContent = `${order.customerEmail} / ${order.customerPhone} / ${order.customerAddress}`;
    products.textContent = (order.items || []).map((entry) => `${entry.qty}x ${entry.name}`).join(", ");
    total.textContent = money(order);

    ["pending", "processing", "shipped", "completed", "cancelled"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = order.status === value;
      status.appendChild(option);
    });
    status.dataset.orderStatus = order.id;

    info.append(meta, title, customer, products);
    controls.append(total, status);
    item.append(info, controls);
    list.appendChild(item);
  });
}

function renderUsers(users) {
  const list = document.querySelector("[data-users]");
  list.innerHTML = "";

  users.forEach((user) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const email = document.createElement("span");
    const role = document.createElement("em");

    name.textContent = user.name;
    email.textContent = user.email;
    role.textContent = user.role;
    item.append(name, email, role);
    list.appendChild(item);
  });
}

async function loadDashboard() {
  const [summary, { products }, { users }, { orders }] = await Promise.all([
    requestJson("/api/admin/summary"),
    requestJson("/api/admin/products"),
    requestJson("/api/admin/users"),
    requestJson("/api/admin/orders")
  ]);

  renderSummary(summary);
  renderProducts(products);
  renderUsers(users);
  renderOrders(orders);
}

const productForm = document.querySelector("[data-product-form]");
const productMessage = document.querySelector("[data-product-message]");

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminTab));
});

document.querySelectorAll("[data-admin-tab-target]").forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminTabTarget));
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

document.addEventListener("change", async (event) => {
  const status = event.target.closest("[data-order-status]");
  if (!status) return;

  await requestJson(`/api/admin/orders/${status.dataset.orderStatus}`, {
    method: "PUT",
    body: JSON.stringify({ status: status.value })
  });
  await loadDashboard();
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

loadDashboard().catch(() => {
  window.location.href = "/admin/login.html";
});

window.addEventListener("beca:admin-refresh", () => {
  loadDashboard().catch(() => {});
});
