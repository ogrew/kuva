import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, ENGINE_DEFAULTS } from '../src/engine/sim.js';
import { subdivide, subdivideAdaptive, REGION_ALIGN } from '../src/engine/regions.js';
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

test('Adaptive：すき間・重なりなく覆い、領域数は指定どおり、切る位置は8マスの倍数', () => {
  const P = ENGINE_DEFAULTS, cols = 160, rows = 104;
  const mean = new Float32Array(cols * rows * 3);
  const r = mulberry32(5);
  for (let i = 0; i < mean.length; i++) mean[i] = r() * 255;
  const rects = subdivideAdaptive(P, cols, rows, mean, 20);
  checkCoverage(rects, cols, rows);
  assert.equal(rects.length, 20);
  for (const [x, y, w, h] of rects) {
    if (x + w < cols) assert.equal((x + w) % REGION_ALIGN, 0);
    if (y + h < rows) assert.equal((y + h) % REGION_ALIGN, 0);
  }
});

test('Adaptive：色の境目で切り、平らなところは大きな領域のまま', () => {
  const P = ENGINE_DEFAULTS, cols = 160, rows = 120, block = [40, 32, 48, 40];
  const rects = subdivideAdaptive(P, cols, rows, blockMean(cols, rows, block), 5);
  checkCoverage(rects, cols, rows);
  // 長方形の4辺で切ると、どの領域も一色になる（4回の分割で5領域）
  const inside = ([x, y, w, h]) => x >= block[0] && y >= block[1] && x + w <= block[0] + block[2] && y + h <= block[1] + block[3];
  const outside = ([x, y, w, h]) => x + w <= block[0] || x >= block[0] + block[2] || y + h <= block[1] || y >= block[1] + block[3];
  for (const g of rects) assert.ok(inside(g) || outside(g), `領域 ${g} が色の境目をまたがない`);
});

test('Adaptive：seed によらず同じ分け方。領域数は random と同じくらい', () => {
  const io = fakeIO(96, 72);
  const rect = s => s.regions.map(({ x, y, w, h }) => [x, y, w, h]);
  const color = [1, 2, 3].map(seed => rect(new Simulation({ seed, K: 5, regionMode: 'adaptive' }, io)));
  assert.deepEqual(color[0], color[1]);
  assert.deepEqual(color[0], color[2]);
  const counts = [1, 2, 3, 4, 5, 6].map(seed => new Simulation({ seed, K: 5 }, io).regions.length);
  assert.ok(color[0].length >= Math.min(...counts) && color[0].length <= Math.max(...counts), `${color[0].length} / ${counts}`);
});

test('Adaptive：途中の変更を含めて決定的', () => {
  const run = () => {
    const s = new Simulation({ seed: 7, K: 6, regionMode: 'adaptive', topology: true, leakEnabled: true, bigFrac: 0.5, stagger: 30 }, fakeIO(96, 72));
    for (let i = 0; i < 400; i++) { if (i === 150) s.set('chaos', 0.4); s.step(); }
    return hashSim(s);
  };
  assert.equal(run(), run());
});
