// flat.js — 塗りつぶし（kivi の pickFlat を kuva 向けにしたもの）
// 一部の写真タイルを、写真の代わりに一色で描く。描画だけに効き、CA の状態には影響しない。
//
// kivi は「画面に2か所以上出てくるタイル」から選ぶが、kuva ではその集合が毎世代変わってちらつく。
// そこで塗るタイルは固定の集合にし、描画時に「元の位置にないタイル（CA で運ばれてきたもの）」だけを塗る。
//   unit = 'tile'  : タイルごとに hash(seed, タイル) < ratio なら塗る
//   unit = 'state' : 状態（K色の分類）を seed で決まる順に並べ、先頭から K × ratio 個の状態のタイルを全部塗る
// どちらも ratio を上げると塗るタイルが増えるだけ（減らない）なので、スライダーを動かしても入れ替わらない。
//
// 2色塗り（split）：一部の領域では、塗るタイルを2つに割って、それぞれの半分の平均色で塗る。
// 割り方（横・縦・斜め2方向）は領域ごとに、その領域の写真で2色の差がいちばん大きく出るものを選ぶ。
// どの割り方にするかは「描く位置の領域」で決める（タイルの出どころではない）。
import { mulberry32, hash } from './rng.js';

// 割り方の番号。0 = 1色
// diagonal = 左上から右下への線（＼）、antidiagonal = 左下から右上への線（／）
export const SPLITS = ['none', 'horizontal', 'vertical', 'diagonal', 'antidiagonal'];
// 塗りの色の層：0 = タイル全体、1・2 = 横（上・下）、3・4 = 縦（左・右）、5・6 = ＼（左下・右上）、7・8 = ／（左上・右下）
export const FLAT_LAYERS = 9;
const HALVES = FLAT_LAYERS - 1;

/**
 * 解析用画像から、タイルごとの「半分ずつの平均色」を作る（写真を読み込み直したときだけ）。
 * io = { cols, rows, Ax, Ay, analysis: {data, stride} }
 * 戻り値：Float32Array（長さ = セル数 × 8 × 3）。並びは FLAT_LAYERS の 1〜8
 * ちょうど境目にある画素は両側に半分ずつ入れる。片側に画素がないときはタイル全体の平均
 */
export function tileHalves(io) {
  const { cols, rows, Ax, Ay, analysis } = io, d = analysis.data, st = analysis.stride;
  const N = cols * rows, S = HALVES * 3, out = new Float32Array(N * S);
  const acc = new Float32Array(HALVES * 4); // 半分ごとの r, g, b, 重み
  const side = (a, b) => (a < b ? 1 : a > b ? 0 : 0.5); // a < b 側の重み
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      acc.fill(0);
      let R = 0, G = 0, B = 0;
      for (let y = 0; y < Ay; y++) {
        const fy = (y + 0.5) / Ay;
        let o = ((cy * Ay + y) * st + cx * Ax) * 4;
        for (let x = 0; x < Ax; x++, o += 4) {
          const fx = (x + 0.5) / Ax, r = d[o], g = d[o + 1], b = d[o + 2];
          R += r; G += g; B += b;
          // 左下 = x < y、左上 = x + y < 1（y は下向き）
          const top = side(fy, 0.5), left = side(fx, 0.5), ll = side(fx, fy), ul = side(fx + fy, 1);
          const ws = [top, 1 - top, left, 1 - left, ll, 1 - ll, ul, 1 - ul];
          for (let h = 0; h < HALVES; h++) {
            const w = ws[h];
            if (!w) continue;
            acc[h * 4] += r * w; acc[h * 4 + 1] += g * w; acc[h * 4 + 2] += b * w; acc[h * 4 + 3] += w;
          }
        }
      }
      const n = Ax * Ay, s = (cy * cols + cx) * S;
      for (let h = 0; h < HALVES; h++) {
        const w = acc[h * 4 + 3];
        out[s + h * 3] = w ? acc[h * 4] / w : R / n;
        out[s + h * 3 + 1] = w ? acc[h * 4 + 1] / w : G / n;
        out[s + h * 3 + 2] = w ? acc[h * 4 + 2] / w : B / n;
      }
    }
  }
  return out;
}

/**
 * 大きなマス（s×s、s は偶数）の「半分ずつの平均色」。すべてのマスについて、そこを左上とする大きなマスで作る。
 * s が偶数なので、横・縦の半分は基本のマスがまるごと入り、斜めの線は対角のマスの斜めの線と重なる
 * → 基本のマスの平均色（sim.mean）と半分ずつの色（halves）から、面積の重みで正確に求まる。
 * 戻り値の形は tileHalves と同じ。グリッドの外は含めない
 */
