/** sRGB components in the range 0–1. */
export type Color = readonly [number, number, number];

export interface LandscapeOptions {
  seed: string | number;
  /** Logical pixel dimensions. The library never changes the canvas CSS size. */
  width: number;
  height: number;
  pixelRatio: number;
  /** World units; the default viewport is 1000 units high. */
  cameraX: number;
  cameraY: number;
  zoom: number;
  layers: number;
  roughness: number;
  inkDensity: number;
  mist: number;
  vegetation: number;
  water: number;
  paper: Color;
  ink: Color;
}

export const DEFAULT_OPTIONS: Readonly<LandscapeOptions> = Object.freeze({
  seed: "shan-shui",
  width: 1200,
  height: 700,
  pixelRatio: 1,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  layers: 5,
  roughness: 0.55,
  inkDensity: 0.7,
  mist: 0.45,
  vegetation: 0.55,
  water: 0.5,
  paper: Object.freeze([0.96, 0.95, 0.91]) as Color,
  ink: Object.freeze([0.12, 0.15, 0.14]) as Color,
});

function numberInRange(name: string, value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? "an integer" : "a finite number"} between ${min} and ${max}.`);
  }
}

function color(name: string, value: unknown): Color {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${name} must be an RGB tuple of three numbers.`);
  for (const channel of value) numberInRange(name, channel, 0, 1);
  return [value[0], value[1], value[2]];
}

/** Validate a complete candidate before any renderer state changes. */
export function resolveOptions(patch: Partial<LandscapeOptions>, previous: Readonly<LandscapeOptions> = DEFAULT_OPTIONS): LandscapeOptions {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("Landscape options must be an object.");
  const next = { ...previous, ...patch };
  if (typeof next.seed !== "string" && (typeof next.seed !== "number" || !Number.isFinite(next.seed))) {
    throw new TypeError("seed must be a string or a finite number.");
  }
  numberInRange("width", next.width, 1, 16384, true);
  numberInRange("height", next.height, 1, 16384, true);
  numberInRange("pixelRatio", next.pixelRatio, 0.25, 4);
  numberInRange("cameraX", next.cameraX, -1_000_000, 1_000_000);
  numberInRange("cameraY", next.cameraY, -1_000_000, 1_000_000);
  numberInRange("zoom", next.zoom, 0.25, 4);
  numberInRange("layers", next.layers, 1, 8, true);
  for (const key of ["roughness", "inkDensity", "mist", "vegetation", "water"] as const) {
    numberInRange(key, next[key], 0, 1);
  }
  next.paper = color("paper", next.paper);
  next.ink = color("ink", next.ink);
  return next;
}

/** FNV-1a over UTF-16 code units. Distinguishes numeric seeds from string seeds. */
export function hashSeed(seed: string | number): number {
  const text = `${typeof seed}:${seed}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Bound memory use independently of the distance travelled through the world. */
export function bufferSize(options: Readonly<LandscapeOptions>, maxDimension: number): [number, number] {
  const width = options.width * options.pixelRatio;
  const height = options.height * options.pixelRatio;
  const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(8_388_608 / (width * height)));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
