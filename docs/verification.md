# Verification

The current renderer constructs the scene on the GPU and uses new deterministic
random streams. Equal text seeds no longer identify the old CPU scene. Numerical
acceptance therefore compares fixed construction inputs, and whole landscapes
are reviewed visually. [Provenance](upstream.md) and [fixture notes](../tests/fixtures/README.md)
identify the independent CPU captures. No reference implementation is retained.

## Running the checks

| Command | Purpose |
| --- | --- |
| `npm test` | Strict TypeScript build, SSR/public interface and option checks |
| `npm run check:shaders` | Native validation of all 17 compute/render entry modules |
| `npm run test:gpu` | Native construction, brush, raster and overflow acceptance |
| `npm run test:browser` | 30 worker, rendering, capture, lifecycle and demo scenarios |
| `npm run compare:reference` | Full-size visual study, repeated pixels and execution metrics |
| `npm pack --dry-run` | Inspect worker assets, declarations, documentation and licenses |

Set `CHROMIUM_EXECUTABLE` to Chromium or install it with
`npx playwright install chromium`. `SWIFTSHADER=1` selects the software browser
adapter. Native checks require WebGPU and fail if unavailable. The installed
`vgpu doctor` diagnoses native support; `VGPU_CACHE_DIR` and
`MESA_SHADER_CACHE_DIR` may point to writable directories. Shader preparation
at build time is separate from native validation.

## Construction acceptance

The native suite reads actual GPU storage after dispatch. Frozen expectations
come from the previously verified CPU recipes with fixed inputs, a captured
noise table and the newly approved GPU-compatible random stream. They were
captured before deleting those recipes, independently of WGSL output.

| Probe | Coverage |
| --- | --- |
| Noise/brushes | 260 noise samples; 18 brush cases with 448 expanded points; bounds |
| Trees | All eight species, repeatability, finite paths, painter order, recursion bounds and overflow |
| Tree reference geometry | 264 CPU commands: complete styles 1, 2, 3 and 7, style 8 trunk, two-leaf rim clusters |
| Island decoration | 96 seeds and 1,723 CPU child descriptors; all decoration themes |
| Terrain | Nine cases, 1,439 ordered commands, 16,335 output points and 124 queued children |
| Motifs | Thirteen constructions and 977 commands; three additional overflow cases |
| Raster | White occluders, alpha order, nonzero winding, degenerate/open paths, butt caps and miter joins |

Tree/island/terrain coordinates allow 0.002 drawing units; motifs allow 0.001.
Observed maximum errors were below 0.00013 units. The brush output comparison
allows 0.11 units because it includes upstream's decimal rounding; measured
maximum error was 0.000147. Noise differed by less than 0.00000008.

Tree styles 4–6 and the branching part of style 8 use deferred work queues whose
random-consumption order differs from the CPU implementation. Their structural,
paint-order, determinism and overflow checks are not an exact CPU geometry proof.
This limitation is distinct from the fixed-input comparisons above.

Command, control, child-queue and recursive-stack bounds fail explicitly; the
renderer does not silently omit over-budget geometry. Tests intentionally
exhaust arenas. The default browser seeds also exercise complete generation,
allocation, compaction, brush expansion and rasterization together.

Native results and the raster image are written to
`test-results/gpu-primitives/report.json` and `raster.png`. The recorded adapter
is llvmpipe, a software WebGPU implementation. Native execution proves shader
behavior here; it does not measure hardware GPU throughput.

## Browser contracts and measurements

The 30 independent scenarios cover nonblank opaque output; numeric, Unicode,
changed and restored seeds; positive/negative camera revisits and overlap;
fractional-DPR paper tiling; resizing and atomic option rejection; GPU storage
ownership; cached redraws; coalescing and stale revisions; event-loop heartbeat;
real validation/device failures; startup/script/acquisition/compilation failures;
concurrent ownership; disposal and fresh-canvas recovery; capture ordering,
encoding errors and races; worker crashes; and desktop/mobile demo controls.

Every scenario asserts that the main thread requests zero adapters and zero
devices. Worker instrumentation verifies that construction buffers are never
CPU-initialized, initial uploads stay below 4 KiB, and generation reads three
16-byte allocation summaries. Cached views dispatch no construction, allocate
no geometry and perform no readback. Test instrumentation is not shipped in the
public interface.

The lifecycle fixtures use an 80×64 backing buffer for a 320×256 logical view.
These small images test behavior without making every software-GPU failure test
paint a full-size landscape. Full-size visual inspection is separate.

One instrumented initialization plus seed regeneration uploaded 608 bytes,
while main-thread timers continued throughout. The separate worker-only baseline
before GPU construction uploaded about 35.9 MB for equivalent operations. This
measures the changed upload boundary, **not a speedup**. Shared-host software
execution and cold shader compilation vary substantially. Building construction
alone took about 76 seconds on cold llvmpipe; splitting constructor pipelines
avoids the monolithic driver's compiler memory failure. Hardware GPU time and
cross-device performance have not been measured.

`compare:reference` writes a 1200×700 PNG, standalone paired HTML and metrics under
`test-results/comparison/`. It asserts opacity, nonblank pixels, an identical
cached redraw, no main-thread GPU acquisition, bounded scalar uploads and exactly
three allocation readbacks. It reports first-frame wall time, worker operation
times, heartbeat gaps, observed main-thread long tasks, buffer allocation and
adapter identity. These are software-host observations, not hardware benchmarks.

## Visual evidence and historical parity

The pinned original landscape is retained for reviewing construction character:

![Original CPU/SVG landscape, seed 1234](images/original-1234.png)

The earlier CPU-composition/GPU-brush port at `60e75d4` matched that scene with
mean channel error 0.716/255 and 0.254% of pixels differing by over 16/255. Those
historical figures verified the source study before the execution rewrite; they
do not describe the current seed mapping. [Original algorithm studies](upstream.md)
remain the construction authority.


Current GPU construction, seed `1234`, 1200×700 pixels:

![GPU-constructed landscape](images/gpu-1234.png)

This image was inspected at native resolution. The final run reproduced its
pixels on a cached redraw, uploaded **304 bytes** of scene settings/bookkeeping,
read **48 bytes** of allocation summaries, and recorded zero main-thread GPU
requests and zero observed main-thread long tasks. Instrumented peak buffer
allocation was **79,964,628 bytes**. First-frame wall time was **160.7 seconds** on
SwiftShader; this slow software result does not establish hardware performance.
[Machine-readable measurements](measurements.json) include adapter identity,
heartbeat timing, fixed-input errors and the tested code commit.

The packed library includes both facade and worker. An isolated offline install
passed strict consumer TypeScript without ambient WebGPU types, SSR import,
capability probing and unchanged host randomness. Installed facade/worker bytes
match the tested bundles. The portfolio checkout was left unchanged.
