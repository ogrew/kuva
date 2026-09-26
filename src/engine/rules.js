// rules.js — ルール表
// 近傍 (L, C, R) + 元写真の状態 I → 次の状態。サイズ K^4。添字は ((L*K + C)*K + R)*K + I。
//
// chaos を再生中に変えられるように、各項目は「本来の値」「固定の乱数 u」「ランダムな状態」を持ち、
// 表は  u < chaos ? ランダムな状態 : 本来の値  で組み直す。
// chaos を変えても乱数の消費は変わらないので、同じ操作をすれば同じ映像になる。
import { clamp } from './rng.js';

// ルールの「性格」。本来の値のうち、写真へ戻らない（確率 1 - pull の）項目をどう決めるか
//   keep  : C（保持）
//   luma  : C から ±1段ずれた状態（kivi の「明暗」）
//   shift : L か R（ルールごとにどちらか）→ 模様が斜めに流れる
//   total : L + C + R の合計だけで決まる（合計ごとにランダムな状態）→ 三角形や入れ子の模様が出やすい
export const GENRES = ['keep', 'luma', 'shift', 'total'];

/**
 * 1つのルールを作る。本来の値は項目ごとに、確率 pull で I（写真へ戻る）、それ以外は genre による。
 * I だけだと毎世代すぐ写真に戻ってちらつくだけになり、C だけだと崩れがたまる一方になる。
 */
export function makeRule(K, genre, pull, rng) {
  const E = K * K * K * K;
  const base = new Uint8Array(E), rnd = new Uint8Array(E), u = new Float32Array(E);
  const side = genre === 'shift' ? (rng() < 0.5 ? 'L' : 'R') : null;
  const sum = genre === 'total' ? Uint8Array.from({ length: 3 * K - 2 }, () => Math.floor(rng() * K)) : null;
  for (let e = 0; e < E; e++) {
    const I = e % K, R = Math.floor(e / K) % K, C = Math.floor(e / (K * K)) % K, L = Math.floor(e / (K * K * K));
    const back = rng() < pull;
    let b;
    if (genre === 'keep') b = C;
    else if (genre === 'luma') b = clamp(C + (rng() < 0.5 ? -1 : 1), 0, K - 1);
    else if (genre === 'shift') b = side === 'L' ? L : R;
    else b = sum[L + C + R];
    base[e] = back ? I : b;
    u[e] = rng();
    rnd[e] = Math.floor(rng() * K);
  }
  return { genre, pull, base, rnd, u, table: new Uint8Array(E) };
}

// 画像全体で共有するルールのプール（すべて keep、pull は共通）
export function makeRulePool(K, count, pull, rng) {
  const rules = [];
  for (let r = 0; r < count; r++) rules.push(makeRule(K, 'keep', pull, rng));
  return { K, E: K * K * K * K, rules };
}

export function applyChaos(rules, chaos) {
  for (const { base, rnd, u, table } of rules) {
    for (let e = 0; e < table.length; e++) table[e] = u[e] < chaos ? rnd[e] : base[e];
  }
}
