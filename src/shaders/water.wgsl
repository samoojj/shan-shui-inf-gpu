// River extent, mountain-foot offset, ripples, and boats share one layout.
import { Params } from "./params.wgsl";
import { line, segment, randomAt } from "./painting.wgsl";

export struct WaterLayout {
  rippleTop: f32,
  mountainOffset: f32,
  boatY: f32,
}

export fn waterLayout(water: f32) -> WaterLayout {
  return WaterLayout(0.12 + water * 0.36, water * 0.22, 0.025 + water * 0.1);
}

fn boat(p: vec2f, pixel: f32) -> f32 {
  let q: vec2f = p / 0.07;
  let aa: f32 = pixel / 0.07;
  if (abs(q.x) > 1.2 || q.y < -0.2 || q.y > 1.0) { return 0.0; }
  let hullY: f32 = -0.1 + q.x * q.x * 0.11;
  var ink: f32 = line(q.y - hullY, 0.025, aa) * (1.0 - smoothstep(0.9, 1.05, abs(q.x)));
  ink = max(ink, line(q.y - hullY + 0.055, 0.02, aa) * step(abs(q.x), 0.8));
  ink = max(ink, line(segment(q, vec2f(-0.1, 0.0), vec2f(-0.16, 0.45)), 0.035, aa));
  ink = max(ink, line(length(q - vec2f(-0.16, 0.52)), 0.065, aa));
  ink = max(ink, line(q.y - 0.61 + abs(q.x + 0.16) * 0.45, 0.025, aa)
                * step(abs(q.x + 0.16), 0.17));
  ink = max(ink, line(segment(q, vec2f(-0.23, 0.32), vec2f(0.75, -0.12)), 0.013, aa));
  return ink;
}

export fn paintRipples(
  p: vec2f, pixel: f32, inputColor: vec3f, water: WaterLayout, params: Params,
) -> vec3f {
  var color = inputColor;
  let seed = params.seed;
  // Sparse ink ripples leave the river as negative space on the paper.
  let waterTop: f32 = water.rippleTop;
  if (params.water > 0.0 && p.y > -0.04 && p.y < waterTop) {
    let grid: vec2f = vec2f(0.22, 0.025);
    let cell: vec2i = vec2i(floor(p / grid));
    let local: vec2f = p - (vec2f(cell) + vec2f(0.5)) * grid;
    let chance: f32 = randomAt(cell, 10u, seed);
    let rippleY: f32 = (randomAt(cell, 11u, seed) - 0.5) * grid.y * 0.85;
    let rippleX: f32 = local.x - (randomAt(cell, 12u, seed) - 0.5) * grid.x * 0.3;
    var ripple: f32 = line(local.y - rippleY + sin(rippleX * 28.0 + chance * 12.0) * 0.0009,
                        0.00025, pixel);
    ripple *= 1.0 - smoothstep(0.015 + chance * 0.045, 0.025 + chance * 0.045, abs(rippleX));
    ripple *= step(0.63, chance) * (1.0 - smoothstep(waterTop * 0.45, waterTop, p.y));
    color = mix(color, params.ink, ripple * params.water * 0.23 * params.inkDensity);
  }

  return color;
}

export fn paintBoats(
  p: vec2f, pixel: f32, inputColor: vec3f, water: WaterLayout, params: Params,
) -> vec3f {
  var color = inputColor;
  let seed = params.seed;
  if (params.water > 0.05) {
    let cell: f32 = floor(p.x / 2.7);
    let key: vec2i = vec2i(i32(cell), 0);
    if (randomAt(key, 7001u, seed) > 0.58) {
      let center: vec2f = vec2f((cell + 0.25 + randomAt(key, 7002u, seed) * 0.5) * 2.7,
                         water.boatY);
      let silhouette: f32 = boat(p - center, pixel);
      color = mix(color, params.ink, silhouette * params.inkDensity * 0.8);
    }
  }
  return color;
}
