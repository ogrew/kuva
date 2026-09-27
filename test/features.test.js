// kivi から持ってきた機能：進行方向、塗りつぶし、マスの高さ比
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DIRECTIONS } from '../src/engine/sim.js';
import { flatColors } from '../src/engine/flat.js';
import { subdivide } from '../src/engine/regions.js';
import { ENGINE_DEFAULTS } from '../src/engine/sim.js';
import { mulberry32 } from '../src/engine/rng.js';
import { fakeIO, run } from './helpers.js';

test('進行方向：固定すると全領域がその向きに流れ、ALL に戻すと各領域の向きに戻る。途中で変えても決定的', () => {
  const P = { seed: 6, K: 6, chaos: 0.2, tempo: true, inject: true, injectPeriod: 60 };
  const go = () => {
    const s = new Simulation(P, fakeIO(80, 60));
    const own = s.regions.map((g) => g.dir);
    for (let i = 0; i < 400; i++) {
      if (i === 100) s.set('direction', 'down');
      if (i === 250) s.set('direction', 'all');
      s.step();
      if (i === 200) for (const g of s.regions) if (g.motion !== 'still') assert.equal(g.lastDir, DIRECTIONS.down);
    }
    return { s, own };
  };
  const a = go(), b = go();
  assert.deepEqual(a.s.src, b.s.src);
  // 固定中は E の向き変更が見た目に出ない（領域の向き g.dir は変わりうるが、流れる向きは固定）
  for (const g of a.s.regions) if (g.motion !== 'still') assert.equal(g.lastDir, g.dir);
});

test('進行方向：初期値（ALL）なら固定しない', () => {
  const s = run({ seed: 1, K: 5, chaos: 0.1 }, 10);
  assert.equal(s.fixedDir, undefined);
});

const flatSim = () => new Simulation({ seed: 9, K: 7, chaos: 0.1 }, fakeIO(80, 60));
const flatOn = (c) => { const on = []; for (let s = 0; s < c.length / 4; s++) if (c[s * 4 + 3]) on.push(s); return on; };

test('塗りつぶし：割合 0 なら塗らない。決定的で、割合を上げると塗るタイルが増えるだけ（入れ替わらない）', () => {
  const s = flatSim();
  for (const unit of ['tile', 'state']) {
    assert.equal(flatOn(flatColors(s, 0, unit, 'palette')).length, 0);
    assert.deepEqual(flatColors(s, 0.3, unit, 'palette'), flatColors(s, 0.3, unit, 'palette'));
    const lo = new Set(flatOn(flatColors(s, 0.2, unit, 'palette'))), hi = new Set(flatOn(flatColors(s, 0.6, unit, 'palette')));
    assert.ok(hi.size > lo.size, unit);
    for (const t of lo) assert.ok(hi.has(t), `${unit}：割合を上げても ${t} は塗られたまま`);
  }
});

test('塗りつぶし：似た色ごとなら、同じ状態のタイルはすべて同じ扱いで、代表色はパレットの色', () => {
  const s = flatSim(), c = flatColors(s, 0.4, 'state', 'palette');
  const onState = new Map();
  for (let t = 0; t < s.cls.length; t++) {
    const k = s.cls[t], on = c[t * 4 + 3] > 0;
    if (onState.has(k)) assert.equal(onState.get(k), on); else onState.set(k, on);
    if (on) for (let ch = 0; ch < 3; ch++) assert.equal(c[t * 4 + ch], s.palette[k * 3 + ch]);
  }
  assert.equal([...onState.values()].filter(Boolean).length, Math.round(7 * 0.4));
});

test('塗りつぶし：平均色はそのタイル自身の平均色', () => {
  const s = flatSim(), c = flatColors(s, 1, 'tile', 'mean');
  for (const t of [0, 100, 2000]) for (let ch = 0; ch < 3; ch++) assert.equal(c[t * 4 + ch], Math.round(s.mean[t * 3 + ch]));
});

