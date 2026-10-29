/** A mountain owns its terrain, surface ink, and attached motifs. Its private
 * descriptor is shared by height sampling and painting, so composition never
 * reconstructs mountain-local coordinates or placement rules.
 */
export const MOUNTAINS_GLSL: string = `
struct Mountain {
  float depth;
  uint salt;
  float cell;
  ivec2 key;
  float localX;
  float radius;
  float height;
  float base;
};

// A cosine envelope gives the steep-sided, rounded peaks of the original
// mountain grids. It reaches zero before each cell boundary, so independently
// evaluated world cells join without a moving seam or a chunk cache.
float mountainHeight(Mountain mountain, float x) {
  float envelope = max(0.0, cos(clamp(x / mountain.radius, -1.0, 1.0) * PI * 0.5));
  float detail = fbm(vec2(x * 6.0, mountain.cell * 0.37), mountain.salt);
  return pow(envelope, 0.72) * mountain.height
       * (0.75 + 0.25 * detail + uRoughness * (detail - 0.5) * 0.48);
}

float pine(vec2 p, float height, uint salt, float pixel) {
  vec2 q = p / height;
  if (q.y < -0.02 || q.y > 1.05 || abs(q.x) > 0.48) return 0.0;
  q.x += sin(q.y * 3.0) * 0.045;
  float trunk = line(segment(q, vec2(0.0), vec2(0.025, 0.98)), 0.012, pixel / height);
  float tier = floor(clamp(q.y, 0.0, 0.99) * 5.0);
  float level = (tier + 0.7) / 5.0;
  float variation = randomAt(ivec2(int(tier), q.x < 0.0 ? 0 : 1), salt);
  float reach = ((1.0 - level) * 0.43 + 0.035) * (0.72 + variation * 0.35);
  float branch = line(q.y - level + abs(q.x) * 0.38, 0.025, pixel / height)
               * (1.0 - smoothstep(reach, reach + 0.025, abs(q.x)));
  float needles = line(q.y - level + abs(q.x) * 0.5, 0.07, pixel / height)
                * (1.0 - smoothstep(reach * 0.8, reach + 0.015, abs(q.x)))
                * (0.35 + 0.65 * noiseAt(q * vec2(35.0, 23.0), salt));
  return clamp(max(trunk * 0.8, max(branch, needles)), 0.0, 1.0);
}

float tree(vec2 p, float height, uint salt, float pixel) {
  if (randomAt(ivec2(0), salt) > 0.48) return pine(p, height, salt, pixel);
  vec2 q = p / height;
  if (q.y < -0.02 || q.y > 1.1 || abs(q.x) > 0.46) return 0.0;
  float aa = pixel / height;
  float trunk = line(segment(q, vec2(0.0), vec2(0.04, 0.81)), 0.014, aa);
  trunk = max(trunk, line(segment(q, vec2(0.02, 0.3), vec2(-0.24, 0.7)), 0.011, aa));
  trunk = max(trunk, line(segment(q, vec2(0.02, 0.45), vec2(0.27, 0.85)), 0.009, aa));
  float canopy = min(length(q - vec2(-0.19, 0.66)) - 0.22,
                     length(q - vec2(0.17, 0.76)) - 0.24);
  canopy = min(canopy, length(q - vec2(-0.01, 0.86)) - 0.2);
  float stipple = noiseAt(q * 28.0, salt);
  canopy += (stipple - 0.5) * 0.11;
  float leaves = (1.0 - smoothstep(-aa, aa, canopy)) * (0.22 + stipple * 0.58);
  leaves = max(leaves, line(canopy, 0.009, aa) * 0.5);
  return max(trunk, leaves);
}

// Returns paper occlusion and ink separately, keeping walls light against a
// mountain face instead of drawing a solid black architectural icon.
vec2 pavilion(vec2 p, float levels, float pixel) {
  vec2 q = p / 0.045;
  float aa = pixel / 0.045;
  if (q.y < -0.1 || q.y > 3.1 || abs(q.x) > 1.2) return vec2(0.0);
  float ink = 0.0;
  float paper = 0.0;
  for (int k = 0; k < 3; ++k) {
    float tier = float(k);
    if (tier >= levels) break;
    float floorY = tier * 0.7;
    float width = 0.78 - tier * 0.17;
    float x = abs(q.x);
    float wall = (1.0 - smoothstep(width * 0.69, width * 0.69 + aa, x))
               * smoothstep(floorY - aa, floorY, q.y)
               * (1.0 - smoothstep(floorY + 0.48, floorY + 0.48 + aa, q.y));
    paper = max(paper, wall);
    ink = max(ink, line(x - width * 0.66, 0.014, aa)
                  * step(floorY, q.y) * step(q.y, floorY + 0.48));
    ink = max(ink, line(q.y - floorY, 0.018, aa) * step(x, width * 0.8));
    float roofY = floorY + 0.69 - x * 0.33 + pow(x / width, 3.0) * 0.13;
    ink = max(ink, line(q.y - roofY, 0.027, aa) * (1.0 - smoothstep(width, width + aa, x)));
    ink = max(ink, line(q.y - roofY + 0.11, 0.012, aa) * step(x, width));
    float door = line(q.x, 0.065, aa) * step(floorY, q.y) * step(q.y, floorY + 0.3);
    ink = max(ink, door * 0.65);
  }
  ink = max(ink, line(segment(q, vec2(0.0, levels * 0.7 - 0.01),
                             vec2(0.0, levels * 0.7 + 0.16)), 0.013, aa));
  return vec2(paper, ink);
}

Mountain mountainAt(vec2 p, int layer, WaterLayout water) {
  float depth = uLayers > 1 ? float(layer) / float(uLayers - 1) : 0.65;
  uint salt = uint(layer) * 1013u + 137u;
  float span = 1.15 + depth * 0.9;
  float worldX = p.x + float(layer) * 0.719;
  float cell = floor(worldX / span);
  ivec2 key = ivec2(int(cell), layer);
  float localX = worldX - (cell + 0.5) * span;
  float radius = span * (0.38 + randomAt(key, salt) * 0.105);
  float height = 0.34 + randomAt(key, salt + 1u) * (0.32 + depth * 0.06);
  float base = 0.32 - depth * 0.26 + water.mountainOffset;
  base += (randomAt(key, salt + 2u) - 0.5) * 0.045;
  return Mountain(depth, salt, cell, key, localX, radius, height, base);
}

vec3 paintMountain(vec2 p, float pixel, vec3 paper, vec3 color, int layer, WaterLayout water) {
  Mountain mountain = mountainAt(p, layer, water);
  float top = mountain.base + mountainHeight(mountain, mountain.localX);
  float edgeDistance = p.y - top;
  float fill = 1.0 - smoothstep(-pixel, pixel, edgeDistance);
  fill *= 1.0 - smoothstep(mountain.radius - pixel, mountain.radius, abs(mountain.localX));
  float mistWidth = mix(0.025, 0.16, uMist) * (1.2 - mountain.depth * 0.4);
  fill *= smoothstep(mountain.base - 0.005, mountain.base + mistWidth, p.y);
  if (fill <= 0.001) return color;

  float altitude = clamp((p.y - mountain.base) / max(top - mountain.base, 0.005), 0.0, 1.0);
  vec2 face = vec2(mountain.localX * 9.0, (p.y - mountain.base) * 7.0);
  float wash = fbm(face + vec2(mountain.cell * 0.83, float(layer)), mountain.salt + 3u);
  float side = clamp(mountain.localX / mountain.radius * 0.5 + 0.5, 0.0, 1.0);
  float shade = 0.025 + (0.09 + mountain.depth * 0.38) * wash * (0.3 + side * 0.7);
  float atmosphere = mix(1.0 - uMist * 0.78, 1.0, mountain.depth);

  // Broken, gently warped vertical strokes approximate the original short
  // tapered contour ribbons. A second contour family follows the ridges.
  float creaseField = mountain.localX * (25.0 + mountain.depth * 12.0)
                    + (p.y - mountain.base) * (2.0 + side * 6.0)
                    + noiseAt(face * 1.8, mountain.salt + 4u) * 2.1 + wash * 1.1;
  float creaseWidth = (25.0 + mountain.depth * 12.0) * pixel;
  float crease = line(fract(creaseField) - 0.5, 0.012, creaseWidth);
  float broken = smoothstep(0.35, 0.66, noiseAt(vec2(floor(creaseField) * 1.7,
                                                   (p.y - mountain.base) * 42.0), mountain.salt + 5u));
  crease *= broken * smoothstep(0.05, 0.3, altitude) * (0.6 + side * 0.4);
  float contourField = altitude * (12.0 + mountain.depth * 7.0) + wash * 0.8;
  float contour = line(fract(contourField) - 0.5, 0.008,
                       pixel * (12.0 + mountain.depth * 7.0) / max(top - mountain.base, 0.04));
  contour *= smoothstep(0.65, 0.8, noiseAt(face * 3.2, mountain.salt + 6u));
  float edge = line(edgeDistance, 0.00035 + mountain.depth * 0.00035, pixel);
  float ink = shade + crease * (0.1 + mountain.depth * 0.24) + contour * 0.025 + edge * 0.42;
  ink *= atmosphere * uInkDensity;
  vec3 mountainPaper = mix(paper, uInk, clamp(ink, 0.0, 0.92));
  color = mix(color, mountainPaper, fill);

  if (mountain.depth > 0.25 && uVegetation > 0.0) {
    float treeSpan = 0.105 + (1.0 - mountain.depth) * 0.035;
    float treeCell = floor(mountain.localX / treeSpan);
    ivec2 treeKey = ivec2(int(mountain.cell) * 53 + int(treeCell), layer);
    float treeChoice = randomAt(treeKey, mountain.salt + 8u);
    float treeX = (treeCell + 0.5) * treeSpan;
    float treeTop = mountainHeight(mountain, treeX);
    float rootY = mountain.base + treeTop * (0.22 + randomAt(treeKey, mountain.salt + 9u) * 0.5);
    float treeHeight = (0.025 + randomAt(treeKey, mountain.salt + 11u) * 0.055) * (0.6 + mountain.depth * 0.4);
    if (treeChoice < uVegetation * 0.82 && treeTop > 0.065) {
      uint treeSalt = mountain.salt + 10u + uint(treeKey.x);
      vec2 treePoint = vec2(mountain.localX - treeX, p.y - rootY);
      float foliage = tree(treePoint, treeHeight, treeSalt, pixel);
      foliage = max(foliage, tree(treePoint - vec2(0.029, -0.006), treeHeight * 0.56,
                                 treeSalt + 51u, pixel));
      foliage = max(foliage, tree(treePoint - vec2(-0.027, 0.003), treeHeight * 0.48,
                                 treeSalt + 79u, pixel));
      color = mix(color, uInk, foliage * fill * atmosphere * uInkDensity * 0.78);
    }
  }

  if (mountain.depth > 0.65 && randomAt(mountain.key, mountain.salt + 12u) > 0.73) {
    float houseX = (randomAt(mountain.key, mountain.salt + 13u) - 0.5) * mountain.radius;
    float houseY = mountain.base + mountainHeight(mountain, houseX) * 0.2;
    float levels = randomAt(mountain.key, mountain.salt + 14u) > 0.75 ? 3.0 : 1.0;
    vec2 building = pavilion(vec2(mountain.localX - houseX, p.y - houseY), levels, pixel);
    color = mix(color, paper, building.x * fill * 0.92);
    color = mix(color, uInk, building.y * fill * atmosphere * uInkDensity * 0.73);
  }
  return color;
}
`;
