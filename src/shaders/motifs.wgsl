// Original constructions by Lingdong Huang, copyright 2018, MIT.
// Port of upstream shan-shui-inf/index.html:2525-3704. See LICENSE and
// docs/original-motifs.md. Geometry, cloth profiles, and painter order remain
// the original constructions; randomness is supplied by the GPU Writer.
import {
  Writer, Path, Paint, random, uniform, noise, reservePath, point, setPoint,
  reversePath, joinPaths, subdivide, curve, polygon, stroke, texturedGrid,
  ink, white, transparent,
} from "./construction.wgsl";
import { SIGNAGE_POINTS, SIGNAGE_GLYPHS, SIGNAGE_CHARACTERS } from "./glyphs.wgsl";

const PI: f32 = 3.141592653589793;

fn pathPair(writer: ptr<function, Writer>, first: vec2f, last: vec2f) -> Path {
  let path = reservePath(writer, 2u);
  if (path.count != 2u) { return path; }
  setPoint(path, 0u, first);
  setPoint(path, 1u, last);
  return path;
}

fn pathTriple(writer: ptr<function, Writer>, first: vec2f, middle: vec2f, last: vec2f) -> Path {
  let path = reservePath(writer, 3u);
  if (path.count != 3u) { return path; }
  setPoint(path, 0u, first);
  setPoint(path, 1u, middle);
  setPoint(path, 2u, last);
  return path;
}

fn pathFour(writer: ptr<function, Writer>, first: vec2f, second: vec2f, third: vec2f, last: vec2f) -> Path {
  let path = reservePath(writer, 4u);
  if (path.count != 4u) { return path; }
  setPoint(path, 0u, first);
  setPoint(path, 1u, second);
  setPoint(path, 2u, third);
  setPoint(path, 3u, last);
  return path;
}

fn pathFive(writer: ptr<function, Writer>, first: vec2f, second: vec2f, third: vec2f, fourth: vec2f, last: vec2f) -> Path {
  let path = reservePath(writer, 5u);
  if (path.count != 5u) { return path; }
  setPoint(path, 0u, first);
  setPoint(path, 1u, second);
  setPoint(path, 2u, third);
  setPoint(path, 3u, fourth);
  setPoint(path, 4u, last);
  return path;
}

fn sampledLine(writer: ptr<function, Writer>, first: vec2f, last: vec2f, subdivisions: u32) -> Path {
  return subdivide(writer, pathPair(writer, first, last), subdivisions);
}

fn buildingOutline(writer: ptr<function, Writer>, path: Path, width: f32) {
  stroke(writer, path, ink(0.4), width, 1u, 1.0, 1.0);
}

fn setSegment(segments: Path, index: u32, first: vec2f, last: vec2f) {
  setPoint(segments, index * 2u, first);
  setPoint(segments, index * 2u + 1u, last);
}

fn outlineSegments(writer: ptr<function, Writer>, segments: Path, width: f32) {
  for (var index = 0u; index + 1u < segments.count; index += 2u) {
    if ((*writer).overflow != 0u) { return; }
    buildingOutline(writer, subdivide(writer, Path(segments.offset + index, 2u), 5u), width);
  }
}

// The original thatch helper: ten radial profiles, independently randomized
// heights, a white silhouette that omits each outside profile's last sample,
// two native edge lines, and 300 rejection-distributed texture candidates.
// rotation and perspective are part of the common motif contract; this source
// helper does not use them (nor does the pavilion forward its rotation).
export fn hut(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32) {
  if ((*writer).overflow != 0u) { return; }
  let grid = reservePath(writer, 100u);
  if (grid.count != 100u) { return; }
  for (var row = 0u; row < 10u; row++) {
    let profileHeight = height + height * 0.2 * random(writer);
    for (var column = 0u; column < 10u; column++) {
      let fraction = f32(column) / 9.0;
      let position = vec2f(width * (f32(row) / 9.0 - 0.5) * pow(fraction, 0.7), profileHeight * fraction);
      setPoint(grid, row * 10u + column, position);
    }
  }
  let silhouette = reservePath(writer, 18u);
  let firstEdge = reservePath(writer, 10u);
  let lastEdge = reservePath(writer, 10u);
  if ((*writer).overflow != 0u) { return; }
  for (var sample = 0u; sample < 10u; sample++) {
    setPoint(firstEdge, sample, origin + point(grid, sample));
    setPoint(lastEdge, sample, origin + point(grid, 90u + sample));
    if (sample < 9u) {
      setPoint(silhouette, sample, origin + point(grid, sample));
      setPoint(silhouette, 9u + sample, origin + point(grid, 98u - sample));
    }
  }
  polygon(writer, silhouette, Paint(white(), transparent(), 0.0));
  polygon(writer, firstEdge, Paint(transparent(), ink(0.3), 2.0));
  polygon(writer, lastEdge, Paint(transparent(), ink(0.3), 2.0));
  texturedGrid(writer, grid, 10u, 10u, origin, 300u, 1.0, 0.25, 0.0, 2u, 5.0);
}

