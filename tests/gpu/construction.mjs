import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';
import { readFixture } from '../helpers/fixtures.mjs';

const tolerance = .002;
const brushBytes = 128;
const descriptorBytes = 80;
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

/** Caller supplies a native device; tree acceptance joins in the next stack stage. */
export async function checkConstruction(gpu) {
  const fixture = await readFixture('construction');
  const islands = await checkIslandConstruction(gpu, fixture.islands);
  await gpu.settled();
  return { islands };
}
