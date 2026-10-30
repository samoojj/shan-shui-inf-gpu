import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'shan-shui-consumer-'));
const base = '/deployed/landscapes/';
let browser, server;
try {
  // Test the packed distribution rather than source imports or the repository demo.
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }))[0];
  const packageDirectory = join(temporary, 'node_modules/shan-shui-gpu');
  await mkdir(packageDirectory, { recursive: true });
  execFileSync('tar', ['-xzf', join(temporary, packed.filename), '--strip-components=1', '-C', packageDirectory]);
  const app = join(temporary, 'app.js');
  await writeFile(app, await readFile(new URL('./consumer/app.js', import.meta.url)));
  const consumerRequire = createRequire(app);
  const workerEntry = consumerRequire.resolve('shan-shui-gpu/worker');
  const publicDirectory = join(temporary, 'public');
  await build({
    absWorkingDir: temporary,
    entryPoints: { app, 'landscape-worker': workerEntry },
    outdir: join(publicDirectory, 'assets'), bundle: true, platform: 'browser', format: 'esm', minify: true,
  });
  await writeFile(join(publicDirectory, 'index.html'), '<!doctype html><title>Packaged landscape consumer</title><canvas width="320" height="256"></canvas><script type="module" src="./assets/app.js"></script>');
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const relative = path.slice(base.length) || 'index.html';
    if (!path.startsWith(base) || !/^(?:index\.html|assets\/[\w.-]+\.js)$/.test(relative)) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile(join(publicDirectory, relative)));
    } catch { res.writeHead(404).end(); }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (process.env.CONSUMER_BUILD_ONLY === '1') {
    for (const file of ['', 'assets/app.js', 'assets/landscape-worker.js']) {
      const response = await fetch(`${origin}${base}${file}`);
      assert.equal(response.status, 200, `Missing emitted production asset ${file}`);
      assert((await response.text()).length > 0);
    }
    console.log(`PASS packed esbuild production assets under ${base}; browser execution NOT RUN`);
  } else {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', ...(process.env.SWIFTSHADER === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'] : [])] });
  const page = await browser.newPage();
  const errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('/landscape-worker.js')) workers.push({ url: response.url(), status: response.status() }); });
  await page.goto(`${origin}${base}`);
  const result = await page.evaluate(() => window.consumerResult);
  assert.deepEqual(errors, []);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].status, 200);
  assert(new URL(workers[0].url).pathname === `${base}assets/landscape-worker.js`);
  assert.deepEqual({ width: result.width, height: result.height, type: result.type, opaque: result.opaque }, { width: 80, height: 64, type: 'image/png', opaque: true });
  assert(result.range > 30, `Blank consumer capture: ${JSON.stringify(result)}`);
  console.log(`PASS packed esbuild consumer under ${base}: ${JSON.stringify(result)}`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