// Window patterns use the same four perspective-projected corners and exact
// source subdivision fractions. The decoration itself has no white fill.
fn decorateWall(writer: ptr<function, Writer>, style: u32, upperLeft: vec2f, upperRight: vec2f, lowerLeft: vec2f, lowerRight: vec2f, horizontalDivisions: u32, verticalDivisions: u32, width: f32) {
  if (style == 0u || (*writer).overflow != 0u) { return; }
  if (horizontalDivisions < 2u || verticalDivisions < 2u || style > 3u) {
    (*writer).overflow = 1u;
    return;
  }
  let leftFraction = 1.0 / f32(horizontalDivisions);
  let rightFraction = f32(horizontalDivisions - 1u) / f32(horizontalDivisions);
  let middleLeftTop = mix(upperLeft, upperRight, leftFraction);
  let middleRightTop = mix(upperLeft, upperRight, rightFraction);
  let middleLeftBottom = mix(lowerLeft, lowerRight, leftFraction);
  let middleRightBottom = mix(lowerLeft, lowerRight, rightFraction);
  let segmentCount = select(verticalDivisions * 2u, horizontalDivisions - 1u, style == 2u);
  if (segmentCount > ((*writer).controlCapacity - (*writer).controlCount) / 2u) {
    (*writer).overflow = 1u;
    return;
  }
  let segments = reservePath(writer, segmentCount * 2u);
  if ((*writer).overflow != 0u) { return; }
  if (style == 2u) {
    for (var column = 1u; column < horizontalDivisions; column++) {
      let fraction = f32(column) / f32(horizontalDivisions);
      setSegment(segments, column - 1u, mix(upperLeft, upperRight, fraction), mix(lowerLeft, lowerRight, fraction));
    }
    outlineSegments(writer, segments, width);
    return;
  }
  for (var row = 1u; row < verticalDivisions; row++) {
    let fraction = f32(row) / f32(verticalDivisions);
    let innerLeft = mix(middleLeftTop, middleLeftBottom, fraction);
    let innerRight = mix(middleRightTop, middleRightBottom, fraction);
    if (style == 1u) {
      setSegment(segments, (row - 1u) * 2u, innerLeft, mix(upperLeft, lowerLeft, fraction));
      setSegment(segments, (row - 1u) * 2u + 1u, innerRight, mix(upperRight, lowerRight, fraction));
    } else {
      setSegment(segments, (row - 1u) * 2u, innerLeft, innerRight);
      setSegment(segments, (row - 1u) * 2u + 1u, mix(middleLeftTop, middleRightTop, fraction), mix(middleLeftBottom, middleRightBottom, fraction));
    }
  }
  setSegment(segments, segmentCount - 2u, middleLeftTop, middleLeftBottom);
  setSegment(segments, segmentCount - 1u, middleRightTop, middleRightBottom);
  outlineSegments(writer, segments, width);
}

fn box(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32, seeThrough: bool, bottomEdges: bool, outlineWidth: f32, decoration: u32, horizontalDivisions: u32, verticalDivisions: u32) {
  if ((*writer).overflow != 0u) { return; }
  let left = -width * 0.5;
  let right = width * 0.5;
  let front = left + width * rotation;
  let back = left + width * (1.0 - rotation);
  if (!seeThrough) {
    let silhouette = pathFive(writer, origin + vec2f(left, -height), origin + vec2f(right, -height), origin + vec2f(right, 0.0), origin + vec2f(front, perspective), origin + vec2f(left, 0.0));
    polygon(writer, silhouette, Paint(white(), transparent(), 0.0));
  }
  let segmentCount = 3u + select(0u, 2u, bottomEdges) + select(0u, 1u + select(0u, 2u, bottomEdges), seeThrough);
  let segments = reservePath(writer, segmentCount * 2u);
  if ((*writer).overflow != 0u) { return; }
  setSegment(segments, 0u, origin + vec2f(left, -height), origin + vec2f(left, 0.0));
  setSegment(segments, 1u, origin + vec2f(right, -height), origin + vec2f(right, 0.0));
  var segment = 2u;
  if (bottomEdges) {
    setSegment(segments, segment, origin + vec2f(left, 0.0), origin + vec2f(front, perspective));
    setSegment(segments, segment + 1u, origin + vec2f(right, 0.0), origin + vec2f(front, perspective));
    segment += 2u;
  }
  setSegment(segments, segment, origin + vec2f(front, -height), origin + vec2f(front, perspective));
  segment++;
  if (seeThrough) {
    if (bottomEdges) {
      setSegment(segments, segment, origin + vec2f(left, 0.0), origin + vec2f(back, -perspective));
      setSegment(segments, segment + 1u, origin + vec2f(right, 0.0), origin + vec2f(back, -perspective));
      segment += 2u;
    }
    setSegment(segments, segment, origin + vec2f(back, -height), origin + vec2f(back, -perspective));
  }
  outlineSegments(writer, segments, outlineWidth);
  let visibleSide = select(-1.0, 1.0, rotation < 0.5);
  decorateWall(writer, decoration,
    origin + vec2f(visibleSide * width * 0.5, -height), origin + vec2f(front, -height + perspective),
    origin + vec2f(visibleSide * width * 0.5, 0.0), origin + vec2f(front, perspective),
    horizontalDivisions, verticalDivisions, outlineWidth);
}

