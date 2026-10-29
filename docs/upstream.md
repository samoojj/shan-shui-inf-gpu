# Upstream provenance

The source of this port is Lingdong Huang's
[LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf), revision
[`9f754d2b2e73495db7883d4d4055a7b0903b0454`](https://github.com/LingDong-/shan-shui-inf/tree/9f754d2b2e73495db7883d4d4055a7b0903b0454).
Its [`index.html`](https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html)
has Git blob `f0d1da751455f99b46756fcbdde8b02420f27d31`.

Parity was established against that unchanged source using isolated CPU and GPU
comparisons. The vendored application and source-execution harnesses have since
been removed. Acceptance tests retain captured numeric outputs and hashes in
`tests/fixtures/`, plus the accepted original PNG in `docs/images/`. They do not
execute, download or install the upstream implementation. No upstream runtime
or development dependency is required. See the [verification report](verification.md).

Copyright 2018 Lingdong Huang. The port retains the original MIT attribution in
[LICENSE](../LICENSE). Source studies link to the exact upstream revision:

- [Landscape construction and planning](original-landscape.md)
- [All eight tree constructions](original-trees.md)
- [Buildings, figures, boats, and water](original-motifs.md)
- [Brush primitives and the port boundary](original-primitives.md)
