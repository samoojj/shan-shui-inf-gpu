import {
  Writer, Path, Paint, random, uniform, gaussian, noise,
  reservePath, point, setPoint, subdivide, polygon, stroke,
  blob, blobPath, barkStroke, facet, ink, white, transparent,
} from "./construction.wgsl";

// Lingdong Huang's eight tree constructions, ported from the pinned upstream
// index.html:743-1725. Copyright (c) 2018, MIT; see LICENSE.
// Topology and deferred paint records live in GPU control storage. Small local
// stacks replace source recursion; they contain frame state, never point grids.
const TREE_PI: f32 = 3.141592653589793;
const TREE_LIST_END: u32 = 0xffffffffu;

struct TreeQueue {
  first: u32,
  last: u32,
  count: u32,
}

struct TreePathChain {
  spans: TreeQueue,
  pointCount: u32,
}

struct BranchSides {
  first: Path,
  second: Path,
}

struct TwigRequest {
  origin: vec2f,
  scale: f32,
  leafWidth: f32,
  angle: f32,
  direction: f32,
  depth: u32,
  leafOffset: f32,
  leaves: u32,
}

struct TwigFrame {
  request: TwigRequest,
  path: Path,
  horizontalScale: f32,
  rotation: f32,
  nextPoint: u32,
}

struct ForkFrame {
  perimeter: Path,
  outline: TreePathChain,
  height: f32,
  width: f32,
  angle: f32,
  depth: u32,
  nextPoint: u32,
  childAngle: f32,
}

struct LineBranchFrame {
  origin: vec2f,
  endpoint: vec2f,
  angle: f32,
  length: f32,
  bend: f32,
  childBend: f32,
  depth: u32,
  initialized: u32,
  childCount: u32,
  nextChild: u32,
}

fn treeQueue() -> TreeQueue {
  return TreeQueue(TREE_LIST_END, TREE_LIST_END, 0u);
}

fn treePathChain() -> TreePathChain {
  return TreePathChain(treeQueue(), 0u);
}

// Two exact 16-bit numeric halves avoid both f32's 24-bit integer limit and
// implementation-dependent preservation of NaN/subnormal bitcast payloads.
fn storeTreeIndex(path: Path, index: u32, value: u32) {
  setPoint(path, index, vec2f(f32(value & 65535u), f32(value >> 16u)));
}

fn loadTreeIndex(path: Path, index: u32) -> u32 {
  let halves = vec2u(point(path, index));
  return halves.x | (halves.y << 16u);
}

fn storeTreePath(record: Path, index: u32, path: Path) {
  storeTreeIndex(record, index, path.offset);
  storeTreeIndex(record, index + 1u, path.count);
}

fn loadTreePath(record: Path, index: u32) -> Path {
  return Path(loadTreeIndex(record, index), loadTreeIndex(record, index + 1u));
}

fn appendTreeRecord(writer: ptr<function, Writer>, queue: ptr<function, TreeQueue>, count: u32) -> Path {
  if ((*writer).overflow != 0u) { return Path(0u, 0u); }
  let node = reservePath(writer, count + 1u);
  if (node.count != count + 1u) { return Path(0u, 0u); }
  storeTreeIndex(node, 0u, TREE_LIST_END);
  if ((*queue).count == 0u) {
    (*queue).first = node.offset;
  } else {
    storeTreeIndex(Path((*queue).last, 1u), 0u, node.offset);
  }
  (*queue).last = node.offset;
  (*queue).count += 1u;
  return Path(node.offset + 1u, count);
}

fn nextTreeRecord(recordOffset: u32) -> u32 {
  return loadTreeIndex(Path(recordOffset, 1u), 0u);
}

fn appendTreeSpan(writer: ptr<function, Writer>, chain: ptr<function, TreePathChain>, path: Path) {
  if (path.count == 0u || (*writer).overflow != 0u) { return; }
  if (path.count > (*writer).controlCapacity - min((*chain).pointCount, (*writer).controlCapacity)) {
    (*writer).overflow = 1u;
    return;
  }
  let record = appendTreeRecord(writer, &(*chain).spans, 2u);
  if (record.count != 2u) { return; }
  storeTreePath(record, 0u, path);
  (*chain).pointCount += path.count;
}

fn flattenTreeChain(writer: ptr<function, Writer>, chain: TreePathChain) -> Path {
  if ((*writer).overflow != 0u) { return Path(0u, 0u); }
  let result = reservePath(writer, chain.pointCount);
  if (result.count != chain.pointCount) { return Path(0u, 0u); }
  var recordOffset = chain.spans.first;
  var destination = 0u;
  for (var index = 0u; index < chain.spans.count; index++) {
    let path = loadTreePath(Path(recordOffset + 1u, 2u), 0u);
    for (var sample = 0u; sample < path.count; sample++) {
      setPoint(result, destination, point(path, sample));
      destination += 1u;
    }
    recordOffset = nextTreeRecord(recordOffset);
  }
  return result;
}

