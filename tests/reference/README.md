# Original CPU ground truth

These fixtures execute the official [LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf)
source at commit `9f754d2b2e73495db7883d4d4055a7b0903b0454`.
The harness checks the archived HTML's Git blob against
`f0d1da751455f99b46756fcbdde8b02420f27d31` before running.

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/reference.mjs
```

Omit `CHROMIUM_EXECUTABLE` to use Playwright's installed Chromium. Optional flags:
`--seeds=1234,shan-shui,quiet-morning`, `--output=/tmp/reference`, `--scenes-only`,
`--primitives-only`. This uses the CPU application and does not build or run the
GPU renderer. Outputs are local artifacts under `test-results/reference/`.

Each full scene has its original SVG, native PNG, 512×512 paper PNG, two viewport
crops, and JSON containing planner records, generator call counts, SVG element and
point counts, source provenance, and image hashes. The first seed is also loaded
without instrumentation; its SVG and PNG must exactly match the traced run.

The original fixes its SVG at **3000×800** regardless of browser size. Its viewBox
is `0 0 2626.9702276707535 700.5253940455342`, using zoom `1.142`. The 1200×700 and
1000×800 images are top-left viewport crops at that native scale. They do not
stretch or recompose the original. UI overlays and presentation scrolling are
disabled after scene startup, preserving geometry and paper rendering.

`cases.mjs` defines 23 standalone primitives with explicit calls and native-scale
viewports: stroke, blob, texture, water, mountain/flat/distant/rock, all eight tree
variants, four architecture variants, boat, transmission tower, and person.
Each runs with seed `reference-01` in a new iframe. Every primitive's exact SVG
and PNG must match a second fresh iframe. `primitives/manifest.json` records its
inputs, bounds, topology, call counts, and output hashes for a future GPU
implementation to compare against.

The original PRNG replaces `Math.random` only inside its iframe. The host global
is checked after loading. Noise initialization is deliberately left untouched:
the first noise call consumes 4,096 PRNG values. Calling `Noise.noiseSeed`,
prewarming noise, or reseeding an already-used realm would produce a different
reference. Whole scenes and isolated primitives consequently have different
random consumption histories; each fixture records which one it tests.

`loadingMs` is an instrumented CPU diagnostic, not a hardware GPU comparison.
Passing these fixtures establishes reproducible original outputs; it does not
claim that the current GPU implementation matches them.
