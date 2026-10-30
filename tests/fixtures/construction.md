# GPU construction acceptance data

`construction.json` contains independently captured expected outputs. No GPU
outputs were used to create it, and tests never regenerate it from production
shaders.

The source is Lingdong Huang's pinned upstream revision
`9f754d2b2e73495db7883d4d4055a7b0903b0454`, as retained by the faithful CPU recipe
port at repository commit `60e75d4`. SHA-256 digests of the five recipe/helper
files used during capture are embedded in the fixture. The frozen data remains
usable after those CPU recipes are removed.

The authorized random-stream replacement uses xorshift32 with shifts 13, 17,
and 5; each draw is the unsigned high 24 bits divided by 16777216. During tree
capture, the original context's `Math.random` was replaced with this stream,
the original lazy noise table was initialized from state 78901, and the stream
was then reset to 12345678 before invoking each original recipe. The captured
4096-entry table is base64-encoded little-endian float32. The fixed second seed,
904123, exercises all styles' structural checks without asserting old seed
compatibility.

Tree expectations contain 264 original commands: complete styles 1, 2, 3, and
7; the original fractional-detail trunk of style 8; and an additional two-leaf
rim cluster. Polygon coordinates include their original translation. Blob
centers, lengths, widths, rotations, noise phases, profiles, and paint values
are captured. Repeated profiles are shared by index. Stroke colors with zero
outline width are omitted because they are not painted. All 172 style-7 facets
are compared, including their order and centroid-noise colors. Styles 4–6 and
the style-8 branch network use the approved changed random consumption order;
they receive native structural checks rather than a false same-seed parity
claim. Complete recipe comparisons for those four previously uncovered styles
now live in `controlled-trees.json`, described below.

## Controlled complete tree geometry

`controlled-trees.json` adds independent complete ordered CPU drawings for styles
4, 5, 6 and 8. It is captured with every random call fixed at `0.5` or `0.4`, and with the
same captured float32 noise table supplied to the historical p5 implementation.
Constant random input removes consumption-order differences while keeping branch
selection, attachment, bark, twig construction and painter ordering testable.
The style-8 cases include entire recursive branch networks, not just trunks:
`0.5` selects one child at each recursive node and `0.4` selects two. The `0.5`
cases also verify the source bark subdivision's endpoint-alias mutation before
later branches attach.

`node scripts/capture-controlled-trees.mjs` explicitly recaptures these expectations
from the reviewed CPU source at `60e75d4`. That development command requires Git
history and records SHA-256 hashes of all historical recipe/helper sources. It
does not import or execute production WGSL. Acceptance reads only the frozen
fixture and never regenerates its own expected output.

`checkControlledTrees` compiles production tree construction with only the random
leaf function replaced by the same constant in its test-only module map. It
compares every emitted command's kind, control count, painted colors, outline,
translated control coordinates, signed stroke widths, brush noise settings, and
leaf parameters/profiles. The coordinate tolerance remains `0.002` drawing units.
These complete controlled-input proofs complement the existing two random-stream
structural/overflow cases; they do not claim complete same-seed CPU parity.
The eight controlled cases contain 775 ordered commands and compare 28,402
translated coordinate components, in addition to paint and brush parameters.
The observed llvmpipe maximum error is `0.000457764` drawing units.

These tests exposed a source alias dependency absent from the earlier port:
upstream `div()` retains each subdivided run's final point by reference, so bark
jitter moves branch-side controls before later branch attachment. Production now
constructs that bark at the original geometry dependency point, then restores
mask/outline/bark/twig painter order. The spreading tree's child bark uses copied
translated sides upstream, and intentionally does not mutate its silhouette.

Island expectations capture the original `flatDec` layout for 96 seeds,
obtained by hashing consecutive integers starting at 982451653 with the agreed
integer child-seed hash. Original child drawing calls were replaced only at
the capture boundary with descriptor-recording stubs. Each stub consumed one
stream draw, stored that draw times 100 in the descriptor's depth field, and
hashed the resulting state for the child's independent seed. The original
layout code, weighted choices, formulas, argument evaluation, and freshly
sampled loop conditions ran unchanged. The fixture contains all 1,723 ordered
descriptors and each island's exact final random state. Named descriptor columns
are recorded once in `descriptorFields`.

Noninteger expected values are rounded to six decimal places for compactness;
integer fields and random states remain exact. The tests allow absolute error
of `.002` for float32 construction, well below the renderer's `.1` SVG coordinate
rounding step. Expected data must be recaptured independently from the recorded
source if intentionally changed; do not replace it with current shader output.

`checkConstruction(gpu)` in `tests/gpu/construction.mjs` resolves the two native
WGSL probes and compiles them on the caller's device. It checks every original
reference, all eight styles' finite controls and buffer ownership, exact fixed
leaf counts, fill/outline/bark/twig ordering, signed bark widths, faceted triangle
areas, deterministic repetition, control/command exhaustion, and child-queue
exhaustion. The caller supplies the native vgpu device and owns error collection
and disposal. Tests are read-only after dependency installation and require no
CPU recipe implementation or network access.
