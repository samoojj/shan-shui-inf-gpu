import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';

const commandCapacity = 2048;
const controlCapacity = 65536;
const coordinateTolerance = .001;
const scalarTolerance = .00001;
const entries = ['thatch', 'architecture', 'figures', 'boats', 'towers', 'ripples'];

function requestBuffer(cases) {
  const bytes = new ArrayBuffer(cases.length * 80);
  const floats = new Float32Array(bytes);
  const integers = new Uint32Array(bytes);
  for (const [index, fixture] of cases.entries()) {
    const request = fixture.request;
    const offset = index * 20;
    floats.set([...request.origin, request.width, request.height, request.rotation, request.perspective, request.scale, 0], offset);
    integers.set([request.kind, request.style, request.stories, request.decoration, request.seed, request.flags, request.clusters, 0,
      request.commandCapacity ?? commandCapacity, request.controlCapacity ?? controlCapacity, 0, 0], offset + 8);
  }
  return bytes;
}

function close(actual, expected, tolerance, message) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

function inspect(fixture, index, result, controls, commandBytes) {
  const counts = result.subarray(index * 9, index * 9 + 9);
  assert(counts[4] <= (fixture.request.commandCapacity ?? commandCapacity), `${fixture.label}: command arena overrun`);
  assert(counts[5] <= (fixture.request.controlCapacity ?? controlCapacity), `${fixture.label}: control arena overrun`);
  if (fixture.expectOverflow) {
    assert.notEqual(counts[7], 0, `${fixture.label}: capacity exhaustion must report overflow`);
    return { label: fixture.label, overflow: true, commands: counts[4], controls: counts[5] };
  }
  assert.equal(counts[7], 0, `${fixture.label}: unexpected overflow`);
  assert.equal(counts[4], fixture.commands.length, `${fixture.label}: painter command count`);
  assert.equal(counts[8], fixture.randomState, `${fixture.label}: final random state`);
  const integers = new Uint32Array(commandBytes);
  const floats = new Float32Array(commandBytes);
  let maximumError = 0;
  let comparedPoints = 0;
  for (const [commandIndex, expected] of fixture.commands.entries()) {
    const base = (index * commandCapacity + commandIndex) * 32;
    assert.equal(integers[base], expected.kind, `${fixture.label} command ${commandIndex}: painter order/kind`);
    assert.equal(integers[base + 2], expected.controlCount, `${fixture.label} command ${commandIndex}: control count`);
    const path = fixture.paths[expected.path];
    const start = integers[base + 1];
    assert(start >= index * controlCapacity && start + path.length <= index * controlCapacity + counts[5], `${fixture.label}: referenced path outside its arena`);
    for (const [sample, expectedPoint] of path.entries()) {
      for (let axis = 0; axis < 2; axis++) {
        const actual = controls[(start + sample) * 4 + axis];
        close(actual, expectedPoint[axis], coordinateTolerance, `${fixture.label} command ${commandIndex}, point ${sample}, axis ${axis}`);
        maximumError = Math.max(maximumError, Math.abs(actual - expectedPoint[axis]));
      }
      comparedPoints++;
      if (expected.widths && sample > 0 && sample + 1 < path.length) {
        close(controls[(start + sample) * 4 + 2], expected.widths[sample], scalarTolerance, `${fixture.label}: stroke width profile`);
      }
    }
    for (let channel = 0; channel < 4; channel++) {
      close(floats[base + 4 + channel], expected.fill[channel], scalarTolerance, `${fixture.label}: fill and white occlusion`);
      if (expected.outline > 0) close(floats[base + 8 + channel], expected.edge[channel], scalarTolerance, `${fixture.label}: outline color`);
    }
    close(floats[base + 15], expected.outline, scalarTolerance, `${fixture.label}: outline width`);
    if (expected.seed !== undefined) {
      close(floats[base + 14], expected.seed, scalarTolerance, `${fixture.label}: stroke noise seed`);
      close(floats[base + 13], expected.noise, scalarTolerance, `${fixture.label}: stroke noise amount`);
    }
    if (expected.texture) {
      const texture = expected.texture;
      const actual = [floats[base + 12], floats[base + 16], floats[base + 17], floats[base + 20], floats[base + 21], floats[base + 22], floats[base + 23]];
      const values = [texture.width, ...texture.origin, texture.layer, texture.start, texture.columns, texture.jitter];
      values.forEach((value, field) => close(actual[field], value, scalarTolerance, `${fixture.label}: texture interpolation parameter ${field}`));
    }
  }
  return { label: fixture.label, commands: counts[4], controls: counts[5], points: counts[6], comparedPoints, maximumError };
}

/** Static independently captured original geometry; no CPU recipes run here. */
export async function checkMotifs(gpu) {
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/gpu-motifs.json', import.meta.url), 'utf8'));
  const entry = fileURLToPath(new URL('./motifs.wgsl', import.meta.url));
  const resolved = await resolveShader({ entry, validate: 'require' });
  assert.deepEqual(resolved.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  assert.equal(resolved.validation.ok, true);
  const shader = prepareShader(resolved, entry);
  const noiseTable = storage(gpu, fixtures.noiseTable.length * 4, 'read');
  noiseTable.write(Float32Array.from(fixtures.noiseTable));
  const reports = [];
  try {
    for (const [kind, entryName] of entries.entries()) {
      const cases = fixtures.cases.filter(fixture => fixture.request.kind === kind);
      const packed = requestBuffer(cases);
      const requests = storage(gpu, packed.byteLength, 'read');
      requests.write(packed);
      const constructionControls = storage(gpu, cases.length * controlCapacity * 16);
      const constructionJobs = storage(gpu, cases.length * commandCapacity * 128);
      const results = storage(gpu, cases.length * 36);
      const kernel = compute(gpu, shader, { entry: entryName, set: { constructionControls, constructionJobs, noiseTable, results, requests } });
      try {
        const compileStart = performance.now();
        await kernel.compile();
        const compileMs = performance.now() - compileStart;
        const firstStart = performance.now();
        kernel.dispatch(cases.length);
        await gpu.settled();
        const resultBytes = await results.read();
        const firstDispatchMs = performance.now() - firstStart;
        const [controlBytes, commandBytes] = await Promise.all([constructionControls.read(), constructionJobs.read()]);
        const values = new Uint32Array(resultBytes);
        const coordinates = new Float32Array(controlBytes);
        const rows = cases.map((fixture, index) => inspect(fixture, index, values, coordinates, commandBytes));
        kernel.dispatch(cases.length);
        await gpu.settled();
        const repeated = await Promise.all([results.read(), constructionControls.read(), constructionJobs.read()]);
        assert.deepEqual(Buffer.from(repeated[0]), Buffer.from(resultBytes), `${entryName}: deterministic counts and stream state`);
        assert.deepEqual(Buffer.from(repeated[1]), Buffer.from(controlBytes), `${entryName}: deterministic generated coordinates`);
        assert.deepEqual(Buffer.from(repeated[2]), Buffer.from(commandBytes), `${entryName}: deterministic painter commands`);
        reports.push({ entry: entryName, compileMs, firstDispatchMs, cases: rows });
      } finally {
        kernel.dispose();
        requests.destroy(); constructionControls.destroy(); constructionJobs.destroy(); results.destroy();
      }
    }
  } finally {
    noiseTable.destroy();
  }
  return { coordinateTolerance, scalarTolerance, cases: reports.flatMap(report => report.cases), pipelines: reports.map(({ cases, ...timing }) => timing) };
}
