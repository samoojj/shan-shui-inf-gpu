# Original architecture, figures, boats, and water

Source: [the pinned upstream implementation](upstream.md), principally lines
2525–3704. See [architecture](verification.md) for the implemented port.

These motifs use the [shared brush and randomness contracts](original-primitives.md).
White fills, open outlines and ordered alpha blending are essential to their overlaps.

## Architecture: shared constructions

`Arch` contains six private shape helpers and six public motif constructors.
`flip` mirrors either a list of points or a list of point lists about an x axis;
the roof helper uses it to reuse its construction for the opposite orientation.
[Source: 2525–2540](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2525-L2540)

| Helper | Geometry and paint order | Variable shape/count |
| --- | --- | --- |
| `hut` | Builds ten radial profiles of ten points, all meeting at an apex. Horizontal spread grows as `(j / 9)^0.7`; each profile gets an independently randomized height between `hei` and `1.2 * hei`. Paints a white silhouette, two outside edge polylines, then 300 texture attempts by default. Texture has width 1, interval length 0.25, fixed noise amplitude 5, and an `x²` rejection-sampled distribution toward the lower part of the profiles. [2542–2607](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2542-L2607) | Grid is fixed 10 × 10, but sampled texture intervals can be empty or have different lengths. The white silhouette deliberately excludes the final sample of each outside profile. |
| `box` | Constructs outer verticals, optional bottom edges, a front center edge, and optional back edges. Calls a decoration callback with four projected face corners. If `tra` is false, paints a white five-point face first; then paints all structural and decorative paths with noisy constant-profile strokes. [2609–2687](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2609-L2687) | `bot`, `tra`, and the decoration callback change path count. `rot` selects the center x coordinates and visible decorated side; `per` controls vertical perspective offsets. |
| `deco` | Subdivides the four supplied face edges, then returns paths for one of three window patterns: paired uprights with short side bars, vertical slats, or a central grid. It returns geometry and does not draw independently. [2689–2751](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2689-L2751) | Pattern and horizontal/vertical spacing determine path counts. All returned paths use `div(..., 5)`. |
| `rail` | Builds bottom/top front/back rails according to `fro` and `tra`; perturbs their y coordinates with noise; draws connecting posts as thin native polylines; finally paints the longitudinal rails as noisy constant-profile strokes. [2753–2838](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2753-L2838) | `seg`, front/back visibility, and a randomly selected opening affect sample counts. Post generation also mutates rail samples, so the post loop is not a collection of independent reads. |
| `roof` | Constructs six piecewise linear paths for ridges, sloping edges, and eaves. Mirroring handles `rot < 0.5`; `cor` extends corners. Paints a white five-point body, its six strokes, then an optional rotated SVG text plaque. [2840–2956](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2840-L2956) | Geometry count is fixed unless the plaque is included. The text uses Verdana at `hei * 0.6`; it requires text rendering, not only polygon support. |
| `pagroof` | Starts at an apex; for each of `sid` eave positions creates an apex-to-eave three-point path and, except at the first position, a connecting eave path. Paints a white body followed by subdivided strokes. [2958–3000](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2958-L3000) | `sid` gives `2 * sid - 1` paths. The default is four eave positions. `rot` is accepted but not used in this helper's geometry. |

Two railing details must survive a faithful translation. The apparent opening
logic trims **the same path twice**: `(open + ptlist.length) % ptlist.length` is
`open`. It does not trim the opposite rail. Later, modulo indexing into the
shortened paired path can revisit a sample, applying multiple perturbations to
it. Changing either behavior alters the posts and final rails.
[Source: 2786–2818](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2786-L2818)

## Architecture: public motifs and exact local order

Each arrow below means “append next to the output,” not merely a dependency.
That order matters wherever a later white fill hides an earlier element.

