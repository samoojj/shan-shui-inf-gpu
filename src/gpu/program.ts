import { compute, draw as createDraw, effect, frame, init, sampler, surface, target } from "vgpu";
import { bufferSize } from "../options.js";
import type { LandscapeOptions } from "../options.js";
import type { LandscapeCanvas } from "../types.js";
import { composeScene } from "../scene/compose.js";
import { packDrawing } from "../scene/pack.js";
import type { Drawing } from "../scene/commands.js";
import brushShader from "../shaders/brushes.wgsl";
import pathShader from "../shaders/paths.wgsl";
import paperShader from "../shaders/paper.wgsl";

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
  const gpu = await init({ powerPreference: "low-power", requiredLimits: { maxStorageBuffersInVertexStage: 2, maxStorageBuffersInFragmentStage: 2 } });
  const maxDimension = Math.min(8192, gpu.gpu.limits.maxTextureDimension2D);
  let disposed = false;
  let failure: GPUFailure | undefined;
  const cleanups: (() => void)[] = [];
  const ownedBuffers = new Set<GPUBuffer>();
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
      for (const buffer of ownedBuffers) buffer.destroy();
      ownedBuffers.clear();
      gpu.dispose();
    }
  }

  try {
    const size = bufferSize(options, maxDimension);
    const output = surface(gpu, canvas, { size, dpr: 1, autoResize: false, alphaMode: "opaque" });
    const layer = target(gpu, { size, format: "rgba8unorm", clearColor: [1, 1, 1, 1] });
    const generator = compute(gpu, brushShader, { label: "original brush expansion" });
    const ink = createDraw(gpu, { shader: pathShader, vertices: 6, blend: "premultiplied", label: "ordered original paths" });
    const composite = effect(gpu, paperShader, { label: "original paper multiply" });
    cleanups.push(() => generator.dispose(), () => ink.dispose(), () => composite.dispose());
    composite.set({ scene: layer, sceneSampler: sampler(gpu, { minFilter: "nearest", magFilter: "nearest" }) });
    await Promise.all([generator.compile(), ink.compile(layer), composite.compile(output)]);

    let scene: ReturnType<typeof composeScene> | undefined;
    let seed: string | number | undefined;
    let drawing: Drawing | undefined;
    let commandCount = 0;
    let paintedView = "";
    let brushBuffers: GPUBuffer[] = [];
    let paperBuffers: GPUBuffer[] = [];
    let noiseBuffer: GPUBuffer;

    function buffer(label: string, bytes: number, data?: ArrayBufferView): GPUBuffer {
      const result = gpu.gpu.createBuffer({ label, size: Math.max(128, bytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      ownedBuffers.add(result);
      if (data) gpu.gpu.queue.writeBuffer(result, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      return result;
    }
    function release(buffers: GPUBuffer[]) {
      for (const resource of buffers) { resource.destroy(); ownedBuffers.delete(resource); }
    }

    function draw(options: Readonly<LandscapeOptions>) {
      if (disposed) throw new Error("Landscape GPU program has been disposed.");
      if (failure) throw failure.error;
      let changed = false;
      if (!scene || seed !== options.seed) {
        scene = composeScene(options.seed);
        seed = options.seed;
        drawing = undefined;
        const old = paperBuffers;
        noiseBuffer = buffer("original Perlin table", scene.noise.byteLength, scene.noise);
        const paperRandom = buffer("original paper decisions", scene.paper.byteLength, scene.paper);
        paperBuffers = [noiseBuffer, paperRandom];
        composite.set({ noiseTable: noiseBuffer, paperRandom });
        release(old);
      }
      const commands = scene.drawing(options.cameraX, options.width / options.zoom);
      if (commands !== drawing) {
        const packed = packDrawing(commands);
        const jobs = buffer("original drawing commands", packed.jobs.byteLength, packed.jobs);
        const inputData = buffer("original control paths", packed.inputData.byteLength, packed.inputData);
        const points = buffer("GPU brush vertices", packed.pointCount * 8);
        const bounds = buffer("GPU brush bounds", packed.commandCount * 16);
        const old = brushBuffers;
        brushBuffers = [jobs, inputData, points, bounds];
        generator.set({ jobs, inputData, noiseTable: noiseBuffer!, points, bounds });
        ink.set({ jobs, points, bounds });
        commandCount = packed.commandCount;
        drawing = commands;
        changed = true;
        release(old);
      }
      const size = bufferSize(options, maxDimension);
      output.resize(size);
      layer.resize(size);
      ink.set({ view: { resolution: size, span: [options.width / options.zoom, options.height / options.zoom], offset: [options.cameraX, options.cameraY] } });
      composite.set({ paperView: { logicalSize: [options.width, options.height] } });
      const viewKey = [size[0], size[1], options.width, options.height, options.zoom, options.cameraX, options.cameraY].join(":");
      const repaint = changed || paintedView !== viewKey;
      frame(gpu, current => {
        if (changed && commandCount) current.computePass(pass => pass.dispatch(generator, Math.ceil(commandCount / 64)));
        if (repaint) current.pass(layer, pass => pass.draw(ink, { instances: commandCount }));
        current.pass(output, composite);
      });
      paintedView = viewKey;
    }

    async function finished() {
      await gpu.settled();
      if (failure) throw failure.error;
    }

    draw(options);
    await finished();
    if (failure) throw failure.error;
    publishFailure = onFailure;
    return { draw, finished, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
