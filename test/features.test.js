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
