// Exact original CPU calls. Each fixture starts in a fresh realm with seed reference-01.
const grid = Array.from({ length: 8 }, (_, j) => Array.from({ length: 50 }, (_, i) => [
  30 + i * 5, 40 + j * 15 - 20 * Math.sin(i / 49 * Math.PI),
]));
const trees = [
  [130, 290, 70, 90], [120, 330, 80, 70], [125, 290, 75, 90], [-60, 30, 410, 360],
  [95, 10, 150, 390], [60, 55, 195, 340], [130, 270, 100, 110], [130, 220, 60, 160],
];
export const referenceCases = [
  { name: 'stroke', target: 'stroke', args: [[[30, 100], [90, 55], [170, 85], [260, 40]], { wid: 7, col: 'rgba(100,100,100,0.8)' }], subdivide: 12, viewBox: [10, 20, 270, 100] },
  { name: 'blob', target: 'blob', args: [120, 70, { len: 160, wid: 45, ang: -0.2, col: 'rgba(100,100,100,0.8)' }], viewBox: [35, 25, 170, 90] },
  { name: 'texture', target: 'texture', args: [grid, { tex: 200, wid: 1.5 }], viewBox: [10, 0, 290, 165] },
  { name: 'water', target: 'water', args: [320, 60, 1, { len: 500, hei: 2, clu: 10 }], viewBox: [50, 25, 550, 70] },
  { name: 'mountain', target: 'Mount.mountain', args: [320, 400, 1, { hei: 320, wid: 520, tex: 200 }], viewBox: [0, 160, 640, 320] },
  { name: 'flat-mountain', target: 'Mount.flatMount', args: [320, 400, 1, { hei: 120, wid: 520, tex: 80, cho: 0.5 }], viewBox: [20, 240, 600, 210] },
  { name: 'distant-mountain', target: 'Mount.distMount', args: [30, 250, 1, { hei: 240, len: 600, seg: 5 }], viewBox: [10, 120, 650, 165] },
  { name: 'rock', target: 'Mount.rock', args: [140, 160, 1, { hei: 80, wid: 100, tex: 40, sha: 10 }], viewBox: [15, 65, 245, 145] },
  ...trees.map((viewBox, index) => ({ name: `tree0${index + 1}`, target: `Tree.tree0${index + 1}`, args: [160, 360], viewBox })),
  { name: 'pavilion', target: 'Arch.arch01', args: [160, 180, 1], viewBox: [45, 85, 230, 130] },
  { name: 'house', target: 'Arch.arch02', args: [160, 180, 1], viewBox: [105, 105, 110, 100] },
  { name: 'pagoda', target: 'Arch.arch03', args: [160, 180, 1], viewBox: [105, 40, 110, 165] },
  { name: 'open-tower', target: 'Arch.arch04', args: [160, 180, 1], viewBox: [115, 110, 90, 95] },
  { name: 'boat', target: 'Arch.boat01', args: [90, 140, 1, { len: 200, sca: 1, fli: false }], viewBox: [0, 60, 310, 115] },
  { name: 'transmission-tower', target: 'Arch.transmissionTower01', args: [100, 160, 1], viewBox: [55, 35, 90, 150] },
  { name: 'person', target: 'Man.man', args: [100, 160, { sca: 1, fli: false }], viewBox: [55, 55, 125, 140] },
];
