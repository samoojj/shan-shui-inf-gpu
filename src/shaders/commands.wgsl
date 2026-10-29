// Storage ABI: 128 bytes per brush. Construction writes this data on the GPU.
export struct Brush {
  kind: u32,
  controlOffset: u32,
  controlCount: u32,
  pointOffset: u32,
  fill: vec4f,
  edge: vec4f,
  width: f32,
  noiseAmount: f32,
  noiseOffset: f32,
  outlineWidth: f32,
  origin: vec2f,
  length: f32,
  angle: f32,
  layer: f32,
  firstColumn: f32,
  columns: f32,
  jitter: f32,
  pointCount: u32,
  profileOffset: u32,
  padding: vec2u,
  reserved: vec4f,
}

export struct View {
  resolution: vec2f,
  span: vec2f,
  offset: vec2f,
}

// A whole landscape object, never a sampled CPU path. 80-byte storage stride.
export struct SceneObject {
  origin: vec2f,
  size: vec2f,
  seed: u32,
  kind: u32,
  style: u32,
  flags: u32,
  rotation: f32,
  perspective: f32,
  bend: f32,
  depth: f32,
  commandBase: u32,
  commandCapacity: u32,
  controlBase: u32,
  controlCapacity: u32,
  color: vec4f,
}

export struct ObjectCounts {
  commands: u32,
  controls: u32,
  points: u32,
  overflow: u32,
}
