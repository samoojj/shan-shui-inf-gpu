# Upstream provenance

The source of this port is Lingdong Huang's
[LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf), revision
[`9f754d2b2e73495db7883d4d4055a7b0903b0454`](https://github.com/LingDong-/shan-shui-inf/tree/9f754d2b2e73495db7883d4d4055a7b0903b0454).
Its [`index.html`](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html)
has Git blob `f0d1da751455f99b46756fcbdde8b02420f27d31`.

Copyright 2018 Lingdong Huang. The port retains the original MIT attribution in
[LICENSE](../LICENSE). These studies cite the exact upstream revision and record
its construction rules:

- [Landscape construction and planning](original-landscape.md)
- [All eight tree constructions](original-trees.md)
- [Buildings, figures, boats, and water](original-motifs.md)
- [Brush primitives](original-primitives.md)

The `original-*` studies describe the historical CPU/SVG application. Their
references to global random consumption, exploration history, cached scene
elements, and CPU construction are facts about that source. Some port notes
also describe the earlier hybrid implementation. Use
[current architecture](architecture.md) for this renderer's execution boundary
and [the API guide](../README.md#fidelity-determinism-and-execution) for its seed
and determinism contract.

An earlier hybrid port was compared against the unchanged source in isolated
CPU/GPU studies. Captured numeric fixtures and original images retain that
provenance, but they do not establish full-scene parity for the new GPU random
streams. The current renderer preserves the procedural construction approach
while intentionally changing the old seed mapping and chunk-history behavior.
An equal seed string therefore does not identify matching upstream/current
scenes for pixel comparison.

The vendored application and source-execution harnesses have been removed.
Reference material is retained in `tests/fixtures/` and `docs/images/`; no
upstream runtime or development dependency is required. The
[verification report](verification.md) identifies current checks, historical
measurements, and the limits of each comparison.
