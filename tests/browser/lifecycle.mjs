function failedInitialization(name, configuration, expectedGPUErrors = []) {
  return {
    name, createRenderer: false, expectedGPUErrors,
    run: ({ page }) => page.evaluate(async configuration => {
      const t = window.test;
      t.harness.nextConfiguration = configuration;
      const error = await t.rejects(() => t.api.createLandscape(t.canvas, {
        width: 200, height: 160, pixelRatio: 0.25,
      }), 'Failed worker initialization returned a renderer');
      const expectedReason = configuration.pipelineFailure ? /pipeline compilation/i : /Deliberate/;
      t.require(expectedReason.test(error.message), `Initialization lost the reason: ${error.message}`);
      const failed = t.harness.current;
      t.require(failed.terminated, 'Failed initialization retained its worker');
      if (configuration.scriptFailure) {
        // A worker load error precedes transfer; the original canvas remains usable.
        t.renderer = await t.api.createLandscape(t.canvas, { width: 200, height: 160, pixelRatio: 0.25 });
      } else {
        const reused = await t.rejects(() => t.api.createLandscape(t.canvas), 'A transferred canvas was reused');
        t.require(/fresh canvas/i.test(reused.message), 'Canvas reuse did not explain irreversible transfer');
        t.require(failed.metrics.devices.every(device => failed.metrics.destroyedDevices.includes(device)), 'Partial setup retained a device');
        t.renderer = await t.api.createLandscape(t.freshCanvas(), { width: 200, height: 160, pixelRatio: 0.25 });
      }
      t.require(t.renderer.getStatus() === 'ready', 'Fresh initialization did not recover');
    }, configuration),
  };
}

