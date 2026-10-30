import type { Drawing, DrawingCommand, Point } from './fixture-commands.js';

const JOB_BYTES = 128;
const MAX_STORAGE_BYTES = 128 * 1024 * 1024;
type Color = readonly [number, number, number, number];
type Grid = { offset: number; rows: number; columns: number };

/** Encode captured upstream commands for the independent brush acceptance probes. */
export interface PackedDrawing {
  jobs: Uint8Array;
  inputData: Float32Array;
  pointCount: number;
  commandCount: number;
  counts: Record<string, number>;
}

function checkedBytes(elements: number, stride: number, label: string): number {
  const bytes = elements * stride;
  if (!Number.isSafeInteger(elements) || elements < 0 || bytes > MAX_STORAGE_BYTES) {
    throw new RangeError(`Landscape ${label} exceeds the 128 MiB storage limit. Reduce the visible scene extent.`);
  }
  return bytes;
}

function ribbonCount(count: number): number {
  return count === 0 ? 0 : count === 1 ? 3 : count * 2 - 1;
}

function outputCount(command: DrawingCommand): number {
  switch (command.kind) {
    case 'polygon': return command.points.length;
    case 'stroke': return ribbonCount(command.points.length);
    case 'blob': return 21;
    case 'texture': return ribbonCount(command.count);
  }
}

function parseColor(value: string): Color {
  const text = value.trim().toLowerCase();
  if (text === 'none') return [0, 0, 0, 0];
  if (text === 'white') return [1, 1, 1, 1];
  if (text === 'black') return [0, 0, 0, 1];
  const match = /^(rgb|rgba)\(([^()]*)\)$/.exec(text);
  if (match) {
    const components = match[2].split(',').map(part => part.trim());
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/;
    if (components.length === (match[1] === 'rgba' ? 4 : 3) && components.every(part => numeric.test(part))) {
      const numbers = components.map(Number);
      if (numbers.every(Number.isFinite)) {
        const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
        return [clamp(numbers[0] / 255), clamp(numbers[1] / 255), clamp(numbers[2] / 255), clamp(numbers[3] ?? 1)];
      }
    }
  }
  throw new TypeError(`Unsupported landscape color ${JSON.stringify(value)}; expected white, black, none, rgb(), or rgba().`);
}

/** Pack the native WGSL Job layout without expanding ribbons, blobs, or contour grids. */
export function packDrawing(commands: Drawing): PackedDrawing {
  const jobBytes = checkedBytes(commands.length, JOB_BYTES, 'command buffer');
  checkedBytes(commands.length, 16, 'bounds buffer');
  const grids = new Map<Point[][], Grid>();
  const colors = new Map<string, Color>();
  const counts: Record<string, number> = { polygon: 0, stroke: 0, blob: 0, texture: 0, controlPoints: 0, polygonPoints: 0, generatedPoints: 0 };
  let inputCount = 0, pointCount = 0;

  // Count and validate before allocating; a large input must not reach GPU allocation first.
  for (const command of commands) {
    counts[command.kind]++;
    for (const value of [command.fill, command.edge]) if (!colors.has(value)) colors.set(value, parseColor(value));
    switch (command.kind) {
      case 'polygon':
        inputCount += command.points.length;
        counts.polygonPoints += command.points.length;
        break;
      case 'stroke':
        if (command.widths.length !== command.points.length) throw new RangeError('Landscape stroke widths must match its control points.');
        inputCount += command.points.length;
        break;
      case 'blob':
        if (command.profile.length !== 21) throw new RangeError('Landscape blobs require the original 21 profile samples.');
        inputCount += 21;
        break;
      case 'texture': {
        let grid = grids.get(command.grid);
        if (!grid) {
          const rows = command.grid.length, columns = command.grid[0]?.length ?? 0;
          if (command.grid.some(row => row.length !== columns)) throw new RangeError('Landscape contour grids must have equal row lengths.');
          grid = { offset: inputCount, rows, columns };
          grids.set(command.grid, grid);
          inputCount += rows * columns;
        }
        if (!Number.isInteger(command.start) || !Number.isInteger(command.count) || command.start < 0 || command.count < 0 || command.start + command.count > grid.columns) {
          throw new RangeError('Landscape contour range falls outside its control grid.');
        }
        if (!Number.isFinite(command.layer) || command.layer < 0 || (command.count > 0 && Math.ceil(command.layer) >= grid.rows)) {
          throw new RangeError('Landscape contour layer falls outside its control grid.');
        }
        break;
      }
    }
    pointCount += outputCount(command);
    checkedBytes(inputCount, 16, 'control buffer');
    checkedBytes(pointCount, 8, 'generated point buffer');
  }

  const jobs = new Uint8Array(jobBytes);
  const fields = new DataView(jobs.buffer);
  const inputData = new Float32Array(inputCount * 4);
  const writtenGrids = new Set<Point[][]>();
  let inputOffset = 0, outputOffset = 0;
  function point(offset: number, value: Point, width = 0) {
    // Preserve NaN values: the shader applies the upstream -1000 coordinate fallback.
    inputData[offset * 4] = value[0];
    inputData[offset * 4 + 1] = value[1];
    inputData[offset * 4 + 2] = width;
  }

  for (const [index, command] of commands.entries()) {
    const base = index * JOB_BYTES;
    const uint = (offset: number, value: number) => fields.setUint32(base + offset, value, true);
    const float = (offset: number, value: number) => fields.setFloat32(base + offset, value, true);
    const color = (offset: number, value: string) => colors.get(value)!.forEach((channel, i) => float(offset + i * 4, channel));
    const count = outputCount(command);
    color(16, command.fill);
    color(32, command.edge);
    float(60, command.outline);
    uint(12, outputOffset);
    uint(96, count);
    const origin = command.kind === 'blob' ? command.center : command.offset;
    float(64, origin[0]);
    float(68, origin[1]);
    if (command.kind !== 'polygon') {
      float(52, command.noise);
      float(56, command.seed);
      if (command.kind !== 'stroke') float(48, command.width);
    }
    switch (command.kind) {
      case 'polygon':
      case 'stroke': {
        uint(0, command.kind === 'polygon' ? 0 : 1);
        uint(4, inputOffset);
        uint(8, command.points.length);
        for (let i = 0; i < command.points.length; i++) point(inputOffset++, command.points[i], command.kind === 'stroke' ? command.widths[i] : 0);
        break;
      }
      case 'blob':
        uint(0, 2);
        uint(4, inputOffset);
        uint(8, 21);
        uint(100, inputOffset);
        float(72, command.length);
        float(76, command.angle);
        for (const sample of command.profile) inputData[inputOffset++ * 4] = sample;
        break;
      case 'texture': {
        const grid = grids.get(command.grid)!;
        uint(0, 3);
        uint(4, grid.offset);
        uint(8, command.count);
        float(80, command.layer);
        float(84, command.start);
        float(88, grid.columns);
        float(92, command.jitter);
        if (!writtenGrids.has(command.grid)) {
          for (const row of command.grid) for (const control of row) point(inputOffset++, control);
          writtenGrids.add(command.grid);
        }
        break;
      }
    }
    outputOffset += count;
  }
  counts.controlPoints = inputCount;
  counts.generatedPoints = pointCount - counts.polygonPoints;
  return { jobs, inputData, pointCount, commandCount: commands.length, counts };
}
