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
One independent random noise offset is consumed per blob. Tree styles supply
different profile functions; those shapes must remain distinct. `ret:1` is used
by tree07 so its leaf polygons can be triangulated and shaded on the CPU.

`texture` ([653–741](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L653-L741)) creates many short
centerlines from a contour grid. It first chooses all random segment extents.
For each selected column, it interpolates neighboring contour rows using the
original reversed weights: `floorRow*p + ceilRow*(1-p)`. Two noise evaluations
perturb x and y independently, scaled by `noi(layer+1)`. It then emits a shade
pass and a detail pass, each through `stroke`, in that order. The default detail
color consumes another random value; changing callback order changes later
scene objects. The row interpolation, perturbation, ribbon expansion, and raster
work are independent across brush commands once these decisions are recorded.

`bezmh` samples rational quadratic curves at twenty subdivisions per span, with
midpoint joins. `div` samples straight segments at explicit subdivisions. These
form control paths for clothing, roofs, rails, and branches; replacing their
sampling with an unrelated curve changes those motifs.

## Randomness and paper

The source PRNG squares a JavaScript double modulo `999979 * 999983`. Its integer
products exceed JavaScript's exact integer range. A u32 hash or a float32 WGSL
version will produce a different sequence. Keep serial composition decisions
and this double-precision PRNG together. The lazy 4096-entry noise table consumes
the same stream on first use; record that table for WGSL noise evaluations.
The GPU noise function must retain p5's absolute coordinates, cosine interpolation,
wrap constants 16/256/4095, four octaves, and 0.5 amplitude falloff.

The original scene is painted over white, then multiplied over a mirrored
512-square paper texture ([4335–4361](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html#L4335-L4361)).
Paper uses `245 + noise(i*.1,j*.1)*10 - random()*20`, with RGB multipliers
`1/.95/.85`, integer rounding, and mirrored coordinates. It consumes 66,049
random values after initial scene generation. A generic beige background and
white fog are not equivalent to this composition.

## Execution boundary

Preserve the upstream planner, object constructors, branching choices, primitive
order, and random consumption. Refactor SVG concatenation into ordered typed
drawing commands. CPU control data describes original contours, paths, profiles,
and random decisions. It must not contain an SVG image to upload.

Generate brush polygon vertices on the GPU: texture interpolation and jitter,
stroke width/noise/bisectors, and blob profile/noise/rotation. Render the resulting
ordered paths with nonzero fill and stroke semantics, then multiply over paper.
This makes the expensive repeated brush construction and rasterization GPU work
while retaining the original serial composition grammar. It is a hybrid port;
the top-level planner and recursive motif topology still execute on the CPU.

Verification must compare the port to the pinned upstream, not to the rejected
replacement shader: random states, object plans, path counts/order, primitive
coordinates, and whole images. Floating-point and rasterizer differences need
measured tolerances and direct visual inspection. Do not change the reference
or call a different composition a successful port.
