import { SceneObject } from "./commands.wgsl";
import { parentCapacity } from "./capacity.wgsl";
@group(0) @binding(0) var<storage, read> candidates: array<SceneObject>;
@group(0) @binding(1) var<storage, read_write> objects: array<SceneObject>;
@group(0) @binding(2) var<storage, read_write> summary: array<u32>;
@compute @workgroup_size(1)
fn cs_main() {
  var count = 0u;
  for (var index = 0u; index < arrayLength(&candidates); index++) {
    let description = candidates[index];
    if (description.kind == 0u) { continue; }
    // Stable insertion order breaks equal-depth ties by chunk and authored order.
    var destination = count;
    while (destination > 0u) {
      if (objects[destination - 1u].depth <= description.depth) { break; }
      objects[destination] = objects[destination - 1u]; destination--;
    }
    objects[destination] = description; count++;
  }
  var commands = 0u; var controls = 0u;
  for (var index = 0u; index < count; index++) {
    var description = objects[index];
    let capacity = parentCapacity(description);
    description.commandBase = commands; description.commandCapacity = capacity.x;
    description.controlBase = controls; description.controlCapacity = capacity.y;
    commands += capacity.x; controls += capacity.y;
    objects[index] = description;
  }
  summary[0] = count; summary[1] = commands; summary[2] = controls;
}
