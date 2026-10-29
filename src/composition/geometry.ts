import type { Point } from '../scene/commands.js';

/** Translate control points without mutating a recipe's local geometry. */
export function translate(points: Point[], x: number, y: number): Point[] {
  return points.map(point => [point[0] + x, point[1] + y]);
}

/** The original symmetric brush profile, shared by blobs and bark marks. */
export function blobProfile(p: number): number {
  return p <= 1
    ? Math.pow(Math.sin(p * Math.PI), 0.5)
    : -Math.pow(Math.sin((p + 1) * Math.PI), 0.5);
}
