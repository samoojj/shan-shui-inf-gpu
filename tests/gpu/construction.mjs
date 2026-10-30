import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';
import { readFixture } from '../helpers/fixtures.mjs';
import { checkControlledTrees } from './controlled-trees.mjs';

const tolerance = .002;
const brushBytes = 128;
const descriptorBytes = 80;
const treeCommandCapacity = 4096;
const treeControlCapacity = 65536;
const islandCommandCapacity = 128;

async function constructionShader(name) {
  const entry = fileURLToPath(new URL(`./construction-${name}.wgsl`, import.meta.url));
  // The compute pipeline below performs mandatory native validation on the
  // caller's device. A missing adapter must fail in the calling test runner.
  const resolved = await resolveShader({ entry, validate: 'off' });
  assert.deepEqual(resolved.diagnostics.filter(item => item.severity === 'error'), []);
  return prepareShader(resolved, entry);
}

function compareFloat(actual, expected, description) {
  assert(Number.isFinite(expected), `${description}: invalid captured expectation`);
  const error = Math.abs(actual - expected);
  assert(Number.isFinite(error) && error <= tolerance,
    `${description}: expected ${expected}, received ${actual} (error ${error})`);
  return error;
}

function noiseTable(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.length, 4096 * 4, 'The captured noise table must be complete');
  return Float32Array.from({ length: 4096 }, (_, index) => bytes.readFloatLE(index * 4));
}

function packTreeCases(fixture, seed, commandLimit, controlLimit) {
  const data = new ArrayBuffer(fixture.cases.length * 64);
  const view = new DataView(data);
  for (const [index, input] of fixture.cases.entries()) {
    const base = index * 64;
    [...fixture.origin, input.width, input.height, ...fixture.color].forEach((value, field) =>
      view.setFloat32(base + field * 4, value, true));
    view.setUint32(base + 32, input.style, true);
    view.setUint32(base + 36, seed, true);
    view.setUint32(base + 40, input.clusterCount ?? 0, true);
    view.setFloat32(base + 44, input.bend, true);
    view.setUint32(base + 48, index * treeCommandCapacity, true);
    view.setUint32(base + 52, commandLimit, true);
    view.setUint32(base + 56, index * treeControlCapacity, true);
    view.setUint32(base + 60, controlLimit, true);
  }
  return data;
}

