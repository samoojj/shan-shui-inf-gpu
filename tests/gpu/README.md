# Native GPU primitive checks

See the [verification guide](../../docs/verification.md) for commands, adapter
setup, tolerances, measured results and artifact paths.

The runner `tests/gpu-primitives.mjs` assembles independent probes:

- `noise.mjs` evaluates the production noise shader against captured upstream
  values, including signs, fractions, three dimensions and wrapped coordinates.
- `coordinates.mjs` uses the production packer and compute shader to compare
  points and bounds. Cases exercise pointed endpoints, one-point strokes,
  repeated points, angle wrapping, custom profiles, rotations, noise extremes
  and reversed texture interpolation.
- `raster.mjs` renders synthetic commands that isolate fill/stroke behavior.
- `fixtures.mjs` decodes the [accepted data](../fixtures/README.md), rehydrating
  shared contour grids. It contains no alternate implementation.

Native readback is test instrumentation. Production rendering does not read
brush vertices or image pixels back to JavaScript.
