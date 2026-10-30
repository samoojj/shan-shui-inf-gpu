import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { withBrowser } from '../tests/helpers/browser.mjs';
import { installWorkerHarness } from '../tests/browser/worker-harness.mjs';

// Whole landscapes now use independent GPU random streams. These paired images
// are a visual study, not a same-seed pixel-equality test. Fixed-parameter geometry
// acceptance against captured CPU results lives in npm run test:gpu.
const output = resolve('test-results/comparison');
await mkdir(output, { recursive: true });
const originalCommit = '9f754d2b2e73495db7883d4d4055a7b0903b0454';
const originalSource = execFileSync('git', ['show', `${originalCommit}:index.html`], { encoding: 'utf8' });
const cameraX = Number(process.env.LANDSCAPE_CAMERA_X || 0);
assert(Number.isFinite(cameraX), 'Invalid LANDSCAPE_CAMERA_X');
const results = [];
await withBrowser(async ({ browser, baseURL }) => {
  for (const seed of (process.env.LANDSCAPE_SEEDS || '1234').split(',')) {
    const filename = encodeURIComponent(seed);
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      // Render the pinned original for this seed and view, not a shared screenshot.
      const original = originalSource.replace('windx: 3000', 'windx: 1200')
        .replace('windy: 800', 'windy: 700').replace('cursx: 0', `cursx: ${cameraX}`)
        .replace('Math.seed(SEED);', () => `SEED = ${JSON.stringify(seed).replaceAll('<', '\\u003c')}; Math.seed(SEED);`)
        .replace('            present();', '');
      await page.route('**/original.html', route => route.fulfill({ contentType: 'text/html', body: original }));
      await page.goto(`${baseURL}/original.html`);
      await page.locator('#SVG').waitFor();
      const referenceOptions = await page.evaluate(() => ({ seed: SEED, cameraX: MEM.cursx, width: MEM.windx, height: MEM.windy }));
      assert.deepEqual(referenceOptions, { seed, cameraX, width: 1200, height: 700 }, 'Original reference settings differ');
      await page.addStyleTag({ content: '#SETTING, #SOURCE_BTN, #L, #R { visibility: hidden !important; }' });
      const reference = await page.locator('#SVG').screenshot();
      await writeFile(resolve(output, `original-${filename}.png`), reference);
      await page.addInitScript(installWorkerHarness);
      await page.goto(`${baseURL}/dist/index.js`);
      await page.setContent('<style>body{margin:0}</style><canvas width="1200" height="700"></canvas>');
      console.log(`Rendering GPU landscape ${seed} at 1200×700…`);
      const result = await page.evaluate(async ({ seed, cameraX }) => {
        const api = await import('/dist/index.js');
        const { decodePNG } = await import('/tests/browser/support.mjs');
        const intervals = []; let previous = performance.now();
        const heartbeat = setInterval(() => { const now = performance.now(); intervals.push(now - previous); previous = now; }, 10);
        const longTasks = [];
        const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
        observer.observe({ entryTypes: ['longtask'] });
        const start = performance.now();
        const renderer = await api.createLandscape(document.querySelector('canvas'), { seed, width: 1200, height: 700, cameraX });
        const firstFrameMs = performance.now() - start;
        clearInterval(heartbeat); observer.disconnect();
        try {
          const metrics = await window.workerHarness.command('metrics');
          const captured = await renderer.capture();
          const png = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(captured.blob); });
          const decoded = await decodePNG(captured.blob);
          let minimum = 255, maximum = 0;
          for (let index = 0; index < decoded.pixels.length; index += 4) {
            if (decoded.pixels[index + 3] !== 255) throw new Error('Landscape is not opaque');
            minimum = Math.min(minimum, decoded.pixels[index]); maximum = Math.max(maximum, decoded.pixels[index]);
          }
          if (maximum - minimum <= 30) throw new Error('Landscape is blank');
          await renderer.render();
          const repeated = await decodePNG((await renderer.capture()).blob);
          if (decoded.pixels.some((value, index) => value !== repeated.pixels[index])) throw new Error('Cached redraw changed pixels');
          return { seed, cameraX, width: 1200, height: 700, png, firstFrameMs,
            workerOperations: metrics.operations, adapter: metrics.adapterInfo[0],
            uploadedBytes: metrics.uploadedBytes, peakBufferBytes: metrics.peakBufferBytes,
            allocationReadbacks: metrics.counters.mapAsync,
            computeDispatches: metrics.counters.dispatchWorkgroups,
            mainGPU: window.workerHarness.mainGPU,
            heartbeatTicks: intervals.length, longestHeartbeatGapMs: Math.max(0, ...intervals),
            mainLongTasksMs: longTasks, repeatedPixelsIdentical: true,
            comparison: 'Different seed mapping: visual review only; no whole-image parity score.' };
        } finally { renderer.dispose(); await window.workerHarness.terminated(); }
      }, { seed, cameraX });
      result.reference = { commit: originalCommit, ...referenceOptions, zoom: 1.142 };
      await writeFile(resolve(output, `${filename}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
      await writeFile(resolve(output, `${filename}.html`), `<!doctype html><meta charset="utf-8"><title>Original and GPU landscapes</title><style>body{margin:16px;background:#eee;font:16px system-ui}img{display:block;max-width:100%;border:1px solid #aaa}</style><h1>Original construction, GPU execution</h1><p>The GPU uses a new seed mapping. These images compare landscape character, not identical composition.</p><h2>Original CPU/SVG · matched seed and camera</h2><img src="data:image/png;base64,${reference.toString('base64')}"><h2>GPU construction</h2><img src="${result.png}">`);
      delete result.png;
      results.push(result);
      console.log(JSON.stringify(result));
      assert.deepEqual(errors, [], 'Rendering produced browser errors');
      assert.deepEqual(result.mainGPU, { requestAdapter: 0, requestDevice: 0 });
      assert(result.uploadedBytes < 4096, 'Scene generation uploaded more than scalar settings');
      assert.equal(result.allocationReadbacks, 3, 'Unexpected generation readback');
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
});
