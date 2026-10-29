import { bufferSize, DEFAULT_OPTIONS, hashSeed, resolveOptions } from "./options.js";
import type { LandscapeOptions } from "./options.js";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders.js";

export { DEFAULT_OPTIONS };
export type { Color, LandscapeOptions } from "./options.js";
export type LandscapeCanvas = HTMLCanvasElement | OffscreenCanvas;
export type LandscapeStatus = "ready" | "context-lost" | "error" | "disposed";

export interface LandscapeRenderer {
  /** Update options and draw one frame. During context loss, retain changes for restoration. */
  render(options?: Partial<LandscapeOptions>): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  getOptions(): LandscapeOptions;
  getStatus(): LandscapeStatus;
  /** Release GPU resources and event listeners. Safe to call repeatedly. */
  dispose(): void;
}

const owners = new WeakSet<LandscapeCanvas>();

/** Probe a fresh canvas, without claiming the caller's canvas context. Safe during SSR. */
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

/**
 * Own a dedicated canvas and generate a landscape in one GPU draw call.
 * No DOM access at import time, runtime dependencies, geometry uploads or pixel readbacks.
 */
export function createLandscape(canvas: LandscapeCanvas, options: Partial<LandscapeOptions> = {}): LandscapeRenderer {
  if (!canvas || typeof canvas.getContext !== "function" || typeof canvas.addEventListener !== "function") {
    throw new TypeError("createLandscape requires an HTMLCanvasElement or OffscreenCanvas.");
  }
  if (owners.has(canvas)) throw new Error("This canvas already has a landscape renderer. Dispose it before creating another.");
  let state = resolveOptions(options, {
    ...DEFAULT_OPTIONS,
    width: canvas.width || DEFAULT_OPTIONS.width,
    height: canvas.height || DEFAULT_OPTIONS.height,
  });
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 is unavailable. Use a browser with WebGL2 enabled and a canvas without an existing 2D context.");

  let status: LandscapeStatus = "ready";
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let locations: Record<string, WebGLUniformLocation> = {};
  let maxDimension = 1;
  let seed = hashSeed(state.seed);

  function compile(type: number, source: string): WebGLShader {
    const shader = gl!.createShader(type);
    if (!shader) throw new Error("Unable to allocate landscape shader.");
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      const message = gl!.getShaderInfoLog(shader);
      gl!.deleteShader(shader);
      throw new Error(`Landscape shader compilation failed: ${message}`);
    }
    return shader;
  }

  function release() {
    gl!.useProgram(null);
    gl!.bindVertexArray(null);
    if (vao) gl!.deleteVertexArray(vao);
    if (program) gl!.deleteProgram(program);
    vao = null;
    program = null;
    locations = {};
  }

  function initialize() {
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    try {
      vertex = compile(gl!.VERTEX_SHADER, VERTEX_SHADER);
      fragment = compile(gl!.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl!.createProgram();
      if (!program) throw new Error("Unable to allocate landscape program.");
      gl!.attachShader(program, vertex);
      gl!.attachShader(program, fragment);
      gl!.linkProgram(program);
      if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) {
        throw new Error(`Landscape shader linking failed: ${gl!.getProgramInfoLog(program)}`);
      }
      vao = gl!.createVertexArray();
      if (!vao) throw new Error("Unable to allocate landscape vertex array.");
      for (const name of ["uResolution", "uView", "uOffset", "uSeed", "uLayers", "uRoughness", "uInkDensity", "uMist", "uVegetation", "uWater", "uPaper", "uInk"]) {
        const location = gl!.getUniformLocation(program, name);
        if (location === null) throw new Error(`Missing landscape uniform: ${name}`);
        locations[name] = location;
      }
      const viewport = gl!.getParameter(gl!.MAX_VIEWPORT_DIMS) as Int32Array;
      maxDimension = Math.min(8192, viewport[0], viewport[1], gl!.getParameter(gl!.MAX_RENDERBUFFER_SIZE) as number);
    } catch (error) {
      release();
      throw error;
    } finally {
      if (vertex) gl!.deleteShader(vertex);
      if (fragment) gl!.deleteShader(fragment);
    }
  }

  function draw() {
    if (status !== "ready" || gl!.isContextLost()) return;
    const [width, height] = bufferSize(state, maxDimension);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(program);
    gl!.bindVertexArray(vao);
    gl!.disable(gl!.DEPTH_TEST);
    gl!.disable(gl!.BLEND);
    gl!.disable(gl!.SCISSOR_TEST);
    gl!.uniform2f(locations.uResolution, width, height);
    const viewHeight = 1000 / state.zoom;
    gl!.uniform2f(locations.uView, viewHeight * state.width / state.height, viewHeight);
    gl!.uniform2f(locations.uOffset, state.cameraX, state.cameraY);
    gl!.uniform1ui(locations.uSeed, seed);
    gl!.uniform1i(locations.uLayers, state.layers);
    gl!.uniform1f(locations.uRoughness, state.roughness);
    gl!.uniform1f(locations.uInkDensity, state.inkDensity);
    gl!.uniform1f(locations.uMist, state.mist);
    gl!.uniform1f(locations.uVegetation, state.vegetation);
    gl!.uniform1f(locations.uWater, state.water);
    gl!.uniform3f(locations.uPaper, ...state.paper);
    gl!.uniform3f(locations.uInk, ...state.ink);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function assertActive() {
    if (status === "disposed") throw new Error("Landscape renderer has been disposed.");
    if (status === "error") throw new Error("Landscape context restoration failed. Dispose this renderer and create another.");
  }

  function onLost(event: Event) {
    event.preventDefault();
    status = "context-lost";
    program = null;
    vao = null;
    locations = {};
  }

  function onRestored() {
    try {
      initialize();
      status = "ready";
      draw();
    } catch (error) {
      status = "error";
      throw error;
    }
  }

  try {
    initialize();
    draw();
  } catch (error) {
    release();
    throw error;
  }
  owners.add(canvas);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function render(patch: Partial<LandscapeOptions> = {}) {
    assertActive();
    const candidate = resolveOptions(patch, state);
    if (candidate.seed !== state.seed) seed = hashSeed(candidate.seed);
    state = candidate;
    draw();
  }

  return {
    render,
    resize(width, height, pixelRatio = state.pixelRatio) {
      render({ width, height, pixelRatio });
    },
    getOptions: () => ({ ...state, paper: [...state.paper], ink: [...state.ink] }),
    getStatus: () => status,
    dispose() {
      if (status === "disposed") return;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      release();
      owners.delete(canvas);
      status = "disposed";
    },
  };
}
