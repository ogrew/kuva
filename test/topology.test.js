import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { evolveRegions } from '../src/engine/topology.js';
import { fakeIO } from './helpers.js';

const base = { seed: 42, K: 5, chaos: 0.2, topology: true, leakEnabled: true, leak: 0.6, skipProb: 0 };
const rects = s => s.regions.map(({ index, x, y, w, h }) => [index, x, y, w, h]);
function checkCoverage(s) {
  const cover = new Uint8Array(s.cols * s.rows);
  for (const g of s.regions) {
    assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= s.cols && g.y + g.h <= s.rows);
    assert.ok(g.w > 0 && g.h > 0);
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) cover[y * s.cols + x]++;
  }
  assert.ok(cover.every(n => n === 1), '全セルがちょうど一つの領域に属する');
}

test('分裂・合体：タイルを保ち、隙間・重複を作らず、未変更の領域を初期化しない', () => {
  const s = new Simulation(base, { ...fakeIO(80, 60), cw: 24, ch: 6 });
  for (let i = 0; i < 30; i++) s.step();
  for (let i = 0; i < 200; i++) {
    const before = s.regions.slice(), src = s.src.slice(), state = s.cur.state.slice();
    const g = s.regions[i % s.regions.length];
    g.topoWait = 1;
    evolveRegions(s);
    checkCoverage(s);
    assert.deepEqual(s.src, src);
    assert.deepEqual(s.cur.state, state);
    assert.ok(s.regions.length <= s.maxRegions);
    for (const g of before) if (s.regions.some(n => n.index === g.index)) assert.ok(s.regions.includes(g));
  }
  assert.ok(s.topologyEvents.split > 0 && s.topologyEvents.merge > 0);
});

test('分裂・合体と漏れ：途中のON/OFF・方向・chaos・模様・テンポ変更も決定的', () => {
  for (const motion of ['flow', 'ca']) {
    const run = () => {
      const s = new Simulation({ ...base, motion, tempo: true, tempoFast: 0, tempoSlow: 5, inject: true, patFrac: 1, patMinWidth: 4 }, fakeIO(64, 48));
      for (let i = 0; i < 700; i++) {
        if (i === 110) { s.set('topology', false); s.set('leak', 0); }
        if (i === 210) { s.set('topology', true); s.set('leak', 1); s.set('chaos', 0.7); }
        if (i === 350) { s.set('direction', 'left'); s.set('patRules', [90]); }
        s.step();
        if (i % 50 === 0) checkCoverage(s);
        assert.ok(s.src.every(v => v >= 0 && v < s.cols * s.rows));
        assert.ok(s.cur.state.every(v => v >= 0 && v < s.K));
      }
      assert.ok(s.topologyEvents.split && s.topologyEvents.merge);
      return { rects: rects(s), src: s.src, state: s.cur.state, mask: s.cur.mask };
    };
    assert.deepEqual(run(), run());
  }
});

test('分裂・合体：OFFにすると現在の境界を保つ', () => {
  const s = new Simulation(base, fakeIO(40, 30));
  for (let i = 0; i < 150; i++) s.step();
  s.set('topology', false);
  const before = rects(s);
  for (let i = 0; i < 100; i++) s.step();
  assert.deepEqual(rects(s), before);
});

test('漏れ：4方向とも隣のタイルが入口に入り、画面端は循環する', () => {
  for (const direction of ['down', 'up', 'right', 'left']) {
    const s = new Simulation({ ...base, topology: false, leak: 1, direction, ruleMorph: false, regionRules: false, pull: 0, chaos: 0, switchProb: 0 }, fakeIO(48, 36));
    const prev = s.src.slice();
    s.step();
    let crossings = 0;
    for (const g of s.regions) {
      const vertical = ['down', 'up'].includes(direction), positive = ['down', 'right'].includes(direction);
      const dt = (vertical ? s.cols : 1) * (positive ? 1 : -1);
      const start = (g.y + (direction === 'up' ? g.h - 1 : 0)) * s.cols + g.x + (direction === 'left' ? g.w - 1 : 0);
      const outside = direction === 'down' ? g.y > 0 : direction === 'up' ? g.y + g.h < s.rows : direction === 'right' ? g.x > 0 : g.x + g.w < s.cols;
      const lineCount = vertical ? g.h : g.w;
      for (let i = 0; i < (vertical ? g.w : g.h); i++) {
        const c = start + i * (vertical ? 1 : s.cols);
        assert.equal(s.src[c], prev[outside ? c - dt : c + (lineCount - 1) * dt]);
        if (outside) crossings++;
      }
    }
    assert.ok(crossings > 0);
  }
});

