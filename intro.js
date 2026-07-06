const becaIntro = document.querySelector("#becaIntro");

if (becaIntro) {
  const logo = becaIntro.querySelector(".intro-beca-logo");
  const minDisplayTime = 2400;
  const maxWaitTime = 6000;

  const logoReady = new Promise((resolve) => {
    if (!logo || (logo.complete && logo.naturalWidth > 0)) {
      resolve();
      return;
    }
    logo.addEventListener("load", resolve, { once: true });
    logo.addEventListener("error", resolve, { once: true });
  });

  const minTimeElapsed = new Promise((resolve) => window.setTimeout(resolve, minDisplayTime));
  const safetyTimeout = new Promise((resolve) => window.setTimeout(resolve, maxWaitTime));

  Promise.race([Promise.all([logoReady, minTimeElapsed]), safetyTimeout]).then(() => {
    becaIntro.classList.add("is-exiting");
    window.dispatchEvent(new CustomEvent("beca:intro-exiting"));

    window.setTimeout(() => {
      becaIntro.classList.add("is-done");
    }, 840);

    window.setTimeout(() => {
      becaIntro.remove();
    }, 1740);
  });
} else {
  window.dispatchEvent(new CustomEvent("beca:intro-exiting"));
}
