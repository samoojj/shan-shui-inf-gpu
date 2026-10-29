import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';

const commandCapacity = 4096;
const controlCapacity = 32768;
const coordinateTolerance = .002;
const colorTolerance = 1 / 255 + 1e-6;

/** Fixed-input CPU captures exercise construction, before brush expansion. */
export async function checkTerrain(gpu) {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/gpu-terrain.json', import.meta.url), 'utf8'));
  const entry = new URL('./terrain-probe.wgsl', import.meta.url).pathname;
  const resolved = await resolveShader({ entry, validate: 'off' });
  assert.deepEqual(resolved.diagnostics.filter(item => item.severity === 'error'), [], 'Terrain shader resolution failed');
  const count = fixture.cases.length;
  const descriptions = storage(gpu, count * 80, 'read');
  const descriptionBytes = new ArrayBuffer(count * 80);
  const descriptionView = new DataView(descriptionBytes);
  for (const [index, { description }] of fixture.cases.entries()) {
    const base = index * 80;
    [...description.origin, ...description.size].forEach((value, field) => descriptionView.setFloat32(base + field * 4, value, true));
    descriptionView.setUint32(base + 16, description.seed, true);
    descriptionView.setUint32(base + 20, description.kind, true);
    descriptionView.setFloat32(base + 32, description.coordinate, true);
    descriptionView.setFloat32(base + 36, description.shade, true);
    descriptionView.setUint32(base + 48, index * commandCapacity, true);
    descriptionView.setUint32(base + 56, index * controlCapacity, true);
  }
  descriptions.write(descriptionBytes);
  const noiseTable = storage(gpu, 4096 * 4, 'read');
  noiseTable.write(Buffer.from(fixture.noiseTableBase64, 'base64'));
  const constructionJobs = storage(gpu, count * commandCapacity * 128);
  const constructionControls = storage(gpu, count * controlCapacity * 16);
  const results = storage(gpu, count * 32);
  const children = storage(gpu, count * 1024 * 80);
  const childQueue = storage(gpu, 16);
  const pipeline = compute(gpu, prepareShader(resolved), { label: 'source terrain construction acceptance',
    set: { descriptions, noiseTable, constructionJobs, constructionControls, results, children, childQueue,
      capacity: { commands: commandCapacity, controls: controlCapacity } } });
  const errors = [];
  const unsubscribe = gpu.onError(error => errors.push(error.message));
  try {
    await pipeline.compile();
    pipeline.dispatch(count);
    const output = new Uint32Array(await results.read());
    const jobs = new DataView(await constructionJobs.read());
    const controls = new Float32Array(await constructionControls.read());
    const childData = new DataView(await children.read());
    await gpu.settled();
    assert.deepEqual(errors, [], 'Native terrain execution errors');
    let maximumCoordinateError = 0;
    let maximumColorError = 0;
    let pointCount = 0;
    let childCount = 0;
    const compare = (actual, expected, label, tolerance = coordinateTolerance) => {
      const error = Math.abs(actual - expected);
      assert(Number.isFinite(actual) && error <= tolerance, `${label}: expected ${expected}, received ${actual}; error ${error}`);
      if (tolerance === colorTolerance) maximumColorError = Math.max(maximumColorError, error);
      else maximumCoordinateError = Math.max(maximumCoordinateError, error);
    };
    const reports = [];
    for (const [index, expected] of fixture.cases.entries()) {
      const name = expected.description.name;
      assert.equal(output[index * 8 + 3], 0, `${name}: arena overflow`);
      assert.equal(output[index * 8], expected.commands.length, `${name}: authored command count`);
      assert.equal(output[index * 8 + 4], expected.randomState, `${name}: final construction random state`);
      const visitedGrids = new Set();
      let expandedPoints = 0;
      for (const [ordinal, reference] of expected.commands.entries()) {
        const base = (index * commandCapacity + ordinal) * 128;
        const kind = jobs.getUint32(base, true);
        const offset = jobs.getUint32(base + 4, true);
        const controlCount = jobs.getUint32(base + 8, true);
        const points = jobs.getUint32(base + 96, true);
        const label = `${name} command ${ordinal}`;
        assert.equal(kind, { polygon: 0, stroke: 1, texture: 3, child: 4 }[reference.kind], `${label}: painter order`);
        if (reference.kind === 'child') {
          assert.equal(points, 0, `${label}: placeholder has no direct geometry`);
          const child = offset * 80;
          const descriptor = reference.description;
          for (const [field, position] of [['seed', 16], ['kind', 20], ['style', 24], ['flags', 28]]) {
            assert.equal(childData.getUint32(child + position, true), descriptor[field], `${label}: child ${field}`);
          }
          const floats = [...descriptor.origin, ...descriptor.size, descriptor.rotation, descriptor.perspective, descriptor.bend, descriptor.depth, ...descriptor.color];
          [0, 4, 8, 12, 32, 36, 40, 44, 64, 68, 72, 76].forEach((position, field) => compare(childData.getFloat32(child + position, true), floats[field], `${label}: child field ${field}`));
          childCount++;
          continue;
        }
        const pointsExpected = reference.kind === 'texture' ? reference.count : reference.points.length;
        assert.equal(controlCount, pointsExpected, `${label}: control point count`);
        const expanded = reference.kind === 'polygon' ? pointsExpected : pointsExpected === 1 ? 3 : pointsExpected * 2 - 1;
        assert.equal(points, expanded, `${label}: brush output count`);
        assert.equal(jobs.getUint32(base + 12, true), expandedPoints, `${label}: relative point offset`);
        expandedPoints += points;
        for (let channel = 0; channel < 4; channel++) {
          compare(jobs.getFloat32(base + 16 + channel * 4, true), reference.fill[channel], `${label}: fill channel ${channel}`, colorTolerance);
          compare(jobs.getFloat32(base + 32 + channel * 4, true), reference.edge[channel], `${label}: edge channel ${channel}`, colorTolerance);
        }
        if (reference.edge[3] > 0) compare(jobs.getFloat32(base + 60, true), reference.outline, `${label}: outline width`);
        assert(offset >= index * controlCapacity && offset < (index + 1) * controlCapacity, `${label}: control arena ownership`);
        if (reference.kind === 'texture') {
          const grid = expected.grids[reference.grid];
          for (const [field, position] of [['width', 48], ['noise', 52], ['seed', 56], ['layer', 80], ['start', 84], ['jitter', 92]]) {
            compare(jobs.getFloat32(base + position, true), reference[field], `${label}: ${field}`);
          }
          reference.offset.forEach((value, axis) => compare(jobs.getFloat32(base + 64 + axis * 4, true), value, `${label}: origin ${axis}`));
          assert.equal(jobs.getFloat32(base + 88, true), grid[0].length, `${label}: grid width`);
          if (!visitedGrids.has(offset)) {
            visitedGrids.add(offset);
            grid.flat().forEach((point, sample) => point.forEach((value, axis) => compare(controls[(offset + sample) * 4 + axis], value, `${label}: grid sample ${sample} axis ${axis}`)));
          }
        } else {
          reference.points.forEach((point, sample) => point.forEach((value, axis) => compare(controls[(offset + sample) * 4 + axis], value, `${label}: sample ${sample} axis ${axis}`)));
          if (reference.kind === 'stroke') {
            compare(jobs.getFloat32(base + 52, true), reference.noise, `${label}: brush noise`);
            compare(jobs.getFloat32(base + 56, true), reference.seed, `${label}: brush seed`);
            for (let sample = 1; sample + 1 < controlCount; sample++) compare(controls[(offset + sample) * 4 + 2], reference.widths[sample], `${label}: width sample ${sample}`);
          }
        }
      }
      assert.equal(output[index * 8 + 2], expandedPoints, `${name}: total generated point count`);
      pointCount += expandedPoints;
      reports.push({ name, commands: expected.commands.length, points: expandedPoints, controls: output[index * 8 + 1] });
    }
    assert.equal(new Uint32Array(await childQueue.read())[0], childCount, 'Queued child count');
    // Independent object streams and queued painter order survive repeated dispatch.
    childQueue.write(new Uint32Array(4));
    pipeline.dispatch(count);
    const repeatedResults = new Uint32Array(await results.read());
    assert.deepEqual(repeatedResults, output, 'Repeated terrain counts and random states');
    const repeatedControls = new Float32Array(await constructionControls.read());
    assert.deepEqual(repeatedControls, controls, 'Repeated generated terrain controls');
    const repeatedJobs = new DataView(await constructionJobs.read());
    const repeatedChildren = new DataView(await children.read());
    for (let index = 0; index < count; index++) {
      for (let ordinal = 0; ordinal < output[index * 8]; ordinal++) {
        const base = (index * commandCapacity + ordinal) * 128;
        const placeholder = jobs.getUint32(base, true) === 4;
        for (let field = 0; field < 128; field += 4) {
          if (placeholder && field === 4) continue; // Atomic queue slots may differ; painter references must not.
          assert.equal(repeatedJobs.getUint32(base + field, true), jobs.getUint32(base + field, true), 'Repeated authored brush');
        }
        if (placeholder) {
          const oldChild = jobs.getUint32(base + 4, true) * 80;
          const newChild = repeatedJobs.getUint32(base + 4, true) * 80;
          for (let field = 0; field < 80; field += 4) assert.equal(repeatedChildren.getUint32(newChild + field, true), childData.getUint32(oldChild + field, true), 'Repeated child descriptor');
        }
      }
    }
    // Each constructor must reject insufficient output/control arenas explicitly.
    pipeline.set({ capacity: { commands: 1, controls: 8 } });
    childQueue.write(new Uint32Array(4));
    pipeline.dispatch(count);
    const exhausted = new Uint32Array(await results.read());
    for (let index = 0; index < count; index++) assert.equal(exhausted[index * 8 + 3], 1, `${fixture.cases[index].description.name}: overflow is explicit`);
    await gpu.settled();
    assert.deepEqual(errors, [], 'Native terrain overflow execution errors');
    return { cases: reports, pointCount, childCount, coordinateTolerance, colorTolerance, maximumCoordinateError, maximumColorError };
  } finally { unsubscribe(); pipeline.dispose(); }
}
