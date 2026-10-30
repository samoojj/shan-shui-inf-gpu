import { fileURLToPath } from 'node:url';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';

export async function shader(name) {
  const entry = fileURLToPath(new URL(`../../src/shaders/${name}.wgsl`, import.meta.url));
  return prepareShader(await resolveShader({ entry, validate: 'off' }), entry);
}

/** Use the same packing and compute entry as the library; native compile must succeed. */
export async function generatePaths(gpu, packed, table) {
  function upload(data) {
    const buffer = storage(gpu, data.byteLength, 'read');
    buffer.write(data);
    return buffer;
  }
  const jobs = upload(packed.jobs);
  const inputData = upload(packed.inputData);
  const noiseTable = upload(Float32Array.from(table));
  const points = storage(gpu, packed.pointCount * 8);
  const bounds = storage(gpu, packed.commandCount * 16);
  const brushes = compute(gpu, await shader('brushes'), { set: { jobs, inputData, noiseTable, points, bounds } });
  try {
    await brushes.compile();
    brushes.dispatch(Math.ceil(packed.commandCount / 64));
    await gpu.settled();
    return { jobs, points, bounds };
  } finally {
    brushes.dispose();
  }
}
