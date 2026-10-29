import { buildingStories, buildingDecoration, buildingHasRailing, BUILDING, Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
import { writerFor, writerCounts } from "./construction.wgsl";
import { building } from "./motifs.wgsl";
@group(0) @binding(0) var<storage, read> children: array<SceneObject>;
@group(0) @binding(1) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(2) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(3) var<storage, read_write> constructionControls: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> childCounts: array<ObjectCounts>;
@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&childCounts)) { return; }
  let description = children[index];
  if (description.kind != BUILDING) { return; }
  var writer = writerFor(description);
  building(&writer, description.style, description.origin, description.size.x, description.size.y, description.rotation, description.perspective, buildingStories(description), buildingDecoration(description), buildingHasRailing(description));
  childCounts[index] = writerCounts(writer);
}
