// analyze.js — 写真の解析（kivi engine.js の computeLayout 1〜3 を流用）
// セル平均色 → k-means で K色パレット（輝度順）→ 各セルを状態に分類 → 状態ごとの代表タイル

/**
 * P = { K, kmeansSamples, kmeansIter, repsPerClass }
 * io = { cols, rows, Ax, Ay, analysis: {data, stride} }（解析用画像：1セル = Ax×Ay px）
 * rng：呼び出し側の乱数（消費順は常に同じ）
 * 戻り値 { palette, cls, reps, mean }
 */
export function analyze(P, io, rng) {
  const { cols, rows, Ax, Ay, analysis } = io;
  const N = cols * rows;
  const K = P.K;
  const ri = (n) => Math.floor(rng() * n);

  // ============ 1. セルごとの平均色 ============
  const mean = new Float32Array(N * 3);
  {
    const d = analysis.data, st = analysis.stride, aa = Ax * Ay;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let r = 0, g = 0, b = 0;
        for (let y = 0; y < Ay; y++) {
          let o = ((cy * Ay + y) * st + cx * Ax) * 4;
          for (let x = 0; x < Ax; x++, o += 4) { r += d[o]; g += d[o + 1]; b += d[o + 2]; }
        }
        const i = (cy * cols + cx) * 3;
        mean[i] = r / aa; mean[i + 1] = g / aa; mean[i + 2] = b / aa;
      }
    }
  }

  // ============ 2. k-means で K色パレット抽出 ============
  const cen = new Float32Array(K * 3);
  {
    const S = Math.min(N, P.kmeansSamples);
    const samp = new Int32Array(S);
    for (let s = 0; s < S; s++) samp[s] = S === N ? s : ri(N);
    const dist2 = (i, k) => {
      const a = i * 3, c = k * 3;
      const dr = mean[a] - cen[c], dg = mean[a + 1] - cen[c + 1], db = mean[a + 2] - cen[c + 2];
      return dr * dr + dg * dg + db * db;
    };
    // k-means++ 初期化
    const setCen = (k, i) => { cen[k * 3] = mean[i * 3]; cen[k * 3 + 1] = mean[i * 3 + 1]; cen[k * 3 + 2] = mean[i * 3 + 2]; };
    setCen(0, samp[ri(S)]);
    const dmin = new Float32Array(S).fill(Infinity);
    for (let k = 1; k < K; k++) {
      let sum = 0;
      for (let s = 0; s < S; s++) { const v = dist2(samp[s], k - 1); if (v < dmin[s]) dmin[s] = v; sum += dmin[s]; }
      let t = rng() * sum, pick = samp[S - 1];
      for (let s = 0; s < S; s++) { t -= dmin[s]; if (t <= 0) { pick = samp[s]; break; } }
      setCen(k, pick);
    }
    const acc = new Float64Array(K * 4);
    for (let it = 0; it < P.kmeansIter; it++) {
      acc.fill(0);
      for (let s = 0; s < S; s++) {
        const i = samp[s];
        let best = 0, bd = Infinity;
        for (let k = 0; k < K; k++) { const v = dist2(i, k); if (v < bd) { bd = v; best = k; } }
        acc[best * 4] += mean[i * 3]; acc[best * 4 + 1] += mean[i * 3 + 1]; acc[best * 4 + 2] += mean[i * 3 + 2]; acc[best * 4 + 3]++;
      }
      for (let k = 0; k < K; k++) {
        const n = acc[k * 4 + 3];
        if (n > 0) { cen[k * 3] = acc[k * 4] / n; cen[k * 3 + 1] = acc[k * 4 + 1] / n; cen[k * 3 + 2] = acc[k * 4 + 2] / n; }
        else setCen(k, samp[ri(S)]); // 空クラスタは再シード
      }
    }
    // 輝度順に並べ替え（状態番号 0 = 暗い … K-1 = 明るい）
    const luma = (k) => 0.2126 * cen[k * 3] + 0.7152 * cen[k * 3 + 1] + 0.0722 * cen[k * 3 + 2];
    const order = [...Array(K).keys()].sort((a, b) => luma(a) - luma(b));
    const tmp = Float32Array.from(cen);
    order.forEach((k, j) => { cen[j * 3] = tmp[k * 3]; cen[j * 3 + 1] = tmp[k * 3 + 1]; cen[j * 3 + 2] = tmp[k * 3 + 2]; });
  }
  const palette = new Uint8Array(K * 3);
  for (let j = 0; j < K * 3; j++) palette[j] = Math.round(cen[j]);

  // ============ 3. 各セルを状態に分類 + 代表タイル ============
  const cls = new Uint8Array(N);
  const reps = Array.from({ length: K }, () => []);
  {
    const seen = new Int32Array(K);
    const R = P.repsPerClass;
    for (let i = 0; i < N; i++) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dr = mean[i * 3] - cen[k * 3], dg = mean[i * 3 + 1] - cen[k * 3 + 1], db = mean[i * 3 + 2] - cen[k * 3 + 2];
        const v = dr * dr + dg * dg + db * db;
        if (v < bd) { bd = v; best = k; }
      }
      cls[i] = best;
      // リザーバサンプリングで各状態の「代表タイル」を数個選ぶ
      const n = ++seen[best];
      if (reps[best].length < R) reps[best].push(i);
      else { const j = ri(n); if (j < R) reps[best][j] = i; }
    }
    // 空の状態は輝度が近い状態の代表を借りる
    for (let k = 0; k < K; k++) {
      if (reps[k].length) continue;
      for (let d = 1; d < K; d++) {
        if (k - d >= 0 && reps[k - d].length) { reps[k] = reps[k - d].slice(); break; }
        if (k + d < K && reps[k + d].length) { reps[k] = reps[k + d].slice(); break; }
      }
    }
  }

  return { palette, cls, reps: reps.map((r) => Int32Array.from(r)), mean };
}
