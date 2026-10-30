import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

test('failed painting allocations and completion fences release all provisional buffers', async () => {
  const result = await build({ entryPoints: ['src/gpu/generation.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'controlled-device', setup(b) {
      b.onResolve({ filter: /^vgpu$/ }, () => ({ path: 'vgpu', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export function compute() { return {compile:async()=>{},set(){},dispose(){}}; }
        export function frame(gpu, run) { run({computePass:run=>run({dispatch(){}})}); }` }));
      b.onLoad({ filter: /\.wgsl$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
    }}] });
  const { createGenerator } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  const oldUsage = globalThis.GPUBufferUsage, oldMode = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = { STORAGE:128, COPY_SRC:4, COPY_DST:8, MAP_READ:1 };
  globalThis.GPUMapMode = { READ:1 };
  try {
    for (const failure of ['GPU brush vertices', 'GPU brush bounds', 'fence']) {
      const live = new Set(); let failing = true, reads = 0;
      const gpu = { gpu: { limits: { maxStorageBufferBindingSize: 128*1024*1024 },
        createBuffer({label,size}) {
          if (failing && label === failure) throw new RangeError('allocation limit');
          const buffer = {size, destroy(){live.delete(buffer);}, async mapAsync(){}, unmap(){},
            getMappedRange(){return new Uint32Array([[1,1,1,0],[1,1,2,0],[2,8,0,0]][reads++ % 3]).buffer;} };
          live.add(buffer); return buffer;
        }, queue:{writeBuffer(){},submit(){}},
        createCommandEncoder(){return {copyBufferToBuffer(){},finish(){return {};}};},
      }, async settled(){ if(failing && failure==='fence') throw new Error('completion failed'); } };
      const generator = await createGenerator(gpu), baseline = live.size;
      const options = {seed:'retry',cameraX:0,width:320,zoom:1};
      for(let attempt=0;attempt<3;attempt++) {
        await assert.rejects(generator.generate(options));
        assert.equal(live.size,baseline,`${failure}: retained buffers after failed attempt ${attempt}`);
      }
      failing=false;
      const painting=await generator.generate(options);
      assert.equal(await generator.generate(options),painting);
      assert.equal(live.size,baseline+3);
      generator.dispose(); assert.equal(live.size,0);
    }
  } finally {
    if(oldUsage===undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage=oldUsage;
    if(oldMode===undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode=oldMode;
  }
});