| Motif | Composition in paint order | Original defaults and variation |
| --- | --- | --- |
| `arch01` | `hut → box → back rail → zero/one/two people → front rail` | Default 180 wide, 70 high. A random `p` in `[0.4, 0.6)` divides roof and lower structure heights. People count is chosen from `[0, 1, 1, 2]`; a pair faces inward, while one person has random position and facing. Each rail independently chooses 3–5 segments. Its accepted `rot` value is not forwarded to these helpers. [3002–3059](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3002-L3059) |
| `arch02` | For each story, bottom upward: `opaque decorated box → optional front rail → roof` | Default three stories, story height 10, width 50, rotation 0.3, decoration style 1. Box widths shrink by `0.85^i`, roof widths by `0.9^i`; story baseline rises by `1.5 * hei`. A single-story building has a one-third chance of a “Pizza Hut” plaque. [3061–3119](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3061-L3119) |
| `arch03` | For each story, bottom upward: `opaque decorated box → front rail → pagroof` | Default seven stories, story height 10, width 50. Uses fixed decoration style 1, five rail segments, roof height `1.5 * hei`, the same width shrink factors as `arch02`, and baseline increment `1.5 * hei`. [3120–3163](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3120-L3163) |
| `arch04` | For each story, bottom upward: `transparent undecorated box → front and back rail → pagroof` | Default two stories, story height 15, width 30. Uses three rail segments, rail width factor 1.2, roof height `hei`, and baseline increment `1.2 * hei`. [3164–3207](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3164-L3207) |
| `boat01` | `person with stick and broad hat → white hull fill → hull stroke` | Default length 120, scale 1. Person offset, hull direction, figure scale, and facing depend on the boat scale/flip. Hull covers the lower figure. Detailed shape below. [3209–3248](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3209-L3248) |
| `transmissionTower01` | `three crossarm assemblies → crossed lattice diagonals → three horizontal braces and two outside legs` | Default height 100 and width 20. Each path goes through `div(..., 5)` and a width-1 stroke whose profile is constant 0.5. Its preset topology yields 50 stroke calls; no generic tree or pagoda substitute matches this silhouette. [3250–3321](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3250-L3321) |

Buildings are also tied to particular terrain positions. `Mount.mountain`
collects candidates in grid traversal order before drawing them through
`vegetate`. Lower-side positions can produce `arch02`, `arch04`, or nothing;
near the summit it can choose a five- or seven-story `arch03`; other side
positions can produce transmission towers. These are terrain-dependent tests,
not a uniform scattering of building instances.
[Candidate traversal: 1840–1851](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1840-L1851),
[placement rules: 1990–2057](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1990-L2057).

`Mount.flatMount` can place `arch01` after its other vegetation, with a choice
from `[0, 0, 0, 0, 1]`, except for one selected vegetation arrangement (`tt == 4`).
Its location comes from the flat ground bounds; width is 160–200 and height
80–100. Consequently a recognizable port needs both the motif and these
placement rules. [Source: 2345–2364](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2345-L2364)

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
growth or variable joint topology. [Source: 3522–3598](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3522-L3598)

The visible figure is not the debug skeleton. The subsequent bone subdivision
loop has its drawing call commented out. `cloth` instead smooths a selected
joint chain using `bezmh(..., 2)`, expands that centerline to two width-shaped
contours, fills their joined silhouette white, then draws each side with a
different gray alpha (0.5 and 0.6). Sleeves, body, and head each have their own
analytic width function. [Source: 3600–3644](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3600-L3644)

The figure's exact drawing order is:

1. The item callback between joints 8 and 6; by default it emits nothing.
2. Sleeve along joints `[1, 7, 8]`.
3. Body along `[1, 0, 3, 4]`.
4. Sleeve along `[1, 5, 6]`.
5. Head along `[1, 2]`.
6. A dark head/hair patch made by expanding the head again and trimming 10% of
   one contour and 95% of the other.
7. Hat callback anchored from joint 1 to joint 2.

[Source: 3646–3663](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3646-L3663)

`expand` computes each interior pair of contour points from the neighboring
centerline directions, but its endpoints use the segment normal and explicit
widths at 0 and 1. Unlike `stroke`, it does not apply random noise to widths.
It nevertheless consumes an unused `Math.random()` value on every call.
[Source: 3325–3382](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3325-L3382)

Hat and item shapes live in normalized coordinates. `tranpoly` first mirrors x,
then rotates and scales the shape to the length and orientation of the two
anchor points; an optional additional `flipper` handles facing.
[Source: 3384–3404](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3384-L3404)

