import { DEFAULT_OPTIONS, resolveOptions } from "./options.js";
import type { LandscapeOptions } from "./options.js";
import type { LandscapeCanvas, LandscapeImage, LandscapeRenderer, LandscapeState } from "./types.js";
import { createLandscapeProgram } from "./gpu/program.js";
import type { GPUFailure, LandscapeProgram } from "./gpu/program.js";

type Session =
  | { status: "ready"; program: LandscapeProgram }
  | GPUFailure
  | { status: "disposed" };

const owners = new WeakSet<LandscapeCanvas>();

/** Check adapter availability without claiming a canvas or requesting a device. SSR safe. */
export async function isWebGPUSupported(): Promise<boolean> {
  try {
    return typeof navigator !== "undefined" && !!(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/** Acquire a canvas and return only after the GPU pipeline and first frame are ready. */
export async function createLandscape(canvas: LandscapeCanvas, patch: Partial<LandscapeOptions> = {}): Promise<LandscapeRenderer> {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createLandscape requires an HTMLCanvasElement or OffscreenCanvas.");
  }
  if (owners.has(canvas)) throw new Error("This canvas already has a landscape renderer. Dispose it before creating another.");
  let options = resolveOptions(patch, {
    ...DEFAULT_OPTIONS,
    width: canvas.width || DEFAULT_OPTIONS.width,
    height: canvas.height || DEFAULT_OPTIONS.height,
  });
  const listeners = new Set<(state: LandscapeState) => void>();
  let session: Session | undefined;

  function snapshot(): LandscapeState {
    const current = session!; // No public renderer exists during initialization.
    return Object.freeze({ status: current.status, error: "error" in current ? current.error : null });
  }

  function notify() {
    const state = snapshot();
    for (const listener of [...listeners]) {
      if (session?.status !== state.status) break;
      try { listener(state); }
      catch (error) {
        if (typeof globalThis.reportError === "function") globalThis.reportError(error);
        else setTimeout(() => { throw error; }, 0);
      }
    }
  }

  function fail(failure: GPUFailure) {
    if (session && session.status !== "ready") return;
    const previous = session;
    session = failure;
    previous?.program.dispose();
    notify();
  }

  // Claim before the first await: concurrent creates must never configure
  // independent devices onto the same canvas.
  owners.add(canvas);
  try {
    const program = await createLandscapeProgram(canvas, options, fail);
    if (session) {
      program.dispose();
      throw (session as GPUFailure).error;
    }
    session = { status: "ready", program };
  } catch (error) {
    owners.delete(canvas);
    throw error;
  }

  function readyProgram(): LandscapeProgram {
    if (session?.status === "ready") return session.program;
    if (session?.status === "disposed") throw new Error("Landscape renderer has been disposed.");
    throw new Error(`Landscape renderer is unavailable: ${session && "error" in session ? session.error.message : "initializing"}`);
  }

  function render(patch: Partial<LandscapeOptions> = {}) {
    const program = readyProgram();
    const candidate = resolveOptions(patch, options);
    try { program.draw(candidate); }
    catch (error) {
      fail({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      throw error;
    }
    options = candidate;
  }

  function getOptions(): LandscapeOptions {
    return { ...options };
  }

  async function capture(patch: Partial<LandscapeOptions> = {}): Promise<LandscapeImage> {
    const program = readyProgram();
    render(patch);
    const captured = { options: getOptions(), width: canvas.width, height: canvas.height };
    // Start the browser's bitmap snapshot in the submit task. A later render,
    // resize, or disposal cannot change the PNG already being encoded.
    const encoding = "convertToBlob" in canvas
      ? canvas.convertToBlob({ type: "image/png" })
      : new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not encode the landscape PNG."));
      }, "image/png"));
    // A PNG encoder can succeed even when the submitted GPU draw failed.
    // Fence this submission now, before later renders can add work to the queue.
    const [blob] = await Promise.all([encoding, program.finished()]);
    return { blob, ...captured };
  }

  return {
    render,
    resize: (width, height, pixelRatio = options.pixelRatio) => render({ width, height, pixelRatio }),
    getOptions,
    getStatus: () => session!.status,
    subscribe(listener) {
      if (session!.status !== "disposed") listeners.add(listener);
      try { listener(snapshot()); }
      catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); };
    },
    capture,
    dispose() {
      if (session!.status === "disposed") return;
      const previous = session!;
      session = { status: "disposed" };
      if (previous.status === "ready") previous.program.dispose();
      owners.delete(canvas);
      notify();
      listeners.clear();
    },
  };
}
