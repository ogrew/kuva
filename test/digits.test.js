// マスに重ねる数字：タイルの色から決まり、seed に依存しない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/sim.js';
import { tileDigits } from '../src/engine/digits.js';
import { fakeIO } from './helpers.js';

const lumOf = (s, i) => 0.2126 * s.mean[i * 3] + 0.7152 * s.mean[i * 3 + 1] + 0.0722 * s.mean[i * 3 + 2];

test('数字（明るさ順）：暗いほど小さく、どの数字もほぼ同じ数ずつ。seed を変えても変わらない', () => {
  const io = fakeIO(80, 60);
  const a = new Simulation({ seed: 1, K: 6 }, io), b = new Simulation({ seed: 2, K: 6 }, io);
  const d = tileDigits(a, 'lum');
  assert.deepEqual(d, tileDigits(b, 'lum'));
  const N = d.length, count = new Array(10).fill(0);
  for (let i = 0; i < N; i++) count[d[i]]++;
  for (const c of count) assert.ok(Math.abs(c - N / 10) <= N * 0.02, `${count}`);
  // 明るさの順と数字の順がそろう
  const idx = Array.from({ length: N }, (_, i) => i).sort((i, j) => lumOf(a, i) - lumOf(a, j));
  for (let k = 1; k < N; k++) assert.ok(d[idx[k]] >= d[idx[k - 1]]);
});

test('数字（状態）：K色の分類の一の位', () => {
  const s = new Simulation({ seed: 3, K: 12 }, fakeIO(80, 60));
  const d = tileDigits(s, 'state');
  for (let i = 0; i < d.length; i++) assert.equal(d[i], s.cls[i] % 10);
  assert.ok(d.some((v, i) => s.cls[i] >= 10)); // K = 12 なら 10・11 の状態も出る
});
