import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { build } from 'esbuild';

// Development-only recapture from the reviewed CPU port. No production shader
// is imported, and normal acceptance never regenerates its own expectations.
const revision = '60e75d4';
const sourcePaths = ['context.js', 'primitives.ts', 'geometry.ts', 'trees.js', 'signage.ts'];
const sources = Object.fromEntries(sourcePaths.map(name => [name,
  execFileSync('git', ['show', `${revision}:src/composition/${name}`], { encoding: 'utf8' })]));
const sourceHashes = Object.fromEntries(Object.entries(sources).map(([path, source]) =>
  [path, createHash('sha256').update(source).digest('hex')]));
const existing = JSON.parse(await readFile(new URL('../tests/fixtures/construction.json', import.meta.url), 'utf8')).trees;
const bytes = Buffer.from(existing.noiseTableBase64, 'base64');
const table = Array.from({ length: 4096 }, (_, i) => bytes.readFloatLE(i * 4));
// Supply exactly the captured float32 table to the original p5 interpolation.
sources['context.js'] = sources['context.js'].replace('var perlin;', `var perlin = ${JSON.stringify(table)};`);
const result = await build({
  stdin: { contents: `import {createContext} from './context.js'; import {createPrimitives} from './primitives.js'; import {createTrees} from './trees.js';
    export function capture(input, randomValue) {
      const context = createContext('controlled'); context.Math.random = () => randomValue;
      const trees = createTrees({...context, ...createPrimitives(context)});
      return trees['tree'+String(input.style).padStart(2,'0')](...input.origin, {hei:input.height,wid:input.width,col:'rgba(100,100,100,0.5)'});
    }`, resolveDir: '/historical', loader: 'js' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'pinned-cpu-recipes', setup(builder) {
    builder.onResolve({ filter: /^\.\// }, args => ({ path: posix.basename(args.path).replace(/\.js$/, '.js'), namespace: 'historical' }));
    builder.onLoad({ filter: /.*/, namespace: 'historical' }, args => {
      const key = sources[args.path] === undefined ? args.path.replace(/\.js$/, '.ts') : args.path;
      if (sources[key] === undefined) throw new Error(`Unexpected reference dependency: ${args.path}`);
      return { contents: sources[key], loader: key.endsWith('.ts') ? 'ts' : 'js' };
    });
  } }],
});
const { capture } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const randomValues = [.5, .4];
const cases = randomValues.flatMap(randomValue => existing.cases.filter(input => [4, 5, 6, 8].includes(input.style)).map(input => {
  const description = { ...input, origin: existing.origin };
  return { ...description, randomValue, drawing: capture(description, randomValue) };
}));
const fixture = { provenance: { revision, sourceHashes, randomValues,
  noise: 'construction.json trees.noiseTableBase64; original p5 interpolation supplied that exact float32 table',
  scope: 'Complete ordered drawings for styles 4–6 and 8, with every random call fixed at 0.5 or 0.4. These exercise bark endpoint aliasing and both one/two-child recursive branch decisions. Scheduling-independent input does not assert same-seed parity.' },
  noiseTableBase64: existing.noiseTableBase64, cases };
await writeFile(new URL('../tests/fixtures/controlled-trees.json', import.meta.url), `${JSON.stringify(fixture, (_, value) => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value)}\n`);
console.log(JSON.stringify(cases.map(({style,randomValue,drawing})=>({style,randomValue,commands:drawing.length}))));
