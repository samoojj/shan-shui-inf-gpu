# Native GPU acceptance

Run `npm run test:gpu`. See [verification](../../docs/verification.md) for device
setup, tolerances, results and artifacts. An unavailable device fails the run.

The runner assembles independent probes:

- `noise.mjs`: original four-octave interpolation against captured noise values.
- `coordinates.mjs`: GPU brush expansion and bounds from captured control data.
  The fixture encoder in `tests/helpers` is not shipped with the library.
- `raster.mjs`: white masks, ordered blending, winding, open strokes and joins.
- `construction.mjs`: eight tree styles, captured tree coordinates, 96 island
  layouts, iterative recursion, determinism and command/control/queue overflow.
- `terrain.mjs`: mountain grids and vegetation, plateau geometry, distant
  triangulation and rock contours against nine independent CPU captures.
- `motifs.mjs`: architecture, figures, boats, water, plaque geometry and painter
  order against thirteen captured constructions, plus intentional overflows.

Native geometry readback is test instrumentation. Production reads only three
16-byte allocation summaries when a seed or chunk range needs generation.
