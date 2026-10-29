// Terrain placement, ink, and attached motifs stay in one pure scene module.
import { Params } from "./params.wgsl";
import { WaterLayout } from "./water.wgsl";
import { PI, randomAt, noiseAt, fbm, line, segment } from "./painting.wgsl";

struct Mountain {
  depth: f32,
  salt: u32,
  cell: f32,
  key: vec2i,
  localX: f32,
  radius: f32,
  height: f32,
  base: f32,
}

// A cosine envelope gives the steep-sided, rounded peaks of the original
// mountain grids. It reaches zero before each cell boundary, so independently
// evaluated world cells join without a moving seam or a chunk cache.
fn mountainHeight(mountain: Mountain, x: f32, params: Params) -> f32 {
  let seed = params.seed;
  let envelope: f32 = max(0.0, cos(clamp(x / mountain.radius, -1.0, 1.0) * PI * 0.5));
  let detail: f32 = fbm(vec2f(x * 6.0, mountain.cell * 0.37), mountain.salt, seed);
  return pow(envelope, 0.72) * mountain.height
       * (0.75 + 0.25 * detail + params.roughness * (detail - 0.5) * 0.48);
}

fn pine(p: vec2f, height: f32, salt: u32, pixel: f32, seed: u32) -> f32 {
  var q: vec2f = p / height;
  if (q.y < -0.02 || q.y > 1.05 || abs(q.x) > 0.48) { return 0.0; }
  q.x += sin(q.y * 3.0) * 0.045;
  let trunk: f32 = line(segment(q, vec2f(0.0), vec2f(0.025, 0.98)), 0.012, pixel / height);
  let tier: f32 = floor(clamp(q.y, 0.0, 0.99) * 5.0);
  let level: f32 = (tier + 0.7) / 5.0;
  let variation: f32 = randomAt(vec2i(i32(tier), select(1, 0, q.x < 0.0)), salt, seed);
  let reach: f32 = ((1.0 - level) * 0.43 + 0.035) * (0.72 + variation * 0.35);
  let branch: f32 = line(q.y - level + abs(q.x) * 0.38, 0.025, pixel / height)
               * (1.0 - smoothstep(reach, reach + 0.025, abs(q.x)));
  let needles: f32 = line(q.y - level + abs(q.x) * 0.5, 0.07, pixel / height)
                * (1.0 - smoothstep(reach * 0.8, reach + 0.015, abs(q.x)))
                * (0.35 + 0.65 * noiseAt(q * vec2f(35.0, 23.0), salt, seed));
  return clamp(max(trunk * 0.8, max(branch, needles)), 0.0, 1.0);
}

fn tree(p: vec2f, height: f32, salt: u32, pixel: f32, seed: u32) -> f32 {
  if (randomAt(vec2i(0), salt, seed) > 0.48) { return pine(p, height, salt, pixel, seed); }
  let q: vec2f = p / height;
  if (q.y < -0.02 || q.y > 1.1 || abs(q.x) > 0.46) { return 0.0; }
  let aa: f32 = pixel / height;
  var trunk: f32 = line(segment(q, vec2f(0.0), vec2f(0.04, 0.81)), 0.014, aa);
  trunk = max(trunk, line(segment(q, vec2f(0.02, 0.3), vec2f(-0.24, 0.7)), 0.011, aa));
  trunk = max(trunk, line(segment(q, vec2f(0.02, 0.45), vec2f(0.27, 0.85)), 0.009, aa));
  var canopy: f32 = min(length(q - vec2f(-0.19, 0.66)) - 0.22,
                     length(q - vec2f(0.17, 0.76)) - 0.24);
  canopy = min(canopy, length(q - vec2f(-0.01, 0.86)) - 0.2);
  let stipple: f32 = noiseAt(q * 28.0, salt, seed);
  canopy += (stipple - 0.5) * 0.11;
  var leaves: f32 = (1.0 - smoothstep(-aa, aa, canopy)) * (0.22 + stipple * 0.58);
  leaves = max(leaves, line(canopy, 0.009, aa) * 0.5);
  return max(trunk, leaves);
}

