import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveShader } from '@vgpu/wgsl/runtime';

// Require native device validation. An unavailable adapter is a failure, not a pass.
for (const name of ['brushes', 'paths', 'paper']) {
  const entry = fileURLToPath(new URL(`../src/shaders/${name}.wgsl`, import.meta.url));
  const result = await resolveShader({ entry, validate: 'require' });
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], `${name}: shader diagnostics`);
  assert.equal(result.validation.ok, true, `${name}: native compilation failed`);
  console.log(`${name}.wgsl: native validation passed (${result.deps.length} modules)`);
}
