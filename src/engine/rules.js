// rules.js — ルール表のプール
// 近傍 (L, C, R) + 元写真の状態 I → 次の状態。サイズ K^4。添字は ((L*K + C)*K + R)*K + I。
//
// chaos を再生中に変えられるように、各項目は「本来の値」「固定の乱数 u」「ランダムな状態」を持ち、
// 表は  u < chaos ? ランダムな状態 : 本来の値  で組み直す。
// chaos を変えても乱数の消費は変わらないので、同じ操作をすれば同じ映像になる。

/**
 * 本来の値は項目ごとに、確率 pull で I（写真へ戻る）、それ以外は C（保持）。
 * I だけだと毎世代すぐ写真に戻ってちらつくだけになり、C だけだと崩れがたまる一方になる。
 */
export function makeRulePool(K, count, pull, rng) {
  const E = K * K * K * K;
  const rules = [];
  for (let r = 0; r < count; r++) {
    const base = new Uint8Array(E), rnd = new Uint8Array(E), u = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const I = e % K, C = Math.floor(e / (K * K)) % K;
      base[e] = rng() < pull ? I : C;
      u[e] = rng();
      rnd[e] = Math.floor(rng() * K);
    }
    rules.push({ base, rnd, u, table: new Uint8Array(E) });
  }
  return { K, E, rules };
}

export function applyChaos(pool, chaos) {
  for (const { base, rnd, u, table } of pool.rules) {
    for (let e = 0; e < pool.E; e++) table[e] = u[e] < chaos ? rnd[e] : base[e];
  }
}
