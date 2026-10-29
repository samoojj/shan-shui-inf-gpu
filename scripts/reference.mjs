import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { referenceCases } from '../tests/reference/cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const source = {
  repository: 'https://github.com/LingDong-/shan-shui-inf',
  commit: '9f754d2b2e73495db7883d4d4055a7b0903b0454',
  gitBlob: 'f0d1da751455f99b46756fcbdde8b02420f27d31',
  path: 'reference/original.html',
};

/** Keep the archived application unchanged; primitives use its first six scripts verbatim. */
export async function readReference() {
  const html = await readFile(resolve(root, 'reference/original.html'), 'utf8');
  const gitBlob = createHash('sha1').update(`blob ${Buffer.byteLength(html)}\0`).update(html).digest('hex');
  assert.equal(gitBlob, source.gitBlob, 'Reference differs from the pinned official LingDong source');
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(match => match[0]);
  assert(scripts[5]?.includes('function mountplanner('), 'Original script layout changed');
  return { html, scripts: scripts.slice(0, 6).join('\n'), sha256: hash(html) };
}

/** A dedicated server exposes only the original and an isolated definition-only iframe. */
export function serveReference(reference) {
  return createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    let html;
    if (path === '/') html = '<!doctype html><html><body style="margin:0"></body></html>';
    else if (path === '/reference/original.html') html = reference.html;
    else if (path === '/reference/primitives.html') html = `${reference.scripts}<body style="margin:0;background:white"></body>`;
    else { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  }).listen(0, '127.0.0.1');
}

// This runs inside reference iframes only. The original replaces its own Math.random;
// neither the host page nor the GPU implementation shares that global object.
function observeReference() {
  if (window === window.top || !location.pathname.startsWith('/reference/')) return;
  const trace = window.referenceTrace = { calls: {}, plans: [], loadingMs: 0 };
  function wrap(owner, name, prefix = '') {
    const original = owner[name];
    if (typeof original !== 'function') return;
    const key = prefix + name;
    owner[name] = function (...args) {
      trace.calls[key] = (trace.calls[key] || 0) + 1;
      const start = name === 'chunkloader' ? performance.now() : 0;
      const result = original.apply(this, args);
      if (name === 'mountplanner') trace.plans.push({ xmin: args[0], xmax: args[1], objects: structuredClone(result) });
      if (name === 'chunkloader') trace.loadingMs += performance.now() - start;
      return result;
    };
  }
  Object.defineProperty(window, 'MEM', {
    configurable: true,
    set(value) {
      delete window.MEM;
      window.MEM = value;
      for (const name of ['poly', 'stroke', 'blob', 'texture', 'water', 'mountplanner', 'chunkloader', 'chunkrender']) wrap(window, name);
      for (const group of ['Mount', 'Tree', 'Arch', 'Man']) {
        for (const name of Object.keys(window[group] || {})) wrap(window[group], name, `${group}.`);
      }
    },
  });
}

