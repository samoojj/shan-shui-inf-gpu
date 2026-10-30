// Independent integer streams remove scheduling dependencies between objects.
export fn hash(value: u32) -> u32 {
  var result = value;
  result = (result ^ (result >> 16u)) * 0x7feb352du;
  result = (result ^ (result >> 15u)) * 0x846ca68bu;
  return result ^ (result >> 16u);
}

export fn sampleRandom(state: ptr<function, u32>) -> f32 {
  var value = *state;
  value ^= value << 13u;
  value ^= value >> 17u;
  value ^= value << 5u;
  *state = value;
  return f32(value >> 8u) / 16777216.0;
}
