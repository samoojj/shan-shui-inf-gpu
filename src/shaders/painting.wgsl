// Seeded fields, brush distances, and paper; no bound resources.

export const PI: f32 = 3.141592653589793;

// Integer hashing preserves every bit of the caller's seed. Negative world
// cells use the same two's-complement conversion on every render.
fn hashBits(value: u32) -> u32 {
  var x = value;
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  return x ^ (x >> 16u);
}
export fn randomAt(cell: vec2i, salt: u32, seed: u32) -> f32 {
  let h: u32 = hashBits(bitcast<u32>(cell.x) ^ hashBits(bitcast<u32>(cell.y) + salt) ^ seed);
  return f32(h >> 8u) * (1.0 / 16777216.0);
}
export fn noiseAt(p: vec2f, salt: u32, seed: u32) -> f32 {
  let cell: vec2i = vec2i(floor(p));
  var f: vec2f = fract(p);
  f = f * f * (vec2f(3.0) - 2.0 * f);
  return mix(mix(randomAt(cell, salt, seed), randomAt(cell + vec2i(1, 0), salt, seed), f.x),
             mix(randomAt(cell + vec2i(0, 1), salt, seed), randomAt(cell + vec2i(1), salt, seed), f.x), f.y);
}
export fn fbm(p: vec2f, salt: u32, seed: u32) -> f32 {
  return noiseAt(p, salt, seed) * 0.58
       + noiseAt(p * 2.03 + vec2f(17.1), salt, seed) * 0.28
       + noiseAt(p * 4.11 + vec2f(31.7), salt, seed) * 0.14;
}
export fn line(distanceToLine: f32, width: f32, pixel: f32) -> f32 {
  return 1.0 - smoothstep(width, width + pixel, abs(distanceToLine));
}
export fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab: vec2f = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

export fn paperColor(p: vec2f, paper: vec3f, seed: u32) -> vec3f {
  let grain: f32 = randomAt(vec2i(floor(p * 1700.0)), 981u, seed) - 0.5;
  let fiber: f32 = noiseAt(p * vec2f(38.0, 310.0), 911u, seed) - 0.5;
  return clamp(paper + vec3f(grain * 0.018 + fiber * 0.009), vec3f(0.0), vec3f(1.0));
}
