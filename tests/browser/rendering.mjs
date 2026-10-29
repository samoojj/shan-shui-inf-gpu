import assert from 'node:assert/strict';

export const renderingScenarios = [
  {
    name: 'real shaders produce an opaque, nonblank landscape',
    async run({ page }) {
      const info = await page.evaluate(() => {
        const t = window.test;
        const { min, max } = t.pixelRange(t.initial);
        for (let i = 3; i < t.initial.length; i += 4) t.require(t.initial[i] === 255, 'Output must be opaque');
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
    name: 'cached views repeat after positive and negative camera excursions',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      // The original grows a stateful chunk cache. Warm both sides before
      // comparing repeated visits, so new offscreen objects are not introduced.
      t.renderer.render({ cameraX: -600 });
      t.renderer.render({ cameraX: 600 });
      t.renderer.render({ cameraX: 0 });
      const origin = t.hash(await t.pixels());
      t.renderer.render({ cameraX: -600 });
      const negative = t.hash(await t.pixels());
      t.renderer.render({ cameraX: 600 }); t.renderer.render({ cameraX: -600 });
      t.require(t.hash(await t.pixels()) === negative, 'Cached negative view changed');
      t.renderer.render({ cameraX: 0 });
      t.require(t.hash(await t.pixels()) === origin, 'Cached origin view changed');
    }),
  },
  {
    name: 'cached positive and negative views retain matching overlapping scenery',
    async run({ page }) {
      const comparisons = await page.evaluate(async () => {
        const t = window.test, results = [];
        t.renderer.resize(768, 256);
        const shift = 512 / t.renderer.getOptions().zoom;
        const width = t.canvas.width, height = t.canvas.height;
        const pixelShift = Math.round(512 * t.renderer.getOptions().pixelRatio);
        // Upstream culls by object origin, so a long distant mountain can pop
        // out when that origin crosses its 512-unit margin. These selected
        // pairs retain the distant motifs that cover their shared viewport.
        for (const start of [-625.125, 33.125]) {
          t.renderer.render({ cameraX: start });
          t.renderer.render({ cameraX: start + shift });
          t.renderer.render({ cameraX: start }); const left = await t.pixels();
          // Original paper is screen-aligned and repeats every 512 pixels.
          // Shift one paper tile so the overlapping scene also shares its paper.
          t.renderer.render({ cameraX: start + shift }); const right = await t.pixels();
          let total = 0, large = 0, count = 0;
          for (let y = 0; y < height; y++) for (let x = 0; x < width - pixelShift; x++) for (let c = 0; c < 3; c++) {
            const delta = Math.abs(left[(y * width + x + pixelShift) * 4 + c] - right[(y * width + x) * 4 + c]);
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
    name: 'paper tiles repeat exactly at fractional pixel ratios',
    createRenderer: false,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      // The original paper is a 512-CSS-pixel tile. Move the scene out of view
      // so this tests paper sampling independently of path rasterization.
      t.renderer = await t.api.createLandscape(t.canvas, {
        seed: 'browser-validation', width: 768, height: 256, pixelRatio: 0.25, cameraY: -5000,
      });
      const pixels = await t.pixels(), width = t.canvas.width, height = t.canvas.height;
      const shift = 128;
      let differences = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width - shift; x++) for (let c = 0; c < 4; c++) {
        differences += Number(pixels[(y * width + x) * 4 + c] !== pixels[(y * width + x + shift) * 4 + c]);
      }
      t.require(differences === 0, `Identical paper tiles differ in ${differences} channels at fractional pixel ratio`);
    }),
  },
  {
    name: 'resize preserves scene settings and invalid updates are atomic',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.renderer.render({ seed: 'resize-seed', zoom: 1.5, cameraX: -200 });
      t.renderer.resize(80, 60, 2);
      t.require(t.canvas.width === 160 && t.canvas.height === 120, 'Wrong backing dimensions');
      const before = t.renderer.getOptions(), image = t.hash(await t.pixels());
      t.require(before.seed === 'resize-seed' && before.cameraX === -200 && before.zoom === 1.5, 'Resize reset scene options');
      await t.rejects(() => t.renderer.render({ seed: 'should-not-apply', zoom: 0 }), 'Invalid render did not throw');
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Invalid render partially changed options');
      t.renderer.render();
      t.require(t.hash(await t.pixels()) === image, 'Invalid render changed the image');
      const copy = t.renderer.getOptions(); copy.cameraX = 0; copy.zoom = 4; copy.seed = 'mutated';
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Options expose mutable renderer state');
    }),
  },
  {
    name: 'GPU compute creates brush vertices and cached camera redraws upload only uniforms',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, gpu = t.gpu;
      t.require(gpu.afterCreate.dispatchWorkgroups === 1, 'Initial scene did not dispatch brush generation');
      t.require(gpu.afterCreate.beginComputePass === 1 && gpu.afterCreate.beginRenderPass === 2, 'Initial frame must compute brushes then render ink and paper');
      t.require(gpu.initialDraws.length === 2, 'Initial frame must submit the ink and paper draws');
      t.require(gpu.initialDraws[0][0] === 6 && gpu.initialDraws[0][1] > 0, 'Ink pass did not instance original path bounds');
      t.require(gpu.initialDraws[1][0] === 3, 'Paper pass did not composite a fullscreen triangle');
      const generated = gpu.buffers.filter(buffer => /^GPU brush (vertices|bounds)$/.test(buffer.label));
      t.require(generated.length === 2, 'Missing generated brush vertex or bounds buffer');
      for (const allocation of generated) {
        t.require(allocation.usage & GPUBufferUsage.STORAGE, 'Generated geometry is not GPU storage');
        t.require(!allocation.mappedAtCreation, 'Generated geometry was mapped for CPU initialization');
        t.require(!gpu.writes.some(write => write.buffer === allocation.buffer), 'Expanded brush geometry was uploaded by the CPU');
      }
      t.require(gpu.counters.copyTextureToBuffer === 0 && gpu.counters.mapAsync === 0, 'Rendering used explicit GPU readback');
      const before = { ...gpu.counters }, writes = gpu.writes.length, draws = gpu.draws.length, buffers = gpu.buffers.length;
      t.renderer.render({ cameraY: t.renderer.getOptions().cameraY + 20 });
      t.require(gpu.counters.dispatchWorkgroups === before.dispatchWorkgroups, 'Cached camera redraw recomputed brush geometry');
      t.require(gpu.counters.beginRenderPass === before.beginRenderPass + 2, 'Camera redraw must render ink and paper');
      t.require(gpu.counters.draw === before.draw + 2, 'Camera redraw must encode two rendering draws');
      t.require(gpu.counters.submit === before.submit + 1, 'Render must submit one frame');
      t.require(gpu.draws[draws][0] === 6 && gpu.draws[draws + 1][0] === 3, 'Camera redraw changed the rendering passes');
      for (const name of ['createTexture', 'writeTexture', 'copyExternalImageToTexture', 'copyTextureToBuffer', 'mapAsync']) {
        t.require(gpu.counters[name] === before[name], `Unexpected ${name} during normal render`);
      }
      t.require(gpu.writes.slice(writes).every(write => write.bytes <= 512), 'Camera redraw uploaded more than uniforms');
      t.require(gpu.buffers.slice(buffers).every(({ usage }) => !(usage & GPUBufferUsage.STORAGE)), 'Camera redraw allocated new geometry storage');
      t.require(gpu.buffers.every(({ usage }) => !(usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX))), 'Landscape uploaded a CPU vertex or index mesh');
      const expected = t.hash(await t.pixels());
      const unchanged = { ...gpu.counters }, nextDraw = gpu.draws.length;
      t.renderer.render();
      t.require(gpu.counters.dispatchWorkgroups === unchanged.dispatchWorkgroups, 'Unchanged view recomputed brush geometry');
      t.require(gpu.counters.beginRenderPass === unchanged.beginRenderPass + 1, 'Unchanged view repainted the cached ink target');
      t.require(gpu.counters.draw === unchanged.draw + 1 && gpu.draws[nextDraw][0] === 3, 'Unchanged view must only composite cached ink with paper');
      t.require(t.hash(await t.pixels()) === expected, 'Reusing the cached ink target changed the PNG');
    }),
  },
];
