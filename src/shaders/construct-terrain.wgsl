import { Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
import { writerFor, writerCounts } from "./construction.wgsl";
import { mountain, island, distantMountain } from "./terrain.wgsl";
import { boat, water } from "./children.wgsl";
@group(0) @binding(0) var<storage, read> objects: array<SceneObject>;
@group(0) @binding(1) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(2) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(3) var<storage, read_write> constructionControls: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> objectCounts: array<ObjectCounts>;
@group(0) @binding(5) var<storage, read_write> children: array<SceneObject>;
@group(0) @binding(6) var<storage, read_write> childQueue: array<atomic<u32>>;
@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&objectCounts)) { return; }
  let description = objects[index];
  var writer = writerFor(description);
  switch description.kind {
    case 1u: { mountain(&writer, description.origin, description.size, description.rotation); }
    case 2u: { island(&writer, description.origin, description.size, description.rotation, description.perspective); }
    case 3u: { distantMountain(&writer, description.origin, description.size, description.rotation); }
    case 4u: { boat(&writer, description.origin, description.size.x, description.size.y, description.flags != 0u); }
    case 5u: { water(&writer, description.origin, description.size.x, description.size.y, description.style); }
    default: {}
  }
  objectCounts[index] = writerCounts(writer);
}
