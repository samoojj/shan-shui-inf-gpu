import { createComposition } from '../composition/index.js';
import { INITIAL_VIEW } from '../composition/world.js';
import type { Drawing } from './commands.js';

/** One upstream random stream, planner and painter order. No browser globals. */
export function composeScene(seed: string | number) {
  // Upstream reads the encoded query value without decoding it.
  const { context, world } = createComposition(encodeURIComponent(String(seed)));
  world.ensure(0, INITIAL_VIEW.width);
  // Upstream makes paper after its initial eight chunks; this changes the later
  // random stream even though paper never affects the planner geometrically.
  const paper = new Float32Array(257 * 257);
  for (let i = 0; i <= 256; i++) for (let j = 0; j <= 256; j++) paper[i * 257 + j] = context.Math.random();
  const noise = new Float32Array(context.Noise.table());
  let left = NaN, right = NaN, commands: Drawing = [];
  return {
    paper, noise,
    drawing(x: number, width: number): Drawing {
      const end = x + Math.max(INITIAL_VIEW.width, width);
      if (x !== left || end !== right) {
        world.ensure(x, end);
        const next = world.drawing(x, end) as Drawing;
        if (next.length !== commands.length || next.some((command, i) => command !== commands[i])) commands = next;
        left = x; right = end;
      }
      return commands;
    },
    inspect: () => ({ ...world.inspect(), randomState: context.randomState() }),
  };
}
