// The entry module owns the binding; pure scene modules receive these values.
export struct Params {
  resolution: vec2f,
  view: vec2f,
  offset: vec2f,
  seed: u32,
  layers: u32,
  roughness: f32,
  inkDensity: f32,
  mist: f32,
  vegetation: f32,
  water: f32,
  paper: vec3f,
  ink: vec3f,
}