fn treeAngle(delta: vec2f) -> f32 {
  // JavaScript atan2(+0, +0) is zero; WGSL need not define that case.
  if (all(delta == vec2f(0.0))) { return 0.0; }
  return atan2(delta.y, delta.x);
}

fn treeRotate(value: vec2f, angle: f32) -> vec2f {
  let cosine = cos(angle);
  let sine = sin(angle);
  return vec2f(value.x * cosine - value.y * sine, value.x * sine + value.y * cosine);
}

fn treeSign(writer: ptr<function, Writer>) -> f32 {
  return select(-1.0, 1.0, random(writer) >= 0.5);
}

fn treeAlpha(color: vec4f, added: f32, roundingScale: f32) -> vec4f {
  return vec4f(color.rgb, floor((color.a + added) * roundingScale + 0.5) / roundingScale);
}

fn branchPerimeter(writer: ptr<function, Writer>, sides: BranchSides) -> Path {
  let result = reservePath(writer, sides.first.count + sides.second.count);
  if (result.count != sides.first.count + sides.second.count) { return Path(0u, 0u); }
  for (var index = 0u; index < sides.first.count; index++) {
    setPoint(result, index, point(sides.first, index));
  }
  for (var index = 0u; index < sides.second.count; index++) {
    setPoint(result, sides.first.count + index, point(sides.second, sides.second.count - 1u - index));
  }
  return result;
}

fn irregularBranch(
  writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32,
  angle: f32, bend: f32, detail: f32,
) -> BranchSides {
  if (detail <= 0.0) {
    (*writer).overflow = 1u;
    return BranchSides(Path(0u, 0u), Path(0u, 0u));
  }
  var centerline: array<vec2f, 4>;
  centerline[0] = vec2f(0.0);
  var heading = 0.0;
  for (var segment = 0u; segment < 3u; segment++) {
    heading += (bend * 0.5 + random(writer) * bend * 0.5) * treeSign(writer);
    centerline[segment + 1u] = centerline[segment]
      + vec2f(cos(heading), -sin(heading)) * height / 3.0;
  }
  let alignment = angle - treeAngle(centerline[3]);
  for (var segment = 0u; segment < 4u; segment++) {
    centerline[segment] = treeRotate(centerline[segment], alignment);
  }
  // Keep the floating detail, modulo, and denominator. tree06/tree08 pass
  // height/20, which is usually fractional; only the loop index is integral.
  let sampleSpan = 3.0 * detail;
  if (sampleSpan > f32((*writer).controlCapacity / 2u)) {
    (*writer).overflow = 1u;
    return BranchSides(Path(0u, 0u), Path(0u, 0u));
  }
  let count = u32(ceil(sampleSpan));
  let first = reservePath(writer, count);
  let second = reservePath(writer, count);
  if (first.count != count || second.count != count) {
    return BranchSides(Path(0u, 0u), Path(0u, 0u));
  }
  var previous = vec2f(0.0);
  for (var index = 0u; index < count; index++) {
    let section = f32(index) / detail;
    let fraction = (f32(index) % detail) / detail;
    let center = centerline[u32(floor(section))] * (1.0 - fraction)
      + centerline[u32(ceil(section))] * fraction;
    var tangent = treeAngle(center - previous);
    if (index == 0u) {
      // Upstream rotates the zero-radius first point through polar arithmetic.
      // Its signed zeros make atan2(-0,-0)=-pi or atan2(+0,-0)=pi when
      // alignment faces left. Derive that quadrant explicitly, including the
      // exactly vertical right half-plane, rather than trusting GPU zero signs.
      let wrappedAlignment = alignment - floor((alignment + TREE_PI) / (2.0 * TREE_PI)) * (2.0 * TREE_PI);
      if (abs(wrappedAlignment) > TREE_PI * 0.5) {
        tangent = select(TREE_PI, -TREE_PI, wrappedAlignment < 0.0);
      }
    }
    let irregularity = (noise(vec3f(f32(index) * 0.3, 0.0, 0.0)) - 0.5) * width * height / 80.0;
    var jointBump = 0.0;
    if (fraction == 0.0) { jointBump = random(writer) * width; }
    let taperedWidth = width * ((sampleSpan - f32(index)) / sampleSpan * 0.5 + 0.5);
    setPoint(first, index, origin + center
      + vec2f(cos(tangent + TREE_PI * 0.5), sin(tangent + TREE_PI * 0.5))
        * (taperedWidth + irregularity + jointBump));
    setPoint(second, index, origin + center
      + vec2f(cos(tangent - TREE_PI * 0.5), sin(tangent - TREE_PI * 0.5))
        * (taperedWidth - irregularity + jointBump));
    previous = center;
  }
  return BranchSides(first, second);
}

