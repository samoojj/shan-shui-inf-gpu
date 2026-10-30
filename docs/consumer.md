# Production browser consumers

The default facade starts `./runtime/worker.js` relative to its own module URL.
Serve `dist/index.js` and `dist/runtime/worker.js` with that layout when importing
the distribution directly. An application bundler may move the facade without
emitting its worker. In a bundled application, supply a fresh worker through the
third `createLandscape` argument:

```ts
const controller = new AbortController();
const landscape = await createLandscape(canvas, { seed: "1234" }, {
  workerFactory: () => new Worker(
    new URL("./landscape-worker.js", import.meta.url),
    { type: "module" },
  ),
  signal: controller.signal,
});
```

Emit `landscape-worker.js` from the public `shan-shui-gpu/worker` package entry as
an application build asset next to the module containing this factory. Use the
application's asset import or worker-emission feature when its bundler supplies
one. The factory belongs to the consumer and must return a new module worker on
every call. The library owns and terminates that worker. It does not serialize
the factory or signal to the worker. CSP must allow the resulting worker URL.
`isWebGPUSupported({ workerFactory })` uses the same asset contract.

For esbuild, resolve that public entry in the consumer's build script and emit
both entries together:

```js
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
await build({
  entryPoints: {
    app: "src/app.js",
    "landscape-worker": require.resolve("shan-shui-gpu/worker"),
  },
  outdir: "dist/assets",
  bundle: true,
  platform: "browser",
  format: "esm",
});
```

Load `assets/app.js` from the application's HTML at its deployed base path. The
factory resolves the sibling worker relative to the emitted application module,
so deploying under a nested base path does not require a root-relative URL.

The supported esbuild setup is exercised by `node tests/consumer.mjs`. This test
packs the distribution, extracts it into a consumer's `node_modules`, bundles
the app and worker as separate entries, and serves only their production output
under `/deployed/landscapes/`. It asserts a successful worker request at that
base path, actual landscape creation, and a nonblank opaque PNG capture. Run
`npm run build` first. `SWIFTSHADER=1` selects software WebGPU for this correctness
test; `CHROMIUM_EXECUTABLE` can select an installed Chromium binary.
`CONSUMER_BUILD_ONLY=1` checks the packed production build and HTTP asset paths
without launching a browser; it explicitly does not establish rendering success.

`signal` cancels initialization, including adapter probing and first-frame
construction. Abort rejects creation with `AbortError` and terminates its
worker immediately. Before canvas transfer, the same unused canvas can be
retried. After transfer, recovery requires a fresh canvas. A component can abort
its controller when it unmounts without waiting for `createLandscape` to finish.
After creation succeeds, the initialization signal detaches; use
`landscape.dispose()` to close the live renderer.
