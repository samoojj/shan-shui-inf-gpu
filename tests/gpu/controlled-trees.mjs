import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';
import { loadSource } from '../helpers/load-source.mjs';

/** Compare complete recipes against frozen CPU output with scheduling-independent randomness. */
export async function checkControlledTrees(gpu) {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/controlled-trees.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture.cases.map(input => input.style), [4, 5, 6, 8, 4, 5, 6, 8]);
  assert.deepEqual(fixture.provenance.randomValues, [.5, .4]);
  const directory = new URL('../../src/shaders/', import.meta.url);
  const modules = Object.fromEntries(await Promise.all((await readdir(directory)).filter(name => name.endsWith('.wgsl')).map(async name =>
    [`src/shaders/${name}`, await readFile(new URL(name, directory), 'utf8')])));
  // Replace only the random leaf function in this TEST pipeline; recipes, stacks,
  // branch conditions, bark/twig construction and brush emission remain production WGSL.
  modules['src/shaders/random.wgsl'] = modules['src/shaders/random.wgsl'].split('export fn sampleRandom')[0]
    + 'export fn sampleRandom(state: ptr<function, u32>) -> f32 { return f32(*state) / 1000000.0; }';
  const entry = 'tests/gpu/construction-trees.wgsl';
  modules[entry] = await readFile(new URL('./construction-trees.wgsl', import.meta.url), 'utf8');
  const resolved = await resolveShader({ entry, rootDir: '.', modules, validate: 'off' });
  assert.deepEqual(resolved.diagnostics.filter(item => item.severity === 'error'), []);
  const commandCapacity = 4096, controlCapacity = 65536, count = fixture.cases.length;
  const constructionControls = storage(gpu, count * controlCapacity * 16);
  const constructionJobs = storage(gpu, count * commandCapacity * 128);
  const noiseTable = storage(gpu, 4096 * 4, 'read');
  noiseTable.write(Buffer.from(fixture.noiseTableBase64, 'base64'));
  const cases = storage(gpu, count * 64, 'read'), counts = storage(gpu, count * 16);
  const data = new DataView(new ArrayBuffer(count * 64));
  for (const [index, input] of fixture.cases.entries()) {
    const base = index * 64;
    [...input.origin, input.width, input.height, 100 / 255, 100 / 255, 100 / 255, .5].forEach((value, field) => data.setFloat32(base + field * 4, value, true));
    data.setUint32(base + 32, input.style, true);
    data.setUint32(base + 36, Math.round(input.randomValue * 1000000), true);
    data.setUint32(base + 48, index * commandCapacity, true);
    data.setUint32(base + 52, commandCapacity, true);
    data.setUint32(base + 56, index * controlCapacity, true);
    data.setUint32(base + 60, controlCapacity, true);
  }
  cases.write(data.buffer);
  const pipeline = compute(gpu, prepareShader(resolved, entry), { label: 'independent controlled tree geometry',
    set: { constructionControls, constructionJobs, noiseTable, cases, counts } });
  const { packDrawing } = await loadSource('tests/helpers/pack-fixtures.ts');
  try {
    await pipeline.compile(); pipeline.dispatch(count);
    const [countBytes, commandBytes, controlBytes] = await Promise.all([counts.read(), constructionJobs.read(), constructionControls.read()]);
    const output = new Uint32Array(countBytes), jobs = new DataView(commandBytes), controls = new Float32Array(controlBytes);
    const differences = [];
    const reports = fixture.cases.map((input, index) => {
      const expected = packDrawing(input.drawing), packed = new DataView(expected.jobs.buffer);
      assert.equal(output[index * 4 + 3], 0, `controlled tree ${input.style}: overflow`);
      assert.equal(output[index * 4], expected.commandCount, `controlled tree ${input.style}: full original command count`);
      assert.equal(output[index * 4 + 2], expected.pointCount, `controlled tree ${input.style}: expanded point total`);
      let maximumError = 0, comparedCoordinates = 0;
      const compare = (actual, reference, label) => {
        const error = Math.abs(actual - reference); maximumError = Math.max(maximumError, error);
        if (!(Number.isFinite(error) && error <= .002) && differences.filter(difference => difference.style === input.style && difference.randomValue === input.randomValue).length < 2) {
          differences.push({ style: input.style, randomValue: input.randomValue,
            message: `${label}: expected ${reference}, got ${actual}; error ${error}` });
        }
      };
      for (let ordinal = 0; ordinal < expected.commandCount; ordinal++) {
        const actualBase = (index * commandCapacity + ordinal) * 128, expectedBase = ordinal * 128;
        const kind = packed.getUint32(expectedBase, true), n = packed.getUint32(expectedBase + 8, true);
        const actualOffset = jobs.getUint32(actualBase + 4, true), expectedOffset = packed.getUint32(expectedBase + 4, true);
        assert.equal(jobs.getUint32(actualBase, true), kind, `tree ${input.style} command ${ordinal}: painter order/type`);
        assert.equal(jobs.getUint32(actualBase + 8, true), n, `tree ${input.style} command ${ordinal}: control count`);
        assert.equal(jobs.getUint32(actualBase + 12, true), packed.getUint32(expectedBase + 12, true), `tree ${input.style} command ${ordinal}: painter point prefix`);
        assert.equal(jobs.getUint32(actualBase + 96, true), packed.getUint32(expectedBase + 96, true), `tree ${input.style} command ${ordinal}: expanded point count`);
        for (let field = 16; field < 32; field += 4) compare(jobs.getFloat32(actualBase + field, true), packed.getFloat32(expectedBase + field, true), 'fill');
        compare(jobs.getFloat32(actualBase + 60, true), packed.getFloat32(expectedBase + 60, true), 'outline');
        if (packed.getFloat32(expectedBase + 60, true) > 0) {
          for (let field = 32; field < 48; field += 4) compare(jobs.getFloat32(actualBase + field, true), packed.getFloat32(expectedBase + field, true), 'edge');
        }
        if (kind === 2) {
          for (const field of [48, 52, 56, 64, 68, 72, 76]) compare(jobs.getFloat32(actualBase + field, true), packed.getFloat32(expectedBase + field, true), `blob field ${field}`);
          for (let sample = 0; sample < n; sample++) compare(controls[(actualOffset + sample) * 4], expected.inputData[(expectedOffset + sample) * 4], 'blob profile');
        } else {
          for (let sample = 0; sample < n; sample++) {
            for (let axis = 0; axis < 2; axis++) {
              compare(controls[(actualOffset + sample) * 4 + axis] + jobs.getFloat32(actualBase + 64 + axis * 4, true),
                expected.inputData[(expectedOffset + sample) * 4 + axis] + packed.getFloat32(expectedBase + 64 + axis * 4, true), `command ${ordinal} sample ${sample} axis ${axis}`);
              comparedCoordinates++;
            }
            // Ribbon expansion uses widths only at interior samples. The CPU
            // recorder zeros endpoint metadata while production computes it.
            if (kind === 1 && sample > 0 && sample + 1 < n) compare(controls[(actualOffset + sample) * 4 + 2], expected.inputData[(expectedOffset + sample) * 4 + 2], 'signed stroke width');
          }
          if (kind === 1) for (const field of [52, 56]) compare(jobs.getFloat32(actualBase + field, true), packed.getFloat32(expectedBase + field, true), 'stroke noise');
        }
      }
      return { style: input.style, randomValue: input.randomValue, scope: 'complete controlled-random geometry', commands: expected.commandCount, comparedCoordinates, maximumError };
    });
    assert.deepEqual(differences, [], 'Complete controlled CPU/GPU tree geometry must agree');
    return reports;
  } finally {
    pipeline.dispose();
    for (const buffer of [constructionControls, constructionJobs, noiseTable, cases, counts]) buffer.destroy();
  }
}
