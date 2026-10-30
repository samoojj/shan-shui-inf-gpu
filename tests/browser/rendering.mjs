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
        await t.renderer.render({ seed }); hashes.add(t.hash(await t.pixels()));
      }
      t.require(hashes.size === 4, 'Distinct seeds must produce distinct images');
      await t.renderer.render({ seed: 'browser-validation' });
      t.require(t.hash(await t.pixels()) === original, 'Restored seed changed pixels');
      await t.renderer.render();
      t.require(t.hash(await t.pixels()) === original, 'Identical repeated render changed pixels');
    }),
  },
  {
    name: 'cached views repeat after positive and negative camera excursions',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      // Revisit regenerated chunk ranges: placement must not depend on visit order.
      await t.renderer.render({ cameraX: -600 });
      await t.renderer.render({ cameraX: 600 });
      await t.renderer.render({ cameraX: 0 });
      const origin = t.hash(await t.pixels());
      await t.renderer.render({ cameraX: -600 });
      const negative = t.hash(await t.pixels());
      await t.renderer.render({ cameraX: 600 }); await t.renderer.render({ cameraX: -600 });
      t.require(t.hash(await t.pixels()) === negative, 'Cached negative view changed');
      await t.renderer.render({ cameraX: 0 });
      t.require(t.hash(await t.pixels()) === origin, 'Cached origin view changed');
    }),
  },
  {
    name: 'cached positive and negative views retain matching overlapping scenery',
    async run({ page }) {
      const comparisons = await page.evaluate(async () => {
        const t = window.test, results = [];
        await t.renderer.resize(768, 256);
        const shift = 512 / t.renderer.getOptions().zoom;
        const dimensions = await t.renderer.capture();
        const width = dimensions.width, height = dimensions.height;
        const pixelShift = Math.round(512 * t.renderer.getOptions().pixelRatio);
        // The GPU planner retains a three-chunk margin for long distant ridges.
        // Cross chunk boundaries in both directions and compare shared scenery.
        for (const start of [-625.125, 33.125]) {
          await t.renderer.render({ cameraX: start });
          await t.renderer.render({ cameraX: start + shift });
          await t.renderer.render({ cameraX: start }); const left = await t.pixels();
          // Original paper is screen-aligned and repeats every 512 pixels.
          // Shift one paper tile so the overlapping scene also shares its paper.
          await t.renderer.render({ cameraX: start + shift }); const right = await t.pixels();
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
      const image = await t.renderer.capture();
      const { pixels, width, height } = await t.decodePNG(image.blob);
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
      await t.renderer.render({ seed: 'resize-seed', zoom: 1.5, cameraX: -200 });
      await t.renderer.resize(80, 60, 2);
      const resized = await t.renderer.capture();
      t.require(resized.width === 160 && resized.height === 120, 'Wrong backing dimensions');
      const before = t.renderer.getOptions(), image = t.hash(await t.pixels());
      t.require(before.seed === 'resize-seed' && before.cameraX === -200 && before.zoom === 1.5, 'Resize reset scene options');
      await t.rejects(() => t.renderer.render({ seed: 'should-not-apply', zoom: 0 }), 'Invalid render did not throw');
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Invalid render partially changed options');
      await t.renderer.render();
      t.require(t.hash(await t.pixels()) === image, 'Invalid render changed the image');
      const copy = t.renderer.getOptions(); copy.cameraX = 0; copy.zoom = 4; copy.seed = 'mutated';
      t.require(JSON.stringify(before) === JSON.stringify(t.renderer.getOptions()), 'Options expose mutable renderer state');
    }),
  },
  {
    name: 'GPU constructs scene descriptions and paths while cached redraws upload only uniforms',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, initial = t.afterCreate;
      t.require(initial.counters.dispatchWorkgroups > 0, 'Initial scene did not dispatch GPU generation');
      t.require(initial.counters.beginComputePass > 0 && initial.counters.beginRenderPass === 2, 'Initial frame must generate geometry then render ink and paper');
      t.require(initial.draws.length === 2, 'Initial frame must submit ink and paper draws');
      t.require(initial.draws[1][0] === 3, 'Paper pass did not composite a fullscreen triangle');
      const gpu = await t.inspect();
      t.require(initial.uploadedBytes < 4096, 'Generation uploaded procedural data instead of scalar settings');
      t.require(initial.counters.mapAsync === 3, 'Generation must read only three allocation summaries');
      const generated = gpu.buffers.filter(buffer => (buffer.usage & GPUBufferUsage.STORAGE) && buffer.label !== 'allocation summary');
      t.require(generated.length >= 2, 'Missing generated brush vertex or bounds buffers');
      for (const allocation of generated) {
        t.require(allocation.usage & GPUBufferUsage.STORAGE, 'Generated geometry is not GPU storage');
        t.require(!allocation.mappedAtCreation, 'Generated geometry was mapped for CPU initialization');
        t.require(!gpu.writes.some(write => write.buffer === allocation.buffer), 'Expanded brush geometry was uploaded by the CPU');
      }
      const before = await t.inspect();
      await t.renderer.render({ cameraY: t.renderer.getOptions().cameraY + 20 });
      const after = await t.inspect();
      t.require(after.counters.dispatchWorkgroups === before.counters.dispatchWorkgroups, 'Cached redraw recomputed geometry');
      t.require(after.counters.beginRenderPass === before.counters.beginRenderPass + 2, 'Camera redraw must render ink and paper');
      t.require(after.counters.draw === before.counters.draw + 2, 'Camera redraw must encode two rendering draws');
      for (const name of ['createTexture', 'writeTexture', 'copyExternalImageToTexture', 'copyTextureToBuffer', 'mapAsync']) {
        t.require(after.counters[name] === before.counters[name], `Unexpected ${name} during cached render`);
      }
      t.require(after.writes.slice(before.writes.length).every(write => write.bytes <= 512), 'Camera redraw uploaded more than uniforms');
      t.require(after.buffers.slice(before.buffers.length).every(({ usage }) => !(usage & GPUBufferUsage.STORAGE)), 'Camera redraw allocated geometry storage');
      t.require(after.buffers.every(({ usage }) => !(usage & (GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX))), 'Landscape uploaded a CPU mesh');
      const expected = t.hash(await t.pixels());
      const unchanged = await t.inspect();
      await t.renderer.render();
      const repeated = await t.inspect();
      t.require(repeated.counters.dispatchWorkgroups === unchanged.counters.dispatchWorkgroups, 'Unchanged view recomputed geometry');
      t.require(repeated.counters.beginRenderPass === unchanged.counters.beginRenderPass + 1, 'Unchanged view repainted cached ink');
      t.require(t.hash(await t.pixels()) === expected, 'Reusing cached ink changed the PNG');
    }),
  },
  {
    name: 'render bursts coalesce and their promises wait for the GPU fence',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        await t.command('hold-fence');
        t.requestsBefore = t.harness.current.requests.length;
        t.settled = 0;
        t.pending = Promise.all(Array.from({ length: 50 }, (_, index) =>
          t.renderer.render({ cameraY: index + 160 }).then(() => { t.settled++; })));
      });
      await page.waitForFunction(() => window.workerHarness.current.events.some(event => event.name === 'fence-held'));
      await page.evaluate(async () => {
        const t = window.test;
        const requests = t.harness.current.requests.slice(t.requestsBefore);
        t.require(requests.length === 1 && requests[0].options.cameraY === 209, 'A render burst was not coalesced into its latest frame');
        t.require(t.settled === 0, 'Render promises resolved before GPU completion');
        await t.command('stale-completion', { revision: requests[0].revision - 1 });
        t.require(t.settled === 0, 'A stale worker completion resolved newer requests');
        const queued = Promise.all(Array.from({ length: 30 }, (_, index) =>
          t.renderer.render({ cameraY: index + 260 }).then(() => { t.settled++; })));
        t.require(t.harness.current.requests.length === t.requestsBefore + 1, 'A busy worker received overlapping render operations');
        await t.command('release-fence');
        await Promise.all([t.pending, queued]);
        t.require(t.settled === 80, 'Coalesced promises did not all settle after completed frames');
        const sent = t.harness.current.requests.slice(t.requestsBefore);
        t.require(sent.length === 2 && sent[1].options.cameraY === 289, 'A burst arriving during active work was not coalesced');
        t.require(t.renderer.getOptions().cameraY === 289, 'Stale completion replaced current options');
      });
    },
  },
  {
    name: 'the main-thread heartbeat continues throughout worker initialization and generation',
    createRenderer: false,
    async run({ page }) {
      const measurements = await page.evaluate(async () => {
        const t = window.test, beats = [];
        const started = performance.now();
        const timer = setInterval(() => beats.push(performance.now()), 16);
        let interaction = false;
        setTimeout(() => { interaction = true; }, 20);
        try {
          t.renderer = await t.api.createLandscape(t.canvas, {
            width: 320, height: 256, pixelRatio: 0.25, seed: 'heartbeat',
          });
          await t.renderer.render({ seed: 'heartbeat-new-generation' });
          // Fast hardware still needs enough elapsed time to observe event-loop ticks.
          let generation = 0;
          while (performance.now() - started < 100) {
            await t.renderer.render({ seed: `heartbeat-fast-${++generation}` });
          }
        } finally { clearInterval(timer); }
        const gpu = await t.inspect();
        t.require(beats.length >= 3 && interaction, 'Generation prevented main-thread timers and interaction');
        t.require(t.harness.mainGPU.requestAdapter === 0 && t.harness.mainGPU.requestDevice === 0, 'The main thread acquired GPU resources');
        const gaps = beats.map((time, index) => time - (beats[index - 1] ?? started));
        return { elapsedMs: performance.now() - started, heartbeatCount: beats.length,
          maximumHeartbeatGapMs: Math.max(...gaps), uploadedBytes: gpu.uploadedBytes,
          workerOperations: gpu.operations.map(operation => ({ type: operation.type,
            elapsedMs: operation.completedAt - operation.startedAt })), adapter: gpu.adapterInfo[0] };
      });
      assert(measurements.maximumHeartbeatGapMs < 500, JSON.stringify(measurements));
      console.log(`Worker responsiveness (software GPU, not a hardware benchmark): ${JSON.stringify(measurements)}`);
    },
  },
];
