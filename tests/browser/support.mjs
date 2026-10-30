/** Browser and worker image checks share the same decoder and byte metrics. */
export async function decodePNG(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height,
      pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally { bitmap.close(); }
}

export function comparePixels(a, b, channels = 4) {
  if (a.length !== b.length || !a.length) throw new Error('Images must have matching nonzero dimensions');
  let error = 0, squared = 0, differentPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let maximum = 0;
    for (let c = 0; c < channels; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      error += delta; squared += delta * delta; maximum = Math.max(maximum, delta);
    }
    if (maximum > 16) differentPixels++;
  }
  const count = a.length / 4;
  return { meanAbsoluteChannelError: error / (count * channels),
    rootMeanSquaredChannelError: Math.sqrt(squared / (count * channels)),
    fractionPixelsOver16: differentPixels / count };
}

export function pixelRange(pixels) {
  let min = 255, max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]);
  }
  return { min, max };
}

export async function rejects(action, message) {
  try { await action(); } catch (error) { return error; }
  throw new Error(message);
}
