# Landscape vocabulary

- **Landscape**: the original seeded composition accumulated by a scene's planner.
- **View**: the rectangle selected by camera offsets and zoom in original drawing coordinates; y increases downward.
- **Composition**: the original planning and motif construction that emits ordered drawing commands.
- **Drawing command**: a path or brush operation with its geometry, paint, and random parameters; GPU execution expands eligible brushes and renders the ordered result.
- **Chunk**: a cached original scene element with a position and painter-order key, generated as the requested world range grows.
- **Render session**: one canvas's composition, view, and readiness, from asynchronous creation through disposal.
- **Capture**: a PNG with its frame's settings and dimensions; it does not serialize prior exploration history.
- **Device loss**: the end of a render session's ability to draw, requiring a new session rather than restoration of the old one.
