import { draw as createDraw, effect, frame, init, sampler, surface, target } from "vgpu";
import { bufferSize } from "../options.js";
import type { LandscapeOptions } from "../options.js";
import type { LandscapeCanvas } from "../types.js";
import { createGenerator } from "./generation.js";
import pathShader from "../shaders/paths.wgsl";
import paperShader from "../shaders/paper.wgsl";

export interface GPUFailure {
  readonly status: "device-lost" | "error";
  readonly error: Error;
}

/** One device, canvas surface, and precompiled painting; no GPU handles escape. */
export interface LandscapeProgram {
  draw(options: Readonly<LandscapeOptions>, cancelled?: () => boolean): Promise<void>;
  /** Fence work already submitted; intentional disposal does not invalidate a bitmap snapshot. */
  finished(): Promise<void>;
  dispose(): void;
}

export async function createLandscapeProgram(
  canvas: LandscapeCanvas,
  options: Readonly<LandscapeOptions>,
  onFailure: (failure: GPUFailure) => void,
): Promise<LandscapeProgram> {
  const setupStarted = performance.now();
  const gpu = await init({ powerPreference: "low-power", requiredLimits: { maxStorageBuffersInVertexStage: 2, maxStorageBuffersInFragmentStage: 2 } });
  const maxDimension = Math.min(8192, gpu.gpu.limits.maxTextureDimension2D);
  let disposed = false;
  let failure: GPUFailure | undefined;
  const cleanups: (() => void)[] = [];
  let publishFailure: typeof onFailure | undefined;

  function fail(next: GPUFailure) {
    if (disposed || failure) return;
    failure = next;
    publishFailure?.(next);
  }

  const unsubscribe = gpu.onError(error => fail({ status: "error", error }));
  const onNativeError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault();
    fail({ status: "error", error: new Error(`Landscape GPU error: ${event.error.message}`) });
  };
  gpu.gpu.addEventListener("uncapturederror", onNativeError);
  void gpu.lost.then(info => fail({
    status: "device-lost",
    error: new Error(`Landscape GPU device was lost: ${info.message || info.reason}. Dispose this renderer and create another.`),
  }));

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    gpu.gpu.removeEventListener("uncapturederror", onNativeError);
    // The device also owns the surface and cached pipelines/bindings.
    try { for (const cleanup of cleanups) cleanup(); }
    finally {
      gpu.dispose();
    }
  }

  try {
    const size = bufferSize(options, maxDimension);
    const output = surface(gpu, canvas, { size, dpr: 1, autoResize: false, alphaMode: "opaque" });
    const layer = target(gpu, { size, format: "rgba8unorm", clearColor: [1, 1, 1, 1] });
    const generator = await createGenerator(gpu);
    const ink = createDraw(gpu, { shader: pathShader, vertices: 6, blend: "premultiplied", label: "ordered original paths" });
    const composite = effect(gpu, paperShader, { label: "original paper multiply" });
    cleanups.push(() => generator.dispose(), () => ink.dispose(), () => composite.dispose());
    composite.set({ scene: layer, sceneSampler: sampler(gpu, { minFilter: "nearest", magFilter: "nearest" }) });
    await Promise.all([ink.compile(layer), composite.compile(output)]);
    performance.clearMeasures("landscape:setup");
    performance.measure("landscape:setup", { start: setupStarted, end: performance.now() });
    composite.set({ noiseTable: generator.noiseTable, paperRandom: generator.paperRandom });

    let paintedView = "";
    let painting: Awaited<ReturnType<typeof generator.generate>> | undefined;
    let paintingStarted: number | undefined;

    async function draw(options: Readonly<LandscapeOptions>, cancelled = () => false) {
      if (disposed) throw new Error("Landscape GPU program has been disposed.");
      if (failure) throw failure.error;
      const next = await generator.generate(options);
      if (cancelled()) return;
      const changed = next !== painting;
      painting = next;
      ink.set({ jobs: next.jobs, points: next.points, bounds: next.bounds });
      const size = bufferSize(options, maxDimension);
      output.resize(size);
      layer.resize(size);
      ink.set({ view: { resolution: size, span: [options.width / options.zoom, options.height / options.zoom], offset: [options.cameraX, options.cameraY] } });
      composite.set({ paperView: { logicalSize: [options.width, options.height] } });
      // Presentation controls how missing ink is painted, not completed ink's identity.
      const viewKey = [size[0], size[1], options.width, options.height, options.zoom, options.cameraX, options.cameraY].join(":");
      const repaint = changed || paintedView !== viewKey;
      paintingStarted = performance.now();
      if (repaint && options.presentation === "incremental") {
        // Preserve the attachment between ordered command batches. Clearing only
        // the first batch makes its final pixels match the complete-mode pass.
        paintedView = "";
        const budget = options.commandsPerFrame;
        for (let first = 0; first < Math.max(1, next.commandCount); first += budget) {
          if (disposed || cancelled()) return;
          frame(gpu, current => {
            current.pass({ target: layer, clear: first === 0 }, pass => pass.draw(ink, {
              firstInstance: first, instances: Math.min(budget, next.commandCount - first),
            }));
            current.pass(output, composite);
          });
          if (first + budget < next.commandCount) {
            // Pace from submission while waiting for GPU completion. Both must
            // finish before the next batch; timers also progress in hidden tabs.
            await Promise.all([fence(), new Promise<void>(resolve => setTimeout(resolve, 16))]);
          }
        }
      } else {
        frame(gpu, current => {
          if (repaint) current.pass(layer, pass => pass.draw(ink, { instances: next.commandCount }));
          current.pass(output, composite);
        });
      }
      paintedView = viewKey;
    }

    async function fence() {
      await gpu.settled();
      if (failure) throw failure.error;
    }
    async function finished() {
      await fence();
      if (paintingStarted !== undefined) {
        performance.clearMeasures("landscape:painting");
        performance.measure("landscape:painting", { start: paintingStarted, end: performance.now() });
        paintingStarted = undefined;
      }
    }

    await draw(options);
    await finished();
    if (failure) throw failure.error;
    publishFailure = onFailure;
    return { draw, finished, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
