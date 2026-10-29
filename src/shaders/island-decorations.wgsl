import { Writer, random, uniform, ink } from "./construction.wgsl";
import { tree, leafCluster, building, rock } from "./children.wgsl";

// Lingdong Huang's flatDec, pinned upstream index.html:2207-2366.
// Copyright (c) 2018, MIT; see LICENSE. Bounds describe the actual generated
// island surface in local coordinates: xmin, ymin, xmax, ymax.
// Child descriptors retain their painter positions; their geometry is generated
// by the separate tree/motif/rock compute passes.
const ISLAND_BOULDERS: u32 = 0u;
const ISLAND_TIERED_GROVE: u32 = 1u;
const ISLAND_SPREADING_TREES: u32 = 2u;
const ISLAND_FORKED_TREES: u32 = 3u;
const ISLAND_FACETED_GROVE: u32 = 4u;

fn islandCenterY(bounds: vec4f) -> f32 {
  return (bounds.y + bounds.w) * 0.5;
}

fn islandGroveRange(writer: ptr<function, Writer>, bounds: vec4f) -> vec2f {
  let lowerFraction = random(writer) * 0.5;
  let upperFraction = random(writer) * 0.5 + 0.5;
  return vec2f(bounds.x * (1.0 - lowerFraction) + bounds.z * lowerFraction,
    bounds.x * (1.0 - upperFraction) + bounds.z * upperFraction);
}

fn islandTreeGroupSize(writer: ptr<function, Writer>) -> u32 {
  // Original weighted choice [1, 1, 1, 1, 2, 2, 3]. Called afresh by each
  // loop condition, including the final condition that ends the group.
  let choice = u32(random(writer) * 7.0);
  if (choice < 4u) { return 1u; }
  if (choice < 6u) { return 2u; }
  return 3u;
}

fn islandLeaningGroupCount(writer: ptr<function, Writer>) -> u32 {
  // Original weighted choice [0, 0, 1, 2].
  let choice = u32(random(writer) * 4.0);
  if (choice < 2u) { return 0u; }
  return choice - 1u;
}

fn smallIslandRocks(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  // Do not hoist this random upper bound out of the loop.
  for (var index = 0u; f32(index) < random(writer) * 5.0; index++) {
    if ((*writer).overflow != 0u) { return; }
    let position = origin + vec2f(uniform(writer, bounds.x, bounds.z),
      islandCenterY(bounds) + uniform(writer, -10.0, 10.0) + 10.0);
    let seedCoordinate = random(writer) * 100.0;
    let width = uniform(writer, 10.0, 30.0);
    let height = uniform(writer, 10.0, 30.0);
    rock(writer, position, vec2f(width, height), seedCoordinate, 2.0);
  }
}

fn leaningIslandGroups(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  for (var group = 0u; group < islandLeaningGroupCount(writer); group++) {
    if ((*writer).overflow != 0u) { return; }
    let center = origin + vec2f(uniform(writer, bounds.x, bounds.z),
      islandCenterY(bounds) + uniform(writer, -5.0, 5.0) + 20.0);
    for (var index = 0u; f32(index) < 2.0 + random(writer) * 3.0; index++) {
      if ((*writer).overflow != 0u) { return; }
      // Upstream clamps the displacement itself to local island bounds,
      // then adds it to the group's already translated center.
      let offset = clamp(uniform(writer, -30.0, 30.0), bounds.x, bounds.z);
      let height = uniform(writer, 60.0, 100.0);
      tree(writer, 8u, center + vec2f(offset, 0.0), height, 1.0, 0.0, ink(0.5));
    }
  }
}

fn largeIslandRocks(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f, randomLimit: f32) {
  for (var index = 0u; f32(index) < random(writer) * randomLimit; index++) {
    if ((*writer).overflow != 0u) { return; }
    let position = origin + vec2f(uniform(writer, bounds.x, bounds.z),
      islandCenterY(bounds) + uniform(writer, -5.0, 5.0) + 20.0);
    let seedCoordinate = random(writer) * 100.0;
    let width = uniform(writer, 50.0, 70.0);
    let height = uniform(writer, 40.0, 60.0);
    rock(writer, position, vec2f(width, height), seedCoordinate, 5.0);
  }
}

fn tieredIslandGrove(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  let range = islandGroveRange(writer, bounds);
  for (var horizontal = range.x; horizontal < range.y; horizontal += 30.0) {
    if ((*writer).overflow != 0u) { return; }
    if (horizontal + 30.0 <= horizontal) { (*writer).overflow = 1u; return; }
    let position = origin + vec2f(horizontal + 20.0 * uniform(writer, -1.0, 1.0),
      islandCenterY(bounds) + 20.0);
    let height = uniform(writer, 100.0, 300.0);
    tree(writer, 5u, position, height, 5.0, 0.0, ink(0.5));
  }
  largeIslandRocks(writer, origin, bounds, 4.0);
}

