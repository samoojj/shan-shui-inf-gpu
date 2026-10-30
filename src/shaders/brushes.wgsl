import { CONTOUR_BRUSH, LEAF_BRUSH, POLYGON_BRUSH, RIBBON_BRUSH, Brush } from "./commands.wgsl";
import { p5Noise } from "./noise.wgsl";
import { originalAngle, leafNoise, leafPoint } from "./leaf-shape.wgsl";

@group(0) @binding(0) var<storage, read> jobs: array<Brush>;
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

fn centerPoint(job: Brush, index: u32) -> vec2f {
  if (job.kind != CONTOUR_BRUSH) {
    return inputData[job.controlOffset + index].xy;
  }
  let layer = job.layer;
  let fraction = layer - floor(layer);
  let columns = u32(job.columns);
  let column = u32(job.firstColumn) + index;
  let lower = inputData[job.controlOffset + u32(floor(layer)) * columns + column].xy;
  let upper = inputData[job.controlOffset + u32(ceil(layer)) * columns + column].xy;
  // Preserve upstream's reversed interpolation weights.
  let point = lower * fraction + upper * (1.0 - fraction);
  let jitter = vec2f(
    p5Noise(vec3f(point.x, f32(column) * 0.5, 0.0), &noiseTable),
    p5Noise(vec3f(point.y, f32(column) * 0.5, 0.0), &noiseTable),
  );
  return point + job.jitter * (jitter - vec2f(0.5));
}

// Each center is evaluated once. Positive offsets overwrite the forward half;
// negative offsets occupy the unused reverse half, so a rolling three-point
// window can expand the ribbon without another buffer or another dispatch.
fn expandRibbon(job: Brush) {
  let count = job.controlCount;
  let base = job.pointOffset;
  if (count == 1u) {
    let point = centerPoint(job, 0u);
    for (var i = 0u; i < job.pointCount; i++) { points[base + i] = point; }
    return;
  }
  for (var i = 0u; i < count; i++) { points[base + i] = centerPoint(job, i); }
  let first = points[base];
  var previous = first;
  var current = points[base + 1u];
  for (var i = 1u; i + 1u < count; i++) {
    let next = points[base + i + 1u];
    var width = inputData[job.controlOffset + i].z;
    if (job.kind == CONTOUR_BRUSH) {
      width = job.width * sin(f32(i) / f32(count) * 3.141592653589793);
    }
    width = width * (1.0 - job.noiseAmount)
      + width * job.noiseAmount * p5Noise(vec3f(f32(i) * 0.5, job.noiseOffset, 0.0), &noiseTable);
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
  points[base + job.pointCount - 1u] = first;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let command = invocation.x;
  if (command >= arrayLength(&jobs)) { return; }
  let job = jobs[command];
  if (job.pointCount == 0u || job.controlCount == 0u) {
    bounds[command] = vec4f(0.0);
    return;
  }

  var blobNoise: array<f32, 21>;
  if (job.kind == LEAF_BRUSH) { blobNoise = leafNoise(job.noiseOffset, &noiseTable); }

  if (job.kind == RIBBON_BRUSH || job.kind == CONTOUR_BRUSH) { expandRibbon(job); }

  var minimum = vec2f(3.402823466e+38);
  var maximum = vec2f(-3.402823466e+38);
  for (var i = 0u; i < job.pointCount; i++) {
    var point: vec2f;
    if (job.kind == POLYGON_BRUSH) {
      point = inputData[job.controlOffset + i].xy;
    } else if (job.kind == LEAF_BRUSH) {
      point = leafPoint(i, job.length, job.width, inputData[job.profileOffset + i].x,
        job.angle, job.noiseAmount, blobNoise[i]);
    } else {
      point = points[job.pointOffset + i];
    }
    let output = svgPoint(point + job.origin);
    points[job.pointOffset + i] = output;
    minimum = min(minimum, output);
    maximum = max(maximum, output);
  }
  bounds[command] = vec4f(minimum, maximum);
}
