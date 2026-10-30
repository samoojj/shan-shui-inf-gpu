import { readFixture } from '../helpers/fixtures.mjs';

/** Data captured from the verified upstream; no original code executes in tests. */
export async function gpuFixtures() {
  const fixture = await readFixture('gpu');
  const bytes = Buffer.from(fixture.noiseTableBase64, 'base64');
  const table = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
  const primitives = fixture.primitives.map(({ command, ...rest }) => {
    if ('gridIndex' in command) {
      const { gridIndex, ...controls } = command;
      return { ...rest, command: { ...controls, grid: fixture.grids[gridIndex] } };
    }
    return { ...rest, command };
  });
  return { table, primitives, noise: fixture.noise };
}
