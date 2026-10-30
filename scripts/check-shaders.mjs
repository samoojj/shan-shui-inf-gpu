import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { resolveShader } from '@vgpu/wgsl/runtime';

// Require native device validation. An unavailable adapter is a failure, not a pass.
const directory = new URL('../src/shaders/', import.meta.url);
for (const file of (await readdir(directory)).filter(name => name.endsWith('.wgsl')).sort()) {
  if (!/@(compute|vertex|fragment)\b/.test(await readFile(new URL(file, directory), 'utf8'))) continue;
  const name = file.slice(0, -5);
  const entry = fileURLToPath(new URL(`../src/shaders/${name}.wgsl`, import.meta.url));
  const result = await resolveShader({ entry, validate: 'require' });
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], `${name}: shader diagnostics`);
  assert.equal(result.validation.ok, true, `${name}: native compilation failed`);
  console.log(`${name}.wgsl: native validation passed (${result.deps.length} modules)`);
}
