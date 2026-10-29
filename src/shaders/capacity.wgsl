import { SceneObject } from "./commands.wgsl";
// Explicit arena budgets are validated on the GPU. Overflow rejects the frame.
// Common leaf clusters stay compact; recursive branching receives larger arenas.
export fn parentCapacity(description: SceneObject) -> vec2u {
  switch description.kind {
    case 1u: { return vec2u(2048u, 8192u); }
    case 2u: { return vec2u(512u, 4096u); }
    case 3u: { return vec2u(8192u, 32768u); }
    default: { return vec2u(1u, 1u); }
  }
}
export fn childCapacity(description: SceneObject) -> vec2u {
  switch description.kind {
    case 6u: {
      switch description.style {
        // Nine leaves (21 controls each) and two ten-point trunk contours.
        case 1u: { return vec2u(11u, 209u); }
        case 2u: { return vec2u(8u, 256u); }
        // Seventy-two leaves plus the twenty-point trunk mask.
        case 3u: { return vec2u(73u, 1532u); }
        case 7u: { return vec2u(4096u, 32768u); }
        case 8u: { return vec2u(512u, 16384u); }
        default: { return vec2u(4096u, 131072u); }
      }
    }
    case 7u: { return vec2u(description.style, description.style * 21u); }
    case 8u: { return vec2u(2048u, 65536u); }
    case 9u: { return vec2u(128u, 1024u); }
    case 10u: { return vec2u(64u, 4096u); }
    case 11u: { return vec2u(1024u, 32768u); }
    case 4u: { return vec2u(64u, 4096u); }
    case 5u: { return vec2u(16u, 4096u); }
    default: { return vec2u(1u, 1u); }
  }
}
