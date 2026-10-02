import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { SCALE_LIST, blockCodes } from '../src/engine/scale.js';
import { REGION_ALIGN } from '../src/engine/regions.js';
import { fakeIO, hashSim } from './helpers.js';

const base = { seed: 7, K: 6, chaos: 0.1, skipProb: 0, bigFrac: 1 };
const io = () => fakeIO(120, 90);

// 大きなマスの中の各マスが、左上と同じ状態・「左上のタイル＋中の位置」のタイルを持つ
function checkBlocks(s, regions = s.regions) {
  const { cols, rows } = s, st = s.cur.state, src = s.src;
  for (const g of regions) {
    const k = g.scale;
    if (k === 1) continue;
    for (let by = g.y; by < g.y + g.h; by += k) for (let bx = g.x; bx < g.x + g.w; bx += k) {
      const c = by * cols + bx, ox = src[c] % cols, oy = Math.floor(src[c] / cols);
      assert.ok(ox + k <= cols && oy + k <= rows, '大きなタイルはグリッドからはみ出さない');
      for (let y = by; y < Math.min(by + k, g.y + g.h); y++) for (let x = bx; x < Math.min(bx + k, g.x + g.w); x++) {
        const i = y * cols + x;
        assert.equal(st[i], st[c]);
        assert.equal(src[i], (oy + y - by) * cols + ox + x - bx);
      }
    }
  }
}

test('大きなマス：倍率は 2・4 で、小さい領域は小さい倍率に落ちる', () => {
  const s = new Simulation(base, io());
  const scales = new Set(s.regions.map((g) => g.scale));
  assert.ok(scales.has(2) && scales.has(4) && !scales.has(3));
  for (const g of s.regions) assert.ok(Math.ceil(Math.min(g.w, g.h) / g.scale) >= s.P.bigMinBlocks || g.scale === 1);
  const none = new Simulation({ ...base, bigFrac: 0 }, io());
  assert.ok(none.regions.every((g) => g.scale === 1));
});

test('大きなマス：中の各マスがそろい、s 世代に1回だけ変わる', () => {
  for (const motion of ['flow', 'ca']) {
    const s = new Simulation({ ...base, motion, inject: true, injectPeriod: 40 }, io());
    const changes = new Map(s.regions.map((g) => [g, 0]));
    for (let i = 0; i < 60; i++) {
      const before = s.src.slice(), bs = s.cur.state.slice();
      s.step();
      if (i >= 3) checkBlocks(s);
      for (const g of s.regions) {
        let changed = false;
        for (let y = g.y; y < g.y + g.h && !changed; y++) for (let x = g.x; x < g.x + g.w; x++) {
          const j = y * s.cols + x;
          if (before[j] !== s.src[j] || bs[j] !== s.cur.state[j]) { changed = true; break; }
        }
        if (changed) changes.set(g, changes.get(g) + 1);
      }
    }
    for (const [g, n] of changes) assert.ok(n <= Math.ceil(60 / g.scale), `${motion} 倍率 ${g.scale} の領域が ${n} 回変わった`);
  }
});

test('大きなマス：途中の割合の変更・分裂と合体・漏れ・テンポ・模様を含めて決定的', () => {
  for (const motion of ['flow', 'ca']) {
    const run = () => {
      const s = new Simulation({ ...base, motion, bigFrac: 0, topology: true, topologyInterval: 12, leakEnabled: true, tempo: true, tempoFast: 0, tempoSlow: 5, inject: true, injectPeriod: 60, patFrac: 1, patMinWidth: 4 }, io());
      const hs = [];
      for (let i = 0; i < 400; i++) {
        if (i === 30) s.set('bigFrac', 1);
        if (i === 150) s.set('bigFrac', 0.4);
        if (i === 250) s.set('direction', 'left');
        s.step();
        if (i % 50 === 49) hs.push(hashSim(s));
      }
      // 領域がすき間・重なりなく画面を覆う
      const cover = new Uint8Array(s.cols * s.rows);
      for (const g of s.regions) for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) cover[y * s.cols + x]++;
      assert.ok(cover.every((n) => n === 1));
      return hs;
    };
    assert.deepEqual(run(), run());
  }
});

test('大きなマス：割合 0 に戻すと、すべての領域が倍率 1 に戻り、模様も重なる', () => {
  const s = new Simulation({ ...base, patFrac: 1, patMinWidth: 4 }, io());
  for (let i = 0; i < 30; i++) s.step();
  for (const g of s.regions) if (g.scale > 1) {
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) assert.equal(s.cur.mask[y * s.cols + x], 0, '大きなマスには模様を重ねない');
  }
  const big = s.regions.filter((g) => g.scale > 1);
  assert.ok(big.length);
  s.set('bigFrac', 0);
  for (let i = 0; i < 30; i++) s.step();
  assert.ok(s.regions.every((g) => g.scale === 1));
  assert.ok(big.some((g) => { for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) if (s.cur.mask[y * s.cols + x]) return true; return false; }));
});

