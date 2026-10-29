import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';

// Compare against the accepted upstream PNG at the same 1.142 scale.
// No upstream code, network fetch, or prior reference-capture run is needed.
const output = resolve('test-results/comparison');
await mkdir(output, { recursive: true });
const server = serve(0);
await once(server, 'listening');
let browser;
const results = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', ...(process.env.SWIFTSHADER === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'] : [])],
  });
  for (const seed of ['1234']) {
    const reference = await readFile(resolve(`docs/images/original-${seed}.png`));
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); else if (message.text().startsWith('[comparison]')) console.log(message.text()); });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/dist/index.js`);
      await page.setContent('<style>body{margin:0}</style><canvas width="1200" height="700"></canvas>');
      console.log(`Rendering upstream seed ${seed} through GPU brushes…`);
      const result = await page.evaluate(async ({ seed, reference }) => {
        const api = await import('/dist/index.js');
        const start = performance.now();
        const renderer = await api.createLandscape(document.querySelector('canvas'), { seed, width: 1200, height: 700 });
        const firstFrameMs = performance.now() - start;
        console.log('[comparison] first frame ready in ' + firstFrameMs.toFixed(0) + ' ms');
        try {
          const captured = await renderer.capture();
          const png = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(captured.blob); });
          const decode = async url => {
            const bitmap = await createImageBitmap(await (await fetch(url)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0); bitmap.close();
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const [original, gpu] = await Promise.all([decode(reference), decode(png)]);
          let error = 0, squared = 0, differentPixels = 0;
          for (let i = 0; i < gpu.length; i += 4) {
            let maximum = 0;
            for (let c = 0; c < 3; c++) { const d = Math.abs(gpu[i+c] - original[i+c]); error += d; squared += d*d; maximum = Math.max(maximum, d); }
            if (maximum > 16) differentPixels++;
          }
          const adapter = await navigator.gpu.requestAdapter();
          return { seed, width: 1200, height: 700, png, meanAbsoluteChannelError: error / (gpu.length / 4 * 3), rootMeanSquaredChannelError: Math.sqrt(squared / (gpu.length / 4 * 3)), fractionPixelsOver16: differentPixels / (gpu.length / 4), firstFrameMs, adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } };
        } finally { renderer.dispose(); }
      }, { seed, reference: `data:image/png;base64,${reference.toString('base64')}` });
      await writeFile(resolve(output, `${seed}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
      const originalURL = `data:image/png;base64,${reference.toString('base64')}`;
      await writeFile(resolve(output, `${seed}.html`), `<!doctype html><meta charset="utf-8"><title>Upstream / GPU: ${seed}</title><style>body{margin:16px;background:#eee;font:16px system-ui}img{display:block;max-width:100%;border:1px solid #aaa}h2{font-size:16px}</style><h1>Seed ${seed}</h1><h2>LingDong-/shan-shui-inf · pinned original</h2><img src="${originalURL}"><h2>GPU port · same seed and view</h2><img src="${result.png}">`);
      delete result.png;
      results.push(result);
      console.log(JSON.stringify(result));
      assert.deepEqual(errors, [], 'Rendering produced browser errors');
      assert(result.meanAbsoluteChannelError < 3, 'Mean channel error exceeds 3/255 against upstream');
      assert(result.fractionPixelsOver16 < .03, 'More than 3% of pixels differ from upstream by over 16/255');
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
