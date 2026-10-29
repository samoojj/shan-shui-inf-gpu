export const lifecycleScenarios = [
  {
    name: 'context restoration automatically redraws retained settings and publishes readiness',
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test;
        t.states = [];
        t.renderer.subscribe(state => t.states.push({ status: state.status, error: state.error?.message ?? null }));
        t.renderer.render({ seed: 'restoration', cameraX: 300 });
        t.expected = t.hash(t.pixels());
        t.lose = t.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
        t.require(!!t.lose, 'Context-loss extension is unavailable');
        t.restored = null;
        t.canvas.addEventListener('webglcontextrestored', () => {
          // Observe the automatic draw within this task, before the browser clears its buffer.
          t.restored = { status: t.renderer.getStatus(), hash: t.hash(t.pixels()) };
        }, { once: true });
        const lost = new Promise(resolve => t.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
        t.lose.loseContext(); await lost;
        t.require(t.renderer.getStatus() === 'context-lost', 'Loss status missing');
        t.renderer.render({ seed: 'temporary' });
        t.renderer.render({ seed: 'restoration', cameraX: 300 });
      });
      await page.evaluate(() => window.test.lose.restoreContext());
      await page.waitForFunction(() => window.test.restored !== null);
      await page.evaluate(() => {
        const t = window.test;
        t.require(t.restored.status === 'ready', 'Renderer was not ready in restored event');
        t.require(t.restored.hash === t.expected, 'Automatic restoration did not redraw the retained scene');
        t.require(JSON.stringify(t.states.map(state => state.status)) === JSON.stringify(['ready', 'context-lost', 'ready']), 'Wrong lifecycle transition sequence');
        t.require(t.states.every(state => state.error === null), 'Successful transitions carry an error');
      });
    },
  },
  {
    name: 'failed restoration publishes an error and never reports false readiness',
    observeGPU: true,
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test, gl = t.canvas.getContext('webgl2');
        t.states = [];
        t.renderer.subscribe(state => t.states.push({ status: state.status, error: state.error?.message ?? null }));
        t.lose = gl.getExtension('WEBGL_lose_context');
        const lost = new Promise(resolve => t.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
        t.lose.loseContext(); await lost;
        t.savedCreateProgram = gl.createProgram;
        gl.createProgram = () => null;
      });
      await page.evaluate(() => window.test.lose.restoreContext());
      await page.waitForFunction(() => window.test.renderer.getStatus() === 'error');
      await page.evaluate(async () => {
        const t = window.test, gl = t.canvas.getContext('webgl2');
        gl.createProgram = t.savedCreateProgram;
        t.require(t.states.map(state => state.status).join(',') === 'ready,context-lost,error', 'Recovery published false readiness');
        t.require(typeof t.states.at(-1).error === 'string' && t.states.at(-1).error.length > 0, 'Recovery failure did not describe its cause');
        let rejected = false;
        try { await t.renderer.capture(); } catch { rejected = true; }
        t.require(rejected, 'Capture accepted a failed renderer');
        rejected = false;
        try { t.renderer.render(); } catch { rejected = true; }
        t.require(rejected, 'Render accepted a failed renderer');
        t.renderer.dispose();
        t.renderer = t.api.createLandscape(t.canvas, { width: 200, height: 160 });
        t.require(t.renderer.getStatus() === 'ready', 'Failed renderer retained canvas ownership');
      });
    },
  },
  {
    name: 'disposal during context loss cannot reactivate resources or subscribers',
    observeGPU: true,
    async run({ page }) {
      await page.evaluate(async () => {
        const t = window.test, gl = t.canvas.getContext('webgl2');
        t.states = [];
        t.renderer.subscribe(state => t.states.push(state.status));
        t.lose = gl.getExtension('WEBGL_lose_context');
        const lost = new Promise(resolve => t.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
        t.lose.loseContext(); await lost;
        t.renderer.dispose();
        t.count = t.gpu.counters.createProgram;
        t.restoreEvent = false;
        t.canvas.addEventListener('webglcontextrestored', () => { t.restoreEvent = true; }, { once: true });
      });
      await page.evaluate(() => window.test.lose.restoreContext());
      await page.waitForFunction(() => window.test.restoreEvent);
      await page.evaluate(() => {
        const t = window.test;
        t.require(t.renderer.getStatus() === 'disposed', 'Disposed renderer reactivated');
        t.require(t.gpu.counters.createProgram === t.count, 'Disposed renderer recreated GPU resources');
        t.require(t.states.join(',') === 'ready,context-lost,disposed', 'Disposed renderer retained lifecycle listeners');
      });
    },
  },
  {
    name: 'dispose actually releases GPU resources and allows repeated mounting',
    observeGPU: true,
    run: ({ page }) => page.evaluate(() => {
      const t = window.test, gl = t.canvas.getContext('webgl2');
      const program = gl.getParameter(gl.CURRENT_PROGRAM), vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const notifications = [];
      const unsubscribe = t.renderer.subscribe(state => notifications.push(state.status));
      unsubscribe();
      t.renderer.dispose(); t.renderer.dispose();
      t.require(gl.getParameter(gl.CURRENT_PROGRAM) === null && !gl.isProgram(program), 'Disposed program remains live');
      t.require(!gl.isVertexArray(vao), 'Disposed vertex array remains live');
      t.require(notifications.join(',') === 'ready', 'Unsubscribe did not detach the listener');
      let rejected = false;
      try { t.renderer.render(); } catch { rejected = true; }
      t.require(rejected, 'Disposed renderer accepted rendering');
      const old = t.renderer, before = { ...t.gpu.counters };
      for (let i = 0; i < 3; i++) {
        const instance = t.api.createLandscape(t.canvas, { width: 200, height: 160, seed: 'remount' });
        let duplicate = false;
        try { t.api.createLandscape(t.canvas); } catch { duplicate = true; }
        t.require(duplicate, 'Two renderers claimed one canvas');
        instance.dispose();
      }
      for (const [create, remove] of [['createProgram', 'deleteProgram'], ['createShader', 'deleteShader'], ['createVertexArray', 'deleteVertexArray']]) {
        t.require(t.gpu.counters[create] - before[create] === t.gpu.counters[remove] - before[remove], `${create} resources leaked`);
      }
      t.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      t.canvas.dispatchEvent(new Event('webglcontextrestored'));
      t.require(old.getStatus() === 'disposed', 'Disposed renderer retained context listeners');
    }),
  },
  {
    name: 'partial initialization failure releases resources and leaves the canvas reusable',
    createRenderer: false,
    observeGPU: true,
    run: ({ page }) => page.evaluate(() => {
      const t = window.test, gl = t.canvas.getContext('webgl2');
      const original = gl.createVertexArray;
      gl.createVertexArray = () => null;
      let error;
      try { t.api.createLandscape(t.canvas, { width: 200, height: 160 }); } catch (cause) { error = cause; }
      finally { gl.createVertexArray = original; }
      t.require(error instanceof Error, 'Allocation failure was not reported');
      t.require(gl.getParameter(gl.CURRENT_PROGRAM) === null, 'Failed construction left a current program');
      for (const shader of t.gpu.resources.shaders) t.require(!gl.isShader(shader), 'Partial construction leaked a shader');
      for (const program of t.gpu.resources.programs) t.require(!gl.isProgram(program), 'Partial construction leaked a program');
      t.renderer = t.api.createLandscape(t.canvas, { width: 200, height: 160 });
      t.require(t.renderer.getStatus() === 'ready', 'Failed construction retained canvas ownership');
    }),
  },
  {
    name: 'shader compilation failure cleans up the earlier successful allocations',
    createRenderer: false,
    observeGPU: true,
    run: ({ page }) => page.evaluate(() => {
      const t = window.test, gl = t.canvas.getContext('webgl2');
      const original = gl.shaderSource;
      gl.shaderSource = function (shader, source) {
        original.call(this, shader, this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER ? '#version 300 es\ninvalid GLSL;' : source);
      };
      let error;
      try { t.api.createLandscape(t.canvas); } catch (cause) { error = cause; }
      finally { gl.shaderSource = original; }
      t.require(error instanceof Error && /shader/i.test(error.message), 'Shader failure lost its explanation');
      for (const shader of t.gpu.resources.shaders) t.require(!gl.isShader(shader), 'Compilation failure leaked a shader');
      for (const program of t.gpu.resources.programs) t.require(!gl.isProgram(program), 'Compilation failure leaked a program');
      t.renderer = t.api.createLandscape(t.canvas, { width: 200, height: 160 });
      t.require(t.renderer.getStatus() === 'ready', 'Shader failure prevented retry');
    }),
  },
  {
    name: 'a canvas already using 2D reports an actionable context error',
    createRenderer: false,
    run: ({ page }) => page.evaluate(() => {
      const t = window.test;
      t.canvas.getContext('2d');
      let message = '';
      try { t.api.createLandscape(t.canvas); } catch (error) { message = error.message; }
      t.require(/WebGL2/.test(message), 'Missing context failure explanation');
    }),
  },
];
