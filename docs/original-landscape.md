# How the original landscape is constructed

This is a source study of [the original CPU implementation](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html)
at upstream commit `9f754d2b2e73495db7883d4d4055a7b0903b0454`. Source links cite
that exact upstream file; the reference application is no longer vendored.

## Construction, not a height-field shader

The original creates an ordered drawing of **filled polygons, tapered stroke
polygons, and leaf blobs**. Mountains supply nested sampled polylines; trees,
buildings, rocks, and water add more of those drawing primitives. It does not
shade a terrain height field once per screen pixel. SVG is the output encoding,
not the procedural model.

```text
global seeded random stream + shared noise table
  -> mountplanner: ordered records tagged mount / flatmount / distmount / boat
  -> chunkloader: invoke the matching construction in record order
     -> Mount.mountain: nested grid -> fill, outline, feet, texture, decoration
     -> Mount.flatMount: clipped nested grid -> plateau -> flatDec
     -> Mount.distMount: ridge polygons -> recursively subdivided triangles
     -> Arch.boat01: hull and human drawing
  -> poly / stroke / blob: ordered primitive output
  -> insert completed objects by ascending drawing-depth key
  -> select visible object anchors -> concatenate their SVG
  -> browser rasterizes SVG and multiplies it over paper
```

The source uses screen coordinates: increasing `x` goes right and increasing
`y` goes **down**. Most local mountain/plant heights therefore subtract from an
object's `y` anchor. `poly` rounds output coordinates to one decimal place and
emits a styled SVG polyline; SVG closes the fill implicitly even when the
stroke path is open. This quantization is part of the reference image, although
the preceding construction uses JavaScript numbers.
([485–509](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L485-L509))

## Randomness and the noise field

`Math.random` is replaced globally with `Prng.next`. Its state recurrence is
`s = (s * s) % (999979 * 999983)`, returning `s / m`. Seeding hashes the
base64-encoded JSON seed, avoids specified degenerate states, and advances ten
times. Both the hash and recurrence execute in JavaScript double precision;
the squared state is larger than the exact-integer range. A different integer
PRNG or ordinary GPU `f32` recurrence is not seed-compatible merely because it
has the same initial seed. ([1–59](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1-L59))

`Noise.noise` is the p5-style table noise implementation: 4096 table entries,
cosine interpolation, four octaves, initial amplitude `0.5`, and amplitude
falloff `0.5`. Negative input coordinates are reflected to positive values.
The table is initialized **lazily** by consuming 4096 values from the same global
random stream on the first noise call. An alternative `noiseSeed` LCG exists,
but the landscape initialization calls `Math.seed`, not `Noise.noiseSeed`.
([78–202](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L78-L202))

Random consumption is a dependency of the drawing:

- Generation order matters. Constructing one object's vegetation consumes
  values that affect every following object.
- Random calls in short-circuited predicates happen only when earlier conditions
  succeed. For example, the summit-building test draws only at row 1, column 25.
- Several loops use `j < Math.random() * N` or `j < randChoice(...)` directly in
  the loop condition. They draw a **new bound on every condition evaluation**,
  including the terminating evaluation; they are not equivalent to drawing a
  count once. This occurs throughout `flatDec` and in gap-island planning.
- Rejection sampling in `wtrand`/`randGaussian` consumes a variable number of
  random values. `normRand`, despite its name, is uniform interpolation, not a
  Gaussian sample. ([417–442](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L417-L442))
- The initial `update()` occurs at line 4310 before the paper-generation loop at
  4342. Paper then consumes `257 * 257 = 66049` additional random values before
  later user-driven chunk generation. Running only the construction functions
  omits this application-level advancement.

A faithful construction port and an exact old-seed replay are separate claims.
The former preserves formulas, sampling, distributions, motifs, and painting
order. The latter additionally requires the original random/noise state and
the same sequence of calls. Any replacement for that sequence must be an
explicit, tested compatibility decision.

