import type { LandscapeOptions } from "./options.js";

/** A fresh canvas with no context; ownership transfers permanently to its worker. */
export type LandscapeCanvas = HTMLCanvasElement | OffscreenCanvas;
export type LandscapeStatus = "ready" | "device-lost" | "error" | "disposed";

/** Device loss and worker/GPU failures are terminal; recreate with a fresh canvas. */
export interface LandscapeState {
  readonly status: LandscapeStatus;
  readonly error: Error | null;
}

/** A PNG and the scene settings/dimensions that produced it, captured together. */
export interface LandscapeImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  /** The request revision whose exact settings produced this image. */
  readonly revision: number;
  readonly options: LandscapeOptions;
}

export interface LandscapeRenderer {
  /** Finish this frame, or a newer coalesced frame. Rejects on failure or disposal. */
  render(options?: Partial<LandscapeOptions>): Promise<void>;
  resize(width: number, height: number, pixelRatio?: number): Promise<void>;
  /** Latest accepted settings, including requests still waiting for the worker. */
  getOptions(): LandscapeOptions;
  getStatus(): LandscapeStatus;
  /** Deliver current readiness immediately, then changes. Returns an unsubscribe function. */
  subscribe(listener: (state: LandscapeState) => void): () => void;
  /** Queue an exact PNG/settings snapshot; later renders cannot supersede it. */
  capture(options?: Partial<LandscapeOptions>): Promise<LandscapeImage>;
  /**
   * Cancel queued work and release the worker. An already-dispatched capture may finish.
   * Safe to repeat. Canvas transfer is permanent: mount again with a fresh canvas.
   */
  dispose(): void;
}
