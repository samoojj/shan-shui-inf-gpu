import assert from 'node:assert/strict';

export const captureScenarios = [
  {
    name: 'capture redraws after a browser task and preserves image settings while the scene changes',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.renderer.render({ seed: 'captured-scene', width: 192, height: 144, cameraY: 160 });
      const expected = await t.pixels();
      // Capture must redraw the requested scene after presentation has occurred.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const pending = t.renderer.capture();
      t.renderer.render({ seed: 'newer-scene', width: 160, height: 100 });
      const frame = await pending;
      t.require(frame.blob.type === 'image/png', 'Capture must return a PNG');
      t.require(frame.options.seed === 'captured-scene', 'Capture metadata followed a later render');
      t.require(frame.width === 48 && frame.height === 36, 'Capture dimensions followed a later resize');
      t.require(frame.options.width === 192 && frame.options.height === 144, 'Capture lost its logical dimensions');
      t.require(t.renderer.getOptions().seed === 'newer-scene', 'Capture changed the current scene');
      const decoded = await t.decodePNG(frame.blob);
      t.require(decoded.width === frame.width && decoded.height === frame.height, 'PNG dimensions disagree with capture metadata');
      const { meanAbsoluteChannelError } = t.comparePixels(expected, decoded.pixels);
      t.require(meanAbsoluteChannelError < 0.1, `Captured PNG does not represent the requested scene: mean byte difference ${meanAbsoluteChannelError}`);
    }),
  },
  {
    name: 'invalid capture options are atomic and an already-started capture survives disposal',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const before = JSON.stringify(t.renderer.getOptions());
      await t.rejects(() => t.renderer.capture({ seed: 'invalid-patch', zoom: 0 }), 'Invalid capture options must reject');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Invalid capture partially changed settings');
      const pending = t.renderer.capture({ seed: 'before-disposal', cameraY: 160 });
      t.renderer.dispose();
      const frame = await pending;
      t.require(t.renderer.getStatus() === 'disposed', 'Capture revived a disposed renderer');
      t.require(frame.options.seed === 'before-disposal', 'Capture lost its settings snapshot');
      const decoded = await t.decodePNG(frame.blob);
      const { min, max } = t.pixelRange(decoded.pixels);
      t.require(max - min > 30, 'Capture became blank after disposal');
      await t.rejects(() => t.renderer.capture(), 'A disposed renderer must reject new captures');
    }),
  },
  {
    name: 'capture reports native device loss and failed PNG encoding through rejected promises',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const original = t.canvas.toBlob;
      try {
        t.canvas.toBlob = callback => callback(null);
        await t.rejects(() => t.renderer.capture(), 'A null encoding result must reject capture');
        t.require(t.renderer.getStatus() === 'ready', 'An encoding failure must not poison the renderer');
      } finally { t.canvas.toBlob = original; }
      const device = t.gpu.devices.at(-1);
      t.require(!!device, 'Device-loss test requires the renderer’s native GPUDevice');
      const lost = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Renderer did not report native device loss')), 10000);
        let unsubscribe = () => {};
        unsubscribe = t.renderer.subscribe(state => {
          if (state.status !== 'device-lost') return;
          clearTimeout(timer); unsubscribe(); resolve();
        });
      });
      device.destroy();
      await lost;
      const before = JSON.stringify(t.renderer.getOptions());
      await t.rejects(() => t.renderer.capture({ seed: 'must-not-apply' }), 'A lost device must reject capture');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'A rejected capture changed the lost scene');
    }),
  },
  {
    name: 'capture rejects an asynchronous native draw failure even when PNG encoding succeeds',
    observeGPU: true,
    expectedGPUErrors: [/Deliberate capture draw failure/],
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const validPNG = (await t.renderer.capture()).blob;
      t.require(validPNG.type === 'image/png' && validPNG.size > 0, 'Failure injection requires a valid PNG');
      const device = t.gpu.devices.at(-1);
      const queue = device.queue;
      const submit = queue.submit;
      const toBlob = t.canvas.toBlob;
      const states = [];
      const unsubscribe = t.renderer.subscribe(state => states.push(state.status));
      let finishPNG;
      let completeErrorDelivery;
      const errorDelivered = new Promise(resolve => { completeErrorDelivery = resolve; });
      try {
        t.canvas.toBlob = callback => { finishPNG = () => callback(validPNG); };
        queue.submit = function (...args) {
          const result = submit.apply(this, args);
          queueMicrotask(() => {
            device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', {
              error: new GPUValidationError('Deliberate capture draw failure'),
            }));
            completeErrorDelivery();
          });
          return result;
        };
        // Observe rejection immediately, even if the error arrives before encoding finishes.
        const outcome = t.renderer.capture().then(() => ({ succeeded: true }), error => ({ error }));
        await errorDelivered;
        t.require(typeof finishPNG === 'function', 'Capture did not start its PNG encoder');
        finishPNG();
        const result = await outcome;
        t.require(states.join(',') === 'ready,error', `Draw failure emitted incorrect states: ${states}`);
        t.require(t.renderer.getStatus() === 'error', 'Native draw failure did not terminate renderer readiness');
        t.require(result.error instanceof Error, 'Capture resolved a PNG after its native draw failed');
        t.require(/Deliberate capture draw failure/.test(result.error.message), 'Capture lost the native failure reason');
      } finally {
        queue.submit = submit;
        t.canvas.toBlob = toBlob;
        unsubscribe();
      }
    }),
  },
  {
    name: 'OffscreenCanvas captures a nonblank PNG and immutable scene settings in a module worker',
    run: async ({ page, baseURL }) => {
      const result = await page.evaluate(async origin => {
        const worker = new Worker(`${origin}/tests/browser/capture-worker.mjs`, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker capture timed out')), 120000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            const canvas = new OffscreenCanvas(128, 96);
            worker.postMessage({ canvas }, [canvas]);
          });
        } finally { worker.terminate(); }
      }, baseURL);
      assert.equal(result.failure, undefined, result.failure);
      assert.equal(result.type, 'image/png');
      assert.equal(result.seed, 'worker-capture');
      assert.equal(result.currentSeed, 'worker-next');
      assert.equal(result.width, 32);
      assert.equal(result.height, 24);
      assert.equal(result.logicalWidth, 128);
      assert.equal(result.logicalHeight, 96);
      assert(result.max - result.min > 30, JSON.stringify(result));
      assert(result.meanDifference < 0.1, JSON.stringify(result));
    },
  },
];
