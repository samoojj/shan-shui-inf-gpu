# How the original landscape is constructed

Source: [the pinned upstream implementation](upstream.md). This study owns
terrain construction and world planning; shared drawing mathematics live in
[primitives](original-primitives.md).

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
object's `y` anchor. Shared coordinate quantization, randomness, and noise
are described in [primitives](original-primitives.md).

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

### Texture

The mountain uses the [shared texture algorithm](original-primitives.md#the-source-primitives)
on its 50-column grid. At default interval length, each candidate contains at
most 18 centerline points and follows the sampled ridges.

Mountain shading selects `sha` from `[0,0,0,0,5]`. With `sha=0`, every candidate
is stroked at default width `1.5` with random gray alpha in `[0,.3)`. With
`sha=5`, even-indexed candidates first receive broad width-5, alpha-.1 strokes;
fine strokes then start at index 5 and advance by 6. The default mountain thus
requests either 200 fine strokes, or 100 broad plus 33 fine strokes, before
empty-path handling. ([668–683](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L668-L683),
[719–740](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L719-L740),
[1891–1897](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L1891-L1897))

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

Water ripple geometry is documented with [boats and figures](original-motifs.md#water-independent-ripple-paths-with-cumulative-spacing).

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

The selected paths are composited using the [shared paper procedure](original-primitives.md#randomness-and-paper).

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

For the implemented processor split and ownership, see [architecture](architecture.md).
For comparison procedures and measured differences, see [verification](verification.md).
