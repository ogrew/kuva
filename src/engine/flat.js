// flat.js — 塗りつぶし（kivi の pickFlat を kuva 向けにしたもの）
// 一部の写真タイルを、写真の代わりに一色で描く。描画だけに効き、CA の状態には影響しない。
//
// kivi は「画面に2か所以上出てくるタイル」から選ぶが、kuva ではその集合が毎世代変わってちらつく。
// そこで塗るタイルは固定の集合にし、描画時に「元の位置にないタイル（CA で運ばれてきたもの）」だけを塗る。
//   unit = 'tile'  : タイルごとに hash(seed, タイル) < ratio なら塗る
//   unit = 'state' : 状態（K色の分類）を seed で決まる順に並べ、先頭から K × ratio 個の状態のタイルを全部塗る
// どちらも ratio を上げると塗るタイルが増えるだけ（減らない）なので、スライダーを動かしても入れ替わらない。
import { mulberry32, hash } from './rng.js';

/**
 * sim = { cls, palette, mean, K, P: { seed } }
 * 戻り値：タイルごとの RGBA（Uint8Array、長さ = セル数 × 4）。A = 255 なら塗る、0 なら塗らない
 */
export function flatColors(sim, ratio, unit, color) {
  const { cls, palette, mean, K } = sim, N = cls.length, seed = sim.P.seed >>> 0;
  const out = new Uint8Array(N * 4);
  if (!(ratio > 0)) return out;
  let on;
  if (unit === 'state') {
    const order = [...Array(K).keys()], rng = mulberry32((seed ^ 0x5F3759DF) >>> 0);
    for (let i = K - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
    const chosen = new Set(order.slice(0, Math.round(K * Math.min(1, ratio))));
    on = (s) => chosen.has(cls[s]);
  } else {
    const th = Math.min(1, ratio) * 4294967296;
    on = (s) => hash(seed, s, 0x666C6174) < th;
  }
  for (let s = 0; s < N; s++) {
    if (!on(s)) continue;
    for (let c = 0; c < 3; c++) out[s * 4 + c] = color === 'mean' ? Math.round(mean[s * 3 + c]) : palette[cls[s] * 3 + c];
    out[s * 4 + 3] = 255;
  }
  return out;
}