fn railing(writer: ptr<function, Writer>, origin: vec2f, seed: f32, width: f32, height: f32, rotation: f32, perspective: f32, segments: u32, outlineWidth: f32, backVisible: bool, frontVisible: bool) {
  if ((*writer).overflow != 0u || (!backVisible && !frontVisible)) { return; }
  if (segments < 2u || segments >= (*writer).controlCapacity) {
    (*writer).overflow = 1u;
    return;
  }
  let front = -width * 0.5 + width * rotation;
  let back = -width * 0.5 + width * (1.0 - rotation);
  // Only path handles are local. Every point, including these mutable rail
  // samples, lives in the GPU storage slice owned by this Writer.
  var rails: array<Path, 8>;
  var railCount = 0u;
  for (var level = 0u; level < 2u; level++) {
    let baseline = -f32(level) * height;
    if (frontVisible) {
      rails[railCount] = sampledLine(writer, origin + vec2f(-width * 0.5, baseline), origin + vec2f(front, baseline + perspective), segments);
      rails[railCount + 1u] = sampledLine(writer, origin + vec2f(front, baseline + perspective), origin + vec2f(width * 0.5, baseline), segments);
      railCount += 2u;
    }
    if (backVisible) {
      rails[railCount] = sampledLine(writer, origin + vec2f(-width * 0.5, baseline), origin + vec2f(back, baseline - perspective), segments);
      rails[railCount + 1u] = sampledLine(writer, origin + vec2f(back, baseline - perspective), origin + vec2f(width * 0.5, baseline), segments);
      railCount += 2u;
    }
  }
  if ((*writer).overflow != 0u) { return; }
  if (backVisible) {
    let opening = u32(floor(random(writer) * f32(railCount)));
    // Source deliberately trims the SAME rail twice, not its paired top rail.
    rails[opening].count -= 2u;
  }
  for (var railIndex = 0u; railIndex < railCount / 2u; railIndex++) {
    let bottom = rails[railIndex];
    let top = rails[railCount / 2u + railIndex];
    for (var sample = 0u; sample < bottom.count; sample++) {
      if ((*writer).overflow != 0u) { return; }
      var lowerPosition = point(bottom, sample);
      lowerPosition.y += (noise(vec3f(f32(railIndex), f32(sample) * 0.5, seed)) - 0.5) * height;
      setPoint(bottom, sample, lowerPosition);
      // Modulo can revisit a shortened top rail; those perturbations accumulate.
      let topSample = sample % top.count;
      var upperPosition = point(top, topSample);
      upperPosition.y += (noise(vec3f(f32(railIndex) + 0.5, f32(sample) * 0.5, seed)) - 0.5) * height;
      setPoint(top, topSample, upperPosition);
      let post = sampledLine(writer, lowerPosition, upperPosition, 2u);
      if ((*writer).overflow != 0u) { return; }
      var postStart = point(post, 0u);
      postStart.x += (random(writer) - 0.5) * height * 0.5;
      setPoint(post, 0u, postStart);
      polygon(writer, post, Paint(transparent(), ink(0.5), 2.0));
    }
  }
  for (var railIndex = 0u; railIndex < railCount; railIndex++) {
    stroke(writer, rails[railIndex], ink(0.5), outlineWidth, 1u, 0.5, 1.0);
  }
}

fn roofPoint(origin: vec2f, position: vec2f, mirrored: bool) -> vec2f {
  return origin + vec2f(select(position.x, -position.x, mirrored), position.y);
}

fn plaque(writer: ptr<function, Writer>, origin: vec2f, size: f32, angle: f32) {
  var advance = 0.0;
  for (var character = 0u; character < 9u; character++) {
    advance += SIGNAGE_GLYPHS[SIGNAGE_CHARACTERS[character]].advance;
  }
  var cursor = -advance * 0.5;
  for (var character = 0u; character < 9u; character++) {
    let glyph = SIGNAGE_GLYPHS[SIGNAGE_CHARACTERS[character]];
    if (glyph.count != 0u) {
      let path = reservePath(writer, glyph.count);
      if ((*writer).overflow != 0u) { return; }
      for (var sample = 0u; sample < glyph.count; sample++) {
        let local = (SIGNAGE_POINTS[glyph.offset + sample] + vec2f(cursor, 0.0)) * size;
        setPoint(path, sample, origin + vec2f(local.x * cos(angle) - local.y * sin(angle), local.x * sin(angle) + local.y * cos(angle)));
      }
      polygon(writer, path, Paint(ink(0.9), transparent(), 0.0));
    }
    cursor += glyph.advance;
  }
}

fn roof(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32, corner: f32, outlineWidth: f32, withPlaque: bool) {
  if ((*writer).overflow != 0u) { return; }
  let mirrored = rotation < 0.5;
  let effectiveRotation = select(rotation, 1.0 - rotation, mirrored);
  let middle = -width * 0.5 + width * effectiveRotation;
  let quarter = (middle + width * 0.5) * 0.5 - middle;
  let leftRidge = roofPoint(origin, vec2f(-width * 0.5 + quarter, -height - perspective * 0.5), mirrored);
  let frontRidge = roofPoint(origin, vec2f(middle + quarter, -height), mirrored);
  let leftBend = roofPoint(origin, vec2f(-width * 0.5 + quarter * 0.5, -height * 0.5 - perspective * 0.25), mirrored);
  let rightBend = roofPoint(origin, vec2f((middle + quarter + width * 0.5) * 0.5, -height * 0.5), mirrored);
  let frontBend = roofPoint(origin, vec2f(middle + quarter * 0.5, -height * 0.5 + perspective * 0.5), mirrored);
  let leftEave = roofPoint(origin, vec2f(-width * 0.5 - corner, 0.0), mirrored);
  let rightEave = roofPoint(origin, vec2f(width * 0.5 + corner, 0.0), mirrored);
  let frontEave = roofPoint(origin, vec2f(middle + corner, perspective), mirrored);
  let silhouette = pathFive(writer,
    roofPoint(origin, vec2f(-width * 0.5, 0.0), mirrored), leftRidge, frontRidge,
    roofPoint(origin, vec2f(width * 0.5, 0.0), mirrored), roofPoint(origin, vec2f(middle, perspective), mirrored));
  polygon(writer, silhouette, Paint(white(), transparent(), 0.0));
  let paths = array<Path, 6>(
    pathTriple(writer, leftRidge, leftBend, leftEave),
    pathTriple(writer, frontRidge, rightBend, rightEave),
    pathTriple(writer, frontRidge, frontBend, frontEave),
    pathPair(writer, leftEave, frontEave), pathPair(writer, rightEave, frontEave),
    pathPair(writer, leftRidge, frontRidge));
  for (var pathIndex = 0u; pathIndex < 6u; pathIndex++) {
    if ((*writer).overflow != 0u) { return; }
    buildingOutline(writer, subdivide(writer, paths[pathIndex], 5u), outlineWidth);
  }
  if (withPlaque) {
    let first = select(frontBend, leftBend, frontBend.x > leftBend.x);
    let last = select(leftBend, frontBend, frontBend.x > leftBend.x);
    plaque(writer, (first + last) * 0.5, height * 0.6, atan2(last.y - first.y, last.x - first.x));
  }
}

