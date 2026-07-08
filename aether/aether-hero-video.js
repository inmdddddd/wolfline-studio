(function () {
  var video = document.querySelector("[data-aether-hero-video]");
  if (!video) return;

  // Site-wide fixed background (not scoped to the hero), so the
  // ready/blocked state classes live on <body>.
  var stateTarget = document.body;
  var revealTargets = document.querySelectorAll(".aether-intro-reveal");

  var LOOP_START = 6;
  var LOOP_END = 10;
  var hasPlayedIntro = false;
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
    // critical navigation (nav, login, cart) sit invisible for 6 seconds -
    // show the UI immediately. Land the video on a single representative
    // frame instead of an all-black first frame.
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

  // requestAnimationFrame-driven loop watcher (steadier than relying only on
  // the browser's "timeupdate" event, which fires irregularly and can show
  // a visible jump/stutter right at the loop point). First pass plays the
  // full 0-10s intro untouched, revealing the UI the moment it crosses the
  // 6s mark; once it reaches the end, hasPlayedIntro flips and every
  // subsequent pass is clamped to the 6-10s window (which never dips back
  // below 6s, so the UI - already shown - simply stays visible).
  function controlLoop() {
    if (!video.paused && !video.ended) {
      if (!showUI && video.currentTime >= LOOP_START) {
        revealUI();
      }

      if (!hasPlayedIntro) {
        if (video.currentTime >= LOOP_END) {
          hasPlayedIntro = true;
          video.currentTime = LOOP_START;
        }
      } else if (video.currentTime >= LOOP_END) {
        video.currentTime = LOOP_START;
      }
    }

    rafId = requestAnimationFrame(controlLoop);
  }

  function startLoopWatcher() {
    if (rafId === null) {
      rafId = requestAnimationFrame(controlLoop);
    }
  }

  function attemptPlay() {
    video.currentTime = 0;
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise
        .then(startLoopWatcher)
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
              startLoopWatcher();
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
      startLoopWatcher();
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
  // UI must not stay hidden forever. Comfortably past the full 10s intro
  // (plus loading time) so it never fires before the real 6s cue on a
  // healthy connection - this is a last resort, not a normal-path trigger.
  window.setTimeout(revealUI, 16000);
})();