fn deferBark(writer: ptr<function, Writer>, queue: ptr<function, TreeQueue>, sides: BranchSides) {
  let record = appendTreeRecord(writer, queue, 4u);
  if (record.count != 4u) { return; }
  storeTreePath(record, 0u, sides.first);
  storeTreePath(record, 2u, sides.second);
}

fn deferTwig(writer: ptr<function, Writer>, queue: ptr<function, TreeQueue>, request: TwigRequest) {
  let record = appendTreeRecord(writer, queue, 5u);
  if (record.count != 5u) { return; }
  setPoint(record, 0u, request.origin);
  setPoint(record, 1u, vec2f(request.scale, request.leafWidth));
  setPoint(record, 2u, vec2f(request.angle, request.direction));
  setPoint(record, 3u, vec2f(f32(request.depth), request.leafOffset));
  setPoint(record, 4u, vec2f(f32(request.leaves), 0.0));
}

fn readTwig(record: Path) -> TwigRequest {
  let size = point(record, 1u);
  let orientation = point(record, 2u);
  let foliage = point(record, 3u);
  return TwigRequest(point(record, 0u), size.x, size.y, orientation.x,
    orientation.y, u32(foliage.x), foliage.y, u32(point(record, 4u).x));
}

fn twigFrame(writer: ptr<function, Writer>, request: TwigRequest) -> TwigFrame {
  let horizontalScale = uniform(writer, 0.5, 1.0);
  // The source chooses from a singleton function array before its rotation.
  _ = random(writer);
  let rotation = random(writer) * TREE_PI / 6.0 * request.direction + request.angle;
  return TwigFrame(request, reservePath(writer, 10u), horizontalScale, rotation, 0u);
}

fn leafyTwig(writer: ptr<function, Writer>, request: TwigRequest) {
  // The recipes request depth 0, 1, or 2. A stack contains one frame per level.
  if (request.depth > 2u) { (*writer).overflow = 1u; return; }
  var stack: array<TwigFrame, 3>;
  var stackIndex = 0u;
  stack[0] = twigFrame(writer, request);
  loop {
    if ((*writer).overflow != 0u) { return; }
    var frame = stack[stackIndex];
    if (frame.nextPoint == 10u) {
      // Child fragments and each node's tip foliage precede its own stroke.
      stroke(writer, frame.path, ink(0.5), 1.0, 2u, 0.5, 1.0);
      if (stackIndex == 0u) { break; }
      stackIndex -= 1u;
      continue;
    }
    let index = frame.nextPoint;
    let fraction = f32(index) / 10.0;
    let local = vec2f(frame.request.direction * (1.0 - 1.0 / pow(fraction + 1.0, 5.0))
      * 50.0 * frame.request.scale * frame.horizontalScale, -f32(index) * 5.0 * frame.request.scale);
    let position = frame.request.origin + treeRotate(local, frame.rotation);
    setPoint(frame.path, index, position);
    frame.nextPoint += 1u;
    stack[stackIndex] = frame;
    if ((index == 3u || index == 6u) && frame.request.depth > 0u) {
      if (stackIndex + 1u >= 3u) { (*writer).overflow = 1u; return; }
      var child = frame.request;
      child.origin = position;
      child.depth -= 1u;
      child.scale *= 0.8;
      child.direction *= treeSign(writer);
      stackIndex += 1u;
      stack[stackIndex] = twigFrame(writer, child);
      continue;
    }
    if (index == 9u && frame.request.leaves != 0u) {
      for (var leaf = 0u; leaf < 5u; leaf++) {
        let spread = (f32(leaf) - 2.5) * 5.0;
        let center = position + vec2f(cos(frame.request.angle) * spread,
          sin(frame.request.angle) * spread - frame.request.leafOffset / f32(frame.request.depth + 1u))
          * frame.request.leafWidth;
        let width = uniform(writer, 6.0, 9.0) * frame.request.leafWidth;
        let length = uniform(writer, 15.0, 27.0) * frame.request.leafWidth;
        let angle = frame.request.angle * 0.5 + TREE_PI * 0.5
          + TREE_PI * 0.2 * (random(writer) - 0.5);
        blob(writer, center, length, width, angle, 0.5,
          ink(0.5 + f32(frame.request.depth) * 0.2), 1u);
      }
    }
  }
}

fn deferBarkRun(
  writer: ptr<function, Writer>, queue: ptr<function, TreeQueue>, path: Path, runIndex: u32,
) {
  if (path.count == 0u) { return; }
  let record = appendTreeRecord(writer, queue, 3u);
  if (record.count != 3u) { return; }
  storeTreePath(record, 0u, path);
  storeTreeIndex(record, 2u, runIndex);
}