fn spreadingIslandTrees(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  for (var group = 0u; group < islandTreeGroupSize(writer); group++) {
    if ((*writer).overflow != 0u) { return; }
    let horizontal = uniform(writer, bounds.x, bounds.z);
    let vertical = islandCenterY(bounds);
    tree(writer, 4u, origin + vec2f(horizontal, vertical + 20.0), 300.0, 6.0, 0.0, ink(0.5));
    for (var index = 0u; f32(index) < random(writer) * 2.0; index++) {
      if ((*writer).overflow != 0u) { return; }
      let position = origin + vec2f(clamp(horizontal + uniform(writer, -50.0, 50.0), bounds.x, bounds.z),
        vertical + uniform(writer, -5.0, 5.0) + 20.0);
      // The random draw is retained even when a zero loop index makes seed 0.
      let seedCoordinate = f32(index * group) * random(writer) * 100.0;
      let width = uniform(writer, 50.0, 70.0);
      let height = uniform(writer, 40.0, 60.0);
      rock(writer, position, vec2f(width, height), seedCoordinate, 5.0);
    }
  }
}

fn forkedIslandTrees(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  for (var index = 0u; index < islandTreeGroupSize(writer); index++) {
    if ((*writer).overflow != 0u) { return; }
    let horizontal = uniform(writer, bounds.x, bounds.z);
    let height = uniform(writer, 60.0, 120.0);
    tree(writer, 6u, origin + vec2f(horizontal, islandCenterY(bounds)), height, 6.0, 0.0, ink(0.5));
  }
}

fn facetedIslandGrove(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  let range = islandGroveRange(writer, bounds);
  for (var horizontal = range.x; horizontal < range.y; horizontal += 20.0) {
    if ((*writer).overflow != 0u) { return; }
    if (horizontal + 20.0 <= horizontal) { (*writer).overflow = 1u; return; }
    let position = origin + vec2f(horizontal + 20.0 * uniform(writer, -1.0, 1.0),
      islandCenterY(bounds) + uniform(writer, -1.0, 1.0));
    let height = uniform(writer, 40.0, 80.0);
    tree(writer, 7u, position, height, 4.0, 0.2, ink(1.0));
  }
}

fn scatteredIslandLeaves(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  for (var index = 0u; f32(index) < 50.0 * random(writer); index++) {
    if ((*writer).overflow != 0u) { return; }
    let position = origin + vec2f(uniform(writer, bounds.x, bounds.z), uniform(writer, bounds.y, bounds.w));
    leafCluster(writer, position, 16.0, 8.0, 5u, ink(0.5));
  }
}

fn optionalIslandPavilion(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f, theme: u32) {
  // Original choice [0, 0, 0, 0, 1] occurs even for the excluded faceted theme.
  let choice = u32(random(writer) * 5.0);
  if (choice != 4u || theme == ISLAND_FACETED_GROVE || (*writer).overflow != 0u) { return; }
  let position = origin + vec2f(uniform(writer, bounds.x, bounds.z), islandCenterY(bounds) + 20.0);
  // The old arch01 seed argument preceded its size arguments. The queued
  // descriptor now owns its stream, but preserve that placement-level draw.
  _ = random(writer);
  let width = uniform(writer, 160.0, 200.0);
  let height = uniform(writer, 80.0, 100.0);
  let perspective = random(writer);
  building(writer, 1u, position, width, height, 0.7, perspective, 1u, 0u, true);
}

export fn decorateIsland(writer: ptr<function, Writer>, origin: vec2f, bounds: vec4f) {
  if ((*writer).overflow != 0u) { return; }
  if (bounds.x > bounds.z || bounds.y > bounds.w) { (*writer).overflow = 1u; return; }
  // Original weighted theme choice [0, 0, 1, 2, 3, 4], before any decoration.
  let choice = u32(random(writer) * 6.0);
  var theme = ISLAND_BOULDERS;
  if (choice >= 2u) { theme = choice - 1u; }
  smallIslandRocks(writer, origin, bounds);
  leaningIslandGroups(writer, origin, bounds);
  if ((*writer).overflow != 0u) { return; }
  if (theme == ISLAND_BOULDERS) {
    largeIslandRocks(writer, origin, bounds, 3.0);
  } else if (theme == ISLAND_TIERED_GROVE) {
    tieredIslandGrove(writer, origin, bounds);
  } else if (theme == ISLAND_SPREADING_TREES) {
    spreadingIslandTrees(writer, origin, bounds);
  } else if (theme == ISLAND_FORKED_TREES) {
    forkedIslandTrees(writer, origin, bounds);
  } else if (theme == ISLAND_FACETED_GROVE) {
    facetedIslandGrove(writer, origin, bounds);
  } else {
    (*writer).overflow = 1u;
    return;
  }
  if ((*writer).overflow != 0u) { return; }
  scatteredIslandLeaves(writer, origin, bounds);
  optionalIslandPavilion(writer, origin, bounds, theme);
}
