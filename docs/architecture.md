# Architecture

The public interface is `await createLandscape(canvas, options)`. A render
session owns its canvas, options, readiness, and capture until disposal. Its
implementation combines the original CPU composition rules with GPU brush
construction and rendering through vgpu 0.6.0. Calling code owns interaction and
animation policy.

## Ownership and dependencies

```text
src/index.ts                         Public exports and types
  └─ src/landscape.ts                 Canvas lease, options, status, capture
       ├─ src/options.ts             Seed/view validation and target sizing
       └─ src/gpu/program.ts         Device, buffers, pipelines, frames, cleanup
            ├─ src/scene/compose.ts  One seeded composition and chunk cache
            │    ├─ composition/context.js      Original arithmetic and utilities
            │    ├─ composition/world.js        Original planner and painter order
            │    ├─ composition/mountains.js    Mountains, foothills, rocks
            │    ├─ composition/trees.js        Eight recursive tree recipes
            │    ├─ composition/architecture.js Buildings, boats, towers
            │    ├─ composition/people.js       Skeleton, clothes, hats, staff
            │    ├─ composition/water.js        Original sampled ripple clusters
            │    └─ composition/primitives.ts   Typed drawing commands
            │         └─ signage.ts             Fixed vector plaque glyphs
            ├─ src/scene/commands.ts Drawing data shapes
            ├─ src/scene/pack.ts     GPU storage layout and exact emitted counts
            └─ prepared shaders
                 ├─ brushes.wgsl    Compute-generated contour/blob/texture points
                 ├─ paths.wgsl      Ordered fills and outlines
                 └─ paper.wgsl      Original paper composition

src/shaders/commands.wgsl            Shared GPU command layout
src/shaders/noise.wgsl               Original noise sampling from the seeded table
scripts/build.mjs                   Type declarations, WGSL preparation, ES bundle
```

The scene module assembles the recipe factories around a private context. They
retain original arithmetic and branch order while replacing SVG strings with
ordered drawing-command arrays. Plain JavaScript preserves the original recipes
in recognizable form; typed scene/command interfaces contain their interaction
with the renderer. The build includes both JavaScript and TypeScript sources.
No browser globals are needed to compose a scene.

The GPU program owns the concrete device, surface, intermediate color target,
compute/draw/effect pipelines, bindings, command buffers, and GPU failures. These
resources do not escape into the demo or recipe modules. The session owns the
canvas lease and public lifecycle. There is one backend and no renderer registry.

## The CPU/GPU seam

A drawing command describes an original path or brush operation and its paint,
random offset, and parameters. It is not an SVG string or raster image. CPU
composition preserves topology decisions and ordered random consumption; GPU
execution expands the eligible commands and paints them.

| Stage | CPU ownership | GPU ownership |
| --- | --- | --- |
| Planning | Original seeded stream, lazy Perlin table, chunk placement, spacing tests, chunk insertion order | None |
| Motifs | Recursive branches, control paths, rational curve samples, architecture/figure construction, variable output counts | None of those decisions are replaced by an analytic landscape field |
| Brushes | Width profiles, random decisions, texture interval selection, command packing | Stroke contour expansion, texture interpolation/jitter, drawn blob outlines, generated bounds |
| Geometry used by later rules | Original `blob({ ret: 1 })` points and recursive `tree07` triangulation remain on the CPU | Ordinary drawn blobs need no CPU-expanded outline |
| Rendering | Submit the original command order and view | Nonzero path fills, outlines, alpha blending and white occlusion masks |
| Paper | Consume original paper random values after initial scene planning | Mirror the 512 × 512 tile, evaluate its noise/color, multiply with the rendered scene |

This is a hybrid port. Some polygons and control geometry originate on the CPU;
the expensive expanded brush data and raster output are generated on the GPU.
Moving the original topology or PRNG to a different algorithm would change the
composition, even if its output looked plausible.

When the view requests new terrain, the scene extends its chunk cache using the
original planner. When the drawing changes, packing uploads the needed control
commands and compute generates their output points. Repeated views can reuse the
same commands. A frame paints the ordered paths into an intermediate target and
then composites the paper onto the canvas. There are multiple GPU stages, not a
single fullscreen landscape formula.

