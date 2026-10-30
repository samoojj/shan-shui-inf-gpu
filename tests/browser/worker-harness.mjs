/** Installed in each test page, including navigations to the public demo. */
export function installWorkerHarness() {
  const NativeWorker = window.Worker;
  const harness = window.workerHarness = {
    workers: [], nextConfiguration: {}, nextCommand: 0, timeOrigin: performance.timeOrigin,
    mainGPU: { requestAdapter: 0, requestDevice: 0 },
    get current() { return this.workers.at(-1); },
    command(command, args = {}, record = this.current) {
      const id = ++this.nextCommand;
      return new Promise((resolve, reject) => {
        if (!record || record.terminated) { reject(new Error('Test worker is already terminated')); return; }
        const timer = setTimeout(() => {
          record.commands.delete(id);
          reject(new Error(`Worker test command timed out: ${command}`));
        }, 15000);
        record.commands.set(id, {
          resolve(value) { clearTimeout(timer); resolve(value); },
          reject(error) { clearTimeout(timer); reject(error); },
        });
        record.worker.postMessage({ type: 'test:command', id, command, args });
      });
    },
    async terminated() {
      const started = performance.now();
      while (this.workers.some(worker => !worker.terminated)) {
        if (performance.now() - started > 10000) throw new Error('A landscape worker survived disposal');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
  };
  for (const [prototype, name] of [[globalThis.GPU?.prototype, 'requestAdapter'], [globalThis.GPUAdapter?.prototype, 'requestDevice']]) {
    if (!prototype) continue;
    const original = prototype[name];
    prototype[name] = function (...args) {
      harness.mainGPU[name]++;
      return original.apply(this, args);
    };
  }
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const target = new URL(url, location.href);
      const instrumented = target.pathname.endsWith('/runtime/worker.js');
      const fixture = new URL('/tests/browser/instrumented-worker.mjs', location.href);
      fixture.searchParams.set('target', target.href);
      fixture.searchParams.set('configuration', JSON.stringify(harness.nextConfiguration));
      super(instrumented ? fixture : target, options);
      if (!instrumented) return;
      harness.nextConfiguration = {};
      this.record = { worker: this, terminated: false, commands: new Map(), requests: [], events: [], responses: [], metrics: null };
      harness.workers.push(this.record);
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'test:metrics') this.record.metrics = data.metrics;
        else if (data.type === 'test:event') this.record.events.push(data);
        else if (data.type === 'test:reply') {
          const command = this.record.commands.get(data.id);
          this.record.commands.delete(data.id);
          if (data.error) command?.reject(new Error(data.error));
          else command?.resolve(data.value);
        } else this.record.responses.push(data);
      });
    }
    postMessage(message, transfer) {
      if (this.record && !message.type.startsWith('test:')) {
        this.record.requests.push({ type: message.type, revision: message.revision,
          options: message.options, sentAt: performance.now() });
      }
      if (transfer === undefined) super.postMessage(message);
      else super.postMessage(message, transfer);
    }
    terminate() {
      if (this.record) {
        this.record.terminated = true;
        for (const command of this.record.commands.values()) command.reject(new Error('Test worker terminated'));
        this.record.commands.clear();
      }
      super.terminate();
    }
  };
}
