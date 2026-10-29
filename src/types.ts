import type { LandscapeOptions } from "./options.js";

export type LandscapeCanvas = HTMLCanvasElement | OffscreenCanvas;
export type LandscapeStatus = "ready" | "device-lost" | "error" | "disposed";

/** Device loss and GPU failures are terminal; dispose and create another renderer. */
export interface LandscapeState {
  readonly status: LandscapeStatus;
  readonly error: Error | null;
}

/** A PNG and the scene settings/dimensions that produced it, captured together. */
export interface LandscapeImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly options: LandscapeOptions;
}

export interface LandscapeRenderer {
  /** Submit one GPU frame. Rejects after device loss, failure, or disposal. */
  render(options?: Partial<LandscapeOptions>): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  getOptions(): LandscapeOptions;
  getStatus(): LandscapeStatus;
  /** Deliver current readiness immediately, then changes. Returns an unsubscribe function. */
  subscribe(listener: (state: LandscapeState) => void): () => void;
  /** Draw and encode a PNG without caller-managed buffer timing. Rejects unless ready. */
  capture(options?: Partial<LandscapeOptions>): Promise<LandscapeImage>;
  /** Release GPU resources and subscriptions. Safe to call repeatedly. */
  dispose(): void;
}
