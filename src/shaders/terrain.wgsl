import { Writer, Path, Paint, reservePath, setPoint, point, translatePath, reversePath, joinPaths, subdivide, polygon, stroke, texturedGrid, distantFacet, random, uniform, noise, ink, white, transparent } from "./construction.wgsl";
import { tree, leafCluster, building, transmissionTower, rock } from "./children.wgsl";
import { decorateIsland } from "./island-decorations.wgsl";

const PI = 3.141592653589793;
fn roundedAlpha(value: f32) -> f32 { return floor(value * 1000.0 + 0.5) / 1000.0; }
fn foliageColor(position: vec2f, minimum: f32) -> vec4f { return ink(roundedAlpha(noise(vec3f(position * 0.01, 0.0)) * 0.15 + minimum)); }
fn ridge(writer: ptr<function, Writer>, grid: Path, rows: u32, origin: vec2f) {
  let mask = reservePath(writer, 51u);
  for (var column = 0u; column < 50u; column++) { setPoint(mask, column, origin + point(grid, column)); }
  setPoint(mask, 50u, origin + vec2f(0.0, f32(rows) * 4.0));
  polygon(writer, mask, Paint(white(), transparent(), 0.0));
  stroke(writer, translatePath(writer, Path(grid.offset, 50u), origin), ink(0.3), 3.0, 0u, 1.0, 1.0);
}
fn foothills(writer: ptr<function, Writer>, grid: Path, origin: vec2f) {
  var feet: array<Path, 16>;
  var count = 0u; var nextRow = 0u;
  for (var row = 0u; row < 8u; row++) {
    if (row != nextRow) { continue; }
    nextRow = min(nextRow + 1u + u32(random(writer) * 2.0), 9u);
    for (var side = 0u; side < 2u; side++) {
      let path = reservePath(writer, 17u);
      if ((*writer).overflow != 0u) { return; }
      for (var column = 0u; column < 7u; column++) {
        let position = point(grid, row * 50u + select(column, 49u - column, side == 1u));
        setPoint(path, 6u - column, origin + position + vec2f(select(1.0, -1.0, side == 1u) * noise(vec3f(f32(column) * 0.1, f32(row), 0.0)) * 10.0, 0.0));
      }
      let column = select(0u, 49u, side == 1u);
      for (var sample = 0u; sample < 10u; sample++) {
        let fraction = f32(sample) / 10.0;
        var position = mix(point(grid, row * 50u + column), point(grid, nextRow * 50u + column), fraction);
        position.y += -1.7 * (fraction - 1.0) * pow(fraction, 0.2) * 5.0 + noise(vec3f(origin.x * 0.05, f32(row), 0.0)) * 5.0;
        setPoint(path, 7u + sample, origin + position);
      }
      feet[count] = path; count++;
    }
  }
  for (var index = 0u; index < count; index++) { polygon(writer, feet[index], Paint(white(), transparent(), 0.0)); }
  for (var index = 0u; index < count; index++) { stroke(writer, feet[index], ink(roundedAlpha(uniform(writer, 0.1, 0.2))), 1.0, 0u, 0.5, 1.0); }
}
export fn mountain(writer: ptr<function, Writer>, origin: vec2f, size: vec2f, seedCoordinate: f32) {
  let grid = reservePath(writer, 500u);
  if ((*writer).overflow != 0u) { return; }
  var heightOffset = 0.0;
  for (var row = 0u; row < 10u; row++) {
    heightOffset += random(writer) * origin.y / 100.0;
    for (var column = 0u; column < 50u; column++) {
      let angle = (f32(column) / 50.0 - 0.5) * PI;
      let elevation = cos(angle) * noise(vec3f(angle + 10.0, f32(row) * 0.15, seedCoordinate));
      let taper = 1.0 - f32(row) / 10.0;
      setPoint(grid, row * 50u + column, vec2f(angle / PI * size.x * taper, -elevation * size.y * taper + heightOffset));
    }
  }
  // The rim precedes the opaque mountain mask; upper foliage follows its texture.
  for (var column = 0u; column < 50u; column++) {
    let position = point(grid, column);
    let growth = noise(vec3f(f32(column) * 0.1, seedCoordinate, 0.0));
    if (growth * growth * growth < 0.1 && abs(position.y) / size.y > 0.2) { leafCluster(writer, origin + position - vec2f(0.0, 5.0), 16.0, 8.0, 2u, foliageColor(position, 0.5)); }
  }
  ridge(writer, grid, 10u, origin);
  foothills(writer, grid, origin);
  let shade = select(0.0, 5.0, random(writer) >= 0.8);
  texturedGrid(writer, grid, 10u, 50u, origin, 200u, 1.5, 0.2, shade, 0u, -1.0);
  for (var row = 0u; row < 10u; row++) {
    for (var column = 0u; column < 50u; column++) {
      let position = point(grid, row * 50u + column);
      let growth = noise(vec3f(f32(row) * 0.1, f32(column) * 0.1, seedCoordinate + 2.0));
      if (growth * growth * growth < 0.1 && abs(position.y) / size.y > 0.5) { leafCluster(writer, origin + position, 16.0, 8.0, 5u, foliageColor(position, 0.5)); }
    }
  }
  // Gather candidates before the original neighborhood-density proof.
  var candidates = reservePath(writer, 250u); var candidateCount = 0u;
  if ((*writer).overflow != 0u) { return; }
  for (var row = 0u; row < 10u; row++) {
    for (var column = 1u; column < 50u; column += 2u) {
      let position = point(grid, row * 50u + column);
      let growth = noise(vec3f(f32(row) * 0.2, f32(column) * 0.05, seedCoordinate));
      if (pow(growth, 4.0) < 0.012 && abs(position.y) / size.y < 0.3) { setPoint(candidates, candidateCount, position); candidateCount++; }
    }
  }
  candidates.count = candidateCount;
  for (var index = 0u; index < candidateCount; index++) {
    let position = point(candidates, index); var neighbors = 0u;
    for (var other = 0u; other < candidateCount; other++) {
      if (index != other && distance(position, point(candidates, other)) < 30.0) { neighbors++; }
      if (neighbors > 2u) { break; }
    }
    if (neighbors > 2u) { tree(writer, 1u, origin + position, (size.y + position.y) / size.y * 70.0 * uniform(writer, 0.3, 1.0), uniform(writer, 1.0, 4.0), 0.0, foliageColor(position, 0.3)); }
  }
  for (var row = 0u; row < 10u; row++) {
    for (var side = 0u; side < 2u; side++) {
      let column = side * 49u; let position = point(grid, row * 50u + column);
      let growth = noise(vec3f(f32(row) * 0.2, f32(column) * 0.05, seedCoordinate));
      if (pow(growth, 4.0) < 0.012) { tree(writer, 3u, origin + position, (size.y + position.y) / size.y * 120.0 * uniform(writer, 0.5, 1.0), 5.0, random(writer) * 0.1, foliageColor(position, 0.3)); }
    }
  }
  for (var row = 1u; row < 10u; row++) {
    for (var side = 0u; side < 2u; side++) {
      let column = 1u + side * 47u;
      let growth = noise(vec3f(f32(row) * 0.2, f32(column) * 0.05, seedCoordinate + 10.0));
      if (pow(growth, 4.0) >= 0.008) { continue; }
      let choice = u32(random(writer) * 6.0); let position = origin + point(grid, row * 50u + column);
      if (choice >= 2u && choice < 5u) {
        let stories = array<u32, 4>(1u, 2u, 2u, 3u);
        let width = uniform(writer, 40.0, 70.0);
        let storyCount = stories[u32(random(writer) * 4.0)];
        let rotation = random(writer);
        let decoration = 1u + u32(random(writer) * 3.0);
        building(writer, 2u, position, width, 10.0, rotation, 5.0, storyCount, decoration, false);
      } else if (choice == 5u) { building(writer, 4u, position, 30.0, 15.0, 0.7, 5.0, select(1u, 2u, random(writer) >= 0.6), 1u, true); }
    }
  }
  if (random(writer) < 0.02) {
    let stories = select(5u, 7u, random(writer) >= 0.5);
    building(writer, 3u, origin + point(grid, 75u), uniform(writer, 40.0, 60.0), 10.0, 0.7, 5.0, stories, 1u, true);
  }
  for (var row = 0u; row < 10u; row += 2u) {
    for (var side = 0u; side < 2u; side++) {
      let column = 1u + side * 47u;
      if (pow(noise(vec3f(f32(row) * 0.2, f32(column) * 0.05, seedCoordinate + 20.0 * PI)), 4.0) < 0.002) { transmissionTower(writer, origin + point(grid, row * 50u + column), 100.0, 20.0); }
    }
  }
  var rockPlacements: array<bool, 20>;
  for (var index = 0u; index < 20u; index++) { rockPlacements[index] = random(writer) < 0.1; }
  for (var row = 0u; row < 10u; row++) {
    for (var side = 0u; side < 2u; side++) {
      if (rockPlacements[row * 2u + side]) { rock(writer, origin + point(grid, row * 50u + side * 49u), vec2f(uniform(writer, 20.0, 40.0), uniform(writer, 20.0, 40.0)), seedCoordinate, 2.0); }
    }
  }
}

