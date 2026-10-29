import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS, bufferSize, hashSeed, resolveOptions } from '../dist/options.js';

test('package imports without browser globals and reports unsupported WebGPU in Node', async () => {
  const { createLandscape, isWebGPUSupported } = await import('../dist/index.js');
  assert.equal(typeof createLandscape, 'function');
  assert.equal(await isWebGPUSupported(), false);
  await assert.rejects(createLandscape(null), /canvas/i);
});

test('seed hashing is stable, distinguishes seed types and retains Unicode', () => {
  const seeds = ['', 0, -1, 1, '1', '山水', 'shan-shui', 'another-valley', Number.MAX_SAFE_INTEGER];
  const hashes = seeds.map(hashSeed);
  assert.deepEqual(seeds.map(hashSeed), hashes);
  assert.equal(new Set(hashes).size, seeds.length);
  for (const hash of hashes) assert(hash >= 0 && hash <= 0xffffffff && Number.isInteger(hash));
  // These values lock the documented seed-to-world contract across releases.
  assert.equal(hashSeed(''), 1735524902);
  assert.equal(hashSeed('shan-shui'), 1579641292);
});

test('partial updates preserve previous settings and copy input color arrays', () => {
  const paper = [0.1, 0.2, 0.3];
  const previous = resolveOptions({ seed: 'retained', paper, layers: 8 });
  const next = resolveOptions({ cameraX: -100 }, previous);
  paper[0] = 1;
  next.paper[1] = 1;
  assert.deepEqual(previous.paper, [0.1, 0.2, 0.3]);
  assert.equal(next.layers, 8);
  assert.equal(next.seed, 'retained');
  assert.equal(next.cameraX, -100);
  assert.equal(previous.cameraX, 0);
  assert.deepEqual(DEFAULT_OPTIONS.paper, [0.96, 0.95, 0.91]);
});

test('invalid options are rejected before they can reach GPU uniforms', () => {
  for (const input of [null, [], 12, 'x']) assert.throws(() => resolveOptions(input), TypeError);
  const invalid = [
    { seed: NaN }, { seed: Infinity }, { seed: {} }, { seed: undefined },
    { width: 0 }, { width: 1.1 }, { height: 16385 }, { height: Infinity },
    { pixelRatio: 0 }, { pixelRatio: 4.01 }, { cameraX: 1_000_001 },
    { cameraY: -1_000_001 }, { zoom: 0.249 }, { zoom: 4.01 },
    { layers: 0 }, { layers: 9 }, { layers: 2.5 },
    { roughness: -0.01 }, { inkDensity: 1.01 }, { mist: NaN },
    { vegetation: '0.5' }, { water: Infinity },
    { paper: [0, 0] }, { ink: [0, 0, 0, 0] }, { paper: [0, NaN, 1] },
    { ink: [0, 1.01, 0] }, { paper: null },
  ];
  for (const patch of invalid) assert.throws(() => resolveOptions(patch), undefined, JSON.stringify(patch));
});

test('all documented option boundaries are accepted', () => {
  const low = resolveOptions({ width: 1, height: 1, pixelRatio: 0.25, cameraX: -1e6, cameraY: -1e6, zoom: 0.25, layers: 1, roughness: 0, inkDensity: 0, mist: 0, vegetation: 0, water: 0, paper: [0, 0, 0] });
  const high = resolveOptions({ width: 16384, height: 16384, pixelRatio: 4, cameraX: 1e6, cameraY: 1e6, zoom: 4, layers: 8, roughness: 1, inkDensity: 1, mist: 1, vegetation: 1, water: 1, ink: [1, 1, 1] });
  assert.equal(low.layers, 1);
  assert.equal(high.layers, 8);
});

test('backing resolution obeys hardware and pixel budgets while retaining aspect ratio', () => {
  assert.deepEqual(bufferSize(resolveOptions({ width: 320, height: 200, pixelRatio: 2 }), 8192), [640, 400]);
  for (const [width, height, pixelRatio, limit] of [[16384, 16384, 4, 8192], [16384, 512, 4, 2048], [1, 16384, 0.25, 8192], [9000, 4000, 2, 8192]]) {
    const [w, h] = bufferSize(resolveOptions({ width, height, pixelRatio }), limit);
    assert(w >= 1 && h >= 1 && w <= limit && h <= limit);
    assert(w * h <= 8_388_608);
    if (w > 1 && h > 1) assert(Math.abs(w / h - width / height) < 0.03);
  }
});
