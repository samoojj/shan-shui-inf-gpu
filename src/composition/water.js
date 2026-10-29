/*
 * MIT License
 *
 * Copyright (c) 2018 Lingdong Huang
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Ported from reference/original.html, lines 3667–3704.
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
        ptlist[j].map(function(x) {
          return [x[0] + xoff, x[1] + yoff];
        }),
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
