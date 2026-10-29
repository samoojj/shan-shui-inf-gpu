# Architecture

The library has one public interface: `createLandscape(canvas, options)`. A render
session owns the canvas and scene until disposal. Browser controls and animation
policy remain with the caller. The same session works with HTMLCanvasElement and
OffscreenCanvas; there is no renderer registry or interchangeable backend port.

## Ownership and dependencies

```text
src/index.ts                      Public exports and types
  └─ src/landscape.ts              Render session, readiness, capture
       ├─ src/options.ts          Validated settings, seed and sizing rules
       └─ src/webgl/program.ts    Complete GPU program, bindings and release
            └─ src/shaders.ts     Single-pass composition and uniform contract
                 ├─ painting.ts  Shared seeded fields, brush math and paper
                 ├─ water.ts     River layout, ripples and boats
                 └─ mountains.ts Terrain, surface ink and attached motifs
```

The shader source modules under `src/shaders/` are private authoring modules.
They produce one fragment program, with one fullscreen draw and no CPU-generated
landscape geometry. They do not create extra render passes or expose shader
fragments to consumers.

A mountain carries its placement facts into surface painting and attached motif
placement. Water layout owns the river extent, mountain offset, and boat height.
Composition chooses order and occlusion; it does not reconstruct those rules.

## Render-session invariant

A ready session owns exactly one fully constructed GPU program. Lost, failed,
and disposed sessions own none. The WebGL program module either returns a
complete program or releases every partially acquired object. Only that module
knows shader compilation, uniform locations, binding, resolution limits, and
WebGL deletion rules.

The session owns the transitions:

```text
creation ── successful first draw ──► ready
ready ── context loss ──────────────► context-lost
context-lost ── rebuild + draw ─────► ready
context-lost ── rebuild failure ────► error
any active state ── dispose ────────► disposed
```

Valid option updates during context loss are retained. Restoration reuses the
same acquisition-and-first-draw path as creation. `subscribe` reports renderer
readiness, including reconstruction failures, rather than asking a caller to
interpret native canvas events. A native restored event alone does not mean the
landscape is ready. Disposal releases the program, canvas listeners, and status
subscriptions; it cannot be undone by a later native event.

## Capture guarantee

`capture(patch?)` validates and applies its settings, draws, snapshots metadata,
and starts native PNG encoding before yielding. HTML canvas uses `toBlob`;
OffscreenCanvas uses `convertToBlob`. These are two actual platform variations,
handled privately rather than an externally configurable encoder abstraction.

The returned `blob`, `options`, `width`, and `height` describe that frame even if
another render or disposal occurs while encoding. A capture initiated while
lost, failed, or disposed rejects. Encoding already started can finish after
disposal. Encoding failures reject without breaking the render session.

The caller owns download presentation and animation-frame scheduling. It never
needs to preserve the drawing buffer or invoke render and readback in one task.

## Tests at the interface

Browser scenarios each own a fresh page, canvas, and render session. They test
image output and public behavior through the same interface as callers. Real
WebGL verifies shaders, pan overlap, recovery, capture, and worker use. Scoped
WebGL failure injection covers partial construction and failed restoration.
GPU instrumentation is confined to resource/budget tests; it is not the assertion
surface for every scene test.

The refactor is compared with six frames rendered from commit `7e227ad` on the
same Chromium/SwiftShader implementation. Seed, camera, water, mist, roughness,
vegetation, and mountain-count variations are included. Software-driver results
establish correctness only; hardware performance must be measured separately.

## Change guide

- Change lifecycle, status, or capture semantics in the render session.
- Add GPU resources and their cleanup in the WebGL program owner.
- Change placement and painting together in the relevant private scene module.
- Keep `src/index.ts` as the export surface; internal modules are not package exports.
- Keep demo gestures and scheduling in `examples/demo.js`; its HTML and CSS are presentation.
- Add behavior coverage through a fresh renderer, rather than testing private helpers or sharing mutable state between scenarios.
