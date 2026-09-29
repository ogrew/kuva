// digits.js — マスに重ねる数字（描画だけに効く賑やかし）
// 数字は写真タイルごとに1つ（同じ柄なら同じ数字）。乱数は使わない。決め方：
//   'lum'   : 平均色の明るさ順。写真ごとに、どの数字もほぼ同じ数ずつ出るよう分位で10段階に区切る（暗い = 0）
//   'state' : K色の分類（CA の状態）。K が 11 以上なら一の位（11 → 1）

export const DIGIT_MODES = ['lum', 'state'];

/**
 * sim = { mean（セルごとの平均色。長さ = セル数 × 3）, cls（セルごとの状態） }
 * 戻り値：Uint8Array（長さ = セル数）。タイル番号ごとの数字 0〜9
 */
export function tileDigits(sim, mode = 'lum') {
  const { mean, cls } = sim, N = cls.length, out = new Uint8Array(N);
  if (mode === 'state') {
    for (let i = 0; i < N; i++) out[i] = cls[i] % 10;
    return out;
  }
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.2126 * mean[i * 3] + 0.7152 * mean[i * 3 + 1] + 0.0722 * mean[i * 3 + 2];
  // 区切り：明るさを並べて 10% ごとの値。同じ明るさのタイルは必ず同じ数字になる
  const th = quantiles(lum, Array.from({ length: 9 }, (_, k) => Math.floor(((k + 1) * N) / 10)));
  for (let i = 0; i < N; i++) {
    let d = 0;
    while (d < 9 && lum[i] >= th[d]) d++;
    out[i] = d;
  }
  return out;
}

// 並べたときの ranks 番目の値（ranks は小さい順。全体を並べたのと同じ結果）。カメラ入力では毎フレーム呼ぶので、
// 全体は並べずにヒストグラムで該当する区間を探し、その区間の値だけを並べる
const BINS = 4096;
function quantiles(v, ranks) {
  const N = v.length;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
  if (!(hi > lo)) return ranks.map(() => lo);
  const k = BINS / (hi - lo), bin = (x) => Math.min(BINS - 1, Math.floor((x - lo) * k));
  const cnt = new Int32Array(BINS);
  for (let i = 0; i < N; i++) cnt[bin(v[i])]++;
  // 各 rank が入る区間 at[r] と、その区間より前の個数 before[r]
  const at = [], before = [], vals = new Map();
  for (let b = 0, c = 0, r = 0; r < ranks.length; c += cnt[b++]) {
    for (; r < ranks.length && ranks[r] < c + cnt[b]; r++) { at.push(b); before.push(c); vals.set(b, []); }
  }
  for (let i = 0; i < N; i++) vals.get(bin(v[i]))?.push(v[i]);
  for (const a of vals.values()) a.sort((x, y) => x - y);
  return ranks.map((r, j) => vals.get(at[j])[r - before[j]]);
}
