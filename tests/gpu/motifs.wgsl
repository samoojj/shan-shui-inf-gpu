// Native constructor acceptance: one dynamic call site per entry avoids
// multiplying large inlined motif graphs in software-driver compilation.
import { Brush } from "../../src/shaders/commands.wgsl";
import { Writer } from "../../src/shaders/construction.wgsl";
import { building, hut, boat, transmissionTower, person, water } from "../../src/shaders/motifs.wgsl";

struct Request {
  origin: vec2f,
  size: vec2f,
  shape: vec4f,
  kind: u32,
  style: u32,
  stories: u32,
  decoration: u32,
  seed: u32,
  flags: u32,
  clusters: u32,
  padding: u32,
  commandCapacity: u32,
  controlCapacity: u32,
  reserved: vec2u,
}

@group(0) @binding(0) var<storage, read_write> constructionControls: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> constructionJobs: array<Brush>;
@group(0) @binding(2) var<storage, read> noiseTable: array<f32>;
@group(0) @binding(3) var<storage, read_write> results: array<Writer>;
@group(0) @binding(4) var<storage, read> requests: array<Request>;

fn writerFor(index: u32, request: Request) -> Writer {
  return Writer(index * 2048u, request.commandCapacity, index * 65536u, request.controlCapacity, 0u, 0u, 0u, 0u, request.seed);
}

@compute @workgroup_size(1)
fn thatch(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  hut(&writer, request.origin, request.size.x, request.size.y, request.shape.x, request.shape.y);
  results[invocation.x] = writer;
}

@compute @workgroup_size(1)
fn architecture(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  building(&writer, request.style, request.origin, request.size.x, request.size.y, request.shape.x, request.shape.y, request.stories, request.decoration, (request.flags & 1u) != 0u);
  results[invocation.x] = writer;
}

@compute @workgroup_size(1)
fn figures(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  person(&writer, request.origin, request.shape.z, (request.flags & 1u) != 0u, (request.flags & 2u) != 0u);
  results[invocation.x] = writer;
}

@compute @workgroup_size(1)
fn boats(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  boat(&writer, request.origin, request.size.x, request.shape.z, (request.flags & 1u) != 0u);
  results[invocation.x] = writer;
}

@compute @workgroup_size(1)
fn towers(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  transmissionTower(&writer, request.origin, request.size.y, request.size.x);
  results[invocation.x] = writer;
}

@compute @workgroup_size(1)
fn ripples(@builtin(global_invocation_id) invocation: vec3u) {
  let request = requests[invocation.x];
  var writer = writerFor(invocation.x, request);
  water(&writer, request.origin, request.size.x, request.size.y, request.clusters);
  results[invocation.x] = writer;
}
