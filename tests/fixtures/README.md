# Independent CPU expectations

These frozen captures are independent of the WGSL implementation. Tests never
regenerate their expected geometry. The captured historical CPU recipes are
identified by immutable commit and source hashes in the fixtures. No CPU
landscape generator executes in production or normal acceptance.

Available fixtures: `gpu.json`, `upstream.json`, `construction.json`, `gpu-terrain.json`, `controlled-trees.json`.

The new per-object random stream deliberately changes the old seed-to-image
mapping. Fixed-input geometry acceptance and same-adapter repeatability are
separate from whole-scene parity with the original SVG application.
