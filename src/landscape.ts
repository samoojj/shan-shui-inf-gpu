import { DEFAULT_OPTIONS, resolveOptions } from "./options.js";
import type { LandscapeOptions } from "./options.js";
import type { LandscapeCanvas, LandscapeImage, LandscapeRenderer, LandscapeState } from "./types.js";
import { connectWorker } from "./runtime/connect.js";
import { restoreError } from "./runtime/protocol.js";
import type { WorkerRequest, WorkerResponse } from "./runtime/protocol.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

type RenderJob = { type: "render"; revision: number; options: LandscapeOptions; waiters: Deferred<void>[] };
type CaptureJob = { type: "capture"; revision: number; options: LandscapeOptions; result: Deferred<LandscapeImage> };
type Job = RenderJob | CaptureJob;
const owners = new WeakSet<LandscapeCanvas>();
const transferred = new WeakSet<LandscapeCanvas>();
const freshCanvasMessage = "This canvas has already been transferred to a landscape worker. Create a fresh canvas for a new renderer.";

/** Main-thread settings, never serialized to the rendering worker. */
export interface LandscapeRuntimeOptions {
  /** Return a fresh module worker emitted by the application's bundler. */
  workerFactory?: () => Worker;
  /** Cancels worker setup and first-frame construction; detached after creation. */
  signal?: AbortSignal;
}

/** Query worker WebGPU support without claiming a canvas or requesting a device. SSR safe. */
export async function isWebGPUSupported(runtime: LandscapeRuntimeOptions = {}): Promise<boolean> {
  try {
    const worker = await connectWorker(runtime.workerFactory, runtime.signal);
    worker.terminate();
    return true;
  } catch { return false; }
}

