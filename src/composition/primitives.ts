// Port of Lingdong Huang's poly/stroke/blob/texture (MIT), upstream index.html:485–741.
// Record original construction inputs. WGSL constructs the noisy brush polygons.
import type { Drawing, Point, ContourStroke } from '../scene/commands.js';
import { SIGNAGE_GLYPHS, SIGNAGE_KERNING } from './signage.js';
import type { CompositionContext, RecipeOptions } from './contracts.js';
import { blobProfile } from './geometry.js';

type Context = Pick<CompositionContext, 'Math' | 'Noise' | 'loopNoise'>;
const copy = (points: readonly Readonly<Point>[]): Point[] => points.map(p => [p[0], p[1]]);

export function createPrimitives(context: Context) {
  const { Math, Noise, loopNoise } = context;
  function poly(points: Point[], args: RecipeOptions = {}): Drawing {
    const fill = args.fil ?? 'rgba(0,0,0,0)';
    return [{ kind: 'polygon', points: copy(points), offset: [args.xof ?? 0, args.yof ?? 0],
      fill, edge: args.str ?? fill, outline: args.wid ?? 0 }];
  }

  function stroke(points: Point[], args: RecipeOptions = {}): Drawing {
    if (!points.length) return [];
    const width = args.wid ?? 2;
    const profile = args.fun ?? ((t: number) => Math.sin(t * Math.PI));
    const seed = Math.random() * 10;
    // The original noise table initializes on the first interior stroke point.
    if (points.length > 2) Noise.noise(0);
    const widths = points.map((_, i) => i > 0 && i < points.length - 1 ? width * profile(i / points.length) : 0);
    const color = args.col ?? 'rgba(200,200,200,0.9)';
    return [{ kind: 'stroke', points: copy(points), widths, seed, noise: args.noi ?? .5,
      offset: [args.xof ?? 0, args.yof ?? 0], fill: color, edge: color, outline: args.out ?? 1 }];
  }

  function blob(x: number, y: number, args: RecipeOptions = {}): Drawing | Point[] {
    const length = args.len ?? 20, width = args.wid ?? 5, angle = args.ang ?? 0, noise = args.noi ?? .5;
    const fun = args.fun ?? blobProfile;
    const profile = Array.from({ length: 21 }, (_, i) => fun(i / 20 * 2));
    const seed = Math.random() * 10;
    Noise.noise(0);
    const color = args.col ?? 'rgba(200,200,200,0.9)';
    if (!args.ret) {
      return [{ kind: 'blob', center: [x, y], length, width, angle, profile, seed, noise,
        fill: color, edge: color, outline: 0 }];
    }
    // tree07 requests control geometry for its original recursive triangulation.
    // This rare topology branch remains CPU work; ordinary leaf blobs use WGSL.
    const values = profile.map((_, i) => Noise.noise(i * .05, seed));
    loopNoise(values);
    return profile.map((value, i) => {
      const p = i / 20 * 2, dx = length / 2 - Math.abs(p - 1) * length, dy = value * width / 2;
      const a = Math.atan2(dy, dx), radius = Math.sqrt(dx * dx + dy * dy);
      const n = values[i] * noise + (1 - noise);
      return [x + Math.cos(a + angle) * radius * n, y + Math.sin(a + angle) * radius * n];
    });
  }

  function texture(points: Point[][], args: RecipeOptions = {}): Drawing | Point[][] {
    const offset: Point = [args.xof ?? 0, args.yof ?? 0];
    const tex = args.tex ?? 400, width = args.wid ?? 1.5, length = args.len ?? .2, shade = args.sha ?? 0;
    const jitter = args.noi ?? ((layer: number) => 30 / layer);
    const color = args.col ?? (() => `rgba(100,100,100,${(Math.random() * .3).toFixed(3)})`);
    const distribution = args.dis ?? (() => Math.random() > .5 ? Math.random() / 3 : 2 / 3 + Math.random() / 3);
    const grid = points.map(copy), columns = grid[0].length;
    const segments: { layer: number; start: number; count: number; jitter: number }[] = [];
    for (let i = 0; i < tex; i++) {
      const mid = (distribution() * columns) | 0;
      const half = Math.floor(Math.random() * (columns * length));
      const start = Math.min(Math.max(mid - half, 0), columns);
      const end = Math.min(Math.max(mid + half, 0), columns);
      const layer = i / tex * (grid.length - 1);
      if (end > start) Noise.noise(0);
      segments.push({ layer, start, count: end - start, jitter: jitter(layer + 1) });
    }
    const drawing: Drawing = [];
    function mark(index: number, fill: string, brushWidth: number) {
      const segment = segments[index];
      if (segment.count === 0) return; // stroke([]) consumes no random value.
      const command: ContourStroke = { kind: 'texture', grid, ...segment, offset,
        width: brushWidth, seed: Math.random() * 10, noise: .5, fill, edge: fill, outline: 1 };
      drawing.push(command);
    }
    if (shade) for (let i = 0; i < segments.length; i += 2) mark(i, 'rgba(100,100,100,0.1)', shade);
    for (let i = shade; i < segments.length; i += 1 + shade) mark(i, color(i / segments.length), width);
    if (!args.ret) return drawing;
    return segments.map(segment => Array.from({ length: segment.count }, (_, i): Point => {
      const j = segment.start + i, f = segment.layer - Math.floor(segment.layer);
      const a = grid[Math.floor(segment.layer)][j], b = grid[Math.ceil(segment.layer)][j];
      const x = a[0] * f + b[0] * (1 - f), y = a[1] * f + b[1] * (1 - f);
      return [x + segment.jitter * (Noise.noise(x, j * .5) - .5), y + segment.jitter * (Noise.noise(y, j * .5) - .5)];
    }));
  }

  function text(value: string, args: { x: number; y: number; size: number; angle: number; fill: string }): Drawing {
    // Preserve the upstream plaque text as GPU-painted outlines, including holes.
    let advance = 0;
    const positions = [...value].map((char, i) => {
      advance += SIGNAGE_KERNING[(value[i - 1] ?? '') + char] ?? 0;
      const x = advance;
      advance += SIGNAGE_GLYPHS[char]?.advance ?? .3;
      return { char, x };
    });
    return positions.flatMap(({ char, x }) => {
      const glyph = SIGNAGE_GLYPHS[char];
      if (!glyph?.contours.length) return [];
      const path: Point[] = [];
      const anchor = glyph.contours[0][0];
      for (const contour of glyph.contours) {
        if (path.length) path.push([...anchor]);
        path.push(...copy(contour), [...contour[0]], [...anchor]);
      }
      return poly(path.map(p => {
        const px = (p[0] + x - advance / 2) * args.size, py = p[1] * args.size;
        return [args.x + px * Math.cos(args.angle) - py * Math.sin(args.angle), args.y + px * Math.sin(args.angle) + py * Math.cos(args.angle)];
      }), { fil: args.fill, str: 'none' });
    });
  }
  return { poly, stroke, blob, texture, text };
}
