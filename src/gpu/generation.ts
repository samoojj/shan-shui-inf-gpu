import { compute, frame } from "vgpu";
import type { Compute, Gpu } from "vgpu";
import type { LandscapeOptions } from "../options.js";
import initializeShader from "../shaders/initialize.wgsl";
import planningShader from "../shaders/plan.wgsl";
import parentAllocationShader from "../shaders/allocate-parents.wgsl";
import terrainShader from "../shaders/construct-terrain.wgsl";
import childAllocationShader from "../shaders/allocate-children.wgsl";
import treeShader from "../shaders/construct-trees.wgsl";
import buildingsShader from "../shaders/construct-buildings.wgsl";
import boatsShader from "../shaders/construct-boats.wgsl";
import waterShader from "../shaders/construct-water.wgsl";
import hutsShader from "../shaders/construct-huts.wgsl";
import towersShader from "../shaders/construct-towers.wgsl";
import rockShader from "../shaders/construct-rocks.wgsl";
import countingShader from "../shaders/count-brushes.wgsl";
import compactionShader from "../shaders/compact-brushes.wgsl";
import brushShader from "../shaders/brushes.wgsl";

const CHUNK_WIDTH = 512;
const OBJECT_BYTES = 80;
const BRUSH_BYTES = 128;
const CONTROL_BYTES = 16;
const MAX_LIVE_BYTES = 512 * 1024 * 1024;

/** Only seed identity and view bounds cross from the host into construction. */
export function seedHash(seed: string | number): number {
  let hash = 2166136261;
  for (const character of String(seed)) {
    const codePoint = character.codePointAt(0)!;
    hash = Math.imul(hash ^ codePoint, 16777619);
  }
  return hash >>> 0;
}

export interface Painting {
  readonly jobs: GPUBuffer;
  readonly points: GPUBuffer;
  readonly bounds: GPUBuffer;
  readonly commandCount: number;
}

