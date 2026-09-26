// regions.js — 領域の再帰分割（kivi engine.js の subdivide を流用）
import { clamp } from './rng.js';

/**
 * P = { maxDepth, minDepth, stopProb, minRegionFrac, splitMin, splitMax }
 * cw, ch = 1マスの幅・高さ（px）。最小領域と分割の向きは「実際の長さ（px）」で決め、縦横それぞれのマス数に換算する
 * → マスの縦横比を変えても領域の構図の細かさが保たれる（kivi と同じ）
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
      const a = clamp(Math.round(w * t), minX, w - minX);
      rec(x, y, a, h, depth + 1); rec(x + a, y, w - a, h, depth + 1);
    } else {
      const a = clamp(Math.round(h * t), minY, h - minY);
      rec(x, y, w, a, depth + 1); rec(x, y + a, w, h - a, depth + 1);
    }
  })(0, 0, cols, rows, 0);
  return out;
}
