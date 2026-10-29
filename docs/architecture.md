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
            │    ├─ composition/index.ts        Wires recipes to one private context
            │    ├─ composition/geometry.ts     Shared control-point translations
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

The composition factory assembles recipes around a private context. The scene
module owns initial planning, paper sequencing, and view caching. They
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
[trees](original-trees.md), and [motifs](original-motifs.md). They cite the exact upstream revision used to establish parity.

## Shared construction rules

`composition/contracts.ts` owns recipe inputs and outputs. `geometry.ts` owns
control-point translation. Species-specific growth stays in its recipe; common
painting order belongs to private helpers: `paintTree`, `paintRidge`,
`outlinePaths` and `stories`. Helpers must preserve random consumption and
operand order, including apparently unused draws. The mathematical definitions
remain in the [source studies](upstream.md).

CPU doubles and GPU float32 implementations of noise and geometry are deliberate:
CPU geometry sometimes determines later topology, while GPU geometry paints
commands. Their agreement is tested against independent captured data. They
cannot share an implementation across the execution boundary without changing
precision or moving work between processors.

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

`landscape.ts` owns canvas leases, state notifications and terminal transitions.
`program.ts` owns native resources and releases partial setup on failure. Late
notifications cannot reactivate disposed sessions. Public failure/recreation and
subscription semantics are specified in [the API guide](../README.md#lifecycle-and-browser-support).

An unchanged view reuses the painted ink target and only composites it to the
canvas. Camera or size changes repaint the target; unchanged command lists reuse
their GPU-expanded points.

Capture snapshots its settings before handing PNG encoding to the canvas. HTML
and OffscreenCanvas encoding stay private to the program. Downloads, filenames,
error presentation and event scheduling belong to the caller; see
[capture semantics](../README.md#offscreencanvas-and-capture).

## Verification and change guide

[Verification](verification.md) owns commands, coverage and measured limitations.
The browser suite and image comparator share launch/cleanup in
`tests/helpers/browser.mjs`; page and worker probes share image decoding and
metrics in `tests/browser/support.mjs`. The fixture directory documents its
independent acceptance data and separate pre-refactor motif regressions.

- Change public options and lifecycle rules in the session/options modules.
- Change a motif in its recipe module and compare it with the cited upstream routine.
- Change command data shapes and GPU packing together; preserve emitted counts and order.
- Keep geometry-dependent CPU exceptions explicit, particularly `tree07` triangulation.
- Keep GPU allocation, submission, failures, and disposal in the program owner.
- Rebuild and validate after native shader edits; never edit generated shader output.
- Keep gestures and scheduling in the demo; keep the public exports in `src/index.ts`.
