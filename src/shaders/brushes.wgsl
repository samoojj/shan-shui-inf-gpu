import { Job } from "./commands.wgsl";
import { p5Noise } from "./noise.wgsl";

@group(0) @binding(0) var<storage, read> jobs: array<Job>;
@group(0) @binding(1) var<storage, read> inputData: array<vec4f>;
@group(0) @binding(2) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(3) var<storage, read_write> points: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> bounds: array<vec4f>;

fn svgCoordinate(value: f32) -> f32 {
  // The reference replaces NaN coordinates with -1000 before serializing SVG.
  let bits = bitcast<u32>(value);
  if ((bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u) {
    return -1000.0;
  }
  // toFixed(1) rounds halfway magnitudes upward; WGSL round uses even ties.
  return sign(value) * floor(abs(value) * 10.0 + 0.5) * 0.1;
}

fn svgPoint(point: vec2f) -> vec2f {
  return vec2f(svgCoordinate(point.x), svgCoordinate(point.y));
}

fn originalAngle(delta: vec2f) -> f32 {
  // JavaScript defines atan2(+0, +0) as zero; native WGSL results may differ.
  if (all(delta == vec2f(0.0))) { return 0.0; }
  return atan2(delta.y, delta.x);
}

fn centerPoint(job: Job, index: u32) -> vec2f {
  if (job.header.x != 3u) {
    return inputData[job.header.y + index].xy;
  }
  let layer = job.texture.x;
  let fraction = layer - floor(layer);
  let columns = u32(job.texture.z);
  let column = u32(job.texture.y) + index;
  let lower = inputData[job.header.y + u32(floor(layer)) * columns + column].xy;
  let upper = inputData[job.header.y + u32(ceil(layer)) * columns + column].xy;
  // Preserve upstream's reversed interpolation weights.
  let point = lower * fraction + upper * (1.0 - fraction);
  let jitter = vec2f(
    p5Noise(vec3f(point.x, f32(column) * 0.5, 0.0), &noiseTable),
    p5Noise(vec3f(point.y, f32(column) * 0.5, 0.0), &noiseTable),
  );
  return point + job.texture.w * (jitter - vec2f(0.5));
}

// Each center is evaluated once. Positive offsets overwrite the forward half;
// negative offsets occupy the unused reverse half, so a rolling three-point
// window can expand the ribbon without another buffer or another dispatch.
fn expandRibbon(job: Job) {
  let count = job.header.z;
  let base = job.header.w;
  if (count == 1u) {
    let point = centerPoint(job, 0u);
    for (var i = 0u; i < job.extra.x; i++) { points[base + i] = point; }
    return;
  }
  for (var i = 0u; i < count; i++) { points[base + i] = centerPoint(job, i); }
  let first = points[base];
  var previous = first;
  var current = points[base + 1u];
  for (var i = 1u; i + 1u < count; i++) {
    let next = points[base + i + 1u];
    var width = inputData[job.header.y + i].z;
    if (job.header.x == 3u) {
      width = job.brush.x * sin(f32(i) / f32(count) * 3.141592653589793);
    }
    width = width * (1.0 - job.brush.y)
      + width * job.brush.y * p5Noise(vec3f(f32(i) * 0.5, job.brush.z, 0.0), &noiseTable);
    let a1 = originalAngle(current - previous);
    let a2 = originalAngle(current - next);
    var angle = (a1 + a2) * 0.5;
    if (angle < a2) { angle += 3.141592653589793; }
    let displacement = width * vec2f(cos(angle), sin(angle));
    points[base + i] = current + displacement;
    points[base + 2u * count - 2u - i] = current - displacement;
    previous = current;
    current = next;
  }
  points[base + job.extra.x - 1u] = first;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let command = invocation.x;
  if (command >= arrayLength(&jobs)) { return; }
  let job = jobs[command];
  if (job.extra.x == 0u || job.header.z == 0u) {
    bounds[command] = vec4f(0.0);
    return;
  }

  // Blob noise is corrected at the seam, then normalized as in loopNoise().
  var blobNoise: array<f32, 21>;
  if (job.header.x == 2u) {
    for (var i = 0u; i < 21u; i++) {
      blobNoise[i] = p5Noise(vec3f(f32(i) * 0.05, job.brush.z, 0.0), &noiseTable);
    }
    let difference = blobNoise[20] - blobNoise[0];
    var low = 100.0;
    var high = -100.0;
    for (var i = 0u; i < 21u; i++) {
      blobNoise[i] += difference * f32(20u - i) / 20.0;
      low = min(low, blobNoise[i]);
      high = max(high, blobNoise[i]);
    }
    for (var i = 0u; i < 21u; i++) {
      blobNoise[i] = (blobNoise[i] - low) / (high - low);
    }
  }

  if (job.header.x == 1u || job.header.x == 3u) { expandRibbon(job); }

  var minimum = vec2f(3.402823466e+38);
  var maximum = vec2f(-3.402823466e+38);
  for (var i = 0u; i < job.extra.x; i++) {
    var point: vec2f;
    if (job.header.x == 0u) {
      point = inputData[job.header.y + i].xy;
    } else if (job.header.x == 2u) {
      let p = f32(i) / 20.0 * 2.0;
      let longitudinal = job.origin.z * 0.5 - abs(p - 1.0) * job.origin.z;
      let transverse = inputData[job.extra.y + i].x * job.brush.x * 0.5;
      let angle = originalAngle(vec2f(longitudinal, transverse)) + job.origin.w;
      let radius = sqrt(longitudinal * longitudinal + transverse * transverse);
      let variation = blobNoise[i] * job.brush.y + (1.0 - job.brush.y);
      point = vec2f(cos(angle), sin(angle)) * radius * variation;
    } else {
      point = points[job.header.w + i];
    }
    let output = svgPoint(point + job.origin.xy);
    points[job.header.w + i] = output;
    minimum = min(minimum, output);
    maximum = max(maximum, output);
  }
  bounds[command] = vec4f(minimum, maximum);
}
