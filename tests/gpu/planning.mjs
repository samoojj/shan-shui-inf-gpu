import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compute, storage } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';

const chunkBytes = 128 * 80;
function seedHash(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  return value >>> 0;
}

/** Execute the production planner; record sampling anchors in unused island metadata. */
export async function checkPlanning(gpu) {
  const directory = new URL('../../src/shaders/', import.meta.url);
  const modules = Object.fromEntries(await Promise.all((await readdir(directory))
    .filter(name => name.endsWith('.wgsl'))
    .map(async name => [`src/shaders/${name}`, await readFile(new URL(name, directory), 'utf8')])));
  const call = 'let accepted = add(&records, &count, object(ISLAND, origin, &randomState), 10.0);';
  assert(modules['src/shaders/plan.wgsl'].includes(call), 'Island probe must identify the production call');
  modules['src/shaders/plan.wgsl'] = modules['src/shaders/plan.wgsl'].replace(call,
    'var description = object(ISLAND, origin, &randomState); description.bend = position; let accepted = add(&records, &count, description, 10.0);');
  const shader = async name => {
    const entry = `src/shaders/${name}.wgsl`;
    const result = await resolveShader({ entry, rootDir: 'src', modules, validate: 'off' });
    assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
    return prepareShader(result, entry);
  };
  const noiseTable = storage(gpu, 4096 * 4);
  const paperRandom = storage(gpu, 257 * 257 * 4);
  const candidates = storage(gpu, 12 * chunkBytes);
  const overflow = storage(gpu, 16);
  const initialize = compute(gpu, await shader('initialize'), { set: { noiseTable, paperRandom } });
  const planner = compute(gpu, await shader('plan'), { set: { noiseTable, candidates, overflow } });
  async function run(firstChunk, chunkCount, seed) {
    candidates.write(new Uint8Array(12 * chunkBytes));
    overflow.write(new Uint32Array(4));
    planner.set({ planning: { seed, firstChunk, chunkCount, padding: 0 } });
    planner.dispatch(chunkCount);
    const bytes = await candidates.read();
    assert.equal(new Uint32Array(await overflow.read())[3], 0, 'Planner arena overflow');
    const view = new DataView(bytes), objects = [];
    for (let slot = 0; slot < chunkCount * 128; slot++) {
      const base = slot * 80, kind = view.getUint32(base + 20, true);
      if (kind) objects.push({ kind, chunk: firstChunk + Math.floor(slot / 128),
        x: view.getFloat32(base, true), anchor: view.getFloat32(base + 40, true) });
    }
    return { bytes: new Uint8Array(bytes), objects };
  }
  try {
    await initialize.compile(); await planner.compile();
    let islands = 0, mountains = 0;
    for (const text of ['0', '1', '2', 'boundary-left', 'boundary-right']) {
      const seed = seedHash(text);
      initialize.set({ seed: { value: seed } });
      initialize.dispatch(Math.ceil(257 * 257 / 64));
      const wide = await run(-4, 12, seed);
      mountains += wide.objects.filter(item => item.kind === 1).length;
      for (const island of wide.objects.filter(item => item.kind === 2 && item.chunk >= -2 && item.chunk <= 5)) {
        islands++;
        for (const mountain of wide.objects.filter(item => item.kind === 1)) {
          assert(Math.abs(mountain.x - island.anchor) >= 200,
            `Seed ${text}: island anchor ${island.anchor} in chunk ${island.chunk} ignores mountain ${mountain.x} from chunk ${mountain.chunk}`);
        }
      }
      if (text === '1') {
        assert(wide.objects.some(item => item.kind === 1 && item.chunk === -3 && Math.abs(item.x + 1045.950927734375) < .001),
          'Keep the reproduced neighboring mountain');
        assert(!wide.objects.some(item => item.kind === 2 && item.chunk === -2 && item.anchor === -1014),
          'Seed 1 must reject the previously accepted boundary island');
      }
      // Both left/right edges of a generated range must agree with a wide view.
      for (const firstChunk of [-2, 2]) {
        const narrow = await run(firstChunk, 2, seed);
        const expected = wide.bytes.slice((firstChunk + 4) * chunkBytes, (firstChunk + 6) * chunkBytes);
        assert.deepEqual(narrow.bytes.slice(0, 2 * chunkBytes), expected, 'Range boundaries changed chunk descriptors');
      }
      const repeated = await run(-4, 12, seed);
      assert.deepEqual(repeated.bytes, wide.bytes, 'Navigation history changed the planner');
    }
    assert(islands > 0 && mountains > 0, 'Occupancy acceptance must exercise both land families');
    return { seeds: 5, islands, mountains, neighborRadius: 2, rangeIndependent: true, seedOneRegression: true };
  } finally {
    initialize.dispose(); planner.dispose();
    noiseTable.destroy(); paperRandom.destroy(); candidates.destroy(); overflow.destroy();
  }
}
