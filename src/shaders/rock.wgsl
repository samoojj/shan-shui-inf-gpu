import { Writer, Path, Paint, reservePath, setPoint, point, translatePath, polygon, stroke, texturedGrid, noise, ink, white, transparent } from "./construction.wgsl";

export fn rock(writer: ptr<function, Writer>, origin: vec2f, size: vec2f, seedCoordinate: f32, shade: f32) {
  let grid = reservePath(writer, 500u);
  if ((*writer).overflow != 0u) { return; }
  for (var row = 0u; row < 10u; row++) {
    var variation: array<f32, 50>;
    for (var column = 0u; column < 50u; column++) { variation[column] = noise(vec3f(f32(row), f32(column) * 0.2, seedCoordinate)); }
    let difference = variation[49] - variation[0];
    var minimum = 100.0; var maximum = -100.0;
    for (var column = 0u; column < 50u; column++) {
      variation[column] += difference * f32(49u - column) / 49.0;
      minimum = min(minimum, variation[column]); maximum = max(maximum, variation[column]);
    }
    for (var column = 0u; column < 50u; column++) {
      let angle = f32(column) / 50.0 * 6.283185307179586 - 1.570796326794897;
      let direction = vec2f(cos(angle), sin(angle));
      let radius = size.x * size.y / length(size.yx * direction) * (0.7 + 0.3 * (variation[column] - minimum) / max(maximum - minimum, 1e-8));
      var position = vec2f(direction.x, -direction.y) * radius * (1.0 - f32(row) / 10.0);
      if (angle > 3.141592653589793 || angle < 0.0) { position.y *= 0.2; }
      position.y += size.y * f32(row) / 10.0 * 0.2;
      setPoint(grid, row * 50u + column, position);
    }
  }
  let mask = reservePath(writer, 51u);
  for (var column = 0u; column < 50u; column++) { setPoint(mask, column, origin + point(grid, column)); }
  setPoint(mask, 50u, origin);
  polygon(writer, mask, Paint(white(), transparent(), 0.0));
  stroke(writer, translatePath(writer, Path(grid.offset, 50u), origin), ink(0.3), 3.0, 0u, 1.0, 1.0);
  texturedGrid(writer, grid, 10u, 50u, origin, 40u, 3.0, 0.2, shade, 3u, -1.0);
}
