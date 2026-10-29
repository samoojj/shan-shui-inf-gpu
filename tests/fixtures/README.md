# Accepted upstream outputs

[upstream.json](upstream.json) records the verified source and capture-harness
revisions for the three acceptance fixtures below. They contain independent
upstream outputs, not a second implementation. The source hash was checked
before capture; the old VM/observation harness is preserved in git history.

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

`motifs.json` is separate regression evidence: ordered command hashes and final
random states captured from the accepted port before deduplication. It covers
all eight trees, building variants/decoration styles, figures and attachments in
both facings, boats, a transmission tower, and terrain across two seeds. It
protects rare recipe paths not reached by the upstream whole-scene fixtures;
it does not claim independent upstream parity.

Image baselines and historical comparison results are documented in the
[verification report](../../docs/verification.md).

Tests run offline after dependency installation and never regenerate expected
values from production code. An intentional change to the upstream acceptance baselines needs an
independent upstream capture from the recorded revision and review of the
changed results; do not update hashes merely to make a failing test pass.
These test fixtures are excluded from the npm package.
