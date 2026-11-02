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

// 長方形の SSE（平均色からの差の2乗の合計）を一瞬で求める関数を作る。累積和（R・G・B・2乗の和）を使う
function sseTable(cols, rows, mean) {
  // S[(y * (cols + 1) + x) * 4] = (0,0)〜(x,y) の手前までの和
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
  return (x, y, w, h) => {
    const a = (y * W + x) * 4, b = (y * W + x + w) * 4, c = ((y + h) * W + x) * 4, d = ((y + h) * W + x + w) * 4;
    const v = c4 => S[d + c4] - S[b + c4] - S[c + c4] + S[a + c4];
    const R = v(0), G = v(1), B = v(2);
    return v(3) - (R * R + G * G + B * B) / (w * h);
  };
}

/**
 * Quadtree（regionLayout = 'quadtree'）。画面で見て正方形の領域を、縦横それぞれ半分にして4つに割っていく。
 * - 最小の葉（単位）は、長いほうのマスの辺 × base px の正方形。マスの数では ux × uy マス（高さ比が整数でなければ、
 *   1割まで正方形からずれるのを許す）。base は quadLeaf（2）。短い辺に単位が quadMinLeaves 個並ばないほど
 *   大きなマスなら 1 に下げる
 * - 根：単位で数えて 2 のべき乗 R の正方形を敷き詰める。R は、縦横どちらも余りが R/2 以下になる最大のもの。
 *   余り（と単位に足りない端）は右端・下端の根に含める（端の根だけ最大 1.5:1 の長方形になる）。
 *   余りの帯を小さな正方形で埋めると、写真に関係なく端に細かい正方形が並んでしまった
 * - 割る位置は真ん中。8マスの倍数（だめなら 4・2）にそろえられて、ずれが1割以内ならそろえる。
 *   2 のべき乗の正方形はちょうど半分なので、8マス以上の葉は位置も辺も8マスの倍数にそろい、大きなマスが欠けない
 * - 色のばらつきで割る：平均の誤差（RMS）が最も大きい葉から順に4つに割る。乱数は使わない
 * - count 個以上になるか、割れる葉がなくなったら止める。戻り値は subdivide と同じ形（並びは木の順）
 */
export function subdivideQuadtree(P, cols, rows, mean, count, cw = 1, ch = 1) {
  const big = Math.max(cw, ch), short = Math.min(cols * cw, rows * ch);
  let base = P.quadLeaf;
  while (base > 1 && short / (base * big) < P.quadMinLeaves) base /= 2;
  const unit = (c) => {
    const raw = base * big / c;
    for (const a of [base, 4, 2, 1]) {
      const v = Math.max(a, Math.round(raw / a) * a);
      if (Math.abs(v - raw) <= raw * 0.1 || a === 1) return v;
    }
  };
  const ux = unit(cw), uy = unit(ch), nx = Math.floor(cols / ux), ny = Math.floor(rows / uy);
  if (nx < 1 || ny < 1) return [[0, 0, cols, rows]];
  let R = 1;
  while (R * 2 <= Math.min(nx, ny)) R *= 2;
  while (R > 1 && (nx % R > R / 2 || ny % R > R / 2)) R /= 2;
  // 長さ len を真ん中で割る位置（単位 u の倍数。8・4・2 の倍数にそろえられればそろえる）
  const half = (pos, len, u) => {
    const c = Math.max(u, Math.min(len - u, Math.round(len / 2 / u) * u));
    for (const a of [REGION_ALIGN, 4, 2]) {
      const v = Math.round((pos + c) / a) * a - pos;
      if (v >= u && v <= len - u && Math.abs(v - len / 2) <= len * 0.1) return v;
    }
    return c;
  };
  const sse = sseTable(cols, rows, mean);
  const node = (x, y, w, h) => {
    const n = { rect: [x, y, w, h], kids: null, gain: -1 };
    if (w >= 2 * ux && h >= 2 * uy) {
      const a = half(x, w, ux), b = half(y, h, uy);
      n.kids = [[x, y, a, b], [x + a, y, w - a, b], [x, y + b, a, h - b], [x + a, y + b, w - a, h - b]];
      // 優先度 = 平均の誤差（RMS）。面積は見ない（面積を効かせると大きな領域から割れて、大きさがそろった格子に近くなった）
      n.gain = Math.sqrt(Math.max(0, sse(x, y, w, h)) / (w * h));
    }
    return n;
  };
  // 根の区切り（マス）。最後の根は端まで伸ばす
  const edges = (n, u, len) => {
    const k = Math.floor(n / R), out = [];
    for (let i = 0; i <= k; i++) out.push(i === k ? len : i * R * u);
    return out;
  };
  const xs = edges(nx, ux, cols), ys = edges(ny, uy, rows);
  const leaves = [];
  for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++)
    leaves.push(node(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]));
  while (leaves.length < count) {
    let k = -1;
    for (let q = 0; q < leaves.length; q++) if (leaves[q].kids && (k < 0 || leaves[q].gain > leaves[k].gain)) k = q;
    if (k < 0) break;
    leaves.splice(k, 1, ...leaves[k].kids.map(r => node(...r)));
  }
  return leaves.map(n => n.rect);
}
