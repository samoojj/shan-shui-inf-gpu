import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS, bufferSize, resolveOptions } from '../dist/options.js';

test('package imports without browser globals and reports unsupported WebGPU in Node', async () => {
  const { createLandscape, isWebGPUSupported } = await import('../dist/index.js');
  assert.equal(typeof createLandscape, 'function');
  assert.equal(await isWebGPUSupported(), false);
  await assert.rejects(createLandscape(null), /canvas/i);
});

test('partial updates preserve the original viewer settings without mutating prior options', () => {
  const previous = resolveOptions({ seed: 'retained', width: 960, zoom: 2 });
  const patch = { cameraX: -100 };
  const next = resolveOptions(patch, previous);
  patch.cameraX = 200;
  assert.equal(next.seed, 'retained');
  assert.equal(next.width, 960);
  assert.equal(next.zoom, 2);
  assert.equal(next.cameraX, -100);
  assert.equal(previous.cameraX, 0);
  assert.equal(DEFAULT_OPTIONS.zoom, 1.142);
  assert(Object.isFrozen(DEFAULT_OPTIONS));
});

test('invalid and obsolete style options are rejected before scene or GPU allocation', () => {
  for (const input of [null, [], 12, 'x']) assert.throws(() => resolveOptions(input), TypeError);
  const invalid = [
    { constructor: 1 }, { toString: null }, { seed: NaN }, { seed: Infinity }, { seed: {} }, { seed: undefined },
    { seed: 'x'.repeat(97) }, { seed: '山'.repeat(11) },
    { width: 0 }, { width: 1.1 }, { height: 16385 }, { height: Infinity },
    { pixelRatio: 0 }, { pixelRatio: 4.01 }, { cameraX: 8193 },
    { cameraY: -8193 }, { zoom: 0.249 }, { zoom: 4.01 }, { width: 3000, zoom: .25 },
    { layers: 4 }, { roughness: .5 }, { inkDensity: .5 }, { mist: .5 },
    { vegetation: .5 }, { water: .5 }, { paper: [1, 1, 1] }, { ink: [0, 0, 0] },
  ];
  for (const patch of invalid) assert.throws(() => resolveOptions(patch), undefined, JSON.stringify(patch));
});

test('documented option boundaries and URL-encoded seeds are accepted', () => {
  const low = resolveOptions({ width: 1, height: 1, pixelRatio: .25, cameraX: -8192, cameraY: -8192, zoom: .25 });
  const high = resolveOptions({ width: 16384, height: 16384, pixelRatio: 4, cameraX: 8192, cameraY: 8192, zoom: 4 });
  assert.equal(low.cameraX, -8192);
  assert.equal(high.zoom, 4);
  for (const seed of ['', 0, -1, 1, '1', '山水', 'x'.repeat(96), Number.MAX_SAFE_INTEGER]) {
    assert.equal(resolveOptions({ seed }).seed, seed);
  }
});

test('backing resolution obeys hardware and pixel budgets while retaining aspect ratio', () => {
  assert.deepEqual(bufferSize(resolveOptions({ width: 320, height: 200, pixelRatio: 2 }), 8192), [640, 400]);
  for (const [width, height, pixelRatio, limit] of [[16384, 16384, 4, 8192], [16384, 512, 4, 2048], [1, 16384, .25, 8192], [9000, 4000, 2, 8192]]) {
    const [w, h] = bufferSize(resolveOptions({ width, height, pixelRatio, zoom: 4 }), limit);
    assert(w >= 1 && h >= 1 && w <= limit && h <= limit);
    assert(w * h <= 8_388_608);
    if (w > 1 && h > 1) assert(Math.abs(w / h - width / height) < .03);
  }
});
