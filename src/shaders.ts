/** All landscape geometry, noise, and brush marks are evaluated on the GPU. */
export const VERTEX_SHADER = `#version 300 es
precision highp float;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform vec2 uView;
uniform vec2 uOffset;
uniform uint uSeed;
uniform int uLayers;
uniform float uRoughness;
uniform float uInkDensity;
uniform float uMist;
uniform float uVegetation;
uniform float uWater;
uniform vec3 uPaper;
uniform vec3 uInk;
out vec4 outColor;

const float PI = 3.141592653589793;

// Integer hashing preserves every bit of the caller's seed. Negative world
// cells use the same two's-complement conversion on every render.
uint hashBits(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  return x ^ (x >> 16u);
}
float randomAt(ivec2 cell, uint salt) {
  uint h = hashBits(uint(cell.x) ^ hashBits(uint(cell.y) + salt) ^ uSeed);
  return float(h >> 8u) * (1.0 / 16777216.0);
}
float noiseAt(vec2 p, uint salt) {
  ivec2 cell = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(randomAt(cell, salt), randomAt(cell + ivec2(1, 0), salt), f.x),
             mix(randomAt(cell + ivec2(0, 1), salt), randomAt(cell + ivec2(1), salt), f.x), f.y);
}
float fbm(vec2 p, uint salt) {
  return noiseAt(p, salt) * 0.58
       + noiseAt(p * 2.03 + 17.1, salt) * 0.28
       + noiseAt(p * 4.11 + 31.7, salt) * 0.14;
}
float line(float distanceToLine, float width, float pixel) {
  return 1.0 - smoothstep(width, width + pixel, abs(distanceToLine));
}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

// A cosine envelope gives the steep-sided, rounded peaks of the original
// mountain grids. It reaches zero before each cell boundary, so independently
// evaluated world cells join without a moving seam or a chunk cache.
float mountainHeight(float x, float radius, float height, float cell, uint salt) {
  float envelope = max(0.0, cos(clamp(x / radius, -1.0, 1.0) * PI * 0.5));
  float detail = fbm(vec2(x * 6.0, cell * 0.37), salt);
  return pow(envelope, 0.72) * height
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

float boat(vec2 p, float pixel) {
  vec2 q = p / 0.07;
  float aa = pixel / 0.07;
  if (abs(q.x) > 1.2 || q.y < -0.2 || q.y > 1.0) return 0.0;
  float hullY = -0.1 + q.x * q.x * 0.11;
  float ink = line(q.y - hullY, 0.025, aa) * (1.0 - smoothstep(0.9, 1.05, abs(q.x)));
  ink = max(ink, line(q.y - hullY + 0.055, 0.02, aa) * step(abs(q.x), 0.8));
  ink = max(ink, line(segment(q, vec2(-0.1, 0.0), vec2(-0.16, 0.45)), 0.035, aa));
  ink = max(ink, line(length(q - vec2(-0.16, 0.52)), 0.065, aa));
  ink = max(ink, line(q.y - 0.61 + abs(q.x + 0.16) * 0.45, 0.025, aa)
                * step(abs(q.x + 0.16), 0.17));
  ink = max(ink, line(segment(q, vec2(-0.23, 0.32), vec2(0.75, -0.12)), 0.013, aa));
  return ink;
}

void main() {
  vec2 p = (gl_FragCoord.xy / uResolution * uView + uOffset) * 0.001;
  float pixel = max(uView.x / uResolution.x, uView.y / uResolution.y) * 0.001;
  float grain = randomAt(ivec2(floor(p * 1700.0)), 981u) - 0.5;
  float fiber = noiseAt(p * vec2(38.0, 310.0), 911u) - 0.5;
  vec3 paper = clamp(uPaper + (grain * 0.018 + fiber * 0.009), 0.0, 1.0);
  vec3 color = paper;

  // Sparse ink ripples leave the river as negative space on the paper.
  float waterTop = 0.12 + uWater * 0.36;
  if (uWater > 0.0 && p.y > -0.04 && p.y < waterTop) {
    vec2 grid = vec2(0.22, 0.025);
    ivec2 cell = ivec2(floor(p / grid));
    vec2 local = p - (vec2(cell) + 0.5) * grid;
    float chance = randomAt(cell, 10u);
    float rippleY = (randomAt(cell, 11u) - 0.5) * grid.y * 0.85;
    float rippleX = local.x - (randomAt(cell, 12u) - 0.5) * grid.x * 0.3;
    float ripple = line(local.y - rippleY + sin(rippleX * 28.0 + chance * 12.0) * 0.0009,
                        0.00025, pixel);
    ripple *= 1.0 - smoothstep(0.015 + chance * 0.045, 0.025 + chance * 0.045, abs(rippleX));
    ripple *= step(0.63, chance) * (1.0 - smoothstep(waterTop * 0.45, waterTop, p.y));
    color = mix(color, uInk, ripple * uWater * 0.23 * uInkDensity);
  }

  for (int i = 0; i < 8; ++i) {
    if (i >= uLayers) break;
    float depth = uLayers > 1 ? float(i) / float(uLayers - 1) : 0.65;
    uint salt = uint(i) * 1013u + 137u;
    float span = 1.15 + depth * 0.9;
    float worldX = p.x + float(i) * 0.719;
    float cell = floor(worldX / span);
    ivec2 key = ivec2(int(cell), i);
    float localX = worldX - (cell + 0.5) * span;
    float radius = span * (0.38 + randomAt(key, salt) * 0.105);
    float height = 0.34 + randomAt(key, salt + 1u) * (0.32 + depth * 0.06);
    float base = 0.32 - depth * 0.26 + uWater * 0.22;
    base += (randomAt(key, salt + 2u) - 0.5) * 0.045;
    float top = base + mountainHeight(localX, radius, height, cell, salt);
    float edgeDistance = p.y - top;
    float fill = 1.0 - smoothstep(-pixel, pixel, edgeDistance);
    fill *= 1.0 - smoothstep(radius - pixel, radius, abs(localX));
    float mistWidth = mix(0.025, 0.16, uMist) * (1.2 - depth * 0.4);
    fill *= smoothstep(base - 0.005, base + mistWidth, p.y);
    if (fill <= 0.001) continue;

    float altitude = clamp((p.y - base) / max(top - base, 0.005), 0.0, 1.0);
    vec2 face = vec2(localX * 9.0, (p.y - base) * 7.0);
    float wash = fbm(face + vec2(cell * 0.83, float(i)), salt + 3u);
    float side = clamp(localX / radius * 0.5 + 0.5, 0.0, 1.0);
    float shade = 0.025 + (0.09 + depth * 0.38) * wash * (0.3 + side * 0.7);
    float atmosphere = mix(1.0 - uMist * 0.78, 1.0, depth);

    // Broken, gently warped vertical strokes approximate the original short
    // tapered contour ribbons. A second contour family follows the ridges.
    float creaseField = localX * (25.0 + depth * 12.0)
                      + (p.y - base) * (2.0 + side * 6.0)
                      + noiseAt(face * 1.8, salt + 4u) * 2.1 + wash * 1.1;
    float creaseWidth = (25.0 + depth * 12.0) * pixel;
    float crease = line(fract(creaseField) - 0.5, 0.012, creaseWidth);
    float broken = smoothstep(0.35, 0.66, noiseAt(vec2(floor(creaseField) * 1.7,
                                                     (p.y - base) * 42.0), salt + 5u));
    crease *= broken * smoothstep(0.05, 0.3, altitude) * (0.6 + side * 0.4);
    float contourField = altitude * (12.0 + depth * 7.0) + wash * 0.8;
    float contour = line(fract(contourField) - 0.5, 0.008,
                         pixel * (12.0 + depth * 7.0) / max(top - base, 0.04));
    contour *= smoothstep(0.65, 0.8, noiseAt(face * 3.2, salt + 6u));
    float edge = line(edgeDistance, 0.00035 + depth * 0.00035, pixel);
    float ink = shade + crease * (0.1 + depth * 0.24) + contour * 0.025 + edge * 0.42;
    ink *= atmosphere * uInkDensity;
    vec3 mountainPaper = mix(paper, uInk, clamp(ink, 0.0, 0.92));
    color = mix(color, mountainPaper, fill);

    if (depth > 0.25 && uVegetation > 0.0) {
      float treeSpan = 0.105 + (1.0 - depth) * 0.035;
      float treeCell = floor(localX / treeSpan);
      ivec2 treeKey = ivec2(int(cell) * 53 + int(treeCell), i);
      float treeChoice = randomAt(treeKey, salt + 8u);
      float treeX = (treeCell + 0.5) * treeSpan;
      float treeTop = mountainHeight(treeX, radius, height, cell, salt);
      float rootY = base + treeTop * (0.22 + randomAt(treeKey, salt + 9u) * 0.5);
      float treeHeight = (0.025 + randomAt(treeKey, salt + 11u) * 0.055) * (0.6 + depth * 0.4);
      if (treeChoice < uVegetation * 0.82 && treeTop > 0.065) {
        uint treeSalt = salt + 10u + uint(treeKey.x);
        vec2 treePoint = vec2(localX - treeX, p.y - rootY);
        float foliage = tree(treePoint, treeHeight, treeSalt, pixel);
        foliage = max(foliage, tree(treePoint - vec2(0.029, -0.006), treeHeight * 0.56,
                                   treeSalt + 51u, pixel));
        foliage = max(foliage, tree(treePoint - vec2(-0.027, 0.003), treeHeight * 0.48,
                                   treeSalt + 79u, pixel));
        color = mix(color, uInk, foliage * fill * atmosphere * uInkDensity * 0.78);
      }
    }

    if (depth > 0.65 && randomAt(key, salt + 12u) > 0.73) {
      float houseX = (randomAt(key, salt + 13u) - 0.5) * radius;
      float houseY = base + mountainHeight(houseX, radius, height, cell, salt) * 0.2;
      float levels = randomAt(key, salt + 14u) > 0.75 ? 3.0 : 1.0;
      vec2 building = pavilion(vec2(localX - houseX, p.y - houseY), levels, pixel);
      color = mix(color, paper, building.x * fill * 0.92);
      color = mix(color, uInk, building.y * fill * atmosphere * uInkDensity * 0.73);
    }
  }

  if (uWater > 0.05) {
    float cell = floor(p.x / 2.7);
    ivec2 key = ivec2(int(cell), 0);
    if (randomAt(key, 7001u) > 0.58) {
      vec2 center = vec2((cell + 0.25 + randomAt(key, 7002u) * 0.5) * 2.7,
                         0.025 + uWater * 0.1);
      float silhouette = boat(p - center, pixel);
      color = mix(color, uInk, silhouette * uInkDensity * 0.8);
    }
  }
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