## Regular mountains

### Sampled surface

`Mount.mountain(xoff, yoff, seed, args)` defaults to height `100 + 400R`, width
`400 + 200R`, 200 texture candidates, and middle/bottom vegetation enabled.
`seed` is a coordinate of the shared noise field, not a fresh PRNG seed.
([1804–1820](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1804-L1820))

It constructs ten rows of fifty points. For row `j = 0..9` and column `i = 0..49`:

```text
hoff[j] = sum(k = 0..j, R[k] * yoff / 100)
a        = (i / 50 - 0.5) * pi
p        = 1 - j / 10
x[j,i]   = (a / pi) * width * p
y[j,i]   = -cos(a) * Noise(a + 10, j * 0.15, seed) * height * p + hoff[j]
```

These are nested, shrinking, offset ridges, not ten independently placed
mountains. The last sample is at `i=49`, not at the other cosine endpoint.
The random height offsets are a prefix sum, one random draw per row.
([1822–1836](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1822-L1836))

### Painting order inside one mountain

The output order below is literal string-append order. White fills intentionally
erase objects already drawn behind them.

| Order | Construction | Source |
| --- | --- | --- |
| 1 | Rim `Tree.tree02` clusters, offset upward by 5 | [1853–1873](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1853-L1873) |
| 2 | Opaque white fill from outer row plus local point `[0, 40]` | [1875–1881](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1875-L1881) |
| 3 | Outer-row tapered stroke, gray alpha `.3`, width `3`, noise factor `1` | [1882–1888](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1882-L1888) |
| 4 | Foot polygons, then their outlines | [1890](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1890) |
| 5 | Texture strokes, optionally including broad shade strokes | [1891–1897](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1891-L1897) |
| 6 | Top `Tree.tree02` clusters | [1899–1916](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1899-L1916) |
| 7 | Middle `Tree.tree01` and edge `Tree.tree03`, when `veg` is true | [1918–1988](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1918-L1988) |
| 8 | Lower buildings, occasional summit building, transmission towers | [1990–2057](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1990-L2057) |
| 9 | Edge rocks | [2059–2074](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2059-L2074) |

Rim vegetation precedes the body fill, so the fill masks its lower portions.
The `veg` flag does **not** disable rim/top clusters, buildings, towers, or rocks.
The `ret` option changes the final return value but does not skip this preceding
construction or its random consumption. ([2076–2080](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2076-L2080))

### Foot construction

`foot` selects successive row indices with random steps of 1 or 2. At each
selected row it builds a left and right foot: seven edge points for the 50-point
grid, reversed, followed by ten samples bridging to the next selected row.
The bridge interpolates the endpoints and adds
`-1.7 * (p - 1) * p^(1/5) * 5 + Noise(xoff * .05, row) * 5` to height.
All foot polygons receive white fills first, followed by width-1 gray strokes
with independently selected alpha in `[.1,.2)`.
([1728–1801](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1728-L1801))

### Texture is sampled geometry

For texture candidate `t` out of `T`, choose a center column from the outer
thirds of the row, a half-length `floor(R * columnCount * .2)`, and clip the
column interval. The default distribution uses two draws: one selects a side,
one chooses a position within that third. For a 50-column mountain the
half-length is 0–9, so a candidate has at most 18 centerline points.
([653–695](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L653-L695))

The row coordinate is `layer = (t/T) * (rowCount - 1)`. For each selected column,
the exact source interpolation is:

```text
p = fract(layer)
point = lowerRowPoint * p + upperRowPoint * (1 - p)
jitterX = (30 / (layer + 1)) * (Noise(point.x, column * .5) - .5)
jitterY = (30 / (layer + 1)) * (Noise(point.y, column * .5) - .5)
```

