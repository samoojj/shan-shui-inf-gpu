/** Source composition only: no runtime shader loader, geometry upload, or
 * extra render pass. Scene modules own their layout and painting rules.
 */
import { PAINTING_GLSL } from "./shaders/painting.js";
import { WATER_GLSL } from "./shaders/water.js";
import { MOUNTAINS_GLSL } from "./shaders/mountains.js";

export const VERTEX_SHADER: string = `#version 300 es
precision highp float;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER: string = `#version 300 es
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


${PAINTING_GLSL}
${WATER_GLSL}
${MOUNTAINS_GLSL}

void main() {
  vec2 p = (gl_FragCoord.xy / uResolution * uView + uOffset) * 0.001;
  float pixel = max(uView.x / uResolution.x, uView.y / uResolution.y) * 0.001;
  WaterLayout water = waterLayout();
  vec3 paper = paperColor(p);
  vec3 color = paintRipples(p, pixel, paper, water);
  for (int layer = 0; layer < 8; ++layer) {
    if (layer >= uLayers) break;
    color = paintMountain(p, pixel, paper, color, layer, water);
  }
  color = paintBoats(p, pixel, color, water);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
