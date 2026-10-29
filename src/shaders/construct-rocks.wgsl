import { Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
import { writerFor, writerCounts } from "./construction.wgsl";
import { rock } from "./rock.wgsl";
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
  if (description.kind != 9u) { return; }
  var writer = writerFor(description);
  rock(&writer, description.origin, description.size, description.rotation, description.perspective);
  childCounts[index] = writerCounts(writer);
}
