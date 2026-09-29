// scale.js — 大きなマス。一部の領域では s×s マス（s = 2・4）を1マスとして CA を計算する。
// 状態・タイルは基本のマス目の配列のまま持つ。大きなマスの値は左上のマスに置き、
// 中の各マスには同じ状態と「出どころのタイル＋大きなマスの中の位置」を書き写す（fillBlocks）。
// → 隣の領域から読む処理（漏れ・合体）や描画は、どの倍率でも基本のマスとして扱える。
// 倍率はハッシュで決める（乱数は使わない）。bigFrac = 0 なら全領域が 1 で、従来と同じ映像。
import { hash } from './rng.js';

export const BIG_SCALES = [2, 4];
// 描画に渡す倍率の番号（0 = 倍率 1、1 = 2、2 = 4）
export const SCALE_LIST = [1, ...BIG_SCALES];

/**
 * 倍率 s の解析。すべてのマスについて「そこを左上とする s×s の平均色」（グリッドの外は含めない）を
 * 全体のパレットで分類する。領域の位置が s の倍数でなくても、どの大きなマスにも分類がある。
 * 代表タイルは、s の倍数の位置にある大きなマスの中から、状態ごとにハッシュの小さい順に選ぶ。
 * 戻り値 { cls, reps, mean }（形は倍率 1 のものと同じ。reps はタイルの左上のマスの番号、mean は s×s の平均色）
 */
export function analyzeScale(sim, s) {
  const { cols, rows, K } = sim, N = cols * rows;
  const cls = new Uint8Array(N), bmean = new Float32Array(N * 3);
  const cand = Array.from({ length: K }, () => []);
  classifyScale(sim, s, cls, bmean, cand);
  const R = sim.P.repsPerClass;
  let reps = cand.map((c) => c.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, R).map((e) => e[1]));
  // 空の状態は輝度が近い状態の代表を借りる（analyze と同じ）。大きなマスが1つもなければ倍率 1 の代表
  if (reps.every((r) => !r.length)) return { cls, reps: sim.reps, mean: bmean };
  reps = reps.map((r, k) => {
    if (r.length) return r;
    for (let d = 1; d < K; d++) {
      if (k - d >= 0 && reps[k - d].length) return reps[k - d];
      if (k + d < K && reps[k + d].length) return reps[k + d];
    }
    return r;
  });
  return { cls, reps: reps.map((r) => Int32Array.from(r)), mean: bmean };
}

/**
 * 倍率 s の分類だけ：各マスを左上とする s×s の平均色（bmean）と、その分類（cls）を書く。
 * cand を渡すと、代表タイルの候補（s の倍数の位置の大きなマス）も集める。カメラ入力では毎世代これだけを作り直す
 */
export function classifyScale(sim, s, cls, bmean, cand = null) {
  const { cols, rows, mean, K } = sim, cen = sim.centers;
  // 積分画像（(cols+1)×(rows+1)、RGB）で s×s の和を求める
  const W1 = cols + 1, sat = new Float64Array(W1 * (rows + 1) * 3);
  for (let y = 0; y < rows; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 3, a = ((y + 1) * W1 + x + 1) * 3, u = (y * W1 + x + 1) * 3;
      r += mean[o]; g += mean[o + 1]; b += mean[o + 2];
      sat[a] = sat[u] + r; sat[a + 1] = sat[u + 1] + g; sat[a + 2] = sat[u + 2] + b;
    }
  }
  const box = (x0, y0, x1, y1, c) => sat[(y1 * W1 + x1) * 3 + c] - sat[(y0 * W1 + x1) * 3 + c] - sat[(y1 * W1 + x0) * 3 + c] + sat[(y0 * W1 + x0) * 3 + c];
  for (let y = 0; y < rows; y++) {
    const ey = Math.min(rows, y + s);
    for (let x = 0; x < cols; x++) {
      const ex = Math.min(cols, x + s);
      const n = (ey - y) * (ex - x);
      const r = box(x, y, ex, ey, 0) / n, g = box(x, y, ex, ey, 1) / n, b = box(x, y, ex, ey, 2) / n;
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dr = r - cen[k * 3], dg = g - cen[k * 3 + 1], db = b - cen[k * 3 + 2], v = dr * dr + dg * dg + db * db;
        if (v < bd) { bd = v; best = k; }
      }
      const i = y * cols + x;
      cls[i] = best;
      bmean[i * 3] = r; bmean[i * 3 + 1] = g; bmean[i * 3 + 2] = b;
      if (cand && x % s === 0 && y % s === 0 && x + s <= cols && y + s <= rows) cand[best].push([hash(sim.P.seed, i, s, 0x72657073), i]);
    }
  }
}

