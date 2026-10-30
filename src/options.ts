export interface LandscapeOptions {
  seed: string | number;
  /** Logical pixels. Set the canvas's CSS dimensions separately. */
  width: number;
  height: number;
  pixelRatio: number;
  /** Upstream drawing coordinates, with Y increasing downward. */
  cameraX: number;
  cameraY: number;
  /** Original viewer scale is 1.142 screen pixels per drawing unit. */
  zoom: number;
  /** Reveal ordered brush commands over multiple frames, or present the complete image. */
  presentation: "complete" | "incremental";
  /** Maximum brush commands painted per incremental frame. */
  commandsPerFrame: number;
}

export const DEFAULT_OPTIONS: Readonly<LandscapeOptions> = Object.freeze({
  seed: '1234', width: 1200, height: 700, pixelRatio: 1,
  cameraX: 0, cameraY: 0, zoom: 1.142,
  presentation: 'complete', commandsPerFrame: 256,
});

function numberInRange(name: string, value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
  }
}

export function resolveOptions(patch: Partial<LandscapeOptions>, previous: Readonly<LandscapeOptions> = DEFAULT_OPTIONS): LandscapeOptions {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Landscape options must be an object.');
  for (const key of Object.keys(patch)) if (!Object.prototype.hasOwnProperty.call(DEFAULT_OPTIONS, key)) throw new TypeError(`Unknown landscape option: ${key}`);
  const next = { ...previous, ...patch };
  if (typeof next.seed !== 'string' && (typeof next.seed !== 'number' || !Number.isFinite(next.seed))) throw new TypeError('seed must be a string or a finite number.');
  if (encodeURIComponent(String(next.seed)).length > 96) throw new RangeError('seed must fit in 96 URL-encoded characters to bound worker messages.');
  numberInRange('width', next.width, 1, 16384, true);
  numberInRange('height', next.height, 1, 16384, true);
  numberInRange('pixelRatio', next.pixelRatio, .25, 4);
  numberInRange('cameraX', next.cameraX, -8192, 8192);
  numberInRange('cameraY', next.cameraY, -8192, 8192);
  numberInRange('zoom', next.zoom, .25, 4);
  if (next.presentation !== 'complete' && next.presentation !== 'incremental') throw new TypeError('presentation must be complete or incremental.');
  numberInRange('commandsPerFrame', next.commandsPerFrame, 1, 1_000_000, true);
  if (next.width / next.zoom > 8192) throw new RangeError('width / zoom must not exceed 8192 drawing units. Increase zoom or reduce width.');
  return next;
}

/** Bound render-target allocation separately from the scene's brush buffers. */
export function bufferSize(options: Readonly<LandscapeOptions>, maxDimension: number): [number, number] {
  const width = options.width * options.pixelRatio, height = options.height * options.pixelRatio;
  const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(8_388_608 / (width * height)));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
