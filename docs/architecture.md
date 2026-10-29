# Architecture

The library has one public creation interface: `await createLandscape(canvas,
options)`. A render session owns one canvas and its landscape until disposal.
Browser controls and animation policy remain with the caller. HTMLCanvasElement
and OffscreenCanvas use the same session; there is one concrete WebGPU backend,
built with vgpu 0.6.0.

## Ownership and dependencies

```text
src/index.ts                        Public exports and types
  └─ src/landscape.ts                Render session, readiness, capture
       ├─ src/options.ts            Validated settings, seed and sizing rules
       └─ src/gpu/program.ts        vgpu device, surface, effect and frames
            └─ prepared shader     Built from native WGSL before shipping

src/shaders/landscape.wgsl           Entry point, bindings and composition
  ├─ params.wgsl                    Shared parameter data shape
  ├─ painting.wgsl                  Seeded fields, brush math and paper
  ├─ water.wgsl                     River layout, ripples and boats
  └─ mountains.wgsl                 Terrain, surface ink and attached motifs

scripts/build.mjs                   Resolve/prepare WGSL, types, browser bundle
```

The render session owns validated options, the canvas lease, readiness transitions,
and the capture guarantee. The GPU program module owns vgpu initialization,
pipeline preparation, the canvas surface, uniform bindings, frame submission,
and GPU error handling. Creation is asynchronous because acquiring a WebGPU
device and preparing its pipeline are asynchronous operations.

These are concrete ownership modules, not an interchangeable renderer framework.
There is no backend registry, injectable graphics driver, or raw WebGL path.

## Native shader composition

The shader modules are authored in WGSL, using vgpu’s module syntax. Only the
entry module declares resource bindings. Imported modules export data shapes and
pure painting functions. A mountain carries placement facts into surface painting
and attached motif placement. Water layout owns river extent, mountain offset,
and boat height. Composition chooses order and occlusion rather than rebuilding
those rules.

`scripts/build.mjs` resolves the complete import graph and prepares the resulting
WGSL and binding reflection at build time. It then bundles the library and the
vgpu browser runtime into `dist/index.js`, alongside TypeScript declarations.
The browser receives a prepared shader artifact: it does not load a WGSL parser,
resolve source modules, or translate GLSL at runtime. The authored `.wgsl` files
remain the source of truth.

The modules produce one fullscreen effect. They do not introduce additional
landscape render passes or CPU-generated scene geometry. Consumers of the built
library need neither a WGSL loader nor access to its internal shader modules.

## Render-session invariant

A ready session owns a complete GPU program. Failed, device-lost, and disposed
sessions cannot submit new frames. Partial construction releases acquired
resources, and disposal releases the program and canvas lease.

The session owns the transitions:

```text
asynchronous creation ── setup + first draw ──► ready
ready ── GPU device loss ────────────────────► device-lost
ready ── fatal rendering error ──────────────► error
any active state ── dispose ─────────────────► disposed
```

Device loss is terminal for the session: a lost WebGPU device cannot be restored.
The caller must dispose the session and await a new `createLandscape()` call.
There is no native canvas-restoration event and no automatic transition from
`device-lost` back to `ready`. Render and resize throw on a lost, failed, or
disposed session; capture rejects its promise.

`subscribe` immediately delivers the current `{ status, error }` and then actual
renderer state changes. The UI does not infer readiness from browser events.
Disposal releases status subscriptions; a later device-loss notification cannot
reactivate the session.

## Capture guarantee

`capture(patch?)` belongs to the session. It validates and applies settings,
renders, snapshots scene metadata and dimensions, and coordinates PNG encoding.
The caller never has to arrange render and readback in the same browser task.
HTML canvas and OffscreenCanvas encoding are actual platform variations handled
privately, not an externally configurable encoder abstraction.

The returned `blob`, `options`, `width`, and `height` describe the captured frame.
Once encoding has started, later renders or disposal do not relabel the image or
change its metadata. A capture initiated while lost, failed, or disposed rejects.
GPU readback or encoding failures also reject. Download filenames, saving UI, and
animation-frame scheduling stay with the caller.

## Tests at the interface

Browser scenarios own fresh canvases and render sessions. They exercise image
output and observable behavior through the same interface as callers, including
asynchronous creation, deterministic generation, panning, sizing, device loss,
capture, and worker use. Focused instrumentation verifies the GPU work budget;
it is not the assertion surface for every landscape test.

A native WGSL port is not assumed to be pixel-identical to the earlier GLSL
renderer. Repeatability is checked within the same backend and implementation;
visual review checks that the ink landscape character remains recognizable.
Software-adapter results establish tested correctness only. Hardware performance
and cross-vendor pixel consistency require separate measurement.

## Change guide

- Change options, status, canvas ownership, or capture semantics in the session.
- Add GPU resources, bindings, and cleanup in the vgpu program owner.
- Change placement and painting together in the relevant WGSL module.
- Keep bindings in `landscape.wgsl` and imported WGSL modules pure.
- Run the build after shader edits; never hand-edit the prepared output.
- Keep `src/index.ts` as the export surface; internal modules are not package exports.
- Keep demo gestures and scheduling in `examples/demo.js`; its HTML and CSS are presentation.
- Add behavior coverage through a fresh renderer rather than shared mutable state.