/** Owns generation pipelines, bounded scene storage, and GPU allocation fences. */
export async function createGenerator(gpu: Gpu) {
  const native = gpu.gpu;
  const resources = new Set<GPUBuffer>();
  let liveBytes = 0;
  let disposed = false;
  function allocate(label: string, bytes: number): GPUBuffer {
    const size = Math.max(16, bytes);
    if (size > native.limits.maxStorageBufferBindingSize || liveBytes + size > MAX_LIVE_BYTES) {
      throw new RangeError(`Landscape generation exceeds the GPU memory budget (${label}: ${size} bytes). Use a narrower view or another seed.`);
    }
    const buffer = native.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    resources.add(buffer); liveBytes += size;
    return buffer;
  }
  function release(buffer: GPUBuffer) {
    if (resources.delete(buffer)) { liveBytes -= buffer.size; buffer.destroy(); }
  }
  const pipelines = {
    initialize: compute(gpu, initializeShader, { label: "seeded noise and paper" }),
    plan: compute(gpu, planningShader, { label: "landscape planning" }),
    allocateParents: compute(gpu, parentAllocationShader, { label: "terrain ordering and allocation" }),
    terrain: compute(gpu, terrainShader, { label: "terrain and decoration descriptions" }),
    allocateChildren: compute(gpu, childAllocationShader, { label: "decoration allocation" }),
    trees: compute(gpu, treeShader, { label: "branch and foliage construction" }),
    buildings: compute(gpu, buildingsShader, { label: "buildings construction" }),
    boats: compute(gpu, boatsShader, { label: "boats construction" }),
    water: compute(gpu, waterShader, { label: "water construction" }),
    huts: compute(gpu, hutsShader, { label: "huts construction" }),
    towers: compute(gpu, towersShader, { label: "towers construction" }),
    rocks: compute(gpu, rockShader, { label: "rock contour construction" }),
    count: compute(gpu, countingShader, { label: "ordered brush allocation" }),
    compact: compute(gpu, compactionShader, { label: "expand painter placeholders" }),
    brushes: compute(gpu, brushShader, { label: "brush expansion and bounds" }),
  };
  const summary = allocate("allocation summary", 16);
  const readback = native.createBuffer({ label: "16-byte allocation readback", size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const noiseTable = allocate("seeded Perlin table", 4096 * 4);
  const paperRandom = allocate("seeded paper decisions", 257 * 257 * 4);
  let current: Painting | undefined;
  let currentKey = "";
  let currentSeed: number | undefined;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pipeline of Object.values(pipelines)) pipeline.dispose();
    for (const buffer of resources) buffer.destroy();
    resources.clear(); liveBytes = 0;
    readback.destroy();
  }
  function dispatch(pipeline: Compute, count: number) {
    if (count > 0) frame(gpu, current => current.computePass(pass => pass.dispatch(pipeline, count)));
  }
  async function allocationCounts(stage: string): Promise<Uint32Array> {
    const encoder = native.createCommandEncoder({ label: `${stage} allocation fence` });
    encoder.copyBufferToBuffer(summary, 0, readback, 0, 16);
    native.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const counts = new Uint32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    if (counts[3] !== 0) throw new RangeError(`Landscape ${stage} exceeded a GPU construction arena. No partial frame was rendered.`);
    if (disposed) throw new Error("Landscape generator has been disposed.");
    return counts;
  }

  const compilationStarted = performance.now();
  try { await Promise.all(Object.values(pipelines).map(pipeline => pipeline.compile())); }
  catch (error) { dispose(); throw error; }
  performance.clearMeasures("landscape:construction-compile");
  performance.measure("landscape:construction-compile", { start: compilationStarted, end: performance.now() });

  async function generate(options: Readonly<LandscapeOptions>): Promise<Painting> {
    if (disposed) throw new Error("Landscape generator has been disposed.");
    const seed = seedHash(options.seed);
    const firstChunk = Math.floor(options.cameraX / CHUNK_WIDTH) - 3;
    const lastChunk = Math.ceil((options.cameraX + options.width / options.zoom) / CHUNK_WIDTH) + 3;
    const chunkCount = lastChunk - firstChunk;
    const key = `${seed}:${firstChunk}:${lastChunk}`;
    if (current && currentKey === key) return current;
    const constructionStarted = performance.now();
    if (current) { release(current.jobs); release(current.points); release(current.bounds); current = undefined; }
    const scratch: GPUBuffer[] = [];
    const temporary = (label: string, bytes: number) => {
      const buffer = allocate(label, bytes); scratch.push(buffer); return buffer;
    };
    try {
      if (currentSeed !== seed) {
        pipelines.initialize.set({ seed: { value: seed }, noiseTable, paperRandom });
        dispatch(pipelines.initialize, Math.ceil(257 * 257 / 64));
        currentSeed = seed;
      }
      // Fixed candidate slots are sparse planning scratch, not CPU-authored objects.
      const candidates = temporary("chunk candidates", chunkCount * 128 * OBJECT_BYTES);
      const objects = temporary("ordered terrain descriptions", candidates.size);
      native.queue.writeBuffer(summary, 0, new Uint32Array(4));
      pipelines.plan.set({ planning: { seed, firstChunk, chunkCount, padding: 0 }, noiseTable, candidates, overflow: summary });
      pipelines.allocateParents.set({ candidates, objects, summary });
      dispatch(pipelines.plan, chunkCount);
      dispatch(pipelines.allocateParents, 1);
      const [parentCount, parentCommands, parentControls] = await allocationCounts("planning");
      const parentJobs = temporary("terrain brush arenas", Math.max(1, parentCommands) * BRUSH_BYTES);
      const parentData = temporary("terrain control arenas", parentControls * CONTROL_BYTES);
      const parentCounts = temporary("terrain counts", parentCount * 16);
      const children = temporary("decoration descriptions", Math.max(1, parentCount) * 1024 * OBJECT_BYTES);
      const childQueue = temporary("decoration queue count", 16);
      pipelines.terrain.set({ objects, noiseTable, constructionJobs: parentJobs, constructionControls: parentData, objectCounts: parentCounts, children, childQueue });
      dispatch(pipelines.terrain, parentCount);
      pipelines.allocateChildren.set({ allocation: { parentControls }, children, childQueue, parentCounts, summary });
      dispatch(pipelines.allocateChildren, 1);
      const [childCount, childCommands, allControls] = await allocationCounts("terrain");
      const childJobs = temporary("decoration brush arenas", Math.max(1, childCommands) * BRUSH_BYTES);
      const inputData = temporary("GPU construction control points", allControls * CONTROL_BYTES);
      const childCounts = temporary("decoration counts", childCount * 16);
      const copy = native.createCommandEncoder({ label: "retain terrain controls" });
      copy.copyBufferToBuffer(parentData, 0, inputData, 0, parentData.size);
      native.queue.submit([copy.finish()]);
      for (const pipeline of [pipelines.trees, pipelines.buildings, pipelines.boats, pipelines.water, pipelines.huts, pipelines.towers, pipelines.rocks]) {
        pipeline.set({ children, noiseTable, constructionJobs: childJobs, constructionControls: inputData, childCounts });
        dispatch(pipeline, childCount);
      }
      const offsets = temporary("painter prefix offsets", parentCount * 8);
      pipelines.count.set({ objects, parentCounts, childCounts, parentJobs, offsets, summary });
      dispatch(pipelines.count, 1);
      const [commandCount, pointCount] = await allocationCounts("decoration");
      const jobs = allocate("ordered GPU brushes", Math.max(1, commandCount) * BRUSH_BYTES);
      const points = allocate("GPU brush vertices", pointCount * 8);
      const bounds = allocate("GPU brush bounds", commandCount * 16);
      pipelines.compact.set({ objects, children, parentCounts, childCounts, parentJobs, childJobs, offsets, jobs });
      pipelines.brushes.set({ jobs, inputData, noiseTable, points, bounds });
      dispatch(pipelines.compact, parentCount);
      dispatch(pipelines.brushes, Math.ceil(commandCount / 64));
      await gpu.settled();
      current = { jobs, points, bounds, commandCount }; currentKey = key;
      performance.clearMeasures("landscape:construction");
      performance.measure("landscape:construction", { start: constructionStarted, end: performance.now() });
      return current;
    } finally { for (const buffer of scratch) release(buffer); }
  }
  return { generate, noiseTable, paperRandom, dispose };
}