// Returns paper occlusion and ink separately, keeping walls light against a
// mountain face instead of drawing a solid black architectural icon.
fn pavilion(p: vec2f, levels: f32, pixel: f32) -> vec2f {
  let q: vec2f = p / 0.045;
  let aa: f32 = pixel / 0.045;
  if (q.y < -0.1 || q.y > 3.1 || abs(q.x) > 1.2) { return vec2f(0.0); }
  var ink: f32 = 0.0;
  var paper: f32 = 0.0;
  for (var k: i32 = 0; k < 3; k++) {
    let tier: f32 = f32(k);
    if (tier >= levels) { break; }
    let floorY: f32 = tier * 0.7;
    let width: f32 = 0.78 - tier * 0.17;
    let x: f32 = abs(q.x);
    let wall: f32 = (1.0 - smoothstep(width * 0.69, width * 0.69 + aa, x))
               * smoothstep(floorY - aa, floorY, q.y)
               * (1.0 - smoothstep(floorY + 0.48, floorY + 0.48 + aa, q.y));
    paper = max(paper, wall);
    ink = max(ink, line(x - width * 0.66, 0.014, aa)
                  * step(floorY, q.y) * step(q.y, floorY + 0.48));
    ink = max(ink, line(q.y - floorY, 0.018, aa) * step(x, width * 0.8));
    let roofY: f32 = floorY + 0.69 - x * 0.33 + pow(x / width, 3.0) * 0.13;
    ink = max(ink, line(q.y - roofY, 0.027, aa) * (1.0 - smoothstep(width, width + aa, x)));
    ink = max(ink, line(q.y - roofY + 0.11, 0.012, aa) * step(x, width));
    let door: f32 = line(q.x, 0.065, aa) * step(floorY, q.y) * step(q.y, floorY + 0.3);
    ink = max(ink, door * 0.65);
  }
  ink = max(ink, line(segment(q, vec2f(0.0, levels * 0.7 - 0.01),
                             vec2f(0.0, levels * 0.7 + 0.16)), 0.013, aa));
  return vec2f(paper, ink);
}

fn mountainAt(p: vec2f, layer: u32, water: WaterLayout, params: Params) -> Mountain {
  let seed = params.seed;
  var depth: f32 = 0.65;
  if (params.layers > 1u) { depth = f32(layer) / f32(params.layers - 1u); }
  let salt: u32 = u32(layer) * 1013u + 137u;
  let span: f32 = 1.15 + depth * 0.9;
  let worldX: f32 = p.x + f32(layer) * 0.719;
  let cell: f32 = floor(worldX / span);
  let key: vec2i = vec2i(i32(cell), i32(layer));
  let localX: f32 = worldX - (cell + 0.5) * span;
  let radius: f32 = span * (0.38 + randomAt(key, salt, seed) * 0.105);
  let height: f32 = 0.34 + randomAt(key, salt + 1u, seed) * (0.32 + depth * 0.06);
  var base: f32 = 0.32 - depth * 0.26 + water.mountainOffset;
  base += (randomAt(key, salt + 2u, seed) - 0.5) * 0.045;
  return Mountain(depth, salt, cell, key, localX, radius, height, base);
}

