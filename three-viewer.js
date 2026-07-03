import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const viewers = [...document.querySelectorAll(".tshirt-viewer, .floating-shirt")];
const productButtons = [...document.querySelectorAll("[data-texture]")];
const textureUpload = document.querySelector("#textureUpload");
const productViewers = [];

function createPrintTexture(type = "beca", imageSrc = null) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = type === "noir" ? "#111111" : "#f5f1e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (type === "wolfline") {
    ctx.fillStyle = "#d7ff42";
    ctx.fillRect(0, 0, canvas.width, 90);
    ctx.fillStyle = "#0a0d08";
    ctx.font = "900 76px Arial";
    ctx.textAlign = "center";
    ctx.fillText("WOLFLINE", 512, 520);
    ctx.font = "700 34px Arial";
    ctx.fillText("STUDIO CAPSULE", 512, 580);
  } else if (type === "noir") {
    ctx.fillStyle = "#d7ff42";
    ctx.font = "900 64px Arial";
    ctx.textAlign = "center";
    ctx.fillText("BECA", 512, 520);
  } else {
    ctx.fillStyle = "#101010";
    ctx.font = "900 86px Arial";
    ctx.textAlign = "center";
    ctx.fillText("BeCa", 512, 500);
    ctx.fillStyle = "#d7ff42";
    ctx.fillRect(388, 530, 248, 20);
    ctx.fillStyle = "#101010";
    ctx.font = "700 30px Arial";
    ctx.fillText("x WOLFLINE STUDIO", 512, 590);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;

  if (!imageSrc) return Promise.resolve(texture);

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 312, 360, 400, 300);
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.src = imageSrc;
  });
}

function applyTexture(model, texture) {
  model.traverse((child) => {
    if (!child.isMesh) return;

    child.material = child.material.clone();
    child.material.map = texture;
    child.material.color.set("#ffffff");
    child.material.needsUpdate = true;
  });
}

function initViewer(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  const controls = new OrbitControls(camera, renderer.domElement);
  const loader = new GLTFLoader();
  const keyLight = new THREE.DirectionalLight(0xffffff, 4);
  const rimLight = new THREE.DirectionalLight(0xd7ff42, 2.4);
  const frontLight = new THREE.DirectionalLight(0xffffff, 3.2);
  const fillLight = new THREE.HemisphereLight(0xffffff, 0x16200f, 2.2);
  const clock = new THREE.Clock();
  let shirt = null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  camera.position.set(0, 0.8, 2.25);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.55;
  controls.maxDistance = 4.4;
  controls.target.set(0, 0.08, 0);

  keyLight.position.set(0, 3.6, 3);
  rimLight.position.set(2.6, 2.5, -2.5);
  frontLight.position.set(0, 1.2, 3.5);
  scene.add(keyLight, rimLight, frontLight, fillLight);

  function resize() {
    const rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  }

  function fitModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = 4.6 / Math.max(size.x, size.y, size.z);

    model.position.sub(center);
    model.scale.setScalar(scale);
    model.position.y -= 0.08;
    model.rotation.y = -0.18;
    scene.add(model);
    shirt = model;
    renderer.domElement.style.zIndex = "4";
    container.classList.add("is-loaded");
    requestAnimationFrame(() => container.classList.add("is-rendered"));

    if (container.id === "productViewer") {
      productViewers.push({ model, apply: (texture) => applyTexture(model, texture) });
      createPrintTexture("beca").then((texture) => applyTexture(model, texture));
    }
  }

  loader.load(
    container.dataset.model,
    (gltf) => fitModel(gltf.scene),
    undefined,
    (error) => {
      console.error("Tshirt GLB failed to load", error);
      container.classList.add("is-error");
    }
  );

  function animate() {
    requestAnimationFrame(animate);
    if (shirt) {
      shirt.rotation.y += clock.getDelta() * 0.18;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener("resize", resize);
  animate();
}

viewers.forEach(initViewer);

productButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    productButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const texture = await createPrintTexture(button.dataset.texture);
    productViewers.forEach((viewer) => viewer.apply(texture));
  });
});

if (textureUpload) {
  textureUpload.addEventListener("change", () => {
    const file = textureUpload.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const texture = await createPrintTexture("upload", reader.result);
      productViewers.forEach((viewer) => viewer.apply(texture));
    });
    reader.readAsDataURL(file);
  });
}
