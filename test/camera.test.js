import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { cellMeans } from '../src/engine/analyze.js';
import { fakeIO, hashSim } from './helpers.js';

// カメラ入力（段階2）：何世代目にどの平均色を渡したかが同じなら同じ映像
const P = { seed: 11, K: 6, chaos: 0.1, inject: true, injectPeriod: 60, stagger: 80, bigFrac: 0.5, topology: true, topologyInterval: 30, leakEnabled: true };
const frames = [2, 3, 4, 5].map((k) => cellMeans(fakeIO(100, 70, k)));

function play(feed) {
  const s = new Simulation(P, fakeIO(100, 70, 1));
  for (let g = 0; g < 300; g++) {
    if (feed && g % 20 === 0) s.setColors(frames[(g / 20) % frames.length]);
    s.step();
  }
  return s;
}

test('カメラ：平均色の列が同じなら同じ映像', () => {
  assert.equal(hashSim(play(true)), hashSim(play(true)));
  assert.notEqual(hashSim(play(true)), hashSim(play(false)));
});

test('カメラ：最初と同じ平均色を渡しても映像は変わらない', () => {
  const io = fakeIO(100, 70, 1), m = cellMeans(io);
  const a = new Simulation(P, io), b = new Simulation(P, io);
  for (let g = 0; g < 200; g++) { b.setColors(m); a.step(); b.step(); }
  assert.equal(hashSim(a), hashSim(b));
});

test('カメラ：分類はパレットの最も近い色、大きなマスの分類も作り直す', () => {
  const s = new Simulation(P, fakeIO(100, 70, 1));
  for (const g of s.regions) s.scaleData(g.scale);
  s.setColors(frames[0]);
  const ref = new Simulation({ ...P }, fakeIO(100, 70, 1));
  ref.mean.set(frames[0]);
  ref.scales = { 1: ref.scales[1] };
  for (const k of Object.keys(s.scales)) if (+k > 1) assert.deepEqual(s.scales[k].cls, ref.scaleData(+k).cls);
  // 崩れ始めていない領域は、状態も新しい分類
  for (const g of s.regions) if (!g.started) {
    const i = g.y * s.cols + g.x;
    assert.equal(s.cur.state[i], s.cls[i]);
  }
});
