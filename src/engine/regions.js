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
