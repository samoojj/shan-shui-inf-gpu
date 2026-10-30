// p5's original four-octave interpolation. Production generates the 4096 table
// values on the GPU; acceptance tests can supply the captured upstream table.
fn scaledCosine(value: f32) -> f32 {
  return 0.5 * (1.0 - cos(value * 3.141592653589793));
}

export fn p5Noise(position: vec3f, table: ptr<storage, array<f32>, read>) -> f32 {
  let positive = abs(position);
  let integer = floor(positive);
  // Only these low bits survive the original JavaScript bitwise lookup. Reduce
  // before conversion so large world coordinates retain the same wrap period.
  var cell = vec3u(integer % vec3f(4096.0));
  var fraction = positive - integer;
  var value = 0.0;
  var amplitude = 0.5;

  for (var octave = 0u; octave < 4u; octave++) {
    var offset = cell.x + (cell.y << 4u) + (cell.z << 8u);
    let blendX = scaledCosine(fraction.x);
    let blendY = scaledCosine(fraction.y);

    var near = (*table)[offset & 4095u];
    near += blendX * ((*table)[(offset + 1u) & 4095u] - near);
    var far = (*table)[(offset + 16u) & 4095u];
    far += blendX * ((*table)[(offset + 17u) & 4095u] - far);
    near += blendY * (far - near);

    offset += 256u;
    far = (*table)[offset & 4095u];
    far += blendX * ((*table)[(offset + 1u) & 4095u] - far);
    var diagonal = (*table)[(offset + 16u) & 4095u];
    diagonal += blendX * ((*table)[(offset + 17u) & 4095u] - diagonal);
    far += blendY * (diagonal - far);
    near += scaledCosine(fraction.z) * (far - near);
    value += near * amplitude;

    amplitude *= 0.5;
    cell <<= vec3u(1u);
    fraction *= 2.0;
    let carry = vec3u(floor(fraction));
    cell += carry;
    fraction -= vec3f(carry);
  }
  return value;
}
