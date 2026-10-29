import assert from 'node:assert/strict';

/** Every scenario owns its page, canvas, renderer, instrumentation, and teardown. */
export async function runScenario(browser, baseURL, scenario) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Keep the library origin without running the example application.
    await page.goto(`${baseURL}/dist/index.js`);
    await page.setContent('<canvas id="test" width="320" height="256"></canvas>');
    await page.evaluate(async ({ createRenderer, observeGPU }) => {
      const api = await import('/dist/index.js');
      const canvas = document.querySelector('#test');
      const readPixels = WebGL2RenderingContext.prototype.readPixels;
      const require = (condition, message) => { if (!condition) throw new Error(message); };
      const hash = bytes => {
        let value = 2166136261;
        for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
        return value >>> 0;
      };
      const pixels = () => {
        const gl = canvas.getContext('webgl2');
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        // Test-only readback is deliberately outside renderer instrumentation.
        readPixels.call(gl, 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        require(gl.getError() === gl.NO_ERROR, 'Unexpected WebGL error');
        return bytes;
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
      const test = window.test = { api, canvas, require, hash, pixels, decodePNG, renderer: null, initial: null, gpu: null };
      if (observeGPU) {
        const prototype = WebGL2RenderingContext.prototype;
        const names = ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'readPixels', 'drawArrays', 'createProgram', 'deleteProgram', 'createShader', 'deleteShader', 'createVertexArray', 'deleteVertexArray'];
        const originals = {}, counters = {}, resources = { shaders: [], programs: [], arrays: [] };
        const resourceKinds = { createShader: 'shaders', createProgram: 'programs', createVertexArray: 'arrays' };
        for (const name of names) {
          originals[name] = prototype[name];
          counters[name] = 0;
          prototype[name] = function (...args) {
            counters[name]++;
            const result = originals[name].apply(this, args);
            if (resourceKinds[name] && result) resources[resourceKinds[name]].push(result);
            return result;
          };
        }
        test.gpu = { counters, resources, restore() { for (const name of names) prototype[name] = originals[name]; } };
      }
      if (createRenderer) {
        test.renderer = api.createLandscape(canvas, { seed: 'browser-validation', width: 320, height: 256 });
        test.initial = pixels();
      }
    }, { createRenderer: scenario.createRenderer !== false, observeGPU: !!scenario.observeGPU });
    await scenario.run({ page, baseURL });
    await page.evaluate(() => {
      window.test?.renderer?.dispose();
      window.test?.gpu?.restore();
    });
    assert.deepEqual(errors, [], `Unhandled browser errors in: ${scenario.name}`);
  } finally {
    // Closing a failed scenario also drops its context, event listeners, and method patches.
    await page.close();
  }
}
