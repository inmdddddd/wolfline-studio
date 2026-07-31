/* Client-side security hygiene (shared by every brand, loaded on all pages).
   ------------------------------------------------------------------
   1. Hardens external links: any target="_blank" anchor gets
      rel="noopener noreferrer" so the destination page cannot reach back
      into this window (reverse tabnabbing) and no referrer is leaked.
   2. Strips one-time order access tokens from the address bar after the
      page scripts have read them, so the token does not linger in browser
      history or get leaked via a copied/shared URL. */
(() => {
  "use strict";

  function hardenLink(link) {
    const rel = (link.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
    if (rel.includes("noopener") && rel.includes("noreferrer")) return;
    if (!rel.includes("noopener")) rel.push("noopener");
    if (!rel.includes("noreferrer")) rel.push("noreferrer");
    link.setAttribute("rel", rel.join(" "));
  }

  function hardenExternalLinks(root) {
    if (root.nodeType === 1 && root.matches('a[target="_blank"]')) hardenLink(root);
    root.querySelectorAll('a[target="_blank"]').forEach(hardenLink);
  }

  function stripAccessTokenFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("token")) return;
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
    } catch (_) {
      /* non-fatal */
    }
  }

  function boot() {
    hardenExternalLinks(document);
    // Page scripts (thank-you.js / invoice.js) read the token synchronously
    // at parse time; this runs afterwards, so removal is safe.
    stripAccessTokenFromUrl();

    // Only walk what actually changed. Rescanning the whole document on every
    // mutation meant the admin dashboard's render bursts re-swept every link
    // on the page hundreds of times for no benefit.
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) hardenExternalLinks(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();