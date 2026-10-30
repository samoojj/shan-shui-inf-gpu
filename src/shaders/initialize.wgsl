import { hash } from "./random.wgsl";
struct Seed { value: u32 }
@group(0) @binding(0) var<uniform> seed: Seed;
@group(0) @binding(1) var<storage, read_write> noiseTable: array<f32>;
@group(0) @binding(2) var<storage, read_write> paperRandom: array<f32>;
@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index < arrayLength(&noiseTable)) { noiseTable[index] = f32(hash(seed.value ^ index) >> 8u) / 16777216.0; }
  if (index < arrayLength(&paperRandom)) { paperRandom[index] = f32(hash(seed.value ^ index ^ 0xa511e9b3u) >> 8u) / 16777216.0; }
}