Here `lowerRowPoint` means row `floor(layer)` and `upperRowPoint` means
`ceil(layer)`. The coefficients are opposite to conventional interpolation;
silently swapping them changes the reference construction. The resulting
short polylines follow the mountain's sampled ridges and are noisier near the
outer rows. They are not regularly spaced screen-space contour bands.
([697–717](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L697-L717))

Mountain shading selects `sha` from `[0,0,0,0,5]`. With `sha=0`, every candidate
is stroked at default width `1.5` with random gray alpha in `[0,.3)`. With
`sha=5`, even-indexed candidates first receive broad width-5, alpha-.1 strokes;
fine strokes then start at index 5 and advance by 6. The default mountain thus
requests either 200 fine strokes, or 100 broad plus 33 fine strokes, before
empty-path handling. ([668–683](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L668-L683),
[719–740](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L719-L740),
[1891–1897](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1891-L1897))

`stroke` expands a polyline into a filled ribbon. Interior width is
`wid * sin(pi * i / pointCount)`, multiplied by
`(1-noi) + noi * Noise(i*.5, randomPhase)`. Its two edges use the bisector of
neighboring segment angles; the two edge lists and endpoints form a closed
polygon. The polygon also gets the requested SVG outline (default width 1).
It consumes one random phase for each nonempty input path.
([516–575](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L516-L575))

### Vegetation and motif placement

`vegetate` scans the grid in row-major order, collects candidates, then runs a
proof predicate and constructs accepted motifs in collected order. There is
no independent uniform distribution of tree positions.
([1838–1852](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1838-L1852))

| Motif pass | Candidate rule and construction |
| --- | --- |
| Rim clusters | Row 0; `Noise(column*.1, seed)^3 < .1`; `abs(localY)/height > .2`; `tree02`, cluster size 2. |
| Top clusters | `Noise(row*.1,column*.1,seed+2)^3 < .1`; normalized absolute height `>.5`; `tree02`. |
| Middle trees | Odd columns; `Noise(row*.2,column*.05,seed)^4 < .012`; normalized height `<.3`; retain only candidates with more than two other candidates within radius 30. `tree01` height is `((h+y)/h)*70*(.3+.7R)`, width `1+3R`. |
| Edge trees | Columns 0 or 49; the same noise threshold; `tree03` height `((h+y)/h)*120*(.5+.5R)` and a random bending coefficient. |
| Lower buildings | Nonzero rows, columns 1 or 48, noise with `seed+10` to the fourth power `<.008`. A weighted draw `[0,0,1,1,1,2]` chooses none, `arch02`, or `arch04`; further draws choose dimensions, storeys, rotation, and style. |
| Summit building | Only row 1/column 25; probability `.02`; `arch03` with 5 or 7 storeys and width `40+20R`. |
| Transmission towers | Even rows, columns 1 or 48; noise with `seed+20*pi` to the fourth power `<.002`; `transmissionTower01`. |
| Edge rocks | Columns 0 or 49, independent probability `.1`; `Mount.rock`, width and height each `20+20R`, shade width 2. |

These rules are in [1853–2074](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1853-L2074). The middle
proof pass is a neighborhood-count operation over the candidate list, with an
early return after three neighbors; it is not a Bernoulli density control.

## Flat mountains and their decoration

`flatMount` creates five rows of fifty points. With `a=(i/50-.5)*pi` and
`p=1-.6*j/5`, it computes `x=(a/pi)*width*p` and
`y=-(cos(2*a)+1)*Noise(a+10,j*.1,seed)*height*p+hoff`. Each row again receives
a cumulative `R*yoff/100` offset. Heights above the horizontal cutoff are
clamped to `-100*cho+hoff`; entry and exit points of clamped runs are collected
in `flat`. ([2083–2125](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2083-L2125))

The outer silhouette is white-filled and outlined like a regular mountain.
Eighty width-2 texture candidates use centers distributed in `.1.. .5` or
`.5.. .9`, rather than the regular mountain's outer thirds. The source then
extracts the first and last plateau endpoints from every other row. It extends
both sides with three points at each end, subdivides each segment into five,
and varies their horizontal scale by a triangular envelope and noise. The
combined path becomes another white-filled, width-3 gray-outlined land surface.
([2127–2205](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2127-L2205))

