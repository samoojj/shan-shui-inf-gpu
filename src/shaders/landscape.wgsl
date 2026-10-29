// Only this entry owns shader resources. vgpu resolves the pure module graph.
import { Params } from "./params.wgsl";
import { paperColor } from "./painting.wgsl";
import { waterLayout, paintRipples, paintBoats } from "./water.wgsl";
import { paintMountain } from "./mountains.wgsl";

@group(0) @binding(0) var<uniform> settings: Params;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // vgpu supplies top-origin UVs; the landscape world has an upward Y axis.
  let worldUV = vec2f(uv.x, 1.0 - uv.y);
  let p = (worldUV * settings.view + settings.offset) * 0.001;
  let pixel = max(settings.view.x / settings.resolution.x, settings.view.y / settings.resolution.y) * 0.001;
  let water = waterLayout(settings.water);
  let paper = paperColor(p, settings.paper, settings.seed);
  var color = paintRipples(p, pixel, paper, water, settings);
  for (var layer = 0u; layer < 8u; layer++) {
    if (layer >= settings.layers) { break; }
    color = paintMountain(p, pixel, paper, color, layer, water, settings);
  }
  color = paintBoats(p, pixel, color, water, settings);
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
