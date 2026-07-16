/* Inline content editor (shared by every brand)
   ------------------------------------------------------------------
   Loads on every page. For ALL visitors it applies saved content
   overrides (text + images) for the current page. For a logged-in
   admin it adds a floating pencil that toggles an in-page edit mode:
   click any text to rewrite it, click any image to replace it, then
   Save. Overrides persist in content.json under branding keys prefixed
   per page, reusing the existing /api/content + /api/admin/content
   endpoints with no server change.

   Lives at the repo root so both brands share one copy: BeCa serves it
   directly, and Aether's publicDir lookup falls back to root. Each
   brand's own --accent drives the toolbar colour. */
(() => {
  "use strict";

  const PAGE = location.pathname.replace(/\/index\.html$/, "/") || "/";
  // Overrides live in content.branding under a per-page prefix, so we reuse
  // the existing /api/admin/content endpoint with no server change. Each
  // element is one branding key: "oed::<page>::<selector>".
  const PREFIX = "oed::" + PAGE + "::";
  const TEXT_TAGS = new Set([
    "H1", "H2", "H3", "H4", "H5", "H6", "P", "SPAN", "A", "LI", "SMALL",
    "STRONG", "EM", "B", "I", "BLOCKQUOTE", "FIGCAPTION", "LABEL", "TD",
    "TH", "DD", "DT", "SUMMARY", "BUTTON", "CAPTION", "Q"
  ]);
  const BLOCK_TAGS = new Set([
    "H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "SECTION",
    "ARTICLE", "HEADER", "FOOTER", "MAIN", "UL", "OL", "TABLE", "FORM",
    "FIGURE", "NAV"
  ]);

  const changes = new Map();      // key -> { t: "text"|"img", v }
  let editing = false;

  /* ---------- stable element key (a real CSS selector) ---------- */
  function cssPath(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el.tagName !== "BODY" && el.tagName !== "HTML") {
      let seg = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === el.tagName);
        if (sameTag.length > 1) seg += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
      }
      parts.unshift(seg);
      el = el.parentElement;
    }
    return "body>" + parts.join(">");
  }

  function resolve(key) {
    try { return document.querySelector(key); } catch (_) { return null; }
  }

  /* ---------- apply saved overrides (runs for everyone) ---------- */
  function applyOverrides(branding) {
    if (!branding) return;
    Object.keys(branding).forEach((fullKey) => {
      if (fullKey.indexOf(PREFIX) !== 0) return;
      const rec = branding[fullKey];
      const el = resolve(fullKey.slice(PREFIX.length));
      if (!el || !rec) return;
      if (rec.t === "img") {
        if (el.tagName === "IMG") el.src = rec.v;
      } else {
        el.innerHTML = rec.v;
      }
    });
  }

  /* ---------- editability tests ---------- */
  function isEditableText(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!TEXT_TAGS.has(el.tagName)) return false;
    if (el.closest("[data-oed-ui]")) return false;
    if (el.closest("model-viewer, script, style, svg")) return false;
    if (!el.textContent || !el.textContent.trim()) return false;
    // Skip containers that hold their own block-level children - edit the
    // leaf instead so keys stay tight and edits don't swallow siblings.
    for (const child of el.children) {
      if (BLOCK_TAGS.has(child.tagName)) return false;
    }
    return true;
  }

  function isEditableImg(el) {
    return el && el.tagName === "IMG" &&
      !el.closest("[data-oed-ui]") &&
      !el.closest("model-viewer");
  }

  /* ---------- edit mode ---------- */
  let fileInput;
  let pending = null;   // { kind: "img" | "product", el, card, id }

  /* A product card's shot is catalog data, not page copy. Storing it as a
     selector-keyed page override would break the moment the cards reorder,
     and it would never reach the product's own page or the admin. Route it
     to the product instead. The card carries data-product-id; fall back to
     its buttons for cards rendered before that existed. */
  function productCardTarget(node) {
    const media = node.closest(".product-card .product-media");
    if (!media) return null;
    const card = media.closest(".product-card");
    const id = card.dataset.productId
      || card.querySelector("[data-add-to-cart]")?.dataset.addToCart
      || card.querySelector("[data-notify-product]")?.dataset.notifyProduct;
    return id ? { kind: "product", el: media, card, id } : null;
  }

  function onDocClick(event) {
    if (!editing) return;
    if (event.target.closest("[data-oed-ui]")) return;

    const product = productCardTarget(event.target);
    if (product) {
      event.preventDefault();
      event.stopPropagation();
      pending = product;
      fileInput.click();
      return;
    }

    const img = event.target.closest("img");
    if (isEditableImg(img)) {
      event.preventDefault();
      event.stopPropagation();
      pending = { kind: "img", el: img };
      fileInput.click();
      return;
    }

    const text = event.target.closest(Array.from(TEXT_TAGS).join(","));
    if (isEditableText(text)) {
      event.preventDefault();
      event.stopPropagation();
      startTextEdit(text);
    }
  }

  function startTextEdit(el) {
    if (el.isContentEditable) return;
    const original = el.innerHTML;
    el.setAttribute("contenteditable", "true");
    el.classList.add("oed-active");
    el.focus();
    const finish = () => {
      el.removeAttribute("contenteditable");
      el.classList.remove("oed-active");
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      if (el.innerHTML !== original) {
        changes.set(cssPath(el), { t: "text", v: el.innerHTML });
        markDirty();
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") { el.innerHTML = original; el.blur(); }
      if (e.key === "Enter" && !e.shiftKey && el.tagName !== "P" && el.tagName !== "LI") {
        e.preventDefault(); el.blur();
      }
    };
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Nu am putut citi fisierul."));
      reader.readAsDataURL(file);
    });
  }

  async function onFilePicked() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file || !pending) return;
    const target = pending;
    pending = null;
    target.el.classList.add("oed-uploading");
    try {
      if (target.kind === "product") {
        // Writes straight to the catalog, so unlike a page override this one
        // saves on the spot rather than waiting for the Save button.
        const res = await fetch(`/api/admin/products/${encodeURIComponent(target.id)}/scene-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: await readAsDataUrl(file) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Salvare esuata.");
        const url = data.product && data.product.imageUrl;
        const img = target.card.querySelector(".product-media img");
        if (img && url) img.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
        // On desktop the card keeps the rotating model, so a silent success
        // there reads as nothing happening - say where the shot landed.
        toast(img ? "Poza produsului salvata ✓" : "Salvat ✓ — apare pe mobil si pe pagina produsului");
      } else {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/admin/content/image", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || "Upload esuat.");
        target.el.src = data.url;
        changes.set(cssPath(target.el), { t: "img", v: data.url });
        markDirty();
      }
    } catch (err) {
      toast(err.message || "Upload esuat.", true);
    } finally {
      target.el.classList.remove("oed-uploading");
    }
  }

  /* ---------- toolbar UI ---------- */
  let bar, saveBtn, statusEl;

  function markDirty() {
    if (saveBtn) {
      saveBtn.disabled = changes.size === 0;
      saveBtn.textContent = changes.size ? `Salvează (${changes.size})` : "Salvează";
    }
  }

  function toast(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.error = isError ? "1" : "";
    if (msg) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ""; }, 3200);
  }

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle("oed-editing", on);
    bar.dataset.editing = on ? "1" : "";
    if (!on) {
      document.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    }
  }

  async function save() {
    if (!changes.size) return;
    saveBtn.disabled = true;
    toast("Se salvează…");
    const branding = {};
    changes.forEach((rec, key) => { branding[PREFIX + key] = rec; });
    try {
      const res = await fetch("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branding })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Salvare esuata.");
      changes.clear();
      markDirty();
      toast("Salvat ✓");
    } catch (err) {
      toast(err.message || "Salvare esuata.", true);
      markDirty();
    }
  }

  function buildToolbar() {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
    fileInput.style.display = "none";
    fileInput.setAttribute("data-oed-ui", "");
    fileInput.addEventListener("change", onFilePicked);
    document.body.appendChild(fileInput);

    bar = document.createElement("div");
    bar.className = "oed-bar";
    bar.setAttribute("data-oed-ui", "");
    bar.innerHTML = `
      <button type="button" class="oed-toggle" title="Mod editare">
        <span class="oed-pencil">✎</span><span class="oed-label">Editează</span>
      </button>
      <button type="button" class="oed-eye" title="Statistici pagina" aria-expanded="false">👁</button>
      <div class="oed-tools">
        <span class="oed-hint">Apasă pe orice text sau imagine</span>
        <span class="oed-status" data-oed-status></span>
        <button type="button" class="oed-save" disabled>Salvează</button>
        <button type="button" class="oed-done">Gata</button>
      </div>
      <div class="oed-stats" data-oed-stats hidden></div>`;
    document.body.appendChild(bar);

    saveBtn = bar.querySelector(".oed-save");
    statusEl = bar.querySelector("[data-oed-status]");
    bar.querySelector(".oed-toggle").addEventListener("click", () => setEditing(!editing));
    bar.querySelector(".oed-done").addEventListener("click", () => setEditing(false));
    bar.querySelector(".oed-eye").addEventListener("click", toggleStats);
    saveBtn.addEventListener("click", save);
    document.addEventListener("click", onDocClick, true);
  }

  /* ---------- page stats ---------- */
  function renderStats(panel, d) {
    const peak = Math.max(1, d.peak || 0);
    const bars = d.last14Days.map((day) => {
      const h = Math.round((day.views / peak) * 100);
      return `<i style="height:${Math.max(h, 3)}%" title="${day.date}: ${day.views}"></i>`;
    }).join("");
    const share = d.siteTotal14 ? Math.round((d.total14 / d.siteTotal14) * 100) : 0;
    const rank = d.rank ? `Locul ${d.rank} din ${d.pagesTracked} pagini` : "Fără vizite încă";
    panel.innerHTML = `
      <div class="oed-stats-head">Statistici pagină</div>
      <div class="oed-stats-path">${d.path}</div>
      <div class="oed-stats-row">
        <div class="oed-stat"><b>${d.today}</b><span>azi</span></div>
        <div class="oed-stat"><b>${d.total14}</b><span>14 zile</span></div>
        <div class="oed-stat"><b>${share}%</b><span>din trafic</span></div>
      </div>
      <div class="oed-spark">${bars}</div>
      <div class="oed-stats-foot">${rank} · ultimele 14 zile</div>`;
  }

  async function toggleStats() {
    const panel = bar.querySelector("[data-oed-stats]");
    const eye = bar.querySelector(".oed-eye");
    if (!panel.hidden) {
      panel.hidden = true;
      bar.dataset.stats = "";
      eye.setAttribute("aria-expanded", "false");
      return;
    }
    panel.hidden = false;
    bar.dataset.stats = "1";
    eye.setAttribute("aria-expanded", "true");
    panel.innerHTML = `<div class="oed-stats-foot">Se încarcă…</div>`;
    try {
      // location.pathname, not PAGE: views are recorded under the exact path
      // requested, so "/" and "/index.html" are separate rows.
      const res = await fetch("/api/admin/analytics/page?path=" + encodeURIComponent(location.pathname));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nu am putut citi statisticile.");
      renderStats(panel, data);
    } catch (err) {
      panel.innerHTML = `<div class="oed-stats-foot">${err.message || "Eroare."}</div>`;
    }
  }

  function injectStyles() {
    const css = `
      /* Bottom-left: the brands park .floating-shop-actions (cart + EN/RO)
         in the bottom-right corner on every page, so the pencil sits
         opposite it rather than on top of it. */
      .oed-bar{position:fixed;left:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:10px;
        font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;}
      .oed-eye{font-size:15px;line-height:1;padding:11px 13px;}
      .oed-bar[data-stats="1"] .oed-eye{background:var(--accent,#b9a7ee);color:#14101f;border-color:transparent;}
      .oed-stats{position:absolute;left:0;bottom:56px;width:270px;padding:14px;border-radius:16px;
        border:1px solid rgba(255,255,255,.16);background:rgba(12,10,20,.95);color:#f4efe4;
        box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(14px);}
      .oed-stats[hidden]{display:none;}
      .oed-stats-head{font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.55;}
      .oed-stats-path{margin:2px 0 12px;font-size:12px;font-weight:700;color:var(--accent,#b9a7ee);word-break:break-all;}
      .oed-stats-row{display:flex;gap:14px;margin-bottom:10px;}
      .oed-stat b{display:block;font-size:19px;font-weight:800;line-height:1.15;}
      .oed-stat span{font-size:10px;opacity:.55;text-transform:uppercase;letter-spacing:.06em;}
      .oed-spark{display:flex;align-items:flex-end;gap:2px;height:36px;margin-bottom:8px;}
      .oed-spark i{flex:1;min-height:2px;border-radius:2px 2px 0 0;background:var(--accent,#b9a7ee);opacity:.7;}
      .oed-spark i:last-child{opacity:1;}
      .oed-stats-foot{font-size:10.5px;opacity:.55;line-height:1.4;}
      .oed-bar button{cursor:pointer;border-radius:999px;border:1px solid rgba(255,255,255,.22);color:#f4efe4;
        background:linear-gradient(145deg,rgba(255,255,255,.16),rgba(255,255,255,.04)),rgba(12,10,20,.86);
        padding:11px 16px;font:inherit;font-weight:700;letter-spacing:.02em;
        box-shadow:0 14px 40px rgba(0,0,0,.45);backdrop-filter:blur(14px);}
      .oed-bar button:disabled{opacity:.45;cursor:default;}
      .oed-toggle{display:inline-flex;align-items:center;gap:8px;}
      .oed-pencil{font-size:16px;}
      .oed-tools{display:none;align-items:center;gap:10px;padding:6px 6px 6px 14px;border-radius:999px;
        border:1px solid rgba(255,255,255,.14);background:rgba(12,10,20,.86);backdrop-filter:blur(14px);
        box-shadow:0 14px 40px rgba(0,0,0,.45);}
      .oed-bar[data-editing="1"] .oed-tools{display:flex;}
      .oed-bar[data-editing="1"] .oed-toggle{background:var(--accent,#b9a7ee);color:#14101f;border-color:transparent;}
      .oed-hint{opacity:.7;}
      .oed-status{min-width:60px;color:#a9f0c4;font-weight:600;}
      .oed-status[data-error="1"]{color:#ff9a9a;}
      .oed-save{background:var(--accent,#b9a7ee)!important;color:#14101f!important;border-color:transparent!important;}
      body.oed-editing [data-oed-editable-hover]{outline:1px dashed var(--accent,#b9a7ee);outline-offset:3px;cursor:pointer;}
      body.oed-editing img:not([data-oed-ui] img):hover{outline:2px solid var(--accent,#b9a7ee);outline-offset:3px;cursor:pointer;}
      /* The card shows a rotating model on desktop, so there is no <img> to
         hint at - outline the media box itself. */
      body.oed-editing .product-card .product-media{position:relative;}
      body.oed-editing .product-card .product-media:hover{outline:2px solid var(--accent,#b9a7ee);outline-offset:3px;cursor:pointer;}
      body.oed-editing .product-card .product-media:hover::after{content:"Schimba poza";position:absolute;left:50%;bottom:10px;transform:translateX(-50%);
        padding:5px 11px;border-radius:999px;background:rgba(12,10,20,.88);color:#fff;font-size:12px;font-weight:700;pointer-events:none;white-space:nowrap;}
      .oed-active{outline:2px solid var(--accent,#b9a7ee)!important;outline-offset:3px;background:color-mix(in srgb,var(--accent,#b9a7ee) 10%,transparent);border-radius:4px;}
      .oed-uploading{opacity:.45;filter:grayscale(.4);}
    `;
    const style = document.createElement("style");
    style.setAttribute("data-oed-ui", "");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Hover outline for editable text (added lazily so we don't tag the
  // whole DOM up front).
  function onHover(event) {
    if (!editing) return;
    document.querySelectorAll("[data-oed-editable-hover]").forEach((el) => el.removeAttribute("data-oed-editable-hover"));
    const t = event.target.closest(Array.from(TEXT_TAGS).join(","));
    if (isEditableText(t) && !t.isContentEditable) t.setAttribute("data-oed-editable-hover", "");
  }

  /* ---------- boot ---------- */
  async function boot() {
    // 1) apply saved overrides for everyone
    try {
      const res = await fetch("/api/content", { headers: { "Accept": "application/json" } });
      if (res.ok) {
        const content = await res.json();
        applyOverrides(content && content.branding);
      }
    } catch (_) { /* non-fatal */ }

    // 2) admin-only editor
    try {
      const res = await fetch("/api/me", { headers: { "Accept": "application/json" } });
      const data = await res.json();
      if (!data || !data.user || data.user.role !== "admin") return;
    } catch (_) { return; }

    injectStyles();
    buildToolbar();
    document.addEventListener("mouseover", onHover, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
