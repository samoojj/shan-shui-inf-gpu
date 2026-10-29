# Shan shui GPU

A TypeScript library port of [Lingdong Huang’s shan-shui](https://github.com/LingDong-/shan-shui-inf)
that preserves the original landscape construction and uses native WebGPU through
[vgpu](https://github.com/vercel-labs/vgpu) **0.6.0** to generate brush geometry and
render it. It includes the original mountains, rocks, eight tree styles,
buildings, figures, boats, and water strokes.

The implementation is hybrid. The CPU runs the original seeded planner,
recursive motif construction, and topology decisions. GPU compute performs
texture displacement, stroke expansion, and drawn leaf/blob geometry; GPU
rendering composites the ordered paths and original paper pattern. This retains
the original method while moving substantive generation and rendering work to
the GPU. Output is a raster canvas with PNG capture.

## Build and try it

Use Node.js 22 or newer:

```sh
npm install
npm run demo
```

Open [localhost:4173/examples/](http://localhost:4173/examples/) in a browser with
WebGPU support and an available adapter. WebGPU requires a secure context: use
HTTPS in production; localhost works for development.

The example supports seed selection, horizontal dragging, keyboard panning,
zoom, reset, and PNG export. Generating a seed returns the view to the original
scale. It renders on input or resize, without a continuous animation loop.

The package has not been published to a registry. Build it, then install it into
another project from disk:

```sh
npm install /absolute/path/to/shan-shui-inf-gpu
```

`dist/index.js` is a browser-ready ES module containing the library and vgpu
runtime. The build prepares the native WGSL modules and their binding reflection;
the browser bundle does not include the WGSL parser/resolver. Consumers need no
WGSL loader. TypeScript declarations accompany the bundle.

## Use the library

```ts
import { createLandscape } from "shan-shui-gpu";

const canvas = document.querySelector<HTMLCanvasElement>("#landscape")!;
const landscape = await createLandscape(canvas, {
  seed: "1234",
  width: 1200,
  height: 700,
  pixelRatio: 1,
  zoom: 1.142,
});

// Creation resolves after setup and the initial draw.
landscape.render({ cameraX: 400 });
landscape.render({ seed: "quiet-morning", cameraX: 0 });
landscape.resize(900, 600, 1.5);

const image = await landscape.capture();
// image.blob is the PNG; image.options describes its captured settings.

landscape.dispose();
```

Without an application bundler, import `../dist/index.js` from an example module
and serve the files over localhost HTTP or HTTPS. Importing the package is safe
during server-side rendering; GPU initialization begins at `createLandscape()`.
For React or Next.js, create the renderer in a client effect and dispose it on
cleanup. Also dispose a renderer whose asynchronous initialization finishes after
the effect has already been cleaned up.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `"1234"` | String or finite number; converted to a string and URL-encoded for the original seed routine. Maximum encoded length: 96 characters. |
| `width`, `height` | Canvas dimensions | Integer logical dimensions, `1`–`16384`. If the canvas dimension is zero, the fallback is `1200` × `700`. Set CSS dimensions separately. |
| `pixelRatio` | `1` | Backing resolution multiplier, `0.25`–`4`. |
| `cameraX`, `cameraY` | `0`, `0` | Offset in original drawing coordinates, within ±8192. Positive y points downward. |
| `zoom` | `1.142` | Logical screen pixels per drawing unit, `0.25`–`4`. The visible extent is `width / zoom` by `height / zoom`. |

`DEFAULT_OPTIONS` is exported; its explicit dimensions are 1200 × 700.
The original composition determines vegetation, mountain placement, water,
colors, and ink density. Earlier approximation controls such as `layers`,
`mist`, and `vegetation` are no longer accepted. Unknown options throw.

| Method | Behavior |
| --- | --- |
| `render(patch?)` | Validates a partial update and submits a draw. May generate newly requested landscape chunks on the CPU. |
| `resize(width, height, pixelRatio?)` | Updates dimensions and draws. |
| `getOptions()` | Returns a copy of the resolved settings. |
| `getStatus()` | Returns `"ready"`, `"device-lost"`, `"error"`, or `"disposed"`. |
| `subscribe(listener)` | Delivers `{ status, error }` immediately and on state changes; returns an unsubscribe function. |
| `capture(patch?)` | Draws and returns a promise for `{ blob, width, height, options }`. |
| `dispose()` | Releases resources and subscriptions; safe to repeat. |

Backing resolution is capped at 8,388,608 pixels and 8192 pixels per dimension,
or the device limit if lower. Both dimensions scale down together. Read
`canvas.width`/`height` or capture metadata for actual output dimensions;
`getOptions()` retains the requested logical dimensions and pixel ratio. This
render-target cap does not cap the number of landscape commands in memory.
The visible width (`width / zoom`) is limited to 8192 drawing units and is
validated before generation, so a very wide canvas at minimum zoom cannot
request tens of thousands of world units in one call.

### Lifecycle and browser support

`createLandscape()` and `isWebGPUSupported()` are asynchronous. Initialization
rejects if options are invalid, WebGPU is unavailable, or device, pipeline, or
resource setup fails. Catch this and show a suitable fallback.

```ts
import { isWebGPUSupported } from "shan-shui-gpu";

if (await isWebGPUSupported()) {
  // Adapter availability is a preliminary check; creation can still fail.
}
```

A session owns its canvas until disposed; concurrent sessions cannot use the
same canvas. Subscribe to readiness rather than inferring it from browser events:

```ts
const unsubscribe = landscape.subscribe(({ status, error }) => {
  saveButton.disabled = status !== "ready";
  if (error) statusElement.textContent = error.message;
});
```

Device loss and rendering errors are terminal for a session. Further render and
resize calls throw; capture rejects. Dispose it and await a new
`createLandscape()` call to start again. There is no automatic restoration or
fallback backend. `unsubscribe()` detaches a listener; `dispose()` also releases
all subscriptions.

Resize is explicit. A `ResizeObserver` can measure CSS dimensions and call
`resize()`. The demo coalesces pointer and resize events with
`requestAnimationFrame`; the library installs no page event handlers or animation
loop.

### OffscreenCanvas and capture

The same interface accepts `OffscreenCanvas` where WebGPU is available in workers.
Transfer an HTML canvas before initializing its renderer:

```ts
// Main thread
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker(new URL("./landscape-worker.js", import.meta.url), {
  type: "module",
});
worker.postMessage({ canvas: offscreen }, [offscreen]);
```

```ts
// landscape-worker.js; adjust the module path for your project.
import { createLandscape } from "./dist/index.js";

self.onmessage = async ({ data }) => {
  let landscape;
  try {
    landscape = await createLandscape(data.canvas, {
      seed: "1234", width: 1200, height: 700,
    });
    const image = await landscape.capture();
    self.postMessage({ blob: image.blob, options: image.options });
  } catch (error) {
    self.postMessage({ error: String(error) });
  } finally {
    landscape?.dispose();
  }
};
```

`capture(patch?)` applies the requested settings, draws, and snapshots the PNG and
its metadata together. Calls made after loss, failure, or disposal reject
without applying the patch. Once encoding starts, subsequent renders or disposal
do not relabel that image. Use `image.options.seed` for the filename, even if the
user changes seeds while encoding. GPU submission or encoding errors reject.
Normal draws do not read image pixels back to JavaScript; PNG capture does.
There is no SVG export.

## Fidelity, determinism, and execution

The [upstream provenance](docs/upstream.md) identifies the original revision.
The [architecture](docs/architecture.md#the-cpugpu-seam) defines the hybrid
execution boundary. Random state is private to each scene.

Fresh sessions with the same seed and sequence of view requests reproduce the
same composition. The original planner extends a cached world in requested
chunk order: exploring new regions in a different order can produce different
later content. This is not a position-hashed, order-independent infinite world.
A capture records view settings, not the history needed to reconstruct every
previously explored chunk. Changing to a different seed starts a fresh scene. An explicit empty string is
also deterministic; the original application instead uses the current time
when its seed query parameter is empty.

The original also culls chunks by their anchor position with a 512-unit margin,
not by their full shape. A long distant mountain can therefore disappear
abruptly while panning when the camera reaches its anchor plus 512 units, even
if part of the mountain would still be visible. This upstream behavior is retained.

GPU `f32` calculations and raster antialiasing differ from JavaScript doubles
and browser SVG rasterization. Exact pixel identity is not assumed. The original
“Pizza Hut” label is retained using bundled Liberation Sans vector outlines in
place of Verdana; this is an explicit font substitution. Pixel comparison with
the upstream reference must report its viewport, seed/history, and measured
tolerance rather than claim visual equivalence from reproducibility alone.

Generating a new seed or new chunks costs CPU time and allocates control data.
Cached chunks remain for the session; wider exploration increases memory use.
GPU cost depends on command count, brush samples, overlapping paths, and backing
resolution. Start with pixel ratio 1 and redraw only when needed. No hardware
speedup or frame-rate guarantee has been established. Software WebGPU results
validate tested behavior, not hardware performance.

## Development and verification

[Source studies](docs/upstream.md) document terrain, primitives, trees and motifs.
[Architecture](docs/architecture.md) describes ownership and change boundaries.
The [verification report](docs/verification.md) is the single guide to running
checks, understanding their coverage and reviewing measured differences.

## Attribution and license

The original algorithm and source are MIT-licensed, copyright 2018 Lingdong
Huang; see [LICENSE](LICENSE). Ported composition modules retain that attribution
and source locations. vgpu is an MIT-licensed dependency from Vercel Labs; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The signage outlines derive from
Liberation Sans under the [SIL Open Font License](licenses/LiberationSans-OFL.txt).

Images in `screenshots/` are historical output of the original SVG application.
They are retained as references and do not demonstrate this renderer's output.
