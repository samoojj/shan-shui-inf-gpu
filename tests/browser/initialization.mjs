export const initializationScenarios = [
  {
    name: 'initialization AbortSignal cancels real GPU construction without a renderer handle',
    createRenderer: false,
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.controller = new AbortController();
        t.creation = t.api.createLandscape(t.canvas, {
          seed: 'browser-validation', width: 320, height: 256, pixelRatio: 0.25, cameraY: 160,
        }, { signal: t.controller.signal }).then(
          renderer => { t.renderer = renderer; return { status: 'fulfilled' }; },
          error => ({ status: 'rejected', name: error.name }),
        );
        // Instrumentation handles this command while the runtime is still loading.
        await t.command('hold-fence');
      });
      await page.waitForFunction(() => window.workerHarness.current.events.some(event => event.name === 'fence-held'));
      await page.evaluate(async () => {
        const t = window.test;
        t.controller.abort();
        const outcome = await t.creation;
        t.require(outcome.status === 'rejected' && outcome.name === 'AbortError', 'First-frame cancellation did not reject with AbortError');
        t.require(t.renderer === null, 'Cancellation required a returned renderer handle');
        await t.harness.terminated();
        await t.rejects(() => t.api.createLandscape(t.canvas), 'An aborted transferred canvas was reused');
        t.require(t.harness.current.terminated, 'Aborted initialization retained a live worker');
      });
    },
  },
];
