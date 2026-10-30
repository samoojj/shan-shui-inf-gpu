import { Brush, SceneObject } from "../../src/shaders/commands.wgsl";
import { Writer } from "../../src/shaders/construction.wgsl";
import { mountain, island, distantMountain } from "../../src/shaders/terrain.wgsl";
import { rock } from "../../src/shaders/rock.wgsl";
struct Result { counts: vec4u, randomState: u32 }
struct Capacity { commands: u32, controls: u32 }
@group(0) @binding(0) var<storage, read> descriptions: array<SceneObject>;
@group(0) @binding(1) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(2) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(3) var<storage, read_write> constructionControls: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> results: array<Result>;
@group(0) @binding(5) var<storage, read_write> children: array<SceneObject>;
@group(0) @binding(6) var<storage, read_write> childQueue: array<atomic<u32>>;
@group(0) @binding(7) var<uniform> capacity: Capacity;
@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= arrayLength(&descriptions)) { return; }
  let description = descriptions[index];
  var writer = Writer(description.commandBase, capacity.commands, description.controlBase, capacity.controls, 0u, 0u, 0u, 0u, description.seed);
  switch description.kind {
    case 1u: { mountain(&writer, description.origin, description.size, description.rotation); }
    case 2u: { island(&writer, description.origin, description.size, description.rotation, description.perspective); }
    case 3u: { distantMountain(&writer, description.origin, description.size, description.rotation); }
    case 9u: { rock(&writer, description.origin, description.size, description.rotation, description.perspective); }
    default: { writer.overflow = 1u; }
  }
  results[index] = Result(vec4u(writer.commandCount, writer.controlCount, writer.pointCount, writer.overflow), writer.randomState);
}
