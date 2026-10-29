// Instrument native APIs in the owning worker. Nothing is added to the public API.
const parameters = new URL(location.href).searchParams;
const configuration = JSON.parse(parameters.get('configuration') || '{}');
if (configuration.scriptFailure) throw new Error('Deliberate worker startup failure');
const nativePost = self.postMessage.bind(self);
const startupMessages = [];
let runtimeLoaded = false;
const devices = [], ids = new WeakMap();
let nextId = 0, nextSubmitError = configuration.firstFrameFailure, failEncoding = false;
let holdEncoding = false, heldEncoding, holdFence = false;
const fences = [];
const gpu = { counters: {}, writes: [], draws: [], dispatches: [], buffers: [], adapterInfo: [], errors: [],
  destroyedDevices: [], destroyedBuffers: [], operations: [], timings: [], uploadedBytes: 0, liveBufferBytes: 0, peakBufferBytes: 0 };
const identify = value => {
  if (!ids.has(value)) ids.set(value, ++nextId);
  return ids.get(value);
};
function wrap(prototype, name, replacement) {
  prototype[name] = replacement(prototype[name]);
}
function metrics() { return { ...gpu, devices: devices.map(identify), workerNow: performance.now(), timeOrigin: performance.timeOrigin }; }
function publish() { nativePost({ type: 'test:metrics', metrics: metrics() }); }
self.postMessage = (message, transfer) => {
  if (!message.type.startsWith('test:')) {
    const operation = [...gpu.operations].reverse().find(item => !item.completedAt &&
      (message.type === 'ready' ? item.type === 'initialize' : item.revision === message.revision));
    if (operation) operation.completedAt = performance.now();
    publish();
  }
  if (transfer === undefined) nativePost(message);
  else nativePost(message, transfer);
};
if (configuration.noAdapter) navigator.gpu.requestAdapter = async () => null;
wrap(GPUAdapter.prototype, 'requestDevice', original => async function (...args) {
  if (configuration.deviceFailure) throw new Error('Deliberate device allocation failure');
  const device = await original.apply(this, args);
  devices.push(device);
  gpu.adapterInfo.push({ vendor: this.info.vendor, architecture: this.info.architecture, description: this.info.description });
  device.addEventListener('uncapturederror', event => gpu.errors.push(event.error.message));
  return device;
});
for (const [prototype, names] of [
  [GPUDevice.prototype, ['createBuffer', 'createTexture', 'createRenderPipelineAsync', 'createComputePipelineAsync']],
  [GPUQueue.prototype, ['submit', 'writeBuffer', 'writeTexture', 'copyExternalImageToTexture']],
  [GPURenderPassEncoder.prototype, ['draw', 'drawIndirect']],
  [GPUComputePassEncoder.prototype, ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']],
  [GPUCommandEncoder.prototype, ['beginComputePass', 'beginRenderPass', 'copyTextureToBuffer', 'copyBufferToBuffer']],
  [GPUBuffer.prototype, ['mapAsync']],
]) {
  for (const name of names) {
    gpu.counters[name] = 0;
    wrap(prototype, name, original => function (...args) {
      gpu.counters[name]++;
      if (configuration.pipelineFailure && name === 'createRenderPipelineAsync') {
        return Promise.reject(new Error('Deliberate pipeline compilation failure'));
      }
      const start = performance.now();
      const result = original.apply(this, args);
      gpu.timings.push({ name, start, end: performance.now() });
      if (name === 'createBuffer') {
        gpu.buffers.push({ ...args[0], buffer: identify(result), device: identify(this) });
        gpu.liveBufferBytes += args[0].size;
        gpu.peakBufferBytes = Math.max(gpu.peakBufferBytes, gpu.liveBufferBytes);
      }
      if (name === 'writeBuffer') {
        const data = args[2];
        const bytes = args[4] === undefined ? data.byteLength : args[4] * (data.BYTES_PER_ELEMENT || 1);
        gpu.writes.push({ buffer: identify(args[0]), bytes });
        gpu.uploadedBytes += bytes;
      }
      if (name === 'draw') gpu.draws.push(args);
      if (name === 'drawIndirect') gpu.draws.push(['indirect', identify(args[0]), args[1]]);
      if (name === 'dispatchWorkgroups') gpu.dispatches.push(args);
      if (name === 'submit' && nextSubmitError) {
        const message = String(nextSubmitError);
        nextSubmitError = false;
        queueMicrotask(() => devices.at(-1).dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', {
          error: new GPUValidationError(message),
        })));
      }
      return result;
    });
  }
}
wrap(GPUQueue.prototype, 'onSubmittedWorkDone', original => async function (...args) {
  await original.apply(this, args);
  if (holdFence) {
    nativePost({ type: 'test:event', name: 'fence-held' });
    await new Promise(resolve => fences.push(resolve));
  }
});
wrap(GPUDevice.prototype, 'destroy', original => function (...args) {
  gpu.destroyedDevices.push(identify(this));
  return original.apply(this, args);
});
wrap(GPUBuffer.prototype, 'destroy', original => function (...args) {
  const id = identify(this);
  if (!gpu.destroyedBuffers.includes(id)) gpu.liveBufferBytes -= gpu.buffers.find(buffer => buffer.buffer === id)?.size ?? 0;
  gpu.destroyedBuffers.push(id);
  return original.apply(this, args);
});
wrap(OffscreenCanvas.prototype, 'convertToBlob', original => function (...args) {
  nativePost({ type: 'test:event', name: 'encoding-started' });
  if (failEncoding) { failEncoding = false; return Promise.reject(new Error('Deliberate PNG encoding failure')); }
  const encoding = original.apply(this, args);
  if (!holdEncoding) return encoding;
  holdEncoding = false;
  // Start the real browser snapshot now and separately delay delivery of its result.
  return new Promise((resolve, reject) => {
    const observed = encoding.then(blob => ({ blob }), error => ({ error }));
    heldEncoding = {
      async release() { const result = await observed; if (result.error) reject(result.error); else resolve(result.blob); },
      reject() { reject(new Error('Deliberate delayed PNG encoding failure')); },
    };
  });
});
self.addEventListener('message', ({ data }) => {
  if (!runtimeLoaded && !data.type.startsWith('test:')) {
    startupMessages.push(data);
    return;
  }
  if (['initialize', 'render', 'capture'].includes(data.type)) {
    gpu.operations.push({ type: data.type, revision: data.revision, options: data.options, startedAt: performance.now() });
  }
  if (data.type !== 'test:command') return;
  try {
    let value;
    switch (data.command) {
      case 'metrics': value = metrics(); break;
      case 'lose-device': devices.at(-1).destroy(); break;
      case 'validation-error':
        devices.at(-1).createBuffer({ size: 4, usage: 0 });
        // Flush the native timeline so Chromium delivers the uncaptured event.
        void devices.at(-1).queue.onSubmittedWorkDone().catch(() => {});
        break;
      case 'next-submit-error': nextSubmitError = data.args.message; break;
      case 'fail-encoding': failEncoding = true; break;
      case 'hold-encoding': holdEncoding = true; break;
      case 'release-encoding': void heldEncoding?.release(); break;
      case 'reject-encoding': heldEncoding?.reject(); break;
      case 'hold-fence': holdFence = true; break;
      case 'release-fence': holdFence = false; for (const resolve of fences.splice(0)) resolve(); break;
      case 'crash': setTimeout(() => { throw new Error('Deliberate worker execution failure'); }, 0); break;
      case 'stale-completion': nativePost({ type: 'rendered', revision: data.args.revision }); break;
      default: throw new Error(`Unknown worker test command: ${data.command}`);
    }
    nativePost({ type: 'test:reply', id: data.id, value });
  } catch (error) { nativePost({ type: 'test:reply', id: data.id, error: error.message }); }
});
await import(parameters.get('target'));
runtimeLoaded = true;
for (const data of startupMessages) self.dispatchEvent(new MessageEvent('message', { data }));