`flatDec` receives the bounding box of that generated surface, not a generic
mountain height field. Its ordered recipe is:

1. Small scattered rocks, then clustered `tree08` trees.
2. One weighted theme from `[0,0,1,2,3,4]`: larger rocks; a `tree05` grove with
   rocks; `tree04` trees with adjacent rocks; `tree06` trees; or a `tree07` grove.
3. Scattered `tree02` shrubs.
4. An optional `arch01` building, suppressed for the `tree07` theme.

The theme branches and their different random loop conditions matter; replacing
them with a generic pine/temple scatter loses a substantial part of the original
foreground. ([2207–2366](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2207-L2366))

## Distant mountains and rocks

`distMount` samples a long ridge in 10-unit horizontal steps. With `k` the
sample index, its top is
`yoff - height*Noise(k*.05,seed)*sqrt(sin(pi*k/(length/10)))`; the lower edge is
`yoff + 24*Noise(k*.05,2,seed)*sin(pi*k/(length/10))`. Default blocks contain
six top samples and four lower samples. Each block is filled, triangulated with
`convex:true, optimize:false`, and recursively split along the longest triangle
edge until area is below 100. Every small triangle gets gray
`floor(200 + 55*Noise(midX*.02,midY*.02,yoff))` for fill and width-1 stroke.
These facets are actual painted shapes.
([2369–2430](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2369-L2430),
[322–379](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L322-L379))

`rock` constructs ten nested 50-point rings. It samples noise around each ring,
uses `loopNoise` to match the endpoints and renormalize the values, and modulates
an ellipse's polar radius:

```text
a = (column/50)*2*pi - pi/2
radius = width*height / sqrt((height*cos(a))^2 + (width*sin(a))^2)
radius *= .7 + .3*loopedNoise[column]
p = 1 - row/10
x = cos(a)*radius*p
y = -sin(a)*radius*p
if a > pi or a < 0: y *= .2
y += height*(row/10)*.2
```

The outer ring is white-filled and outlined; 40 texture candidates shade the
ring stack. Their centers use `.15.. .30` or `.70.. .85`, width 3, and gray 180
with alpha `.3.. .6`. Default shade width is 10; callers frequently override
it to 2 or 5. ([2433–2521](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L2433-L2521),
[404–414](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L404-L414))

## Water strokes

Water is generated beside each regular mountain, not as a continuous filled
river. Ten candidate centerlines have random horizontal shift in `[-len/16,
len/16)`, cumulative vertical increments `5R`, and half-length
`len/4 + R*len/4`. Points are sampled every 5 units along each line with height
`sin(x*.2)*hei*Noise(x*.1)-20+verticalOffset`. The first candidate is generated
but not drawn; candidates 1 through 9 become width-1 tapered strokes with gray
alpha `.3.. .6`. Defaults are `len=800`, `hei=2`. The supplied `seed` is unused.
([3667–3703](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3667-L3703))

## World planner and chunk order

`mountplanner(xmin,xmax)` produces placement records in three sequential passes.
It initializes an occupancy array at `floor(x/5)` indices for the requested
range. Its candidate sampling starts at the supplied `xmin` and advances by 5;
512-unit chunk boundaries therefore do not form one global 5-unit lattice.
([3706–3754](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3706-L3754))

1. **Mountains and distant ridges.** At each sampled `x`, scan `y` in 30-unit
   steps up to `480*Noise(x*.01,pi)`. The field tested for a local maximum is
   `max(Noise(x*.03)-.55,0)*2`; it ignores `y`. Accept only values `>.3` and no
   larger value in the 4-by-4 integer-sample neighborhood of radius 2. Accepted
   positions receive horizontal jitter `1000*(R-.5)` and base `y+300`.
   `chadd` rejects any prior record in this planner invocation within 10 units
   horizontally, regardless of vertical separation or tag. Accepted mountains
   increment occupancy in a 400-unit horizontal band. Near each positive or
   negative 1000-unit multiple, a distant ridge is attempted at base `280-50R`.
