# Native GPU primitive checks

From the repository root, after `npm ci`:

```sh
node scripts/check-shaders.mjs
node tests/gpu-primitives.mjs
```

These commands require a real WebGPU implementation, including a software
implementation supported by `vgpu/node`. They fail when no device is available;
they do not substitute a mock or silently skip validation. Run
`npm exec --no -- vgpu doctor` to diagnose the local adapter. `VGPU_CACHE_DIR`
and `MESA_SHADER_CACHE_DIR` can point to writable cache directories when needed.

The checks use the pinned, hash-verified original in `reference/original.html`
as the noise and brush oracle. They exercise the production command packer and
native shaders, then read actual GPU buffers and pixels:

- Noise samples cover signs, fractions, three dimensions and wrapped coordinates.
- Eighteen brush cases cover pointed endpoints, one-point strokes, repeated
  points, angle wrapping, custom width/leaf profiles, rotations, noise extremes,
  and the texture routine's reversed interpolation weights.
- Coordinate and bounds tolerance is `0.11` world units: one original SVG
  rounding step (`0.1`) plus float32 storage error. The report includes actual
  maximum errors, so a successful run does not conceal that tolerance.
- Raster probes check painter order, translucent white masks, degenerate fills,
  open strokes, butt caps, repeated-point miter joins and nonzero self-overlap.
  Byte-valued colors allow one level of native blend/quantization variation.

Results are written to `test-results/gpu-primitives/report.json` and `raster.png`.
The report identifies the adapter and labels software rendering explicitly.
These are correctness checks, not GPU performance benchmarks. Scene composition
and whole-image comparisons are separate suites; these fixtures do not prove
every recursive motif or every antialiasing edge matches the original browser.
