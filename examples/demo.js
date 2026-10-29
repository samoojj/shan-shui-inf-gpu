import { createLandscape } from "../dist/index.js";

const canvas = document.querySelector("#landscape");
const status = document.querySelector("#status");
const seed = document.querySelector("#seed");
const controls = document.querySelector("#controls");
const zoom = document.querySelector("#zoom");
const download = document.querySelector("#download");
const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

let landscape;
let observer;
let unsubscribe;
let frame = 0;
let pending = {};
let cameraX = 0;
let dragging = null;
let capturing = false;
let pageClosed = false;

function reportError(error) {
  status.textContent = error instanceof Error ? error.message : String(error);
}

function showPosition() {
  const options = landscape.getOptions();
  status.textContent = `Position ${Math.round(options.cameraX)} · Seed ${options.seed}`;
}

function syncSaveButton() {
  download.disabled = capturing || !landscape || landscape.getStatus() !== "ready";
}

function cancelFrame() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

// Frame coalescing is this example's interaction policy. Rendering and image
// capture correctness stay behind the landscape interface.
function renderSoon(patch) {
  Object.assign(pending, patch);
  if (frame || !landscape || landscape.getStatus() !== "ready") return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    try {
      landscape.render(pending);
      pending = {};
      if (landscape.getStatus() === "ready") showPosition();
    } catch (error) { reportError(error); }
  });
}

function setCamera(value) {
  cameraX = Math.max(-1e6, Math.min(1e6, value));
  renderSoon({ cameraX });
}

function resetView() {
  cameraX = 0;
  zoom.value = "1";
  document.querySelector("#zoom-value").value = "1.00×";
  renderSoon({ cameraX: 0, cameraY: 0, zoom: 1 });
}

function stopDragging() {
  dragging = null;
  canvas.classList.remove("dragging");
}

function reflectRendererState(state) {
  const unavailable = state.status !== "ready";
  controls.querySelectorAll("button, input").forEach(control => { control.disabled = unavailable; });
  syncSaveButton();
  if (state.status === "ready") {
    showPosition();
  } else {
    cancelFrame();
    stopDragging();
    observer?.disconnect();
    status.textContent = state.status === "device-lost"
      ? "The graphics connection was lost. Reload to draw a new landscape."
      : state.status === "error"
        ? "The landscape could not be drawn. Reload to try again."
        : "The landscape has closed.";
  }
}

async function initializeLandscape() {
  controls.querySelectorAll("button, input").forEach(control => { control.disabled = true; });
  status.textContent = "Preparing the landscape…";
  try {
    const bounds = canvas.getBoundingClientRect();
    const renderer = await createLandscape(canvas, {
      seed: seed.value,
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      pixelRatio,
    });
    // Initialization can finish after the visitor leaves this page.
    if (pageClosed) {
      renderer.dispose();
      return;
    }
    landscape = renderer;
    unsubscribe = landscape.subscribe(reflectRendererState);
    if (landscape.getStatus() !== "ready") return;
    observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) renderSoon({ width: Math.round(width), height: Math.round(height), pixelRatio });
    });
    observer.observe(canvas);
  } catch (error) {
    if (pageClosed) return;
    reportError(error);
    controls.querySelectorAll("button, input").forEach(control => { control.disabled = true; });
  }
}

controls.addEventListener("submit", event => {
  event.preventDefault();
  renderSoon({ seed: seed.value });
});

for (const name of ["layers", "mist", "vegetation", "zoom"]) {
  const input = document.querySelector(`#${name}`);
  const output = document.querySelector(`#${name}-value`);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    output.value = name === "layers" ? String(value) : name === "zoom" ? `${value.toFixed(2)}×` : `${Math.round(value * 100)}%`;
    renderSoon({ [name]: value });
  });
}

document.querySelector("#randomize").addEventListener("click", () => {
  seed.value = `ink-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  renderSoon({ seed: seed.value });
});
document.querySelector("#reset").addEventListener("click", resetView);

canvas.addEventListener("pointerdown", event => {
  if (!landscape || landscape.getStatus() !== "ready" || event.button !== 0 || !event.isPrimary) return;
  canvas.focus({ preventScroll: true });
  dragging = { pointerId: event.pointerId, startX: event.clientX, cameraX };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", event => {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const worldUnitsPerPixel = 1000 / (Number(zoom.value) * canvas.getBoundingClientRect().height);
  setCamera(dragging.cameraX - (event.clientX - dragging.startX) * worldUnitsPerPixel);
});
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
canvas.addEventListener("lostpointercapture", stopDragging);
canvas.addEventListener("keydown", event => {
  if (!landscape || landscape.getStatus() !== "ready") return;
  if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") resetView();
  else setCamera(cameraX + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 250 : 80) / Number(zoom.value));
});

download.addEventListener("click", async () => {
  if (!landscape || landscape.getStatus() !== "ready" || capturing) return;
  cancelFrame();
  const patch = pending;
  pending = {};
  capturing = true;
  syncSaveButton();
  try {
    const image = await landscape.capture(patch);
    if (landscape.getStatus() === "disposed") return;
    const url = URL.createObjectURL(image.blob);
    const link = document.createElement("a");
    // The image carries the settings at capture time, even if the visitor
    // changes seeds while the browser is encoding it.
    const imageSeed = String(image.options.seed).replace(/[^a-z0-9_-]/gi, "-").slice(0, 60) || "landscape";
    link.download = `shan-shui-${imageSeed}.png`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (landscape.getStatus() === "ready") status.textContent = "PNG saved";
  } catch (error) {
    // Encoding can fail after a newer interaction has already rendered. Never
    // replay the capture's settings over the user's current scene.
    if (landscape.getStatus() === "ready") reportError(error);
  } finally {
    capturing = false;
    syncSaveButton();
  }
});

window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  pageClosed = true;
  cancelFrame();
  observer?.disconnect();
  unsubscribe?.();
  landscape?.dispose();
});

void initializeLandscape();
