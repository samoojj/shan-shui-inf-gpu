# Original architecture, figures, boats, and water

This document describes the CPU implementation preserved in
[`reference/original.html`](../reference/original.html), principally lines
2525–3704. The source observations below come from reading that file; the GPU
execution suggestions are proposals, not implemented or benchmarked behavior.
The goal is to preserve its construction rules, primitive shapes, random choices,
and paint order when moving work to the GPU.

## Shared drawing contract

These motifs construct ordered geometry. They return SVG strings assembled by
concatenation; they do not evaluate a continuous landscape color field. Their
common primitives are:

| Primitive | Original operation | Consequence for a port |
| --- | --- | --- |
| `div(points, reso)` | Samples each input line segment at `reso` subdivisions and appends the final endpoint. The result has `(points.length - 1) * reso + 1` points for positive integer `reso`. | Retain the piecewise linear path and sample positions. Replacing this with a smooth curve changes roofs and railings. [Source: 627–650](../reference/original.html#L627-L650) |
| `bezmh(points, weight)` | Samples rational quadratic segments, using midpoint joins and 20 subdivisions per segment. A two-point input first receives an inserted midpoint. | This is the actual smoothing used for clothing; retain its weighting and endpoint rules. [Source: 445–482](../reference/original.html#L445-L482) |
| `poly(points, options)` | Emits an SVG **polyline**, with fill and stroke independently specified. Each final translated coordinate is serialized to one decimal place. Default stroke color equals fill color, and default stroke width is zero. | Filled paths and native stroked paths need separate treatment; do not assume every path is a closed stroked polygon. Preserve coordinate quantization for reference comparisons. [Source: 485–509](../reference/original.html#L485-L509) |
| `stroke(points, options)` | Expands interior samples on both sides of the centerline using a bisected tangent angle, a width profile, and Perlin noise. Joins the two sides and original endpoints into a filled polygon, then gives that polygon an additional outline, default width 1. | A GPU line primitive of constant width is insufficient. Both the generated ribbon and its SVG outline contribute to the mark. [Source: 516–575](../reference/original.html#L516-L575) |
| `texture(grid, options)` | Chooses short intervals on interpolated grid rows, displaces their samples with noise, and emits strokes in its defined shade/texture order. | The thatched roof consists of explicit short marks. It is not an image texture or a generic grain overlay. [Source: 653–740](../reference/original.html#L653-L740) |

The default stroke width profile is `sin(pi * t)`, so endpoints narrow. Buildings
often override it with a constant 1; boats override it with `sin(2 * pi * t)`,
which changes sign halfway along the outline. Default stroke noise is 0.5 and
each nonempty stroke consumes a fresh random noise offset. Preserve the original
angle calculation, endpoint handling, and sign rather than substituting a usual
constant-width polyline join. [Source: 520–573](../reference/original.html#L520-L573)

Opaque white fills are part of the design. They cover previously painted marks;
they are not simply absent ink. Gray strokes with partial alpha accumulate above
those masks. Keeping only contours or applying an overall paper/noise shader
would omit the local occlusion that gives huts, pagodas, clothes, and boats their
shape.

## Architecture: shared constructions

`Arch` contains six private shape helpers and six public motif constructors.
`flip` mirrors either a list of points or a list of point lists about an x axis;
the roof helper uses it to reuse its construction for the opposite orientation.
[Source: 2525–2540](../reference/original.html#L2525-L2540)

| Helper | Geometry and paint order | Variable shape/count |
| --- | --- | --- |
| `hut` | Builds ten radial profiles of ten points, all meeting at an apex. Horizontal spread grows as `(j / 9)^0.7`; each profile gets an independently randomized height between `hei` and `1.2 * hei`. Paints a white silhouette, two outside edge polylines, then 300 texture attempts by default. Texture has width 1, interval length 0.25, fixed noise amplitude 5, and an `x²` rejection-sampled distribution toward the lower part of the profiles. [2542–2607](../reference/original.html#L2542-L2607) | Grid is fixed 10 × 10, but sampled texture intervals can be empty or have different lengths. The white silhouette deliberately excludes the final sample of each outside profile. |
| `box` | Constructs outer verticals, optional bottom edges, a front center edge, and optional back edges. Calls a decoration callback with four projected face corners. If `tra` is false, paints a white five-point face first; then paints all structural and decorative paths with noisy constant-profile strokes. [2609–2687](../reference/original.html#L2609-L2687) | `bot`, `tra`, and the decoration callback change path count. `rot` selects the center x coordinates and visible decorated side; `per` controls vertical perspective offsets. |
| `deco` | Subdivides the four supplied face edges, then returns paths for one of three window patterns: paired uprights with short side bars, vertical slats, or a central grid. It returns geometry and does not draw independently. [2689–2751](../reference/original.html#L2689-L2751) | Pattern and horizontal/vertical spacing determine path counts. All returned paths use `div(..., 5)`. |
| `rail` | Builds bottom/top front/back rails according to `fro` and `tra`; perturbs their y coordinates with noise; draws connecting posts as thin native polylines; finally paints the longitudinal rails as noisy constant-profile strokes. [2753–2838](../reference/original.html#L2753-L2838) | `seg`, front/back visibility, and a randomly selected opening affect sample counts. Post generation also mutates rail samples, so the post loop is not a collection of independent reads. |
| `roof` | Constructs six piecewise linear paths for ridges, sloping edges, and eaves. Mirroring handles `rot < 0.5`; `cor` extends corners. Paints a white five-point body, its six strokes, then an optional rotated SVG text plaque. [2840–2956](../reference/original.html#L2840-L2956) | Geometry count is fixed unless the plaque is included. The text uses Verdana at `hei * 0.6`; it requires text rendering, not only polygon support. |
| `pagroof` | Starts at an apex; for each of `sid` eave positions creates an apex-to-eave three-point path and, except at the first position, a connecting eave path. Paints a white body followed by subdivided strokes. [2958–3000](../reference/original.html#L2958-L3000) | `sid` gives `2 * sid - 1` paths. The default is four eave positions. `rot` is accepted but not used in this helper's geometry. |

Two railing details must survive a faithful translation. The apparent opening
logic trims **the same path twice**: `(open + ptlist.length) % ptlist.length` is
`open`. It does not trim the opposite rail. Later, modulo indexing into the
shortened paired path can revisit a sample, applying multiple perturbations to
it. Changing either behavior alters the posts and final rails.
[Source: 2786–2818](../reference/original.html#L2786-L2818)

## Architecture: public motifs and exact local order

Each arrow below means “append next to the output,” not merely a dependency.
That order matters wherever a later white fill hides an earlier element.

| Motif | Composition in paint order | Original defaults and variation |
| --- | --- | --- |
| `arch01` | `hut → box → back rail → zero/one/two people → front rail` | Default 180 wide, 70 high. A random `p` in `[0.4, 0.6)` divides roof and lower structure heights. People count is chosen from `[0, 1, 1, 2]`; a pair faces inward, while one person has random position and facing. Each rail independently chooses 3–5 segments. Its accepted `rot` value is not forwarded to these helpers. [3002–3059](../reference/original.html#L3002-L3059) |
| `arch02` | For each story, bottom upward: `opaque decorated box → optional front rail → roof` | Default three stories, story height 10, width 50, rotation 0.3, decoration style 1. Box widths shrink by `0.85^i`, roof widths by `0.9^i`; story baseline rises by `1.5 * hei`. A single-story building has a one-third chance of a “Pizza Hut” plaque. [3061–3119](../reference/original.html#L3061-L3119) |
| `arch03` | For each story, bottom upward: `opaque decorated box → front rail → pagroof` | Default seven stories, story height 10, width 50. Uses fixed decoration style 1, five rail segments, roof height `1.5 * hei`, the same width shrink factors as `arch02`, and baseline increment `1.5 * hei`. [3120–3163](../reference/original.html#L3120-L3163) |
| `arch04` | For each story, bottom upward: `transparent undecorated box → front and back rail → pagroof` | Default two stories, story height 15, width 30. Uses three rail segments, rail width factor 1.2, roof height `hei`, and baseline increment `1.2 * hei`. [3164–3207](../reference/original.html#L3164-L3207) |
| `boat01` | `person with stick and broad hat → white hull fill → hull stroke` | Default length 120, scale 1. Person offset, hull direction, figure scale, and facing depend on the boat scale/flip. Hull covers the lower figure. Detailed shape below. [3209–3248](../reference/original.html#L3209-L3248) |
| `transmissionTower01` | `three crossarm assemblies → crossed lattice diagonals → three horizontal braces and two outside legs` | Default height 100 and width 20. Each path goes through `div(..., 5)` and a width-1 stroke whose profile is constant 0.5. Its preset topology yields 50 stroke calls; no generic tree or pagoda substitute matches this silhouette. [3250–3321](../reference/original.html#L3250-L3321) |

Buildings are also tied to particular terrain positions. `Mount.mountain`
collects candidates in grid traversal order before drawing them through
`vegetate`. Lower-side positions can produce `arch02`, `arch04`, or nothing;
near the summit it can choose a five- or seven-story `arch03`; other side
positions can produce transmission towers. These are terrain-dependent tests,
not a uniform scattering of building instances.
[Candidate traversal: 1840–1851](../reference/original.html#L1840-L1851),
[placement rules: 1990–2057](../reference/original.html#L1990-L2057).

`Mount.flatMount` can place `arch01` after its other vegetation, with a choice
from `[0, 0, 0, 0, 1]`, except for one selected vegetation arrangement (`tt == 4`).
Its location comes from the flat ground bounds; width is 160–200 and height
80–100. Consequently a recognizable port needs both the motif and these
placement rules. [Source: 2345–2364](../reference/original.html#L2345-L2364)

## Figures: a skeleton covered by cloth

`Man.man` starts with nine joint angles and nine lengths. Lengths are multiplied
by `sca`, default 0.5. The hierarchy is fixed:

```text
0
├── 1
│   ├── 2
│   ├── 5 ── 6
│   └── 7 ── 8
└── 3 ── 4
```

`gpar` recursively searches that object for a joint's ancestor path. `grot` sums
angles along the path; `gpos` sums segments using the cumulative angle at each
ancestor. After evaluating joints, `yoff` is shifted by joint 4's y coordinate
to put that foot at the requested ground position. Facing is a final x mirror.
The recursive search is an implementation of a fixed skeleton, not recursive
growth or variable joint topology. [Source: 3522–3598](../reference/original.html#L3522-L3598)

The visible figure is not the debug skeleton. The subsequent bone subdivision
loop has its drawing call commented out. `cloth` instead smooths a selected
joint chain using `bezmh(..., 2)`, expands that centerline to two width-shaped
contours, fills their joined silhouette white, then draws each side with a
different gray alpha (0.5 and 0.6). Sleeves, body, and head each have their own
analytic width function. [Source: 3600–3644](../reference/original.html#L3600-L3644)

The figure's exact drawing order is:

1. The item callback between joints 8 and 6; by default it emits nothing.
2. Sleeve along joints `[1, 7, 8]`.
3. Body along `[1, 0, 3, 4]`.
4. Sleeve along `[1, 5, 6]`.
5. Head along `[1, 2]`.
6. A dark head/hair patch made by expanding the head again and trimming 10% of
   one contour and 95% of the other.
7. Hat callback anchored from joint 1 to joint 2.

[Source: 3646–3663](../reference/original.html#L3646-L3663)

`expand` computes each interior pair of contour points from the neighboring
centerline directions, but its endpoints use the segment normal and explicit
widths at 0 and 1. Unlike `stroke`, it does not apply random noise to widths.
It nevertheless consumes an unused `Math.random()` value on every call.
[Source: 3325–3382](../reference/original.html#L3325-L3382)

Hat and item shapes live in normalized coordinates. `tranpoly` first mirrors x,
then rotates and scales the shape to the length and orientation of the two
anchor points; an optional additional `flipper` handles facing.
[Source: 3384–3404](../reference/original.html#L3384-L3404)

| Shape | Construction |
| --- | --- |
| `hat01` | Seven-point dark hat silhouette followed by a ten-point noise-shaped trailing stroke. This is the default for a standing figure. [3406–3448](../reference/original.html#L3406-L3448) |
| `hat02` | Ten-point broad-brimmed dark silhouette. Its local random seed is unused but consumes a random value. Boats explicitly select this hat. [3450–3485](../reference/original.html#L3450-L3485) |
| `stick01` | Twelve points along a staff, with noise-modulated lateral displacement and a sine envelope; transformed between the supplied hand anchors and drawn as a width-1 native polyline. Boats explicitly select this item. [3487–3513](../reference/original.html#L3487-L3513) |

`boat01` creates its figure before constructing the hull. The hull combines two
sampled profiles, `7 * sca * sqrt(sin(pi * t))` and
`10 * sca * sqrt(sin(pi * t))`, reversing the second to form a thin filled shape.
The loop increments `i` by `5 * sca` while `i < len * sca`, but evaluates
`t = i / len`. Scale therefore changes the sampled phase as well as the size;
replacing it with `i / (len * sca)` would change the original boat. At positive
scale, the intended sample count per side depends on `len / 5`; preserve the
actual loop's floating-point endpoint behavior when comparing reference output.
[Source: 3216–3245](../reference/original.html#L3216-L3245)

## Water: independent ripple paths with cumulative spacing

`water(xoff, yoff, seed, args)` defaults to height 2, nominal length 800, and ten
clusters. Its `seed` argument is not read. It creates all clusters before
drawing any:

1. Choose a horizontal offset `xk` in `[-len / 16, len / 16)`.
2. Add a random amount in `[0, 5)` to cumulative `yk`.
3. Choose a half-length `lk` in `[len / 4, len / 2)`.
4. For `j = -lk; j < lk; j += 5`, append
   `[j + xk, sin(0.2 * j) * hei * Noise.noise(0.1 * j) - 20 + yk]`.

[Source: 3667–3688](../reference/original.html#L3667-L3688)

The drawing loop starts at cluster **1**, so cluster 0 is generated but omitted.
Its random draws and contribution to cumulative y spacing still affect visible
clusters. Each remaining cluster becomes a width-1 `stroke`, with a new gray
alpha in `[0.3, 0.6)` serialized to three decimal places. The usual tapered,
noise-modulated stroke expansion still applies. These marks do not reflect the
mountain image, fill the whole water region, or use a ripple distance field.
[Source: 3690–3704](../reference/original.html#L3690-L3704)

For the default ten clusters, this means nine visible ripple paths. With the
noise table already initialized, the function consumes 30 random values for
cluster placement/lengths, followed by nine pairs of alpha and stroke-seed
values. This count changes if the arguments produce empty paths or a different
cluster count; `stroke` returns before drawing its random offset for an empty
input. [Cluster draws: 3676–3687](../reference/original.html#L3676-L3687),
[stroke empty handling: 531–537](../reference/original.html#L531-L537).

## Ordering across motifs

Local motif order is only one level of the painter's algorithm. `chunkloader.add`
inserts complete motif strings into `MEM.chunks` in ascending y order.
`chunkrender` concatenates selected chunks in that order. Buildings within a
mountain remain embedded in that mountain's string; they are not independently
depth-sorted with boats or buildings on other mountains.
[Insertion: 3845–3874](../reference/original.html#L3845-L3874),
[rendering: 3973–3983](../reference/original.html#L3973-L3983).

Equal-y insertion is not a general stable sort: a new chunk tied with the first
element is prepended, a last-element tie is appended unless the first condition
already matched, and interior ties enter at the first matching interval. A port
that sorts `(y, creationIndex)` must first show that it reproduces the relevant
reference ordering or explicitly document a change.
[Source: 3852–3866](../reference/original.html#L3852-L3866)

Water associated with a mountain is drawn at the mountain's coordinates but
inserted with sort y equal to `mountain.y - 10000`. This puts ripples behind the
land and its white masks. Boats retain their actual y coordinate and use scale
`y / 800`; their facing is randomized. The planner considers boat candidates
every five world units, with probability 0.2, then rejects candidates within
400 x units of **any** existing entry in that plan. It does not only test
boat-to-boat spacing.
[Water insertion: 3888–3902](../reference/original.html#L3888-L3902),
[boat construction: 3929–3937](../reference/original.html#L3929-L3937),
[candidate spacing: 3722–3731](../reference/original.html#L3722-L3731),
[boat planning: 3806–3810](../reference/original.html#L3806-L3810).

## Randomness, recursion, and topology constraints

The original replaces `Math.random` with one mutable seeded stream. Motif
`seed` parameters do not isolate their random consumption. On its first use,
the noise module fills a 4096-value table from that same stream. That initial
allocation, recursive calls, choices, and unused random draws all affect later
geometry. Parallel invocations cannot independently advance this shared state
and retain the original sequence.
[PRNG: 1–59](../reference/original.html#L1-L59),
[initial noise table: 90–109](../reference/original.html#L90-L109).

The PRNG uses JavaScript Number multiplication and remainder with an approximately
`10^12` modulus. A direct WGSL `f32` or `u32` replacement does not reproduce it.
Even reproducing exact integer modular arithmetic would not automatically match
the JavaScript rounding of the original large products. Reference fidelity
therefore requires an explicit numeric and random-stream strategy, not merely
using the same displayed seed.
[Source: 3–6 and 34–36](../reference/original.html#L3-L36)

Within this motif group, recursion appears in two distinct forms:

- `Man.gpar` searches a **fixed** nine-joint hierarchy. A static parent/path table
  or unrolled ancestor loops can replace its recursive traversal while retaining
  the same additions and geometry. [3561–3592](../reference/original.html#L3561-L3592)
- `wtrand` recursively retries rejection samples, used by the thatch texture's
  `x²` distribution. The number of retries is unbounded by the source and changes
  the global random position. A fixed retry cap or inverse-CDF replacement would
  change the result sequence even if the distribution looked similar.
  [Rejection sampler: 425–432](../reference/original.html#L425-L432),
  [hut use: 2594–2596](../reference/original.html#L2594-L2596).

Buildings repeat stories with loops; they do not grow recursively. Their path
counts vary with story count, railing flags and openings, decoration, and people
count. Thatch and water add variable sample counts. Polygon point counts are
therefore known only after some choices, and SVG text adds a different primitive
type. A faithful GPU buffer layout must account for those counts rather than
silently truncating motifs to a convenient fixed budget.

## GPU work that preserves the construction

The useful seam is between ordered motif decisions and evaluated drawing
primitives. Moving the following geometry work to compute or vertex shaders
keeps the original procedural approach. Supplying only an already rasterized
CPU image or CPU-expanded final vertices would not move this generation work.

| Work | Parallel units | Preconditions and order that must remain |
| --- | --- | --- |
| Hut and roof samples | One invocation per profile/sample or edge/subdivision | Height choices, roof parameters, and path counts already assigned. Keep sampled paths, silhouette omissions, and texture mark distribution. |
| Windows and story geometry | One invocation per selected story/path/sample | Story dimensions can be computed from index; preserve the outer story paint order even if positions are evaluated simultaneously. |
| Railing geometry | Independent rail samples where writes do not overlap; posts after required perturbations | First resolve opening/truncation. For wrapped indices, reproduce ordered repeated mutations; blindly writing each post in parallel creates races and different final rail points. |
| Figure joint positions | One invocation per joint or figure | Use the fixed ancestor paths and original summation order. Joint 4's y must be available before final grounding; a small second stage or repeated computation supplies it. |
| Cloth, hats, stick | One invocation per curve/shape sample, followed by one per expanded contour sample | Contour expansion reads neighboring centerline samples. Use separate stages or evaluate those neighbors explicitly. Item, clothing, hair, and hat paint order stays unchanged. |
| Water geometry | One invocation per selected cluster/sample | Preassign `xk`, `lk`, and random y increments; obtain cumulative `yk` by an ordered prefix computation. A parallel reassociation can change rounding, so quantify that separately. Keep cluster 0's state contribution and omit its drawing. |
| Stroke expansion | One invocation per non-endpoint sample | Read neighboring centerline points; retain per-path random offset, original noise table, width profile, bisector calculation, endpoint closure, coordinate quantization, and outline. |
| Rasterization | GPU processing of generated filled contours and native polyline strokes | Preserve SVG fill/outline behavior and antialiasing expectations. Submit alpha-composited primitives in their original paint order; white masks and overlaps make arbitrary batching incorrect. |

Variable output can use a count stage and prefix offsets before geometry
generation, or motif-specific reserved storage with exact emitted counts and
explicit overflow handling. Either is an execution strategy, not permission to
alter topology. Nonconvex or self-crossing stroke contours require the original
fill semantics; a naive triangle fan is not a general replacement for an SVG
filled polyline. A rendering port also needs a deliberate solution for the
occasional plaque text.

A practical fidelity path can retain ordered random/topology decisions on the
CPU while uploading compact motif parameters and random values, then generate
the dense centerlines, contour vertices, and rendered output on the GPU. This
would be a hybrid port with substantive GPU generation; it must be described as
such. Moving that planning stage too requires explicit work queues or passes,
compatible PRNG arithmetic, ordered rejection sampling, and exact allocation
rules. An independently hashed seed per motif, generic noise-field buildings,
or different water equations would be a new generator, not this algorithm
executed on the GPU.

Before claiming parity, compare isolated motifs at fixed saved random states,
their ordered primitive lists/counts, and their rendered overlaps. Include both
facings, all four architecture types, each decoration, zero/one/two people,
transparent rails with openings, plaque text, multiple boat scales, and default
water including its omitted first cluster. Then compare composed scenes with
water behind land and boats interleaved by y. These are proposed verification
targets; this source audit does not establish image or performance equivalence.
