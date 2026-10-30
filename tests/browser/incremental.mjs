/** Hold the first real incremental GPU fence so assertions do not depend on speed. */
async function beginIncremental(page, patch = {}) {
  await page.evaluate(async patch => {
    const t = window.test;
    await t.command('hold-fence');
    t.incrementalDrawsBefore = (await t.inspect()).draws.length;
    t.incrementalEventsBefore = t.harness.current.events.length;
    t.incrementalRequestsBefore = t.harness.current.requests.length;
    t.incrementalSettled = false;
    t.incremental = t.renderer.render({ presentation: 'incremental', commandsPerFrame: 128, cameraY: 180, ...patch }).then(
      () => {
        t.incrementalSettled = true;
        return { status: 'fulfilled', completedRevisions: t.harness.current.responses.filter(item => item.type === 'rendered').map(item => item.revision) };
      }, error => { t.incrementalSettled = true; return { status: 'rejected', message: error.message }; },
    );
  }, patch);
  await page.waitForFunction(() => {
    const t = window.test;
    return t.harness.current.events.slice(t.incrementalEventsBefore).some(event => event.name === 'fence-held');
  });
}

export const incrementalScenarios = [
  {
    name: 'incremental completed ink survives capture and unchanged renders',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        await t.renderer.render({ presentation: 'incremental', commandsPerFrame: 128, cameraY: 180 });
        const before = (await t.inspect()).draws.length;
        const image = await t.renderer.capture();
        await t.renderer.render();
        const added = (await t.inspect()).draws.slice(before);
        t.require(!added.some(draw => draw[0] === 6), 'Capture or unchanged render repainted completed ink');
        t.require(image.options.presentation === 'incremental', 'Capture changed requested presentation');
      });
    },
  },
  {
    name: 'incremental capture with a one-command budget survives immediate disposal',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        const expected = t.hash((await t.decodePNG((await t.renderer.capture({ cameraY: 180 })).blob)).pixels);
        await t.renderer.render({ cameraY: 160 });
        const capture = t.renderer.capture({ presentation: 'incremental', commandsPerFrame: 1, cameraY: 180 });
        t.renderer.dispose();
        let timer;
        try {
          const image = await Promise.race([capture, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Capture retained incremental pacing')), 10000);
          })]);
          t.require(image.options.presentation === 'incremental' && image.options.commandsPerFrame === 1, 'Capture lost request metadata');
          t.require(t.hash((await t.decodePNG(image.blob)).pixels) === expected, 'Disposed capture lost complete pixels');
          await t.harness.terminated();
        } finally { clearTimeout(timer); }
      });
    },
  },
  {
    name: 'incremental batches preserve painter order and finish with complete-mode pixels',
    async run({ page }) {
      await beginIncremental(page, { cameraY: 160 });
      await page.evaluate(async () => {
        const t = window.test, held = await t.inspect();
        const first = held.draws.slice(t.incrementalDrawsBefore).filter(draw => draw[0] === 6);
        t.require(first.length === 1 && first[0][1] === 128 && first[0][3] === 0, 'First incremental batch is not the ordered command prefix');
        t.require(!t.incrementalSettled, 'Render resolved before later batches were submitted');
        await t.command('release-fence');
        const outcome = await t.incremental;
        t.require(outcome.status === 'fulfilled', `Incremental render failed: ${outcome.message}`);
        const completed = await t.inspect();
        const batches = completed.draws.slice(t.incrementalDrawsBefore).filter(draw => draw[0] === 6);
        t.require(batches.length > 1, 'Incremental mode did not present multiple batches');
        let offset = 0;
        for (const draw of batches) {
          t.require(draw[3] === offset && draw[1] > 0 && draw[1] <= 128, `Painter sequence skipped/repeated a brush at ${offset}: ${JSON.stringify(draw)}`);
          offset += draw[1];
        }
        t.require(offset === t.afterCreate.draws[0][1], 'Incremental mode did not paint exactly the complete command count');
        const incrementalPixels = await t.pixels();
        t.require(t.hash(incrementalPixels) === t.hash(t.initial), 'Final incremental pixels differ from complete-mode pixels');
      });
    },
  },
  {
    name: 'incremental render supersession moves callers onto the replacement completion',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.replacementPixels = (await t.decodePNG((await t.renderer.capture({ cameraY: 200 })).blob)).pixels;
        await t.renderer.render({ cameraY: 160 });
      });
      await beginIncremental(page);
      await page.evaluate(async () => {
        const t = window.test;
        let replacementSettled = false;
        const replacement = t.renderer.render({ presentation: 'complete', cameraY: 200 }).then(() => { replacementSettled = true; });
        t.require(!t.incrementalSettled && !replacementSettled, 'A superseded caller resolved while its first fence was held');
        const requests = t.harness.current.requests.slice(t.incrementalRequestsBefore);
        const original = requests.find(request => request.type === 'render');
        t.require(requests.some(request => request.type === 'cancel' && request.revision === original.revision), 'New render did not cancel the active incremental revision');
        await t.command('release-fence');
        const [outcome] = await Promise.all([t.incremental, replacement]);
        const paints = t.harness.current.requests.slice(t.incrementalRequestsBefore).filter(request => request.type === 'render');
        t.require(paints.length === 2 && paints[1].options.cameraY === 200, 'Replacement render was lost');
        t.require(outcome.status === 'fulfilled' && outcome.completedRevisions.includes(paints[1].revision), 'Superseded caller resolved before the replacement revision completed');
        t.require(t.hash(await t.pixels()) === t.hash(t.replacementPixels), 'Replacement retained pixels from the cancelled painting');
      });
    },
  },
  {
    name: 'incremental capture barriers wait for the completed painting before newer renders',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.barrierPixels = (await t.decodePNG((await t.renderer.capture({ cameraY: 180 })).blob)).pixels;
        await t.renderer.render({ cameraY: 160 });
      });
      await beginIncremental(page);
      await page.evaluate(async () => {
        const t = window.test;
        let captured = false;
        const capture = t.renderer.capture().then(image => { captured = true; return image; });
        const later = t.renderer.render({ presentation: 'complete', cameraY: 220 });
        t.require(!t.incrementalSettled && !captured, 'Capture returned an incomplete incremental image');
        t.require(!t.harness.current.requests.slice(t.incrementalRequestsBefore).some(request => request.type === 'cancel'), 'New render cancelled a painting required by a capture barrier');
        await t.command('release-fence');
        const [outcome, image] = await Promise.all([t.incremental, capture, later]);
        t.require(outcome.status === 'fulfilled', 'Painting before capture did not complete');
        t.require(image.options.cameraY === 180 && image.options.presentation === 'incremental', 'Capture inherited newer settings');
        t.require(t.hash((await t.decodePNG(image.blob)).pixels) === t.hash(t.barrierPixels), 'Capture contains a partial or mixed-revision painting');
        t.require(t.renderer.getOptions().cameraY === 220, 'Capture barrier replaced the newest options');
      });
    },
  },
  {
    name: 'incremental disposal rejects the active sequence and releases its worker',
    async run({ page }) {
      await beginIncremental(page);
      await page.evaluate(async () => {
        const t = window.test;
        t.require(!t.incrementalSettled, 'Disposal fixture did not hold an active sequence');
        const before = await t.inspect();
        t.renderer.dispose();
        const outcome = await t.incremental;
        await t.harness.terminated();
        t.require(outcome.status === 'rejected' && /disposed/i.test(outcome.message), 'Disposal did not reject the active painting');
        t.require(t.renderer.getStatus() === 'disposed', 'Late painting completion revived a disposed session');
        t.require(t.gpu.draws.length === before.draws.length, 'A disposed sequence submitted later batches');
        t.require(t.gpu.devices.every(device => t.gpu.destroyedDevices.includes(device)), 'Incremental disposal retained its GPU device');
      });
    },
  },
];
