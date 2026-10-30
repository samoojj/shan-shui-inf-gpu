import { p5Noise } from "./noise.wgsl";

export fn originalAngle(delta: vec2f) -> f32 {
  // JavaScript defines atan2(+0,+0) as zero; native WGSL may differ.
  if (all(delta == vec2f(0.0))) { return 0.0; }
  return atan2(delta.y, delta.x);
}

export fn leafNoise(phase: f32, table: ptr<storage, array<f32>, read>) -> array<f32, 21> {
  var samples: array<f32, 21>;
  for (var index = 0u; index < 21u; index++) { samples[index] = p5Noise(vec3f(f32(index) * 0.05, phase, 0.0), table); }
  let difference = samples[20] - samples[0];
  var minimum = 100.0; var maximum = -100.0;
  for (var index = 0u; index < 21u; index++) {
    samples[index] += difference * f32(20u - index) / 20.0;
    minimum = min(minimum, samples[index]); maximum = max(maximum, samples[index]);
  }
  for (var index = 0u; index < 21u; index++) { samples[index] = (samples[index] - minimum) / (maximum - minimum); }
  return samples;
}

export fn leafPoint(index: u32, length: f32, width: f32, profile: f32, angle: f32, noiseAmount: f32, sample: f32) -> vec2f {
  let position = f32(index) / 20.0 * 2.0;
  let longitudinal = length * 0.5 - abs(position - 1.0) * length;
  let transverse = profile * width * 0.5;
  let direction = originalAngle(vec2f(longitudinal, transverse)) + angle;
  let radius = sqrt(longitudinal * longitudinal + transverse * transverse);
  let variation = sample * noiseAmount + (1.0 - noiseAmount);
  return vec2f(cos(direction), sin(direction)) * radius * variation;
}