export async function openReference(browser, baseURL, seed, { primitives = false, observe = true, width = 3200, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (observe) await page.addInitScript(observeReference);
  await page.goto(baseURL);
  const hostRandom = await page.evaluate(() => Math.random.toString());
  const name = primitives ? 'primitives' : 'original';
  const navigation = page.waitForEvent('framenavigated', { predicate: candidate => candidate.url().includes(`/reference/${name}.html`) });
  await page.evaluate(({ source, width, height }) => {
    const iframe = document.createElement('iframe');
    iframe.src = source;
    iframe.style.cssText = `width:${width}px;height:${height}px;border:0;display:block`;
    document.body.append(iframe);
  }, { source: `${baseURL}/reference/${name}.html?seed=${encodeURIComponent(seed)}`, width, height });
  const frame = await navigation;
  await frame.waitForLoadState('load');
  await frame.waitForFunction(() => typeof Mount === 'object');
  if (observe) await frame.waitForFunction(() => !!window.referenceTrace);
  if (!primitives) {
    await frame.waitForSelector('#SVG');
    // Stop only the original UI's automatic scroll. Do not modify scene generation.
    await frame.evaluate(() => { window.present = () => {}; window.scrollTo(0, 0); });
    await frame.addStyleTag({ content: '#SETTING,#SOURCE_BTN,#L,#R{visibility:hidden!important}' });
  }
  assert.equal(await page.evaluate(() => Math.random.toString()), hostRandom, 'Reference changed host Math.random');
  assert.deepEqual(errors, [], 'Original application raised browser errors');
  return { page, frame, errors };
}

async function sceneMetadata(frame) {
  return frame.evaluate(() => {
    const svg = document.querySelector('#SVG');
    const tags = {}, primitives = {}, chunks = {};
    let points = 0;
    for (const node of svg.querySelectorAll('*')) {
      tags[node.tagName] = (tags[node.tagName] || 0) + 1;
      if (node.points) points += node.points.numberOfItems;
    }
    for (const chunk of MEM.chunks) chunks[chunk.tag] = (chunks[chunk.tag] || 0) + 1;
    for (const plan of referenceTrace.plans) for (const item of plan.objects) primitives[item.tag] = (primitives[item.tag] || 0) + 1;
    return {
      seed: SEED,
      dimensions: { width: MEM.windx, height: MEM.windy },
      viewBox: svg.getAttribute('viewBox'),
      generatedRange: { xmin: MEM.xmin, xmax: MEM.xmax, chunkWidth: MEM.cwid },
      plannedObjects: primitives, chunks, svgElements: tags, svgPoints: points,
      trace: referenceTrace, svg: svg.outerHTML,
      paper: document.getElementById('bgcanv').toDataURL('image/png'),
    };
  });
}

export async function captureScenes(browser, baseURL, output, seeds) {
  const scenes = [];
  for (const seed of seeds) {
    const { page, frame, errors } = await openReference(browser, baseURL, seed);
    try {
      const { svg, paper, ...metadata } = await sceneMetadata(frame);
      const name = seed.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fullPNG = await frame.locator('#SVG').screenshot({ path: resolve(output, `${name}-native.png`) });
      const bounds = await frame.locator('#SVG').boundingBox();
      const crops = [];
      for (const [width, height] of [[1200, 700], [1000, 800]]) {
        const filename = `${name}-${width}x${height}.png`;
        await page.screenshot({ path: resolve(output, filename), clip: { x: bounds.x, y: bounds.y, width, height } });
        crops.push({ filename, width, height, world: { x: 0, y: 0, width: width / 1.142, height: height / 1.142 } });
      }
      await writeFile(resolve(output, `${name}.svg`), svg);
      await writeFile(resolve(output, `${name}-paper.png`), Buffer.from(paper.split(',')[1], 'base64'));
      const result = { ...metadata, svgSHA256: hash(svg), pngSHA256: hash(fullPNG), filename: `${name}-native.png`, crops };
      await writeFile(resolve(output, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
      scenes.push(result);
      assert.deepEqual(errors, [], 'Reference failed during capture');
      console.log(`REFERENCE ${seed}: ${metadata.dimensions.width}×${metadata.dimensions.height}, ${metadata.svgElements.polyline || 0} polylines, ${metadata.svgPoints} points`);
    } finally { await page.close(); }
  }
  return scenes;
}

async function renderPrimitive(frame, fixture) {
  return frame.evaluate(fixture => {
    const args = structuredClone(fixture.args);
    if (fixture.subdivide) args[0] = div(args[0], fixture.subdivide);
    const path = fixture.target.split('.');
    const name = path.pop();
    const owner = path.reduce((value, key) => value[key], window);
    const markup = owner[name](...args);
    if (typeof markup !== 'string' || /NaN|Infinity/.test(markup)) throw new Error(`Invalid original primitive: ${fixture.name}`);
    const [, , width, height] = fixture.viewBox;
    document.body.innerHTML = `<svg id="SVG" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${fixture.viewBox.join(' ')}">${markup}</svg>`;
    const svg = document.querySelector('#SVG');
    let pointCount = 0;
    const elements = {};
    for (const node of svg.querySelectorAll('*')) {
      elements[node.tagName] = (elements[node.tagName] || 0) + 1;
      if (node.points) pointCount += node.points.numberOfItems;
    }
    const bounds = svg.getBBox();
    return { svg: svg.outerHTML, elements, pointCount, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, calls: referenceTrace.calls };
  }, fixture);
}

export async function capturePrimitives(browser, baseURL, output) {
  const directory = resolve(output, 'primitives');
  await mkdir(directory, { recursive: true });
  const fixtures = [];
  for (const fixture of referenceCases) {
    const options = { primitives: true, width: Math.max(800, fixture.viewBox[2]), height: Math.max(600, fixture.viewBox[3]) };
    const { page, frame, errors } = await openReference(browser, baseURL, 'reference-01', options);
    let record;
    try {
      const { svg, ...topology } = await renderPrimitive(frame, fixture);
      const png = await frame.locator('#SVG').screenshot({ path: resolve(directory, `${fixture.name}.png`) });
      await writeFile(resolve(directory, `${fixture.name}.svg`), svg);
      record = { ...fixture, seed: 'reference-01', ...topology, svgSHA256: hash(svg), pngSHA256: hash(png) };
      assert(topology.pointCount > 0, `${fixture.name} did not produce geometry`);
      assert.deepEqual(errors, [], `${fixture.name} raised browser errors`);
    } finally { await page.close(); }
    const repeated = await openReference(browser, baseURL, 'reference-01', options);
    try {
      const { svg } = await renderPrimitive(repeated.frame, fixture);
      assert.equal(hash(svg), record.svgSHA256, `${fixture.name} changed across fresh seeded realms`);
      const png = await repeated.frame.locator('#SVG').screenshot();
      assert.equal(hash(png), record.pngSHA256, `${fixture.name} changed pixels across repeated renders`);
    } finally { await repeated.page.close(); }
    fixtures.push(record);
    console.log(`PRIMITIVE ${fixture.name}: ${record.pointCount} points, exact repeated SVG/PNG`);
  }
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(fixtures, null, 2) + '\n');
  return fixtures;
}

export async function captureReference(options = {}) {
  const output = resolve(options.output || resolve(root, 'test-results/reference'));
  const seeds = options.seeds || ['1234', 'shan-shui', 'quiet-morning'];
  const reference = await readReference();
  await mkdir(output, { recursive: true });
  const server = serveReference(reference);
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
    const scenes = options.primitivesOnly ? [] : await captureScenes(browser, baseURL, output, seeds);
    let uninstrumentedRepeat;
    if (scenes.length) {
      const { page, frame } = await openReference(browser, baseURL, seeds[0], { observe: false });
      try {
        assert.equal(hash(await frame.locator('#SVG').evaluate(svg => svg.outerHTML)), scenes[0].svgSHA256);
        assert.equal(hash(await frame.locator('#SVG').screenshot()), scenes[0].pngSHA256);
        uninstrumentedRepeat = { seed: seeds[0], exactSVG: true, exactPNG: true };
      } finally { await page.close(); }
    }
    const primitives = options.scenesOnly ? [] : await capturePrimitives(browser, baseURL, output);
    const manifest = {
      source: { ...source, sha256: reference.sha256 },
      notes: [
        'Exact archived CPU application; no GPU renderer is involved.',
        'Original startup fixes a 3000×800 SVG and divides both viewBox dimensions by 1.142; browser viewport does not resize the scene.',
        'Smaller images are top-left viewport crops at native scale, not stretched or recomposed scenes.',
        'Only presentation scrolling and UI overlays are disabled after startup; original scene geometry and paper remain unchanged.',
        'Each seed runs in a fresh iframe. Original Math.random replacement stays in that iframe.',
        'loadingMs includes instrumentation and is diagnostic only, not a GPU performance comparison.',
        'Standalone primitives use the original definition scripts in fresh realms with seed reference-01 and untouched lazy Perlin initialization; every SVG and PNG is reproduced exactly in a second realm.',
      ],
      scenes,
      uninstrumentedRepeat,
      primitives,
    };
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--seeds=')) options.seeds = argument.slice(8).split(',');
    else if (argument.startsWith('--output=')) options.output = argument.slice(9);
    else if (argument === '--scenes-only') options.scenesOnly = true;
    else if (argument === '--primitives-only') options.primitivesOnly = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  await captureReference(options);
}
