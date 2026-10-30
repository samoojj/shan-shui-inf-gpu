# Brush construction and the GPU port

Source: [LingDong-/shan-shui-inf, pinned CPU reference](upstream.md).
The procedural drawing is a sequence of objects and brush marks, not an implicit
terrain surface. Preserve those objects and marks before changing their executor.

## The source primitives

`poly` ([485–509](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L485-L509)) emits an SVG polyline.
Coordinates are translated and rounded to one decimal place. Its fill uses the
SVG nonzero winding rule, including an implicit closing edge. Its stroke remains
open unless the input explicitly repeats the first point. Fill, stroke color,
and stroke width are independent; white fills hide previously painted marks.

`stroke` ([516–576](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L516-L576)) is a polygon generator,
not an SVG line stroke. It consumes one random `n0` for every nonempty input. At
interior point `i`, width is `wid * fun(i / count)`, modulated by
`(1 - noi) + noi * Noise.noise(i * 0.5, n0)`. The two neighboring segment angles
define a bisector, with the original angle-wrap correction. Positive and negative
offset boundaries form a closed polygon around the centerline, with pointed
endpoints. Default `fun` is `sin(pi*t)`. The resulting polygon also receives a
one-unit SVG outline by default. Replacing this with a constant-width line loses
the taper, varying edges, pointed ends, and darker outline.

`blob` ([578–625](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L578-L625)) samples 21 profile points
over `p=0..2`. Longitudinal position is `len/2 - abs(p-1)*len`; transverse position
is `fun(p)*wid/2`. The original converts these into polar coordinates, rotates by
`ang`, and multiplies each radius by a noisy factor. Its 21 noise samples are
first seam-corrected and min/max-normalized by `loopNoise` ([404–415](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L404-L415)).
One independent random noise offset is consumed per blob. The default profile is `sqrt(sin(p*pi))` for `p<=1` and
`-sqrt(sin((p+1)*pi))` afterwards. Tree styles supply different profiles;
those shapes must remain distinct. `ret:1` is used
by tree07 so its leaf polygons can be triangulated and shaded on the CPU.

`texture` creates short centerlines from a contour grid. It chooses all segment
extents before painting any marks; even an empty interval participates in that
sampling pass.

For texture candidate `t` out of `T`, choose a center column from the outer
thirds of the row, a half-length `floor(R * columnCount * .2)`, and clip the
column interval. The default distribution uses two draws: one selects a side,
one chooses a position within that third.
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

It emits the shade pass before the detail pass, both through `stroke`. Shade
uses every other candidate; detail starts at index `sha` and steps by `1+sha`.
The default detail color consumes another random value. The mountain-specific
shade choices and resulting counts are documented in [terrain texture](original-landscape.md#texture).

`bezmh` samples rational quadratic curves at twenty subdivisions per span, with
midpoint joins. `div` samples straight segments at explicit subdivisions. These
form control paths for clothing, roofs, rails, and branches; replacing their
sampling with an unrelated curve changes those motifs.

## Randomness and paper

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
  4342. Paper advances the stream before later user-driven chunk generation.
  Running only the construction functions
  omits this application-level advancement.

`randGaussian` rejection-samples `exp(-24*(x-.5)^2)` on [0,1] and remaps
it to [-1,1]; it is not a standard normal sample. `randChoice` consumes a draw
even for a one-element array. WGSL noise retains the table's wrap constants
16/256/4095, with float32 arithmetic instead of the source's doubles.

The original scene is painted over white, then multiplied over a mirrored
512-square paper texture ([4335–4361](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L4335-L4361)).
Paper uses `245 + noise(i*.1,j*.1)*10 - random()*20`, with RGB multipliers
`1/.95/.85`, integer rounding, and mirrored coordinates. It consumes 66,049
random values after initial scene generation. A generic beige background and
white fog are not equivalent to this composition.

The [architecture](verification.md) describes which operations
run on each processor. The [verification report](verification.md) records
composition, coordinate and image checks.