2. **Gap islands.** At each sampled `x` whose occupancy equals zero, probability
   `.01` starts a dynamically bounded loop `j < 4*Math.random()`. Island records
   get horizontal jitter `1400*(R-.5)` and bases `700-50*j`, with the same
   10-unit acceptance rule.
3. **Boats.** Each sampled `x` has probability `.2` of proposing a boat at
   base `300+390R`. Acceptance requires 400 units of horizontal clearance from
   **every** prior record in this planner invocation, not only other boats.

The record field `h` stores the planning field value but the loader does not use
it to set mountain height. The helper fields `nns` and `nnns` are defined but
unused. ([3756–3813](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3756-L3813))

There are source quirks worth recording before changing behavior: `chadd` has
no cross-chunk record check; occupancy increments may touch uninitialized array
entries outside the requested range, producing `NaN`; later initialization via
`value || 0` resets those entries. These are implementation facts, not useful
features to invent a new landscape around. Fixing them should be a separate
compatibility decision with reference images.

`chunkloader` extends a retained world in 512-unit ranges until there is at least
one chunk of margin on each side. It always chooses the right extension before
the left when both are needed. It constructs objects in the planner's record
order, consuming the global random stream, then inserts each completed object
into `MEM.chunks` by ascending `y` drawing key.
([3816–3827](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3816-L3827),
[3845–3888](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3845-L3888))

| Record | Loader construction |
| --- | --- |
| `mount` | `Mount.mountain(x,y,index*2*R)`, using its default random height/width. Also `water(x,y,index*2)`, whose **sort key** is `y-10000` while its geometry stays at `y`. |
| `flatmount` | `Mount.flatMount(x,y,2*R*pi)` with width `600+400R`, height `100`, cutoff `.5+.2R`. |
| `distmount` | `Mount.distMount(x,y,100R)` with height `150`, length chosen from `[500,1000,1500]`. |
| `boat` | `Arch.boat01(x,y,R)` with scale `y/800` and a random flip. |

([3888–3938](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3888-L3938))

The low water key causes water to be drawn behind landscape objects. Sorting by
base `y` gives near objects later white occlusion, not translucent blending of
equally spaced mountain bands. Equal-depth insertion has endpoint-specific
behavior (`<=` prepends at the front, `>=` appends at the back); it is not simply
an unspecified sort. `chunkrender` preserves the resulting order and includes
objects whose **anchors** fall within the visible interval plus 512 units.
Objects remain cached indefinitely in the source implementation.
([3846–3868](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3846-L3868),
[3973–3983](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L3973-L3983))

The final SVG is multiplied over a repeated 512-by-512 paper image. Paper uses
`c=245+10*Noise(i*.1,j*.1)-20R`, RGB `(c,.95c,.85c)`, rounded to integer channel
values, mirrored into four quadrants. White polygon fills remain paper-colored
after multiplication, while still occluding earlier ink within the SVG.
([4023–4037](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L4023-L4037),
[4336–4360](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L4336-L4360))

## Cost and dependencies

| Stage | Work and dependency |
| --- | --- |
| World candidate scan | About `range/5` columns times a height-dependent count of rows; each local-max check samples up to 16 neighbors. Accepted-placement checks scan preceding records. |
| Regular mountain grid | 500 points with four-octave noise; ten cumulative random offsets. |
| Regular mountain texture | 200 candidates, each up to 18 centerline points; two extra noise evaluations per point, then ribbon expansion. |
| Decoration candidates | Up to eight passes over the 500-point grid; middle-tree proof is worst-case quadratic in accepted candidate count, with early exit. Motif construction adds its own variable geometry. |
| Flat mountain | 250 grid points, 80 texture candidates, plateau subdivision, then a variable decoration recipe. |
| Rock | 500 ring points, per-ring endpoint correction/min-max normalization, 40 texture candidates. |
| Distant mountain | `length/50` polygon blocks at default segmentation; recursively generated triangles depend on geometric area. |
| Water | Ten centerlines, roughly 80–160 sampled points each at defaults; nine are stroked. |
| Retained world | Increasing object geometry/string storage; sorted insertion scans/shifts retained objects; visible assembly scans the retained list. |

