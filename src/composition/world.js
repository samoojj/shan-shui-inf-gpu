/**
 * Faithful command-output port of Lingdong Huang's shan-shui construction.
 * Copyright (c) 2018 Lingdong Huang. MIT; see ../../LICENSE.
 * Source: https://github.com/LingDong-/shan-shui-inf/blob/9f754d2b2e73495db7883d4d4055a7b0903b0454/index.html at 9f754d2b2e73495db7883d4d4055a7b0903b0454.
 * Arithmetic, sampling, branch order, and random consumption are unchanged.
 * SVG string concatenation is replaced with ordered drawing-command arrays.
 */
// Original planner/cache: source lines 3706–3827, 3845–3984.
// Excludes the unused dummy loader and commented-out red/green debug circles.
// The old string-level NaN replacement belongs to command packing, not planning.
export function createWorld(env) {
  const { Math, Noise, Mount, Arch, water, randChoice } = env;
  const plannedRanges = [];
  function mountplanner(xmin, xmax) {
    function locmax(x, y, f, r) {
      var z0 = f(x, y);
      if (z0 <= 0.3) {
        return false;
      }
      for (var i = x - r; i < x + r; i++) {
        for (var j = y - r; j < y + r; j++) {
          if (f(i, j) > z0) {
            return false;
          }
        }
      }
      return true;
    }

    function chadd(r, mind) {
      mind = mind == undefined ? 10 : mind;
      for (var k = 0; k < reg.length; k++) {
        if (Math.abs(reg[k].x - r.x) < mind) {
          return false;
        }
      }

      reg.push(r);
      return true;
    }

    var reg = [];
    var samp = 0.03;
    var ns = function(x, y) {
      return Math.max(Noise.noise(x * samp) - 0.55, 0) * 2;
    };
    var nns = function(x) {
      return 1 - Noise.noise(x * samp);
    };
    var nnns = function(x, y) {
      return Math.max(Noise.noise(x * samp * 2, 2) - 0.55, 0) * 2;
    };
    var yr = function(x) {
      return Noise.noise(x * 0.01, Math.PI);
    };

    var xstep = 5;
    var mwid = 200;
    for (var i = xmin; i < xmax; i += xstep) {
      var i1 = Math.floor(i / xstep);
      MEM.planmtx[i1] = MEM.planmtx[i1] || 0;
    }

    for (var i = xmin; i < xmax; i += xstep) {
      for (var j = 0; j < yr(i) * 480; j += 30) {
        if (locmax(i, j, ns, 2)) {
          var xof = i + 2 * (Math.random() - 0.5) * 500;
          var yof = j + 300;
          var r = { tag: "mount", x: xof, y: yof, h: ns(i, j) };
          var res = chadd(r);
          if (res) {
            for (
              var k = Math.floor((xof - mwid) / xstep);
              k < (xof + mwid) / xstep;
              k++
            ) {
              MEM.planmtx[k] += 1;
            }
          }
        }
      }
      if (Math.abs(i) % 1000 < Math.max(1, xstep - 1)) {
        var r = {
          tag: "distmount",
          x: i,
          y: 280 - Math.random() * 50,
          h: ns(i, j),
        };
        chadd(r);
      }
    }

    for (var i = xmin; i < xmax; i += xstep) {
      if (MEM.planmtx[Math.floor(i / xstep)] == 0) {
        //var r = {tag:"redcirc",x:i,y:700}
        //console.log(i)
        if (Math.random() < 0.01) {
          for (var j = 0; j < 4 * Math.random(); j++) {
            var r = {
              tag: "flatmount",
              x: i + 2 * (Math.random() - 0.5) * 700,
              y: 700 - j * 50,
              h: ns(i, j),
            };
            chadd(r);
          }
        }
      } else {
        // var r = {tag:"greencirc",x:i,y:700}
        // chadd(r)
      }
    }

    for (var i = xmin; i < xmax; i += xstep) {
      if (Math.random() < 0.2) {
        var r = { tag: "boat", x: i, y: 300 + Math.random() * 390 };
        chadd(r, 400);
      }
    }

    return reg;
  }

  var MEM = {
    canv: [],
    chunks: [],
    xmin: 0,
    xmax: 0,
    cwid: 512,
    cursx: 0,
    lasttick: 0,
    windx: 3000,
    windy: 800,
    planmtx: [],
  };

  function chunkloader(xmin, xmax) {
    var add = function(nch) {

      if (MEM.chunks.length == 0) {
        MEM.chunks.push(nch);
        return;
      } else {
        if (nch.y <= MEM.chunks[0].y) {
          MEM.chunks.unshift(nch);
          return;
        } else if (nch.y >= MEM.chunks[MEM.chunks.length - 1].y) {
          MEM.chunks.push(nch);
          return;
        } else {
          for (var j = 0; j < MEM.chunks.length - 1; j++) {
            if (MEM.chunks[j].y <= nch.y && nch.y <= MEM.chunks[j + 1].y) {
              MEM.chunks.splice(j + 1, 0, nch);
              return;
            }
          }
        }
      }



    };

    while (xmax > MEM.xmax - MEM.cwid || xmin < MEM.xmin + MEM.cwid) {


      var plan;
      var rangeStart;
      var rangeEnd;
      if (xmax > MEM.xmax - MEM.cwid) {
        rangeStart = MEM.xmax;
        rangeEnd = MEM.xmax + MEM.cwid;
        plan = mountplanner(rangeStart, rangeEnd);
        MEM.xmax = MEM.xmax + MEM.cwid;
      } else {
        rangeStart = MEM.xmin - MEM.cwid;
        rangeEnd = MEM.xmin;
        plan = mountplanner(rangeStart, rangeEnd);
        MEM.xmin = MEM.xmin - MEM.cwid;
      }

      plannedRanges.push({ xmin: rangeStart, xmax: rangeEnd, records: plan });

      for (var i = 0; i < plan.length; i++) {
        if (plan[i].tag == "mount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.mountain(plan[i].x, plan[i].y, i * 2 * Math.random()),
            //{col:function(x){return "rgba(100,100,100,"+(0.5*Math.random()*plan[i].y/MEM.windy)+")"}}),
          });
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y - 10000,
            canv: water(plan[i].x, plan[i].y, i * 2),
          });
        } else if (plan[i].tag == "flatmount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.flatMount(
              plan[i].x,
              plan[i].y,
              2 * Math.random() * Math.PI,
              {
                wid: 600 + Math.random() * 400,
                hei: 100,
                cho: 0.5 + Math.random() * 0.2,
              },
            ),
          });
        } else if (plan[i].tag == "distmount") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Mount.distMount(plan[i].x, plan[i].y, Math.random() * 100, {
              hei: 150,
              len: randChoice([500, 1000, 1500]),
            }),
          });
        } else if (plan[i].tag == "boat") {
          add({
            tag: plan[i].tag,
            x: plan[i].x,
            y: plan[i].y,
            canv: Arch.boat01(plan[i].x, plan[i].y, Math.random(), {
              sca: plan[i].y / 800,
              fli: randChoice([true, false]),
            }),
          });
        }
        // add ({
        //   x: plan[i].x,
        //   y: plan[i].y,
        //   canv:"<circle cx='"+plan[i].x+"' cy='"+plan[i].y+"' r='20' stroke='black' fill='red' />"
        // })
      }
    }
  }

  function chunkrender(xmin, xmax) {
    MEM.canv = [];

    for (var i = 0; i < MEM.chunks.length; i++) {
      if (
        xmin - MEM.cwid < MEM.chunks[i].x &&
        MEM.chunks[i].x < xmax + MEM.cwid
      ) {
        for (const command of MEM.chunks[i].canv) MEM.canv.push(command);
      }
    }
  }

  return {
    ensure(xmin, xmax) {
      chunkloader(xmin, xmax);
    },
    drawing(xmin, xmax) {
      chunkrender(xmin, xmax);
      return MEM.canv;
    },
    inspect() {
      return Object.freeze({
        xmin: MEM.xmin,
        xmax: MEM.xmax,
        chunkWidth: MEM.cwid,
        viewWidth: MEM.windx,
        viewHeight: MEM.windy,
        chunks: Object.freeze(MEM.chunks.map(chunk => Object.freeze({
          tag: chunk.tag, x: chunk.x, y: chunk.y, commandCount: chunk.canv.length,
        }))),
        plans: Object.freeze(plannedRanges.map(plan => Object.freeze({
          xmin: plan.xmin, xmax: plan.xmax,
          records: Object.freeze(plan.records.map(record => Object.freeze({ ...record }))),
        }))),
      });
    },
  };
}
