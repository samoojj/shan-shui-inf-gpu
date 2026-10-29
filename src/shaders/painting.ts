/** Private painting vocabulary: seeded fields, stroke distances, and paper.
 * Scene modules share these calculations without exposing them to library callers.
 */
export const PAINTING_GLSL: string = `
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

vec3 paperColor(vec2 p) {
  float grain = randomAt(ivec2(floor(p * 1700.0)), 981u) - 0.5;
  float fiber = noiseAt(p * vec2(38.0, 310.0), 911u) - 0.5;
  return clamp(uPaper + (grain * 0.018 + fiber * 0.009), 0.0, 1.0);
}
`;
