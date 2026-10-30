import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLandscape } from '../dist/index.js';

// Exercise the public facade's actual asynchronous setup without acquiring a GPU.
class SetupWorker extends EventTarget {
  terminated = false;
  requests = [];
  constructor({ support = true, initialize } = {}) { super(); this.support = support; this.initialize = initialize; }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  postMessage(message) {
    this.requests.push(message);
    if (message.type === 'probe' && this.support) queueMicrotask(() => this.reply({ type: 'support', supported: true }));
    if (message.type === 'initialize') {
      if (this.initialize) this.initialize();
      else queueMicrotask(() => this.reply({ type: 'ready' }));
    }
    if (message.type === 'dispose') queueMicrotask(() => this.reply({ type: 'disposed' }));
  }
  terminate() { this.terminated = true; }
}
function canvas() {
  return { width: 320, height: 256, transfers: 0, getContext() {}, transferControlToOffscreen() { this.transfers++; return {}; } };
}

test('runtime worker factories and initialization cancellation preserve canvas ownership', async t => {
  const original = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {};
  t.after(() => { if (original === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = original; });

  const pre = new AbortController(), untouched = canvas();
  pre.abort();
  await assert.rejects(createLandscape(untouched, {}, { signal: pre.signal, workerFactory() { throw new Error('must not create'); } }), { name: 'AbortError' });
  assert.equal(untouched.transfers, 0);

  const probe = new AbortController(), retryable = canvas(), heldProbe = new SetupWorker({ support: false });
  const probing = createLandscape(retryable, {}, { signal: probe.signal, workerFactory: () => heldProbe });
  probe.abort();
  await assert.rejects(probing, { name: 'AbortError' });
  assert(heldProbe.terminated);
  assert.equal(retryable.transfers, 0);
  const replacement = new SetupWorker();
  const renderer = await createLandscape(retryable, {}, { workerFactory: () => replacement });
  assert.equal(renderer.getStatus(), 'ready');
  assert.equal(retryable.transfers, 1);
  renderer.dispose();
  await Promise.resolve();
  assert(replacement.terminated);

  const construction = new AbortController(), transferred = canvas();
  const heldInitialization = new SetupWorker({ initialize: () => construction.abort() });
  await assert.rejects(createLandscape(transferred, {}, { signal: construction.signal, workerFactory: () => heldInitialization }), { name: 'AbortError' });
  assert(heldInitialization.terminated);
  assert.equal(transferred.transfers, 1);
  await assert.rejects(createLandscape(transferred, {}, { workerFactory: () => new SetupWorker() }), /fresh canvas/i);

  const complete = new AbortController(), liveWorker = new SetupWorker();
  const live = await createLandscape(canvas(), {}, { signal: complete.signal, workerFactory: () => liveWorker });
  complete.abort();
  assert.equal(live.getStatus(), 'ready', 'initialization signal must detach after creation');
  assert.equal(liveWorker.terminated, false);
  live.dispose();
  await Promise.resolve();
});