fn pagodaRoof(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, perspective: f32, corner: f32, sides: u32, outlineWidth: f32) {
  if ((*writer).overflow != 0u) { return; }
  if (sides < 2u || sides >= (*writer).controlCapacity - (*writer).controlCount) {
    (*writer).overflow = 1u;
    return;
  }
  let silhouette = reservePath(writer, sides + 1u);
  if ((*writer).overflow != 0u) { return; }
  let apex = origin + vec2f(0.0, -height);
  setPoint(silhouette, 0u, apex);
  for (var side = 0u; side < sides; side++) {
    let fraction = f32(side) / f32(sides - 1u) - 0.5;
    let projectedHeight = perspective * (1.0 - abs(fraction) * 2.0);
    setPoint(silhouette, side + 1u, origin + vec2f((width + corner) * fraction, projectedHeight));
  }
  polygon(writer, silhouette, Paint(white(), transparent(), 0.0));
  for (var pathIndex = 0u; pathIndex < sides * 2u - 1u; pathIndex++) {
    if ((*writer).overflow != 0u) { return; }
    let side = (pathIndex + 1u) / 2u;
    let eave = point(silhouette, side + 1u);
    var path: Path;
    if (pathIndex % 2u == 1u) {
      path = pathPair(writer, point(silhouette, side), eave);
    } else {
      let fraction = f32(side) / f32(sides - 1u) - 0.5;
      let projectedHeight = perspective * (1.0 - abs(fraction) * 2.0);
      let bend = origin + vec2f(width * fraction * 0.5, (-height + projectedHeight) * 0.5);
      path = pathTriple(writer, apex, bend, eave);
    }
    buildingOutline(writer, subdivide(writer, path, 5u), outlineWidth);
  }
}

// Clothing uses an analytic width, not noisy brush width. Only the subsequent
// side outlines use stroke(). Profiles 0/1/2 are sleeve/body/head respectively.
fn clothWidth(fraction: f32, scale: f32, profile: u32) -> f32 {
  if (profile == 2u) {
    return scale * 7.0 * pow(max(0.0, 0.25 - (fraction - 0.5) * (fraction - 0.5)), 0.3);
  }
  // The .1 power amplifies JS's positive sin(Math.PI) roundoff into a visible
  // endpoint width. Retain that source endpoint instead of using f32's negative
  // sin(pi), which would produce NaN (or zero after a roundoff clamp).
  let envelope = select(max(0.0, sin(fraction * PI)), 1.2246467991473532e-16, fraction == 1.0);
  let roundness = sin(0.5 * fraction * PI) * pow(envelope, 0.1);
  if (profile == 1u) { return scale * 11.0 * (roundness + (1.0 - fraction) * 0.5); }
  return scale * 8.0 * (roundness + (1.0 - fraction) * 0.4);
}

struct ClothContours {
  first: Path,
  second: Path,
}

fn expandClothing(writer: ptr<function, Writer>, centerline: Path, scale: f32, profile: u32) -> ClothContours {
  // Upstream expand() consumes this otherwise unused draw.
  let unusedNoiseSeed = random(writer);
  let first = reservePath(writer, centerline.count);
  let second = reservePath(writer, centerline.count);
  if ((*writer).overflow != 0u || centerline.count < 2u) { return ClothContours(first, second); }
  for (var sample = 0u; sample < centerline.count; sample++) {
    let center = point(centerline, sample);
    var direction = 0.0;
    var fraction = f32(sample) / f32(centerline.count);
    if (sample == 0u) {
      let next = point(centerline, 1u);
      direction = atan2(next.y - center.y, next.x - center.x) - PI * 0.5;
      fraction = 0.0;
    } else if (sample == centerline.count - 1u) {
      let previous = point(centerline, sample - 1u);
      direction = atan2(center.y - previous.y, center.x - previous.x) - PI * 0.5;
      fraction = 1.0;
    } else {
      let previous = point(centerline, sample - 1u);
      let next = point(centerline, sample + 1u);
      let incoming = atan2(center.y - previous.y, center.x - previous.x);
      let outgoing = atan2(center.y - next.y, center.x - next.x);
      direction = (incoming + outgoing) * 0.5;
      if (direction < outgoing) { direction += PI; }
    }
    let offset = clothWidth(fraction, scale, profile) * vec2f(cos(direction), sin(direction));
    setPoint(first, sample, center + offset);
    setPoint(second, sample, center - offset);
  }
  return ClothContours(first, second);
}

