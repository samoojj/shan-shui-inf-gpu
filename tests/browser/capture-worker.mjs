import { createLandscape } from '/dist/index.js';
import { decodePNG, comparePixels, pixelRange } from './support.mjs';

self.onmessage = async ({ data }) => {
  let landscape;
  try {
    landscape = await createLandscape(data.canvas, {
      width: 128, height: 96, pixelRatio: 0.25, cameraY: 240, seed: 'worker-capture',
    });
    const before = await decodePNG((await landscape.capture()).blob);
    await new Promise(resolve => setTimeout(resolve, 0));
    const pending = landscape.capture();
    const next = landscape.render({ seed: 'worker-next' });
    const frame = await pending;
    await next;
    const { pixels } = await decodePNG(frame.blob);
    self.postMessage({ ...pixelRange(pixels),
      meanDifference: comparePixels(before.pixels, pixels).meanAbsoluteChannelError,
      type: frame.blob.type, width: frame.width, height: frame.height, seed: frame.options.seed,
      logicalWidth: frame.options.width, logicalHeight: frame.options.height,
      currentSeed: landscape.getOptions().seed });
  } catch (error) { self.postMessage({ failure: error.message }); }
  finally { landscape?.dispose(); }
};
