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
  const sorted = Float32Array.from(lum).sort();
  const th = Array.from({ length: 9 }, (_, k) => sorted[Math.floor(((k + 1) * N) / 10)]);
  for (let i = 0; i < N; i++) {
    let d = 0;
    while (d < 9 && lum[i] >= th[d]) d++;
    out[i] = d;
  }
  return out;
}
