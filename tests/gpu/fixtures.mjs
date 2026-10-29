import { nextNoiseOffset, svgPoints } from './reference.mjs';

/** Original SVG output is the oracle; production commands contain only control data. */
export function primitiveFixtures(original) {
  const fixtures = [];
  const paint = { fill: 'black', edge: 'black', outline: 1 };
  const sine = value => Math.sin(Math.PI * value);

  function stroke(name, points, args = {}) {
    const seed = nextNoiseOffset(original);
    const profile = args.fun ?? sine;
    fixtures.push({
      name,
      expected: svgPoints(original.stroke(points, args)),
      command: {
        ...paint, kind: 'stroke', points,
        widths: points.map((_, index) => (args.wid ?? 2) * profile(index / points.length)),
        offset: [args.xof ?? 0, args.yof ?? 0], noise: args.noi ?? 0.5, seed,
      },
    });
  }

  stroke('stroke-two-points', [[20, 30], [100, 70]], { wid: 4 });
  stroke('stroke-one-point-emits-three', [[30, 50]], { wid: 4 });
  stroke('stroke-sine-long', Array.from({ length: 37 }, (_, i) => [30 + i * 6, 70 + Math.sin(i * .37) * 30]),
    { wid: 7, xof: 300.7, yof: -47.2 });
  stroke('stroke-angle-wrap', [[10, 10], [9.2, 9.9], [8.4, 10.1], [7.6, 9.9], [6.8, 10.1], [6, 10]],
    { wid: 3, noi: 1 });
  stroke('stroke-constant-zigzag', [[0, 0], [5, 20], [0, 40], [5, 60], [0, 80], [5, 100]],
    { wid: 10, fun: () => 1, noi: 0, xof: -100, yof: 200 });
  stroke('stroke-repeated-center', [[20, 10], [20, 10], [40, 40], [40, 40], [50, 70]], { wid: 2 });
  stroke('stroke-custom-profile', Array.from({ length: 25 }, (_, i) => [200 + 3 * i, 80 + Math.sin(i * .2) * 40]),
    { wid: 5, fun: t => Math.sin(t * Math.PI) * Math.sin(t * 5), noi: .8, xof: -900, yof: -100 });

  const defaultBlob = p => p <= 1 ? Math.sin(p * Math.PI) ** .5 : -(Math.sin((p + 1) * Math.PI) ** .5);
  function blob(name, x, y, args = {}) {
    const seed = nextNoiseOffset(original);
    const profile = args.fun ?? defaultBlob;
    fixtures.push({
      name,
      expected: svgPoints(original.blob(x, y, args)),
      command: {
        ...paint, kind: 'blob', outline: 0, center: [x, y], length: args.len ?? 20,
        width: args.wid ?? 5, angle: args.ang ?? 0, noise: args.noi ?? .5, seed,
        profile: Array.from({ length: 21 }, (_, i) => profile(i / 20 * 2)),
      },
    });
  }
  blob('blob-default', 120, 70, { len: 160, wid: 45, ang: -.2 });
  blob('blob-flat-noise-zero', -50, 180, { len: 100, wid: 12, ang: Math.PI / 2, noi: 0 });
  blob('blob-diamond', 200, 130, { len: 70, wid: 30, ang: 1.7, noi: 1,
    fun: p => p <= 1 ? 1 - Math.abs(2 * p - 1) : -(1 - Math.abs(2 * (p - 1) - 1)) });
  blob('blob-sine-leaf', 400, 600, { len: 120, wid: 80, ang: 3, noi: .8, fun: p => Math.sin(p * Math.PI) });
  blob('blob-asymmetric-leaf', -300, -100, { len: 150, wid: 45, ang: -2.7, noi: .3,
    fun: p => p <= 1 ? Math.sin(p * Math.PI) ** .3 : -(Math.sin((p - 1) * Math.PI) ** 2) });

  const grid = Array.from({ length: 8 }, (_, row) => Array.from({ length: 50 }, (_, column) => [
    30 + column * 5, 40 + row * 15 - 20 * Math.sin(column / 49 * Math.PI),
  ]));
  function texture(name, layer, start, count, width, jitter, offset) {
    const fraction = layer - Math.floor(layer);
    // This is the original texture centerline formula, evaluated with upstream
    // Noise. Its stroke() remains the oracle for expansion and SVG rounding.
    const centers = Array.from({ length: count }, (_, index) => {
      const column = start + index;
      const lower = grid[Math.floor(layer)][column], upper = grid[Math.ceil(layer)][column];
      const x = lower[0] * fraction + upper[0] * (1 - fraction);
      const y = lower[1] * fraction + upper[1] * (1 - fraction);
      return [x + jitter * (original.Noise.noise(x, column * .5) - .5),
        y + jitter * (original.Noise.noise(y, column * .5) - .5)];
    });
    const seed = nextNoiseOffset(original);
    fixtures.push({
      name,
      expected: svgPoints(original.stroke(centers.map(p => [p[0] + offset[0], p[1] + offset[1]]), { wid: width })),
      command: { ...paint, kind: 'texture', grid, layer, start, count, width, jitter, offset, noise: .5, seed },
    });
  }
  texture('texture-integer-first-row', 0, 5, 16, 1.5, 30, [200, 300]);
  texture('texture-reversed-fraction', .3, 13, 20, 2, 30 / 1.3, [0, 0]);
  texture('texture-reversed-mid', 1.5, 20, 25, 3, 12, [-300, 50]);
  texture('texture-upper-row', 6.2, 38, 11, 1.5, 30 / 7.2, [3000, -300]);
  texture('texture-short', 4.75, 1, 3, 8, 30 / 5.75, [-40, -70]);
  texture('texture-integer-last-row', 7, 5, 20, 3, 30 / 8, [50, 10]);
  return fixtures;
}