fn barkBoundaryFragments(writer: ptr<function, Writer>, perimeter: Path) {
  let retained = reservePath(writer, perimeter.count);
  if (retained.count != perimeter.count) { return; }
  var runs = treeQueue();
  var used = 0u;
  var start = 0u;
  var runIndex = 0u;
  // Complete the split decisions before the displacement and stroke pass.
  for (var index = 0u; index < perimeter.count; index++) {
    if (random(writer) < 0.5) {
      deferBarkRun(writer, &runs, Path(retained.offset + start, used - start), runIndex);
      start = used;
      runIndex += 1u;
    } else {
      setPoint(retained, used, point(perimeter, index));
      used += 1u;
    }
  }
  deferBarkRun(writer, &runs, Path(retained.offset + start, used - start), runIndex);
  var recordOffset = runs.first;
  for (var index = 0u; index < runs.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    let record = Path(recordOffset + 1u, 3u);
    let fragment = subdivide(writer, loadTreePath(record, 0u), 4u);
    let noiseSlice = f32(loadTreeIndex(record, 2u));
    for (var sample = 0u; sample < fragment.count; sample++) {
      let jitterX = (noise(vec3f(noiseSlice, f32(sample) * 0.1, 1.0)) - 0.5)
        * (15.0 + 5.0 * gaussian(writer));
      let jitterY = (noise(vec3f(noiseSlice, f32(sample) * 0.1, 2.0)) - 0.5)
        * (15.0 + 5.0 * gaussian(writer));
      setPoint(fragment, sample, point(fragment, sample) + vec2f(jitterX, jitterY));
    }
    stroke(writer, fragment, ink(0.7), 1.5, 0u, 0.5, 0.0);
    recordOffset = nextTreeRecord(recordOffset);
  }
}

fn branchBark(writer: ptr<function, Writer>, sides: BranchSides) {
  let count = min(sides.first.count, sides.second.count);
  for (var index = 2u; index + 1u < count; index++) {
    if ((*writer).overflow != 0u) { return; }
    let firstAngle = treeAngle(point(sides.first, index) - point(sides.first, index - 1u));
    let secondAngle = treeAngle(point(sides.second, index) - point(sides.second, index - 1u));
    let across = random(writer);
    let center = point(sides.first, index) * (1.0 - across) + point(sides.second, index) * across;
    let angle = (firstAngle + secondAngle) * 0.5;
    if (random(writer) < 0.2) {
      blob(writer, center, 15.0, 6.0 - abs(across - 0.5) * 10.0, angle, 1.0, ink(0.6), 0u);
    } else {
      let length = uniform(writer, 10.0, 20.0);
      let contour = blobPath(writer, center, length, 5.0 - abs(across - 0.5) * 10.0, angle, 0.5, 0u);
      let phase = random(writer);
      // This oscillating signed width is the source bark, not a solid blob.
      barkStroke(writer, contour, phase);
    }
    if (random(writer) < 0.05) {
      let groupLength = uniform(writer, 2.0, 4.0);
      let useSecond = random(writer) >= 0.5;
      let sideCenter = select(point(sides.first, index), point(sides.second, index), useSecond);
      let sideAngle = select(firstAngle, secondAngle, useSecond);
      for (var mark = 0u; f32(mark) < groupLength; mark++) {
        let position = sideCenter + vec2f(cos(sideAngle), sin(sideAngle))
          * (f32(mark) - groupLength * 0.5) * 4.0;
        let length = uniform(writer, 4.0, 10.0);
        blob(writer, position, length, 4.0, firstAngle + TREE_PI * 0.5, 0.5, ink(0.6), 0u);
      }
    }
  }
  barkBoundaryFragments(writer, branchPerimeter(writer, sides));
}

fn paintTreeTrunk(writer: ptr<function, Writer>, perimeter: Path, color: vec4f, trim: bool, opacity: f32) {
  if ((*writer).overflow != 0u) { return; }
  polygon(writer, perimeter, Paint(white(), color, 0.0));
  var outline = perimeter;
  if (trim) {
    outline = Path(perimeter.offset + min(1u, perimeter.count), perimeter.count - min(2u, perimeter.count));
  }
  let outlineColor = treeAlpha(ink(opacity), random(writer) * 0.1, 1000.0);
  stroke(writer, outline, outlineColor, 2.5, 3u, 0.9, 0.0);
}

fn paintTreeDetails(writer: ptr<function, Writer>, bark: TreeQueue, twigs: TreeQueue) {
  var recordOffset = bark.first;
  for (var index = 0u; index < bark.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    let record = Path(recordOffset + 1u, 4u);
    branchBark(writer, BranchSides(loadTreePath(record, 0u), loadTreePath(record, 2u)));
    recordOffset = nextTreeRecord(recordOffset);
  }
  recordOffset = twigs.first;
  for (var index = 0u; index < twigs.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    leafyTwig(writer, readTwig(Path(recordOffset + 1u, 5u)));
    recordOffset = nextTreeRecord(recordOffset);
  }
}

