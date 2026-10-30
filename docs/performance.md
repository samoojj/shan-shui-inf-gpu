# Performance acceptance

GPU construction reduces uploads; it does not prove a speedup. The original
160.7-second SwiftShader first frame remains a historical software measurement.
The planner and tree construction have since changed, so it is not a timing
claim for the current revision.

Run `npm run benchmark` on a WebGPU-capable hardware browser. Set
`CHROMIUM_EXECUTABLE` if the browser is installed outside Playwright's cache.
The benchmark refuses SwiftShader, llvmpipe, lavapipe and other identified
software adapters by default. A diagnostic run requires the explicit
`ALLOW_SOFTWARE_BENCHMARK=1` override and is labelled as software in the report.

The report at `test-results/benchmark/report.json` records the actual adapter,
1200×700 backing resolution at DPR 1, operation wall time, peak buffer storage,
construction dispatches and GPU-completion-fenced wall-clock phases. It covers
cold initialization, an in-range cached pan, a chunk-boundary pan, a changed
seed, and PNG capture. Setup includes construction shader compilation; the
separate construction-compile phase is a subset, not an additive duration.
Painting includes rasterization, paper composition and queue completion.
Capture wall time also includes PNG encoding. These are not GPU timestamp
measurements and may include browser scheduling delays.

Use `BENCHMARK_SEED`, `BENCHMARK_WIDTH`, `BENCHMARK_HEIGHT`, and
`BENCHMARK_PIXEL_RATIO` to repeat the study across dense scenes and resolutions;
the report records the resolved settings. The cached pan moves vertically,
which leaves the horizontal construction range unchanged at every viewport size.

One painting range is currently retained. A boundary pan regenerates its
overlapping geometry. Raster cost still depends on per-fragment path length,
overlap and antialiasing. Record these costs on representative hardware before
choosing a chunk-cache or raster redesign; no hardware latency or speedup claim
is made by this change. Repeat the benchmark across dense seeds, at DPR 2, and
on integrated and discrete adapters before advertising general performance.

**Open merge gate:** attach hardware measurements and agree on a usable latency
budget. The managed development environment supplies software GPU execution
only, so its automated correctness tests cannot close this gate.
