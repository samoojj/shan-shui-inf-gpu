import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { withBrowser } from '../tests/helpers/browser.mjs';
import { installWorkerHarness } from '../tests/browser/worker-harness.mjs';
import { resolveOptions } from '../dist/options.js';

// Hardware is required by default. Software runs are explicitly labelled and
// cannot accidentally satisfy the hardware acceptance gate.
const allowSoftware = process.env.ALLOW_SOFTWARE_BENCHMARK === '1';
const settings = resolveOptions({
  seed: process.env.BENCHMARK_SEED || '1234',
  width: Number(process.env.BENCHMARK_WIDTH || 1200),
  height: Number(process.env.BENCHMARK_HEIGHT || 700),
  pixelRatio: Number(process.env.BENCHMARK_PIXEL_RATIO || 1),
});
await withBrowser(async ({ browser, baseURL }) => {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseURL}/dist/index.js`);
    const adapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter is available for benchmarking.');
      return {vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter};
    });
    const software = adapter.isFallbackAdapter === true || /swiftshader|llvmpipe|lavapipe|software|warp/i.test(Object.values(adapter).join(' '));
    if (software && !allowSoftware) throw new Error('Hardware benchmark refused a software adapter. Set ALLOW_SOFTWARE_BENCHMARK=1 only for diagnostic runs.');
    await page.addInitScript(installWorkerHarness);
    await page.reload();
    const result = await page.evaluate(async settings => {
      document.body.innerHTML = '<canvas></canvas>';
      const {createLandscape} = await import('/dist/index.js');
      const operations = [];
      let renderer;
      async function measure(name, run) {
        const before = await window.workerHarness.command('metrics').catch(() => null);
        const start = performance.now();
        await run();
        const wallMs = performance.now() - start;
        const after = await window.workerHarness.command('metrics');
        operations.push({name, wallMs,
          phases: after.phases.filter(phase => !before || phase.startTime >= before.workerNow),
          peakBufferBytes: after.peakBufferBytes,
          constructionDispatches: after.counters.dispatchWorkgroups - (before?.counters.dispatchWorkgroups || 0)});
      }
      try {
        await measure('cold-initialization', async () => {
          renderer = await createLandscape(document.querySelector('canvas'), settings);
        });
        // Vertical movement stays in the exact horizontal construction range
        // even when a custom viewport ends exactly on a chunk boundary.
        await measure('cached-pan', () => renderer.render({cameraY:10}));
        await measure('chunk-boundary-pan', () => renderer.render({cameraX:600}));
        await measure('seed-regeneration', () => renderer.render({seed:'benchmark-new-seed'}));
        await measure('png-capture', () => renderer.capture());
        if (operations[1].constructionDispatches !== 0) throw new Error('Cached pan unexpectedly regenerated geometry.');
        return {operations, adapter: (await window.workerHarness.command('metrics')).adapterInfo[0]};
      } finally { renderer?.dispose(); await window.workerHarness.terminated(); }
    }, settings);
    assert.equal(result.operations.length, 5);
    // The worker requests low-power and can receive a different adapter than
    // the preliminary main-thread probe. Only its acquired device can certify
    // the execution class of these measurements.
    const workerSoftware = result.adapter.isFallbackAdapter === true || /swiftshader|llvmpipe|lavapipe|software|warp/i.test(Object.values(result.adapter).join(' '));
    if (workerSoftware && !allowSoftware) throw new Error('Hardware benchmark refused the worker\'s software adapter.');
    const workerIdentified = [result.adapter.vendor, result.adapter.architecture, result.adapter.description].some(Boolean);
    if (!workerIdentified && !allowSoftware) throw new Error('The worker adapter is unidentified; hardware execution cannot be certified.');
    const report = {execution: workerSoftware ? 'software diagnostic; hardware gate remains open' : workerIdentified ? 'hardware' : 'unidentified diagnostic; hardware gate remains open',
      codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
      workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim(),
      settings, ...result,
      timing: 'Wall-clock phases fenced by GPU completion; setup includes construction compilation, PNG wall time includes encoding. No GPU timestamp claim.',
      cache: 'One range is retained. Boundary pans rebuild overlapping geometry; compare against the latency budget before changing this architecture.'};
    await mkdir('test-results/benchmark', {recursive:true});
    await writeFile('test-results/benchmark/report.json', JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await page.close(); }
});
