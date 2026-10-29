/** Control data for the original drawing grammar; expanded vertices belong to the GPU. */
export type Point = [number, number];
export interface Paint { fill: string; edge: string; outline: number }
export interface Polygon extends Paint {
  kind: 'polygon'; points: Point[]; offset: Point;
}
export interface BrushStroke extends Paint {
  kind: 'stroke'; points: Point[]; widths: number[]; offset: Point; noise: number; seed: number;
}
export interface LeafBlob extends Paint {
  kind: 'blob'; center: Point; length: number; width: number; angle: number;
  profile: number[]; noise: number; seed: number;
}
export interface ContourStroke extends Paint {
  kind: 'texture'; grid: Point[][]; layer: number; start: number; count: number;
  offset: Point; jitter: number; width: number; noise: number; seed: number;
}
export type DrawingCommand = Polygon | BrushStroke | LeafBlob | ContourStroke;
export type Drawing = DrawingCommand[];
