import assert from 'node:assert/strict';

export const renderingScenarios = [
  {
    name: 'real shaders produce an opaque, nonblank landscape',
    async run({ page }) {
      const info = await page.evaluate(() => {
        const t = window.test;
        let min = 255, max = 0;
        for (let i = 0; i < t.initial.length; i += 4) {
          min = Math.min(min, t.initial[i]); max = Math.max(max, t.initial[i]);
          t.require(t.initial[i + 3] === 255, 'Output must be opaque');
        }
        return { min, max, status: t.renderer.getStatus(), renderer: t.gpu.adapterInfo[0] };
      });
      assert.equal(info.status, 'ready');
      assert(info.max - info.min > 30, JSON.stringify(info));
      console.log(`WebGPU adapter: ${JSON.stringify(info.renderer)}`);
    },
  },
  {
    name: 'distinct seeds change pixels and repeated renders reproduce them exactly',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const original = t.hash(t.initial), hashes = new Set([original]);
      for (const seed of ['another-seed', '山水', 12345678]) {
        t.renderer.render({ seed }); hashes.add(t.hash(await t.pixels()));
      }
      t.require(hashes.size === 4, 'Distinct seeds must produce distinct images');
      t.renderer.render({ seed: 'browser-validation' });
      t.require(t.hash(await t.pixels()) === original, 'Restored seed changed pixels');
      t.renderer.render();
      t.require(t.hash(await t.pixels()) === original, 'Identical repeated render changed pixels');
    }),
  },
  {
    name: 'panning is repeatable in positive and negative world coordinates',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      for (const cameraX of [-4000, 7000, -450, 0]) t.renderer.render({ cameraX });
      t.require(t.hash(await t.pixels()) === t.hash(t.initial), 'Pan order changed the world');
      t.renderer.render({ cameraX: -600 });
      const negative = t.hash(await t.pixels());
      t.renderer.render({ cameraX: 20000 }); t.renderer.render({ cameraX: -600 });
      t.require(t.hash(await t.pixels()) === negative, 'Negative world is not stable');
    }),
  },
  {
    name: 'overlapping viewports agree across positive and negative cells',
    async run({ page }) {
      const comparisons = await page.evaluate(async () => {
        const t = window.test, results = [];
        for (const start of [-625.125, 113.125]) {
          t.renderer.render({ cameraX: start }); const left = await t.pixels();
          // 80 pixels at 1000 world units / 256 vertical pixels = 312.5 units.
          t.renderer.render({ cameraX: start + 312.5 }); const right = await t.pixels();
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
    },
  },
  {
    name: 'resize preserves scene settings and invalid updates are atomic',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.renderer.render({ seed: 'resize-seed', mist: 0.6, cameraX: -200 });
      t.renderer.resize(240, 180, 1.5);
      t.require(t.canvas.width === 360 && t.canvas.height === 270, 'Wrong backing dimensions');
      const before = t.renderer.getOptions(), image = t.hash(await t.pixels());
      t.require(before.seed === 'resize-seed' && before.cameraX === -200 && before.mist === 0.6, 'Resize reset scene options');
      let rejected = false;
      try { t.renderer.render({ seed: 'should-not-apply', layers: 100 }); } catch { rejected = true; }
      t.require(rejected, 'Invalid render did not throw');
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Invalid render partially changed options');
      t.renderer.render();
      t.require(t.hash(await t.pixels()) === image, 'Invalid render changed the image');
      const copy = t.renderer.getOptions(); copy.paper[0] = 0; copy.ink[1] = 1; copy.seed = 'mutated';
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Options expose mutable renderer state');
    }),
  },
  {
    name: 'normal rendering submits one fullscreen draw with bounded uniforms and no CPU geometry or readback',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, gpu = t.gpu;
      const before = { ...gpu.counters }, writes = gpu.writes.length, draws = gpu.draws.length;
      t.renderer.render({ cameraX: 111 });
      t.require(gpu.counters.draw === before.draw + 1, 'Render must encode one fullscreen draw');
      t.require(gpu.counters.submit === before.submit + 1, 'Render must submit one frame');
      t.require(gpu.draws[draws][0] === 3, 'Landscape must use a fullscreen triangle');
      for (const name of ['createBuffer', 'createTexture', 'writeTexture', 'copyExternalImageToTexture', 'copyTextureToBuffer', 'mapAsync']) {
        t.require(gpu.counters[name] === before[name], `Unexpected ${name} during normal render`);
      }
      t.require(gpu.writes.slice(writes).every(bytes => bytes <= 512), 'Render uploaded more than a small uniform block');
      t.require(gpu.buffers.every(({ usage }) => !(usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE))), 'Landscape uses CPU geometry or storage buffers');
    }),
  },
];
