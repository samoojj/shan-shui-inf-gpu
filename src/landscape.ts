import { DEFAULT_OPTIONS, resolveOptions } from "./options.js";
import type { LandscapeOptions } from "./options.js";
import type { LandscapeCanvas, LandscapeImage, LandscapeRenderer, LandscapeState } from "./types.js";
import { createLandscapeProgram } from "./webgl/program.js";
import type { LandscapeProgram } from "./webgl/program.js";

// A ready session always has a complete program. Every other state has none.
type Session =
  | { status: "ready"; program: LandscapeProgram }
  | { status: "context-lost" }
  | { status: "error"; error: Error }
  | { status: "disposed" };

const owners = new WeakSet<LandscapeCanvas>();

/** Probe a disposable canvas without claiming the caller's canvas. Safe during SSR. */
export function isWebGL2Supported(): boolean {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1, 1)
      : typeof document !== "undefined" ? document.createElement("canvas") : null;
    gl = canvas?.getContext("webgl2") as WebGL2RenderingContext | null;
    return !!gl;
  } catch {
    return false;
  } finally {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Own one canvas, its current scene, and every transition in its render session. */
export function createLandscape(canvas: LandscapeCanvas, patch: Partial<LandscapeOptions> = {}): LandscapeRenderer {
  if (!canvas || typeof canvas.getContext !== "function" || typeof canvas.addEventListener !== "function") {
    throw new TypeError("createLandscape requires an HTMLCanvasElement or OffscreenCanvas.");
  }
  if (owners.has(canvas)) throw new Error("This canvas already has a landscape renderer. Dispose it before creating another.");
  let options = resolveOptions(patch, {
    ...DEFAULT_OPTIONS,
    width: canvas.width || DEFAULT_OPTIONS.width,
    height: canvas.height || DEFAULT_OPTIONS.height,
  });
  const context = canvas.getContext("webgl2", {
    alpha: false, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: "low-power",
  }) as WebGL2RenderingContext | null;
  if (!context) throw new Error("WebGL2 is unavailable. Use a browser with WebGL2 enabled and a canvas without an existing 2D context.");
  const gl = context;

  const listeners = new Set<(state: LandscapeState) => void>();
  // Construction and recovery share the same resource acquisition and first draw.
  function openProgram(): LandscapeProgram {
    const program = createLandscapeProgram(gl, canvas);
    try {
      program.draw(options);
      return program;
    } catch (error) {
      program.dispose();
      throw error;
    }
  }
  let session: Session = { status: "ready", program: openProgram() };

  function snapshot(): LandscapeState {
    return Object.freeze({ status: session.status, error: session.status === "error" ? session.error : null });
  }

  function notify() {
    const state = snapshot();
    for (const listener of [...listeners]) {
      // A callback may dispose the renderer; never follow that with stale readiness.
      if (session.status !== state.status) break;
      try { listener(state); }
      catch (error) {
        // Consumer callback failures must not turn successful GPU recovery into failure.
        if (typeof globalThis.reportError === "function") globalThis.reportError(error);
        else setTimeout(() => { throw error; }, 0);
      }
    }
  }

  function assertActive() {
    if (session.status === "disposed") throw new Error("Landscape renderer has been disposed.");
    if (session.status === "error") throw new Error(`Landscape context restoration failed: ${session.error.message}. Dispose this renderer and create another.`);
  }

  function onLost(event: Event) {
    event.preventDefault();
    if (session.status !== "ready") return;
    // The browser has invalidated and released the old program's GPU handles.
    session = { status: "context-lost" };
    notify();
  }

  function onRestored() {
    if (session.status !== "context-lost") return;
    try {
      session = { status: "ready", program: openProgram() };
    } catch (error) {
      session = { status: "error", error: error instanceof Error ? error : new Error(String(error)) };
    }
    notify();
  }

  function render(patch: Partial<LandscapeOptions> = {}) {
    assertActive();
    const candidate = resolveOptions(patch, options);
    options = candidate;
    if (session.status === "ready" && !gl.isContextLost()) session.program.draw(options);
  }

  function getOptions(): LandscapeOptions {
    return { ...options, paper: [...options.paper], ink: [...options.ink] };
  }

  async function capture(patch: Partial<LandscapeOptions> = {}): Promise<LandscapeImage> {
    assertActive();
    if (session.status !== "ready" || gl.isContextLost()) throw new Error("Cannot capture a landscape while its graphics context is lost.");
    render(patch);
    if (gl.isContextLost()) throw new Error("Cannot capture a landscape while its graphics context is lost.");
    const captured = { options: getOptions(), width: canvas.width, height: canvas.height };
    // Both native encoders snapshot the bitmap when invoked. Start encoding in
    // this task, before the first await, so later renders cannot change the image.
    const encoding = "convertToBlob" in canvas
      ? canvas.convertToBlob({ type: "image/png" })
      : new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not encode the landscape PNG."));
      }, "image/png"));
    const blob = await encoding;
    return { blob, ...captured };
  }

  owners.add(canvas);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    render,
    resize: (width, height, pixelRatio = options.pixelRatio) => render({ width, height, pixelRatio }),
    getOptions,
    getStatus: () => session.status,
    subscribe(listener) {
      if (session.status !== "disposed") listeners.add(listener);
      try { listener(snapshot()); }
      catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); };
    },
    capture,
    dispose() {
      if (session.status === "disposed") return;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (session.status === "ready") session.program.dispose();
      owners.delete(canvas);
      session = { status: "disposed" };
      notify();
      listeners.clear();
    },
  };
}