export fn island(writer: ptr<function, Writer>, origin: vec2f, size: vec2f, seedCoordinate: f32, plateau: f32) {
  let grid = reservePath(writer, 250u);
  if ((*writer).overflow != 0u) { return; }
  var firstEdges: array<vec2f, 5>; var lastEdges: array<vec2f, 5>; var edgeCounts: array<u32, 5>;
  var heightOffset = 0.0;
  for (var row = 0u; row < 5u; row++) {
    heightOffset += random(writer) * origin.y / 100.0;
    var clipped = false;
    for (var column = 0u; column < 50u; column++) {
      let angle = (f32(column) / 50.0 - 0.5) * PI;
      let elevation = (cos(angle * 2.0) + 1.0) * noise(vec3f(angle + 10.0, f32(row) * 0.1, seedCoordinate));
      let taper = 1.0 - f32(row) / 5.0 * 0.6;
      var position = vec2f(angle / PI * size.x * taper, -elevation * size.y * taper + heightOffset);
      if (position.y < -100.0 * plateau + heightOffset) {
        position.y = -100.0 * plateau + heightOffset;
        if (!clipped) {
          if (edgeCounts[row] == 0u) { firstEdges[row] = position; }
          edgeCounts[row]++; clipped = true;
        }
      } else if (clipped) { lastEdges[row] = point(grid, row * 50u + column - 1u); edgeCounts[row]++; clipped = false; }
      setPoint(grid, row * 50u + column, position);
    }
  }
  ridge(writer, grid, 5u, origin);
  texturedGrid(writer, grid, 5u, 50u, origin, 80u, 2.0, 0.2, 0.0, 1u, -1.0);
  var edgeCount = 0u;
  for (var row = 0u; row < 5u; row += 2u) { if (edgeCounts[row] >= 2u) { edgeCount++; } }
  if (edgeCount == 0u) { return; }
  let left = reservePath(writer, edgeCount + 6u); let right = reservePath(writer, edgeCount + 6u);
  if ((*writer).overflow != 0u) { return; }
  var index = 3u;
  for (var row = 0u; row < 5u; row += 2u) {
    if (edgeCounts[row] < 2u) { continue; }
    setPoint(left, index, firstEdges[row]); setPoint(right, index, lastEdges[row]); index++;
  }
  for (var addition = 0u; addition < 3u; addition++) {
    let proportion = 0.8 - f32(addition) * 0.2;
    setPoint(left, 2u - addition, vec2f(point(left, 3u).x * proportion, point(left, 3u).y - 5.0 * f32(addition + 1u)));
    setPoint(right, 2u - addition, vec2f(point(right, 3u).x * proportion, point(right, 3u).y - 5.0 * f32(addition + 1u)));
    let contraction = 0.6 - f32(addition * addition) * 0.1;
    setPoint(left, index + addition, vec2f(point(left, index - 1u).x * contraction, point(left, index - 1u).y + f32(addition + 1u)));
    setPoint(right, index + addition, vec2f(point(right, index - 1u).x * contraction, point(right, index - 1u).y + f32(addition + 1u)));
  }
  let leftSamples = reversePath(writer, subdivide(writer, left, 5u));
  let rightSamples = subdivide(writer, right, 5u);
  let outline = reservePath(writer, leftSamples.count + rightSamples.count + 1u);
  if ((*writer).overflow != 0u) { return; }
  var minimum = vec2f(1e20); var maximum = vec2f(-1e20);
  for (var sample = 0u; sample < outline.count; sample++) {
    var position = point(leftSamples, 0u);
    if (sample < leftSamples.count) { position = point(leftSamples, sample); }
    else if (sample < outline.count - 1u) { position = point(rightSamples, sample - leftSamples.count); }
    let variation = (1.0 - abs(f32(sample % 5u) - 2.5) / 2.5) * 0.12;
    position.x *= 1.0 - variation + noise(vec3f(position.y * 0.5, 0.0, 0.0)) * variation;
    minimum = min(minimum, position); maximum = max(maximum, position);
    setPoint(outline, sample, origin + position);
  }
  // Upstream closes this path by reference: the last perturbation also moves its first point.
  setPoint(outline, 0u, point(outline, outline.count - 1u));
  polygon(writer, outline, Paint(white(), transparent(), 0.0));
  stroke(writer, outline, ink(0.2), 3.0, 0u, 0.5, 1.0);
  decorateIsland(writer, origin, vec4f(minimum, maximum));
}

