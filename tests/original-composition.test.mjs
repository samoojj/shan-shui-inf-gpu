import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { createContext } from '../src/composition/context.js';
import { loadSource } from './helpers/load-source.mjs';

const original = await readFile(new URL('../reference/original.html', import.meta.url), 'utf8');
// Run the pinned upstream definitions only. Browser UI and paper canvas are absent.
// Production modules never read/evaluate the archived source.
const scripts = Array.from(original.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)).slice(0, 6).map(match => new vm.Script(match[1]));
const { composeScene } = await loadSource('src/scene/compose.ts');
const json = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gridHashes = new WeakMap();
function gridDigest(grid) {
  if (!gridHashes.has(grid)) gridHashes.set(grid, digest(grid));
  return gridHashes.get(grid);
}

test('the independent oracle is the unchanged pinned upstream source', () => {
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex');
  assert.equal(blob, 'f0d1da751455f99b46756fcbdde8b02420f27d31');
});

function upstream(seed) {
  const context = {
    console: { log() {} }, document: { addEventListener() {} },
    location: { href: `https://example.test/?seed=${encodeURIComponent(String(seed))}` },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  scripts.forEach(script => script.runInContext(context));
  context.Math = vm.runInContext('Math', context);
  return context;
}

/** Add observations to pinned original arithmetic, without recomputing it. */
function observeOriginal(context, name, changes) {
  let source = context[name].toString();
  for (const [expression, replacement, occurrences = 1] of changes) {
    assert.equal(source.split(expression).length - 1, occurrences, `${name}: upstream trace point changed`);
    source = source.replaceAll(expression, replacement);
  }
  new vm.Script(`${name} = (${source})`).runInContext(context);
}

function sceneOracle(seed) {
  const context = upstream(seed);
  const records = [], stack = [], plans = [];
  // These hooks observe the original callback evaluations and loop variables.
  // They neither call a profile/jitter callback again nor consume randomness.
  context.observeStrokeWidth = (index, width) => { stack.at(-1).widths[index] = width; };
  context.observeBlobProfile = value => { stack.at(-1).profile.push(value); return value; };
  context.observeTextureSegment = (layer, start, end) => {
    stack.at(-1).segments.push({ layer, start, count: end - start });
  };
  context.observeTextureJitter = value => {
    const segment = stack.at(-1).segments.at(-1);
    if ('jitter' in segment) assert.equal(value, segment.jitter, 'upstream grammar jitter must be constant within a texture segment');
    else segment.jitter = value;
    return value;
  };
  context.observeTextureMark = index => { stack.at(-1).marked = stack.at(-1).segments[index]; };
  observeOriginal(context, 'stroke', [[
    'var w = wid * fun(i / ptlist.length);',
    'var w = wid * fun(i / ptlist.length); observeStrokeWidth(i, w);',
  ]]);
  observeOriginal(context, 'blob', [[
    'var yo = (fun(p) * wid) / 2;',
    'var yo = (observeBlobProfile(fun(p)) * wid) / 2;',
  ]]);
  observeOriginal(context, 'texture', [
    ['texlist.push([]);', 'texlist.push([]); observeTextureSegment(layer, start, end);'],
    ['noi(layer + 1)', 'observeTextureJitter(noi(layer + 1))', 2],
    ['canv += stroke(', 'observeTextureMark(j); canv += stroke(', 2],
  ]);
  const random = context.Math.random;
  context.Math.random = () => {
    const value = random();
    const frame = stack.at(-1);
    if (frame && frame.kind !== 'texture' && frame.seed === undefined) frame.seed = value * 10;
    return value;
  };
  for (const name of ['stroke', 'blob', 'texture']) {
    const construct = context[name];
    context[name] = (...args) => {
      stack.push({ kind: name, input: args, widths: name === 'stroke' ? new Array(args[0].length).fill(0) : undefined,
        profile: [], segments: [] });
      try { return construct(...args); } finally { stack.pop(); }
    };
  }
  // Keep all original geometry/random work. Replace just SVG serialization with
  // tokens so the upstream chunk cache itself gives us the expected painter order.
  context.poly = (points, args = {}) => {
    const frame = stack.at(-1);
    const texture = stack.find(frame => frame.kind === 'texture');
    const kind = frame?.kind === 'stroke' && texture ? 'texture' : frame?.kind ?? 'polygon';
    const fill = args.fil ?? 'rgba(0,0,0,0)';
    const signature = { kind, fill, edge: args.str ?? fill, outline: args.wid ?? 0, vertices: points.length };
    if (kind === 'polygon') signature.geometry = digest([points, [args.xof ?? 0, args.yof ?? 0]]);
    else {
      signature.seed = frame.seed;
      if (kind === 'blob') {
        const [x, y, settings = {}] = frame.input;
        signature.controls = [x, y, settings.len ?? 20, settings.wid ?? 5, settings.ang ?? 0, settings.noi ?? .5];
        signature.profile = digest(frame.profile);
      } else if (kind === 'stroke') {
        const [centerline, settings = {}] = frame.input;
        signature.controls = digest([centerline, [settings.xof ?? 0, settings.yof ?? 0], settings.noi ?? .5]);
        signature.widths = digest(frame.widths);
      } else {
        const [grid, settings = {}] = texture.input;
        signature.controls = [gridDigest(grid), settings.xof ?? 0, settings.yof ?? 0];
        const brush = frame.input[1] ?? {};
        signature.segment = { ...texture.marked, width: brush.wid ?? 2, noise: brush.noi ?? .5 };
      }
    }
    records.push(signature);
    return `@${records.length - 1};`;
  };
  const planner = context.mountplanner;
  context.mountplanner = (xmin, xmax) => {
    const records = planner(xmin, xmax);
    plans.push({ xmin, xmax, records });
    return records;
  };
  function signatures(svg) {
    return Array.from(svg.matchAll(/@(\d+);|<text\b[^>]*>([^<]*)<\/text>/g)).flatMap(match => {
      if (match[1] !== undefined) return [records[Number(match[1])]];
      // Text is intentionally outlined on the GPU instead of using a browser font.
      // Compare its position in the painter sequence and one outline per visible glyph.
      return [...match[2]].filter(char => !/\s/.test(char)).map(() => ({
        kind: 'polygon', fill: 'rgba(100,100,100,0.9)', edge: 'none', outline: 0, glyph: true,
      }));
    });
  }
  context.chunkloader(0, 3000);
  const paper = new Float32Array(257 * 257);
  // Original body executes its paper script after initial scene construction.
  for (let i = 0; i <= 256; i++) for (let j = 0; j <= 256; j++) {
    context.Noise.noise(i * .1, j * .1);
    paper[i * 257 + j] = context.Math.random();
  }
  return {
    paper,
    drawing(x, width) {
      const end = x + Math.max(3000, width);
      context.chunkloader(x, end);
      context.chunkrender(x, end);
      return signatures(context.MEM.canv);
    },
    inspect() {
      const { xmin, xmax, cwid, windx, windy, chunks } = context.MEM;
      return { xmin, xmax, chunkWidth: cwid, viewWidth: windx, viewHeight: windy,
        chunks: chunks.map(({ tag, x, y, canv }) => ({ tag, x, y, commandCount: signatures(canv).length })),
        plans, randomState: context.Prng.s };
    },
  };
}

function signature(command, expected) {
  const { kind, fill, edge, outline } = command;
  const result = { kind, fill, edge, outline };
  if (expected.glyph) return { ...result, glyph: true };
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
  for (const seed of ['reference-01', 42, '山水']) {
    const original = upstream(seed);
    const port = createContext(encodeURIComponent(String(seed)));
    assert.equal(port.randomState(), original.Prng.s);
    for (const [x, y, z] of [[0, 0, 0], [-.2, 1.3, 5], [1001, 2.5, .25]]) {
      assert.equal(port.Noise.noise(x, y, z), original.Noise.noise(x, y, z));
      assert.equal(port.randomState(), original.Prng.s);
    }
    for (let i = 0; i < 32; i++) assert.equal(port.Math.random(), original.Math.random());
    const other = createContext('different');
    other.Noise.noise(1, 2, 3);
    assert.equal(port.Math.random(), original.Math.random());
  }
});