fn sparseContourTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, color: vec4f) {
  let first = reservePath(writer, 10u);
  let second = reservePath(writer, 10u);
  if (first.count != 10u || second.count != 10u) { return; }
  for (var index = 0u; index < 10u; index++) {
    let center = origin + vec2f(0.0, -f32(index) * height / 10.0);
    if (index >= 3u) {
      for (var leaf = 0u; f32(leaf) < f32(10u - index) / 5.0; leaf++) {
        let position = center + vec2f((random(writer) - 0.5) * width * 1.2 * f32(10u - index),
          (random(writer) - 0.5) * width);
        let length = random(writer) * 20.0 * f32(10u - index) * 0.2 + 10.0;
        let leafWidth = uniform(writer, 3.0, 9.0);
        let angle = (random(writer) - 0.5) * TREE_PI / 6.0;
        let leafColor = treeAlpha(color, random(writer) * 0.2, 10.0);
        blob(writer, position, length, leafWidth, angle, 0.5, leafColor, 0u);
      }
    }
    setPoint(first, index, center + vec2f((noise(vec3f(f32(index) * 0.5, 0.0, 0.0)) - 0.5) * width - width * 0.5, 0.0));
    setPoint(second, index, center + vec2f((noise(vec3f(f32(index) * 0.5, 0.5, 0.0)) - 0.5) * width + width * 0.5, 0.0));
  }
  // Foliage precedes the two open, independently noisy trunk contours.
  polygon(writer, first, Paint(transparent(), color, 1.5));
  polygon(writer, second, Paint(transparent(), color, 1.5));
}

export fn leafCluster(
  writer: ptr<function, Writer>, origin: vec2f, height: f32,
  width: f32, clusterCount: u32, color: vec4f,
) {
  for (var leaf = 0u; leaf < clusterCount; leaf++) {
    if ((*writer).overflow != 0u) { return; }
    let position = origin + vec2f(gaussian(writer), gaussian(writer)) * f32(clusterCount) * 4.0;
    let leafWidth = random(writer) * width * 0.75 + width * 0.5;
    let length = random(writer) * height * 0.75 + height * 0.5;
    blob(writer, position, length, leafWidth, TREE_PI * 0.5, 0.5, color, 1u);
  }
}

fn denseCanopyTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, bend: f32, color: vec4f) {
  let perimeter = reservePath(writer, 20u);
  if (perimeter.count != 20u) { return; }
  for (var index = 0u; index < 10u; index++) {
    let center = origin + vec2f(f32(index) / 10.0 * bend * 100.0, -f32(index) * height / 10.0);
    let taper = f32(10u - index) / 10.0;
    setPoint(perimeter, index, center + vec2f(((noise(vec3f(f32(index) * 0.5, 0.0, 0.0)) - 0.5) * width - width * 0.5) * taper, 0.0));
    setPoint(perimeter, 19u - index, center + vec2f(((noise(vec3f(f32(index) * 0.5, 0.5, 0.0)) - 0.5) * width + width * 0.5) * taper, 0.0));
  }
  polygon(writer, perimeter, Paint(white(), color, 1.5));
  for (var index = 2u; index < 10u; index++) {
    let center = origin + vec2f(f32(index) / 10.0 * bend * 100.0, -f32(index) * height / 10.0);
    let spread = log(50.0 * f32(10u - index) / 10.0 + 1.0) / 3.95;
    for (var leaf = 0u; leaf < (10u - index) * 2u; leaf++) {
      let offset = random(writer) * width * 2.0 * spread;
      let side = treeSign(writer);
      let position = center + vec2f(offset * side, (random(writer) - 0.5) * width * 2.0);
      let leafWidth = uniform(writer, 3.0, 9.0);
      let angle = (random(writer) - 0.5) * TREE_PI / 6.0;
      let leafColor = treeAlpha(color, random(writer) * 0.2, 1000.0);
      blob(writer, position, offset * 2.0, leafWidth, angle, 0.5, leafColor, 0u);
    }
  }
}

