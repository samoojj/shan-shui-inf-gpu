import { createLandscape } from 'shan-shui-gpu';

window.consumerResult = (async () => {
  const landscape = await createLandscape(document.querySelector('canvas'), {
    width: 320, height: 256, pixelRatio: 0.25, cameraY: 160, seed: 'browser-validation',
  }, {
    workerFactory: () => new Worker(new URL('./landscape-worker.js', import.meta.url), { type: 'module' }),
  });
  try {
    const image = await landscape.capture();
    const bitmap = await createImageBitmap(image.blob);
    const output = document.createElement('canvas');
    output.width = bitmap.width; output.height = bitmap.height;
    const context = output.getContext('2d');
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = context.getImageData(0, 0, output.width, output.height).data;
    let min = 255, max = 0, opaque = true;
    for (let index = 0; index < pixels.length; index += 4) {
      min = Math.min(min, pixels[index]); max = Math.max(max, pixels[index]);
      opaque &&= pixels[index + 3] === 255;
    }
    return { width: image.width, height: image.height, type: image.blob.type, opaque, range: max - min };
  } finally { landscape.dispose(); }
})();
