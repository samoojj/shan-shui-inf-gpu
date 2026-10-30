# Original tree algorithms and a faithful GPU port

Source: [the pinned upstream implementation](upstream.md). The original names
are `tree01` through `tree08`; labels here describe construction, not botanical species.

## What the module actually produces

`Tree` returns ordered SVG fragments. Its identity comes from noisy polygon
boundaries, many overlapping translucent leaf marks, white trunk interiors,
irregular outlines, bark marks, and distinct branching constructions. It is not a
collection of distance-field silhouettes. Except for `tree07`, the original does
not triangulate trees itself: it emits SVG polylines with fill and/or stroke.
The order of those SVG elements is part of the result.

The primitive call graph is:

```text
tree01 ── blob × 9; poly × 2 (open trunk contours)
tree02 ── blob × clu
tree03 ── blob × 72; poly × 1 (filled trunk)
tree04 ── branch; barkify; recursive twig; poly; stroke
tree05 ── branch; barkify; twig; poly; stroke
tree06 ── recursive fracTree ── branch; barkify; recursive twig
       └─ poly; stroke
tree07 ── blob(ret=1); PolyTools.triangulate; centroid Noise; poly per triangle
tree08 ── branch; recursive fracTree ── div; stroke
       └─ poly; stroke

branch  ── random choices; Noise; two boundary-point arrays (no drawing)
twig    ── twig at two interior samples; blob at tip; stroke
barkify ── blob or bark ── loopNoise; stroke
        └─ randomly fragmented boundary ── div; Noise; randGaussian; stroke
```

Shared brush definitions are in [primitives](original-primitives.md).

## The eight constructions

| Method and defaults | Geometry, marks, and drawing order | Source |
| --- | --- | --- |
| `tree01`: height 50, width 3, gray alpha 0.5 | Ten vertical samples at `y - i*height/10`; two untapered, independently noisy trunk edges. Samples 3–9 produce nine horizontally elongated leaf blobs in total. Their lateral spread and length decrease toward the tip. Draw leaf blobs first, then two open trunk contours with stroke width 1.5 and no fill. | [L744–801][tree01] |
| `tree02`: height 16, width 8, cluster count 5 | A cluster of asymmetric upright leaf blobs, with no trunk. Each center uses two independent bounded rejection-sampled `randGaussian()` values scaled by `clu*4`. Each blob is rotated by π/2 and has random width/length between 0.5 and 1.25 times the corresponding size parameter. The custom leaf profile differs from the default blob. | [L803–840][tree02] |
| `tree03`: height 50, width 5, default bend zero | Ten trunk samples, center `x + bend(i/10)*100`, and thickness tapered by `(10-i)/10`. Samples 2–9 each emit `2*(10-i)` blobs: 72 overlapping leaf marks. Their horizontal offsets use `log(50*t+1)/3.95`, independent random side, and leaf length twice the offset. Draw the white-filled, width-1.5 outlined trunk before the accumulated foliage. | [L842–916][tree03] |
| `tree04`: height 300, width 6 | Bent main trunk from `branch`. Attach branches to some middle perimeter samples with probability 0.1, plus a forced branch at the first side's tip. Side-branch length is `height*(1+U)*0.3`, width half the trunk, with direction determined by which side of the perimeter is visited. Splice both side-branch boundaries into the trunk boundary. Bark covers trunk and side branches. Random side-branch samples and every branch tip receive depth-1 leafy twigs. Emit white fill, irregular outline, all bark, then all twigs. | [L1191–1276][tree04] |
| `tree05`: height 300, width 5 | Straight main branch (`ben=0`), bark on the main trunk, and a tiered shape. Perimeter distance from the tip defines `p`; branch candidates occupy the middle 60% and every third sample, accepted when `U>p`, plus the forced tip. Side-branch length is `height*(0.3*p-0.05*U)` and directions are nearly horizontal with random tilt. Each side branch receives depth-0 leaf twigs at indices 0, 20, and its final sample. Side-branch bark is explicitly commented out. Same fill → outline → bark → twig order as `tree04`. | [L1279–1371][tree05] |
| `tree06`: height 100, width 6 | A recursively forked bare tree. `fracTree` starts at depth 3; each branch uses sample detail `height/20`. Children attach at two forced tip-adjacent perimeter samples and, with probability 0.025, other middle samples. Child height scales by 0.7–0.9, width by 0.6, with a small signed angle and bend 0.55. Child outlines are spliced into their parent outline. Every recursive branch adds bark. A 0.03 test along returned child outlines adds depth-2 twigs with leaves disabled. Emit combined white fill and outline, then all bark and bare twigs. | [L1374–1487][tree06] |
| `tree07`: height 60, width 4, default bend `sqrt(t)*0.2` | Ten bent, untapered trunk samples and seven broad, asymmetric leaf polygons at samples 3–9. Leaf lengths 20–70 and widths 12–24 create a much broader canopy. Leaves are returned as point lists and triangulated with target area 50, `convex=true`, `optimize=false`; trunk triangulation uses `optimize=true`. Draw trunk triangles first, then leaf triangles. Each triangle's gray value is `floor(Noise(cx*.02,cy*.02)*200+50)` at its centroid, alpha 0.8. This is faceted shading, not an outline-and-leaf treatment. | [L1490–1579][tree07] |
| `tree08`: height 80, width 1 | A thin, leaning, white-filled trunk from `branch`, with no bark. Perimeter samples independently have a 0.2 chance to sprout a recursive line-based branch of random depth 0–3; the midpoint gets a depth-3 branch when its random test fails. Each branch is a sine-bent, ten-subdivision centerline with width 0.8. It splits into one or two shorter children until depth zero; only terminal strokes taper with cosine. Emit trunk fill, noisy trunk outline, then the accumulated branch network. No leaf blobs. | [L1582–1723][tree08] |

