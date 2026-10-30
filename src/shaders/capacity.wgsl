import { SceneObject, MOUNTAIN, ISLAND, DISTANT_MOUNTAIN, TREE, LEAF_CLUSTER, BUILDING, ROCK, TOWER, HUT, BOAT, WATER } from "./commands.wgsl";
// Explicit arena budgets are validated on the GPU. Overflow rejects the frame.
// Common leaf clusters stay compact; recursive branching receives larger arenas.
export fn parentCapacity(description: SceneObject) -> vec2u {
  if (description.kind == MOUNTAIN) { return vec2u(2048u, 8192u); }
  if (description.kind == ISLAND) { return vec2u(512u, 4096u); }
  if (description.kind == DISTANT_MOUNTAIN) { return vec2u(8192u, 32768u); }
  return vec2u(1u, 1u);
}
export fn childCapacity(description: SceneObject) -> vec2u {
  if (description.kind == TREE) {
    switch description.style {
      // Nine leaves (21 controls each) and two ten-point trunk contours.
      case 1u: { return vec2u(11u, 209u); }
      case 2u: { return vec2u(8u, 256u); }
      // Seventy-two leaves plus the twenty-point trunk mask.
      case 3u: { return vec2u(73u, 1532u); }
      case 5u: { return vec2u(2048u, 32768u); }
      case 7u: { return vec2u(4096u, 8192u); }
      case 8u: { return vec2u(512u, 8192u); }
      default: { return vec2u(4096u, 131072u); }
    }
  }
  if (description.kind == LEAF_CLUSTER) { return vec2u(description.style, description.style * 21u); }
  // A seven-story pagoda uses fewer than 3,000 controls; this also covers
  // the pavilion's two figures and the immutable 528-point shop plaque.
  if (description.kind == BUILDING) { return vec2u(1024u, 8192u); }
  if (description.kind == ROCK) { return vec2u(128u, 1024u); }
  if (description.kind == TOWER) { return vec2u(64u, 4096u); }
  if (description.kind == HUT) { return vec2u(512u, 1024u); }
  if (description.kind == BOAT) { return vec2u(64u, 4096u); }
  if (description.kind == WATER) { return vec2u(16u, 4096u); }
  return vec2u(1u, 1u);
}
