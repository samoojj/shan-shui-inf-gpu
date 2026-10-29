import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { init } from 'vgpu/node';
import { loadSource } from './helpers/load-source.mjs';
import { gpuFixtures } from './gpu/fixtures.mjs';
import { checkCoordinates } from './gpu/coordinates.mjs';
import { checkNoise } from './gpu/noise.mjs';
import { checkRaster } from './gpu/raster.mjs';

const directory = new URL('../test-results/gpu-primitives/', import.meta.url);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const fixture = await gpuFixtures();
const { packDrawing } = await loadSource('src/scene/pack.ts');
// Compatibility adapters default storage access in vertex/fragment stages to zero.
const gpu = await init({ requiredLimits: { maxStorageBuffersInVertexStage: 2, maxStorageBuffersInFragmentStage: 2 } });
const errors = [];
gpu.onError(error => errors.push(error.message));
try {
  const info = gpu.device.adapterInfo;
  const adapter = { vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description };
  const software = /llvmpipe|lavapipe|swiftshader|software|warp/i.test(Object.values(adapter).join(' '));
  const report = {
    adapter,
    execution: software ? 'software WebGPU; correctness checks only' : 'WebGPU; adapter performance is not measured',
    noise: await checkNoise(gpu, fixture),
    coordinates: await checkCoordinates(gpu, fixture, packDrawing),
    raster: await checkRaster(gpu, packDrawing, directory),
  };
  await gpu.settled();
  assert.deepEqual(errors, [], 'Native GPU errors were reported');
  await writeFile(new URL('report.json', directory), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ execution: report.execution, noiseSamples: report.noise.samples,
    primitiveCases: report.coordinates.cases.length, generatedPoints: report.coordinates.pointCount,
    maxCoordinateError: report.coordinates.maxError, artifacts: directory.pathname }, null, 2));
} finally {
  gpu.dispose();
}