| Shape | Construction |
| --- | --- |
| `hat01` | Seven-point dark hat silhouette followed by a ten-point noise-shaped trailing stroke. This is the default for a standing figure. [3406–3448](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3406-L3448) |
| `hat02` | Ten-point broad-brimmed dark silhouette. Its local random seed is unused but consumes a random value. Boats explicitly select this hat. [3450–3485](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3450-L3485) |
| `stick01` | Twelve points along a staff, with noise-modulated lateral displacement and a sine envelope; transformed between the supplied hand anchors and drawn as a width-1 native polyline. Boats explicitly select this item. [3487–3513](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3487-L3513) |

`boat01` creates its figure before constructing the hull. The hull combines two
sampled profiles, `7 * sca * sqrt(sin(pi * t))` and
`10 * sca * sqrt(sin(pi * t))`, reversing the second to form a thin filled shape.
The loop increments `i` by `5 * sca` while `i < len * sca`, but evaluates
`t = i / len`. Scale therefore changes the sampled phase as well as the size;
replacing it with `i / (len * sca)` would change the original boat. At positive
scale, the intended sample count per side depends on `len / 5`; preserve the
actual loop's floating-point endpoint behavior when comparing reference output.
[Source: 3216–3245](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3216-L3245)

## Water: independent ripple paths with cumulative spacing

`water(xoff, yoff, seed, args)` defaults to height 2, nominal length 800, and ten
clusters. Its `seed` argument is not read. It creates all clusters before
drawing any:

1. Choose a horizontal offset `xk` in `[-len / 16, len / 16)`.
2. Add a random amount in `[0, 5)` to cumulative `yk`.
3. Choose a half-length `lk` in `[len / 4, len / 2)`.
4. For `j = -lk; j < lk; j += 5`, append
   `[j + xk, sin(0.2 * j) * hei * Noise.noise(0.1 * j) - 20 + yk]`.

[Source: 3667–3688](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3667-L3688)

The drawing loop starts at cluster **1**, so cluster 0 is generated but omitted.
Its random draws and contribution to cumulative y spacing still affect visible
clusters. Each remaining cluster becomes a width-1 `stroke`, with a new gray
alpha in `[0.3, 0.6)` serialized to three decimal places. The usual tapered,
noise-modulated stroke expansion still applies. These marks do not reflect the
mountain image, fill the whole water region, or use a ripple distance field.
[Source: 3690–3704](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3690-L3704)

For the default ten clusters, this means nine visible ripple paths. With the
noise table already initialized, the function consumes 30 random values for
cluster placement/lengths, followed by nine pairs of alpha and stroke-seed
values. This count changes if the arguments produce empty paths or a different
cluster count; `stroke` returns before drawing its random offset for an empty
input. [Cluster draws: 3676–3687](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3676-L3687),
[stroke empty handling: 531–537](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L531-L537).

World insertion, y ordering, water depth keys and boat spacing are covered by
[the planner study](original-landscape.md#world-planner-and-chunk-order).

## Randomness, recursion, and topology constraints

Within this motif group, recursion appears in two distinct forms:

- `Man.gpar` searches a **fixed** nine-joint hierarchy. A static parent/path table
  or unrolled ancestor loops can replace its recursive traversal while retaining
  the same additions and geometry. [3561–3592](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3561-L3592)
- `wtrand` recursively retries rejection samples, used by the thatch texture's
  `x²` distribution. The number of retries is unbounded by the source and changes
  the global random position. A fixed retry cap or inverse-CDF replacement would
  change the result sequence even if the distribution looked similar.
  [Rejection sampler: 425–432](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L425-L432),
  [hut use: 2594–2596](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2594-L2596).

Buildings repeat stories with loops; they do not grow recursively. Their path
counts vary with story count, railing flags and openings, decoration, and people
count. Thatch and water add variable sample counts. Polygon point counts are
therefore known only after some choices, and SVG text adds a different primitive
type. A faithful GPU buffer layout must account for those counts rather than
silently truncating motifs to a convenient fixed budget.

The [architecture](verification.md) owns the implemented CPU/GPU
boundary; the [verification report](verification.md) records its tested behavior.
