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
      let difference = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) for (let c = 0; c < 4; c++) {
        difference += Math.abs(expected[(y * frame.width + x) * 4 + c]
          - decoded.pixels[(y * frame.width + x) * 4 + c]);
      }
      t.require(difference / expected.length < 0.1, `Captured PNG does not represent the requested scene: mean byte difference ${difference / expected.length}`);
    }),
  },
  {
    name: 'invalid capture options are atomic and an already-started capture survives disposal',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const before = JSON.stringify(t.renderer.getOptions());
      let rejected = false;
      try { await t.renderer.capture({ seed: 'invalid-patch', zoom: 0 }); } catch { rejected = true; }
      t.require(rejected, 'Invalid capture options must reject');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Invalid capture partially changed settings');
      const pending = t.renderer.capture({ seed: 'before-disposal', cameraY: 160 });
      t.renderer.dispose();
      const frame = await pending;
      t.require(t.renderer.getStatus() === 'disposed', 'Capture revived a disposed renderer');
      t.require(frame.options.seed === 'before-disposal', 'Capture lost its settings snapshot');
      const decoded = await t.decodePNG(frame.blob);
      let min = 255, max = 0;
      for (let i = 0; i < decoded.pixels.length; i += 4) {
        min = Math.min(min, decoded.pixels[i]); max = Math.max(max, decoded.pixels[i]);
      }
      t.require(max - min > 30, 'Capture became blank after disposal');
      rejected = false;
      try { await t.renderer.capture(); } catch { rejected = true; }
      t.require(rejected, 'A disposed renderer must reject new captures');
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
        let rejected = false;
        try { await t.renderer.capture(); } catch { rejected = true; }
        t.require(rejected, 'A null encoding result must reject capture');
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
      let rejected = false;
      try { await t.renderer.capture({ seed: 'must-not-apply' }); } catch { rejected = true; }
      t.require(rejected, 'A lost device must reject capture');
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
        const source = `import { createLandscape } from '${origin}/dist/index.js';
          self.onmessage = async ({ data }) => {
            let landscape;
            try {
              landscape = await createLandscape(data.canvas, { width: 128, height: 96, pixelRatio: 0.25, cameraY: 240, seed: 'worker-capture' });
              async function decode(blob) {
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext('2d');
                context.drawImage(bitmap, 0, 0); bitmap.close();
                return context.getImageData(0, 0, canvas.width, canvas.height).data;
              }
              const before = await decode((await landscape.capture()).blob);
              await new Promise(resolve => setTimeout(resolve, 0));
              const pending = landscape.capture();
              landscape.render({ seed: 'worker-next' });
              const frame = await pending;
              const pixels = await decode(frame.blob);
              let difference = 0, min = 255, max = 0;
              for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) for (let c = 0; c < 4; c++) {
                difference += Math.abs(before[(y * frame.width + x) * 4 + c] - pixels[(y * frame.width + x) * 4 + c]);
              }
              for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
              self.postMessage({ min, max, meanDifference: difference / before.length,
                type: frame.blob.type, width: frame.width, height: frame.height, seed: frame.options.seed,
                logicalWidth: frame.options.width, logicalHeight: frame.options.height,
                currentSeed: landscape.getOptions().seed });
            } catch (error) { self.postMessage({ failure: error.message }); }
            finally { landscape?.dispose(); }
          };`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker capture timed out')), 120000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            const canvas = new OffscreenCanvas(128, 96);
            worker.postMessage({ canvas }, [canvas]);
          });
        } finally { worker.terminate(); URL.revokeObjectURL(url); }
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
