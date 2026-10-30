import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { init, compute, storage, draw, frame, target } from 'vgpu/node';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { prepareShader } from '@vgpu/wgsl/prepare';
import { PNG } from 'pngjs';

// These renders are review evidence, never a generated replacement for CPU oracles.
const directory = new URL('../test-results/visual-corpus/', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/construction.json', import.meta.url), 'utf8'));
const motifFixture = JSON.parse(await readFile(new URL('../tests/fixtures/gpu-motifs.json', import.meta.url), 'utf8'));
const width = 640, height = 480;
const zooms = (process.env.VISUAL_CORPUS_ZOOMS || '1,2').split(',').map(Number);
assert(zooms.length && zooms.every(x => Number.isFinite(x) && x > 0 && x <= 4), 'Invalid VISUAL_CORPUS_ZOOMS');
const filter = process.env.VISUAL_CORPUS_FILTER || '';
const ink = [100 / 255, 100 / 255, 100 / 255, .5];
function object(kind, origin, size, rest = {}) {
  return { kind, origin, size, seed: 12345678, style: 0, flags: 0, rotation: 0, perspective: 0, bend: 0, color: ink, ...rest };
}
function sample(seed) { let v = seed; v ^= v << 13; v ^= v >>> 17; v ^= v << 5; return (v >>> 8) / 16777216; }
const scenes = fixture.trees.cases.filter(x => !x.clusterCount).map(input => ({
  name: `tree-${input.style}-${input.name}`, category: 'tree',
  descriptors: [object(6, [0, 0], [input.width, input.height], { style: input.style, bend: input.bend })],
}));
const themes = ['boulders', 'tiered-grove', 'spreading-trees', 'forked-trees', 'faceted-grove'];
for (let theme = 0; theme < themes.length; theme++) {
  const source = fixture.islands.cases.find(c => Math.max(0, Math.floor(sample(c.seed) * 6) - 1) === theme);
  assert(source, `Missing independent island theme ${theme}`);
  scenes.push({ name: `island-${themes[theme]}`, category: 'island-decoration', seed: source.seed,
    descriptors: source.descriptors.map(d => object(d[1], [d[4], d[5]], [d[6], d[7]], {
      seed: d[0], style: d[2], flags: d[3], rotation: d[8], perspective: d[9], bend: d[10], color: d.slice(12, 16),
    })), source: 'independent CPU-captured island layout; child geometry constructed natively' });
}
for (const input of motifFixture.cases.filter(x => !x.expectOverflow)) {
  const r = input.request;
  const kind = [11, 8, 12, 4, 10, 5][r.kind];
  assert(kind, `Unknown fixture motif ${r.kind}`);
  scenes.push({ name: `motif-${input.label}`, category: 'motif', descriptors: [object(kind, r.origin,
    [r.width, kind === 4 || kind === 12 ? r.scale : r.height], {
      style: kind === 5 ? r.clusters : r.style,
      flags: kind === 8 ? r.stories | (r.decoration << 8) | ((r.flags & 1) << 16) : r.flags,
      seed: r.seed, rotation: r.rotation, perspective: r.perspective,
    })] });
}
scenes.push({ name: 'rock', category: 'motif', descriptors: [object(9, [0, 0], [100, 80], { perspective: 5, rotation: 12 })] });
scenes.push({ name: 'dense-overlap', category: 'occlusion', descriptors: [
  object(5, [0, 10], [600, 2], { style: 10 }),
  ...[6, 7, 4, 3, 5].map((style, i) => object(6, [-90 + i * 45, i * 8], [5, style === 6 ? 103 : 120], { style, bend: .1, seed: 234567 + i })),
  object(8, [35, 25], [70, 15], { style: 2, flags: 3 | (2 << 8) | (1 << 16), rotation: .7, perspective: 5 }),
  object(9, [-20, 40], [90, 65], { perspective: 5, rotation: 12 }),
  object(4, [60, 65], [120, .7]),
] });

const selected = scenes.filter(s => s.name.includes(filter));
assert(selected.length, `No visual corpus cases match ${filter}`);
await mkdir(directory, { recursive: true });
const gpu = await init({ requiredLimits: { maxStorageBuffersInVertexStage: 2, maxStorageBuffersInFragmentStage: 2 } });
const errors = [];
gpu.onError(error => errors.push(error.message));
const table = storage(gpu, 4096 * 4, 'read');
table.write(Buffer.from(fixture.trees.noiseTableBase64, 'base64'));
async function shader(name) {
  const entry = fileURLToPath(new URL(name.startsWith('corpus-') ? `../tests/gpu/${name}.wgsl` : `../src/shaders/${name}.wgsl`, import.meta.url));
  const resolved = await resolveShader({ entry, validate: 'off' });
  assert.deepEqual(resolved.diagnostics.filter(x => x.severity === 'error'), []);
  return prepareShader(resolved, entry);
}
const family = { 4: 'construct-boats', 5: 'construct-water', 6: 'construct-trees', 7: 'construct-trees',
  8: 'construct-buildings', 9: 'construct-rocks', 10: 'construct-towers', 11: 'construct-huts', 12: 'corpus-figures' };
const constructors = [...new Set(selected.flatMap(scene => scene.descriptors.map(d => family[d.kind])))];
assert(constructors.every(Boolean), 'A corpus descriptor has no constructor');
const names = ['allocate-children', ...constructors, 'count-brushes', 'compact-brushes', 'brushes'];
const pipelines = Object.fromEntries(await Promise.all(names.map(async name => [name, compute(gpu, await shader(name), { label: `visual corpus ${name}` })])));
let paths;
const info = gpu.device.adapterInfo;
const sourcePaths = (await readdir(new URL('../src/shaders/', import.meta.url))).filter(path => path.endsWith('.wgsl'))
  .map(path => `src/shaders/${path}`).concat('tests/gpu/corpus-figures.wgsl');
const manifest = { adapter: { vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(sourcePaths.sort().map(async path =>
    [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')]))),
  dimensions: { width, height }, zooms,
  purpose: 'Inspect native construction and rasterization; not a whole-scene parity or performance claim.', cases: [] };

function descriptorsBytes(descriptors) {
  const bytes = new ArrayBuffer(descriptors.length * 80), f = new Float32Array(bytes), u = new Uint32Array(bytes);
  descriptors.forEach((d, i) => {
    const b = i * 20;
    f.set([...d.origin, ...d.size], b); u.set([d.seed, d.kind, d.style, d.flags], b + 4);
    f.set([d.rotation, d.perspective, d.bend, 0], b + 8); f.set(d.color, b + 16);
  });
  return bytes;
}

try {
  // Keep native compiler memory bounded on software adapters.
  for (const [name, pipeline] of Object.entries(pipelines)) {
    await pipeline.compile();
    console.log(`Compiled ${name}`);
  }
  for (const scene of selected) {
    const buffers = [];
    const allocate = (bytes, data) => { const b = storage(gpu, Math.max(16, bytes)); buffers.push(b); if (data) b.write(data); return b; };
    const children = allocate(scene.descriptors.length * 80, descriptorsBytes(scene.descriptors));
    const childQueue = allocate(16, new Uint32Array([scene.descriptors.length, 0, 0, 0]));
    const parentCounts = allocate(16, new Uint32Array([scene.descriptors.length, 0, 0, 0]));
    const emptyCounts = allocate(16);
    const summary = allocate(16);
    let image;
    try {
      pipelines['allocate-children'].set({ allocation: { parentControls: 0 }, children, childQueue, parentCounts: emptyCounts, summary });
      pipelines['allocate-children'].dispatch(1);
      const allocation = new Uint32Array(await summary.read());
      assert.equal(allocation[3], 0, `${scene.name}: child allocation overflow`);
      // The figures use the default tiny unknown-kind arena in production's
      // allocator; its test-only descriptor needs an explicit figure arena.
      let descriptions = new Uint32Array(await children.read());
      let commandCapacity = allocation[1], controlCapacity = allocation[2];
      for (let i = 0; i < scene.descriptors.length; i++) if (scene.descriptors[i].kind === 12) {
        const b = i * 20;
        descriptions[b + 12] = commandCapacity; descriptions[b + 13] = 1024;
        descriptions[b + 14] = controlCapacity; descriptions[b + 15] = 8192;
        commandCapacity += 1024; controlCapacity += 8192;
      }
      children.write(descriptions);
      const childJobs = allocate(commandCapacity * 128), inputData = allocate(controlCapacity * 16);
      const childCounts = allocate(scene.descriptors.length * 16);
      for (const name of constructors) {
        pipelines[name].set({ children, noiseTable: table, constructionJobs: childJobs, constructionControls: inputData, childCounts });
        pipelines[name].dispatch(scene.descriptors.length);
      }
      const objects = allocate(80);
      const markerData = new Uint32Array(scene.descriptors.length * 32);
      for (let i = 0; i < scene.descriptors.length; i++) { markerData[i * 32] = 4; markerData[i * 32 + 1] = i; }
      const parentJobs = allocate(markerData.byteLength, markerData), offsets = allocate(16);
      pipelines['count-brushes'].set({ objects, parentCounts, childCounts, parentJobs, offsets, summary });
      pipelines['count-brushes'].dispatch(1);
      const [commandCount, pointCount, , overflow] = new Uint32Array(await summary.read());
      assert.equal(overflow, 0, `${scene.name}: construction overflow`);
      assert(commandCount && pointCount, `${scene.name}: empty construction`);
      const jobs = allocate(commandCount * 128), points = allocate(pointCount * 8), bounds = allocate(commandCount * 16);
      pipelines['compact-brushes'].set({ objects, children, parentCounts, childCounts, parentJobs, childJobs, offsets, jobs });
      pipelines['compact-brushes'].dispatch(1);
      pipelines.brushes.set({ jobs, inputData, noiseTable: table, points, bounds });
      pipelines.brushes.dispatch(Math.ceil(commandCount / 64));
      const boxes = new Float32Array(await bounds.read());
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < boxes.length; i += 4) {
        assert(boxes.slice(i, i + 4).every(Number.isFinite), `${scene.name}: nonfinite bounds`);
        minX = Math.min(minX, boxes[i]); minY = Math.min(minY, boxes[i + 1]);
        maxX = Math.max(maxX, boxes[i + 2]); maxY = Math.max(maxY, boxes[i + 3]);
      }
      const baseSpan = Math.max(maxX - minX, (maxY - minY) * width / height, 10) * 1.15;
      const center = [(minX + maxX) / 2, (minY + maxY) / 2];
      image = target(gpu, { size: [width, height], format: 'rgba8unorm' });
      if (!paths) paths = draw(gpu, { shader: await shader('paths'), vertices: 6, blend: 'premultiplied' });
      paths.set({ jobs, points, bounds });
      await paths.compile(image);
      const records = [];
      for (const zoom of zooms) {
        const span = [baseSpan / zoom, baseSpan * height / width / zoom];
        paths.set({ view: { resolution: [width, height], span, offset: [center[0] - span[0] / 2, center[1] - span[1] / 2] } });
        frame(gpu, current => current.pass({ target: image, clear: [1, 1, 1, 1] }, pass => pass.draw(paths, { instances: commandCount })));
        const pixels = await image.color.read({ mipLevel: 0, region: 'all' });
        let minimum = 255, maximum = 0;
        for (let i = 0; i < pixels.length; i += 4) { minimum = Math.min(minimum, pixels[i]); maximum = Math.max(maximum, pixels[i]); }
        for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, `${scene.name}: transparent pixel`);
        assert(maximum - minimum > 5, `${scene.name}: blank output at zoom ${zoom}`);
        const png = new PNG({ width, height }); png.data.set(pixels);
        const filename = `${scene.name}-zoom-${zoom}.png`;
        await writeFile(new URL(filename, directory), PNG.sync.write(png));
        records.push({ zoom, filename, span, pixelSha256: createHash('sha256').update(pixels).digest('hex') });
      }
      manifest.cases.push({ name: scene.name, category: scene.category, source: scene.source || 'native production constructors from fixed descriptors',
        descriptorCount: scene.descriptors.length, seed: scene.seed, commandCount, pointCount, renders: records });
      console.log(`Rendered ${scene.name}: ${commandCount} brushes at ${zooms.length} zoom levels`);
    } finally { image?.destroy(); for (const buffer of buffers) buffer.destroy(); }
  }
  await gpu.settled();
  assert.deepEqual(errors, [], 'Visual corpus GPU errors');
  // Navigation preview only; all acceptance images above remain untouched.
  const columns = 4, tileWidth = 256, tileHeight = 192, gutter = 12;
  const sheetRows = Math.ceil(manifest.cases.length / columns);
  const sheet = new PNG({ width: columns * (tileWidth + gutter) + gutter, height: sheetRows * (tileHeight + gutter) + gutter });
  sheet.data.fill(255);
  manifest.contactSheet = { filename: 'contact-sheet.png', columns, order: manifest.cases.map(c => c.name) };
  for (const [index, scene] of manifest.cases.entries()) {
    const source = PNG.sync.read(await readFile(new URL(scene.renders[0].filename, directory)));
    const left = gutter + index % columns * (tileWidth + gutter), top = gutter + Math.floor(index / columns) * (tileHeight + gutter);
    for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) {
      const from = (Math.floor(y * source.height / tileHeight) * source.width + Math.floor(x * source.width / tileWidth)) * 4;
      const to = ((top + y) * sheet.width + left + x) * 4;
      sheet.data.set(source.data.subarray(from, from + 4), to);
    }
  }
  await writeFile(new URL('contact-sheet.png', directory), PNG.sync.write(sheet));
  await writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const rows = manifest.cases.map(c => `<section><h2>${escape(c.name)}</h2><p>${escape(c.source)}; ${c.commandCount} brushes</p>${c.renders.map(r => `<figure><a href="${r.filename}"><img width="640" height="480" src="${r.filename}"></a><figcaption>${r.zoom}× relative zoom · ${width}×${height} actual pixels</figcaption></figure>`).join('')}</section>`).join('');
  await writeFile(new URL('index.html', directory), `<!doctype html><meta charset="utf-8"><title>Native GPU visual corpus</title><style>body{font:16px system-ui;margin:24px;background:#ddd;color:#222}section{margin-bottom:32px}figure{display:inline-block;margin:8px;vertical-align:top}img{display:block;background:white;max-width:100%;height:auto}figcaption{margin-top:8px}</style><h1>Native GPU visual corpus</h1><p>Inspect PNGs at 1:1 pixels. This gallery is rendered evidence, not an independently approved baseline. Geometry comes from production WGSL constructors; island-layout inputs are independently captured CPU descriptors. White backgrounds expose antialiasing and occlusion without paper texture masking them.</p>${rows}`);
  console.log(`Visual corpus: ${directory.pathname}index.html`);
} finally { paths?.dispose(); for (const pipeline of Object.values(pipelines)) pipeline.dispose(); table.destroy(); gpu.dispose(); }
