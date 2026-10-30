import { CHILD_BRUSH, Brush, SceneObject, ObjectCounts } from "./commands.wgsl";
@group(0) @binding(0) var<storage, read> objects: array<SceneObject>;
@group(0) @binding(1) var<storage, read> parentCounts: array<ObjectCounts>;
@group(0) @binding(2) var<storage, read> childCounts: array<ObjectCounts>;
@group(0) @binding(3) var<storage, read> parentJobs: array<Brush>;
@group(0) @binding(4) var<storage, read_write> offsets: array<vec2u>;
@group(0) @binding(5) var<storage, read_write> summary: array<u32>;
@compute @workgroup_size(1)
fn cs_main() {
  var commands = 0u; var points = 0u; var overflow = 0u;
  for (var index = 0u; index < arrayLength(&parentCounts); index++) {
    offsets[index] = vec2u(commands, points);
    let counts = parentCounts[index]; overflow |= counts.overflow;
    for (var local = 0u; local < counts.commands; local++) {
      let brush = parentJobs[objects[index].commandBase + local];
      if (brush.kind == CHILD_BRUSH) {
        let child = childCounts[brush.controlOffset];
        commands += child.commands; points += child.points; overflow |= child.overflow;
      } else { commands++; points += brush.pointCount; }
    }
  }
  summary[0] = commands; summary[1] = points; summary[2] = 0u; summary[3] = overflow;
}