fn placeFigurePath(path: Path, origin: vec2f, flipped: bool) {
  for (var sample = 0u; sample < path.count; sample++) {
    let local = point(path, sample);
    setPoint(path, sample, origin + vec2f(select(local.x, -local.x, flipped), local.y));
  }
}

fn clothing(writer: ptr<function, Writer>, joints: Path, origin: vec2f, scale: f32, flipped: bool, profile: u32) {
  if ((*writer).overflow != 0u) { return; }
  let centerline = curve(writer, joints, 2.0);
  let contours = expandClothing(writer, centerline, scale, profile);
  // In the source, second.reverse() mutates that contour before its own stroke.
  let second = reversePath(writer, contours.second);
  if ((*writer).overflow != 0u) { return; }
  placeFigurePath(contours.first, origin, flipped);
  placeFigurePath(second, origin, flipped);
  polygon(writer, joinPaths(writer, contours.first, second), Paint(white(), transparent(), 0.0));
  stroke(writer, contours.first, ink(0.5), 1.0, 0u, 0.5, 1.0);
  stroke(writer, second, ink(0.6), 1.0, 0u, 0.5, 1.0);
}

// Hat and staff coordinates are normalized immutable shape data. The original
// transform always mirrors x once and mirrors it a second time when flipped.
fn attachedPoint(first: vec2f, last: vec2f, position: vec2f, flipped: bool) -> vec2f {
  let local = vec2f(select(-position.x, position.x, flipped), position.y);
  let axis = last - first;
  // Align local y with the anchors without polar angles or signed-zero atan2.
  return first + local.x * vec2f(axis.y, -axis.x) + local.y * axis;
}

const STANDING_HAT: array<vec2f, 7> = array<vec2f, 7>(
  vec2f(-0.3, 0.5), vec2f(0.3, 0.8), vec2f(0.2, 1.0), vec2f(0.0, 1.1),
  vec2f(-0.3, 1.15), vec2f(-0.55, 1.0), vec2f(-0.65, 0.5));
const BOAT_HAT: array<vec2f, 10> = array<vec2f, 10>(
  vec2f(-0.3, 0.5), vec2f(-1.1, 0.5), vec2f(-1.2, 0.6), vec2f(-1.1, 0.7),
  vec2f(-0.3, 0.8), vec2f(0.3, 0.8), vec2f(1.0, 0.7), vec2f(1.3, 0.6),
  vec2f(1.2, 0.5), vec2f(0.3, 0.5));

fn hat(writer: ptr<function, Writer>, first: vec2f, last: vec2f, flipped: bool, broadBrim: bool) {
  if ((*writer).overflow != 0u) { return; }
  let seed = random(writer);
  let count = select(7u, 10u, broadBrim);
  let silhouette = reservePath(writer, count);
  if ((*writer).overflow != 0u) { return; }
  for (var sample = 0u; sample < count; sample++) {
    var local = vec2f(0.0);
    if (broadBrim) { local = BOAT_HAT[sample]; }
    else { local = STANDING_HAT[sample]; }
    setPoint(silhouette, sample, attachedPoint(first, last, local, flipped));
  }
  polygon(writer, silhouette, Paint(ink(0.8), transparent(), 0.0));
  if (!broadBrim) {
    let trailingRibbon = reservePath(writer, 10u);
    if ((*writer).overflow != 0u) { return; }
    for (var sample = 0u; sample < 10u; sample++) {
      let local = vec2f(-0.3 - noise(vec3f(f32(sample) * 0.2, seed, 0.0)) * f32(sample) * 0.1, 0.5 - f32(sample) * 0.3);
      setPoint(trailingRibbon, sample, attachedPoint(first, last, local, flipped));
    }
    polygon(writer, trailingRibbon, Paint(transparent(), ink(0.8), 1.0));
  }
}

fn staff(writer: ptr<function, Writer>, first: vec2f, last: vec2f, flipped: bool) {
  if ((*writer).overflow != 0u) { return; }
  let seed = random(writer);
  let path = reservePath(writer, 12u);
  if ((*writer).overflow != 0u) { return; }
  for (var sample = 0u; sample < 12u; sample++) {
    let local = vec2f(-noise(vec3f(f32(sample) * 0.1, seed, 0.0)) * 0.1 * sin(f32(sample) / 12.0 * PI) * 5.0, f32(sample) * 0.3);
    setPoint(path, sample, attachedPoint(first, last, local, flipped));
  }
  polygon(writer, path, Paint(transparent(), ink(0.5), 1.0));
}

// Fixed ancestor paths replace the original recursive search, preserving its
// root-to-leaf angle and segment additions for every one of the nine joints.
const JOINT_ANCESTORS: array<vec4u, 9> = array<vec4u, 9>(
  vec4u(0u, 0u, 0u, 0u), vec4u(0u, 1u, 0u, 0u), vec4u(0u, 1u, 2u, 0u),
  vec4u(0u, 3u, 0u, 0u), vec4u(0u, 3u, 4u, 0u), vec4u(0u, 1u, 5u, 0u),
  vec4u(0u, 1u, 5u, 6u), vec4u(0u, 1u, 7u, 0u), vec4u(0u, 1u, 7u, 8u));