The expensive work is repeated point evaluation, expansion, motif construction,
tessellation, string creation, DOM rebuilding, and rasterization. Moving only
the final raster image or already-generated CPU triangles to the GPU would not
move the procedural construction.

## What can move to the GPU without changing the construction

The following is a dependency analysis, not an implemented GPU design:

- **Independent geometry evaluations:** once object parameters, row offsets,
  noise table, and random choices are fixed, mountain-grid points, rock-ring
  samples, distant-ridge samples, water-centerline samples, and most motif points
  can be evaluated in parallel. Preserve the original formulas and sample counts.
- **Ridge texture:** after a grid exists, candidates can generate their own
  centerlines in parallel using the original row interpolation and jitter.
  Prefix sums or fixed bounded slots can give variable outputs disjoint storage.
- **Stroke expansion:** each interior point reads its two neighbors and expands
  independently once its stroke's random phase and width function are known.
  The GPU must rasterize the resulting tapered filled polygon, including any
  intended outline, rather than replacing it with an arbitrary SDF line.
- **Growth and proof:** grid growth predicates are parallel. Candidate collection
  needs stable row-major compaction; neighborhood proof can run in parallel over
  the collected list. Preserve motif output order after compaction.
- **Reductions and scans:** row-offset accumulation, `loopNoise` extrema and
  normalization, variable-geometry allocation, and stable ordering are GPU scan,
  reduction, or sorting problems. They are not reasons to substitute new noise.
- **Planner:** field evaluation/local maxima can be parallel, but `chadd`
  acceptance is order-dependent and occupancy affects the later island pass.
  Parallel acceptance must reproduce the sequential decisions, or disclose a
  change. Original random draw positions also depend on these decisions.
- **Distant tessellation:** independent polygon blocks and accepted triangles
  can be processed in parallel; recursive longest-edge splitting needs a bounded
  work queue or staged subdivision. Do not replace its facets with a smooth wash.
- **Drawing:** preserve an explicit painter sequence for opaque fills and
  translucent ribbons/blobs. Batching may change submission mechanics but must
  not reorder overlapping translucent primitives. Draw identifiers, not geometry
  calculations on the CPU, can coordinate that sequence.

The serial PRNG is the major obstacle to old-seed replay, rather than the
mountain formula. A GPU port must state whether a serial planning/random-choice
stage remains on the CPU, is executed on the GPU, or is replaced with a different
documented sequence. A small CPU control/descriptor stage is distinguishable
from CPU generation of every landscape point, but that division must be measured
and described accurately. No speedup follows from this document alone.

## Why the previous shader looked different

The rejected renderer generated bounded, independently hashed mountain cells,
painted continuous noise fields and analytic contour marks per pixel, and placed
a small motif catalog over them. That changed the construction at every important
step: world planning, nested ridge sampling, side-biased short strokes, white
occlusion, theme-based foreground decoration, distant triangle facets, and the
global sequence of random choices.

Increasing contrast, adding more noise, or translating those same formulas from
GLSL to WGSL cannot recover the original painting. The GPU port must first
reproduce the original ordered primitives and their construction. Validation
should compare, in sequence, fixed-parameter grid points, texture centerlines,
expanded stroke polygons, object-level drawings, placement records, and complete
landscapes against this CPU reference. Raster differences from floating-point
precision or antialiasing must be separated from changed geometry and missing
motifs.
