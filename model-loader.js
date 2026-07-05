const viewer = document.querySelector("#tshirtViewer");
const scene = document.querySelector("#shirtScene");
const progressText = document.querySelector("#modelProgress");
const ring = document.querySelector(".loader-ring");

if (viewer && scene && progressText && ring) {
  let minimumLoadingDone = false;
  let modelLoaded = false;

  function revealWhenReady() {
    if (!minimumLoadingDone || !modelLoaded) return;

    requestAnimationFrame(() => {
      scene.dataset.ready = "true";
    });
  }

  window.setTimeout(() => {
    minimumLoadingDone = true;
    revealWhenReady();
  }, 900);

  viewer.addEventListener("progress", (event) => {
    const rawProgress = Math.round((event.detail.totalProgress || 0) * 100);
    const progress = Math.min(99, rawProgress);
    progressText.textContent = `${progress}%`;
    ring.style.setProperty("--progress", `${progress}%`);
  });

  viewer.addEventListener("load", () => {
    progressText.textContent = "100%";
    ring.style.setProperty("--progress", "100%");
    modelLoaded = true;
    revealWhenReady();
  });
}