export function blockHalves(sim, halves, s) {
  const { cols, rows, mean } = sim, N = cols * rows, S = HALVES * 3, out = new Float32Array(N * S);
  const acc = new Float64Array(HALVES * 4), h2 = s / 2;
  const add = (h, src, o, w) => { acc[h * 4] += src[o] * w; acc[h * 4 + 1] += src[o + 1] * w; acc[h * 4 + 2] += src[o + 2] * w; acc[h * 4 + 3] += w; };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    acc.fill(0);
    let R = 0, G = 0, B = 0, n = 0;
    for (let dy = 0; dy < s && y + dy < rows; dy++) for (let dx = 0; dx < s && x + dx < cols; dx++) {
      const i = (y + dy) * cols + x + dx, m = i * 3, hb = i * S;
      R += mean[m]; G += mean[m + 1]; B += mean[m + 2]; n++;
      add(dy < h2 ? 0 : 1, mean, m, 1);
      add(dx < h2 ? 2 : 3, mean, m, 1);
      // ＼：4 = 左下（x < y）、5 = 右上。対角のマスは、そのマスの斜めの半分ずつ
      if (dx < dy) add(4, mean, m, 1); else if (dx > dy) add(5, mean, m, 1);
      else { add(4, halves, hb + 12, 0.5); add(5, halves, hb + 15, 0.5); }
      // ／：6 = 左上（x + y < 1）、7 = 右下
      const t = dx + dy - (s - 1);
      if (t < 0) add(6, mean, m, 1); else if (t > 0) add(7, mean, m, 1);
      else { add(6, halves, hb + 18, 0.5); add(7, halves, hb + 21, 0.5); }
    }
    const o = (y * cols + x) * S;
    for (let h = 0; h < HALVES; h++) {
      const w = acc[h * 4 + 3];
      out[o + h * 3] = w ? acc[h * 4] / w : R / n;
      out[o + h * 3 + 1] = w ? acc[h * 4 + 1] / w : G / n;
      out[o + h * 3 + 2] = w ? acc[h * 4 + 2] / w : B / n;
    }
  }
  return out;
}

/**
 * 描く位置ごとの割り方（SPLITS の番号）。領域ごとに hash(seed, 領域) < amount なら2色塗りにし、
 * 割り方は領域内の元写真で「2つの半分の色の差の2乗」の合計がいちばん大きいもの（同じなら SPLITS の順で先のもの）。
 * amount を上げると2色塗りの領域が増えるだけで、入れ替わらない。乱数は使わない
 */
export function splitKinds(sim, halves, amount) {
  const { cols, regions } = sim, seed = sim.P.seed >>> 0;
  const out = new Uint8Array(sim.cls.length);
  if (!(amount > 0) || !halves) return out;
  const th = Math.min(1, amount) * 4294967296;
  for (const g of regions) {
    if (!(hash(seed, g.index, 0x73706C74) < th)) continue;
    const score = new Float64Array(HALVES / 2);
    for (let y = g.y; y < g.y + g.h; y++) {
      for (let x = g.x; x < g.x + g.w; x++) {
        const s = (y * cols + x) * HALVES * 3;
        for (let k = 0; k < score.length; k++) {
          const a = s + k * 6;
          const dr = halves[a] - halves[a + 3], dg = halves[a + 1] - halves[a + 4], db = halves[a + 2] - halves[a + 5];
          score[k] += dr * dr + dg * dg + db * db;
        }
      }
    }
    let k = 0;
    for (let i = 1; i < score.length; i++) if (score[i] > score[k]) k = i;
    for (let y = g.y; y < g.y + g.h; y++) out.fill(k + 1, y * cols + g.x, y * cols + g.x + g.w);
  }
  return out;
}

/**
 * sim = { cls, palette, mean, K, P: { seed } }（大きなマスなら cls・mean はその倍率のもの）
 * halves = tileHalves・blockHalves の結果（null なら2色塗りの層は作らない）
 * salt = タイルごとに選ぶときのハッシュに混ぜる値（倍率ごとに別の選び方にする。倍率 1 は 0）
 * 戻り値：FLAT_LAYERS 層ぶんのタイルごとの RGBA（Uint8Array、長さ = 層 × セル数 × 4）。
 * 0層目の A = 255 なら塗る、0 なら塗らない。1〜8層目は半分ずつの色（color = 'palette' ならパレットの近い色）
 */
export function flatColors(sim, ratio, unit, color, halves = null, salt = 0) {
  const { cls, palette, mean, K } = sim, N = cls.length, seed = sim.P.seed >>> 0;
  const out = new Uint8Array(FLAT_LAYERS * N * 4);
  if (!(ratio > 0)) return out;
  let on;
  if (unit === 'state') {
    const order = [...Array(K).keys()], rng = mulberry32((seed ^ 0x5F3759DF) >>> 0);
    for (let i = K - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
    const chosen = new Set(order.slice(0, Math.round(K * Math.min(1, ratio))));
    on = (s) => chosen.has(cls[s]);
  } else {
    const th = Math.min(1, ratio) * 4294967296;
    on = (s) => hash(seed, s, 0x666C6174 + salt) < th;
  }
  // パレットのいちばん近い色
  const nearest = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) {
      const dr = r - palette[k * 3], dg = g - palette[k * 3 + 1], db = b - palette[k * 3 + 2], v = dr * dr + dg * dg + db * db;
      if (v < bd) { bd = v; best = k; }
    }
    return best;
  };
  for (let s = 0; s < N; s++) {
    if (!on(s)) continue;
    for (let c = 0; c < 3; c++) out[s * 4 + c] = color === 'mean' ? Math.round(mean[s * 3 + c]) : palette[cls[s] * 3 + c];
    out[s * 4 + 3] = 255;
    if (!halves) continue;
    for (let h = 0; h < HALVES; h++) {
      const a = (s * HALVES + h) * 3, o = ((h + 1) * N + s) * 4;
      if (color === 'mean') {
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(halves[a + c]);
      } else {
        const k = nearest(halves[a], halves[a + 1], halves[a + 2]);
        for (let c = 0; c < 3; c++) out[o + c] = palette[k * 3 + c];
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
