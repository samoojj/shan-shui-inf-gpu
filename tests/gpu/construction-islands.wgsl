import { decorateIsland } from "../../src/shaders/island-decorations.wgsl";
import { Writer } from "../../src/shaders/construction.wgsl";
import { Brush, SceneObject } from "../../src/shaders/commands.wgsl";

struct IslandCase {
  origin: vec2f,
  seed: u32,
  commandBase: u32,
  bounds: vec4f,
  commandCapacity: u32,
  paddingFirst: u32,
  paddingSecond: u32,
  paddingThird: u32,
}

@group(0) @binding(0) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(1) var<storage, read_write> children: array<SceneObject>;
@group(0) @binding(2) var<storage, read_write> childQueue: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> cases: array<IslandCase>;
@group(0) @binding(4) var<storage, read_write> counts: array<vec4u>;

@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let input = cases[index];
  var writer = Writer(input.commandBase, input.commandCapacity, 0u, 0u, 0u, 0u, 0u, 0u, input.seed);
  decorateIsland(&writer, input.origin, input.bounds);
  counts[index] = vec4u(writer.commandCount, writer.randomState, writer.overflow, writer.controlCount);
}
