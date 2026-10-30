# Upstream provenance

This ports Lingdong Huang's MIT-licensed procedural constructions from
[the pinned upstream source](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html).
Copyright 2018 Lingdong Huang; attribution remains in [LICENSE](../LICENSE).

Construction studies available at this stage:

- [Brush primitives](original-primitives.md)
- [Terrain and planning](original-landscape.md)
- [All eight trees](original-trees.md)

GPU chunks and objects use independent random streams. An equal text seed does
not reproduce the old CPU composition. Same-adapter repeatability does not
promise identical results across adapters or drivers. Frozen numeric captures
are independent CPU expectations, never regenerated from production WGSL.

[Verification](verification.md) describes this stage's runnable acceptance.