const JOINT_DEPTHS: array<u32, 9> = array<u32, 9>(1u, 2u, 3u, 2u, 3u, 3u, 4u, 3u, 4u);

export fn person(writer: ptr<function, Writer>, origin: vec2f, scale: f32, flipped: bool, boatPose: bool) {
  if ((*writer).overflow != 0u) { return; }
  let neckTurn = uniform(writer, 0.0, 0.0);
  let hipTurn = PI * 0.25 * random(writer);
  let kneeTurn = PI * 0.75 * random(writer);
  let shoulderTurn = -PI * 0.75 - PI * 0.25 * random(writer);
  let angles = array<f32, 9>(0.0, -PI * 0.5, neckTurn, hipTurn, kneeTurn, PI * 0.75, -PI * 0.25, shoulderTurn, -PI * 0.25);
  let lengths = array<f32, 9>(0.0, 30.0, 20.0, 30.0, select(30.0, 10.0, boatPose), 30.0, 30.0, 30.0, 30.0);
  let joints = reservePath(writer, 9u);
  if ((*writer).overflow != 0u) { return; }
  for (var joint = 0u; joint < 9u; joint++) {
    var position = vec2f(0.0);
    var angle = 0.0;
    for (var depth = 0u; depth < JOINT_DEPTHS[joint]; depth++) {
      let ancestor = JOINT_ANCESTORS[joint][depth];
      angle += angles[ancestor];
      position += lengths[ancestor] * scale * vec2f(cos(angle), sin(angle));
    }
    setPoint(joints, joint, position);
  }
  let groundOrigin = origin - vec2f(0.0, point(joints, 4u).y);
  if (boatPose) {
    let first = point(joints, 8u);
    let last = point(joints, 6u);
    staff(writer, groundOrigin + vec2f(select(first.x, -first.x, flipped), first.y), groundOrigin + vec2f(select(last.x, -last.x, flipped), last.y), flipped);
  }
  // Keep one cloth call site for this ordered sequence. Native GPU compilers
  // inline helpers; four nested copies needlessly multiply that compiler work.
  for (var garment = 0u; garment < 4u; garment++) {
    if ((*writer).overflow != 0u) { return; }
    var chain: Path;
    var profile = 0u;
    switch garment {
      case 0u: { chain = pathTriple(writer, point(joints, 1u), point(joints, 7u), point(joints, 8u)); }
      case 1u: {
        chain = pathFour(writer, point(joints, 1u), point(joints, 0u), point(joints, 3u), point(joints, 4u));
        profile = 1u;
      }
      case 2u: { chain = pathTriple(writer, point(joints, 1u), point(joints, 5u), point(joints, 6u)); }
      default: {
        chain = pathPair(writer, point(joints, 1u), point(joints, 2u));
        profile = 2u;
      }
    }
    clothing(writer, chain, groundOrigin, scale, flipped, profile);
  }
  let headCenterline = curve(writer, pathPair(writer, point(joints, 1u), point(joints, 2u)), 2.0);
  let headContours = expandClothing(writer, headCenterline, scale, 2u);
  if ((*writer).overflow != 0u) { return; }
  let firstTrim = u32(floor(f32(headContours.first.count) * 0.1));
  let secondTrim = u32(floor(f32(headContours.second.count) * 0.95));
  let firstHair = Path(headContours.first.offset + firstTrim, headContours.first.count - firstTrim);
  let secondHair = reversePath(writer, Path(headContours.second.offset + secondTrim, headContours.second.count - secondTrim));
  let hair = joinPaths(writer, firstHair, secondHair);
  if ((*writer).overflow != 0u) { return; }
  placeFigurePath(hair, groundOrigin, flipped);
  polygon(writer, hair, Paint(ink(0.6), transparent(), 0.0));
  let neck = point(joints, 1u);
  let crown = point(joints, 2u);
  hat(writer, groundOrigin + vec2f(select(neck.x, -neck.x, flipped), neck.y), groundOrigin + vec2f(select(crown.x, -crown.x, flipped), crown.y), flipped, boatPose);
}

fn pavilion(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, perspective: f32) {
  let roofFraction = 0.4 + random(writer) * 0.2;
  hut(writer, origin - vec2f(0.0, height), width, height * roofFraction, 0.7, perspective);
  box(writer, origin, width * 2.0 / 3.0, height * (1.0 - roofFraction), 0.7, perspective, true, false, 3.0, 0u, 3u, 2u);
  let backSegments = u32(3.0 + random(writer) * 3.0);
  // arch01 forwarded its public seed into rail noise. The new GPU stream
  // supplies a local seed shared by the front and back rails instead.
  let railingSeed = random(writer) * 10.0;
  railing(writer, origin, railingSeed, width, 10.0, 0.7, perspective * 2.0, backSegments, 1.0, true, false);
  let peopleChoice = u32(random(writer) * 4.0);
  let peopleCount = select(select(1u, 2u, peopleChoice == 3u), 0u, peopleChoice == 0u);
  for (var occupant = 0u; occupant < peopleCount; occupant++) {
    if ((*writer).overflow != 0u) { return; }
    var horizontalPosition = 0.0;
    var flipped = false;
    if (peopleCount == 1u) {
      horizontalPosition = uniform(writer, -width / 3.0, width / 3.0);
      flipped = random(writer) < 0.5;
    } else if (occupant == 0u) {
      horizontalPosition = uniform(writer, -width / 4.0, -width / 5.0);
    } else {
      // This draw remains AFTER constructing the first person.
      horizontalPosition = uniform(writer, width / 5.0, width / 4.0);
      flipped = true;
    }
    person(writer, origin + vec2f(horizontalPosition, 0.0), 0.42, flipped, false);
  }
  let frontSegments = u32(3.0 + random(writer) * 3.0);
  railing(writer, origin, railingSeed, width, 10.0, 0.7, perspective * 2.0, frontSegments, 1.0, false, true);
}

