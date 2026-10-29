import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext } from '../src/composition/context.js';
import { digest, readFixture } from './helpers/fixtures.mjs';

const fixture = await readFixture('context');

for (const expected of fixture.contexts) {
  test(`original PRNG and lazy Perlin acceptance data: ${expected.seed}`, () => {
    const actual = createContext(expected.seed);
    assert.equal(actual.randomState(), expected.initialState);
    assert.equal(digest(Array.from({ length: 200 }, () => actual.Math.random())), expected.randomHash);
    assert.equal(actual.randomState(), expected.afterRandom);
    assert.deepEqual(fixture.positions.map(p => actual.Noise.noise(...p)), expected.noise);
    assert.equal(actual.randomState(), expected.afterNoise);
    actual.Noise.noiseDetail(6, .7);
    assert.deepEqual(fixture.positions.map(p => actual.Noise.noise(...p)), expected.detailedNoise);
    actual.Math.seed('reseed');
    assert.equal(actual.Noise.noise(3.2, 1.7), expected.reseedNoise);
    assert.equal(actual.randomState(), expected.finalState);
  });
}

test('noise table initializes once, retains original doubles, and returns independent copies', () => {
  const actual = createContext('table');
  const table = actual.Noise.table();
  assert.equal(table.length, 4096);
  assert.equal(digest(table), fixture.noiseTableHash);
  assert.equal(actual.randomState(), fixture.tableFinalState);
  assert(table.some(value => value !== Math.fround(value)));
  const first = table[0], state = actual.randomState();
  table[0] = -1;
  assert.equal(actual.Noise.table()[0], first);
  actual.Noise.noise(.8, .6, .4);
  assert.equal(actual.randomState(), state);
});

test('polygon and curve helpers match captured upstream output and random consumption', () => {
  const actual = createContext('helpers'), values = [];
  for (const [name, args] of [
    ['unNan', [[[undefined, [NaN, NaN], null], false, 1]]],
    ['distance', [[-4, 7], [8, -2]]], ['mapval', [.375, 0, 1, -3, 9]],
    ['bezmh', [[[3, 1], [7, 5]], .8]], ['bezmh', [[[0, 0], [5, 9], [12, 3], [18, 7]], 1.2]],
    ['div', [[[0, 0], [9, 12], [17, 4]], 7]],
  ]) values.push(actual[name](...structuredClone(args)));
  for (const points of [[[0, 0], [20, 0], [0, 20]], [[0, 0], [30, 0], [30, 10], [10, 30], [0, 20]]]) {
    values.push(actual.PolyTools.midPt(points), actual.PolyTools.triangulate(points, { area: 50, convex: true }));
  }
  const loop = [.2, .7, .3, .9, .4]; actual.loopNoise(loop); values.push(loop);
  for (let i = 0; i < 20; i++) values.push(actual.randChoice(['a', 'b', 'c']), actual.normRand(-30, 80), actual.wtrand(x => x*x), actual.randGaussian());
  assert.deepEqual(JSON.parse(JSON.stringify(values)), fixture.helpers.values);
  assert.equal(actual.randomState(), fixture.helpers.finalState);
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
