export const lifecycleScenarios = [
  {
    name: 'native validation failure publishes error and releases renderer resources',
    observeGPU: true,
    expectedGPUErrors: [/usage/i],
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.states = [];
        t.renderer.subscribe(state => t.states.push({ status: state.status, error: state.error?.message ?? null }));
        // A real native validation failure, outside vgpu's own error scopes.
        const device = t.gpu.devices[0];
        device.createBuffer({ size: 4, usage: 0 });
        await device.queue.onSubmittedWorkDone().catch(() => {});
      });
      await page.waitForFunction(() => window.test.renderer.getStatus() === 'error');
      await page.evaluate(async () => {
        const t = window.test, before = JSON.stringify(t.renderer.getOptions());
        t.require(t.states.map(state => state.status).join(',') === 'ready,error', 'Native failure published false readiness');
        t.require(/usage/i.test(t.states.at(-1).error), 'Native failure did not preserve its explanation');
        t.require(t.gpu.destroyedDevices.has(t.gpu.devices[0]), 'Failed renderer retained its native device');
        let rejected = false;
        try { t.renderer.render({ seed: 'must-not-apply' }); } catch { rejected = true; }
        t.require(rejected, 'An errored renderer accepted rendering');
        rejected = false;
        try { await t.renderer.capture(); } catch { rejected = true; }
        t.require(rejected, 'An errored renderer accepted capture');
        t.require(JSON.stringify(t.renderer.getOptions()) === before, 'A rejected render changed the failed scene');
      });
    },
  },
  {
    name: 'native device loss is terminal and explicit recreation reproduces the scene',
    observeGPU: true,
    async run({ page }) {
      await page.evaluate(() => {
        const t = window.test;
        t.states = [];
        t.renderer.subscribe(state => t.states.push({ status: state.status, error: state.error?.message ?? null }));
        t.lostDevice = t.gpu.devices[0];
        t.lostDevice.destroy();
      });
      await page.waitForFunction(() => window.test.renderer.getStatus() === 'device-lost');
      await page.evaluate(async () => {
        const t = window.test, before = JSON.stringify(t.renderer.getOptions());
        t.require(t.states.map(state => state.status).join(',') === 'ready,device-lost', 'Device loss published false readiness');
        t.require(t.states.at(-1).error, 'Device loss did not describe its cause');
        let rejected = false;
        try { t.renderer.render({ seed: 'must-not-apply' }); } catch { rejected = true; }
        t.require(rejected, 'A lost device accepted rendering');
        rejected = false;
        try { await t.renderer.capture(); } catch { rejected = true; }
        t.require(rejected, 'A lost device accepted capture');
        t.require(JSON.stringify(t.renderer.getOptions()) === before, 'A rejected render changed the lost scene');
        t.renderer.dispose();
        t.renderer = await t.api.createLandscape(t.canvas, { width: 320, height: 256, seed: 'browser-validation' });
        t.require(t.renderer.getStatus() === 'ready', 'Explicit recreation did not restore readiness');
        t.require(t.gpu.devices.at(-1) !== t.lostDevice, 'Recreation reused the destroyed device');
        t.require(t.hash(await t.pixels()) === t.hash(t.initial), 'Recreation changed the seeded scene');
      });
    },
  },
  {
    name: 'disposal while device loss is pending cannot reactivate resources or subscribers',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, device = t.gpu.devices[0];
      const states = [];
      t.renderer.subscribe(state => states.push(state.status));
      const count = t.gpu.devices.length;
      device.destroy();
      t.renderer.dispose();
      await device.lost;
      await new Promise(resolve => setTimeout(resolve, 0));
      t.require(t.renderer.getStatus() === 'disposed', 'A late device-loss callback reactivated the renderer');
      t.require(t.gpu.devices.length === count, 'Disposed renderer acquired another device');
      t.require(states.join(',') === 'ready,disposed', 'Disposed renderer published a late lifecycle transition');
    }),
  },
  {
    name: 'dispose releases the owned device and supports repeated mounting',
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, device = t.gpu.devices[0];
      const notifications = [];
      const unsubscribe = t.renderer.subscribe(state => notifications.push(state.status));
      unsubscribe();
      t.renderer.dispose(); t.renderer.dispose();
      t.require(t.gpu.destroyedDevices.has(device), 'Dispose retained its native device');
      t.require(notifications.join(',') === 'ready', 'Unsubscribe retained a listener');
      let rejected = false;
      try { t.renderer.render(); } catch { rejected = true; }
      t.require(rejected, 'Disposed renderer accepted rendering');
      const old = t.renderer;
      for (let i = 0; i < 3; i++) {
        const instance = await t.api.createLandscape(t.canvas, { width: 200, height: 160, seed: 'remount' });
        let duplicate = false;
        try { await t.api.createLandscape(t.canvas); } catch { duplicate = true; }
        t.require(duplicate, 'Two renderers claimed one canvas');
        instance.dispose();
      }
      t.require(t.gpu.devices.every(owned => t.gpu.destroyedDevices.has(owned)), 'A mounted renderer leaked its native device');
      t.require(t.gpu.buffers.every(({ buffer, device: owner }) => t.gpu.destroyedBuffers.has(buffer) || t.gpu.destroyedDevices.has(owner)), 'A buffer outlived its renderer');
      await Promise.all(t.gpu.devices.map(owned => owned.lost));
      t.require(old.getStatus() === 'disposed', 'Disposed renderer retained lifecycle callbacks');
    }),
  },
  {
    name: 'concurrent initialization claims the canvas before its first await',
    createRenderer: false,
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      const outcomes = await Promise.allSettled([
        t.api.createLandscape(t.canvas, { width: 200, height: 160 }),
        t.api.createLandscape(t.canvas, { width: 200, height: 160 }),
      ]);
      if (outcomes[0].status === 'fulfilled') t.renderer = outcomes[0].value;
      if (outcomes[1].status === 'fulfilled') outcomes[1].value.dispose();
      t.require(outcomes[0].status === 'fulfilled', `First initialization failed: ${outcomes[0].reason}`);
      t.require(outcomes[1].status === 'rejected', 'Concurrent initialization created two owners');
      t.require(t.gpu.devices.length === 1, 'Rejected initialization acquired a redundant native device');
    }),
  },
  {
    name: 'device acquisition failure releases canvas ownership for retry',
    createRenderer: false,
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, original = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async () => { throw new Error('Deliberate device allocation failure'); };
      let error;
      try { await t.api.createLandscape(t.canvas); } catch (cause) { error = cause; }
      finally { GPUAdapter.prototype.requestDevice = original; }
      t.require(error instanceof Error, 'Failed acquisition did not reject initialization');
      t.require(t.gpu.devices.length === 0, 'Failed acquisition retained a device');
      t.renderer = await t.api.createLandscape(t.canvas, { width: 200, height: 160 });
      t.require(t.renderer.getStatus() === 'ready', 'Failed acquisition retained canvas ownership');
    }),
  },
  {
    name: 'asynchronous pipeline failure frees resources and allows initialization retry',
    createRenderer: false,
    observeGPU: true,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, original = GPUDevice.prototype.createRenderPipelineAsync;
      GPUDevice.prototype.createRenderPipelineAsync = async () => { throw new Error('Deliberate pipeline compilation failure'); };
      let error;
      try { await t.api.createLandscape(t.canvas, { width: 200, height: 160 }); } catch (cause) { error = cause; }
      finally { GPUDevice.prototype.createRenderPipelineAsync = original; }
      t.require(error instanceof Error, 'Pipeline compilation failure did not reject initialization');
      t.require(t.gpu.devices.length > 0, 'Failure test never acquired a native device');
      t.require(t.gpu.devices.every(device => t.gpu.destroyedDevices.has(device)), 'Failed initialization leaked its native device');
      t.require(t.gpu.buffers.every(({ buffer, device }) => t.gpu.destroyedBuffers.has(buffer) || t.gpu.destroyedDevices.has(device)), 'Failed initialization leaked GPU buffers');
      t.renderer = await t.api.createLandscape(t.canvas, { width: 200, height: 160 });
      t.require(t.renderer.getStatus() === 'ready', 'Pipeline failure retained canvas ownership');
    }),
  },
  {
    name: 'first-frame native failure rejects initialization and releases ownership for retry',
    createRenderer: false,
    observeGPU: true,
    expectedGPUErrors: [/Deliberate first-frame failure/],
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test, submit = GPUQueue.prototype.submit;
      let submitted = false, error, initialized;
      GPUQueue.prototype.submit = function (...args) {
        const result = submit.apply(this, args);
        if (!submitted) {
          submitted = true;
          const device = t.gpu.devices.at(-1);
          queueMicrotask(() => device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', {
            error: new GPUValidationError('Deliberate first-frame failure'),
          })));
        }
        return result;
      };
      try { initialized = await t.api.createLandscape(t.canvas, { width: 200, height: 160 }); }
      catch (cause) { error = cause; }
      finally {
        GPUQueue.prototype.submit = submit;
        initialized?.dispose();
      }
      t.require(submitted && t.gpu.draws.length === 1, 'Initialization never submitted its first landscape frame');
      t.require(error instanceof Error, 'First-frame failure returned a ready renderer');
      t.require(/Deliberate first-frame failure/.test(error.message), 'Initialization lost the native failure reason');
      t.require(t.gpu.devices.every(device => t.gpu.destroyedDevices.has(device)), 'First-frame failure leaked its native device');
      t.require(t.gpu.buffers.every(({ buffer, device }) => t.gpu.destroyedBuffers.has(buffer) || t.gpu.destroyedDevices.has(device)), 'First-frame failure leaked GPU buffers');
      t.renderer = await t.api.createLandscape(t.canvas, { width: 200, height: 160 });
      t.require(t.renderer.getStatus() === 'ready', 'First-frame failure retained canvas ownership');
      t.require(t.gpu.devices.length === 2, 'Retry did not acquire a fresh native device');
    }),
  },
  {
    name: 'a canvas already using 2D reports an actionable WebGPU context error',
    createRenderer: false,
    run: ({ page }) => page.evaluate(async () => {
      const t = window.test;
      t.canvas.getContext('2d');
      let message = '';
      try { await t.api.createLandscape(t.canvas); } catch (error) { message = error.message; }
      t.require(/WebGPU|context|surface/i.test(message), 'Missing context failure explanation');
    }),
  },
];
