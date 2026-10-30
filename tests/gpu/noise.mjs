import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compute, storage } from "vgpu/node";
import { prepareShader } from "@vgpu/wgsl/prepare";
import { resolveShader } from "@vgpu/wgsl/runtime";

const tolerance = 2e-6;

/** Compare production WGSL to accepted upstream samples and the captured noise table. */
export async function checkNoise(gpu, fixture) {
  await checkRandomStreams(gpu);
  const { positions, expected } = fixture.noise;
  const originalTable = fixture.table;
  assert.equal(originalTable.length, 4096, "Acceptance data must include the complete noise table");
  const noiseSource = await readFile(new URL("../../src/shaders/noise.wgsl", import.meta.url), "utf8");
  const resolved = await resolveShader({
    entry: "probe.wgsl",
    validate: "off", // compile() below performs the native validation on the caller's device.
    modules: {
      "noise.wgsl": noiseSource,
      "probe.wgsl": `
        import { p5Noise } from "./noise.wgsl";
        @group(0) @binding(0) var<storage, read> table: array<f32>;
        @group(0) @binding(1) var<storage, read> positions: array<vec4f>;
        @group(0) @binding(2) var<storage, read_write> results: array<f32>;
        @compute @workgroup_size(1)
        fn cs_main(@builtin(global_invocation_id) id: vec3u) {
          results[id.x] = p5Noise(positions[id.x].xyz, &table);
        }
      `,
    },
  });
  assert.equal(resolved.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length, 0);

  // The supplied GPU owns these buffers and the runner releases them with gpu.dispose().
  const tableData = Float32Array.from(originalTable);
  const table = storage(gpu, tableData.byteLength, "read");
  table.write(tableData);
  const positionData = Float32Array.from(positions.flatMap((position) => [...position, 0]));
  const positionBuffer = storage(gpu, positionData.byteLength, "read");
  positionBuffer.write(positionData);
  const results = storage(gpu, positions.length * Float32Array.BYTES_PER_ELEMENT);
  const pipeline = compute(gpu, prepareShader(resolved), {
    label: "original-noise-comparison",
    set: { table, positions: positionBuffer, results },
  });

  try {
    await pipeline.compile();
    pipeline.dispatch(positions.length);
    const actual = new Float32Array(await results.read());
    assert.equal(actual.length, expected.length);
    let maxAbsoluteError = 0;
    let totalAbsoluteError = 0;
    for (let index = 0; index < actual.length; index++) {
      assert.ok(Number.isFinite(expected[index]), `Original noise is not finite at ${positions[index]}`);
      assert.ok(Number.isFinite(actual[index]), `GPU noise is not finite at ${positions[index]}`);
      const error = Math.abs(actual[index] - expected[index]);
      assert.ok(error <= tolerance, `Noise at ${positions[index]} differs by ${error}: GPU ${actual[index]}, original ${expected[index]}`);
      maxAbsoluteError = Math.max(maxAbsoluteError, error);
      totalAbsoluteError += error;
    }
    return {
      samples: actual.length,
      maxAbsoluteError,
      meanAbsoluteError: totalAbsoluteError / actual.length,
      tolerance,
    };
  } finally {
    pipeline.dispose();
  }
}

async function checkRandomStreams(gpu) {
  const source = await readFile(new URL('../../src/shaders/random.wgsl', import.meta.url), 'utf8');
  const resolved = await resolveShader({ entry: 'random-probe.wgsl', validate: 'off', modules: {
    'random.wgsl': source,
    'random-probe.wgsl': `import { sampleRandom } from "./random.wgsl";
      @group(0) @binding(0) var<storage, read_write> values: array<u32>;
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
        var state = id.x;
        for (var i = 0u; i < 8u; i++) {
          let sample = sampleRandom(&state);
          values[id.x * 8u + i] = state;
        }
      }`,
  }});
  const values = storage(gpu, 3 * 8 * 4);
  const pipeline = compute(gpu, prepareShader(resolved), { set: { values } });
  try {
    await pipeline.compile(); pipeline.dispatch(3);
    const actual = new Uint32Array(await values.read());
    for (let seed = 0; seed < 3; seed++) {
      let state = seed || 0x6d2b79f5;
      for (let i = 0; i < 8; i++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        assert.equal(actual[seed * 8 + i], state >>> 0);
        assert.notEqual(state >>> 0, 0, 'Random stream became absorbing');
      }
    }
  } finally { pipeline.dispose(); values.destroy(); }
}
