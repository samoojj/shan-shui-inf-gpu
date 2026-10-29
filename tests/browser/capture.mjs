import assert from 'node:assert/strict';

export const captureScenarios = [
  {
    name: 'capture redraws after a browser task and preserves image settings while the scene changes',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.renderer.render({ seed: 'captured-scene', width: 192, height: 144 });
      const expected = t.pixels();
      // Let the non-preserved framebuffer pass through presentation before capture.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const pending = t.renderer.capture();
      t.renderer.render({ seed: 'newer-scene', width: 160, height: 100 });
      const frame = await pending;
      t.require(frame.blob.type === 'image/png', 'Capture must return a PNG');
      t.require(frame.options.seed === 'captured-scene', 'Capture metadata followed a later render');
      t.require(frame.width === 192 && frame.height === 144, 'Capture dimensions followed a later resize');
      t.require(t.renderer.getOptions().seed === 'newer-scene', 'Capture changed the current scene');
      const decoded = await t.decodePNG(frame.blob);
      t.require(decoded.width === frame.width && decoded.height === frame.height, 'PNG dimensions disagree with capture metadata');
      let difference = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) for (let c = 0; c < 4; c++) {
        // WebGL readPixels starts at the bottom; decoded PNG pixels start at the top.
        difference += Math.abs(expected[((frame.height - y - 1) * frame.width + x) * 4 + c]
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
      try { await t.renderer.capture({ seed: 'invalid-patch', layers: 100 }); } catch { rejected = true; }
      t.require(rejected, 'Invalid capture options must reject');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Invalid capture partially changed settings');
      const pending = t.renderer.capture({ seed: 'before-disposal' });
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
    name: 'capture reports lost contexts and failed PNG encoding through rejected promises',
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
      const gl = t.canvas.getContext('webgl2');
      const extension = gl.getExtension('WEBGL_lose_context');
      t.require(!!extension, 'Context-loss test requires WEBGL_lose_context');
      const lost = new Promise(resolve => t.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      extension.loseContext();
      await lost;
      const before = JSON.stringify(t.renderer.getOptions());
      let rejected = false;
      try { await t.renderer.capture({ seed: 'must-not-apply' }); } catch { rejected = true; }
      t.require(rejected, 'A lost context must reject capture');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'A rejected capture changed the lost scene');
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
              landscape = createLandscape(data.canvas, { width: 128, height: 96, seed: 'worker-capture' });
              const gl = data.canvas.getContext('webgl2');
              const before = new Uint8Array(128 * 96 * 4);
              gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, before);
              await new Promise(resolve => setTimeout(resolve, 0));
              const pending = landscape.capture();
              landscape.render({ seed: 'worker-next' });
              const frame = await pending;
              const bitmap = await createImageBitmap(frame.blob);
              const decoded = new OffscreenCanvas(bitmap.width, bitmap.height);
              const context = decoded.getContext('2d');
              context.drawImage(bitmap, 0, 0); bitmap.close();
              const pixels = context.getImageData(0, 0, decoded.width, decoded.height).data;
              let difference = 0, min = 255, max = 0;
              for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) for (let c = 0; c < 4; c++) {
                difference += Math.abs(before[((95 - y) * 128 + x) * 4 + c] - pixels[(y * 128 + x) * 4 + c]);
              }
              for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
              self.postMessage({ min, max, error: gl.getError(), meanDifference: difference / before.length,
                type: frame.blob.type, width: frame.width, height: frame.height, seed: frame.options.seed,
                currentSeed: landscape.getOptions().seed });
            } catch (error) { self.postMessage({ failure: error.message }); }
            finally { landscape?.dispose(); }
          };`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker capture timed out')), 20000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            const canvas = new OffscreenCanvas(128, 96);
            worker.postMessage({ canvas }, [canvas]);
          });
        } finally { worker.terminate(); URL.revokeObjectURL(url); }
      }, baseURL);
      assert.equal(result.failure, undefined, result.failure);
      assert.equal(result.error, 0);
      assert.equal(result.type, 'image/png');
      assert.equal(result.seed, 'worker-capture');
      assert.equal(result.currentSeed, 'worker-next');
      assert.equal(result.width, 128);
      assert.equal(result.height, 96);
      assert(result.max - result.min > 30, JSON.stringify(result));
      assert(result.meanDifference < 0.1, JSON.stringify(result));
    },
  },
];
