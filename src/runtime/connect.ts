import type { WorkerRequest, WorkerResponse } from "./protocol.js";

/** Check worker WebGPU support before an irreversible canvas transfer. */
export function connectWorker(workerFactory?: () => Worker, signal?: AbortSignal): Promise<Worker> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Landscape initialization was aborted.", "AbortError")); return; }
    if ((!workerFactory && typeof Worker === "undefined") || typeof OffscreenCanvas === "undefined") {
      reject(new Error("Landscapes require module workers, OffscreenCanvas, and WebGPU in a secure browser context."));
      return;
    }
    const worker = workerFactory ? workerFactory() : new Worker(new URL("./runtime/worker.js", import.meta.url), { type: "module" });
    let finished = false;
    const timeout = setTimeout(() => finish(new Error("The landscape worker did not respond to its support check.")), 15000);
    function cleanup(): void {
      clearTimeout(timeout);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      signal?.removeEventListener("abort", onAbort);
    }
    function finish(error?: Error): void {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) { worker.terminate(); reject(error); }
      else resolve(worker);
    }
    function onMessage(event: MessageEvent<WorkerResponse>): void {
      if (event.data.type !== "support") return;
      finish(event.data.supported ? undefined : new Error("WebGPU is unavailable in the landscape worker. Use a supported browser on HTTPS or localhost."));
    }
    function onError(event: ErrorEvent): void {
      event.preventDefault();
      finish(new Error(`The landscape worker could not start: ${event.message || "check worker loading and Content Security Policy"}.`));
    }
    function onMessageError(): void { finish(new Error("The landscape worker could not decode a message.")); }
    function onAbort(): void { finish(new DOMException("Landscape initialization was aborted.", "AbortError")); }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    const probe: WorkerRequest = { type: "probe" };
    try { worker.postMessage(probe); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
