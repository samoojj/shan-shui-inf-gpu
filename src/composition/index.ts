import { createContext } from './context.js';
import { createPrimitives } from './primitives.js';
import { createTrees } from './trees.js';
import { createPeople } from './people.js';
import { createArchitecture } from './architecture.js';
import { createMountains } from './mountains.js';
import { createWater } from './water.js';
import { createWorld } from './world.js';

/** Wire every recipe to one random stream and command vocabulary. */
export function createComposition(seed: string) {
  const context = createContext(seed);
  const env = { ...context, ...createPrimitives(context) };
  const Tree = createTrees(env);
  const Man = createPeople(env);
  const Arch = createArchitecture({ ...env, Man });
  const Mount = createMountains({ ...env, Tree, Arch });
  const water = createWater(env);
  const world = createWorld({ ...env, Mount, Arch, water });
  return { context, Tree, Man, Arch, Mount, water, world };
}
