import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './helpers/load-source.mjs';
import { digest, readFixture } from './helpers/fixtures.mjs';

const { createComposition } = await loadSource('src/composition/index.ts');
const { cases } = await readFixture('motifs');

for (const group of ['Tree', 'Arch', 'Man', 'Mount']) {
  test(`${group} recipes retain their controls, painter order and random consumption`, () => {
    for (const { recipe, args, expected } of cases.filter(item => item.group === group)) {
      for (const { seed, commands, hash, randomState } of expected) {
        const composition = createComposition(seed);
        const drawing = composition[group][recipe](...args);
        const label = `${recipe}(${JSON.stringify(args)}) seed=${seed}`;
        assert.equal(drawing.length, commands, `${label}: command count`);
        assert.equal(digest(drawing), hash, `${label}: ordered commands`);
        assert.equal(composition.context.randomState(), randomState, `${label}: random state`);
      }
    }
  });
}
