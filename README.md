# Shan shui GPU

A TypeScript/WebGPU port of [Lingdong Huang’s shan-shui](https://github.com/LingDong-/shan-shui-inf),
built with [vgpu](https://github.com/vercel-labs/vgpu) **0.6.0**. Native WGSL
constructs and paints mountains, rocks, eight tree styles, buildings, figures,
boats, water, and paper texture from the original procedural recipes.

A dedicated module worker owns the OffscreenCanvas and GPU resources. The main
thread validates options and exchanges requests; landscape planning, motif
topology, control paths, brush geometry, bounds, and painting run on the GPU.
The output is a raster canvas with PNG capture.

The GPU version uses new random streams and independently seeded world chunks.
An old seed does **not** reproduce the original application's composition.
[Construction and seed differences](#fidelity-determinism-and-execution) are
part of the port's contract.

## Build and try it

Use Node.js 22 or newer:

```sh
npm install
npm run build
```

The library API and packaged consumer work at this stage. The original SVG
demo remains at the repository root; the GPU example and demo command join in
the final stack PR. See [consumer integration](docs/consumer.md) for a runnable
production bundler recipe.

The package has not been published to a registry. To use a local checkout:

```sh
npm install /absolute/path/to/shan-shui-inf-gpu
```

The build emits TypeScript declarations and two browser runtime entries:

| File | Role |
| --- | --- |
| `dist/index.js` | Public facade: options, request queue, lifecycle, and worker messages |
| `dist/runtime/worker.js` | Worker session, vgpu runtime, and prepared WGSL shaders |

The WGSL parser and resolver run during the build. Consumers need no WGSL loader.
Serve both entries from the application's origin, with the `runtime/worker.js`
path intact relative to `index.js`. When using an application bundler, verify
that it emits the worker
asset and resolves `new URL("./runtime/worker.js", import.meta.url)` correctly;
otherwise copy the worker to that resolved location. Content Security Policy
must allow that worker URL through `worker-src` and permit module loading. A
same-origin deployment normally uses `worker-src 'self'`.

For bundled applications, use the explicit `workerFactory` setup and production
build recipe in [Consumer integration](docs/consumer.md). It supports non-root
deployment paths. The third `createLandscape` argument also accepts an
`AbortSignal` to cancel initialization before the first frame finishes.

## Use the library

```ts
import { createLandscape } from "shan-shui-gpu";

// This element must be fresh: do not call getContext() before creation.
const canvas = document.querySelector<HTMLCanvasElement>("#landscape")!;
const landscape = await createLandscape(canvas, {
  seed: "1234",
  width: 1200,
  height: 700,
  pixelRatio: 1,
  zoom: 1.142,
});

// Creation waits for setup, generation, and the first completed GPU frame.
await landscape.render({ cameraX: 400 });
await landscape.render({ seed: "quiet-morning", cameraX: 0 });
await landscape.resize(900, 600, 1.5);

const image = await landscape.capture();
// image.blob: PNG; image.options: captured settings; image.revision: request ID.
// image.width and image.height are the actual PNG dimensions.

landscape.dispose();
// Mount again with a new canvas; the transfer cannot be undone.
```

Without an application bundler, serve the emitted `dist/index.js` and its
worker asset together over localhost HTTP or HTTPS. Importing the package is safe
during server-side rendering: import alone starts no worker and requests no GPU
resources. Device setup happens inside the render worker.

For React or Next.js, initialize in a client effect. Create and append a **fresh
canvas for every effect setup**, including repeated setup in React Strict Mode;
dispose the renderer and remove that element on cleanup. If asynchronous
creation finishes after cleanup, immediately dispose the returned renderer.
Reusing a retained canvas reference after cleanup cannot reverse its transfer.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `"1234"` | String or finite number. `String(seed)` is the seed identity; its URL-encoded form must fit in 96 characters to bound worker messages. |
| `width`, `height` | Canvas dimensions | Integer logical dimensions, `1`–`16384`. Zero canvas dimensions fall back to `1200` × `700`. Set CSS dimensions separately. |
| `pixelRatio` | `1` | Backing resolution multiplier, `0.25`–`4`. |
| `cameraX`, `cameraY` | `0`, `0` | Drawing-coordinate offset, within ±8192. Positive y points downward. |
| `zoom` | `1.142` | Logical screen pixels per drawing unit, `0.25`–`4`. The visible extent is `width / zoom` by `height / zoom`. |
| `presentation` | `"complete"` | `"complete"` or `"incremental"`, using authored brush order. |
| `commandsPerFrame` | `256` | Positive integer brush budget for incremental frames. |

`DEFAULT_OPTIONS` is exported with explicit dimensions of 1200 × 700. The visible
width, `width / zoom`, must not exceed 8192 drawing units. Unknown options and
invalid values reject the request without applying any part of its patch.

### Requests and completion

| Method | Behavior |
| --- | --- |
| `render(patch?): Promise<void>` | Validates and queues settings. Resolves after its GPU frame, or a newer frame that superseded it through coalescing, finishes. |
| `resize(width, height, pixelRatio?): Promise<void>` | Queues dimensions through the same rendering/completion path. The omitted ratio retains the latest requested ratio. |
| `getOptions()` | Returns a copy of the latest accepted settings, including requests that are still pending. |
| `getStatus()` | Returns `"ready"`, `"device-lost"`, `"error"`, or `"disposed"`. Ready means requests can be accepted, not that the queue is idle. |
| `subscribe(listener)` | Delivers `{ status, error }` immediately and on state changes; returns an unsubscribe function. |
| `capture(patch?)` | Returns `Promise<{ blob, width, height, options, revision }>` for that exact request. |
| `dispose()` | Immediately marks the session disposed, cancels queued work, and starts worker/resource cleanup. Safe to repeat. |

Consecutive render requests coalesce while waiting for the worker. Their
promises remain pending until the replacement frame completes; a dropped
intermediate request does not report premature completion. Captures form queue
barriers and are never coalesced. Await a render when completion matters, and
handle rejected promises even when an interaction does not need to wait.

Resize is explicit. A `ResizeObserver` can measure CSS dimensions and request a
resize. After transfer, use `resize()` to change backing dimensions; CSS sizing
remains the caller's responsibility. The library installs no page event handlers
or animation loop.

### Lifecycle and browser support

`createLandscape()` probes WebGPU in its worker before transferring the canvas,
then resolves only after setup and the first frame complete. A capability query
uses the same worker-side probe without claiming a canvas or requesting a device:

```ts
import { isWebGPUSupported } from "shan-shui-gpu";

if (await isWebGPUSupported()) {
  // Adapter availability is preliminary; device or resource setup can still fail.
}
```

Only one session can own a canvas. **A successful canvas transfer is permanent.**
Disposal, device loss, and failed GPU initialization cannot make that element or
OffscreenCanvas transferable again. Recovery requires a new HTMLCanvasElement
or OffscreenCanvas. Option validation, worker-loading failures, and failed
support probes happen before transfer, so those failures permit retrying the
same unused canvas. Device or pipeline setup failures occur after transfer.

Subscribe to session state to keep controls in sync:

```ts
const unsubscribe = landscape.subscribe(({ status, error }) => {
  saveButton.disabled = status !== "ready";
  if (error) statusElement.textContent = error.message;
});
```

Device loss, worker errors, and GPU generation/rendering errors are terminal.
Further render, resize, and capture requests reject. Dispose the failed session
and create another with a fresh canvas; there is no automatic restoration or
fallback backend. `unsubscribe()` detaches a listener, and disposal clears all
subscriptions. Late worker messages cannot restore a terminal session.

Disposal rejects queued captures and render requests, including an active render
whose completion has not been delivered. A capture already dispatched to the
worker may finish before cleanup. Worker shutdown is bounded to 30 seconds so a
stalled encoder cannot retain a disposed session indefinitely.

### OffscreenCanvas and capture

HTML canvas transfer and worker creation are handled by the library. An unused
OffscreenCanvas works with the same interface, including when called from
another module worker:

```ts
const landscape = await createLandscape(new OffscreenCanvas(640, 480), {
  seed: "quiet-morning",
});
const image = await landscape.capture();
landscape.dispose();
```

`capture(patch?)` snapshots settings and a monotonically increasing request
revision when accepted. The worker draws those settings, begins PNG encoding,
and checks GPU completion. Later requests wait behind that capture's encoding
barrier and cannot change its image or metadata. Use `image.options.seed` for a
filename even if the caller has already accepted a newer seed.

PNG encoding failure rejects that capture without making the renderer unusable.
A GPU or worker failure is terminal and rejects pending work. Calls made after
loss, failure, or disposal reject without applying their patches. Capture
returns a PNG, not SVG or an editable scene description.

## Incremental painting

Choose `presentation: "complete"` (the default) to present the finished image,
or `presentation: "incremental"` to paint ordered brush commands over multiple
frames. `commandsPerFrame` controls pacing (default 256, integer 1–1,000,000):

```ts
const landscape = await createLandscape(canvas, {
  seed: "1234", presentation: "incremental", commandsPerFrame: 128,
});
await landscape.render({ cameraX: 300 });
```

Construction finishes before presentation starts. Each batch loads the ink
already painted, adds the next commands in authored painter order, and presents
the result. Both modes finish with identical pixels on the same adapter.
Creation and `render()` resolve after the entire sequence finishes. An unchanged
view reuses completed ink rather than replaying the sequence.

A newer render supersedes an active incremental render when no capture barrier
is queued; superseded callers resolve when the replacement finishes. Each new
view starts with a cleared ink target so revisions do not mix. `capture()` waits
for preceding work and captures its own **complete** frame; it does not snapshot
a partial sequence. Disposal stops rendering, while an already-dispatched
capture retains its completion guarantee. The initialization abort signal stops
creation even while the first incremental sequence is running.

## Fidelity, determinism, and execution

The [pinned upstream source](docs/upstream.md) supplies the construction studies
for terrain, eight tree species, architecture, figures, boats, and brush
primitives. The port implements those constructions in WGSL, including recursive
branching through explicit stacks and geometry-dependent foliage triangulation.
Its [architecture](docs/architecture.md#the-cpugpu-seam) documents the current
execution boundary.

Seed identity is reduced to a 32-bit hash in the worker. GPU integer hashing
initializes noise and paper tables, and each chunk/object receives its own
Xorshift stream. Numeric `1234` and string `"1234"` identify the same seed; an
empty string is deterministic. The original global PRNG sequence and old
seed-to-image mapping are not retained.

The world is planned in independent 512-unit horizontal chunks, with three
extra chunks on each side of the visible range. Navigating in a different order
does not consume a shared random stream or change the later contents of a chunk.
The renderer retains the current range's painting and regenerates when its seed
or chunk range changes; exploration does not accumulate an unlimited history.

For a fixed implementation and adapter, repeating a seed and view reproduces the
image. This is not a promise of identical bytes across adapters, drivers, or
versions: floating-point noise, branch thresholds, and rasterization can differ.
GPU float32 arithmetic and canvas antialiasing also differ from the original
JavaScript/SVG renderer. The original “Pizza Hut” plaque uses bundled Liberation
Sans outlines in place of Verdana, an explicit font substitution.

The historical upstream screenshots and earlier hybrid-port comparisons are
reference material. A full-scene comparison at an old seed cannot by itself
measure the new renderer's raster accuracy, because the compositions differ.
Current validation procedures and measurements belong to
[the verification report](docs/verification.md).

### Resource limits

Backing resolution is capped at 8,388,608 pixels and 8192 pixels per dimension,
or the device texture limit if lower. Both dimensions scale down together.
Capture metadata gives the actual output dimensions; `getOptions()` retains the
requested logical dimensions and pixel ratio.

Generation storage has a **512 MiB live-buffer budget**. Each storage buffer must
also fit the acquired device's `maxStorageBufferBindingSize`; the renderer uses
default storage-buffer limits rather than requesting larger ones. Render
targets, pipeline/device overhead, and browser bookkeeping are separate from
this generation budget.

GPU construction uses bounded arenas for each terrain object and decoration.
An arena overflow or allocation-limit failure rejects the operation and puts
the session into an error state; it does not paint a truncated scene. Recover
with a fresh canvas and a narrower view or a different seed. Normal regeneration
reads back three 16-byte allocation summaries, never generated paths or pixels;
PNG capture is a separate explicit operation.

Cost depends on the requested chunk range, geometry density, overlap, and backing
resolution. Redraw only when needed and choose a suitable pixel ratio. No
hardware speedup or frame-rate guarantee is claimed.

## Development and verification

[Architecture](docs/architecture.md) describes ownership, GPU stages, storage,
and change boundaries. [Source studies](docs/upstream.md) record the upstream
recipes and historical implementation details. [Verification](docs/verification.md)
owns the check commands, their coverage, and measured limitations.

## Attribution and license

The original algorithm and source are MIT-licensed, copyright 2018 Lingdong
Huang; see [LICENSE](LICENSE). The WGSL port retains that provenance and source
references. vgpu is an MIT-licensed dependency from Vercel Labs; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The plaque outlines derive from
Liberation Sans under the [SIL Open Font License](licenses/LiberationSans-OFL.txt).

Images in `screenshots/` are historical output of the original SVG application.
They are retained as references and do not demonstrate this renderer's output.
