import assert from 'node:assert/strict';

/** Every scenario owns its page, canvas, renderer, instrumentation, and teardown. */
export async function runScenario(browser, baseURL, scenario) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${baseURL}/dist/index.js`);
    await page.setContent('<canvas id="test" width="320" height="256"></canvas>');
    await page.evaluate(async ({ createRenderer, observeGPU }) => {
      const api = await import('/dist/index.js');
      const canvas = document.querySelector('#test');
      const require = (condition, message) => { if (!condition) throw new Error(message); };
      require(!!navigator.gpu, 'WebGPU is unavailable; use a WebGPU-capable browser on localhost or HTTPS.');
      const hash = bytes => {
        let value = 2166136261;
        for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
        return value >>> 0;
      };
      const decodePNG = async blob => {
        const bitmap = await createImageBitmap(blob);
        try {
          const decoded = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = decoded.getContext('2d');
          context.drawImage(bitmap, 0, 0);
          return { width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
        } finally { bitmap.close(); }
      };
      const restores = [];
      const gpu = { devices: [], adapterInfo: [], errors: [], counters: {}, writes: [], draws: [], buffers: [], destroyedDevices: new Set(), destroyedBuffers: new Set(), restore() { for (const restore of restores.reverse()) restore(); } };
      const wrap = (prototype, name, replacement) => {
        const original = prototype[name];
        prototype[name] = replacement(original);
        restores.push(() => { prototype[name] = original; });
      };
      wrap(GPUAdapter.prototype, 'requestDevice', original => async function (...args) {
        const device = await original.apply(this, args);
        gpu.devices.push(device);
        gpu.adapterInfo.push({ vendor: this.info.vendor, architecture: this.info.architecture, description: this.info.description });
        device.addEventListener('uncapturederror', event => gpu.errors.push(event.error.message));
        return device;
      });
      if (observeGPU) {
        const watch = (prototype, name) => {
          gpu.counters[name] = 0;
          wrap(prototype, name, original => function (...args) {
            gpu.counters[name]++;
            const result = original.apply(this, args);
            if (name === 'createBuffer') gpu.buffers.push({ buffer: result, device: this, usage: args[0].usage });
            if (name === 'writeBuffer') {
              const data = args[2];
              gpu.writes.push(args[4] === undefined ? data.byteLength : args[4] * (data.BYTES_PER_ELEMENT || 1));
            }
            if (name === 'draw') gpu.draws.push(args);
            return result;
          });
        };
        for (const name of ['createBuffer', 'createTexture', 'createRenderPipelineAsync']) watch(GPUDevice.prototype, name);
        for (const name of ['submit', 'writeBuffer', 'writeTexture', 'copyExternalImageToTexture']) watch(GPUQueue.prototype, name);
        watch(GPURenderPassEncoder.prototype, 'draw');
        watch(GPUCommandEncoder.prototype, 'copyTextureToBuffer');
        watch(GPUBuffer.prototype, 'mapAsync');
        wrap(GPUDevice.prototype, 'destroy', original => function (...args) { gpu.destroyedDevices.add(this); return original.apply(this, args); });
        wrap(GPUBuffer.prototype, 'destroy', original => function (...args) { gpu.destroyedBuffers.add(this); return original.apply(this, args); });
      }
      const test = window.test = { api, canvas, require, hash, decodePNG, renderer: null, initial: null, gpu };
      test.pixels = async () => (await decodePNG((await test.renderer.capture()).blob)).pixels;
      if (createRenderer) {
        test.renderer = await api.createLandscape(canvas, { seed: 'browser-validation', width: 320, height: 256 });
        test.initial = await test.pixels();
      }
    }, { createRenderer: scenario.createRenderer !== false, observeGPU: !!scenario.observeGPU });
    await scenario.run({ page, baseURL });
    const gpuErrors = await page.evaluate(() => {
      window.test?.renderer?.dispose();
      window.test?.gpu?.restore();
      return window.test?.gpu?.errors ?? [];
    });
    assert.deepEqual(errors, [], `Unhandled browser errors in: ${scenario.name}`);
    const expectedGPUErrors = scenario.expectedGPUErrors ?? [];
    assert.equal(gpuErrors.length, expectedGPUErrors.length, `Unexpected WebGPU errors in: ${scenario.name}: ${gpuErrors.join('; ')}`);
    for (const [index, expected] of expectedGPUErrors.entries()) assert.match(gpuErrors[index], expected);
  } finally {
    await page.close();
  }
}
