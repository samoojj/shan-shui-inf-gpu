import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { draw, frame, target } from 'vgpu/node';
import { PNG } from 'pngjs';
import { generatePaths, shader } from './runtime.mjs';

export async function checkRaster(gpu, packDrawing, outputDirectory) {
  const polygon = (points, fill, edge = 'none', outline = 0) => ({ kind: 'polygon', points, fill, edge, outline, offset: [0, 0] });
  const drawing = [
    polygon([[10, 10], [60, 10], [60, 60], [10, 60]], 'rgba(0,0,0,0.5)'),
    polygon([[30, 30], [80, 30], [80, 80], [30, 80]], 'rgba(255,255,255,0.5)'),
    polygon([[10, 90], [90, 90]], 'black'),
    polygon([[110, 10], [160, 10], [160, 10], [160, 60]], 'none', 'black', 4),
    polygon([[110, 80], [160, 80], [160, 130], [110, 130], [110, 80],
      [135, 80], [185, 80], [185, 130], [135, 130], [135, 80]], 'black'),
  ];
  const packed = packDrawing(drawing);
  const generated = await generatePaths(gpu, packed, new Float32Array(4096));
  const output = target(gpu, { size: [200, 160], format: 'rgba8unorm' });
  const paths = draw(gpu, {
    shader: await shader('paths'), vertices: 6, instances: drawing.length, blend: 'premultiplied',
    set: { ...generated, view: { resolution: [200, 160], span: [200, 160], offset: [0, 0] } },
  });
  try {
    await paths.compile(output);
    frame(gpu, current => current.pass({ target: output, clear: [1, 1, 1, 1] }, paths));
    const pixels = await output.color.read({ mipLevel: 0, region: 'all' });
    const at = (x, y) => Array.from(pixels.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 4));
    const samples = {
      first: at(20, 20), overlap: at(40, 40), whiteMask: at(70, 70), degenerate: at(50, 90),
      openDiagonal: at(135, 35), buttCap: at(108, 10), miterWithRepeatedPoint: at(161, 8),
      internalEdgeLeft: at(134, 100), internalEdgeRight: at(135, 100),
    };
    const expected = { first: 128, overlap: 192, whiteMask: 255, degenerate: 255, openDiagonal: 255,
      buttCap: 255, miterWithRepeatedPoint: 0, internalEdgeLeft: 0, internalEdgeRight: 0 };
    for (const [name, rgba] of Object.entries(samples)) {
      for (const channel of rgba.slice(0, 3)) assert(Math.abs(channel - expected[name]) <= 1, `${name}: ${rgba}`);
      assert.equal(rgba[3], 255, `${name}: output must stay opaque over white`);
    }
    const png = new PNG({ width: 200, height: 160 });
    png.data.set(pixels);
    await writeFile(new URL('raster.png', outputDirectory), PNG.sync.write(png));
    return { samples, artifact: 'raster.png' };
  } finally {
    paths.dispose();
    output.destroy();
  }
}
