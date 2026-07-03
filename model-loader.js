const viewer = document.querySelector("#tshirtViewer");
const scene = document.querySelector("#shirtScene");
const dragLayer = document.querySelector("#shirtDragLayer");
const progressText = document.querySelector("#modelProgress");
const ring = document.querySelector(".loader-ring");

if (viewer && scene && progressText && ring) {
  let minimumLoadingDone = false;
  let modelLoaded = false;
  let orbitAngle = 0;
  let dragStartX = 0;
  let dragStartOrbit = 0;
  let isDragging = false;
  let isMouseDragging = false;

  function setOrbit(angle) {
    orbitAngle = Math.max(-58, Math.min(58, angle));
    viewer.setAttribute("camera-orbit", `${orbitAngle.toFixed(1)}deg 82deg 1.35m`);
  }

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

  if (dragLayer) {
    dragLayer.addEventListener("pointerdown", (event) => {
      isDragging = true;
      dragStartX = event.clientX;
      dragStartOrbit = orbitAngle;
      dragLayer.setPointerCapture(event.pointerId);
      dragLayer.classList.add("is-dragging");
      viewer.removeAttribute("auto-rotate");
    });

    dragLayer.addEventListener("pointermove", (event) => {
      if (!isDragging) return;
      const delta = event.clientX - dragStartX;
      setOrbit(dragStartOrbit + delta * 0.18);
    }, { passive: true });

    function stopDrag(event) {
      if (!isDragging) return;
      isDragging = false;
      dragLayer.classList.remove("is-dragging");
      if (dragLayer.hasPointerCapture(event.pointerId)) {
        dragLayer.releasePointerCapture(event.pointerId);
      }
      window.setTimeout(() => viewer.setAttribute("auto-rotate", ""), 900);
    }

    dragLayer.addEventListener("pointerup", stopDrag);
    dragLayer.addEventListener("pointercancel", stopDrag);

    dragLayer.addEventListener("mousedown", (event) => {
      isMouseDragging = true;
      dragStartX = event.clientX;
      dragStartOrbit = orbitAngle;
      dragLayer.classList.add("is-dragging");
      viewer.removeAttribute("auto-rotate");
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!isMouseDragging) return;
      const delta = event.clientX - dragStartX;
      setOrbit(dragStartOrbit + delta * 0.18);
    }, { passive: true });

    window.addEventListener("mouseup", () => {
      if (!isMouseDragging) return;
      isMouseDragging = false;
      dragLayer.classList.remove("is-dragging");
      window.setTimeout(() => viewer.setAttribute("auto-rotate", ""), 900);
    });
  }
}
