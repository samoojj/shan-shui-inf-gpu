# Landscape vocabulary

| Term | Meaning in this renderer |
| --- | --- |
| **Landscape** | The procedural world identified by a seed, assembled from independently seeded horizontal chunks. |
| **Seed identity** | `String(seed)` reduced to a 32-bit code-point hash in the worker. It selects the new GPU streams, not the original application's seed mapping. |
| **View** | The rectangle selected by logical dimensions, camera offsets, and zoom in drawing coordinates; positive y points downward. |
| **Chunk** | A 512-unit horizontal planning interval. The requested range includes three extra chunks on each side of the view. A chunk can contain many scene objects. |
| **Scene object** | A GPU-generated description of a terrain object or decoration: kind, dimensions, position, style, random state, and arena locations. |
| **Construction** | GPU execution of a procedural recipe, including topology decisions, control paths, and brush descriptions. |
| **Arena** | A bounded command/control-storage region assigned to one object's GPU writer. Overflow rejects generation. |
| **Brush** | A GPU-generated painting command containing paint and references to control geometry; expansion creates its final points and bounds. |
| **Painter placeholder** | A position in a parent's brush sequence that refers to a separately constructed child. GPU flattening expands it without changing painting order. |
| **Painting** | The ordered brushes, final points, and bounds retained for the current seed/chunk range, ready for view-dependent rasterization. |
| **Allocation summary** | A 16-byte count/overflow record read from GPU storage by the worker. Three such records size a regenerated range; they contain no geometry. |
| **Render session** | One permanently transferred canvas, its worker/device, accepted options, request queue, painting, and lifecycle through disposal. |
| **Revision** | A monotonically increasing request identifier within a session. It associates completion or capture metadata with the accepted request. |
| **Coalescing** | Replacing consecutive queued render requests with their newest settings. All affected promises settle after the replacement frame finishes. |
| **Capture barrier** | An exact draw/PNG request that cannot be superseded. Later work waits for its GPU completion and encoding. |
| **Capture** | A PNG plus its backing dimensions, logical options, and request revision. |
| **Device loss** | A terminal session transition. Recovery requires another renderer with a fresh canvas. |

The [architecture](docs/architecture.md) defines the current execution boundary.
The [source studies](docs/upstream.md) also use terms from the historical
CPU/SVG application; in particular, its retained “chunks” were individual
scene elements rather than this renderer's fixed horizontal planning intervals.