The source audits are the implementation guide:
[planning](original-landscape.md), [primitives](original-primitives.md),
[trees](original-trees.md), and [motifs](original-motifs.md). They cite the archived
upstream source rather than infer its rules from screenshots.

## Randomness and comparison invariants

The seed is `encodeURIComponent(String(seed))`, matching a value passed through
the original URL interface. `context.js` preserves the PRNG's JavaScript Number
arithmetic and lazy 4096-entry Perlin allocation. It uses a private Math object;
importing or rendering cannot replace the host application's `Math.random`.

Composition starts with the original initial world request, then consumes paper
randomness before subsequent exploration. New chunk requests continue that
stateful stream. Repeating a fresh session with the same seed and request history
repeats composition; arbitrary exploration orders need not converge to the same
world. Captured options do not serialize this history or the chunk cache.

Keep unused original random draws, duplicate endpoint handling, numeric defaults,
and painter ordering unless an intentional deviation is separately documented.
GPU math uses `f32`; reference math uses JavaScript doubles. Path antialiasing
also differs from browser SVG. Comparisons must distinguish exact composition
facts from measured pixel differences. The plaque's bundled Liberation Sans
outlines are an explicit substitution for the original Verdana request.

## Native WGSL build

The three entry shaders own their resource bindings and import shared WGSL data
and noise helpers. `scripts/build.mjs` resolves and prepares their module graphs
and reflection, then bundles the runtime as `dist/index.js`. The WGSL parser and
resolver are build dependencies and do not ship in the browser entry. Generated
artifacts are not shader sources; edit the native `.wgsl` files.

The build also emits declarations from the TypeScript interface and included
JavaScript recipes. Build-time preparation does not prove that a device accepts
the shaders. Device validation and browser rendering are separate checks.

## Session lifecycle and capture

```text
asynchronous creation ── setup + first draw ──► ready
ready ── GPU device loss ────────────────────► device-lost
ready ── fatal rendering error ──────────────► error
any active state ── dispose ─────────────────► disposed
```

A ready session owns a complete program. Failed construction releases partial
resources and its canvas lease. Device loss and rendering failure are terminal;
callers dispose and recreate the session. Render/resize throw and capture rejects
when unavailable. No native browser event is an alternative source of readiness.
`subscribe` reports current state immediately and then changes; disposal clears
subscriptions and prevents late device notifications from reactivating a session.

An unchanged view reuses the painted ink target and only composites it to the
canvas. Camera or size changes repaint the target; unchanged command lists reuse
their GPU-expanded points.

`capture(patch?)` validates options, draws, snapshots dimensions and settings,
starts PNG encoding, and checks submitted GPU work. HTML and OffscreenCanvas
encoding differences stay private. Once encoding starts, later renders or
disposal cannot relabel that snapshot. A captured seed/view does not imply a
portable serialization of the planner's prior exploration history. Filenames,
downloads, error presentation, and requestAnimationFrame scheduling stay with the
caller.

## Verification and change guide

The upstream reference harness pins the original commit and Git blob, captures
native-scale scenes and 23 isolated primitives, and checks repeats in fresh
realms. It uses the original SVG application only as a test reference. The
library neither executes that HTML nor uploads its rasterized output.

Recipe comparisons should inspect topology, command order, control geometry,
and random state. GPU comparisons should use the same source seed, generation
history, and viewport, then report actual error measurements and any tolerance.
Interface tests own fresh canvases and cover seeds, panning, resizing, capture,
cleanup, errors, and device loss. Software-adapter checks establish tested
behavior; hardware speedup requires separate measurements.

- Change public options and lifecycle rules in the session/options modules.
- Change a motif in its recipe module and compare it with the cited upstream routine.
- Change command data shapes and GPU packing together; preserve emitted counts and order.
- Keep geometry-dependent CPU exceptions explicit, particularly `tree07` triangulation.
- Keep GPU allocation, submission, failures, and disposal in the program owner.
- Rebuild and validate after native shader edits; never edit generated shader output.
- Keep gestures and scheduling in the demo; keep the public exports in `src/index.ts`.
