import { SceneObject, ObjectCounts } from "./commands.wgsl";
import { childCapacity } from "./capacity.wgsl";
struct Allocation { parentControls: u32 }
@group(0) @binding(0) var<uniform> allocation: Allocation;
@group(0) @binding(1) var<storage, read_write> children: array<SceneObject>;
@group(0) @binding(2) var<storage, read> childQueue: array<u32>;
@group(0) @binding(3) var<storage, read> parentCounts: array<ObjectCounts>;
@group(0) @binding(4) var<storage, read_write> summary: array<u32>;
@compute @workgroup_size(1)
fn cs_main() {
  let count = childQueue[0];
  var commands = 0u; var controls = allocation.parentControls; var overflow = 0u;
  for (var index = 0u; index < arrayLength(&parentCounts); index++) { overflow |= parentCounts[index].overflow; }
  if (count > arrayLength(&children)) { summary[3] = 1u; return; }
  for (var index = 0u; index < count; index++) {
    var description = children[index]; let capacity = childCapacity(description);
    description.commandBase = commands; description.commandCapacity = capacity.x;
    description.controlBase = controls; description.controlCapacity = capacity.y;
    commands += capacity.x; controls += capacity.y;
    children[index] = description;
  }
  summary[0] = count; summary[1] = commands; summary[2] = controls; summary[3] = overflow;
}
