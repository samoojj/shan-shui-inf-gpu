import { p5Noise } from "./noise.wgsl";

struct PaperView { logicalSize: vec2f }
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(3) var<storage, read> paperRandom: array<f32>;
@group(0) @binding(4) var<uniform> paperView: PaperView;

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
  // The upstream CSS paper tile stays screen-aligned while the SVG view pans.
  let tile = vec2u(floor(position.xy * paperView.logicalSize / vec2f(textureDimensions(scene)))) % vec2u(512u);
  let cell = min(tile, vec2u(512u) - tile);
  let base = 245.0 + p5Noise(vec3f(vec2f(cell) * 0.1, 0.0), &noiseTable) * 10.0
    - paperRandom[cell.x * 257u + cell.y] * 20.0;
  let paper = floor(base * vec3f(1.0, 0.95, 0.85) + vec3f(0.5)) / 255.0;
  return vec4f(textureSample(scene, sceneSampler, uv).rgb * paper, 1.0);
}