test('高さ比：正方形のマスでは従来と同じ分割。細長いマスでも、最小領域は実際の長さで決まる', () => {
  const P = ENGINE_DEFAULTS;
  assert.deepEqual(subdivide(P, 120, 80, mulberry32(3), 24, 24), subdivide(P, 120, 80, mulberry32(3)));
  // 同じ写真（2400×1600px）を 24×24 と 24×6 のマスで分けると、領域の実際の大きさ（px）はだいたい同じ範囲に収まる
  const px = (rs, cw, ch) => rs.map(([, , w, h]) => Math.min(w * cw, h * ch));
  const sq = px(subdivide(P, 100, 67, mulberry32(3), 24, 24), 24, 24);
  const tall = px(subdivide(P, 100, 267, mulberry32(3), 24, 6), 24, 6);
  assert.ok(Math.min(...tall) >= Math.min(...sq) * 0.5, `細長いマスでも領域が細かくなりすぎない（${Math.min(...tall)}px / ${Math.min(...sq)}px）`);
});

test('高さ比：細長いマスでも決定的', () => {
  const io = () => ({ ...fakeIO(60, 120), cw: 20, ch: 5 });
  const P = { seed: 12, K: 6, chaos: 0.2, tempo: true, inject: true };
  assert.deepEqual(run(P, 300, io()).src, run(P, 300, io()).src);
});

test('模様のレイヤー：流れる領域の中で、種からルールどおりの時空図がスクロールする', () => {
  const s = new Simulation({ seed: 31, K: 6, chaos: 0.1, patFrac: 1, patMinWidth: 8, patRules: [90], direction: 'down', skipProb: 0 }, fakeIO(120, 90));
  for (let i = 0; i < 12; i++) s.step();
  // 下へ流れる領域：行 t は、種（真ん中に1個）にルール90を (patT-1-t) 回かけたもの
  const eca = (row, rule) => row.map((_, i) => (rule >> (((row[i - 1] ?? 0) << 2) | (row[i] << 1) | (row[i + 1] ?? 0))) & 1);
  let checked = 0;
  for (const g of s.regions) {
    if (g.w < 8 || g.patT > Math.max(12, Math.round(g.w * (0.3 + 0.2 * g.patV)))) continue;
    let row = Array.from({ length: g.w }, (_, i) => (i === Math.floor(g.w / 2) ? 1 : 0));
    const rows = [];
    for (let k = 0; k < g.patT; k++) { rows.unshift(row); row = eca(row, 90); }
    for (let t = 0; t < Math.min(g.h, rows.length); t++) {
      const got = Array.from({ length: g.w }, (_, i) => s.cur.mask[(g.y + t) * s.cols + g.x + i]);
      assert.deepEqual(got, rows[t], `領域 ${g.index} 行 ${t}`);
    }
    checked++;
  }
  assert.ok(checked > 0);
});

test('模様のレイヤー：割合 0 なら模様なし。途中で割合・向き・テンポ・ルールを変えても決定的', () => {
  assert.ok(run({ seed: 3, K: 6, chaos: 0.1 }, 100).cur.mask.every((v) => v === 0));
  const go = () => {
    const s = new Simulation({ seed: 32, K: 6, chaos: 0.1, patMinWidth: 8 }, fakeIO(100, 80));
    let ones = 0;
    for (let i = 0; i < 400; i++) {
      if (i === 50) s.set('patFrac', 0.6);
      if (i === 150) s.set('tempo', true);
      if (i === 250) s.set('direction', 'right');
      if (i === 280) s.set('patRules', [30, 110]);
      if (i === 320) s.set('patFrac', 0.2);
      s.step();
      for (const v of s.cur.mask) ones += v;
    }
    return { disp: s.displaySrc().slice(), ones, rules: s.regions.map((g) => g.patRule) }; // displaySrc は同じ配列を使い回すのでコピーする
  };
  const a = go(), b = go();
  assert.deepEqual(a, b);
  assert.ok(a.ones > 0, '模様が出ている');
  assert.ok(a.rules.every((r) => r === 30 || r === 110), 'ルールを絞ると、その中から選び直す');
});

test('模様のレイヤー：ルールを全部 OFF にすると模様は消える', () => {
  const s = new Simulation({ seed: 33, K: 6, chaos: 0.1, patFrac: 1, patMinWidth: 8 }, fakeIO(100, 80));
  for (let i = 0; i < 30; i++) s.step();
  assert.ok(s.cur.mask.some((v) => v));
  s.set('patRules', []);
  s.step(); s.step();
  assert.ok(s.cur.mask.every((v) => v === 0));
});
