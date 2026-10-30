import { tree, leafCluster } from "../../src/shaders/trees.wgsl";
import { Writer } from "../../src/shaders/construction.wgsl";
import { Brush } from "../../src/shaders/commands.wgsl";

struct TreeCase {
  origin: vec2f,
  size: vec2f,
  color: vec4f,
  style: u32,
  seed: u32,
  clusterCount: u32,
  bend: f32,
  commandBase: u32,
  commandCapacity: u32,
  controlBase: u32,
  controlCapacity: u32,
}

@group(0) @binding(0) var<storage, read_write> constructionControls: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(2) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(3) var<storage, read> cases: array<TreeCase>;
@group(0) @binding(4) var<storage, read_write> counts: array<vec4u>;

@compute @workgroup_size(1)
fn cs_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  let input = cases[index];
  var writer = Writer(input.commandBase, input.commandCapacity, input.controlBase,
    input.controlCapacity, 0u, 0u, 0u, 0u, input.seed);
  if (input.clusterCount > 0u) {
    leafCluster(&writer, input.origin, input.size.y, input.size.x, input.clusterCount, input.color);
  } else {
    tree(&writer, input.style, input.origin, input.size.y, input.size.x, input.bend, input.color);
  }
  counts[index] = vec4u(writer.commandCount, writer.controlCount, writer.pointCount, writer.overflow);
}