/** Transfer a fresh canvas to its worker and wait for the first GPU frame. */
export async function createLandscape(canvas: LandscapeCanvas, patch: Partial<LandscapeOptions> = {}, runtime: LandscapeRuntimeOptions = {}): Promise<LandscapeRenderer> {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createLandscape requires an unused HTMLCanvasElement or OffscreenCanvas.");
  }
  if (transferred.has(canvas)) throw new Error(freshCanvasMessage);
  if (owners.has(canvas)) throw new Error("This canvas already has a landscape renderer.");
  if (("transferControlToOffscreen" in canvas && typeof canvas.transferControlToOffscreen !== "function") ||
      (!("transferControlToOffscreen" in canvas) && !("convertToBlob" in canvas))) {
    throw new Error("This browser cannot transfer an HTML canvas to a landscape worker.");
  }
  let options = resolveOptions(patch, {
    ...DEFAULT_OPTIONS,
    width: canvas.width || DEFAULT_OPTIONS.width,
    height: canvas.height || DEFAULT_OPTIONS.height,
  });
  // Claim before awaiting support so concurrent initializations cannot share a canvas.
  owners.add(canvas);
  let worker: Worker;
  try { worker = await connectWorker(runtime.workerFactory, runtime.signal); }
  catch (error) { owners.delete(canvas); throw error; }
  if (runtime.signal?.aborted) {
    worker.terminate(); owners.delete(canvas);
    throw new DOMException("Landscape initialization was aborted.", "AbortError");
  }

  let state: LandscapeState = Object.freeze({ status: "ready", error: null });
  const listeners = new Set<(state: LandscapeState) => void>();
  const queue: Job[] = [];
  let active: Job | undefined;
  let revision = 0;
  let stopped = false;
  let scheduled = false;
  let disposalTimer: ReturnType<typeof setTimeout> | undefined;
  const initialized = deferred<void>();
  const initializationTimer = setTimeout(() => fail(new Error("Landscape initialization timed out.")), 360000);

  function notify(): void {
    const snapshot = state;
    for (const listener of [...listeners]) {
      if (state !== snapshot) break;
      try { listener(snapshot); }
      catch (error) {
        if (typeof globalThis.reportError === "function") globalThis.reportError(error);
        else setTimeout(() => { throw error; }, 0);
      }
    }
  }

  function rejectJob(job: Job, error: Error): void {
    if (job.type === "render") for (const waiter of job.waiters) waiter.reject(error);
    else job.result.reject(error);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(initializationTimer);
    clearTimeout(disposalTimer);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onMessageError);
    runtime.signal?.removeEventListener("abort", onAbort);
    worker.terminate();
    owners.delete(canvas);
  }

  function fail(error: Error, status: "device-lost" | "error" = "error"): void {
    initialized.reject(error);
    if (active) rejectJob(active, error);
    active = undefined;
    for (const job of queue.splice(0)) rejectJob(job, error);
    stop();
    if (state.status !== "ready") return;
    state = Object.freeze({ status, error });
    notify();
  }

  function post(message: WorkerRequest, transfer: Transferable[] = []): void {
    try { worker.postMessage(message, transfer); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  }

  function flush(): void {
    scheduled = false;
    if (active || state.status !== "ready" || stopped) return;
    active = queue.shift();
    if (active) post({ type: active.type, revision: active.revision, options: active.options });
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function onMessage({ data }: MessageEvent<WorkerResponse>): void {
    if (stopped) return;
    if (data.type === "failure") { fail(restoreError(data.error), data.status); return; }
    if (data.type === "disposed") { stop(); return; }
    if (data.type === "ready") {
      clearTimeout(initializationTimer);
      runtime.signal?.removeEventListener("abort", onAbort);
      initialized.resolve();
      return;
    }
    if (!("revision" in data) || !active || active.revision !== data.revision) return;
    const completed = active;
    if (data.type === "rendered" && completed.type === "render") {
      for (const waiter of completed.waiters) waiter.resolve();
    } else if (data.type === "captured" && completed.type === "capture") {
      completed.result.resolve({ blob: data.blob, width: data.width, height: data.height, revision: data.revision, options: { ...completed.options } });
    } else if (data.type === "capture-error" && completed.type === "capture") {
      completed.result.reject(restoreError(data.error));
    } else return;
    active = undefined;
    schedule();
  }

  function onError(event: ErrorEvent): void {
    event.preventDefault();
    fail(new Error(`Landscape worker failed: ${event.message || "worker execution stopped"}. Create a fresh canvas to restart.`));
  }
  function onMessageError(): void { fail(new Error("The landscape worker could not decode a message.")); }
  function onAbort(): void { fail(new DOMException("Landscape initialization was aborted.", "AbortError")); }
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onMessageError);
  runtime.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const offscreen = "transferControlToOffscreen" in canvas ? canvas.transferControlToOffscreen() : canvas;
    // HTML canvas transfer is irreversible even if subsequent postMessage fails.
    if ("transferControlToOffscreen" in canvas) transferred.add(canvas);
    worker.postMessage({ type: "initialize", canvas: offscreen, options } satisfies WorkerRequest, [offscreen]);
    transferred.add(canvas);
  } catch (error) {
    fail(new Error(`The canvas could not be transferred to its landscape worker: ${error instanceof Error ? error.message : String(error)}. Use a fresh canvas with no existing rendering context.`));
  }
  await initialized.promise;

  function assertReady(): void {
    if (state.status === "ready") return;
    if (state.status === "disposed") throw new Error("Landscape renderer has been disposed.");
    throw new Error(`Landscape renderer is unavailable: ${state.error?.message ?? state.status}`);
  }

  async function render(patch: Partial<LandscapeOptions> = {}): Promise<void> {
    assertReady();
    const candidate = resolveOptions(patch, options);
    const result = deferred<void>();
    options = candidate;
    // A capture already in the queue is an exact barrier: finish its preceding
    // painting. Otherwise move superseded callers onto the replacement frame.
    const superseded = active?.type === "render" && active.options.presentation === "incremental"
      && !queue.some(job => job.type === "capture") ? active : undefined;
    const waiters = superseded ? superseded.waiters.splice(0) : [];
    waiters.push(result);
    const previous = queue[queue.length - 1];
    if (previous?.type === "render") {
      previous.options = candidate;
      previous.revision = ++revision;
      previous.waiters.push(...waiters);
    } else queue.push({ type: "render", revision: ++revision, options: candidate, waiters });
    if (superseded) post({ type: "cancel", revision: superseded.revision });
    schedule();
    return result.promise;
  }

  async function capture(patch: Partial<LandscapeOptions> = {}): Promise<LandscapeImage> {
    assertReady();
    const candidate = resolveOptions(patch, options);
    const result = deferred<LandscapeImage>();
    options = candidate;
    queue.push({ type: "capture", revision: ++revision, options: candidate, result });
    // An idle capture is dispatched immediately; later disposal can preserve it.
    flush();
    return result.promise;
  }

  return {
    render,
    resize: (width, height, pixelRatio = options.pixelRatio) => render({ width, height, pixelRatio }),
    getOptions: () => ({ ...options }),
    getStatus: () => state.status,
    subscribe(listener) {
      if (state.status !== "disposed") listeners.add(listener);
      try { listener(state); }
      catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); };
    },
    capture,
    dispose() {
      if (state.status === "disposed") return;
      state = Object.freeze({ status: "disposed", error: null });
      const error = new Error("Landscape renderer was disposed before the requested frame completed.");
      for (const job of queue.splice(0)) rejectJob(job, error);
      if (active?.type === "render") { rejectJob(active, error); active = undefined; }
      if (!stopped) {
        // A broken encoder/worker must not retain a disposed session indefinitely.
        disposalTimer = setTimeout(() => fail(new Error("Landscape worker disposal timed out before capture completed.")), 30000);
        post({ type: "dispose" });
      }
      notify();
      listeners.clear();
    },
  };
}
