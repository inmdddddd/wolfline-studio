async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function putJson(url, data) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function getFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function getDisplayRole(role) {
  return role === "client" ? "customer" : role;
}

function setMessage(target, text, type = "error") {
  if (!target) return;
  target.textContent = text;
  target.dataset.type = type;
}

document.querySelectorAll("[data-auth-form]").forEach((form) => {
  const message = form.querySelector("[data-form-message]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    setMessage(message, "Se verifica...", "info");

    try {
      const payload = await postJson(form.action, getFormData(form));
      setMessage(message, "Gata, intri imediat.", "success");
      window.location.href = payload.redirect || "/";
    } catch (error) {
      setMessage(message, error.message);
    } finally {
      submit.disabled = false;
    }
  });
});

function hydrateHeader(user) {
  document.body.classList.toggle("is-authenticated", Boolean(user));

  document.querySelectorAll("[data-guest-only]").forEach((element) => {
    element.hidden = Boolean(user);
  });

  document.querySelectorAll("[data-user-only]").forEach((element) => {
    element.hidden = !user;
  });

  if (!user) return;

  if (typeof closeHeroAuth === "function") {
    closeHeroAuth();
  }

  if (location.hash === "#login" || location.hash === "#register") {
    history.replaceState(null, "", location.pathname + location.search);
  }

  document.querySelectorAll("[data-user-name]").forEach((element) => {
    element.textContent = user.name;
  });
  document.querySelectorAll("[data-user-email]").forEach((element) => {
    element.textContent = user.email;
  });
  document.querySelectorAll("[data-user-initial]").forEach((element) => {
    element.textContent = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
  });
}

async function hydrateSession() {
  const response = await fetch("/api/me");
  const { user } = await response.json();
  hydrateHeader(user);
  return user;
}

async function hydrateAccount() {
  const slot = document.querySelector("[data-account]");
  if (!slot) return;

  const response = await fetch("/api/me");
  const { user } = await response.json();

  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  slot.querySelectorAll("[data-account-name]").forEach((element) => {
    element.textContent = user.name;
  });
  slot.querySelectorAll("[data-account-email]").forEach((element) => {
    element.textContent = user.email;
  });
  slot.querySelectorAll("[data-account-role]").forEach((element) => {
    element.textContent = getDisplayRole(user.role);
  });

  slot.querySelectorAll("[data-profile-name]").forEach((element) => {
    element.value = user.name;
  });
  slot.querySelectorAll("[data-profile-email]").forEach((element) => {
    element.value = user.email;
  });
}

function positionProfileDropdown() {
  const trigger = document.querySelector("[data-profile-toggle]");
  const dropdown = document.querySelector("[data-profile-dropdown]");
  if (!trigger || !dropdown) return;

  const rect = trigger.getBoundingClientRect();
  const gap = 12;
  const dropdownWidth = 252;
  const center = rect.left + rect.width / 2;
  const left = Math.min(
    window.innerWidth - dropdownWidth - 12,
    Math.max(12, center - dropdownWidth / 2)
  );
  const top = Math.min(window.innerHeight - 20, rect.bottom + gap);

  document.documentElement.style.setProperty("--profile-menu-left", `${left}px`);
  document.documentElement.style.setProperty("--profile-menu-top", `${top}px`);
}

function closeProfileDropdown() {
  const menu = document.querySelector("[data-user-only]");
  const dropdown = document.querySelector("[data-profile-dropdown]");
  menu?.classList.remove("is-open");
  dropdown?.classList.remove("is-open");
  document.querySelector("[data-profile-toggle]")?.setAttribute("aria-expanded", "false");
}

function setupProfileDropdown() {
  const dropdown = document.querySelector("[data-profile-dropdown]");
  if (!dropdown || dropdown.parentElement === document.body) return;
  document.body.appendChild(dropdown);
}

document.querySelector("[data-profile-toggle]")?.addEventListener("click", () => {
  const menu = document.querySelector("[data-user-only]");
  const trigger = document.querySelector("[data-profile-toggle]");
  const dropdown = document.querySelector("[data-profile-dropdown]");
  setupProfileDropdown();
  positionProfileDropdown();
  const isOpen = menu?.classList.toggle("is-open");
  dropdown?.classList.toggle("is-open", Boolean(isOpen));
  trigger?.setAttribute("aria-expanded", String(Boolean(isOpen)));
});

window.addEventListener("resize", positionProfileDropdown);
window.addEventListener("scroll", closeProfileDropdown, { passive: true });

document.addEventListener("click", (event) => {
  const menu = document.querySelector("[data-user-only]");
  const dropdown = document.querySelector("[data-profile-dropdown]");
  if (!menu || menu.hidden || menu.contains(event.target) || dropdown?.contains(event.target)) return;
  closeProfileDropdown();
});

document.querySelectorAll("[data-settings-form]").forEach((form) => {
  const message = form.querySelector("[data-form-message]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    setMessage(message, "Se salveaza...", "info");

    try {
      const payload = await putJson(form.action, getFormData(form));
      if (payload.user) {
        hydrateHeader(payload.user);
        await hydrateAccount();
      }
      setMessage(message, "Salvat.", "success");
      form.querySelectorAll("input[type='password']").forEach((input) => {
        input.value = "";
      });
    } catch (error) {
      setMessage(message, error.message);
    } finally {
      submit.disabled = false;
    }
  });
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    await postJson("/auth/logout", {});
    window.location.href = "/";
  });
});

hydrateAccount();
hydrateSession();
