import { CHILD_BRUSH, buildingFlags, BOAT, BUILDING, HUT, LEAF_CLUSTER, ROCK, TOWER, TREE, WATER, Brush, SceneObject } from "./commands.wgsl";
import { Writer, emit, random } from "./construction.wgsl";
import { hash } from "./random.wgsl";

// A placeholder occupies its exact painter position. Geometry is generated in
// separate compute passes, then the placeholder expands to the child's brushes.
fn child(writer: ptr<function, Writer>, source: SceneObject) {
  if ((*writer).overflow != 0u) { return; }
  let index = atomicAdd(&childQueue[0], 1u);
  if (index >= arrayLength(&children)) { (*writer).overflow = 1u; return; }
  var description = source;
  let variation = random(writer);
  description.seed = max(1u, hash((*writer).randomState));
  description.depth = variation * 100.0;
  children[index] = description;
  var marker: Brush;
  marker.kind = CHILD_BRUSH; marker.controlOffset = index;
  emit(writer, marker);
}
export fn tree(writer: ptr<function, Writer>, style: u32, origin: vec2f, height: f32, width: f32, bend: f32, color: vec4f) {
  var description: SceneObject;
  description.kind = TREE; description.style = style; description.origin = origin;
  description.size = vec2f(width, height); description.bend = bend; description.color = color;
  child(writer, description);
}
export fn leafCluster(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32, count: u32, color: vec4f) {
  var description: SceneObject;
  description.kind = LEAF_CLUSTER; description.origin = origin; description.size = vec2f(width, height);
  description.style = count; description.color = color;
  child(writer, description);
}
export fn building(writer: ptr<function, Writer>, style: u32, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32, stories: u32, decoration: u32, railing: bool) {
  var description: SceneObject;
  description.kind = BUILDING; description.style = style; description.origin = origin; description.size = vec2f(width, height);
  description.rotation = rotation; description.perspective = perspective;
  description.flags = buildingFlags(stories, decoration, railing);
  child(writer, description);
}
export fn rock(writer: ptr<function, Writer>, origin: vec2f, size: vec2f, seedCoordinate: f32, shade: f32) {
  var description: SceneObject;
  description.kind = ROCK; description.origin = origin; description.size = size; description.rotation = seedCoordinate; description.perspective = shade;
  child(writer, description);
}
export fn transmissionTower(writer: ptr<function, Writer>, origin: vec2f, height: f32, width: f32) {
  var description: SceneObject;
  description.kind = TOWER; description.origin = origin; description.size = vec2f(width, height);
  child(writer, description);
}
export fn boat(writer: ptr<function, Writer>, origin: vec2f, length: f32, scale: f32, flipped: bool) {
  var description: SceneObject;
  description.kind = BOAT; description.origin = origin; description.size = vec2f(length, scale); description.flags = select(0u, 1u, flipped);
  child(writer, description);
}
export fn water(writer: ptr<function, Writer>, origin: vec2f, length: f32, height: f32, clusters: u32) {
  var description: SceneObject;
  description.kind = WATER; description.origin = origin; description.size = vec2f(length, height); description.style = clusters;
  child(writer, description);
}
export fn hut(writer: ptr<function, Writer>, origin: vec2f, width: f32, height: f32, rotation: f32, perspective: f32) {
  var description: SceneObject;
  description.kind = HUT; description.origin = origin; description.size = vec2f(width, height);
  description.rotation = rotation; description.perspective = perspective;
  child(writer, description);
}
