import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compute, storage } from "vgpu/node";
import { prepareShader } from "@vgpu/wgsl/prepare";
import { resolveShader } from "@vgpu/wgsl/runtime";

const tolerance = 2e-6;

/** Compare the production WGSL to the pinned original, using its initialized noise table. */
export async function checkNoise(gpu, original) {
  const positions = Array.from({ length: 256 }, (_, index) => [
    Math.fround(Math.sin(index * 0.51) * 3000),
    Math.fround(Math.cos(index * 0.37) * 30),
    Math.fround((index % 13) / 7),
  ]);
  positions.push(
    [0, 0, 0],
    [-1, -16, -256],
    [4095.75, 4096.25, 0.5],
    [4096, 4096, 4096],
  );

  const originalTable = original.Noise.getTable();
  assert.equal(originalTable?.length, 4096, "Initialize the original noise table before this check");
  const expected = positions.map((position) => original.Noise.noise(...position));
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
