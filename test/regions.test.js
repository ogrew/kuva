import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, ENGINE_DEFAULTS } from '../src/engine/sim.js';
import { subdivideQuadtree, REGION_ALIGN } from '../src/engine/regions.js';
import { mulberry32 } from '../src/engine/rng.js';
import { fakeIO, hashSim } from './helpers.js';

function checkCoverage(rects, cols, rows) {
  const cover = new Uint8Array(cols * rows);
  for (const [x, y, w, h] of rects) {
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= cols && y + h <= rows);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cover[j * cols + i]++;
  }
  assert.ok(cover.every(n => n === 1), '全セルがちょうど一つの領域に属する');
}

// 灰色の地に、色の違う長方形が1つある平均色
function blockMean(cols, rows, [bx, by, bw, bh]) {
  const mean = new Float32Array(cols * rows * 3).fill(128);
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) mean.set([250, 20, 20], (y * cols + x) * 3);
  return mean;
}

const ratioOnScreen = ([, , w, h], cw, ch) => Math.max(w * cw, h * ch) / Math.min(w * cw, h * ch);
const noise = (cols, rows, seed) => {
  const mean = new Float32Array(cols * rows * 3), r = mulberry32(seed);
  for (let i = 0; i < mean.length; i++) mean[i] = r() * 255;
  return mean;
};

test('Quadtree：すき間・重なりなく覆い、どの領域も画面で見てほぼ正方形（端の根の中の、奇数の単位を割った最小の葉でも 2:1 まで）', () => {
  for (const [cols, rows, cw, ch] of [[160, 104, 1, 1], [151, 97, 1, 1], [344, 216, 1, 1], [96, 300, 24, 6], [300, 90, 6, 24], [120, 90, 24, 16]]) {
    const rects = subdivideQuadtree(ENGINE_DEFAULTS, cols, rows, noise(cols, rows, 9), 120, cw, ch);
    checkCoverage(rects, cols, rows);
    assert.ok(rects.length >= 100, `${cols}×${rows}: ${rects.length}`);
    for (const g of rects) assert.ok(ratioOnScreen(g, cw, ch) <= 2.2, `${cols}×${rows} ${cw}×${ch}: ${g}`);
  }
});

test('Quadtree：割り切れる大きさなら、すべて正方形で、8マス以上の葉は位置も辺も8マスの倍数（大きなマスが欠けない）', () => {
  const cols = 256, rows = 128;
  const rects = subdivideQuadtree(ENGINE_DEFAULTS, cols, rows, noise(cols, rows, 2), 250);
  assert.ok(rects.some(([, , w]) => w === 2), '最小の葉まで割れる');
  for (const [x, y, w, h] of rects) {
    assert.equal(w, h);
    if (w < REGION_ALIGN) continue;
    assert.equal(x % REGION_ALIGN, 0); assert.equal(y % REGION_ALIGN, 0); assert.equal(w % REGION_ALIGN, 0);
  }
});

test('Quadtree：色の境目のまわりだけ細かく、平らなところは大きな正方形のまま', () => {
  const cols = 128, rows = 128, block = [48, 48, 16, 16];
  const rects = subdivideQuadtree(ENGINE_DEFAULTS, cols, rows, blockMean(cols, rows, block), 10);
  checkCoverage(rects, cols, rows);
  const inside = ([x, y, w, h]) => x >= block[0] && y >= block[1] && x + w <= block[0] + block[2] && y + h <= block[1] + block[3];
  const outside = ([x, y, w, h]) => x + w <= block[0] || x >= block[0] + block[2] || y + h <= block[1] || y >= block[1] + block[3];
  for (const g of rects) assert.ok(inside(g) || outside(g), `領域 ${g} が色の境目をまたがない`);
  assert.ok(Math.max(...rects.map(([, , w]) => w)) >= 32, '平らなところは大きいまま');
});

test('Quadtree：seed によらず同じ分け方。分裂・合体はしない。決定的', () => {
  const io = fakeIO(128, 96);
  const rect = s => s.regions.map(({ x, y, w, h }) => [x, y, w, h]);
  const make = (seed) => new Simulation({ seed, K: 5, regionLayout: 'quadtree', topology: true, topologyInterval: 12 }, io);
  assert.deepEqual(rect(make(1)), rect(make(2)));
  const run = () => {
    const s = make(4);
    const before = rect(s);
    for (let i = 0; i < 300; i++) { if (i === 100) s.set('chaos', 0.4); s.step(); }
    assert.deepEqual(rect(s), before);
    return hashSim(s);
  };
  assert.equal(run(), run());
});