function inspectTrees(fixture, generated, commandLimit, controlLimit, expectedOverflow) {
  const jobs = new DataView(generated.commandBytes);
  const controls = new Float32Array(generated.controlBytes);
  return fixture.cases.map((input, index) => {
    const label = input.name;
    const [commands, allocatedControls, points, overflow] = generated.counts.slice(index * 4, index * 4 + 4);
    assert.equal(overflow, expectedOverflow, `${label}: overflow`);
    assert(commands <= commandLimit && allocatedControls <= controlLimit, `${label}: arena capacity`);
    const controlBase = index * treeControlCapacity;
    for (let control = controlBase * 4; control < (controlBase + allocatedControls) * 4; control++) {
      assert(Number.isFinite(controls[control]), `${label}: nonfinite control or metadata`);
    }
    const kinds = [0, 0, 0];
    let actualPoints = 0;
    let twigPassStarted = false;
    let signedBarkContours = 0;
    for (let command = 0; command < commands; command++) {
      const base = (index * treeCommandCapacity + command) * brushBytes;
      const kind = jobs.getUint32(base, true);
      const offset = jobs.getUint32(base + 4, true);
      const count = jobs.getUint32(base + 8, true);
      const pointOffset = jobs.getUint32(base + 12, true);
      const pointCount = jobs.getUint32(base + 96, true);
      const alpha = jobs.getFloat32(base + 28, true);
      const width = jobs.getFloat32(base + 48, true);
      const outline = jobs.getFloat32(base + 60, true);
      assert(kind <= 2 && count > 0, `${label}: invalid or empty brush`);
      assert(offset >= controlBase && offset + count <= controlBase + allocatedControls,
        `${label}: brush references controls outside its invocation's arena`);
      assert.equal(pointOffset, actualPoints, `${label}: output point order`);
      const expectedPoints = kind === 2 ? 21 : kind === 0 ? count : count === 1 ? 3 : 2 * count - 1;
      assert.equal(pointCount, expectedPoints, `${label}: expanded point count`);
      actualPoints += pointCount;
      kinds[kind]++;
      for (let field = 16; field < 96; field += 4) {
        assert(Number.isFinite(jobs.getFloat32(base + field, true)), `${label}: nonfinite brush attribute`);
      }
      if (expectedOverflow) continue;
      if ([3, 4, 5, 6, 8].includes(input.style) && command === 0) {
        assert.equal(kind, 0, `${label}: white trunk fill must paint first`);
        for (let channel = 0; channel < 4; channel++) assert.equal(jobs.getFloat32(base + 16 + channel * 4, true), 1);
      }
      if ([4, 5, 6, 8].includes(input.style) && command === 1) {
        assert.equal(kind, 1, `${label}: trunk outline must immediately follow fill`);
        assert.equal(width, 2.5);
      }
      if ([4, 5, 6].includes(input.style) && command >= 2) {
        const isTwigStroke = kind === 1 && width === 1 && Math.abs(alpha - .5) < 1e-6 && outline === 1;
        const isTwigLeaf = kind === 2 && (Math.abs(alpha - .5) < 1e-6 || Math.abs(alpha - .7) < 1e-6);
        if (isTwigStroke || isTwigLeaf) twigPassStarted = true;
        if (twigPassStarted) assert(isTwigStroke || isTwigLeaf, `${label}: bark painted after a twig`);
        if (kind === 1 && count === 21 && outline === 0 && jobs.getFloat32(base + 52, true) === 0 && Math.abs(alpha - .4) < 1e-6) {
          const widths = Array.from({ length: count }, (_, sample) => controls[(offset + sample) * 4 + 2]);
          assert(widths.some(value => value < 0) && widths.some(value => value > 0), `${label}: bark lost its signed width profile`);
          signedBarkContours++;
        }
      }
      if (input.style === 7) {
        assert.equal(kind, 0, 'Faceted trees must contain only polygon commands');
        assert.equal(count, 3, 'Every facet must be a triangle');
        const first = controls.slice(offset * 4, offset * 4 + 2);
        const second = controls.slice((offset + 1) * 4, (offset + 1) * 4 + 2);
        const third = controls.slice((offset + 2) * 4, (offset + 2) * 4 + 2);
        const area = Math.abs((second[0] - first[0]) * (third[1] - first[1])
          - (second[1] - first[1]) * (third[0] - first[0])) * .5;
        assert(area <= 50.01, 'Original longest-edge subdivision must reach the area-50 target');
      }
      if (input.style === 1) assert.equal(kind, command < 9 ? 2 : 0, 'Sparse foliage must precede both open contours');
      if (input.style === 3) assert.equal(kind, command === 0 ? 0 : 2, 'Dense foliage must follow the white trunk');
    }
    assert.equal(actualPoints, points, `${label}: Writer point total`);
    if (!expectedOverflow) {
      if (input.style === 1) assert.equal(commands, 11);
      if (input.style === 2) assert.equal(commands, input.clusterCount ?? 5);
      if (input.style === 3) assert.equal(commands, 73);
      if ([4, 5, 6].includes(input.style)) {
        assert(signedBarkContours > 0, `${label}: missing bark contours`);
        assert(twigPassStarted, `${label}: missing twigs`);
      }
    }
    return { name: label, style: input.style, commands, controls: allocatedControls, points, kinds, overflow };
  });
}

