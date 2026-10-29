import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext as createVM, runInContext } from 'node:vm';
import test from 'node:test';
import { createContext } from '../../src/composition/context.js';

// Execute the pinned original only as an independent test oracle, never in production.
const original = await readFile(new URL('../../reference/original.html', import.meta.url), 'utf8');
const scripts = [...original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const oracleSource = [
  scripts[0], scripts[2], scripts[3], scripts[4].split('  function poly(')[0],
  'function div(' + scripts[5].split('  function div(', 2)[1].split('  var texture =')[0],
].join('\n');
const seeds = ['1234', 'shan-shui', 'quiet-morning', 'reference-01', '%E5%B1%B1%E6%B0%B4'];

function oracle(seed) {
  const realm = createVM({ window: { btoa: globalThis.btoa }, console: { log() {} } });
  runInContext(oracleSource, realm);
  runInContext(`Math.seed(${JSON.stringify(seed)})`, realm);
  return { ...realm, Math: runInContext('Math', realm), randomState: () => realm.Prng.s };
}

for (const seed of seeds) {
  test(`original PRNG and lazy Perlin match exactly for ${seed}`, () => {
    const actual = createContext(seed), expected = oracle(seed);
    assert.equal(actual.randomState(), expected.randomState());
    for (let i = 0; i < 200; i++) assert.equal(actual.Math.random(), expected.Math.random());
    assert.equal(actual.randomState(), expected.randomState());
    const samples = [[0], [0.1, 0.2, 0.3], [-2.3, -7.9, -11.2], [4096.125, 256.375, 16.75]];
    for (const position of samples) assert.equal(actual.Noise.noise(...position), expected.Noise.noise(...position));
    assert.equal(actual.randomState(), expected.randomState(), 'First noise call consumed a different random sequence');
    actual.Noise.noiseDetail(6, 0.7); expected.Noise.noiseDetail(6, 0.7);
    for (const position of samples) assert.equal(actual.Noise.noise(...position), expected.Noise.noise(...position));
    actual.Math.seed('reseed'); expected.Math.seed('reseed');
    assert.equal(actual.Noise.noise(3.2, 1.7), expected.Noise.noise(3.2, 1.7), 'Reseeding unexpectedly reset the original noise table');
    assert.equal(actual.randomState(), expected.randomState());
  });
}

test('noise table initializes once, preserves original doubles, and returns independent copies', () => {
  const actual = createContext('table'), expected = oracle('table');
  const table = actual.Noise.table();
  assert.equal(table.length, 4096);
  assert.deepEqual(table, Array.from({ length: 4096 }, () => expected.Math.random()));
  assert.equal(actual.randomState(), expected.randomState());
  assert(table.some(value => value !== Math.fround(value)), 'CPU noise table was rounded to GPU precision');
  const state = actual.randomState(), originalFirst = table[0];
  table[0] = -1;
  assert.equal(actual.Noise.table()[0], originalFirst);
  actual.Noise.noise(0.8, 0.6, 0.4);
  assert.equal(actual.randomState(), state, 'Reading initialized noise consumed extra randomness');
});

test('polygon and curve helpers preserve original output and random consumption', () => {
  const actual = createContext('helpers'), expected = oracle('helpers');
  const compare = (name, args) => assert.deepEqual(actual[name](...structuredClone(args)), structuredClone(expected[name](...structuredClone(args))), name);
  compare('unNan', [[[undefined, [NaN, NaN], null], false, 1]]);
  compare('distance', [[-4, 7], [8, -2]]);
  compare('mapval', [0.375, 0, 1, -3, 9]);
  compare('bezmh', [[[3, 1], [7, 5]], 0.8]);
  compare('bezmh', [[[0, 0], [5, 9], [12, 3], [18, 7]], 1.2]);
  compare('div', [[[0, 0], [9, 12], [17, 4]], 7]);
  for (const points of [[[0, 0], [20, 0], [0, 20]], [[0, 0], [30, 0], [30, 10], [10, 30], [0, 20]]]) {
    assert.deepEqual(actual.PolyTools.midPt(points), structuredClone(expected.PolyTools.midPt(points)));
    assert.deepEqual(actual.PolyTools.triangulate(points, { area: 50, convex: true }), structuredClone(expected.PolyTools.triangulate(points, { area: 50, convex: true })));
  }
  const loop = [0.2, 0.7, 0.3, 0.9, 0.4], originalLoop = loop.slice();
  actual.loopNoise(loop); expected.loopNoise(originalLoop);
  assert.deepEqual(loop, originalLoop);
  for (let i = 0; i < 20; i++) {
    compare('randChoice', [['a', 'b', 'c']]);
    compare('normRand', [-30, 80]);
    assert.equal(actual.wtrand(x => x * x), expected.wtrand(x => x * x));
    assert.equal(actual.randGaussian(), expected.randGaussian());
  }
  assert.equal(actual.randomState(), expected.randomState());
});

test('contexts isolate randomness and reject seeds the original double hash cannot represent', () => {
  const random = Math.random, globalSeed = Math.seed;
  const first = createContext('independent'), second = createContext('independent');
  first.Math.random(); first.Noise.noise(2);
  assert.equal(second.Math.random(), createContext('independent').Math.random());
  assert.equal(Math.random, random);
  assert.equal(Math.seed, globalSeed);
  assert.equal(Object.getPrototypeOf(first.Math), Math);
  assert.throws(() => createContext('a'.repeat(200)), { name: 'RangeError', message: /seed.*long/i });
  assert.throws(() => createContext('山水'), { name: 'InvalidCharacterError' });
});
