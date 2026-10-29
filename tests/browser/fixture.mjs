import assert from 'node:assert/strict';
import { installWorkerHarness } from './worker-harness.mjs';

/** Every scenario owns its page, worker, canvas, renderer, and instrumentation. */
export async function runScenario(browser, baseURL, scenario) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(installWorkerHarness);
    await page.goto(`${baseURL}/dist/index.js`);
    await page.setContent('<canvas id="test" width="320" height="256"></canvas>');
    await page.evaluate(async createRenderer => {
      const api = await import('/dist/index.js');
      const require = (condition, message) => { if (!condition) throw new Error(message); };
      require(!!navigator.gpu, 'WebGPU is unavailable; use a WebGPU-capable browser on localhost or HTTPS.');
      const hash = bytes => {
        let value = 2166136261;
        for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
        return value >>> 0;
      };
      const support = await import('/tests/browser/support.mjs');
      const harness = window.workerHarness;
      const test = window.test = { api, canvas: document.querySelector('#test'), require, hash, ...support,
        renderer: null, initial: null, harness,
        inspect: () => harness.command('metrics'),
        command: (name, args) => harness.command(name, args),
        freshCanvas() {
          const replacement = document.createElement('canvas');
          replacement.width = 320; replacement.height = 256; replacement.id = 'test';
          test.canvas.replaceWith(replacement);
          test.canvas = replacement;
          return replacement;
        },
      };
      Object.defineProperty(test, 'gpu', { get: () => harness.current?.metrics });
      test.pixels = async () => (await test.decodePNG((await test.renderer.capture()).blob)).pixels;
      if (createRenderer) {
        test.renderer = await api.createLandscape(test.canvas, {
          seed: 'browser-validation', width: 320, height: 256, pixelRatio: 0.25, cameraY: 160,
        });
        test.afterCreate = await test.inspect();
        test.initial = await test.pixels();
      }
    }, scenario.createRenderer !== false);
    await scenario.run({ page, baseURL });
    const result = await page.evaluate(async () => {
      window.test?.renderer?.dispose();
      // Demo sessions are private; pagehide is the public example's teardown path.
      if (!window.test) window.dispatchEvent(new Event('pagehide'));
      await window.workerHarness.terminated();
      return { gpuErrors: window.workerHarness.workers.flatMap(worker => worker.metrics?.errors ?? []),
        mainGPU: window.workerHarness.mainGPU };
    });
    assert.deepEqual(errors, [], `Unhandled browser errors in: ${scenario.name}`);
    assert.deepEqual(result.mainGPU, { requestAdapter: 0, requestDevice: 0 }, 'Main thread acquired GPU resources');
    const expectedGPUErrors = scenario.expectedGPUErrors ?? [];
    assert.equal(result.gpuErrors.length, expectedGPUErrors.length,
      `Unexpected WebGPU errors in: ${scenario.name}: ${result.gpuErrors.join('; ')}`);
    for (const [index, expected] of expectedGPUErrors.entries()) assert.match(result.gpuErrors[index], expected);
  } finally { await page.close(); }
}
