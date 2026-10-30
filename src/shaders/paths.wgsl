import { Brush, View } from "./commands.wgsl";

@group(0) @binding(0) var<storage, read> jobs: array<Brush>;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var<storage, read> bounds: array<vec4f>;
@group(0) @binding(3) var<uniform> view: View;

struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) world: vec2f,
  @location(1) @interpolate(flat, either) command: u32,
}

fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }

fn nearSegment(p: vec2f, a: vec2f, b: vec2f, margin: f32) -> bool {
  return all(p >= min(a, b) - vec2f(margin)) && all(p <= max(a, b) + vec2f(margin));
}

fn nearJoin(p: vec2f, center: vec2f, radius: f32) -> bool {
  let pixel = view.span / view.resolution;
  let extent = radius * 4.0 + max(pixel.x, pixel.y);
  return dot(p - center, p - center) <= extent * extent;
}

fn previousDistinctPoint(offset: u32, index: u32, center: vec2f) -> vec2f {
  // SVG ignores zero-length segments when choosing the incoming join direction.
  var cursor = index;
  while (cursor > 0u) {
    cursor--;
    let previous = points[offset + cursor];
    if (any(previous != center)) { return previous; }
  }
  return center;
}

fn segmentDistanceSquared(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let direction = b - a;
  let projection = clamp(dot(p - a, direction) / max(dot(direction, direction), 1e-20), 0.0, 1.0);
  let distance = p - a - direction * projection;
  return dot(distance, distance);
}

fn triangleDistance(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let distance = sqrt(min(segmentDistanceSquared(p, a, b), min(segmentDistanceSquared(p, b, c), segmentDistanceSquared(p, c, a))));
  let direction = sign(cross2(b - a, c - a));
  let inside = direction != 0.0 && direction * cross2(b - a, p - a) >= 0.0
    && direction * cross2(c - b, p - b) >= 0.0 && direction * cross2(a - c, p - c) >= 0.0;
  return select(distance, -distance, inside);
}

fn quadDistance(p: vec2f, a: vec2f, b: vec2f, c: vec2f, d: vec2f) -> f32 {
  let distance = sqrt(min(min(segmentDistanceSquared(p, a, b), segmentDistanceSquared(p, b, c)),
    min(segmentDistanceSquared(p, c, d), segmentDistanceSquared(p, d, a))));
  let direction = sign(cross2(b - a, c - a));
  let inside = direction != 0.0 && direction * cross2(b - a, p - a) >= 0.0
    && direction * cross2(c - b, p - b) >= 0.0 && direction * cross2(d - c, p - c) >= 0.0
    && direction * cross2(a - d, p - d) >= 0.0;
  return select(distance, -distance, inside);
}

// SVG's default line cap is butt: a segment is a rectangle, not a capsule.
fn strokeSegmentDistance(p: vec2f, a: vec2f, b: vec2f, radius: f32) -> f32 {
  let pixel = view.span / view.resolution;
  if (!nearSegment(p, a, b, radius + max(pixel.x, pixel.y))) { return 1e20; }
  let extent = length(b - a);
  if (extent < 1e-10) { return 1e20; }
  let direction = (b - a) / extent;
  let local = vec2f(dot(p - a, direction) - extent * 0.5, cross2(direction, p - a));
  let outside = abs(local) - vec2f(extent * 0.5, radius);
  return length(max(outside, vec2f(0.0))) + min(max(outside.x, outside.y), 0.0);
}

fn insideStrokeSegment(p: vec2f, a: vec2f, b: vec2f, radius: f32) -> bool {
  if (!nearSegment(p, a, b, radius)) { return false; }
  let direction = b - a;
  let lengthSquared = dot(direction, direction);
  let projection = dot(p - a, direction);
  let perpendicular = cross2(direction, p - a);
  return lengthSquared >= 1e-20 && projection >= 0.0 && projection <= lengthSquared
    && perpendicular * perpendicular <= radius * radius * lengthSquared;
}

fn joinDistance(p: vec2f, previous: vec2f, center: vec2f, next: vec2f, radius: f32) -> f32 {
  let incoming = center - previous;
  let outgoing = next - center;
  if (dot(incoming, incoming) < 1e-20 || dot(outgoing, outgoing) < 1e-20) { return 1e20; }
  let d0 = normalize(incoming);
  let d1 = normalize(outgoing);
  let turn = cross2(d0, d1);
  if (abs(turn) < 1e-6) { return 1e20; }
  let side = select(1.0, -1.0, turn > 0.0);
  let n0 = vec2f(-d0.y, d0.x) * side;
  let n1 = vec2f(-d1.y, d1.x) * side;
  let a = center + n0 * radius;
  let b = center + n1 * radius;
  let miterDirection = normalize(n0 + n1);
  let denominator = dot(miterDirection, n1);
  // SVG's default miter limit is four times the half stroke width.
  if (denominator < 0.25) { return triangleDistance(p, center, a, b); }
  let miter = center + miterDirection * (radius / denominator);
  return quadDistance(p, center, a, miter, b);
}

