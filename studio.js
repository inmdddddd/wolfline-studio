import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.querySelector("#studioViewer");
const form = document.querySelector("[data-studio-form]");
const message = document.querySelector("[data-studio-message]");

const state = {
  mode: "texture",
  printImage: null,
  textureImage: null,
  textureDataUrl: "",
  textureReadPromise: null,
  x: 0,
  y: 0,
  scale: 360,
  rotation: 0,
  opacity: 1,
  shirtColor: "#ffffff"
};

const textureCanvas = document.createElement("canvas");
textureCanvas.width = 1024;
textureCanvas.height = 1024;
const ctx = textureCanvas.getContext("2d");

let renderer = null;
let shirtTexture = null;
let shirtModel = null;
let shirtMeshes = [];
let printMesh = null;
let printTexture = null;
let fullTexture = null;
let printAspect = 1;
let studioScene = null;
let resizeStudio = () => {};

const modeInput = document.querySelector("[data-studio-mode]");
if (modeInput) {
  modeInput.value = "texture";
}

function drawFallbackPrint() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillRect(-170, -210, 340, 420);
  ctx.fillStyle = "#bfff47";
  ctx.font = "900 70px Arial";
  ctx.textAlign = "center";
  ctx.fillText("DROP", 0, -12);
  ctx.fillRect(-92, 28, 184, 18);
}

function drawTexture() {
  ctx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  ctx.fillStyle = state.shirtColor;
  ctx.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(0, 0, textureCanvas.width, 64);
  ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
  ctx.fillRect(0, 924, textureCanvas.width, 52);

  if (shirtTexture) {
    shirtTexture.needsUpdate = true;
  }
}

function setPrintTexture(image) {
  if (printTexture) printTexture.dispose();
  printTexture = new THREE.Texture(image);
  printTexture.colorSpace = THREE.SRGBColorSpace;
  printTexture.anisotropy = 16;
  printTexture.needsUpdate = true;
  printAspect = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;

  if (!printMesh) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: printTexture,
      transparent: true,
      opacity: state.opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    printMesh = new THREE.Mesh(geometry, material);
    printMesh.renderOrder = 30;
    studioScene?.add(printMesh);
  } else {
    printMesh.material.map = printTexture;
    printMesh.material.needsUpdate = true;
  }

  updatePrintLayer();
}

function updatePrintLayer() {
  if (!printMesh) return;

  const isFull = state.mode === "full";
  const baseWidth = isFull ? 1.05 : 0.46;
  const width = baseWidth * (state.scale / 360);
  const height = width / Math.max(printAspect, 0.2);

  printMesh.visible = state.mode !== "texture" && Boolean(state.printImage);
  printMesh.position.set(state.x / 650, 0.12 - state.y / 650, 0.74);
  printMesh.scale.set(width, height, 1);
  printMesh.rotation.set(0, 0, (state.rotation * Math.PI) / 180);
  printMesh.material.opacity = state.opacity;
}

function applyTexture(map = shirtTexture) {
  shirtMeshes.forEach((mesh) => {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material?.dispose?.());
    } else {
      mesh.material?.dispose?.();
    }

    mesh.material = new THREE.MeshStandardMaterial({
      map,
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0,
      envMapIntensity: 0.35,
      side: THREE.FrontSide
    });
  });
}

function setFullTexture(image) {
  if (fullTexture) fullTexture.dispose();
  fullTexture = new THREE.Texture(image);
  fullTexture.colorSpace = THREE.SRGBColorSpace;
  fullTexture.flipY = false;
  fullTexture.anisotropy = 16;
  fullTexture.minFilter = THREE.LinearMipmapLinearFilter;
  fullTexture.magFilter = THREE.LinearFilter;
  fullTexture.needsUpdate = true;
  applyTexture(fullTexture);
  if (printMesh) printMesh.visible = false;
}

function fitModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.92 / Math.max(size.x, size.y, size.z);

  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.08, -center.z * scale);
  model.rotation.y = -0.08;
}

