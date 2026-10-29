import type { Drawing, Point } from '../scene/commands.js';
import type { createPrimitives } from './primitives.js';

/** Original recipes accept species-specific numeric controls and callbacks. */
export type RecipeOptions = Record<string, any>;

export interface CompositionContext {
  Math: Math & { seed(value?: string | number): void };
  Noise: {
    noise(x: number, y?: number, z?: number): number;
    noiseDetail(octaves: number, falloff?: number): void;
    noiseSeed(seed?: number | null): void;
    /** Copy of the original double-precision Perlin table; initializes it lazily. */
    table(): number[];
  };
  PolyTools: {
    midPt(points: Point[]): Point;
    midPt(...points: Point[]): Point;
    triangulate(points: Point[], args?: RecipeOptions): Point[][];
  };
  unNan(value: number | null | undefined): number;
  unNan(points: Point[]): Point[];
  unNan(points: Point[][]): Point[][];
  distance(a: Point, b: Point): number;
  mapval(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number;
  /** Adjusts the supplied noise samples in place to make a normalized loop. */
  loopNoise(values: number[]): void;
  randChoice<T>(values: readonly T[]): T;
  normRand(min: number, max: number): number;
  wtrand(weight: (value: number) => number): number;
  randGaussian(): number;
  bezmh(points: Point[], weight?: number): Point[];
  div(points: Point[], resolution: number): Point[];
  randomState(): number;
}

/** Shared recipe inputs; drawing primitives retain their typed command output. */
export type CompositionEnvironment = CompositionContext & ReturnType<typeof createPrimitives>;

type PositionedRecipe = (x: number, y: number, args?: RecipeOptions) => Drawing;
type SeededRecipe = (x: number, y: number, seed?: number, args?: RecipeOptions) => Drawing;
type AttachedRecipe = (start: Point, end: Point, args?: RecipeOptions) => Drawing;

export interface Trees {
  tree01: PositionedRecipe;
  tree02: PositionedRecipe;
  tree03: PositionedRecipe;
  tree04: PositionedRecipe;
  tree05: PositionedRecipe;
  tree06: PositionedRecipe;
  tree07: PositionedRecipe;
  tree08: PositionedRecipe;
}

export interface People {
  hat01: AttachedRecipe;
  hat02: AttachedRecipe;
  stick01: AttachedRecipe;
  man: PositionedRecipe;
}

export interface Architecture {
  arch01: SeededRecipe;
  arch02: SeededRecipe;
  arch03: SeededRecipe;
  arch04: SeededRecipe;
  boat01: SeededRecipe;
  transmissionTower01: SeededRecipe;
}

export interface Mountains {
  /** Original geometry-return mode wraps its point grid in one outer array. */
  mountain(x: number, y: number, seed: number | undefined, args: RecipeOptions & { ret: 1 | true }): Point[][][];
  mountain(x: number, y: number, seed?: number, args?: RecipeOptions & { ret?: 0 | false }): Drawing;
  mountain(x: number, y: number, seed: number | undefined, args: RecipeOptions): Drawing | Point[][][];
  // These methods read upstream's ret option but always return drawing commands.
  flatMount: SeededRecipe;
  rock: SeededRecipe;
  distMount: SeededRecipe;
  flatDec(x: number, y: number, bounds: { xmin: number; xmax: number; ymin: number; ymax: number }): Drawing;
}

export type ArchitectureEnvironment = CompositionEnvironment & { Man: People };
export type MountainEnvironment = CompositionEnvironment & { Tree: Trees; Arch: Architecture };
