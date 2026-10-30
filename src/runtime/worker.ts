import { createLandscapeProgram } from "../gpu/program.js";
import type { GPUFailure, LandscapeProgram } from "../gpu/program.js";
import { serializeError } from "./protocol.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

// The public package includes DOM types; this entry runs only in a worker.
interface RenderWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", listener: (event: PromiseRejectionEvent) => void): void;
  postMessage(message: WorkerResponse): void;
  close(): void;
}
const scope = globalThis as unknown as RenderWorkerScope;
let program: LandscapeProgram | undefined;
let canvas: OffscreenCanvas | undefined;
let active: "initialize" | "render" | "capture" | undefined;
let disposing = false;
let failed = false;
let closed = false;

function finishDisposal(): void {
  if (closed) return;
  closed = true;
  const owned = program;
  program = undefined;
  try { owned?.dispose(); }
  finally {
    scope.postMessage({ type: "disposed" });
    scope.close();
  }
}

function fail(failure: GPUFailure): void {
  if (failed) return;
  failed = true;
  const owned = program;
  program = undefined;
  try { owned?.dispose(); }
  finally { scope.postMessage({ type: "failure", status: failure.status, error: serializeError(failure.error) }); }
}

async function initialize(message: Extract<WorkerRequest, { type: "initialize" }>): Promise<void> {
  active = "initialize";
  canvas = message.canvas;
  try {
    const initialized = await createLandscapeProgram(canvas, message.options, fail);
    if (disposing || failed) initialized.dispose();
    else {
      program = initialized;
      scope.postMessage({ type: "ready" });
    }
  } catch (error) {
    fail({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
  } finally {
    active = undefined;
    if (disposing) finishDisposal();
  }
}

async function paint(message: Extract<WorkerRequest, { type: "render" | "capture" }>): Promise<void> {
  const current = program;
  if (!current || !canvas || disposing || failed) return;
  active = message.type;
  try {
    await current.draw(message.options);
    if (message.type === "render") {
      await current.finished();
      if (!disposing && !failed) scope.postMessage({ type: "rendered", revision: message.revision });
    } else {
      const width = canvas.width, height = canvas.height;
      // Snapshot in the submission task, before presentation can clear the surface.
      // Both promises are observed even when encoding or native GPU work fails.
      let encoding: Promise<Blob>;
      try { encoding = canvas.convertToBlob({ type: "image/png" }); }
      catch (error) { encoding = Promise.reject(error); }
      const [image, fence] = await Promise.allSettled([encoding, current.finished()]);
      if (fence.status === "rejected") throw fence.reason;
      if (failed) return;
      if (image.status === "rejected") {
        scope.postMessage({ type: "capture-error", revision: message.revision, error: serializeError(image.reason) });
      } else {
        scope.postMessage({ type: "captured", revision: message.revision, blob: image.value, width, height });
      }
    }
  } catch (error) {
    if (!disposing || message.type === "capture") {
      fail({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
    }
  } finally {
    active = undefined;
    if (disposing) finishDisposal();
  }
}

async function probe(): Promise<void> {
  let supported = false;
  try {
    supported = typeof OffscreenCanvas !== "undefined" && !!(await navigator.gpu?.requestAdapter());
  } catch { /* Adapter failures mean the capability is unavailable. */ }
  scope.postMessage({ type: "support", supported });
}

scope.addEventListener("error", event => {
  event.preventDefault();
  fail({ status: "error", error: new Error(`Landscape worker failed: ${event.message}`) });
});
scope.addEventListener("unhandledrejection", event => {
  event.preventDefault();
  fail({ status: "error", error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)) });
});

scope.addEventListener("message", ({ data }) => {
  switch (data.type) {
    case "probe": void probe(); break;
    case "initialize":
      if (!active && !program && !disposing && !failed) void initialize(data);
      break;
    case "render":
    case "capture":
      // The facade sends one operation at a time; captures are ordering barriers.
      if (!active) void paint(data);
      break;
    case "dispose":
      disposing = true;
      // A dispatched capture can finish before its canvas and device are released.
      if (active !== "capture" && active !== "initialize") finishDisposal();
      break;
  }
});
