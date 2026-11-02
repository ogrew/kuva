// regions.js — 領域の再帰分割（kivi engine.js の subdivide を流用）
import { clamp } from './rng.js';

// 領域の境目は、グリッドの原点から REGION_ALIGN マスの倍数にそろえる。大きなマスの倍率（2・4・8）で割り切れるので、
// 大きなマスが領域の端で欠けるのは、画面の右端・下端に接する領域だけになる
export const REGION_ALIGN = 8;

/**
 * 切る位置（領域の先頭 pos からの長さ cut）を、近い REGION_ALIGN の倍数にそろえる。両側が min 以上になる倍数を選ぶ。
 * 最小の長さぎりぎりの領域では倍数が入らないことがあるので、2マスまでは最小を割ってよい（2マスは残す）。
 * それでも入らなければ 4 の倍数、2 の倍数（最小の領域が数マスしかない大きな cellSize）の順にそろえ、それも無理ならそのまま
 */
export function alignCut(pos, len, cut, min) {
  for (const a of [REGION_ALIGN, 4, 2]) {
    const lo = Math.floor((pos + cut) / a) * a - pos, hi = lo + a;
    const order = cut - lo <= hi - cut ? [lo, hi] : [hi, lo];
    for (const m of [min, Math.max(2, min - Math.min(2, a / 2))]) for (const v of order) if (v >= m && v <= len - m) return v;
  }
  return cut;
}

/**
 * P = { maxDepth, minDepth, stopProb, minRegionFrac, splitMin, splitMax }
 * cw, ch = 1マスの幅・高さ（px）。最小領域と分割の向きは「実際の長さ（px）」で決め、縦横それぞれのマス数に換算する
 * → マスの縦横比を変えても領域の構図の細かさが保たれる（kivi と同じ）
 * 切る位置は REGION_ALIGN マスの倍数にそろえる（alignCut。乱数の消費は変わらない）
 * 戻り値 [[x, y, w, h], ...]（セル単位）
 */
export function subdivide(P, cols, rows, rng, cw = 1, ch = 1) {
  const physLong = Math.max(cols * cw, rows * ch);
  const minX = Math.max(2, Math.round(P.minRegionFrac * physLong / cw));
  const minY = Math.max(2, Math.round(P.minRegionFrac * physLong / ch));
  const out = [];
  (function rec(x, y, w, h, depth) {
    const canV = w >= minX * 2, canH = h >= minY * 2;
    if (depth >= P.maxDepth || (!canV && !canH) || (depth >= P.minDepth && rng() < P.stopProb)) {
      out.push([x, y, w, h]); return;
    }
    const vert = canV && (!canH || (w * cw > h * ch ? rng() < 0.7 : rng() < 0.3));
    const t = P.splitMin + (P.splitMax - P.splitMin) * rng();
    if (vert) {
      const a = alignCut(x, w, clamp(Math.round(w * t), minX, w - minX), minX);
      rec(x, y, a, h, depth + 1); rec(x + a, y, w - a, h, depth + 1);
    } else {
      const a = alignCut(y, h, clamp(Math.round(h * t), minY, h - minY), minY);
      rec(x, y, w, a, depth + 1); rec(x, y + a, w, h - a, depth + 1);
    }
  })(0, 0, cols, rows, 0);
  return out;
}

/**
 * 色のばらつきで分ける（regionMode = 'adaptive'）。乱数は使わず、写真だけで決まる。
 * 平均色からの差の2乗の合計（SSE）を、割ったときに最も減らせる領域から順に割り、count 個になったら止める。
 * 切る位置は、縦横すべての候補（alignCut でそろえたもの）から、割ったあとの SSE の合計が最小になるもの。
 * 最小領域は subdivide と同じ。mean = セルごとの平均色（RGB を3つずつ）
 * 戻り値は subdivide と同じ形。並びは分割の木の順（割った領域の位置に2つの子を入れる）
 */
export function subdivideAdaptive(P, cols, rows, mean, count, cw = 1, ch = 1) {
  const physLong = Math.max(cols * cw, rows * ch);
  const minX = Math.max(2, Math.round(P.minRegionFrac * physLong / cw));
  const minY = Math.max(2, Math.round(P.minRegionFrac * physLong / ch));
  // 累積和（R・G・B・2乗の和）。S[(y * (cols + 1) + x) * 4] = (0,0)〜(x,y) の手前までの和
  const W = cols + 1, S = new Float64Array(W * (rows + 1) * 4);
  for (let y = 0; y < rows; y++) {
    const r = [0, 0, 0, 0];
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 3, R = mean[i], G = mean[i + 1], B = mean[i + 2];
      r[0] += R; r[1] += G; r[2] += B; r[3] += R * R + G * G + B * B;
      const o = ((y + 1) * W + x + 1) * 4, u = (y * W + x + 1) * 4;
      for (let c = 0; c < 4; c++) S[o + c] = S[u + c] + r[c];
    }
  }
  const sse = (x, y, w, h) => {
    const a = (y * W + x) * 4, b = (y * W + x + w) * 4, c = ((y + h) * W + x) * 4, d = ((y + h) * W + x + w) * 4;
    const v = c4 => S[d + c4] - S[b + c4] - S[c + c4] + S[a + c4];
    const R = v(0), G = v(1), B = v(2);
    return v(3) - (R * R + G * G + B * B) / (w * h);
  };
  // 領域の最良の切り方（gain = 減らせる SSE。割れなければ -1）
  const best = (x, y, w, h) => {
    const g = { rect: [x, y, w, h], gain: -1, kids: null }, whole = sse(x, y, w, h);
    const tryAxis = (vert) => {
      const len = vert ? w : h, min = vert ? minX : minY, pos = vert ? x : y;
      if (len < min * 2) return;
      const seen = new Set();
      for (let c = min; c <= len - min; c++) {
        const a = alignCut(pos, len, c, min);
        if (seen.has(a) || a < 1 || a > len - 1) continue;
        seen.add(a);
        const kids = vert ? [[x, y, a, h], [x + a, y, w - a, h]] : [[x, y, w, a], [x, y + a, w, h - a]];
        const gain = whole - sse(...kids[0]) - sse(...kids[1]);
        if (gain > g.gain) { g.gain = gain; g.kids = kids; }
      }
    };
    tryAxis(true); tryAxis(false);
    return g;
  };
  const leaves = [best(0, 0, cols, rows)];
  while (leaves.length < count) {
    let k = -1;
    for (let i = 0; i < leaves.length; i++) if (leaves[i].kids && (k < 0 || leaves[i].gain > leaves[k].gain)) k = i;
    if (k < 0) break;
    leaves.splice(k, 1, ...leaves[k].kids.map(r => best(...r)));
  }
  return leaves.map(g => g.rect);
}