for (const seed of ['reference-01', '42']) {
  test(`whole scene matches upstream grammar, paint order, paper draws, and random state: ${seed}`, () => {
    const expected = sceneOracle(seed);
    const actual = composeScene(seed);
    assert.deepEqual(actual.paper, expected.paper, 'paper uses the same 66,049 random draws after the initial scene');
    assert.deepEqual(json(actual.inspect()), json(expected.inspect()), 'initial plans, chunk counts, and PRNG state');
    for (const [x, width] of [[0, 1200], [600, 1200], [-700, 1200], [0, 1200]]) {
      const originalDrawing = expected.drawing(x, width);
      const drawing = actual.drawing(x, width);
      assert.equal(drawing.length, originalDrawing.length, `command count at x=${x}`);
      // Hash large sequences, but report the first mismatching record on failure.
      const received = drawing.map((command, i) => signature(command, originalDrawing[i]));
      if (digest(received) !== digest(originalDrawing)) {
        const mismatch = received.findIndex((record, i) => JSON.stringify(record) !== JSON.stringify(originalDrawing[i]));
        assert.deepEqual(received[mismatch], originalDrawing[mismatch], `painter command ${mismatch} at x=${x}`);
      }
      assert.deepEqual(json(actual.inspect()), json(expected.inspect()), `plans, chunks, and PRNG at x=${x}`);
      const randomState = actual.inspect().randomState;
      assert.strictEqual(actual.drawing(x, width), drawing, 'same view reuses commands without consuming randomness');
      assert.equal(actual.inspect().randomState, randomState);
    }
  });
}
