(function () {
  var video = document.querySelector("[data-aether-hero-video]");
  if (!video) return;

  // Site-wide fixed background (not scoped to the hero), so the
  // ready/blocked state classes live on <body>.
  var stateTarget = document.body;

  var LOOP_START = 6;
  var END_THRESHOLD = 9.95;
  var hasPlayedIntro = false;

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

  if (prefersReducedMotion) {
    // Respect reduced motion: no autoplay, no looping. Land on a single
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

    return;
  }

  function handleTimeUpdate() {
    if (!isFinite(video.currentTime)) return;

    if (video.currentTime >= END_THRESHOLD) {
      hasPlayedIntro = true;
      video.currentTime = LOOP_START;
    }
  }

  video.addEventListener("timeupdate", handleTimeUpdate);

  video.addEventListener("playing", markReady, { once: true });

  function attemptPlay() {
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        // Autoplay blocked by the browser: hide the video entirely (CSS
        // falls back to the cinematic gradient, never a stuck black frame)
        // and offer a single elegant retry on the first user interaction
        // anywhere on the page.
        markBlocked();

        var retry = function () {
          video.play().then(function () {
            stateTarget.classList.remove("is-video-blocked");
            markReady();
          }).catch(function () {
            /* still blocked - keep the gradient fallback, no further retry */
          });
          document.removeEventListener("click", retry);
          document.removeEventListener("touchstart", retry);
        };

        document.addEventListener("click", retry, { once: true, passive: true });
        document.addEventListener("touchstart", retry, { once: true, passive: true });
      });
    }
  }

  if (video.readyState >= 1) {
    attemptPlay();
  } else {
    video.addEventListener("loadedmetadata", attemptPlay, { once: true });
  }

  video.addEventListener("error", markBlocked);
})();