// Only pixels touching a path edge need subpixel winding tests. Testing the
// winding at each sample avoids fading internal edges of self-overlapping paths
// or inventing fill coverage for a zero-area two-point brush.
fn boundaryFillCoverage(p: vec2f, offset: u32, count: u32) -> f32 {
  let pixel = view.span / view.resolution;
  let sampleX = vec4f(p.x) + vec4f(-0.375, -0.125, 0.125, 0.375) * pixel.x;
  var covered = 0.0;
  for (var row = 0u; row < 4u; row++) {
    let sampleY = p.y + (f32(row) * 0.25 - 0.375) * pixel.y;
    var winding = vec4i(0);
    for (var i = 0u; i < count; i++) {
      let a = points[offset + i];
      let b = points[offset + (i + 1u) % count];
      if (a.y <= sampleY && b.y > sampleY) {
        let side = (b.x - a.x) * (sampleY - a.y) - (b.y - a.y) * (sampleX - vec4f(a.x));
        winding += select(vec4i(0), vec4i(1), side > vec4f(0.0));
      }
      if (a.y > sampleY && b.y <= sampleY) {
        let side = (b.x - a.x) * (sampleY - a.y) - (b.y - a.y) * (sampleX - vec4f(a.x));
        winding -= select(vec4i(0), vec4i(1), side < vec4f(0.0));
      }
    }
    covered += dot(select(vec4f(0.0), vec4f(1.0), winding != vec4i(0)), vec4f(1.0));
  }
  return covered / 16.0;
}

fn boundaryStrokeCoverage(p: vec2f, offset: u32, count: u32, radius: f32) -> f32 {
  let pixel = view.span / view.resolution;
  var covered = 0u;
  // Reject edges outside the whole sample footprint before testing its 16 points.
  let margin = radius + max(pixel.x, pixel.y) * 0.375;
  for (var i = 0u; i + 1u < count; i++) {
    let a = points[offset + i];
    let b = points[offset + i + 1u];
    let segment = nearSegment(p, a, b, margin);
    let join = i > 0u && nearJoin(p, a, radius);
    if (!segment && !join) { continue; }
    var previous = a;
    if (join) { previous = previousDistinctPoint(offset, i, a); }
    for (var row = 0u; row < 4u; row++) {
      for (var column = 0u; column < 4u; column++) {
        let bit = 1u << (row * 4u + column);
        if ((covered & bit) != 0u) { continue; }
        let samplePoint = p + (vec2f(f32(column), f32(row)) * 0.25 - vec2f(0.375)) * pixel;
        var inside = segment && insideStrokeSegment(samplePoint, a, b, radius);
        if (!inside && join && nearJoin(samplePoint, a, radius)) {
          inside = joinDistance(samplePoint, previous, a, b, radius) <= 0.0;
        }
        if (inside) { covered |= bit; }
      }
    }
    if (covered == 65535u) { break; }
  }
  return f32(countOneBits(covered)) / 16.0;
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) command: u32) -> Vertex {
  let corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let box = bounds[command];
  // A miter may extend to four half-widths; reserve another pixel for AA.
  let expansion = max(jobs[command].outlineWidth, 0.0) * 2.0 + max(view.span.x / view.resolution.x, view.span.y / view.resolution.y);
  let world = mix(box.xy - vec2f(expansion), box.zw + vec2f(expansion), corners[vertex]);
  let clip = (world - view.offset) / view.span;
  return Vertex(vec4f(clip.x * 2.0 - 1.0, 1.0 - clip.y * 2.0, 0.0, 1.0), world, command);
}

@fragment
fn fs_main(vertex: Vertex) -> @location(0) vec4f {
  let job = jobs[vertex.command];
  let count = job.pointCount;
  if (count < 2u || (job.fill.a == 0.0 && job.edge.a == 0.0)) { discard; }
  let p = vertex.world;
  let aa = max(length(fwidth(p)) * 0.5, 1e-6);
  var winding = 0i;
  var fillDistanceSquared = 1e20;
  var outlineDistance = 1e20;
  let radius = max(job.outlineWidth, 0.0) * 0.5;
  for (var i = 0u; i < count; i++) {
    let a = points[job.pointOffset + i];
    let b = points[job.pointOffset + (i + 1u) % count];
    if (job.fill.a > 0.0) {
      if (nearSegment(p, a, b, aa)) {
        fillDistanceSquared = min(fillDistanceSquared, segmentDistanceSquared(p, a, b));
      }
      if (a.y <= p.y && b.y > p.y && cross2(b - a, p - a) > 0.0) { winding++; }
      if (a.y > p.y && b.y <= p.y && cross2(b - a, p - a) < 0.0) { winding--; }
    }
    // Fill closes implicitly; outline follows only authored edges.
    if (job.edge.a > 0.0 && radius > 0.0 && i + 1u < count) {
      outlineDistance = min(outlineDistance, strokeSegmentDistance(p, a, b, radius));
      if (i > 0u && nearJoin(p, a, radius)) {
        outlineDistance = min(outlineDistance, joinDistance(p, previousDistinctPoint(job.pointOffset, i, a), a, b, radius));
      }
    }
  }
  var fillCoverage = select(0.0, 1.0, winding != 0);
  if (job.fill.a > 0.0 && fillDistanceSquared < aa * aa) {
    fillCoverage = boundaryFillCoverage(p, job.pointOffset, count);
  }
  let fillAlpha = job.fill.a * fillCoverage;
  var edgeCoverage = select(0.0, 1.0, outlineDistance <= 0.0);
  if (job.edge.a > 0.0 && radius > 0.0 && abs(outlineDistance) < aa) {
    edgeCoverage = boundaryStrokeCoverage(p, job.pointOffset, count, radius);
  }
  let edgeAlpha = job.edge.a * edgeCoverage;
  let alpha = edgeAlpha + fillAlpha * (1.0 - edgeAlpha);
  let color = job.edge.rgb * edgeAlpha + job.fill.rgb * fillAlpha * (1.0 - edgeAlpha);
  return vec4f(color, alpha);
}