/**
 * 領域の倍率。hash(seed, 領域) < bigFrac の領域だけ 2 か 4（半々）。
 * 大きなマスが短いほうの辺に bigMinBlocks 個並ばないなら、小さい倍率に落とす。元写真のままの領域は 1
 * bigFrac を上げると大きなマスの領域が増えるだけで、入れ替わらない
 */
export function regionScale(sim, g) {
  const P = sim.P;
  if (g.motion === 'still' || !(g.bigU < P.bigFrac)) return 1;
  // 落とす先も候補の中から（4 → 2 → 1）
  for (let k = Math.floor(g.bigV * BIG_SCALES.length); k >= 0; k--) {
    const s = BIG_SCALES[k];
    if (Math.ceil(Math.min(g.w, g.h) / s) >= P.bigMinBlocks) return s;
  }
  return 1;
}

/**
 * 大きなマスの左上に置いた値を、中の各マスに書き写す。タイルは「左上のタイル＋中の位置」。
 * 大きなタイルがグリッドからはみ出さないよう、左上は右端・下端から s マス以内に寄せる
 * （描画は「描くタイル − 中の位置」で大きなタイルの左上を求めるので、中の各マスで必ず同じ左上になるように）。
 * 模様は大きなマスには重ねない
 */
export function fillBlocks(g, sim, next, s) {
  const { cols, rows } = sim, ns = next.state, nr = next.src, nm = next.mask;
  for (let by = g.y; by < g.y + g.h; by += s) {
    const ey = Math.min(s, g.y + g.h - by);
    for (let bx = g.x; bx < g.x + g.w; bx += s) {
      const ex = Math.min(s, g.x + g.w - bx);
      const c = by * cols + bx, st = ns[c], o = nr[c];
      const ox = Math.min(o % cols, Math.max(0, cols - s)), oy = Math.min(Math.floor(o / cols), Math.max(0, rows - s));
      for (let dy = 0; dy < ey; dy++) {
        const ty = Math.min(rows - 1, oy + dy) * cols;
        for (let dx = 0; dx < ex; dx++) {
          const i = c + dy * cols + dx;
          ns[i] = st; nr[i] = ty + Math.min(cols - 1, ox + dx); nm[i] = 0;
        }
      }
    }
  }
}

/**
 * 描く位置ごとの倍率と、大きなマスの中の位置（描画だけに使う）。
 * 値 = 倍率の番号（SCALE_LIST、下位2ビット）| 横の位置 << 2 | 縦の位置 << 4 | 欠けたマス << 6
 * （中の位置は2ビットずつなので、倍率は 4 まで）
 * 欠けたマス = 領域の右端・下端で s マスに足りない大きなマス（文字はマスいっぱいに描くと途中で切れるので、1倍で描く）
 */
export function blockCodes(sim) {
  const { cols } = sim, out = new Uint8Array(sim.cols * sim.rows);
  for (const g of sim.regions) {
    const s = g.scale, li = SCALE_LIST.indexOf(s);
    if (li <= 0) continue;
    // 欠けた大きなマスが始まる位置（そこから先の列・行。割り切れれば領域の外）
    const cutX = g.x + g.w - g.w % s, cutY = g.y + g.h - g.h % s;
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
      out[y * cols + x] = li | ((x - g.x) % s) << 2 | ((y - g.y) % s) << 4 | (x >= cutX || y >= cutY ? 1 : 0) << 6;
    }
  }
  return out;
}
