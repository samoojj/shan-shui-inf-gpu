import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { serve } from '../scripts/serve.mjs';

// These are rendering correctness tests, not a hardware-GPU performance benchmark.
const server = serve(0);
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // A module document supplies the same origin without executing the example.
  await page.goto(`${baseURL}/dist/index.js`);
  await page.setContent('<canvas id="test" width="320" height="256"></canvas>');
  await page.evaluate(async () => {
    const api = await import('/dist/index.js');
    window.api = api;
    window.canvas = document.querySelector('#test');
    const prototype = WebGL2RenderingContext.prototype;
    const counters = window.counters = {};
    const watched = ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'readPixels', 'drawArrays', 'createProgram', 'deleteProgram', 'createShader', 'deleteShader', 'createVertexArray', 'deleteVertexArray'];
    window.testReadPixels = prototype.readPixels;
    for (const name of watched) {
      counters[name] = 0;
      const original = prototype[name];
      prototype[name] = function (...args) { counters[name]++; return original.apply(this, args); };
    }
    window.require = (condition, message) => { if (!condition) throw new Error(message); };
    window.snapshot = () => {
      const gl = canvas.getContext('webgl2');
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      testReadPixels.call(gl, 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      require(gl.getError() === gl.NO_ERROR, 'Unexpected WebGL error');
      return bytes;
    };
    window.hashPixels = bytes => {
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    };
    window.landscape = api.createLandscape(canvas, { seed: 'browser-validation', width: 320, height: 256 });
    window.original = snapshot();
  });

  await check('real WebGL2 shaders compile and produce an opaque, nonblank landscape', async () => {
    const info = await page.evaluate(() => {
      let min = 255, max = 0;
      for (let i = 0; i < original.length; i += 4) {
        min = Math.min(min, original[i]); max = Math.max(max, original[i]);
        require(original[i + 3] === 255, 'Output must be opaque');
      }
      const gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { min, max, status: landscape.getStatus(), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    assert.equal(info.status, 'ready');
    assert(info.max - info.min > 30, JSON.stringify(info));
    console.log(`Renderer: ${info.renderer}`);
  });

  await check('seed changes affect pixels and repeat renders reproduce the original exactly', () => page.evaluate(() => {
    const originalHash = hashPixels(original);
    const hashes = new Set([originalHash]);
    for (const seed of ['another-seed', '山水', 12345678]) {
      landscape.render({ seed });
      hashes.add(hashPixels(snapshot()));
    }
    require(hashes.size === 4, 'Distinct seeds must produce distinct images');
    landscape.render({ seed: 'browser-validation' });
    require(hashPixels(snapshot()) === originalHash, 'Restored seed changed pixels');
    landscape.render();
    require(hashPixels(snapshot()) === originalHash, 'Identical repeated render changed pixels');
  }));

  await check('panning away and back is order-independent, including negative world coordinates', () => page.evaluate(() => {
    for (const cameraX of [-4000, 7000, -450, 0]) landscape.render({ cameraX });
    require(hashPixels(snapshot()) === hashPixels(original), 'Pan order changed the world');
    landscape.render({ cameraX: -600 });
    const negative = hashPixels(snapshot());
    landscape.render({ cameraX: 20000 });
    landscape.render({ cameraX: -600 });
    require(hashPixels(snapshot()) === negative, 'Negative world is not stable');
  }));

  await check('overlapping viewports show the same world across positive and negative cell boundaries', async () => {
    const comparisons = await page.evaluate(() => {
      const results = [];
      for (const start of [-625.125, 113.125]) {
        landscape.render({ cameraX: start });
        const left = snapshot();
        // 80 pixels at 1000 world units / 256 vertical pixels = 312.5 units.
        landscape.render({ cameraX: start + 312.5 });
        const right = snapshot();
        let total = 0, large = 0, count = 0;
        for (let y = 0; y < 256; y++) for (let x = 0; x < 240; x++) for (let c = 0; c < 3; c++) {
          const delta = Math.abs(left[(y * 320 + x + 80) * 4 + c] - right[(y * 320 + x) * 4 + c]);
          total += delta; large += Number(delta > 8); count++;
        }
        results.push({ start, average: total / count, largeFraction: large / count });
      }
      return results;
    });
    for (const value of comparisons) {
      assert(value.average < 0.5, JSON.stringify(value));
      assert(value.largeFraction < 0.005, JSON.stringify(value));
    }
  });

  await check('resize, partial settings and invalid updates preserve renderer state correctly', () => page.evaluate(() => {
    landscape.render({ seed: 'resize-seed', mist: 0.6, cameraX: -200 });
    landscape.resize(240, 180, 1.5);
    require(canvas.width === 360 && canvas.height === 270, 'Wrong backing dimensions');
    const before = landscape.getOptions();
    require(before.seed === 'resize-seed' && before.cameraX === -200 && before.mist === 0.6, 'Resize reset scene options');
    const hash = hashPixels(snapshot());
    let failed = false;
    try { landscape.render({ seed: 'should-not-apply', layers: 100 }); } catch { failed = true; }
    require(failed, 'Invalid render did not throw');
    require(JSON.stringify(before) === JSON.stringify(landscape.getOptions()), 'Invalid render partially mutated options');
    landscape.render();
    require(hashPixels(snapshot()) === hash, 'Invalid render changed the image');
    const copy = landscape.getOptions();
    copy.paper[0] = 0; copy.ink[1] = 1; copy.seed = 'mutated-copy';
    require(JSON.stringify(before) === JSON.stringify(landscape.getOptions()), 'getOptions leaks mutable state');
  }));

  await check('normal rendering uploads no CPU geometry or textures and reads back no pixels', () => page.evaluate(() => {
    for (const name of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'readPixels']) {
      require(counters[name] === 0, `Unexpected ${name} call in renderer`);
    }
    const before = counters.drawArrays;
    landscape.render({ cameraX: 111 });
    require(counters.drawArrays === before + 1, 'A render should issue one fullscreen draw');
  }));

  await check('context loss retains updates and restoration regenerates the same image', async () => {
    await page.evaluate(async () => {
      const gl = canvas.getContext('webgl2');
      window.lose = gl.getExtension('WEBGL_lose_context');
      require(!!lose, 'Context-loss test requires WEBGL_lose_context');
      landscape.render({ seed: 'restoration', cameraX: 300 });
      window.restorationHash = hashPixels(snapshot());
      const lost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      lose.loseContext();
      await lost;
      require(landscape.getStatus() === 'context-lost', 'Loss status not reported');
      landscape.render({ seed: 'temporary' });
      landscape.render({ seed: 'restoration', cameraX: 300 });
    });
    // A separate browser task allows the loss event to settle before restoration.
    await page.evaluate(() => lose.restoreContext());
    await page.waitForFunction(() => landscape.getStatus() === 'ready');
    await page.evaluate(() => {
      landscape.render();
      require(hashPixels(snapshot()) === restorationHash, 'Context restoration changed pixels');
    });
  });

  await check('dispose releases resources/listeners and supports repeated mount and unmount', () => page.evaluate(() => {
    const gl = canvas.getContext('webgl2');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    landscape.dispose();
    landscape.dispose();
    require(gl.getParameter(gl.CURRENT_PROGRAM) === null, 'Disposed program remains bound');
    require(!gl.isProgram(program), 'Disposed program remains alive');
    require(!gl.isVertexArray(vao), 'Disposed vertex array remains alive');
    require(landscape.getStatus() === 'disposed', 'Dispose status missing');
    let rejected = false;
    try { landscape.render(); } catch { rejected = true; }
    require(rejected, 'Disposed renderer accepted render');
    const old = landscape;
    const before = { ...counters };
    for (let i = 0; i < 3; i++) {
      const instance = api.createLandscape(canvas, { width: 200, height: 160, seed: 'remount' });
      let duplicate = false;
      try { api.createLandscape(canvas); } catch { duplicate = true; }
      require(duplicate, 'Two renderers claimed the same canvas');
      instance.dispose();
    }
    for (const [create, remove] of [['createProgram', 'deleteProgram'], ['createShader', 'deleteShader'], ['createVertexArray', 'deleteVertexArray']]) {
      require(counters[create] - before[create] === counters[remove] - before[remove], `${create} resources leaked`);
    }
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    require(old.getStatus() === 'disposed', 'Disposed instance retained context listeners');
  }));

  await check('a 2D-owned canvas reports an actionable unsupported-context error', () => page.evaluate(() => {
    const occupied = document.createElement('canvas');
    occupied.getContext('2d');
    let message = '';
    try { api.createLandscape(occupied); } catch (error) { message = error.message; }
    require(/WebGL2/.test(message), 'Missing context failure explanation');
  }));

  await check('OffscreenCanvas renders in a module worker without DOM access', async () => {
    const result = await page.evaluate(async baseURL => {
      const source = `import { createLandscape } from '${baseURL}/dist/index.js';
        self.onmessage = ({ data }) => {
          try {
            const landscape = createLandscape(data.canvas, { width: 128, height: 96, seed: 'worker' });
            const gl = data.canvas.getContext('webgl2');
            const pixels = new Uint8Array(128 * 96 * 4);
            gl.readPixels(0, 0, 128, 96, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let min = 255, max = 0;
            for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
            const error = gl.getError();
            landscape.dispose();
            self.postMessage({ min, max, error, status: landscape.getStatus() });
          } catch (error) { self.postMessage({ failure: error.message }); }
        };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker rendering timed out')), 20000);
          worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
          worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
          const canvas = new OffscreenCanvas(128, 96);
          worker.postMessage({ canvas }, [canvas]);
        });
      } finally { worker.terminate(); URL.revokeObjectURL(url); }
    }, baseURL);
    assert.equal(result.failure, undefined, result.failure);
    assert.equal(result.error, 0);
    assert.equal(result.status, 'disposed');
    assert(result.max - result.min > 30, JSON.stringify(result));
  });

  await check('example controls, keyboard pan, reset, PNG export and mobile layout work', async () => {
    await page.goto(`${baseURL}/examples/`);
    await page.waitForFunction(() => /Ready|Position/.test(document.querySelector('#status')?.textContent || ''));
    await page.getByLabel('Landscape seed', { exact: true }).fill('demo-check');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('demo-check'));
    await page.getByLabel('Mist', { exact: true }).fill('0.75');
    await page.waitForFunction(() => document.querySelector('#mist-value').value === '75%');
    await page.locator('#landscape').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Position 80'));
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Position 0'));
    const bounds = await page.locator('#landscape').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(() => /Position -\d+/.test(document.querySelector('#status').textContent));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    assert.match(download.suggestedFilename(), /demo-check.*\.png$/);
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await download.saveAs(new URL('../test-results/landscape.png', import.meta.url).pathname);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page overflows horizontally');
  });

  assert.deepEqual(errors, [], 'Unhandled browser errors');
  console.log(`Verified ${results.length} browser scenarios.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
