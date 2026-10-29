# Accepted upstream outputs

These are data fixtures, not a second implementation. They were captured from
LingDong-/shan-shui-inf commit `9f754d2b2e73495db7883d4d4055a7b0903b0454`, whose
`index.html` Git blob is `f0d1da751455f99b46756fcbdde8b02420f27d31`. The source hash
was checked before capture. The independent VM/observation harnesses used for
capture are preserved in this repository's history at
`903f8516df3c94980773014f1479717d7296ebc5`; they are no longer test dependencies.
All expected values came from upstream execution, not the GPU port.

- `context.json`: original PRNG sequence hashes, lazy Perlin samples, noise-table
  hash, helper results, and final random states. The test specifies the calls and
  their order, including reseeding and independent-instance checks.
- `scenes.json`: two seeds, four ordered views each, paper random-draw hashes,
  planner/chunk state hashes, command counts, and ordered drawing-signature hashes.
  Signatures cover paint, polygon coordinates, stroke centerlines and widths,
  blob profiles, texture grids/sampling parameters, and random offsets. Original
  plaque positions are compared as glyph tokens because the port uses a different
  licensed font. Hashes use SHA-256 over `JSON.stringify` output, in traversal order.
- `gpu.json`: 260 noise inputs/results and 18 primitive control/expected-point
  cases (448 output points). Repeated texture grids are shared by index. The 4096
  noise-table values are the original table rounded to GPU float32, stored as
  base64-encoded little-endian bytes. The expected noise values remain the
  original double-precision outputs; GPU tolerances are unchanged.

`docs/images/original-1234.png` is the accepted 1200×700 original image used by
`npm run compare:reference`. The other historical full-image parity results are
recorded in `docs/verification.md`.

Tests run offline after dependency installation and never regenerate expected
values from production code. An intentional change to these baselines needs an
independent upstream capture from the recorded revision and review of the
changed results; do not update hashes merely to make a failing test pass.
These test fixtures are excluded from the npm package.
