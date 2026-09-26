// regions.js — 領域の再帰分割（kivi engine.js の subdivide を流用）
import { clamp } from './rng.js';

/**
 * P = { maxDepth, minDepth, stopProb, minRegionFrac, splitMin, splitMax }
 * マスは正方形なので、最小領域は縦横同じマス数。
 * 戻り値 [[x, y, w, h], ...]（セル単位）
 */
export function subdivide(P, cols, rows, rng) {
  const min = Math.max(2, Math.round(P.minRegionFrac * Math.max(cols, rows)));
  const out = [];
  (function rec(x, y, w, h, depth) {
    const canV = w >= min * 2, canH = h >= min * 2;
    if (depth >= P.maxDepth || (!canV && !canH) || (depth >= P.minDepth && rng() < P.stopProb)) {
      out.push([x, y, w, h]); return;
    }
    const vert = canV && (!canH || (w > h ? rng() < 0.7 : rng() < 0.3));
    const t = P.splitMin + (P.splitMax - P.splitMin) * rng();
    if (vert) {
      const a = clamp(Math.round(w * t), min, w - min);
      rec(x, y, a, h, depth + 1); rec(x + a, y, w - a, h, depth + 1);
    } else {
      const a = clamp(Math.round(h * t), min, h - min);
      rec(x, y, w, a, depth + 1); rec(x, y + a, w, h - a, depth + 1);
    }
  })(0, 0, cols, rows, 0);
  return out;
}
