import assert from 'node:assert/strict';
import { generatePaths } from './runtime.mjs';

// SVG rounds to 0.1. Allow one rounding step when float32 lands on the other side
// of a decimal boundary; report the observed error rather than hiding it.
const tolerance = 0.11;

export async function checkCoordinates(gpu, fixture, packDrawing) {
  const fixtures = fixture.primitives;
  const packed = packDrawing(fixtures.map(fixture => fixture.command));
  const pointCount = fixtures.reduce((count, fixture) => count + fixture.expected.length, 0);
  assert.equal(packed.pointCount, pointCount, 'Packed output count differs from original SVG paths');
  const generated = await generatePaths(gpu, packed, fixture.table);
  const points = new Float32Array(await generated.points.read());
  const bounds = new Float32Array(await generated.bounds.read());
  let offset = 0;
  const cases = fixtures.map((fixture, command) => {
    let maxError = 0;
    for (const [index, point] of fixture.expected.entries()) {
      for (let axis = 0; axis < 2; axis++) {
        const actual = points[(offset + index) * 2 + axis];
        const error = Math.abs(point[axis] - actual);
        assert(Number.isFinite(actual) && error <= tolerance,
          `${fixture.name} point ${index} axis ${axis}: expected ${point[axis]}, received ${actual}`);
        maxError = Math.max(maxError, error);
      }
    }
    const expectedBounds = [
      Math.min(...fixture.expected.map(point => point[0])), Math.min(...fixture.expected.map(point => point[1])),
      Math.max(...fixture.expected.map(point => point[0])), Math.max(...fixture.expected.map(point => point[1])),
    ];
    const boundsError = Math.max(...expectedBounds.map((value, axis) => Math.abs(value - bounds[command * 4 + axis])));
    assert(Number.isFinite(boundsError) && boundsError <= tolerance, `${fixture.name}: incorrect GPU bounds (${boundsError})`);
    offset += fixture.expected.length;
    return { name: fixture.name, points: fixture.expected.length, maxError, boundsError };
  });
  return { pointCount, tolerance, maxError: Math.max(...cases.map(fixture => fixture.maxError)), cases };
}
