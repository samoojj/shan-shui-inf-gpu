import { Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
import { p5Noise } from "./noise.wgsl";
import { sampleRandom } from "./random.wgsl";

// The entry owns constructionControls, constructionJobs and noiseTable bindings.
// Each invocation receives disjoint arenas; no global append atomics or CPU paths.
export struct Path { offset: u32, count: u32 }
export struct Paint { fill: vec4f, outline: vec4f, outlineWidth: f32 }
export struct Writer {
  commandBase: u32, commandCapacity: u32,
  controlBase: u32, controlCapacity: u32,
  commandCount: u32, controlCount: u32, pointCount: u32,
  overflow: u32, randomState: u32,
}

export fn writerFor(description: SceneObject) -> Writer {
  return Writer(description.commandBase, description.commandCapacity, description.controlBase,
    description.controlCapacity, 0u, 0u, 0u, 0u, description.seed);
}
export fn writerCounts(writer: Writer) -> ObjectCounts {
  return ObjectCounts(writer.commandCount, writer.controlCount, writer.pointCount, writer.overflow);
}

export fn ink(alpha: f32) -> vec4f { return vec4f(vec3f(100.0 / 255.0), alpha); }
export fn white() -> vec4f { return vec4f(1.0); }
export fn transparent() -> vec4f { return vec4f(0.0); }
export fn random(writer: ptr<function, Writer>) -> f32 { return sampleRandom(&(*writer).randomState); }
export fn uniform(writer: ptr<function, Writer>, minimum: f32, maximum: f32) -> f32 {
  return minimum + random(writer) * (maximum - minimum);
}
export fn gaussian(writer: ptr<function, Writer>) -> f32 {
  // Original bounded rejection sampler: exp(-24*(x-.5)^2), mapped to [-1,1].
  loop {
    let value = random(writer);
    if (random(writer) < exp(-24.0 * (value - 0.5) * (value - 0.5))) { return value * 2.0 - 1.0; }
  }
}
export fn noise(position: vec3f) -> f32 { return p5Noise(position, &noiseTable); }

export fn reservePath(writer: ptr<function, Writer>, count: u32) -> Path {
  if ((*writer).overflow != 0u || count > (*writer).controlCapacity || (*writer).controlCount > (*writer).controlCapacity - count) {
    (*writer).overflow = 1u;
    return Path((*writer).controlBase, 0u);
  }
  let path = Path((*writer).controlBase + (*writer).controlCount, count);
  (*writer).controlCount += count;
  return path;
}
export fn point(path: Path, index: u32) -> vec2f {
  if (index >= path.count) { return vec2f(0.0); }
  return constructionControls[path.offset + index].xy;
}
export fn setPoint(path: Path, index: u32, value: vec2f) {
  if (index < path.count) { constructionControls[path.offset + index] = vec4f(value, 0.0, 0.0); }
}
export fn copyPath(writer: ptr<function, Writer>, source: Path) -> Path {
  let output = reservePath(writer, source.count);
  for (var index = 0u; index < output.count; index++) { setPoint(output, index, point(source, index)); }
  return output;
}
export fn reversePath(writer: ptr<function, Writer>, source: Path) -> Path {
  let output = reservePath(writer, source.count);
  for (var index = 0u; index < output.count; index++) { setPoint(output, index, point(source, source.count - 1u - index)); }
  return output;
}
export fn joinPaths(writer: ptr<function, Writer>, first: Path, second: Path) -> Path {
  let output = reservePath(writer, first.count + second.count);
  for (var index = 0u; index < first.count; index++) { setPoint(output, index, point(first, index)); }
  for (var index = 0u; index < second.count; index++) { setPoint(output, first.count + index, point(second, index)); }
  return output;
}
export fn translatePath(writer: ptr<function, Writer>, source: Path, offset: vec2f) -> Path {
  let output = reservePath(writer, source.count);
  for (var index = 0u; index < output.count; index++) { setPoint(output, index, point(source, index) + offset); }
  return output;
}
export fn subdivide(writer: ptr<function, Writer>, source: Path, subdivisions: u32) -> Path {
  if (source.count == 0u || subdivisions == 0u) { return Path(0u, 0u); }
  let output = reservePath(writer, (source.count - 1u) * subdivisions + 1u);
  for (var index = 0u; index + 1u < output.count; index++) {
    let fraction = f32(index % subdivisions) / f32(subdivisions);
    let left = index / subdivisions;
    setPoint(output, index, point(source, left) * (1.0 - fraction) + point(source, min(left + 1u, source.count - 1u)) * fraction);
  }
  if (output.count > 0u) { setPoint(output, output.count - 1u, point(source, source.count - 1u)); }
  return output;
}
export fn curve(writer: ptr<function, Writer>, source: Path, weight: f32) -> Path {
  var controls = source;
  if (source.count < 2u) { return copyPath(writer, source); }
  if (source.count == 2u) {
    controls = reservePath(writer, 3u);
    setPoint(controls, 0u, point(source, 0u));
    setPoint(controls, 1u, (point(source, 0u) + point(source, 1u)) * 0.5);
    setPoint(controls, 2u, point(source, 1u));
  }
  if (controls.count < 2u) { return Path(0u, 0u); }
  let spans = controls.count - 2u;
  let output = reservePath(writer, spans * 20u + 1u);
  if (output.count == 0u) { return output; }
  for (var span = 0u; span < spans; span++) {
    var first = point(controls, span);
    if (span > 0u) { first = (first + point(controls, span + 1u)) * 0.5; }
    let middle = point(controls, span + 1u);
    var last = point(controls, span + 2u);
    if (span + 1u < spans) { last = (middle + last) * 0.5; }
    let samples = select(20u, 21u, span + 1u == spans);
    for (var sample = 0u; sample < samples; sample++) {
      let fraction = f32(sample) / 20.0;
      let inverse = 1.0 - fraction;
      let denominator = inverse * inverse + 2.0 * fraction * inverse * weight + fraction * fraction;
      setPoint(output, span * 20u + sample, (inverse * inverse * first + 2.0 * fraction * inverse * middle * weight + fraction * fraction * last) / denominator);
    }
  }
  return output;
}

export fn emit(writer: ptr<function, Writer>, source: Brush) {
  if ((*writer).overflow != 0u || (*writer).commandCount >= (*writer).commandCapacity) { (*writer).overflow = 1u; return; }
  var command = source;
  command.pointOffset = (*writer).pointCount;
  constructionJobs[(*writer).commandBase + (*writer).commandCount] = command;
  (*writer).commandCount++;
  (*writer).pointCount += command.pointCount;
}
export fn polygon(writer: ptr<function, Writer>, path: Path, paint: Paint) {
  if (path.count == 0u) { return; }
  var command: Brush;
  command.kind = 0u; command.controlOffset = path.offset; command.controlCount = path.count;
  command.fill = paint.fill; command.edge = paint.outline; command.outlineWidth = paint.outlineWidth;
  command.pointCount = path.count;
  emit(writer, command);
}
fn ribbonCount(count: u32) -> u32 { return select(count * 2u - 1u, 3u, count == 1u); }
fn widthProfile(position: f32, profile: u32) -> f32 {
  switch profile {
    case 1u: { return 1.0; }
    case 2u: { return cos(position * 1.570796326794897); }
    case 3u: { return sin(1.0); }
    case 4u: { return sin(position * 6.283185307179586); }
    default: { return sin(position * 3.141592653589793); }
  }
}
export fn stroke(writer: ptr<function, Writer>, path: Path, color: vec4f, width: f32, profile: u32, noiseAmount: f32, outlineWidth: f32) {
  if (path.count == 0u) { return; }
  let controls = copyPath(writer, path);
  if (controls.count == 0u) { return; }
  for (var index = 0u; index < controls.count; index++) {
    constructionControls[controls.offset + index].z = width * widthProfile(f32(index) / f32(controls.count), profile);
  }
  var command: Brush;
  command.kind = 1u; command.controlOffset = controls.offset; command.controlCount = controls.count;
  command.fill = color; command.edge = color; command.width = width;
  command.noiseAmount = noiseAmount; command.noiseOffset = random(writer) * 10.0; command.outlineWidth = outlineWidth;
  command.pointCount = ribbonCount(controls.count);
  emit(writer, command);
}
export fn barkStroke(writer: ptr<function, Writer>, path: Path, phase: f32) {
  if (path.count == 0u) { return; }
  let controls = copyPath(writer, path);
  if (controls.count == 0u) { return; }
  for (var index = 0u; index < controls.count; index++) {
    constructionControls[controls.offset + index].z = 0.8 * sin((f32(index) / f32(controls.count) + phase) * 9.42477796076938);
  }
  var command: Brush;
  command.kind = 1u; command.controlOffset = controls.offset; command.controlCount = controls.count;
  command.fill = ink(0.4); command.edge = command.fill;
  command.noiseOffset = random(writer) * 10.0; command.pointCount = ribbonCount(controls.count);
  emit(writer, command);
}
fn leafProfile(position: f32, profile: u32) -> f32 {
  if (profile == 1u) {
    if (position <= 1.0) { return sqrt(max(0.0, sin(position * 3.141592653589793) * position)); }
    return -sqrt(max(0.0, sin((position - 2.0) * 3.141592653589793 * (position - 2.0))));
  }
  if (profile == 2u) {
    if (position <= 1.0) { return 2.75 * position * pow(1.0 - position, 1.0 / 1.8); }
    return 2.75 * (position - 2.0) * pow(position - 1.0, 1.0 / 1.8);
  }
  if (position <= 1.0) { return sqrt(max(0.0, sin(position * 3.141592653589793))); }
  return -sqrt(max(0.0, sin((position + 1.0) * 3.141592653589793)));
}
export fn blob(writer: ptr<function, Writer>, center: vec2f, length: f32, width: f32, angle: f32, noiseAmount: f32, color: vec4f, profile: u32) {
  let samples = reservePath(writer, 21u);
  for (var index = 0u; index < samples.count; index++) { setPoint(samples, index, vec2f(leafProfile(f32(index) * 0.1, profile), 0.0)); }
  var command: Brush;
  command.kind = 2u; command.controlOffset = samples.offset; command.controlCount = samples.count;
  command.fill = color; command.edge = color; command.width = width;
  command.noiseAmount = noiseAmount; command.noiseOffset = random(writer) * 10.0;
  command.origin = center; command.length = length; command.angle = angle;
  command.pointCount = 21u; command.profileOffset = samples.offset;
  emit(writer, command);
}
export fn blobPath(writer: ptr<function, Writer>, center: vec2f, length: f32, width: f32, angle: f32, noiseAmount: f32, profile: u32) -> Path {
  let output = reservePath(writer, 21u);
  let phase = random(writer) * 10.0;
  var samples: array<f32, 21>;
  for (var index = 0u; index < 21u; index++) { samples[index] = noise(vec3f(f32(index) * 0.05, phase, 0.0)); }
  let difference = samples[20] - samples[0];
  var minimum = 100.0; var maximum = -100.0;
  for (var index = 0u; index < 21u; index++) {
    samples[index] += difference * f32(20u - index) / 20.0;
    minimum = min(minimum, samples[index]); maximum = max(maximum, samples[index]);
  }
  for (var index = 0u; index < output.count; index++) {
    let position = f32(index) * 0.1;
    let longitudinal = length * 0.5 - abs(position - 1.0) * length;
    let transverse = leafProfile(position, profile) * width * 0.5;
    let direction = atan2(transverse, longitudinal) + angle;
    let radius = sqrt(longitudinal * longitudinal + transverse * transverse);
    let variation = (samples[index] - minimum) / max(maximum - minimum, 1e-8) * noiseAmount + 1.0 - noiseAmount;
    setPoint(output, index, center + vec2f(cos(direction), sin(direction)) * radius * variation);
  }
  return output;
}

fn contourStroke(writer: ptr<function, Writer>, grid: Path, columns: u32, layer: f32, start: u32, count: u32, origin: vec2f, jitter: f32, width: f32, color: vec4f) {
  if (count == 0u) { return; }
  var command: Brush;
  command.kind = 3u; command.controlOffset = grid.offset; command.controlCount = count;
  command.fill = color; command.edge = color; command.width = width;
  command.noiseAmount = 0.5; command.noiseOffset = random(writer) * 10.0; command.outlineWidth = 1.0;
  command.origin = origin; command.layer = layer; command.firstColumn = f32(start); command.columns = f32(columns); command.jitter = jitter;
  command.pointCount = ribbonCount(count);
  emit(writer, command);
}
export fn texturedGrid(writer: ptr<function, Writer>, grid: Path, rows: u32, columns: u32, origin: vec2f, attempts: u32, width: f32, lengthFraction: f32, shade: f32, distribution: u32, jitter: f32) {
  // Record all intervals before drawing either pass, as in the upstream texture recipe.
  let intervals = reservePath(writer, attempts);
  for (var index = 0u; index < intervals.count; index++) {
    var fraction: f32;
    if (distribution == 2u) {
      loop { fraction = random(writer); if (random(writer) < fraction * fraction) { break; } }
    } else {
      let firstSide = random(writer) > 0.5;
      let value = random(writer);
      switch distribution {
        case 1u: { fraction = select(0.9 - 0.4 * value, 0.1 + 0.4 * value, firstSide); }
        case 3u: { fraction = select(0.85 - 0.15 * value, 0.15 + 0.15 * value, firstSide); }
        default: { fraction = select(2.0 / 3.0 + value / 3.0, value / 3.0, firstSide); }
      }
    }
    let middle = i32(fraction * f32(columns));
    let halfLength = i32(floor(random(writer) * f32(columns) * lengthFraction));
    let start = u32(clamp(middle - halfLength, 0, i32(columns)));
    let end = u32(clamp(middle + halfLength, 0, i32(columns)));
    setPoint(intervals, index, vec2f(f32(start), f32(end - start)));
  }
  for (var texturePass = 0u; texturePass < 2u; texturePass++) {
    if (texturePass == 0u && shade == 0.0) { continue; }
    let step = select(2u, 1u + u32(shade), texturePass == 1u);
    var index = select(0u, u32(shade), texturePass == 1u);
    loop {
      if (index >= intervals.count) { break; }
      let interval = point(intervals, index);
      let layer = f32(index) / f32(attempts) * f32(rows - 1u);
      let amplitude = select(jitter, 30.0 / (layer + 1.0), jitter < 0.0);
      var color = ink(0.1);
      var brushWidth = shade;
      if (texturePass == 1u) {
        brushWidth = width;
        let alpha = round(random(writer) * 0.3 * 1000.0) / 1000.0;
        color = ink(alpha);
        if (distribution == 2u || distribution == 3u) {
          color = vec4f(vec3f(select(120.0, 180.0, distribution == 3u) / 255.0), 0.3 + alpha);
        }
      }
      contourStroke(writer, grid, columns, layer, u32(interval.x), u32(interval.y), origin, amplitude, brushWidth, color);
      index += step;
    }
  }
}

struct Triangle { first: vec2f, second: vec2f, third: vec2f }
fn triangleSides(triangle: Triangle) -> vec3f {
  return vec3f(distance(triangle.first, triangle.second), distance(triangle.second, triangle.third), distance(triangle.third, triangle.first));
}
fn triangleArea(sides: vec3f) -> f32 {
  let semiperimeter = (sides.x + sides.y + sides.z) * 0.5;
  return sqrt(max(0.0, semiperimeter * (semiperimeter - sides.x) * (semiperimeter - sides.y) * (semiperimeter - sides.z)));
}
fn paintFacet(writer: ptr<function, Writer>, triangle: Triangle, distant: bool, elevation: f32) {
  let path = reservePath(writer, 3u);
  setPoint(path, 0u, triangle.first); setPoint(path, 1u, triangle.second); setPoint(path, 2u, triangle.third);
  let center = (triangle.first + triangle.second + triangle.third) / 3.0;
  let tone = noise(vec3f(center * 0.02, elevation));
  let gray = floor(select(50.0 + tone * 200.0, 200.0 + tone * 55.0, distant)) / 255.0;
  let color = vec4f(vec3f(gray), select(0.8, 1.0, distant));
  polygon(writer, path, Paint(color, select(transparent(), color, distant), select(0.0, 1.0, distant)));
}
fn shatter(writer: ptr<function, Writer>, triangle: Triangle, maximumArea: f32, distant: bool, elevation: f32) {
  // Depth-first longest-edge subdivision: second child waits while first paints.
  var pending: array<Triangle, 32>;
  pending[0] = triangle;
  var count = 1u;
  loop {
    if (count == 0u || (*writer).overflow != 0u) { break; }
    count--;
    let current = pending[count];
    let sides = triangleSides(current);
    if (triangleArea(sides) < maximumArea) { paintFacet(writer, current, distant, elevation); continue; }
    if (count + 2u > 32u) { (*writer).overflow = 1u; return; }
    var edge = 0u;
    if (sides.y > sides[edge]) { edge = 1u; }
    if (sides.z > sides[edge]) { edge = 2u; }
    let vertices = array<vec2f, 3>(current.first, current.second, current.third);
    let first = vertices[edge]; let second = vertices[(edge + 1u) % 3u]; let last = vertices[(edge + 2u) % 3u];
    let middle = (first + second) * 0.5;
    pending[count] = Triangle(last, second, middle);
    pending[count + 1u] = Triangle(first, middle, last);
    count += 2u;
  }
}
fn triangulate(writer: ptr<function, Writer>, source: Path, maximumArea: f32, optimize: bool, distant: bool, elevation: f32) {
  var remaining = copyPath(writer, source);
  loop {
    if (remaining.count < 3u || (*writer).overflow != 0u) { return; }
    if (remaining.count == 3u) {
      shatter(writer, Triangle(point(remaining, 0u), point(remaining, 1u), point(remaining, 2u)), maximumArea, distant, elevation);
      return;
    }
    var best = 0u; var bestRatio = 0.0;
    if (optimize) {
      for (var index = 0u; index < remaining.count; index++) {
        let triangle = Triangle(point(remaining, (index + remaining.count - 1u) % remaining.count), point(remaining, index), point(remaining, (index + 1u) % remaining.count));
        let sides = triangleSides(triangle);
        let ratio = triangleArea(sides) / (sides.x + sides.y + sides.z);
        if (ratio >= bestRatio) { best = index; bestRatio = ratio; }
      }
    }
    shatter(writer, Triangle(point(remaining, (best + remaining.count - 1u) % remaining.count), point(remaining, best), point(remaining, (best + 1u) % remaining.count)), maximumArea, distant, elevation);
    for (var index = best; index + 1u < remaining.count; index++) { setPoint(remaining, index, point(remaining, index + 1u)); }
    remaining.count--;
  }
}
export fn facet(writer: ptr<function, Writer>, source: Path, maximumArea: f32, convex: bool, optimize: bool) {
  // All authored tree and distant-mountain recipes explicitly request convex ears.
  if (!convex || maximumArea <= 0.0) { (*writer).overflow = 1u; return; }
  triangulate(writer, source, maximumArea, optimize, false, 0.0);
}
export fn distantFacet(writer: ptr<function, Writer>, source: Path, elevation: f32) {
  triangulate(writer, source, 100.0, false, true, elevation);
}