fn spreadingCanopyTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, color: vec4f) {
  var bark = treeQueue();
  var twigs = treeQueue();
  var outline = treePathChain();
  let trunk = irregularBranch(writer, origin, height, width, -TREE_PI * 0.5, TREE_PI * 0.2, 10.0);
  deferBark(writer, &bark, trunk);
  let perimeter = branchPerimeter(writer, trunk);
  for (var index = 0u; index < perimeter.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    var selected = false;
    if (f32(index) >= f32(perimeter.count) * 0.3 && f32(index) <= f32(perimeter.count) * 0.7) {
      selected = random(writer) < 0.1;
    }
    selected = selected || index == perimeter.count / 2u - 1u;
    if (!selected) {
      appendTreeSpan(writer, &outline, Path(perimeter.offset + index, 1u));
      continue;
    }
    let angle = TREE_PI * 0.2 - select(0.0, TREE_PI * 1.4, index > perimeter.count / 2u);
    let length = height * (random(writer) + 1.0) * 0.3;
    let branch = irregularBranch(writer, point(perimeter, index), length, width * 0.5, angle, TREE_PI * 0.2, 10.0);
    if ((*writer).overflow != 0u) { return; }
    let sides = BranchSides(Path(branch.first.offset + 1u, branch.first.count - 1u),
      Path(branch.second.offset + 1u, branch.second.count - 1u));
    deferBark(writer, &bark, sides);
    for (var sample = 0u; sample < sides.first.count; sample++) {
      let sprout = random(writer) < 0.2;
      if (sprout || sample + 1u == sides.first.count) {
        let rightward = angle > -TREE_PI * 0.5;
        deferTwig(writer, &twigs, TwigRequest(point(sides.first, sample), 0.5 * height / 300.0,
          height / 300.0, select(angle + TREE_PI, angle, rightward), select(-1.0, 1.0, rightward), 1u, 12.0, 1u));
      }
    }
    appendTreeSpan(writer, &outline, branchPerimeter(writer, sides));
  }
  paintTreeTrunk(writer, flattenTreeChain(writer, outline), color, true, 0.4);
  paintTreeDetails(writer, bark, twigs);
}

fn tieredCanopyTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, color: vec4f) {
  var bark = treeQueue();
  var twigs = treeQueue();
  var outline = treePathChain();
  let trunk = irregularBranch(writer, origin, height, width, -TREE_PI * 0.5, 0.0, 10.0);
  deferBark(writer, &bark, trunk);
  let perimeter = branchPerimeter(writer, trunk);
  for (var index = 0u; index < perimeter.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    let distanceFromTip = abs(f32(index) - f32(perimeter.count) * 0.5) / (f32(perimeter.count) * 0.5);
    var selected = false;
    if (f32(index) >= f32(perimeter.count) * 0.2 && f32(index) <= f32(perimeter.count) * 0.8 && index % 3u == 0u) {
      selected = random(writer) > distanceFromTip;
    }
    selected = selected || index == perimeter.count / 2u - 1u;
    if (!selected) {
      appendTreeSpan(writer, &outline, Path(perimeter.offset + index, 1u));
      continue;
    }
    let tilt = random(writer) * 0.2;
    let angle = -tilt * TREE_PI - select(0.0, (1.0 - tilt * 2.0) * TREE_PI, index > perimeter.count / 2u);
    // Negative lengths near the forced tip are an intentional source behavior.
    let length = height * (0.3 * distanceFromTip - random(writer) * 0.05);
    let branch = irregularBranch(writer, point(perimeter, index), length, width * 0.5, angle, 0.5, 10.0);
    if ((*writer).overflow != 0u) { return; }
    let sides = BranchSides(Path(branch.first.offset + 1u, branch.first.count - 1u),
      Path(branch.second.offset + 1u, branch.second.count - 1u));
    // Only the main trunk receives bark in the tiered construction.
    for (var sample = 0u; sample < sides.first.count; sample++) {
      if (sample % 20u == 0u || sample + 1u == sides.first.count) {
        let rightward = angle > -TREE_PI * 0.5;
        deferTwig(writer, &twigs, TwigRequest(point(sides.first, sample), 0.2 * height / 300.0,
          height / 300.0, select(angle + TREE_PI, angle, rightward), select(-1.0, 1.0, rightward), 0u, 5.0, 1u));
      }
    }
    appendTreeSpan(writer, &outline, branchPerimeter(writer, sides));
  }
  paintTreeTrunk(writer, flattenTreeChain(writer, outline), color, true, 0.4);
  paintTreeDetails(writer, bark, twigs);
}

fn forkFrame(
  writer: ptr<function, Writer>, bark: ptr<function, TreeQueue>, origin: vec2f,
  height: f32, width: f32, angle: f32, bend: f32, depth: u32,
) -> ForkFrame {
  let sides = irregularBranch(writer, origin, height, width, angle, bend, height / 20.0);
  deferBark(writer, bark, sides);
  return ForkFrame(branchPerimeter(writer, sides), treePathChain(), height, width, angle, depth, 0u, 0.0);
}