test('漏れ：入口を行の幅の4等分で開閉し、帯の中はそろう', () => {
  const s = new Simulation({ ...base, topology: false, leak: 0.5, direction: 'down', ruleMorph: false, regionRules: false, pull: 0, chaos: 0, switchProb: 0 }, fakeIO(64, 48));
  const prev = s.src.slice();
  s.step();
  let open = 0, closed = 0;
  for (const g of s.regions) {
    if (g.y === 0) continue;
    const bands = [[], [], [], []];
    for (let i = 0; i < g.w; i++) {
      const c = g.y * s.cols + g.x + i;
      const leaked = s.src[c] === prev[c - s.cols];
      if (!leaked) assert.equal(s.src[c], prev[c + (g.h - 1) * s.cols]);
      bands[Math.floor(i * 4 / g.w)].push(leaked);
    }
    for (const b of bands) if (b.length) {
      assert.ok(b.every(v => v === b[0]), '帯の中は全部開くか全部閉じる');
      b[0] ? open++ : closed++;
    }
  }
  assert.ok(open > 0 && closed > 0);
});

test('漏れ：×2テンポでも領域の走査順で結果が変わらない', () => {
  const P = { ...base, topology: false, tempo: true, tempoFast: 0, tempoSlow: 0, inject: true, patFrac: 1, patMinWidth: 4 };
  const a = new Simulation(P, fakeIO(60, 40)), b = new Simulation(P, fakeIO(60, 40));
  b.regions.reverse();
  for (let i = 0; i < 120; i++) { a.step(); b.step(); }
  assert.deepEqual(a.cur, b.cur);
});

test('漏れ：OFFなら割合にかかわらず従来と同じ、再ONで割合を保持する', () => {
  const a = new Simulation({ ...base, topology: false, leakEnabled: false }, fakeIO(48, 36));
  const b = new Simulation({ ...base, topology: false, leak: 0 }, fakeIO(48, 36));
  for (let i = 0; i < 80; i++) { a.step(); b.step(); }
  assert.deepEqual(a.cur, b.cur);
  a.set('leakEnabled', true);
  for (let i = 0; i < 80; i++) { a.step(); b.step(); }
  assert.notDeepEqual(a.src, b.src);
  a.set('leakEnabled', false);
  assert.equal(a.P.leak, 0.6);
  a.set('leakEnabled', true);
  assert.equal(a.P.leak, 0.6);
});

test('変化の間隔：変更は領域ごとの残り時間に反映され、同じ操作なら同じ結果', () => {
  const run = () => {
    const s = new Simulation({ ...base, topologyInterval: 48 }, fakeIO(64, 48));
    for (let i = 0; i < 10; i++) s.step();
    const waits = s.regions.map(g => g.topoWait);
    s.set('topologyInterval', 96);
    assert.deepEqual(s.regions.map(g => g.topoWait), waits.map(w => w * 2));
    s.set('topologyInterval', 12);
    for (let i = 0; i < 180; i++) {
      if (i === 30) s.set('leakEnabled', false);
      if (i === 80) s.set('leakEnabled', true);
      s.step();
      for (const g of s.regions) if (g.started) assert.ok(g.topoWait >= 1 && g.topoWait <= 18);
    }
    assert.ok(s.topologyEvents.split + s.topologyEvents.merge >= 10);
    return { rects: rects(s), cur: s.cur };
  };
  assert.deepEqual(run(), run());
});

test('分裂・合体：領域ごとのタイミングで、同じ世代に複数か所が組み替わる', () => {
  const s = new Simulation({ ...base, topologyInterval: 12 }, fakeIO(64, 48));
  let multi = 0;
  for (let i = 0; i < 200; i++) {
    const n = s.topologyEvents.split + s.topologyEvents.merge;
    s.step();
    checkCoverage(s);
    if (s.topologyEvents.split + s.topologyEvents.merge - n >= 2) multi++;
  }
  assert.ok(multi > 0);
});

test('分裂・合体：ON/OFFで他の乱数系列を変えない（組み替えが起きる前は同じ映像）', () => {
  const a = new Simulation({ ...base, leakEnabled: false, topologyInterval: 240 }, fakeIO(48, 36));
  const b = new Simulation({ ...base, leakEnabled: false, topology: false }, fakeIO(48, 36));
  for (let i = 0; i < 100; i++) { a.step(); b.step(); }
  assert.equal(a.topologyEvents.split + a.topologyEvents.merge, 0);
  assert.deepEqual(a.cur, b.cur);
});

test('Staggerと分裂・合体：開始待ちの領域を保ち、開始済みの領域を再び待たせない', () => {
  const s = new Simulation({ ...base, stagger: 200, topologyInterval: 12 }, fakeIO(64, 48));
  for (let i = 0; i < 260; i++) {
    if (i === 100) s.set('stagger', 400);
    const waiting = s.regions.filter(g => !g.started && s.gen < Math.floor(g.startU * s.P.stagger));
    const started = s.regions.filter(g => g.started);
    const ids = new Set(s.regions.map(g => g.index));
    s.step();
    for (const g of waiting) {
      assert.ok(s.regions.includes(g), '開始待ちの領域は組み替えない');
      for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
        const c = y * s.cols + x;
        assert.equal(s.src[c], c, '開始待ちでは元写真を保つ');
      }
    }
    for (const g of s.regions) if (!ids.has(g.index) || started.includes(g)) assert.equal(g.started, true);
  }
  assert.ok(s.topologyEvents.split > 0 && s.topologyEvents.merge > 0);
});
