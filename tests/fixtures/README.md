# Independent construction expectations

Tests consume frozen CPU-captured outputs. No upstream library or second CPU
landscape implementation executes in production or acceptance tests.

- `gpu.json`: the original 4096-value noise table, 260 noise samples and 18 brush
  cases with 448 expected points. [upstream.json](upstream.json) records the
  pinned upstream and original capture revisions.
- `construction.json`: tree geometry and island placement, with source hashes
  and capture provenance. See [construction.md](construction.md).
- `controlled-trees.json`: complete ordered historical CPU output for tree styles
  4–6 and 8 under constant random input, closing the geometry-proof gap left by
  changed random-consumption order. Explicit recapture tooling is development-only.
- `gpu-terrain.json`: nine fixed-parameter mountain, island, distant-ridge and
  rock cases, including ordered brushes and queued child descriptions.
- `gpu-motifs.json`: thirteen fixed-parameter architectural, figure, boat and
  water cases plus three intentional overflow cases.

The newer fixtures were captured from the previously verified CPU recipes at
commit `60e75d4`, using the explicitly approved GPU-compatible random stream and
a fixed noise table. They establish construction behavior independently of the
new WGSL implementation. Their provenance records the source files and hashes.

The old global PRNG, whole-scene seed hashes and copied CPU factories were
removed when generation moved to GPU object streams. A text seed now has a new
layout; a whole-image difference against the old seed is not a raster error.
The original studies and image remain in [the verification report](../../docs/verification.md).

Tests do not regenerate expected outputs. Changes require an independent
capture and review; never replace expected values with the implementation's
output merely to make a test pass. Fixtures are excluded from the npm package.
