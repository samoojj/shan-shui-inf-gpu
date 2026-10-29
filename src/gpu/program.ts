import { effect, frame, init, surface } from "vgpu";
import type { Effect } from "vgpu";
import { bufferSize, hashSeed } from "../options.js";
import type { LandscapeOptions } from "../options.js";
import type { LandscapeCanvas } from "../types.js";
import landscapeShader from "../shaders/landscape.wgsl";

export interface GPUFailure {
  readonly status: "device-lost" | "error";
  readonly error: Error;
}

/** One device, canvas surface, and precompiled painting; no GPU handles escape. */
export interface LandscapeProgram {
  draw(options: Readonly<LandscapeOptions>): void;
  /** Fence work already submitted; intentional disposal does not invalidate a bitmap snapshot. */
  finished(): Promise<void>;
  dispose(): void;
}

export async function createLandscapeProgram(
  canvas: LandscapeCanvas,
  options: Readonly<LandscapeOptions>,
  onFailure: (failure: GPUFailure) => void,
): Promise<LandscapeProgram> {
  const gpu = await init({ powerPreference: "low-power" });
  const maxDimension = Math.min(8192, gpu.gpu.limits.maxTextureDimension2D);
  let disposed = false;
  let failure: GPUFailure | undefined;
  let painting: Effect | undefined;
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
    try { painting?.dispose(); }
    finally { gpu.dispose(); }
  }

  try {
    const output = surface(gpu, canvas, {
      size: bufferSize(options, maxDimension),
      dpr: 1,
      autoResize: false,
      alphaMode: "opaque",
      label: "shan-shui landscape",
    });
    const brush = painting = effect(gpu, landscapeShader, { label: "shan-shui painting" });
    await brush.compile(output);

    function draw(options: Readonly<LandscapeOptions>) {
      if (disposed) throw new Error("Landscape GPU program has been disposed.");
      if (failure) throw failure.error;
      const size = bufferSize(options, maxDimension);
      output.resize(size);
      const viewHeight = 1000 / options.zoom;
      brush.set({ settings: {
        resolution: size,
        view: [viewHeight * options.width / options.height, viewHeight],
        offset: [options.cameraX, options.cameraY],
        seed: hashSeed(options.seed),
        layers: options.layers,
        roughness: options.roughness,
        inkDensity: options.inkDensity,
        mist: options.mist,
        vegetation: options.vegetation,
        water: options.water,
        paper: options.paper,
        ink: options.ink,
      } });
      frame(gpu, current => { current.pass(output, brush); });
    }

    async function finished() {
      await gpu.settled();
      if (failure) throw failure.error;
    }

    draw(options);
    // Initialization rejects for compilation and first-frame execution failures.
    await finished();
    // Failure may arrive between the fence's check and this continuation.
    if (failure) throw failure.error;
    publishFailure = onFailure;
    return { draw, finished, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
