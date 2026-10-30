import { BOAT, DISTANT_MOUNTAIN, ISLAND, MOUNTAIN, WATER, SceneObject } from "./commands.wgsl";
import { p5Noise } from "./noise.wgsl";
import { hash, sampleRandom } from "./random.wgsl";
struct Planning { seed: u32, firstChunk: i32, chunkCount: u32, padding: u32 }
@group(0) @binding(0) var<uniform> planning: Planning;
@group(0) @binding(1) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(2) var<storage, read_write> candidates: array<SceneObject>;
@group(0) @binding(3) var<storage, read_write> overflow: array<atomic<u32>>;
fn field(position: f32) -> f32 { return max(p5Noise(vec3f(position * 0.03, 0.0, 0.0), &noiseTable) - 0.55, 0.0) * 2.0; }
fn localMaximum(position: f32) -> bool {
  let height = field(position);
  if (height <= 0.3) { return false; }
  for (var offset = -2; offset < 2; offset++) { if (field(position + f32(offset)) > height) { return false; } }
  return true;
}
fn add(records: ptr<function, array<SceneObject, 64>>, count: ptr<function, u32>, description: SceneObject, separation: f32) -> bool {
  for (var index = 0u; index < *count; index++) { if (abs((*records)[index].origin.x - description.origin.x) < separation) { return false; } }
  if (*count == 64u) { atomicStore(&overflow[3], 1u); return false; }
  (*records)[*count] = description; (*count)++; return true;
}
fn object(kind: u32, origin: vec2f, randomState: ptr<function, u32>) -> SceneObject {
  var description: SceneObject;
  description.kind = kind; description.origin = origin; description.depth = origin.y;
  description.seed = max(1u, hash(*randomState ^ kind));
  description.rotation = sampleRandom(randomState) * 100.0;
  if (kind == MOUNTAIN) {
    description.size = vec2f(400.0 + sampleRandom(randomState) * 200.0, 100.0 + sampleRandom(randomState) * 400.0);
  } else if (kind == ISLAND) {
    description.size = vec2f(600.0 + sampleRandom(randomState) * 400.0, 100.0);
    description.perspective = 0.5 + sampleRandom(randomState) * 0.2;
  } else if (kind == DISTANT_MOUNTAIN) {
    description.size = vec2f(f32(1u + u32(sampleRandom(randomState) * 3.0)) * 500.0, 150.0);
  } else if (kind == BOAT) {
    description.size = vec2f(120.0, origin.y / 800.0);
    description.flags = u32(sampleRandom(randomState) * 2.0);
  }
  return description;
}
fn mountainCandidates(chunk: i32, randomState: ptr<function, u32>, records: ptr<function, array<SceneObject, 64>>, count: ptr<function, u32>) {
  let start = f32(chunk) * 512.0;
  for (var sample = 0u; sample < 103u; sample++) {
    let position = start + f32(sample) * 5.0;
    if (localMaximum(position)) {
      let rows = p5Noise(vec3f(position * 0.01, 3.141592653589793, 0.0), &noiseTable) * 480.0;
      for (var elevation = 0.0; elevation < rows; elevation += 30.0) {
        let origin = vec2f(position + (sampleRandom(randomState) - 0.5) * 1000.0, elevation + 300.0);
        let accepted = add(records, count, object(MOUNTAIN, origin, randomState), 10.0);
      }
    }
    if (abs(position) % 1000.0 < 4.0) { let accepted = add(records, count, object(DISTANT_MOUNTAIN, vec2f(position, 280.0 - sampleRandom(randomState) * 50.0), randomState), 10.0); }
  }
}
fn markMountainOccupancy(records: ptr<function, array<SceneObject, 64>>, count: u32, start: f32, occupied: ptr<function, array<bool, 103>>) {
  for (var index = 0u; index < count; index++) {
    if ((*records)[index].kind != MOUNTAIN) { continue; }
    for (var sample = 0u; sample < 103u; sample++) {
      if (abs((*records)[index].origin.x - (start + f32(sample) * 5.0)) < 200.0) { (*occupied)[sample] = true; }
    }
  }
}
@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= planning.chunkCount) { return; }
  let chunk = planning.firstChunk + i32(invocation.x);
  let start = f32(chunk) * 512.0;
  var randomState = max(1u, hash(planning.seed ^ bitcast<u32>(chunk)));
  var records: array<SceneObject, 64>; var count = 0u;
  mountainCandidates(chunk, &randomState, &records, &count);
  var occupied: array<bool, 103>;
  markMountainOccupancy(&records, count, start, &occupied);
  // A mountain jitters at most 500 units and excludes another 200 units.
  // Two neighboring chunks on either side cover every possible contributor.
  // Derive them from world chunk IDs, even outside the requested view: occupancy
  // must not depend on which range or navigation history generated this chunk.
  var neighbors: array<SceneObject, 64>;
  for (var offset = -2; offset <= 2; offset++) {
    if (offset == 0) { continue; }
    let neighborChunk = chunk + offset;
    var neighborState = max(1u, hash(planning.seed ^ bitcast<u32>(neighborChunk)));
    var neighborCount = 0u;
    mountainCandidates(neighborChunk, &neighborState, &neighbors, &neighborCount);
    markMountainOccupancy(&neighbors, neighborCount, start, &occupied);
  }
  for (var sample = 0u; sample < 103u; sample++) {
    let position = start + f32(sample) * 5.0;
    if (!occupied[sample] && sampleRandom(&randomState) < 0.01) {
      for (var row = 0u; f32(row) < sampleRandom(&randomState) * 4.0; row++) {
        let origin = vec2f(position + (sampleRandom(&randomState) - 0.5) * 1400.0, 700.0 - f32(row) * 50.0);
        let accepted = add(&records, &count, object(ISLAND, origin, &randomState), 10.0);
      }
    }
  }
  for (var sample = 0u; sample < 103u; sample++) {
    if (sampleRandom(&randomState) < 0.2) {
      let origin = vec2f(start + f32(sample) * 5.0, 300.0 + sampleRandom(&randomState) * 390.0);
      let accepted = add(&records, &count, object(BOAT, origin, &randomState), 400.0);
    }
  }
  // Water sorts behind every land object while retaining its mountain's anchor.
  var outputCount = 0u;
  for (var index = 0u; index < count; index++) {
    if (outputCount >= 128u) { atomicStore(&overflow[3], 1u); return; }
    var description = records[index];
    if (description.kind == MOUNTAIN) {
    description.rotation = 2.0 * f32(index) * sampleRandom(&randomState); }
    if (description.kind == ISLAND) {
    description.rotation = 6.283185307179586 * sampleRandom(&randomState); }
    candidates[invocation.x * 128u + outputCount] = description; outputCount++;
    if (records[index].kind == MOUNTAIN) {
      var water = records[index]; water.kind = WATER; water.depth -= 10000.0; water.size = vec2f(800.0, 2.0); water.style = 10u;
      candidates[invocation.x * 128u + outputCount] = water; outputCount++;
    }
  }
}
