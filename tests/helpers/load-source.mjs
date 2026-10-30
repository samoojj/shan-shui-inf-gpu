import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Bundle a private CPU module for tests without adding package exports. */
export async function loadSource(path) {
  const entry = fileURLToPath(new URL(`../../${path}`, import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}
