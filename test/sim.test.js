// 決定性テスト：同じ入力・パラメータ・seed なら、同じ世代で同じ状態になる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { mulberry32 } from '../src/engine/rng.js';

// 合成画像（グラデーション＋ノイズ）。1セル = 1px
function fakeIO(cols, rows, seed = 1) {
  const r = mulberry32(seed), data = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const o = (y * cols + x) * 4;
    data[o] = (x * 255) / cols; data[o + 1] = (y * 255) / rows; data[o + 2] = r() * 255; data[o + 3] = 255;
  }
  return { cols, rows, Ax: 1, Ay: 1, analysis: { data, stride: cols } };
}

const run = (P, gens, io = fakeIO(80, 60)) => {
  const s = new Simulation(P, io);
  for (let i = 0; i < gens; i++) s.step();
  return s;
};

test('同じ seed なら同じ映像', () => {
  const P = { seed: 42, K: 6, chaos: 0.1 };
  const a = run(P, 200), b = run(P, 200);
  assert.deepEqual(a.src, b.src);
  assert.deepEqual(a.cur.state, b.cur.state);
});

test('seed が違えば違う映像', () => {
  const a = run({ seed: 1, K: 6, chaos: 0.1 }, 50), b = run({ seed: 2, K: 6, chaos: 0.1 }, 50);
  assert.notDeepEqual(a.src, b.src);
});

test('0世代は元写真そのもの', () => {
  const s = run({ seed: 3, K: 5, chaos: 0.3 }, 0);
  assert.deepEqual(s.src, Int32Array.from({ length: s.src.length }, (_, i) => i));
});

test('途中で chaos を変えても、同じ世代に同じ操作をすれば同じ映像', () => {
  const P = { seed: 7, K: 6, chaos: 0.05 };
  const go = () => {
    const s = new Simulation(P, fakeIO(80, 60));
    for (let i = 0; i < 300; i++) { if (i === 100) s.setChaos(0.4); if (i === 200) s.setChaos(0.02); s.step(); }
    return s;
  };
  assert.deepEqual(go().src, go().src);
});

for (const motion of ['flow', 'ca']) for (const ruleMorph of [false, true]) for (const regionRules of [false, true])
  test(`${motion} A=${ruleMorph} B=${regionRules}：同じ seed なら同じ映像（途中で chaos を変えても）`, () => {
    const P = { seed: 5, K: 7, chaos: 0.2, motion, ruleMorph, regionRules };
    const go = () => {
      const s = new Simulation(P, fakeIO(80, 60));
      for (let i = 0; i < 400; i++) { if (i === 150) s.setChaos(0.5); if (i === 250) s.setChaos(0.05); s.step(); }
      return s.src;
    };
    assert.deepEqual(go(), go());
  });

test('A：変形の途中で chaos を変えても、表は「変形前と変形後の chaos 適用済みの表」の混ぜ合わせになっている', () => {
  const s = new Simulation({ seed: 9, K: 5, chaos: 0.1, ruleMorph: true, regionRules: true, holdMax: 0 }, fakeIO(80, 60));
  for (let i = 0; i < 60; i++) s.step();
  s.setChaos(0.6);
  const g = s.regions.find((g) => g.morph && g.morph.target >= 0 && g.morph.k > 0);
  assert.ok(g, '変形中の領域がある');
  const m = g.morph, from = g.rules[g.rk].table, to = g.rules[m.target].table;
  const done = new Set(m.order.subarray(0, m.k));
  for (let e = 0; e < g.table.length; e++) assert.equal(g.table[e], done.has(e) ? to[e] : from[e]);
});

test('flow は止まらずに流れ続ける', () => {
  const s = run({ seed: 11, K: 7, chaos: 0.1, motion: 'flow' }, 1000);
  const before = s.src.slice();
  s.step();
  let ch = 0;
  for (let i = 0; i < before.length; i++) if (s.src[i] !== before[i]) ch++;
  assert.ok(ch > before.length * 0.05, `1000世代目で1世代に変わったマス ${(ch / before.length * 100).toFixed(1)}%`);
});

test('しばらく回しても一色やノイズに振り切れない（ざっくり）', () => {
  const s = run({ seed: 11, K: 7, chaos: 0.1, motion: 'ca' }, 500);
  const N = s.src.length;
  let own = 0; const hist = new Int32Array(7);
  for (let i = 0; i < N; i++) { if (s.src[i] === i) own++; hist[s.cur.state[i]]++; }
  assert.ok(Math.max(...hist) < N * 0.9, '一色に収束していない');
  assert.ok(own > N * 0.05 && own < N * 0.98, `元の位置のタイルの割合 ${(own / N).toFixed(2)}`);
});
