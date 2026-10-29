import assert from 'node:assert/strict';

export const captureScenarios = [
  {
    name: 'capture preserves its exact revision, PNG, and settings across newer render requests',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      await t.renderer.render({ seed: 'captured-scene', width: 192, height: 144, cameraY: 160 });
      const expected = await t.pixels();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const pending = t.renderer.capture();
      const next = t.renderer.render({ seed: 'newer-scene', width: 160, height: 100 });
      const frame = await pending;
      await next;
      t.require(frame.blob.type === 'image/png', 'Capture did not return a PNG');
      t.require(Number.isInteger(frame.revision) && frame.revision > 0, 'Capture omitted its request revision');
      t.require(frame.options.seed === 'captured-scene', 'Capture metadata followed a later render');
      t.require(frame.width === 48 && frame.height === 36, 'Capture dimensions followed a later resize');
      t.require(frame.options.width === 192 && frame.options.height === 144, 'Capture lost logical dimensions');
      t.require(t.renderer.getOptions().seed === 'newer-scene', 'Capture replaced the newer scene');
      const decoded = await t.decodePNG(frame.blob);
      t.require(decoded.width === frame.width && decoded.height === frame.height, 'PNG dimensions disagree with metadata');
      const { meanAbsoluteChannelError } = t.comparePixels(expected, decoded.pixels);
      t.require(meanAbsoluteChannelError < 0.1, `Capture no longer represents its requested scene: ${meanAbsoluteChannelError}`);
    }),
  },
  {
    name: 'capture barriers keep separate revisions between coalesced render bursts',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const expectedA = await t.renderer.capture({ seed: 'barrier-a' });
      const expectedB = await t.renderer.capture({ seed: 'barrier-b' });
      const requests = [t.renderer.render({ seed: 'discarded-a' }), t.renderer.render({ seed: 'barrier-a' })];
      const first = t.renderer.capture();
      requests.push(t.renderer.render({ seed: 'discarded-b' }), t.renderer.render({ seed: 'barrier-b' }));
      const second = t.renderer.capture();
      requests.push(t.renderer.render({ seed: 'latest-c' }));
      const [a, b] = await Promise.all([first, second]);
      await Promise.all(requests);
      t.require(a.revision < b.revision, 'Capture barriers lost request ordering');
      for (const [actual, expected] of [[a, expectedA], [b, expectedB]]) {
        const [actualImage, expectedImage] = await Promise.all([t.decodePNG(actual.blob), t.decodePNG(expected.blob)]);
        t.require(actual.options.seed === expected.options.seed, 'Capture inherited settings across its barrier');
        t.require(t.hash(actualImage.pixels) === t.hash(expectedImage.pixels), 'Capture barrier encoded the wrong scene');
      }
      t.require(t.renderer.getOptions().seed === 'latest-c', 'Capture completion replaced newer accepted options');
    }),
  },
  {
    name: 'invalid capture is atomic and an already-dispatched capture survives disposal',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const before = JSON.stringify(t.renderer.getOptions());
      await t.rejects(() => t.renderer.capture({ seed: 'invalid-patch', zoom: 0 }), 'Invalid capture did not reject');
      t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Invalid capture partially changed settings');
      const pending = t.renderer.capture({ seed: 'before-disposal', cameraY: 160 });
      t.renderer.dispose();
      const frame = await pending;
      t.require(t.renderer.getStatus() === 'disposed', 'Capture revived a disposed renderer');
      t.require(frame.options.seed === 'before-disposal', 'Capture lost its settings snapshot');
      const { pixels } = await t.decodePNG(frame.blob);
      const { min, max } = t.pixelRange(pixels);
      t.require(max - min > 30, 'Capture became blank after disposal');
      await t.rejects(() => t.renderer.capture(), 'Disposed renderer accepted a new capture');
    }),
  },
  {
    name: 'disposal rejects queued work but lets an encoding snapshot finish',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        await t.command('hold-encoding');
        t.encodingsBefore = t.harness.current.events.length;
        t.startedCapture = t.renderer.capture({ seed: 'preserved-on-dispose' });
      });
      await page.waitForFunction(() => window.workerHarness.current.events.slice(window.test.encodingsBefore).some(event => event.name === 'encoding-started'));
      await page.evaluate(async () => {
        const t = window.test;
        const queued = Promise.allSettled([
          t.renderer.render({ seed: 'cancelled-render' }), t.renderer.capture({ seed: 'cancelled-capture' }),
        ]);
        t.renderer.dispose();
        const outcomes = await queued;
        t.require(outcomes.every(outcome => outcome.status === 'rejected'), 'Disposal did not reject all queued work');
        await t.command('release-encoding');
        const image = await t.startedCapture;
        t.require(image.options.seed === 'preserved-on-dispose' && image.blob.size > 0, 'Started encoding was discarded');
        await t.harness.terminated();
        t.require(t.renderer.getStatus() === 'disposed', 'Late encoding changed terminal state');
      });
    },
  },
  {
    name: 'PNG encoding failure rejects only the capture and later rendering succeeds',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      await t.command('fail-encoding');
      const error = await t.rejects(() => t.renderer.capture(), 'Failed encoding resolved a PNG');
      t.require(/PNG encoding failure/.test(error.message), 'Encoding failure lost its explanation');
      t.require(t.renderer.getStatus() === 'ready', 'Encoding failure poisoned the session');
      await t.renderer.render({ cameraY: 200 });
      t.require((await t.renderer.capture()).blob.size > 0, 'Encoding failure prevented later captures');
    }),
  },
  {
    name: 'capture rejects an asynchronous native draw failure even when PNG encoding starts',
    expectedGPUErrors: [/Deliberate capture draw failure/],
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, states = [];
      t.renderer.subscribe(state => states.push(state.status));
      await t.command('next-submit-error', { message: 'Deliberate capture draw failure' });
      const error = await t.rejects(() => t.renderer.capture(), 'Capture resolved after a GPU failure');
      t.require(/Deliberate capture draw failure/.test(error.message), 'Capture lost the GPU failure reason');
      t.require(states.join(',') === 'ready,error', `GPU failure emitted incorrect states: ${states}`);
      t.require(t.renderer.getStatus() === 'error', 'GPU failure retained readiness');
    }),
  },
  {
    name: 'OffscreenCanvas captures an exact nonblank PNG from a caller module worker',
    async run({ page, baseURL }) {
      const result = await page.evaluate(async origin => {
        const worker = new Worker(`${origin}/tests/browser/capture-worker.mjs`, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Worker capture timed out')), 120000);
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            const canvas = new OffscreenCanvas(128, 96);
            worker.postMessage({ canvas }, [canvas]);
          });
        } finally { worker.terminate(); }
      }, baseURL);
      assert.equal(result.failure, undefined, result.failure);
      assert.equal(result.type, 'image/png');
      assert.equal(result.seed, 'worker-capture');
      assert.equal(result.currentSeed, 'worker-next');
      assert.equal(result.width, 32); assert.equal(result.height, 24);
      assert.equal(result.logicalWidth, 128); assert.equal(result.logicalHeight, 96);
      assert(result.max - result.min > 30, JSON.stringify(result));
      assert(result.meanDifference < 0.1, JSON.stringify(result));
    },
  },
];