fn forkedTreeOutline(
  writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32,
  bark: ptr<function, TreeQueue>, twigs: ptr<function, TreeQueue>,
) -> Path {
  var stack: array<ForkFrame, 4>;
  var stackIndex = 0u;
  stack[0] = forkFrame(writer, bark, origin, height, width, -TREE_PI * 0.5, 0.0, 3u);
  loop {
    if ((*writer).overflow != 0u) { return Path(0u, 0u); }
    var frame = stack[stackIndex];
    if (frame.nextPoint == frame.perimeter.count) {
      let completed = flattenTreeChain(writer, frame.outline);
      if (stackIndex == 0u) { return completed; }
      stackIndex -= 1u;
      var parent = stack[stackIndex];
      // The source tests every point of the returned child outline, including
      // all descendant outlines, before splicing that outline into its parent.
      for (var sample = 0u; sample < completed.count; sample++) {
        if (random(writer) < 0.03) {
          let twigAngle = parent.childAngle * uniform(writer, 0.75, 1.25);
          deferTwig(writer, twigs, TwigRequest(point(completed, sample), 0.3, 1.0,
            twigAngle, select(-1.0, 1.0, parent.childAngle > 0.0), 2u, 0.0, 0u));
        }
      }
      appendTreeSpan(writer, &parent.outline, completed);
      stack[stackIndex] = parent;
      continue;
    }
    let index = frame.nextPoint;
    frame.nextPoint += 1u;
    // This draw precedes range and depth tests, even on a terminal branch.
    let chance = random(writer);
    let inMiddle = f32(index) >= f32(frame.perimeter.count) * 0.2
      && f32(index) <= f32(frame.perimeter.count) * 0.8;
    let tip = frame.perimeter.count / 2u;
    let selected = ((chance < 0.025 && inMiddle) || index + 1u == tip || index == tip + 1u)
      && frame.depth > 0u;
    if (!selected) {
      appendTreeSpan(writer, &frame.outline, Path(frame.perimeter.offset + index, 1u));
      stack[stackIndex] = frame;
      continue;
    }
    if (stackIndex + 1u >= 4u) { (*writer).overflow = 1u; return Path(0u, 0u); }
    let tilt = uniform(writer, 0.02, 0.1);
    let angle = tilt * TREE_PI - select(0.0, tilt * 2.0 * TREE_PI, index > tip);
    let childHeight = frame.height * uniform(writer, 0.7, 0.9);
    frame.childAngle = angle;
    stack[stackIndex] = frame;
    stackIndex += 1u;
    stack[stackIndex] = forkFrame(writer, bark, point(frame.perimeter, index), childHeight,
      frame.width * 0.6, frame.angle + angle, 0.55, frame.depth - 1u);
  }
}

fn forkedBareTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, color: vec4f) {
  var bark = treeQueue();
  var twigs = treeQueue();
  let outline = forkedTreeOutline(writer, origin, height, width, &bark, &twigs);
  paintTreeTrunk(writer, outline, color, true, 0.4);
  paintTreeDetails(writer, bark, twigs);
}

fn facetedCanopyTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, bend: f32) {
  let perimeter = reservePath(writer, 20u);
  if (perimeter.count != 20u) { return; }
  for (var index = 0u; index < 10u; index++) {
    let center = origin + vec2f(sqrt(f32(index) / 10.0) * bend * 100.0, -f32(index) * height / 10.0);
    setPoint(perimeter, index, center + vec2f((noise(vec3f(f32(index) * 0.5, 0.0, 0.0)) - 0.5) * width - width * 0.5, 0.0));
    setPoint(perimeter, 19u - index, center + vec2f((noise(vec3f(f32(index) * 0.5, 0.5, 0.0)) - 0.5) * width + width * 0.5, 0.0));
  }
  // Trunk ears optimize area/perimeter; broad leaf ears use source order.
  // facet performs iterative longest-edge splitting and centroid-noise shading.
  facet(writer, perimeter, 50.0, true, true);
  for (var index = 3u; index < 10u; index++) {
    if ((*writer).overflow != 0u) { return; }
    let center = origin + vec2f(sqrt(f32(index) / 10.0) * bend * 100.0, -f32(index) * height / 10.0);
    let position = center + vec2f((random(writer) - 0.5) * width * 1.2 * f32(10u - index) * 0.5,
      (random(writer) - 0.5) * width * 0.5);
    let length = uniform(writer, 20.0, 70.0);
    let leafWidth = uniform(writer, 12.0, 24.0);
    let angle = -random(writer) * TREE_PI / 6.0;
    let leaf = blobPath(writer, position, length, leafWidth, angle, 0.5, 2u);
    facet(writer, leaf, 50.0, true, false);
  }
}

fn lineBranchFrame(origin: vec2f, angle: f32, length: f32, bend: f32, depth: u32) -> LineBranchFrame {
  return LineBranchFrame(origin, origin + vec2f(cos(angle), sin(angle)) * length,
    angle, length, bend, 0.0, depth, 0u, 0u, 0u);
}

