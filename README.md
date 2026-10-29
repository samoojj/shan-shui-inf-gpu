# Shan shui GPU

A TypeScript library for seeded Chinese ink landscapes, inspired by
[Lingdong Huang’s shan-shui](https://github.com/LingDong-/shan-shui-inf) and the
[`samoojj/shan-shui-inf-gpu` fork](https://github.com/samoojj/shan-shui-inf-gpu).
Mountains, brush textures, vegetation, and water are generated in native WGSL
shaders through WebGPU and [vgpu](https://github.com/vercel-labs/vgpu) **0.6.0**.
The library is independent of React and Next.js; `vgpu` is its rendering dependency.

This is an artistic reimplementation. It does not reproduce the original SVG
paths, seed outputs, or complete catalog of tree and architectural styles.
Output is a raster canvas, suitable for a background, interactive landscape,
or PNG export. The WebGPU implementation is not pixel-identical to the earlier
WebGL renderer.

## Build and try it

Use Node.js 22 or newer. From this repository’s root:

```sh
npm install
npm run build
npm run demo
```

Open [localhost:4173/examples/](http://localhost:4173/examples/) in a browser with
WebGPU support. WebGPU requires a secure context: use HTTPS in production;
localhost is suitable for development. Browser support alone does not guarantee
that the current device exposes a usable GPU adapter.

The example supports seeds, horizontal dragging and keyboard panning, mist,
vegetation, mountain layers, zoom, and PNG export. It shows a loading state while
initializing and renders only after input or resize; there is no automatic
animation.

The package has not been published to a registry. To use the built package in
another project, install it from disk:

```sh
npm install /absolute/path/to/shan-shui-inf-gpu
```

Build the package before installing it from disk. The build resolves and prepares
the WGSL module graph, emits TypeScript declarations, and bundles the browser
entry point. `dist/index.js` includes the vgpu browser runtime; it does not parse
or resolve WGSL in the browser. Consumers of the built library do not need a WGSL
loader.

## Use the library

```ts
import { createLandscape } from "shan-shui-gpu";

const canvas = document.querySelector<HTMLCanvasElement>("#landscape")!;
const landscape = await createLandscape(canvas, {
  seed: "quiet-morning",
  width: 1200,
  height: 700,
  pixelRatio: 1,
  layers: 5,
  mist: 0.45,
});

// Creation resolves after setup and the initial draw.
landscape.render({ cameraX: 400 });
landscape.render({ seed: "another-valley", vegetation: 0.8 });
landscape.resize(900, 600, 1.5);

const image = await landscape.capture();
// image.blob is the PNG; image.options describes the captured scene.

landscape.dispose();
```

For a browser without an application bundler, import `../dist/index.js` relative
to your HTML file and serve the files over HTTP on localhost or HTTPS elsewhere.
Importing the package is safe during server-side rendering; GPU initialization
happens only when `createLandscape()` is called. In React or Next.js, initialize
inside a client effect and dispose the renderer on cleanup. If initialization
finishes after the effect was cleaned up, dispose that returned renderer too.

**Pre-1.0 change:** `createLandscape()` now returns a promise. Await it before
calling renderer methods. `isWebGPUSupported()` replaces the previous WebGL2 probe
and is asynchronous as well. There is no automatic WebGL fallback.

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
`"ready"`, `"device-lost"`, `"error"`, or `"disposed"`.
`subscribe(listener)` delivers the current `{ status, error }` immediately and
subsequent readiness changes; it returns an unsubscribe function.
`capture(patch?)` returns a promise for a PNG and its scene metadata.
`dispose()` releases the renderer and its subscriptions and is safe to repeat.

Backing resolution is capped at 8,388,608 pixels and 8192 pixels per dimension
(or the device limit, if lower), scaling down both dimensions together. Inspect
`canvas.width` and `canvas.height` for the actual render/export dimensions;
`getOptions()` retains the requested logical size and pixel ratio.

### Browser support and lifecycle

`createLandscape()` rejects if WebGPU is unavailable, initialization or shader
compilation fails, resources cannot be allocated, or options are invalid. Catch
initialization failures and show a fallback suitable for your application.

```ts
import { isWebGPUSupported } from "shan-shui-gpu";

const supported = await isWebGPUSupported();
// This optional probe does not guarantee that later initialization will succeed.
```

The renderer owns its GPU device and canvas surface. Use a dedicated canvas and
do not share it with another renderer. Subscribe when your UI needs to reflect
the session’s actual readiness:

```ts
const unsubscribe = landscape.subscribe(({ status, error }) => {
  // Update your application's readiness indicator or fallback.
  console.log(status);
  if (error) console.error(error);
});
// Later, detach this observer without disposing the landscape:
unsubscribe();
```

Device loss is terminal for that session. It reports `"device-lost"` with an
error; `render()` and `resize()` throw, and `capture()` rejects further work.
Dispose the session and await
`createLandscape()` again to acquire a new device and recreate resources. An
`"error"` state likewise requires disposal and recreation. There is no WebGL-style
context-restoration event or automatic recovery of an old GPU device. Listener
exceptions are reported without changing renderer readiness.

Resize is explicit. A `ResizeObserver` can measure CSS dimensions and call
`resize()`. Coalesce frequent pointer and resize events with
`requestAnimationFrame`; the library does not install an animation loop or
change page styles. The example demonstrates both behaviors.

### OffscreenCanvas

The same interface accepts an `OffscreenCanvas` where the browser supports WebGPU
in workers. Transfer a canvas before creating a renderer:

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
import { createLandscape } from "./dist/index.js";

self.onmessage = async ({ data }) => {
  let landscape;
  try {
    landscape = await createLandscape(data.canvas, {
      seed: "worker-landscape",
      width: 1200,
      height: 700,
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

### Export

Capture works with HTMLCanvasElement and OffscreenCanvas, including after
asynchronous application work. The renderer owns rendering and capture timing:

```ts
const image = await landscape.capture({ seed: "evening-river" });
// image.blob is a PNG; image.width/height are its actual backing dimensions.
// image.options describes the captured scene, even if a newer frame exists.
// Upload, download, or display image.blob using your application's UI.
```

The optional patch is validated and applied before capture. A capture initiated
while the device is lost, the session has failed, or the renderer is disposed
rejects without applying the patch. Invalid settings and encoding failures also
reject. Once encoding has started, later renders or disposal do not change that
capture's image or metadata. Use `image.options.seed` for filenames rather than
reading the renderer's current seed after encoding.

Normal rendering does not read image pixels back to JavaScript. Explicit PNG
capture incurs a readback. SVG export is not supported.

## GPU work and performance

The implementation uses vgpu’s `effect`, `surface`, and `frame` with a prepared
native WGSL shader. One fullscreen triangle produces the landscape. Seeded
world-coordinate noise determines terrain and details. JavaScript handles
validation, seed hashing, sizing, resource lifecycle, and uniform updates; it
does not build landscape geometry, generate SVG paths, or rasterize pixels.
Panning changes uniform data and does not accumulate generated chunks in memory.

The authored shaders live in `src/shaders/*.wgsl`. Pure WGSL modules own painting,
water, and mountain composition; the entry shader owns resource bindings. The
build resolves imports and prepares reflection before bundling. No GLSL source,
GLSL-to-WGSL translator, or browser-time WGSL parser is part of rendering.

GPU work scales with backing pixel count and mountain layers. Start at pixel
ratio `1`, use fewer layers on constrained devices, and redraw only when needed.
WebGPU can use a software adapter; availability alone does not prove physical
GPU acceleration. Software-driver checks do not establish frame rate or battery
performance on hardware. Profile your actual devices and intended canvas sizes.

The same seed and options reproduce a scene on the same backend and
implementation, independent of the order in which you pan. Floating-point
shader differences can produce different pixels between GPU vendors or between
WebGPU and the prior WebGL implementation. Coordinates are bounded to preserve
usable precision; this is a large procedural world rather than an
unbounded-precision scroll.

## Attribution and license

MIT. The original algorithm and visual approach are by Lingdong Huang,
copyright 2018. See the included license notice. The referenced fork was
reviewed at commit
[`9f754d2b2e73495db7883d4d4055a7b0903b0454`](https://github.com/samoojj/shan-shui-inf-gpu/tree/9f754d2b2e73495db7883d4d4055a7b0903b0454),
which still uses CPU-generated SVG. This package implements a new shader
renderer for that landscape-painting approach. vgpu is a separate MIT-licensed
dependency from Vercel Labs; its bundled code's notice is retained in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The images in `screenshots/` are historical examples from the original SVG
renderer, retained for reference; they are not output from this GPU renderer.

## Verification

```sh
npm test
npm run check:shaders
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

`check:shaders` resolves the complete native WGSL module graph and requires a
WebGPU device to validate it. It fails rather than silently accepting a parse-only
check. Diagnose a headless machine with `npm exec --no -- vgpu doctor`; if no
adapter is available, `npm exec --no -- vgpu install-software-renderer` installs
vgpu's verified software renderer for local validation.

For shader development, install the official agent skill with
`npx skills add vercel-labs/vgpu --agent codex` and consult the documentation
bundled with the pinned library, for example
`npm exec --no -- vgpu docs cat shader-workflow`. Edit the `.wgsl` modules, rebuild,
validate, and inspect actual rendered pixels; generated bundle contents are never
the source of shader edits.

To use an installed Chromium and explicitly enable software WebGPU for tests:

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium SWIFTSHADER=1 npm run test:browser
```

Browser scenarios use fresh renderers and exercise actual shader output,
seed repeatability, panning, sizing, lifecycle, HTML/worker PNG capture, and demo
controls. Software WebGPU checks verify the tested behavior; they do not establish
hardware speedup, a frame-rate guarantee, or parity with the old WebGL renderer.

Use `BROWSER_TEST_FILTER='capture' npm run test:browser` to run matching browser
scenarios. See [the architecture guide](docs/architecture.md) for module ownership,
lifecycle invariants, and guidance for changing landscape composition.