The supplied `noi` argument is read but unused by all eight outer tree methods;
noise still enters through their shared primitives. `tree02`'s parsed `leafcol`
is unused, and its duplicate `col` property is resolved by JavaScript to the last
value, the caller's `col`. In `tree07`, the caller's color is computed into blob
arguments but `ret=1` means those colors are never drawn; triangle colors replace
them. These are observable source behaviors, not opportunities to invent new
noise or color controls while porting.

## Shared branch, twig, and bark geometry

### `branch`: two irregular sides around a bent path

`branch` first constructs three equal-length centerline segments. Each updates a
cumulative angle by a random signed bend; it then rotates all four resulting
points so the final endpoint points along the requested `ang`. That endpoint
alignment is why a branch can bend internally without losing its overall
orientation. See [L919–951][branch].

It then samples the three segments using `det` samples per segment. The width
formula tapers only to roughly half-width: `wid * (0.5*(tl-i)/tl + 0.5)`. A
height-dependent noise offset is added to one boundary and subtracted from the
other; an additional random bump occurs when the within-segment fraction is
exactly zero. Boundary normals follow the local centerline direction. Both
arrays are returned, leaving callers to combine and splice them. See
[L953–988][branch].

Default detail 10 produces 30 samples per side. Detail need not be an integer:
`tree06` and `tree08` pass `height/20`. Preserve the original integer loop index,
floating modulo, floor/ceil interpolation, and exact `p==0` test. Replacing this
with a rounded subdivision count changes the branch geometry and random stream.
The final centerline endpoint is not sampled by `branch`'s `i<tl` loop.
The first sampled tangent evaluates JavaScript's `atan2(0,0)`; handle that
explicitly if the GPU implementation's zero-vector angle is undefined.

### `twig`: a small recursive foliage fan

Each invocation builds ten points from a horizontally saturating curve
`1-(i/10+1)^-5`, vertical coordinate `-5*i`, random horizontal scale in [0.5,1),
and a small random rotation. At points 3 and 6, positive depth emits a child with
80% scale and a random sign of direction. The call is depth-first. At the final
point, enabled leaves add five asymmetric blobs; each has independently randomized
size and angle. Leaf alpha is `0.5 + 0.2*remainingDepth`, and their displacement
uses the supplied leaf-offset parameter divided by `remainingDepth+1`. Finally,
the current twig's centerline becomes a width-1 cosine-tapered stroke. Child
fragments and tip leaves therefore precede the parent stroke. See
[L991–1061][twig].

A depth `d` call produces `2^(d+1)-1` twig strokes and, when enabled, five times
that number of leaf blobs. Depth 1 produces 3 strokes and 15 blobs; depth 2
produces 7 strokes. Leaves are created at every invocation's own tip, not only
at recursion leaves. The `wid` parameter scales leaf sizes and positions but the
twig stroke width remains the literal 1.
Including child direction choices and primitive noise phases, initialized-noise
random draw counts at depths 0/1/2 are 24/74/174 with leaves and 4/14/34 without.

### `barkify`: interior marks plus broken boundary texture

For each interior paired boundary sample, `barkify` chooses a random interpolation
between the sides and the average tangent direction. With probability 0.2 it
adds a rough blob; otherwise it adds a narrow, noisy closed bark contour. The
latter has a random length of 10–20, a 21-point loop-noise contour, and a
width-0.8 stroke with `sin((t+phase)*3π)` width modulation. That signed width
function is significant: it is not a conventional positive-width line. See
[L1064–1141][bark].

An additional 0.05 test produces a small group of side marks. The concatenated
trunk boundary is then split into runs: each vertex either starts a new run or
is appended to the current run with equal probability. Each run is subdivided
by four, displaced using two different 3D noise slices times independently
Gaussian-varied amplitudes, and stroked in translucent gray. This makes broken,
uneven bark edges rather than a continuous repeated stripe. See
[L1143–1188][bark]. Empty runs consume no stroke seed because `stroke` returns
before its random call for an empty point list.

## Randomness and noise are algorithm inputs

