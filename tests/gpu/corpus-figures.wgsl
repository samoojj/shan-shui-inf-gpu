// Test-only descriptor entry for the production figure construction.
import { Brush, SceneObject, ObjectCounts } from "../../src/shaders/commands.wgsl";
import { writerFor, writerCounts } from "../../src/shaders/construction.wgsl";
import { person } from "../../src/shaders/motifs.wgsl";
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
  // 12 is test-only; production scene descriptors include figures within motifs.
  if (description.kind != 12u) { return; }
  var writer = writerFor(description);
  person(&writer, description.origin, description.size.y,
    (description.flags & 1u) != 0u, (description.flags & 2u) != 0u);
  childCounts[index] = writerCounts(writer);
}
