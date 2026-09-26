// テスト共通の道具
import { Simulation } from '../src/engine/sim.js';
import { mulberry32 } from '../src/engine/rng.js';

// 合成画像（グラデーション＋ノイズ）。1セル = 1px
export function fakeIO(cols, rows, seed = 1) {
  const r = mulberry32(seed), data = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const o = (y * cols + x) * 4;
    data[o] = (x * 255) / cols; data[o + 1] = (y * 255) / rows; data[o + 2] = r() * 255; data[o + 3] = 255;
  }
  return { cols, rows, Ax: 1, Ay: 1, analysis: { data, stride: cols } };
}

export const run = (P, gens, io = fakeIO(80, 60)) => {
  const s = new Simulation(P, io);
  for (let i = 0; i < gens; i++) s.step();
  return s;
};

// 状態と src をまとめたハッシュ（FNV-1a）
export function hashSim(s) {
  let h = 0x811C9DC5;
  const mix = (v) => { h = Math.imul(h ^ (v & 0xFF), 0x01000193); h = Math.imul(h ^ ((v >>> 8) & 0xFF), 0x01000193); h = Math.imul(h ^ ((v >>> 16) & 0xFF), 0x01000193); };
  for (const v of s.cur.state) mix(v);
  for (const v of s.src) mix(v);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ゴールデンの条件。途中の操作（ops：何世代目に何を変えるか）も含めて再現する
export const GOLDEN_CASES = [
  { name: 'ca・味付けなし', P: { seed: 1, K: 7, chaos: 0.1, motion: 'ca', ruleMorph: false, regionRules: false } },
  { name: 'flow・味付けなし', P: { seed: 1, K: 7, chaos: 0.1, motion: 'flow', ruleMorph: false, regionRules: false } },
  { name: 'flow・A＋B（既定）', P: { seed: 2, K: 7, chaos: 0.1 } },
  { name: 'flow・A＋B・C', P: { seed: 3, K: 6, chaos: 0.2, inject: true, injectPeriod: 90 } },
  { name: 'flow・A＋B・C・E（×2〜×1/5）', P: { seed: 4, K: 8, chaos: 0.15, inject: true, injectPeriod: 120, tempo: true, tempoFast: 0, tempoSlow: 5 } },
  { name: 'flow・再生中の操作', P: { seed: 5, K: 7, chaos: 0.1, inject: false },
    ops: [[100, 'chaos', 0.4], [150, 'inject', true], [200, 'tempo', true], [300, 'tempoSlow', 2], [350, 'holdMax', 20]] },
];
export const GOLDEN_GENS = 500;

export function runGolden(c) {
  const s = new Simulation(c.P, fakeIO(80, 60));
  const ops = c.ops || [];
  for (let g = 0; g < GOLDEN_GENS; g++) {
    for (const [at, k, v] of ops) if (at === g) s.set(k, v);
    s.step();
  }
  return hashSim(s);
}
