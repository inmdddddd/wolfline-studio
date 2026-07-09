(function () {
  var video = document.querySelector("[data-aether-hero-video]");
  if (!video) return;

  // Site-wide fixed background (not scoped to the hero), so the
  // ready/blocked state classes live on <body>.
  var stateTarget = document.body;
  var revealTargets = document.querySelectorAll(".aether-intro-reveal");

  var UI_REVEAL_AT = 4;
  var showUI = false;
  var rafId = null;

  var prefersReducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  function markReady() {
    stateTarget.classList.remove("is-video-blocked");
    stateTarget.classList.add("is-video-ready");
  }

  function markBlocked() {
    stateTarget.classList.remove("is-video-ready");
    stateTarget.classList.add("is-video-blocked");
  }

  // Reveals the navbar/hero card/title/body/buttons with the fade + rise +
  // blur-clear transition. Idempotent and permanent once triggered - never
  // hides the UI again, whatever the video does afterwards.
  function revealUI() {
    if (showUI) return;
    showUI = true;
    revealTargets.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  if (prefersReducedMotion) {
    // Respect reduced motion: no autoplay, no looping, and don't make
    // critical navigation (nav, login, cart) sit invisible for several
    // seconds - show the UI immediately. Land the video on a single
    // representative frame instead of an all-black first frame.
    var settleOnFrame = function () {
      video.currentTime = Math.min(2, video.duration ? video.duration / 2 : 2);
      video.pause();
      markReady();
    };

    if (video.readyState >= 1) {
      settleOnFrame();
    } else {
      video.addEventListener("loadedmetadata", settleOnFrame, { once: true });
    }

    revealUI();
    return;
  }

  // Looping is left entirely to the browser (video.loop = true) - the
  // footage itself is authored to play through and reverse back to its
  // start, so no currentTime jump-cut is needed here anymore.
  video.loop = true;

  // requestAnimationFrame-driven watcher just for the one-time UI reveal
  // cue (steadier than "timeupdate", which fires irregularly). Stops
  // itself once the UI has been revealed - nothing left to watch for.
  function watchReveal() {
    if (!video.paused && !video.ended && video.currentTime >= UI_REVEAL_AT) {
      revealUI();
      return;
    }
    rafId = requestAnimationFrame(watchReveal);
  }

  function startRevealWatcher() {
    if (rafId === null) {
      rafId = requestAnimationFrame(watchReveal);
    }
  }

  function attemptPlay() {
    video.currentTime = 0;
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise
        .then(startRevealWatcher)
        .catch(function () {
          // Autoplay blocked by the browser: hide the video entirely (CSS
          // falls back to the cinematic gradient, never a stuck black
          // frame) and offer a single elegant retry on the first user
          // interaction anywhere on the page. Also reveal the UI right
          // away - the whole page would otherwise be stuck with an
          // invisible navbar/cart/login forever, since currentTime never
          // advances on a video that never started.
          markBlocked();
          revealUI();

          var retry = function () {
            video.currentTime = 0;
            video.play().then(function () {
              markReady();
              startRevealWatcher();
            }).catch(function () {
              /* still blocked - keep the gradient fallback, no further retry */
            });
            document.removeEventListener("click", retry);
            document.removeEventListener("touchstart", retry);
          };

          document.addEventListener("click", retry, { once: true, passive: true });
          document.addEventListener("touchstart", retry, { once: true, passive: true });
        });
    } else {
      startRevealWatcher();
    }
  }

  video.addEventListener("playing", markReady, { once: true });

  if (video.readyState >= 1) {
    attemptPlay();
  } else {
    video.addEventListener("loadedmetadata", attemptPlay, { once: true });
  }

  video.addEventListener("error", function () {
    markBlocked();
    revealUI();
  });

  // Absolute safety net: whatever else happens (a stalled network, a video
  // element that silently never fires an event this script expected), the
  // UI must not stay hidden forever.
  window.setTimeout(revealUI, 16000);
})();
