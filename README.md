# Shan shui GPU

A standalone TypeScript library for seeded Chinese ink landscapes, inspired by
[Lingdong Huang’s shan-shui](https://github.com/LingDong-/shan-shui-inf) and the
[`samoojj/shan-shui-inf-gpu` fork](https://github.com/samoojj/shan-shui-inf-gpu).
Mountains, brush textures, vegetation, and water are generated in WebGL2 shaders.
The library has no runtime dependencies and does not depend on React or Next.js.

This is an artistic reimplementation. It does not reproduce the original SVG
paths, seed outputs, or complete catalog of tree and architectural styles.
Output is a raster canvas, suitable for a background, interactive landscape,
or image export.

## Build and try it

From this repository’s root:

```sh
npm install
npm run build
npm run demo
```

Open [localhost:4173/examples/](http://localhost:4173/examples/). The example
supports seeds, horizontal dragging and keyboard panning, mist, vegetation,
mountain layers, zoom, and PNG export. It renders only after an input or resize;
there is no automatic animation.

The package has not been published to a registry. To use the built package in
another project, install it from disk:

```sh
npm install /absolute/path/to/shan-shui-inf-gpu
```

Build the package before installing it from disk. The only build dependency is
TypeScript.

## Use the library

```ts
import { createLandscape } from "shan-shui-gpu";

const canvas = document.querySelector<HTMLCanvasElement>("#landscape")!;
const landscape = createLandscape(canvas, {
  seed: "quiet-morning",
  width: 1200,
  height: 700,
  pixelRatio: 1,
  layers: 5,
  mist: 0.45,
});

// Creation draws immediately. Later calls change only the supplied options.
landscape.render({ cameraX: 400 });
landscape.render({ seed: "another-valley", vegetation: 0.8 });
landscape.resize(900, 600, 1.5);

// Release GPU resources and event listeners when the canvas is unmounted.
landscape.dispose();
```

For an unbundled browser example, import `../dist/index.js` relative to your
HTML file and serve the files over HTTP. No browser APIs are accessed at module
import time; create a renderer only on the client. In React or Next.js, create
it in an effect and call `dispose()` in the effect’s cleanup.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `"shan-shui"` | String or finite number. Determines the procedural world. |
| `width`, `height` | Canvas dimensions | Integer logical dimensions, `1`–`16384`. Set canvas CSS dimensions separately. |
| `pixelRatio` | `1` | Backing resolution multiplier, `0.25`–`4`. Higher values increase pixel cost. |
| `cameraX`, `cameraY` | `0`, `0` | World-space camera offset, within ±1,000,000. |
| `zoom` | `1` | Magnification, `0.25`–`4`. At `1`, the view is 1,000 world units high. |
| `layers` | `5` | Integer mountain layer count, `1`–`8`. |
| `roughness` | `0.55` | Terrain roughness, `0`–`1`. |
| `inkDensity` | `0.7` | Ink strength, `0`–`1`. |
| `mist` | `0.45` | Atmospheric softness, `0`–`1`. |
| `vegetation` | `0.55` | Vegetation density, `0`–`1`. |
| `water` | `0.5` | Water detail strength, `0`–`1`. |
| `paper` | `[0.96, 0.95, 0.91]` | Paper RGB color, each channel `0`–`1`. |
| `ink` | `[0.12, 0.15, 0.14]` | Ink RGB color, each channel `0`–`1`. |

`render(patch?)` validates and applies a partial option update, then draws.
`resize(width, height, pixelRatio?)` updates the drawing dimensions and draws.
`getOptions()` returns a copy of the resolved options. `getStatus()` returns
`"ready"`, `"context-lost"`, `"error"`, or `"disposed"`.
`subscribe(listener)` delivers the current `{ status, error }` immediately and
subsequent readiness changes; it returns an unsubscribe function.
`capture(patch?)` returns a promise for a PNG and its scene metadata, as described
below. `dispose()` releases the renderer and its subscriptions. Recreate the
renderer when you need it again after disposal.

Backing resolution is capped at 8,388,608 pixels and 8192 pixels per dimension
(or the device limit, if lower), scaling down both dimensions together. Inspect
`canvas.width` and `canvas.height` for the actual render/export dimensions;
`getOptions()` retains the requested logical size and pixel ratio.

### Browser support and lifecycle

WebGL2 is required. `createLandscape()` throws if the browser cannot create a
context, compile the shaders, allocate resources, or accept the supplied
options. Catch initialization failures and show an appropriate fallback in your
application. `isWebGL2Supported()` is an optional capability probe; successful
probing does not guarantee a later allocation will succeed.

The renderer owns the canvas’s WebGL context. Use a dedicated canvas and do not
share its context with another rendering engine. Context loss interrupts
rendering; on restoration, the library rebuilds resources and redraws the last
state. Subscribe to the renderer when your UI needs to reflect readiness:

```ts
const unsubscribe = landscape.subscribe(({ status, error }) => {
  // Update your application's readiness indicator or fallback.
  console.log(status);
  if (error) console.error(error);
});
// Later, detach this observer without disposing the landscape:
unsubscribe();
```

A native context-restored event is not proof that shaders and resources rebuilt
successfully. Subscribers receive `"ready"` only after reconstruction and its
first draw succeed; a failure produces `"error"` with the original error.
The session remains unusable until disposed and recreated. Listener exceptions
are reported to the browser without changing renderer readiness.

Resize is explicit. A `ResizeObserver` can measure CSS dimensions and call
`resize()`. Coalesce frequent pointer and resize events with
`requestAnimationFrame`; the library does not install an animation loop or
change page styles. The example demonstrates both behaviors.

### OffscreenCanvas

The same API accepts an `OffscreenCanvas` in browsers that support WebGL2 in
workers. Transfer a canvas before creating a renderer:

```ts
// Main thread
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker(new URL("./landscape-worker.js", import.meta.url), {
  type: "module",
});
worker.postMessage({ canvas: offscreen }, [offscreen]);
```

```ts
// landscape-worker.js
import { createLandscape } from "shan-shui-gpu";

self.onmessage = async ({ data }) => {
  const landscape = createLandscape(data.canvas, {
    seed: "worker-landscape",
    width: 1200,
    height: 700,
  });
  try {
    const image = await landscape.capture();
    self.postMessage({ blob: image.blob, options: image.options });
  } finally {
    landscape.dispose();
  }
};
```

### Export

Capture works with both HTMLCanvasElement and OffscreenCanvas, including after
asynchronous application work. The renderer owns drawing-buffer timing:

```ts
const image = await landscape.capture({ seed: "evening-river" });
// image.blob is a PNG; image.width/height are its actual backing dimensions.
// image.options describes the captured scene, even if a newer frame exists.
// Upload, download, or display image.blob using your application's UI.
```

The optional patch is validated and applied before capture. A capture initiated
while the context is lost, restoration has failed, or the renderer is disposed
rejects without applying the patch. Invalid settings and encoding failures also
reject. Once encoding has started, later renders or disposal do not change that
capture's image or metadata. Use `image.options.seed` for filenames rather than
reading the renderer's current seed after encoding.

The normal draw path does not preserve the drawing buffer or read pixels back
to JavaScript. Explicit capture incurs a browser readback. SVG export is not
supported.

## GPU work and performance

One fullscreen triangle produces the landscape in a fragment shader. Seeded
world-coordinate noise determines terrain and details. JavaScript handles
validation, seed hashing, sizing, resource lifecycle, and uniform updates; it
does not build landscape geometry, generate SVG paths, or rasterize pixels.
Panning changes uniforms and does not accumulate generated chunks in memory.

GPU work scales with backing pixel count and mountain layers. Start at pixel
ratio `1`, use fewer layers on constrained devices, and redraw only when
needed. WebGL2 may run through a software implementation on some systems;
availability alone does not prove physical GPU acceleration. Shader correctness
tests on a software driver do not establish frame rate or battery performance
on hardware. Profile your actual devices and intended canvas sizes.

The same seed and options reproduce a scene on the same implementation,
independent of the order in which you pan. Floating-point shader differences
can produce small pixel differences between GPU vendors. Coordinates are
bounded to preserve usable precision; this is a large procedural world rather
than an unbounded-precision scroll.

## Attribution and license

MIT. The original algorithm and visual approach are by Lingdong Huang,
copyright 2018. See the included license notice. The referenced fork was
reviewed at commit
[`9f754d2b2e73495db7883d4d4055a7b0903b0454`](https://github.com/samoojj/shan-shui-inf-gpu/tree/9f754d2b2e73495db7883d4d4055a7b0903b0454),
which still uses CPU-generated SVG. This package implements a new shader
renderer for that landscape-painting approach.

The images in `screenshots/` are historical examples from the original SVG
renderer, retained for reference; they are not output from this GPU renderer.

## Verification

```sh
npm test
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

To use an installed Chromium and explicitly test software WebGL:

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium SWIFTSHADER=1 npm run test:browser
```

The browser suite runs independent scenarios with fresh renderers. It checks
actual shader output, distinct/repeated seeds, pan-order independence and
overlap, sizing, automatic restoration, failed construction/recovery, cleanup,
HTML/worker PNG capture, and example controls/export. Focused instrumentation
verifies one draw per frame with no CPU geometry/texture uploads or pixel
readbacks. PNG capture checks decode pixels and verify scene metadata even when
the renderer changes or is disposed during encoding. The exported demo image is
written to `test-results/landscape.png`.
These are correctness checks; no hardware speedup or frame-rate guarantee is
claimed.

Use `BROWSER_TEST_FILTER='capture' npm run test:browser` to run matching browser
scenarios. See [the architecture guide](docs/architecture.md) for module ownership,
lifecycle invariants, and guidance for changing landscape composition.
