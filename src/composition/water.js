import { translate } from './geometry.js';

/**
 * Original construction by Lingdong Huang. Copyright (c) 2018.
 * SPDX-License-Identifier: MIT — see the repository LICENSE.
 *
 * Ported from https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html, lines 3667–3704.
 * Original geometry, random-call order, and painter order are preserved.
 * SVG string accumulation is replaced by ordered DrawingCommand arrays.
 */

export function createWater(env) {
  const { Math, Noise, stroke } = env;
  function water(xoff, yoff, seed, args) {
    var args = args != undefined ? args : {};
    var hei = args.hei != undefined ? args.hei : 2;
    var len = args.len != undefined ? args.len : 800;
    var clu = args.clu != undefined ? args.clu : 10;
    var canv = [];

    var ptlist = [];
    var yk = 0;
    for (var i = 0; i < clu; i++) {
      ptlist.push([]);
      var xk = (Math.random() - 0.5) * (len / 8);
      yk += Math.random() * 5;
      var lk = len / 4 + Math.random() * (len / 4);
      var reso = 5;
      for (var j = -lk; j < lk; j += reso) {
        ptlist[ptlist.length - 1].push([
          j + xk,
          Math.sin(j * 0.2) * hei * Noise.noise(j * 0.1) - 20 + yk,
        ]);
      }
    }

    for (var j = 1; j < ptlist.length; j += 1) {
      canv.push(...stroke(
        translate(ptlist[j], xoff, yoff),
        {
          col:
            "rgba(100,100,100," + (0.3 + Math.random() * 0.3).toFixed(3) + ")",
          wid: 1,
        },
      ));
    }

    return canv;
  }

  return water;
}