export fn distantMountain(writer: ptr<function, Writer>, origin: vec2f, size: vec2f, seedCoordinate: f32) {
  for (var segment = 0u; f32(segment) < size.x / 50.0; segment++) {
    let path = reservePath(writer, 10u);
    if ((*writer).overflow != 0u) { return; }
    for (var sample = 0u; sample < 6u; sample++) {
      let position = f32(segment * 5u + sample);
      setPoint(path, sample + 4u, origin + vec2f(position * 10.0, -size.y * noise(vec3f(position * 0.05, seedCoordinate, 0.0)) * sqrt(max(0.0, sin(PI * position / (size.x / 10.0))))));
    }
    for (var sample = 0u; sample < 4u; sample++) {
      let position = f32(segment * 5u + sample * 2u);
      setPoint(path, 3u - sample, origin + vec2f(position * 10.0, 24.0 * noise(vec3f(position * 0.05, 2.0, seedCoordinate)) * sin(PI * position / (size.x / 10.0))));
    }
    let gray = floor(noise(vec3f(point(path, 9u) * 0.02, origin.y)) * 55.0 + 200.0) / 255.0;
    polygon(writer, path, Paint(vec4f(vec3f(gray), 1.0), transparent(), 0.0));
    distantFacet(writer, path, origin.y);
  }
}