The counts below exclude [lazy noise-table initialization](original-primitives.md#randomness-and-paper).
The fixed `tree01`, `tree03`, and `tree07` counts below were independently checked
by instrumenting the original functions in a Node VM with initialized noise.

| Construction | Random/noise call pattern |
| --- | --- |
| `tree01` | Twenty direct trunk noise samples. Each of nine leaves takes six random draws for placement, length, width, angle, and alpha, then the blob takes one for its noise phase. Total: 63 random draws and 209 noise samples including blobs. |
| `tree02` | Per blob: two rejection-sampled Gaussian values for position, two uniform size draws, then one blob noise-phase draw and 21 noise samples. Rejection sampling makes the random draw count variable. |
| `tree03` | Twenty direct trunk noise samples. Each of 72 leaves takes six outer draws, including the side choice, and one blob noise-phase draw. Total: 504 random draws and 1,532 noise samples including blobs. |
| `branch` | Six draws for the three signed turns, including when bend is zero. One extra draw at each sampled `p==0`, three at default detail. One noise sample per output pair, 30 at default detail. |
| `twig` | Per node: horizontal scale, singleton `randChoice([fun2])`, rotation, and the final stroke noise phase. Each child adds a direction-choice draw. Each enabled leaf adds three size/angle draws and one blob phase. Child draws happen immediately, before the parent continues. |
| `barkify` | Per sample: side interpolation, blob/bark choice, selected primitive's own draws, then side-mark choice and conditional group draws. Afterwards: one split decision per concatenated boundary vertex; two rejection-sampled Gaussian amplitudes per subdivided fragment point; one seed per nonempty fragment stroke. |
| `tree04–06` | Interleaved branch selection, branch geometry, bark generation, and twig recursion. Geometry generation order differs from final painting order because bark/twig strings are accumulated separately. The outline's random alpha and stroke phase are taken after that generation. |
| `tree07` | Twenty direct trunk noise samples and seven blobs with six draws each, including the blob phase: 42 random draws before deterministic triangulation, 167 noise samples before one additional noise sample per final triangle. |
| `tree08` | Trunk lean and branch generation first. Every perimeter sample consumes its sprout test. Recursive branches consume a sine-sign choice, a stroke phase, and, for nonterminal nodes, bend sign, split decision, and child parameters in depth-first order. Trunk outline alpha and stroke phase are sampled after the entire branch network is constructed. |

Several easy-to-miss source details affect exact reproduction:

- In `tree06`, `Math.random()<.025` is evaluated at every perimeter sample,
  including terminal recursion depth, before later range/depth conditions can
  short-circuit. In `tree04` and `tree05`, the range/index conditions precede their
  random tests, so excluded samples do not consume those draws.
- `tree08` constructs both `normRand` alternatives before `randChoice` selects
  one. Do not sample only the chosen interval. Its recursive calls pass `hei:20`
  or `hei:25`, but the callee reads `len`, so both actually use the default length
  15. See [L1652–1698][tree08].
- `tree08` subdivides a two-point line into eleven points but bends it using
  `i/11`. Its final rendered point is still displaced by `±2*sin(10π/11)`, while
  children start at the unbent endpoint. Preserve this small joint discrepancy
  when comparing to the source. See [L1620–1643][tree08].
- The singleton choice in `twig` is not removable if preserving the stream.
  `fun2` closes over the loop variable `i`; its formal parameter is ignored.
- The `tree05` side-branch length formula can be negative near the tip. Preserve
  or explicitly correct it with a separately reviewed visual change; silently
  clamping is a different construction.
- `tree07` triangulation picks ears and recursively bisects longest edges until
  area is below 50. Its trunk's optimized ear selection maximizes area/perimeter,
  with later candidates winning ties. Changing the triangulation changes visible
  shades because each triangle samples noise at its own centroid. See
  [L307–379][triangulation].
- `poly`'s coordinate rounding, different alpha rounding (`tree01` uses one
  decimal; most others use three), SVG nonzero fill behavior, and source-over
  painter order are all part of the reference, independent of shader precision.

## Landscape placement is part of tree identity

Porting the eight drawing functions alone will not recreate the scene. Mountain
vegetation uses different rules for rim clusters (`tree02`, drawn before the
mountain's white fill), upper clusters (`tree02`), grouped lower-face trees
(`tree01`), and edge trees (`tree03`). Placement uses the mountain's point grid,
noise thresholds, height-dependent sizes, and a neighbor-density proof rule for
`tree01`. See [L1838–1985][vegetation].

Flat-land decoration selects a larger tree family and arranges groups using the
actual land bounds: `tree05` rows, isolated `tree04` or `tree06`, `tree07` rows,
additional `tree08` groups, and scattered `tree02` marks. These choices occur
among rocks and architecture in a larger drawing sequence. See
[L2234–2349][flatdec]. Moving trees onto an unrelated periodic field loses both
these associations and the foreground/background distribution.

The current [execution boundary](architecture.md#the-cpugpu-seam) retains these
constructions. [Verification](verification.md) separates exact command/state
regressions from GPU coordinate and image tolerances.

[tree01]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L744-L801
[tree02]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L803-L840
[tree03]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L842-L916
[branch]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L919-L988
[twig]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L991-L1061
[bark]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1064-L1188
[tree04]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1191-L1276
[tree05]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1279-L1371
[tree06]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1374-L1487
[tree07]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1490-L1579
[tree08]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1582-L1723
[triangulation]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L307-L379
[vegetation]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1838-L1985
[flatdec]: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2234-L2349