export const lifecycleScenarios = [
  {
    name: 'native validation failure publishes error and releases worker resources',
    expectedGPUErrors: [/usage/i],
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.states = [];
        t.renderer.subscribe(state => t.states.push({ status: state.status, error: state.error?.message }));
        await t.command('validation-error');
      });
      await page.waitForFunction(() => window.test.renderer.getStatus() === 'error');
      await page.evaluate(async () => {
        const t = window.test, before = JSON.stringify(t.renderer.getOptions());
        t.require(t.states.map(state => state.status).join(',') === 'ready,error', 'Native failure published false readiness');
        t.require(/usage/i.test(t.states.at(-1).error), 'Native failure lost its explanation');
        t.require(t.harness.current.terminated, 'Failed renderer retained its worker');
        t.require(t.gpu.devices.every(device => t.gpu.destroyedDevices.includes(device)), 'Failed renderer retained its device');
        await t.rejects(() => t.renderer.render({ seed: 'must-not-apply' }), 'Failed renderer accepted rendering');
        await t.rejects(() => t.renderer.capture(), 'Failed renderer accepted capture');
        t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Rejected work changed a failed scene');
      });
    },
  },
  {
    name: 'native device loss is terminal and a fresh canvas reproduces the scene',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.states = [];
        t.renderer.subscribe(state => t.states.push(state.status));
        await t.command('lose-device');
      });
      await page.waitForFunction(() => window.test.renderer.getStatus() === 'device-lost');
      await page.evaluate(async () => {
        const t = window.test, before = JSON.stringify(t.renderer.getOptions());
        t.require(t.states.join(',') === 'ready,device-lost', 'Device loss published false readiness');
        await t.rejects(() => t.renderer.render({ seed: 'must-not-apply' }), 'Lost device accepted rendering');
        t.require(JSON.stringify(t.renderer.getOptions()) === before, 'Rejected work changed a lost scene');
        t.renderer.dispose();
        const reuse = await t.rejects(() => t.api.createLandscape(t.canvas), 'Transferred canvas was reused');
        t.require(/fresh canvas/i.test(reuse.message), 'Device-loss recovery did not explain canvas replacement');
        t.renderer = await t.api.createLandscape(t.freshCanvas(), {
          width: 320, height: 256, pixelRatio: 0.25, cameraY: 160, seed: 'browser-validation',
        });
        t.require(t.hash(await t.pixels()) === t.hash(t.initial), 'Fresh recreation changed the seeded scene');
      });
    },
  },
  {
    name: 'disposal suppresses a pending device-loss transition',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, states = [];
      t.renderer.subscribe(state => states.push(state.status));
      const loss = t.command('lose-device').catch(() => {});
      t.renderer.dispose();
      await loss;
      await t.harness.terminated();
      t.require(t.renderer.getStatus() === 'disposed', 'Late loss revived a disposed renderer');
      t.require(states.join(',') === 'ready,disposed', 'Disposed renderer emitted a late transition');
    }),
  },
  {
    name: 'disposal releases each device and fresh canvases support repeated mounting',
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, notifications = [];
      const unsubscribe = t.renderer.subscribe(state => notifications.push(state.status));
      unsubscribe();
      t.renderer.dispose(); t.renderer.dispose();
      await t.harness.terminated();
      t.require(notifications.join(',') === 'ready', 'Unsubscribe retained its listener');
      await t.rejects(() => t.renderer.render(), 'Disposed renderer accepted rendering');
      for (let i = 0; i < 3; i++) {
        const instance = await t.api.createLandscape(t.freshCanvas(), { width: 200, height: 160, pixelRatio: 0.25, seed: 'remount' });
        await t.rejects(() => t.api.createLandscape(t.canvas), 'Two renderers claimed one canvas');
        instance.dispose();
        await t.harness.terminated();
      }
      for (const worker of t.harness.workers) {
        const gpu = worker.metrics;
        t.require(gpu.devices.every(device => gpu.destroyedDevices.includes(device)), 'Mounted renderer leaked a device');
        t.require(gpu.buffers.every(({ buffer, device }) => gpu.destroyedBuffers.includes(buffer) || gpu.destroyedDevices.includes(device)), 'Buffer outlived its renderer');
      }
    }),
  },
  {
    name: 'concurrent initialization claims a canvas before its first await',
    createRenderer: false,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const outcomes = await Promise.allSettled([
        t.api.createLandscape(t.canvas, { width: 200, height: 160, pixelRatio: 0.25 }),
        t.api.createLandscape(t.canvas, { width: 200, height: 160, pixelRatio: 0.25 }),
      ]);
      if (outcomes[0].status === 'fulfilled') t.renderer = outcomes[0].value;
      if (outcomes[1].status === 'fulfilled') outcomes[1].value.dispose();
      t.require(outcomes[0].status === 'fulfilled', `First initialization failed: ${outcomes[0].reason}`);
      t.require(outcomes[1].status === 'rejected', 'Concurrent initialization created two owners');
      t.require(t.harness.workers.length === 1, 'Rejected initialization acquired a redundant worker');
    }),
  },
  {
    name: 'unsupported worker WebGPU is detected before transfer and supports retry',
    createRenderer: false,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.harness.nextConfiguration = { noAdapter: true };
      t.require(!(await t.api.isWebGPUSupported()), 'Unavailable worker reported WebGPU support');
      t.harness.nextConfiguration = { noAdapter: true };
      await t.rejects(() => t.api.createLandscape(t.canvas), 'Unsupported worker accepted the canvas');
      t.renderer = await t.api.createLandscape(t.canvas, { width: 200, height: 160, pixelRatio: 0.25 });
      t.require(t.renderer.getStatus() === 'ready', 'Support failure consumed the canvas');
    }),
  },
  failedInitialization('worker startup failure leaves the untransferred canvas reusable', { scriptFailure: true }),
  failedInitialization('device acquisition failure after transfer requires a fresh canvas', { deviceFailure: true }),
  failedInitialization('pipeline failure releases resources and requires a fresh canvas', { pipelineFailure: true }),
  failedInitialization('first-frame failure rejects readiness and releases resources',
    { firstFrameFailure: 'Deliberate first-frame failure' }, [/Deliberate first-frame failure/]),
  {
    name: 'an existing 2D context reports an actionable transfer error',
    createRenderer: false,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.canvas.getContext('2d');
      const error = await t.rejects(() => t.api.createLandscape(t.canvas), 'Context-bound canvas transferred');
      t.require(/fresh canvas.*context/i.test(error.message), 'Missing context-transfer explanation');
      t.require(t.harness.current.metrics.devices.length === 0, 'Transfer failure unnecessarily acquired a device');
    }),
  },
  {
    name: 'worker crashes reject active and queued requests without reviving the session',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        await t.command('hold-fence');
        const render = t.renderer.render({ cameraY: 200 });
        const capture = t.renderer.capture();
        const next = t.renderer.render({ cameraY: 240 });
        t.outcomes = Promise.allSettled([render, capture, next]);
      });
      await page.waitForFunction(() => window.workerHarness.current.events.some(event => event.name === 'fence-held'));
      await page.evaluate(() => window.test.command('crash'));
      await page.evaluate(async () => {
        const t = window.test, outcomes = await t.outcomes;
        t.require(outcomes.every(outcome => outcome.status === 'rejected'), 'Worker crash left successful or unsettled requests');
        t.require(t.renderer.getStatus() === 'error', 'Worker crash retained readiness');
        t.require(t.harness.current.terminated, 'Worker crash retained its worker');
        t.require(t.gpu.devices.every(device => t.gpu.destroyedDevices.includes(device)), 'Worker crash retained its device');
        t.renderer.dispose();
        t.renderer = await t.api.createLandscape(t.freshCanvas(), { width: 200, height: 160, pixelRatio: 0.25 });
        t.require(t.renderer.getStatus() === 'ready', 'Fresh canvas did not recover after a crash');
      });
    },
  },
];