fn recursiveLineBranch(writer: ptr<function, Writer>, origin: vec2f, angle: f32, depth: u32) {
  if (depth > 3u) { (*writer).overflow = 1u; return; }
  var stack: array<LineBranchFrame, 4>;
  var stackIndex = 0u;
  // Upstream calls pass hei:20/25, but this function reads len, defaulting to 15.
  stack[0] = lineBranchFrame(origin, angle, 15.0, 0.0, depth);
  loop {
    if ((*writer).overflow != 0u) { return; }
    var frame = stack[stackIndex];
    if (frame.initialized == 0u) {
      let bendSign = -treeSign(writer);
      let path = reservePath(writer, 11u);
      if (path.count != 11u) { return; }
      for (var index = 0u; index < 11u; index++) {
        // The source bends with i/11 after subdividing a line by ten. Thus the
        // final rendered point differs slightly from the children's endpoint.
        let local = vec2f(f32(index) * frame.length / 10.0,
          bendSign * sin(f32(index) / 11.0 * TREE_PI) * 2.0);
        setPoint(path, index, frame.origin + treeRotate(local, frame.angle));
      }
      stroke(writer, path, ink(0.5), 0.8, select(1u, 2u, frame.depth == 0u), 0.5, 1.0);
      frame.initialized = 1u;
      if (frame.depth > 0u) {
        frame.childBend = frame.bend + treeSign(writer) * TREE_PI * 0.001 * f32(frame.depth * frame.depth);
        frame.childCount = select(1u, 2u, random(writer) < 0.5);
      }
      stack[stackIndex] = frame;
    }
    if (frame.nextChild == frame.childCount) {
      if (stackIndex == 0u) { break; }
      stackIndex -= 1u;
      continue;
    }
    if (stackIndex + 1u >= 4u) { (*writer).overflow = 1u; return; }
    var childAngle = frame.angle + frame.bend;
    if (frame.childCount == 2u) {
      // Both interval samples are made before choosing one, as in randChoice.
      let negative = uniform(writer, -1.0, select(-0.5, 0.5, frame.nextChild == 0u));
      let positive = uniform(writer, 0.5, 1.0);
      childAngle += TREE_PI * select(negative, positive, random(writer) >= 0.5) * 0.2;
    }
    let childLength = frame.length * uniform(writer, 0.8, 0.9);
    frame.nextChild += 1u;
    stack[stackIndex] = frame;
    stackIndex += 1u;
    stack[stackIndex] = lineBranchFrame(frame.endpoint, childAngle, childLength, frame.childBend, frame.depth - 1u);
  }
}

fn leaningLineTree(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, color: vec4f) {
  let lean = uniform(writer, -1.0, 1.0) * TREE_PI * 0.2;
  let trunk = irregularBranch(writer, origin, height, width, -TREE_PI * 0.5 + lean, TREE_PI * 0.2, height / 20.0);
  let perimeter = branchPerimeter(writer, trunk);
  paintTreeTrunk(writer, perimeter, color, false, 0.6);
  for (var index = 0u; index < perimeter.count; index++) {
    if ((*writer).overflow != 0u) { return; }
    if (random(writer) < 0.2) {
      let depth = u32(floor(4.0 * random(writer)));
      let angle = -TREE_PI * 0.5 - lean * random(writer);
      recursiveLineBranch(writer, point(perimeter, index), angle, depth);
    } else if (index == perimeter.count / 2u) {
      recursiveLineBranch(writer, point(perimeter, index), -TREE_PI * 0.5 + lean, 3u);
    }
  }
}

// bend is the scalar coefficient in t*bend for style 3 and sqrt(t)*bend for
// style 7 (source defaults 0 and .2). Other recipes keep their original bends.
// Style 2 uses five leaves; terrain rim clusters call leafCluster with two.
export fn tree(
  writer: ptr<function, Writer>, style: u32, origin: vec2f,
  height: f32, width: f32, bend: f32, color: vec4f,
) {
  if ((*writer).overflow != 0u) { return; }
  switch style {
    case 1u: { sparseContourTree(writer, origin, height, width, color); }
    case 2u: { leafCluster(writer, origin, height, width, 5u, color); }
    case 3u: { denseCanopyTree(writer, origin, height, width, bend, color); }
    case 4u: { spreadingCanopyTree(writer, origin, height, width, color); }
    case 5u: { tieredCanopyTree(writer, origin, height, width, color); }
    case 6u: { forkedBareTree(writer, origin, height, width, color); }
    case 7u: { facetedCanopyTree(writer, origin, height, width, bend); }
    case 8u: { leaningLineTree(writer, origin, height, width, color); }
    default: { (*writer).overflow = 1u; }
  }
}
