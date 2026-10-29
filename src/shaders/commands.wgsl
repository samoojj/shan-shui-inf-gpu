// Eight 16-byte fields match the packed CPU command buffer (128-byte stride).
// The fields carry original control paths and random decisions, never expanded brushes.
export struct Job {
  header: vec4u,     // kind, input offset, centerline count, output offset
  fill: vec4f,
  edge: vec4f,
  brush: vec4f,    // width, noise amount, random noise offset, SVG outline width
  origin: vec4f,   // x/y offset, blob length, blob angle
  texture: vec4f,  // contour layer, first column, column count, jitter amplitude
  extra: vec4u,    // output count, blob profile offset, reserved, reserved
  reserved: vec4f,
}

export struct View {
  resolution: vec2f,
  span: vec2f,
  offset: vec2f,
}