export fn paintMountain(
  p: vec2f, pixel: f32, paper: vec3f, inputColor: vec3f,
  layer: u32, water: WaterLayout, params: Params,
) -> vec3f {
  let seed = params.seed;
  var color = inputColor;
  let mountain: Mountain = mountainAt(p, layer, water, params);
  let top: f32 = mountain.base + mountainHeight(mountain, mountain.localX, params);
  let edgeDistance: f32 = p.y - top;
  var fill: f32 = 1.0 - smoothstep(-pixel, pixel, edgeDistance);
  fill *= 1.0 - smoothstep(mountain.radius - pixel, mountain.radius, abs(mountain.localX));
  let mistWidth: f32 = mix(0.025, 0.16, params.mist) * (1.2 - mountain.depth * 0.4);
  fill *= smoothstep(mountain.base - 0.005, mountain.base + mistWidth, p.y);
  if (fill <= 0.001) { return color; }

  let altitude: f32 = clamp((p.y - mountain.base) / max(top - mountain.base, 0.005), 0.0, 1.0);
  let face: vec2f = vec2f(mountain.localX * 9.0, (p.y - mountain.base) * 7.0);
  let wash: f32 = fbm(face + vec2f(mountain.cell * 0.83, f32(layer)), mountain.salt + 3u, seed);
  let side: f32 = clamp(mountain.localX / mountain.radius * 0.5 + 0.5, 0.0, 1.0);
  let shade: f32 = 0.025 + (0.09 + mountain.depth * 0.38) * wash * (0.3 + side * 0.7);
  let atmosphere: f32 = mix(1.0 - params.mist * 0.78, 1.0, mountain.depth);

  // Broken, gently warped vertical strokes approximate the original short
  // tapered contour ribbons. A second contour family follows the ridges.
  let creaseField: f32 = mountain.localX * (25.0 + mountain.depth * 12.0)
                    + (p.y - mountain.base) * (2.0 + side * 6.0)
                    + noiseAt(face * 1.8, mountain.salt + 4u, seed) * 2.1 + wash * 1.1;
  let creaseWidth: f32 = (25.0 + mountain.depth * 12.0) * pixel;
  var crease: f32 = line(fract(creaseField) - 0.5, 0.012, creaseWidth);
  let broken: f32 = smoothstep(0.35, 0.66, noiseAt(vec2f(floor(creaseField) * 1.7,
                                                   (p.y - mountain.base) * 42.0), mountain.salt + 5u, seed));
  crease *= broken * smoothstep(0.05, 0.3, altitude) * (0.6 + side * 0.4);
  let contourField: f32 = altitude * (12.0 + mountain.depth * 7.0) + wash * 0.8;
  var contour: f32 = line(fract(contourField) - 0.5, 0.008,
                       pixel * (12.0 + mountain.depth * 7.0) / max(top - mountain.base, 0.04));
  contour *= smoothstep(0.65, 0.8, noiseAt(face * 3.2, mountain.salt + 6u, seed));
  let edge: f32 = line(edgeDistance, 0.00035 + mountain.depth * 0.00035, pixel);
  var ink: f32 = shade + crease * (0.1 + mountain.depth * 0.24) + contour * 0.025 + edge * 0.42;
  ink *= atmosphere * params.inkDensity;
  let mountainPaper: vec3f = mix(paper, params.ink, clamp(ink, 0.0, 0.92));
  color = mix(color, mountainPaper, fill);

  if (mountain.depth > 0.25 && params.vegetation > 0.0) {
    let treeSpan: f32 = 0.105 + (1.0 - mountain.depth) * 0.035;
    let treeCell: f32 = floor(mountain.localX / treeSpan);
    let treeKey: vec2i = vec2i(i32(mountain.cell) * 53 + i32(treeCell), i32(layer));
    let treeChoice: f32 = randomAt(treeKey, mountain.salt + 8u, seed);
    let treeX: f32 = (treeCell + 0.5) * treeSpan;
    let treeTop: f32 = mountainHeight(mountain, treeX, params);
    let rootY: f32 = mountain.base + treeTop * (0.22 + randomAt(treeKey, mountain.salt + 9u, seed) * 0.5);
    let treeHeight: f32 = (0.025 + randomAt(treeKey, mountain.salt + 11u, seed) * 0.055) * (0.6 + mountain.depth * 0.4);
    if (treeChoice < params.vegetation * 0.82 && treeTop > 0.065) {
      let treeSalt: u32 = mountain.salt + 10u + bitcast<u32>(treeKey.x);
      let treePoint: vec2f = vec2f(mountain.localX - treeX, p.y - rootY);
      var foliage: f32 = tree(treePoint, treeHeight, treeSalt, pixel, seed);
      foliage = max(foliage, tree(treePoint - vec2f(0.029, -0.006), treeHeight * 0.56,
                                 treeSalt + 51u, pixel, seed));
      foliage = max(foliage, tree(treePoint - vec2f(-0.027, 0.003), treeHeight * 0.48,
                                 treeSalt + 79u, pixel, seed));
      color = mix(color, params.ink, foliage * fill * atmosphere * params.inkDensity * 0.78);
    }
  }

  if (mountain.depth > 0.65 && randomAt(mountain.key, mountain.salt + 12u, seed) > 0.73) {
    let houseX: f32 = (randomAt(mountain.key, mountain.salt + 13u, seed) - 0.5) * mountain.radius;
    let houseY: f32 = mountain.base + mountainHeight(mountain, houseX, params) * 0.2;
    let levels = select(1.0, 3.0, randomAt(mountain.key, mountain.salt + 14u, seed) > 0.75);
    let building: vec2f = pavilion(vec2f(mountain.localX - houseX, p.y - houseY), levels, pixel);
    color = mix(color, paper, building.x * fill * 0.92);
    color = mix(color, params.ink, building.y * fill * atmosphere * params.inkDensity * 0.73);
  }
  return color;
}
