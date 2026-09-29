import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { fakeIO, hashSim } from './helpers.js';

const base = { seed: 7, K: 6, chaos: 0.1, skipProb: 0, bigFrac: 1 };
const io = () => fakeIO(120, 90);

// 大きなマスの中の各マスが、左上と同じ状態・「左上のタイル＋中の位置」のタイルを持つ
function checkBlocks(s) {
  const { cols, rows } = s, st = s.cur.state, src = s.src;
  for (const g of s.regions) {
    const k = g.scale;
    if (k === 1) continue;
    for (let by = g.y; by < g.y + g.h; by += k) for (let bx = g.x; bx < g.x + g.w; bx += k) {
      const c = by * cols + bx, ox = src[c] % cols, oy = Math.floor(src[c] / cols);
      for (let y = by; y < Math.min(by + k, g.y + g.h); y++) for (let x = bx; x < Math.min(bx + k, g.x + g.w); x++) {
        const i = y * cols + x;
        assert.equal(st[i], st[c]);
        assert.equal(src[i], Math.min(rows - 1, oy + y - by) * cols + Math.min(cols - 1, ox + x - bx));
      }
    }
  }
}

test('大きなマス：倍率は 2・3 で、小さい領域は小さい倍率に落ちる', () => {
  const s = new Simulation(base, io());
  const scales = new Set(s.regions.map((g) => g.scale));
  assert.ok(scales.has(2) && scales.has(3));
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