function compareTreeReferences(fixture, generated) {
  const jobs = new DataView(generated.commandBytes);
  const controls = new Float32Array(generated.controlBytes);
  return fixture.references.map(reference => {
    const input = fixture.cases[reference.caseIndex];
    const actualCount = generated.counts[reference.caseIndex * 4];
    if (reference.scope === 'complete') assert.equal(actualCount, reference.commands.length, `${input.name}: original command count`);
    else assert(actualCount >= reference.commands.length);
    let maximumError = 0;
    const compare = (actual, expected, detail) => {
      maximumError = Math.max(maximumError, compareFloat(actual, expected, `${input.name}: ${detail}`));
    };
    for (const [command, expected] of reference.commands.entries()) {
      const base = (reference.caseIndex * treeCommandCapacity + command) * brushBytes;
      const offset = jobs.getUint32(base + 4, true);
      const count = jobs.getUint32(base + 8, true);
      assert.equal(jobs.getUint32(base, true), expected.kind);
      expected.fill.forEach((value, channel) => compare(jobs.getFloat32(base + 16 + channel * 4, true), value, 'fill'));
      compare(jobs.getFloat32(base + 60, true), expected.outline, 'outline width');
      if (expected.edge) expected.edge.forEach((value, channel) => compare(jobs.getFloat32(base + 32 + channel * 4, true), value, 'outline color'));
      if (expected.kind === 2) {
        assert.equal(count, 21);
        for (const [offset, value, label] of [[64, expected.center[0], 'leaf x'], [68, expected.center[1], 'leaf y'],
          [72, expected.length, 'leaf length'], [48, expected.width, 'leaf width'], [76, expected.angle, 'leaf angle'],
          [52, expected.noiseAmount, 'leaf noise amount'], [56, expected.noiseOffset, 'leaf noise phase']]) {
          compare(jobs.getFloat32(base + offset, true), value, label);
        }
        const profile = fixture.profiles[expected.profile];
        assert.equal(profile.length, 21, 'Original blob profiles must retain every sample');
        profile.forEach((value, sample) => compare(controls[(offset + sample) * 4], value, 'leaf profile'));
      } else {
        assert.equal(count, expected.points.length);
        expected.points.forEach((point, sample) => point.forEach((value, axis) =>
          compare(controls[(offset + sample) * 4 + axis], value, 'polygon coordinate')));
      }
    }
    return { name: input.name, style: input.style, scope: reference.scope, commands: reference.commands.length, maximumError };
  });
}

