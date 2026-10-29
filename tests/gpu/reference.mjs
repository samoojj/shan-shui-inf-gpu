import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/** Isolated upstream definitions, with a read-only hook into its original noise table. */
export async function originalPrimitives() {
  const source = await readFile(new URL('../../reference/original.html', import.meta.url), 'utf8');
  const hash = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
  assert.equal(hash, 'f0d1da751455f99b46756fcbdde8b02420f27d31', 'The pinned upstream reference changed');
  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const context = vm.createContext({
    window: { btoa: value => Buffer.from(value, 'binary').toString('base64') },
    console: { log() {} },
  });
  vm.runInContext(scripts[0], context);
  vm.runInContext('Math.seed("brush-gpu-comparison")', context);
  assert.equal(scripts[2].split('var perlin;').length, 2, 'Noise table hook must have exactly one target');
  vm.runInContext(scripts[2].replace('var perlin;', 'var perlin; this.getTable = function() { return perlin; };'), context);
  for (const script of [scripts[3], scripts[4], scripts[5].split('  function mountplanner(')[0]]) {
    vm.runInContext(script, context);
  }
  context.Math = vm.runInContext('Math', context);
  // Both implementations receive this exact table. Composition tests separately
  // verify the original lazy initialization and serial random-consumption order.
  context.Noise.noise(0);
  return context;
}

export function nextNoiseOffset(original) {
  const state = original.Prng.s;
  const value = original.Math.random() * 10;
  original.Prng.s = state;
  return value;
}

export function svgPoints(svg) {
  return svg.match(/points='([^']*)'/)[1].trim().split(/\s+/).map(pair => pair.split(',').map(Number));
}
