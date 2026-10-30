import { CHILD_BRUSH, Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
@group(0) @binding(0) var<storage, read> objects: array<SceneObject>;
@group(0) @binding(1) var<storage, read> children: array<SceneObject>;
@group(0) @binding(2) var<storage, read> parentCounts: array<ObjectCounts>;
@group(0) @binding(3) var<storage, read> childCounts: array<ObjectCounts>;
@group(0) @binding(4) var<storage, read> parentJobs: array<Brush>;
@group(0) @binding(5) var<storage, read> childJobs: array<Brush>;
@group(0) @binding(6) var<storage, read> offsets: array<vec2u>;
@group(0) @binding(7) var<storage, read_write> jobs: array<Brush>;
@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&parentCounts)) { return; }
  var destination = offsets[index].x; var pointOffset = offsets[index].y;
  for (var local = 0u; local < parentCounts[index].commands; local++) {
    var brush = parentJobs[objects[index].commandBase + local];
    if (brush.kind == CHILD_BRUSH) {
      let child = children[brush.controlOffset];
      let count = childCounts[brush.controlOffset].commands;
      for (var item = 0u; item < count; item++) {
        var nested = childJobs[child.commandBase + item];
        nested.pointOffset = pointOffset; jobs[destination] = nested;
        destination++; pointOffset += nested.pointCount;
      }
    } else {
      brush.pointOffset = pointOffset; jobs[destination] = brush;
      destination++; pointOffset += brush.pointCount;
    }
  }
}