// Styles correspond to source arch01..04, with descriptive constructions:
// 1 thatched pavilion, 2 house, 3 pagoda, 4 open observation tower.
export fn building(writer: ptr<function, Writer>, style: u32, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32, stories: u32, decoration: u32, withRailing: bool) {
  if ((*writer).overflow != 0u) { return; }
  if (style == 1u) { pavilion(writer, origin, width, height, perspective); return; }
  if (style < 2u || style > 4u || stories > (*writer).commandCapacity - (*writer).commandCount) {
    (*writer).overflow = 1u;
    return;
  }
  let house = style == 2u;
  let openTower = style == 4u;
  let wallPerspective = select(perspective * 0.5, perspective, house);
  var wallDecoration = 1u;
  var horizontalDivisions = 4u;
  var verticalDivisions = 2u;
  if (house) {
    if (decoration < 1u || decoration > 3u) { (*writer).overflow = 1u; return; }
    wallDecoration = decoration;
    horizontalDivisions = select(5u, 4u, decoration == 3u);
    verticalDivisions = select(2u, 3u, decoration == 3u);
  }
  if (openTower) { wallDecoration = 0u; }
  var heightOffset = 0.0;
  for (var story = 0u; story < stories; story++) {
    if ((*writer).overflow != 0u) { return; }
    let baseline = origin - vec2f(0.0, heightOffset);
    let storyWidth = width * pow(0.85, f32(story));
    box(writer, baseline, storyWidth, height, rotation, wallPerspective, openTower, true, 1.5, wallDecoration, horizontalDivisions, verticalDivisions);
    if (!house || withRailing) {
      let railSegments = select(select(5u, 3u, openTower), 4u, house);
      let railHeight = height / select(2.0, 3.0, openTower);
      let railWidth = storyWidth * select(1.1, 1.2, openTower);
      railing(writer, baseline, f32(story) * 0.2, railWidth, railHeight, rotation, wallPerspective, railSegments, 0.5, openTower, true);
    }
    let roofWidth = width * pow(0.9, f32(story));
    if (house) {
      // This draw belongs after the railing and only exists for one story.
      var withPlaque = false;
      if (stories == 1u) { withPlaque = random(writer) < 1.0 / 3.0; }
      roof(writer, baseline - vec2f(0.0, height), roofWidth, height, rotation, perspective, 5.0, 1.5, withPlaque);
    } else {
      let roofHeight = height * select(1.5, 1.0, openTower);
      pagodaRoof(writer, baseline - vec2f(0.0, height), roofWidth, roofHeight, perspective, 10.0, 4u, 1.5);
    }
    heightOffset += height * select(1.5, 1.2, openTower);
  }
}

// Count source-style repeated additions before reserving a variable path. The
// Writer's remaining GPU storage bounds the work; failure sets overflow rather
// than truncating a long hull or ripple. The second pass repeats these exact
// f32 additions, including the source loop's exclusive upper endpoint.
fn sampleCount(writer: ptr<function, Writer>, first: f32, end: f32, step: f32) -> u32 {
  if ((*writer).overflow != 0u) { return 0u; }
  if (!(step > 0.0)) { (*writer).overflow = 1u; return 0u; }
  var count = 0u;
  var position = first;
  let capacity = (*writer).controlCapacity - (*writer).controlCount;
  while (position < end) {
    if (count >= capacity) { (*writer).overflow = 1u; return 0u; }
    count++;
    let next = position + step;
    if (!(next > position)) { (*writer).overflow = 1u; return 0u; }
    position = next;
  }
  return count;
}

export fn boat(writer: ptr<function, Writer>, origin: vec2f, nominalLength: f32, scale: f32, flipped: bool) {
  if ((*writer).overflow != 0u) { return; }
  let direction = select(1.0, -1.0, flipped);
  person(writer, origin + vec2f(20.0 * scale * direction, 0.0), scale * 0.5, !flipped, true);
  let count = sampleCount(writer, 0.0, nominalLength * scale, 5.0 * scale);
  if ((*writer).overflow != 0u) { return; }
  if (count > ((*writer).controlCapacity - (*writer).controlCount) / 2u) { (*writer).overflow = 1u; return; }
  let hull = reservePath(writer, count * 2u);
  if ((*writer).overflow != 0u) { return; }
  var position = 0.0;
  for (var sample = 0u; sample < count; sample++) {
    // The original denominator is nominalLength, not nominalLength * scale.
    let profile = sqrt(max(0.0, sin(position / nominalLength * PI)));
    setPoint(hull, sample, origin + vec2f(position * direction, profile * 7.0 * scale));
    setPoint(hull, count * 2u - sample - 1u, origin + vec2f(position * direction, profile * 10.0 * scale));
    position += 5.0 * scale;
  }
  polygon(writer, hull, Paint(white(), transparent(), 0.0));
  stroke(writer, hull, ink(0.4), 1.0, 4u, 0.5, 1.0);
}

