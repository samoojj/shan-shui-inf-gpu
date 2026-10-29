// Object kind values are one shared GPU ABI, distinct from brush kinds.
export const MOUNTAIN: u32 = 1u;
export const ISLAND: u32 = 2u;
export const DISTANT_MOUNTAIN: u32 = 3u;
export const BOAT: u32 = 4u;
export const WATER: u32 = 5u;
export const TREE: u32 = 6u;
export const LEAF_CLUSTER: u32 = 7u;
export const BUILDING: u32 = 8u;
export const ROCK: u32 = 9u;
export const TOWER: u32 = 10u;
export const HUT: u32 = 11u;

export const POLYGON_BRUSH: u32 = 0u;
export const RIBBON_BRUSH: u32 = 1u;
export const LEAF_BRUSH: u32 = 2u;
export const CONTOUR_BRUSH: u32 = 3u;
export const CHILD_BRUSH: u32 = 4u;

// Storage ABI: 128 bytes per brush. Construction writes this data on the GPU.
export struct Brush {
  kind: u32,
  controlOffset: u32,
  controlCount: u32,
  pointOffset: u32,
  fill: vec4f,
  edge: vec4f,
  width: f32,
  noiseAmount: f32,
  noiseOffset: f32,
  outlineWidth: f32,
  origin: vec2f,
  length: f32,
  angle: f32,
  layer: f32,
  firstColumn: f32,
  columns: f32,
  jitter: f32,
  pointCount: u32,
  profileOffset: u32,
  padding: vec2u,
  reserved: vec4f,
}

export struct View {
  resolution: vec2f,
  span: vec2f,
  offset: vec2f,
}

// A whole landscape object, never a sampled CPU path. 80-byte storage stride.
// size = (width,height), except boat=(length,scale), water=(length,amplitude).
// style = tree species 1..8, building recipe 1..4, or leaf/water cluster count.
// flags = boat facing, or building flags encoded by the helpers below.
// rotation = terrain noise coordinate, rock noise coordinate, or building rotation.
// perspective = island plateau fraction, rock shade width, or building perspective.
// bend/color are tree parameters. depth is the top-level painter sort key.
// Arena bases/capacities are populated by GPU allocation, never the host.
export struct SceneObject {
  origin: vec2f,
  size: vec2f,
  seed: u32,
  kind: u32,
  style: u32,
  flags: u32,
  rotation: f32,
  perspective: f32,
  bend: f32,
  depth: f32,
  commandBase: u32,
  commandCapacity: u32,
  controlBase: u32,
  controlCapacity: u32,
  color: vec4f,
}

export struct ObjectCounts {
  commands: u32,
  controls: u32,
  points: u32,
  overflow: u32,
}

export fn buildingFlags(stories: u32, decoration: u32, railing: bool) -> u32 {
  return stories | (decoration << 8u) | (select(0u, 1u, railing) << 16u);
}
export fn buildingStories(description: SceneObject) -> u32 { return description.flags & 255u; }
export fn buildingDecoration(description: SceneObject) -> u32 { return (description.flags >> 8u) & 255u; }
export fn buildingHasRailing(description: SceneObject) -> bool { return (description.flags & 65536u) != 0u; }