function initStudio() {
  if (!container || !form) return;

  const scene = new THREE.Scene();
  studioScene = scene;
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  const controls = new OrbitControls(camera, renderer.domElement);
  const loader = new GLTFLoader();

  shirtTexture = new THREE.CanvasTexture(textureCanvas);
  shirtTexture.colorSpace = THREE.SRGBColorSpace;
  shirtTexture.flipY = false;
  shirtTexture.anisotropy = 16;
  shirtTexture.minFilter = THREE.LinearMipmapLinearFilter;
  shirtTexture.magFilter = THREE.LinearFilter;
  shirtTexture.generateMipmaps = true;
  drawTexture();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  camera.position.set(0, 0.12, 4.85);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.41;
  controls.maxPolarAngle = Math.PI * 0.59;
  controls.minDistance = 4.1;
  controls.maxDistance = 6.1;
  controls.target.set(0, -0.02, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 1.75);
  const key = new THREE.DirectionalLight(0xffffff, 4.2);
  const rim = new THREE.DirectionalLight(0xbfff47, 1.15);
  const front = new THREE.DirectionalLight(0xffffff, 3.2);
  const fill = new THREE.HemisphereLight(0xffffff, 0x223018, 2.2);
  key.position.set(-2.2, 3.2, 3.4);
  rim.position.set(2.8, 2.4, -2.4);
  front.position.set(0, 1.2, 4);
  scene.add(ambient, key, rim, front, fill);

  function resize() {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.25));
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.floor(rect.width), Math.floor(rect.height), false);
  }
  resizeStudio = resize;

  const resizeObserver = new ResizeObserver(() => resizeStudio());
  resizeObserver.observe(container);

  window.addEventListener("beca:studio-visible", () => {
    requestAnimationFrame(resizeStudio);
    setTimeout(resizeStudio, 120);
    setTimeout(resizeStudio, 360);
  });

  loader.load(
    container.dataset.model,
    (gltf) => {
      shirtModel = gltf.scene;
      shirtMeshes = [];
      shirtModel.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.frustumCulled = false;
        shirtMeshes.push(child);
      });
      fitModel(shirtModel);
      applyTexture();
      scene.add(shirtModel);
      container.classList.add("is-loaded");
      resizeStudio();
    },
    undefined,
    (error) => {
      console.error("Studio shirt failed to load", error);
      container.classList.add("is-error");
      const loader = container.querySelector(".studio-loader");
      if (loader) loader.textContent = "3D tee could not load.";
    }
  );

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  resizeStudio();
  setTimeout(resizeStudio, 100);
  setTimeout(resizeStudio, 500);
  window.addEventListener("resize", resizeStudio);
  animate();
}

function updateStateFromControls() {
  state.x = Number(document.querySelector("[data-studio-x]")?.value || 0);
  state.y = Number(document.querySelector("[data-studio-y]")?.value || 0);
  state.scale = Number(document.querySelector("[data-studio-scale]")?.value || 360);
  state.rotation = Number(document.querySelector("[data-studio-rotation]")?.value || 0);
  state.opacity = Number(document.querySelector("[data-studio-opacity]")?.value || 100) / 100;
  state.shirtColor = document.querySelector("[data-studio-color]")?.value || "#ffffff";
  state.mode = document.querySelector("[data-studio-mode]")?.value || "texture";
  drawTexture();

  if (state.mode === "texture") {
    if (state.textureImage) {
      setFullTexture(state.textureImage);
    } else {
      applyTexture(shirtTexture);
    }
    if (printMesh) printMesh.visible = false;
    return;
  }

  applyTexture(shirtTexture);
  updatePrintLayer();
}

document.querySelectorAll("[data-studio-x], [data-studio-y], [data-studio-scale], [data-studio-rotation], [data-studio-opacity], [data-studio-color], [data-studio-mode]").forEach((input) => {
  input.addEventListener("input", updateStateFromControls);
  input.addEventListener("change", updateStateFromControls);
});

document.querySelector("[data-studio-print]")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  state.textureReadPromise = new Promise((resolve, reject) => {
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      state.textureDataUrl = dataUrl;

      const image = new Image();
      image.onload = () => {
        const looksLikeTextureMap = image.naturalWidth === image.naturalHeight && image.naturalWidth >= 2048;

        if (state.mode === "texture" || looksLikeTextureMap) {
          state.mode = "texture";
          if (modeInput) modeInput.value = "texture";
          state.textureImage = image;
          state.printImage = null;
          setFullTexture(image);
        } else {
          state.printImage = image;
          setPrintTexture(image);
        }

        resolve(dataUrl);
      };
      image.onerror = () => reject(new Error("Texture image could not be loaded."));
      image.src = dataUrl;
    });
    reader.addEventListener("error", () => reject(new Error("Texture file could not be read.")));
  });

  reader.readAsDataURL(file);
});

async function getTextureImageForSave() {
  if (state.textureReadPromise) {
    await state.textureReadPromise;
  }

  if (state.textureDataUrl) return state.textureDataUrl;
  return textureCanvas.toDataURL("image/png");
}

document.querySelector("[data-studio-reset]")?.addEventListener("click", () => {
  state.printImage = null;
  state.textureImage = null;
  state.textureDataUrl = "";
  state.textureReadPromise = null;
  if (printMesh) printMesh.visible = false;
  document.querySelector("[data-studio-print]").value = "";
  drawTexture();
  applyTexture(shirtTexture);
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector("button[type='submit']");

  message.dataset.type = "info";
  message.textContent = "Saving studio product...";
  submit.disabled = true;

  try {
    const textureImage = await getTextureImageForSave();
    const previewImage = renderer.domElement.toDataURL("image/jpeg", 0.82);
    const payload = {
      ...data,
      modelUrl: container.dataset.model || "../assets/models/tshirt-web.glb",
      previewImage,
      textureImage,
      printX: state.x,
      printY: state.y,
      printScale: state.scale,
      printRotation: state.rotation,
      printOpacity: state.opacity,
      shirtColor: state.shirtColor,
      studioMode: state.mode
    };

    const response = await fetch("/api/admin/studio-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(result.error || "Studio save failed.");

    message.dataset.type = "success";
    message.textContent = "Saved as product.";
    window.dispatchEvent(new CustomEvent("beca:admin-refresh"));
  } catch (error) {
    message.dataset.type = "";
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

initStudio();
