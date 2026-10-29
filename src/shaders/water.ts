/** Own the river's layout and marks, including the placement relationship
 * between open water, mountain feet, and boats. Composition supplies ordering.
 */
export const WATER_GLSL: string = `
struct WaterLayout {
  float rippleTop;
  float mountainOffset;
  float boatY;
};

WaterLayout waterLayout() {
  return WaterLayout(0.12 + uWater * 0.36, uWater * 0.22, 0.025 + uWater * 0.1);
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

vec3 paintRipples(vec2 p, float pixel, vec3 color, WaterLayout water) {
  // Sparse ink ripples leave the river as negative space on the paper.
  float waterTop = water.rippleTop;
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

  return color;
}

vec3 paintBoats(vec2 p, float pixel, vec3 color, WaterLayout water) {
  if (uWater > 0.05) {
    float cell = floor(p.x / 2.7);
    ivec2 key = ivec2(int(cell), 0);
    if (randomAt(key, 7001u) > 0.58) {
      vec2 center = vec2((cell + 0.25 + randomAt(key, 7002u) * 0.5) * 2.7,
                         water.boatY);
      float silhouette = boat(p - center, pixel);
      color = mix(color, uInk, silhouette * uInkDensity * 0.8);
    }
  }
  return color;
}
`;
