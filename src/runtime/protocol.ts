import type { LandscapeOptions } from "../options.js";

export interface SerializedError {
  readonly name: string;
  readonly message: string;
}

export type WorkerRequest =
  | { readonly type: "probe" }
  | { readonly type: "initialize"; readonly canvas: OffscreenCanvas; readonly options: LandscapeOptions }
  | { readonly type: "render" | "capture"; readonly revision: number; readonly options: LandscapeOptions }
  | { readonly type: "dispose" };

export type WorkerResponse =
  | { readonly type: "support"; readonly supported: boolean }
  | { readonly type: "ready" | "disposed" }
  | { readonly type: "rendered"; readonly revision: number }
  | { readonly type: "captured"; readonly revision: number; readonly blob: Blob; readonly width: number; readonly height: number }
  | { readonly type: "capture-error"; readonly revision: number; readonly error: SerializedError }
  | { readonly type: "failure"; readonly status: "device-lost" | "error"; readonly error: SerializedError };

export function serializeError(error: unknown): SerializedError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

export function restoreError(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}