async function checkTreeConstruction(gpu, fixture) {
  const count = fixture.cases.length;
  assert.deepEqual([...new Set(fixture.cases.map(input => input.style))].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  const constructionControls = storage(gpu, count * treeControlCapacity * 16);
  const constructionJobs = storage(gpu, count * treeCommandCapacity * brushBytes);
  const table = noiseTable(fixture.noiseTableBase64);
  const noiseTableBuffer = storage(gpu, table.byteLength, 'read');
  noiseTableBuffer.write(table);
  const cases = storage(gpu, count * 64, 'read');
  const counts = storage(gpu, count * 16);
  const pipeline = compute(gpu, await constructionShader('trees'), {
    label: 'original-tree-construction-acceptance',
    set: { constructionControls, constructionJobs, noiseTable: noiseTableBuffer, cases, counts },
  });
  async function run(seed, commandLimit = treeCommandCapacity, controlLimit = treeControlCapacity, overflow = 0) {
    cases.write(packTreeCases(fixture, seed, commandLimit, controlLimit));
    pipeline.dispatch(count);
    const [countBytes, commandBytes, controlBytes] = await Promise.all([counts.read(), constructionJobs.read(), constructionControls.read()]);
    const generated = { counts: new Uint32Array(countBytes), commandBytes, controlBytes };
    generated.report = inspectTrees(fixture, generated, commandLimit, controlLimit, overflow);
    return generated;
  }
  try {
    await pipeline.compile();
    const first = await run(fixture.seeds[0]);
    const references = compareTreeReferences(fixture, first);
    const repeated = await run(fixture.seeds[0]);
    assert.deepEqual(repeated.counts, first.counts, 'A tree seed must repeat its counts bit-for-bit');
    assert.deepEqual(new Uint8Array(repeated.commandBytes), new Uint8Array(first.commandBytes), 'A tree seed must repeat its brushes bit-for-bit');
    assert.deepEqual(new Uint8Array(repeated.controlBytes), new Uint8Array(first.controlBytes), 'A tree seed must repeat its controls bit-for-bit');
    const alternate = await run(fixture.seeds[1]);
    await run(fixture.seeds[0], treeCommandCapacity, 8, 1);
    await run(fixture.seeds[0], 1, treeControlCapacity, 1);
    return { nativePipeline: true, tolerance, references, first: first.report, alternate: alternate.report,
      deterministic: true, controlOverflowCases: count, commandOverflowCases: count };
  } finally {
    pipeline.dispose();
  }
}

function packIslandCases(fixture, commandLimit) {
  const data = new ArrayBuffer(fixture.cases.length * 48);
  const view = new DataView(data);
  for (const [index, input] of fixture.cases.entries()) {
    const base = index * 48;
    fixture.origin.forEach((value, axis) => view.setFloat32(base + axis * 4, value, true));
    view.setUint32(base + 8, input.seed, true);
    view.setUint32(base + 12, index * islandCommandCapacity, true);
    fixture.bounds.forEach((value, axis) => view.setFloat32(base + 16 + axis * 4, value, true));
    view.setUint32(base + 32, commandLimit, true);
  }
  return data;
}

function compareIslandReferences(fixture, generated) {
  const markers = new DataView(generated.commandBytes);
  const descriptions = new DataView(generated.childBytes);
  const normalized = [];
  const coverage = new Set();
  let maximumError = 0;
  let totalChildren = 0;
  let largestIsland = 0;
  const fieldOffsets = [16, 20, 24, 28, 0, 4, 8, 12, 32, 36, 40, 44, 64, 68, 72, 76];
  assert.deepEqual(fixture.descriptorFields, ['seed', 'kind', 'style', 'flags', 'x', 'y', 'width', 'height',
    'rotation', 'perspective', 'bend', 'depth', 'red', 'green', 'blue', 'alpha']);
  for (const [index, expected] of fixture.cases.entries()) {
    const [count, finalState, overflow, controls] = generated.counts.slice(index * 4, index * 4 + 4);
    assert.equal(count, expected.descriptors.length, `island ${index}: original child count`);
    assert.equal(finalState, expected.finalState, `island ${index}: original final random state`);
    assert.equal(overflow, 0, `island ${index}: overflow`);
    assert.equal(controls, 0, 'Island decoration must emit descriptors, not dense point arrays');
    totalChildren += count;
    largestIsland = Math.max(largestIsland, count);
    for (const [command, reference] of expected.descriptors.entries()) {
      assert.equal(reference.length, fieldOffsets.length, 'Every captured descriptor field must be present');
      const marker = (index * islandCommandCapacity + command) * brushBytes;
      assert.equal(markers.getUint32(marker, true), 4, 'Decoration must retain a painter placeholder');
      const childIndex = markers.getUint32(marker + 4, true);
      assert(childIndex < generated.queuedChildren, 'Painter placeholder references an absent child');
      const child = childIndex * descriptorBytes;
      assert(child + descriptorBytes <= descriptions.byteLength);
      reference.forEach((value, field) => {
        const offset = child + fieldOffsets[field];
        if (field < 4) assert.equal(descriptions.getUint32(offset, true), value, `island ${index}: ${fixture.descriptorFields[field]}`);
        else maximumError = Math.max(maximumError, compareFloat(descriptions.getFloat32(offset, true), value,
          `island ${index} child ${command}: ${fixture.descriptorFields[field]}`));
      });
      for (let field = 48; field < 64; field += 4) assert.equal(descriptions.getUint32(child + field, true), 0, 'Queued child arenas must be unallocated');
      // Normalize by painter placeholders, not allocation order: concurrent
      // invocations may receive different global atomic queue indices.
      for (let field = 0; field < descriptorBytes; field += 4) normalized.push(descriptions.getUint32(child + field, true));
      coverage.add(`${reference[1]}:${reference[2]}`);
    }
  }
  assert.equal(generated.queuedChildren, totalChildren);
  for (const feature of ['6:4', '6:5', '6:6', '6:7', '6:8', '7:5', '8:1', '9:0']) {
    assert(coverage.has(feature), `Original island feature was not exercised: ${feature}`);
  }
  return { normalized: Uint32Array.from(normalized), report: { cases: fixture.cases.length, totalChildren,
    largestIsland, maximumError, coverage: [...coverage].sort() } };
}

async function checkIslandConstruction(gpu, fixture) {
  const count = fixture.cases.length;
  assert.equal(count, 96, 'Keep the complete independent island acceptance capture');
  const constructionJobs = storage(gpu, count * islandCommandCapacity * brushBytes);
  const children = storage(gpu, count * islandCommandCapacity * descriptorBytes);
  const childQueue = storage(gpu, 4);
  const cases = storage(gpu, count * 48, 'read');
  const counts = storage(gpu, count * 16);
  const shader = await constructionShader('islands');
  const bindings = { constructionJobs, children, childQueue, cases, counts };
  const pipeline = compute(gpu, shader, { label: 'original-island-decoration-acceptance', set: bindings });
  async function run(commandLimit = islandCommandCapacity) {
    cases.write(packIslandCases(fixture, commandLimit));
    childQueue.write(new Uint32Array([0]));
    pipeline.dispatch(count);
    const [countBytes, commandBytes, childBytes, queueBytes] = await Promise.all([
      counts.read(), constructionJobs.read(), children.read(), childQueue.read(),
    ]);
    return { counts: new Uint32Array(countBytes), commandBytes, childBytes, queuedChildren: new Uint32Array(queueBytes)[0] };
  }
  try {
    await pipeline.compile();
    const first = await run();
    const inspected = compareIslandReferences(fixture, first);
    const repeated = await run();
    const repeatedInspection = compareIslandReferences(fixture, repeated);
    assert.deepEqual(repeated.counts, first.counts, 'Island counts and random states must repeat bit-for-bit');
    assert.deepEqual(repeatedInspection.normalized, inspected.normalized, 'Ordered island descriptors must repeat bit-for-bit');
    const exhausted = await run(1);
    for (let index = 0; index < count; index++) {
      assert.equal(exhausted.counts[index * 4], 1);
      assert.equal(exhausted.counts[index * 4 + 2], 1, 'Island command exhaustion must set overflow');
    }
    const tinyChildren = storage(gpu, descriptorBytes);
    const queueProbe = compute(gpu, shader, { label: 'island-child-queue-overflow', set: { ...bindings, children: tinyChildren } });
    try {
      await queueProbe.compile();
      cases.write(packIslandCases(fixture, islandCommandCapacity));
      childQueue.write(new Uint32Array([0]));
      queueProbe.dispatch(count);
      const output = new Uint32Array(await counts.read());
      for (let index = 0; index < count; index++) {
        assert(output[index * 4] <= 1);
        assert.equal(output[index * 4 + 2], 1, 'Island child-queue exhaustion must set overflow');
      }
    } finally {
      queueProbe.dispose();
    }
    return { nativePipeline: true, tolerance, ...inspected.report, deterministic: true,
      exactRandomStateAndCounts: true, commandOverflowCases: count, childQueueOverflowCases: count };
  } finally {
    pipeline.dispose();
  }
}

/** Caller supplies a native vgpu device and owns its error reporting/disposal. */
export async function checkConstruction(gpu) {
  const fixture = await readFixture('construction');
  const trees = await checkTreeConstruction(gpu, fixture.trees);
  const islands = await checkIslandConstruction(gpu, fixture.islands);
  const controlledTrees = await checkControlledTrees(gpu);
  await gpu.settled();
  return { trees, islands, controlledTrees };
}