test('大きなマスの半分ずつの色：大きなマスを1マスとして解析したものと同じ', async () => {
  const { tileHalves, blockHalves } = await import('../src/engine/flat.js');
  const { analyze } = await import('../src/engine/analyze.js');
  // 1マス = 2×2 px の画像（24×16 マス）と、同じ画像を 1マス = 4×4 px（12×8 マス）で見たもの
  const W = 48, H = 32, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = (i * 37) % 251; data[i * 4 + 1] = (i * 91) % 241; data[i * 4 + 2] = (i * 13) % 239; }
  const io1 = { cols: 24, rows: 16, Ax: 2, Ay: 2, analysis: { data, stride: W } };
  const io2 = { cols: 12, rows: 8, Ax: 4, Ay: 4, analysis: { data, stride: W } };
  const P = { K: 4, kmeansSamples: 1000, kmeansIter: 2, repsPerClass: 2 };
  const { mean } = analyze(P, io1, () => 0.5);
  const b = blockHalves({ cols: 24, rows: 16, mean }, tileHalves(io1), 2), t = tileHalves(io2);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
    const o1 = ((y * 2) * 24 + x * 2) * 24, o2 = (y * 12 + x) * 24;
    for (let k = 0; k < 24; k++) assert.ok(Math.abs(b[o1 + k] - t[o2 + k]) < 1e-3, `(${x}, ${y}) の ${k}`);
  }
});

test('大きなマス：分裂した子は親の倍率を引き継ぎ、大きなマスの並びがそのまま残る。合体は面積の大きいほうから', async () => {
  const { evolveRegions } = await import('../src/engine/topology.js');
  const s = new Simulation({ ...base, topology: true }, io());
  for (let i = 0; i < 20; i++) s.step();
  let splits = 0, merges = 0;
  for (let n = 0; n < 150; n++) {
    const before = s.regions.slice(), ev = { ...s.topologyEvents };
    // 1回に1つの領域だけが組み替えを試すようにする（タイマーは領域ごと。step() の中では組み替えない）
    const started = s.regions.filter((g) => g.started);
    for (const g of s.regions) g.topoWait = 1e9;
    const target = started[n % started.length];
    target.topoWait = 1;
    // 倍率の違う領域の合体直後は、進むまで（最大 s 世代）中がそろっていない。そろっている親だけ確かめる
    let aligned = true;
    try { checkBlocks(s, [target]); } catch { aligned = false; }
    evolveRegions(s);
    const removed = before.filter((g) => !s.regions.includes(g)), added = s.regions.filter((g) => !before.includes(g));
    if (s.topologyEvents.split > ev.split) {
      const [a] = removed;
      for (const g of added) {
        // 小さくなって大きなマスが4つ並ばない子だけは、小さい倍率に落ちてよい
        if (Math.ceil(Math.min(g.w, g.h) / a.scale) >= s.P.bigMinBlocks) assert.equal(g.scale, a.scale);
        if (g.scale === a.scale) { assert.equal((g.x - a.x) % a.scale, 0); assert.equal((g.y - a.y) % a.scale, 0); splits++; }
      }
      // 分裂の直後（1世代も進めていない）でも、子の中がそろっている
      if (aligned) checkBlocks(s, added.filter((g) => g.scale === a.scale));
    } else if (s.topologyEvents.merge > ev.merge) {
      // 面積が同じなら、合体を始めたほう（どちらでもよい）
      const area = (g) => g.w * g.h, max = Math.max(...removed.map(area));
      assert.ok(removed.some((g) => area(g) === max && g.bigU === added[0].bigU && g.bigV === added[0].bigV));
      merges++;
    }
    s.step();
  }
  assert.ok(splits > 0 && merges > 0);
});

test('描く位置の情報：倍率と大きなマスの中の位置', () => {
  const s = new Simulation(base, io()), codes = blockCodes(s), { cols } = s;
  for (const g of s.regions) {
    const k = g.scale;
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
      const b = codes[y * cols + x];
      if (k === 1) { assert.equal(b, 0); continue; }
      const bx = x - (x - g.x) % k, by = y - (y - g.y) % k;
      assert.equal(SCALE_LIST[b & 3], k);
      assert.deepEqual([(b >> 2) & 3, (b >> 4) & 3], [x - bx, y - by]);
    }
  }
});

test('領域の境目は4マスの倍数：大きなマスが欠けるのは画面の右端・下端に接する領域だけ（分裂・合体のあとも）', () => {
  // 4の倍数でないグリッド・細長いマス・大きな cellSize（最小の領域が2マス）でも確かめる
  for (const [cols, rows, cw, ch, strict] of [[122, 91, 1, 1, true], [90, 250, 24, 6, true], [26, 18, 1, 1, false]]) {
    const s = new Simulation({ ...base, topology: true, topologyInterval: 12 }, { ...fakeIO(cols, rows), cw, ch });
    const check = () => {
      for (const g of s.regions) {
        // 境目は4の倍数（最小の領域が数マスしかないときは2の倍数）か、画面の端
        const a = strict ? REGION_ALIGN : 2, on = (v, n) => v % a === 0 || v === n;
        assert.ok(on(g.x, cols) && on(g.x + g.w, cols) && on(g.y, rows) && on(g.y + g.h, rows), `[${g.x}, ${g.y}, ${g.w}, ${g.h}]`);
        if (g.scale > 1) {
          if (g.x + g.w < cols) assert.equal(g.w % g.scale, 0);
          if (g.y + g.h < rows) assert.equal(g.h % g.scale, 0);
        }
      }
    };
    check();
    for (let i = 0; i < 400; i++) { s.step(); if (i % 20 === 0) check(); }
    assert.ok(s.topologyEvents.split > 0 && s.topologyEvents.merge > 0);
  }
});