fn towerStroke(writer: ptr<function, Writer>, path: Path) {
  // Original width 1 times constant profile .5 is the same width as this.
  stroke(writer, subdivide(writer, path, 5u), ink(0.4), 0.5, 1u, 0.5, 1.0);
}

export fn transmissionTower(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32) {
  if ((*writer).overflow != 0u) { return; }
  let topLeft = origin + vec2f(-width * 0.05, -height);
  let topRight = origin + vec2f(width * 0.05, -height);
  let neckLeft = origin + vec2f(-width * 0.1, -height * 0.9);
  let neckRight = origin + vec2f(width * 0.1, -height * 0.9);
  let waistLeft = origin + vec2f(-width * 0.2, -height * 0.5);
  let waistRight = origin + vec2f(width * 0.2, -height * 0.5);
  let footLeft = origin + vec2f(-width * 0.5, 0.0);
  let footRight = origin + vec2f(width * 0.5, 0.0);
  // Fixed source topology: 15 crossarm lines, 30 crossed lattice diagonals,
  // three horizontal braces, then two four-point legs. Geometry construction
  // consumes no random draws, so recording it before the one ordered paint
  // loop preserves the original 50 stroke seeds and their painter order.
  let segments = reservePath(writer, 96u);
  if ((*writer).overflow != 0u) { return; }
  let crossarms = array<vec2f, 3>(vec2f(0.7, -0.85), vec2f(1.0, -0.675), vec2f(0.7, -0.5));
  for (var crossarm = 0u; crossarm < 3u; crossarm++) {
    let proportions = crossarms[crossarm];
    let first = origin + vec2f(-proportions.x * width, proportions.y * height);
    let last = origin + vec2f(proportions.x * width, proportions.y * height);
    let apex = origin + vec2f(0.0, (proportions.y - 0.05) * height);
    setSegment(segments, crossarm * 5u, first, last);
    setSegment(segments, crossarm * 5u + 1u, first, apex);
    setSegment(segments, crossarm * 5u + 2u, last, apex);
    setSegment(segments, crossarm * 5u + 3u, first, origin + vec2f(-proportions.x * width, (proportions.y + 0.1) * height));
    setSegment(segments, crossarm * 5u + 4u, last, origin + vec2f(proportions.x * width, (proportions.y + 0.1) * height));
  }
  let leftLeg = pathFour(writer, topLeft, neckLeft, waistLeft, footLeft);
  let rightLeg = pathFour(writer, topRight, neckRight, waistRight, footRight);
  let leftSamples = subdivide(writer, leftLeg, 5u);
  let rightSamples = subdivide(writer, rightLeg, 5u);
  if ((*writer).overflow != 0u) { return; }
  for (var sample = 0u; sample + 1u < leftSamples.count; sample++) {
    setSegment(segments, 15u + sample * 2u, point(leftSamples, sample), point(rightSamples, sample + 1u));
    setSegment(segments, 16u + sample * 2u, point(rightSamples, sample), point(leftSamples, sample + 1u));
  }
  setSegment(segments, 45u, topLeft, topRight);
  setSegment(segments, 46u, neckLeft, neckRight);
  setSegment(segments, 47u, waistLeft, waistRight);
  for (var pathIndex = 0u; pathIndex < 50u; pathIndex++) {
    if ((*writer).overflow != 0u) { return; }
    var path = Path(segments.offset + pathIndex * 2u, 2u);
    if (pathIndex == 48u) { path = leftLeg; }
    if (pathIndex == 49u) { path = rightLeg; }
    towerStroke(writer, path);
  }
}

export fn water(writer: ptr<function, Writer>, origin: vec2f, nominalLength: f32, height: f32, clusters: u32) {
  if ((*writer).overflow != 0u) { return; }
  // Store variable-length Path handles in GPU scratch, with bitcasts preserving
  // the u32 indices exactly. These slots are never submitted as drawing points.
  // This avoids a fixed-size local cluster array or silent cluster truncation.
  let paths = reservePath(writer, clusters);
  if ((*writer).overflow != 0u) { return; }
  var verticalOffset = 0.0;
  for (var cluster = 0u; cluster < clusters; cluster++) {
    let horizontalOffset = (random(writer) - 0.5) * (nominalLength / 8.0);
    verticalOffset += random(writer) * 5.0;
    let halfLength = nominalLength / 4.0 + random(writer) * (nominalLength / 4.0);
    let count = sampleCount(writer, -halfLength, halfLength, 5.0);
    let path = reservePath(writer, count);
    if ((*writer).overflow != 0u) { return; }
    var position = -halfLength;
    for (var sample = 0u; sample < count; sample++) {
      let verticalWave = sin(position * 0.2) * height * noise(vec3f(position * 0.1, 0.0, 0.0));
      setPoint(path, sample, origin + vec2f(position + horizontalOffset, verticalWave - 20.0 + verticalOffset));
      position += 5.0;
    }
    setPoint(paths, cluster, bitcast<vec2f>(vec2u(path.offset, path.count)));
  }
  // Cluster zero participates in the cumulative spacing but is never painted.
  // All placement draws precede any alpha or stroke-seed draw.
  for (var cluster = 1u; cluster < clusters; cluster++) {
    if ((*writer).overflow != 0u) { return; }
    let handle = bitcast<vec2u>(point(paths, cluster));
    let alpha = floor((0.3 + random(writer) * 0.3) * 1000.0 + 0.5) / 1000.0;
    stroke(writer, Path(handle.x, handle.y), ink(alpha), 1.0, 0u, 0.5, 1.0);
  }
}
