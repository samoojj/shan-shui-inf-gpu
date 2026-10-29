import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext } from '../src/composition/context.js';
import { loadSource } from './helpers/load-source.mjs';
import { digest, readFixture } from './helpers/fixtures.mjs';

const fixture = await readFixture('scenes');
const { composeScene } = await loadSource('src/scene/compose.ts');
const gridHashes = new WeakMap();
function gridDigest(grid) {
  if (!gridHashes.has(grid)) gridHashes.set(grid, digest(grid));
  return gridHashes.get(grid);
}

test('acceptance data records the verified upstream and capture harness revisions', async () => {
  for (const name of ['context', 'scenes', 'gpu']) {
    const { upstream } = await readFixture(name);
    assert.equal(upstream.repository, 'https://github.com/LingDong-/shan-shui-inf');
    assert.equal(upstream.commit, '9f754d2b2e73495db7883d4d4055a7b0903b0454');
    assert.equal(upstream.gitBlob, 'f0d1da751455f99b46756fcbdde8b02420f27d31');
    assert.equal(upstream.captureHarnessCommit, '903f8516df3c94980773014f1479717d7296ebc5');
  }
});

function signature(command, glyph) {
  const { kind, fill, edge, outline } = command;
  const result = { kind, fill, edge, outline };
  if (glyph) return { ...result, glyph: true };
  const count = kind === 'texture' ? command.count : command.points?.length;
  result.vertices = kind === 'blob' ? 21 : kind === 'polygon' ? count : Math.max(0, count - 2) * 2 + 3;
  if (kind === 'polygon') result.geometry = digest([command.points, command.offset]);
  else {
    result.seed = command.seed;
    if (kind === 'blob') {
      result.controls = [...command.center, command.length, command.width, command.angle, command.noise];
      result.profile = digest(command.profile);
    } else if (kind === 'stroke') {
      result.controls = digest([command.points, command.offset, command.noise]);
      result.widths = digest(command.widths);
    } else {
      result.controls = [gridDigest(command.grid), ...command.offset];
      result.segment = { layer: command.layer, start: command.start, count: command.count,
        jitter: command.jitter, width: command.width, noise: command.noise };
    }
  }
  return result;
}

test('original random stream, lazy noise, and URL seed encoding remain instance-local', () => {
  for (const expected of fixture.encodedContexts) {
    const actual = createContext(encodeURIComponent(String(expected.seed)));
    assert.equal(actual.randomState(), expected.initialState);
    for (const [i, position] of expected.positions.entries()) {
      assert.equal(actual.Noise.noise(...position), expected.noise[i].value);
      assert.equal(actual.randomState(), expected.noise[i].state);
    }
    assert.deepEqual(Array.from({ length: 32 }, () => actual.Math.random()), expected.random.slice(0, 32));
    createContext('different').Noise.noise(1, 2, 3);
    assert.equal(actual.Math.random(), expected.random[32]);
  }
});

for (const expected of fixture.scenes) {
  test(`whole scene matches accepted upstream grammar, paint order, paper and random state: ${expected.seed}`, () => {
    const actual = composeScene(expected.seed);
    assert.equal(digest([...actual.paper]), expected.paperHash, 'paper random draws');
    assert.equal(digest(actual.inspect()), expected.initialHash, 'initial plans, chunks and random state');
    for (const view of expected.views) {
      const drawing = actual.drawing(view.x, view.width);
      assert.equal(drawing.length, view.commandCount, `command count at x=${view.x}`);
      const glyphs = new Set(view.glyphs);
      assert.equal(digest(drawing.map((command, i) => signature(command, glyphs.has(i)))), view.commandsHash,
        `ordered controls, profiles, paints and geometry at x=${view.x}`);
      assert.equal(digest(actual.inspect()), view.stateHash, `plans, chunks and random state at x=${view.x}`);
      assert.strictEqual(actual.drawing(view.x, view.width), drawing, 'same view reuses command identity');
      assert.equal(actual.inspect().randomState, view.randomState, 'cached view consumed randomness');
    }
  });
}
