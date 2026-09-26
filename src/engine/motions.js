// motions.js — 領域の「動き方」
// 各動き方は init(region, sim) と step(region, sim, prev, next)、必要なら rulesChanged(region) を持つ。
//   prev / next = { state, src }（前の世代 / 次の世代。領域のセルだけ読み書きする）
// 乱数は region.rng（領域ごとに独立した系列）だけを使い、1世代あたりの消費量を一定にする。
// → 他の領域の有無や、動き方の中身に関係なく、領域ごとの乱数列がずれない。
import { hash } from './rng.js';
import { makeRule, GENRES } from './rules.js';

// 元写真のまま（CA 処理しない領域）
const still = {
  init() {},
  step(g, sim, prev, next) {
    const { cols } = sim;
    for (let y = g.y; y < g.y + g.h; y++) {
      const a = y * cols + g.x, b = a + g.w;
      next.state.set(prev.state.subarray(a, b), a);
      next.src.set(prev.src.subarray(a, b), a);
    }
  },
};

// ca と flow で共通の初期化。どちらでも乱数の消費は同じ（同じ seed なら同じ領域・ルールで見比べられる）
function initLines(g, sim) {
  const { K, reps, pool, P } = sim;
  const rng = g.rng, ri = (n) => Math.floor(rng() * n);
  g.dir = ri(4);          // 0=下へ 1=上へ 2=右へ 3=左へ（flow の流れる向き。ca では行か列かだけに効く）
  g.bVal = ri(K);         // 行の端の外側にある固定値
  g.bSrc = reps[g.bVal][0];
  if (P.regionRules) {
    // B：ルールを領域ごとに作る。性格と写真へ戻る割合も領域ごと（ルールごと）に抽選
    g.rules = [];
    for (let k = 0; k < P.rulesPerRegion; k++) g.rules.push(makeRule(K, GENRES[ri(GENRES.length)], 0.1 + 0.8 * rng(), rng));
  } else {
    // 画像全体で共有するプールから選ぶ
    const n = Math.min(P.rulesPerRegion, pool.rules.length);
    const idx = [...Array(pool.rules.length).keys()];
    g.rules = [];
    for (let k = 0; k < n; k++) g.rules.push(pool.rules[idx.splice(ri(idx.length), 1)[0]]);
  }
  g.rk = 0;
  g.cooldown = 0;
  g.hist = new Int32Array(K);
  g.table = g.rules[0].table;
  if (P.ruleMorph) {
    // A：ルール表の項目を、この順番で少しずつ次のルールの値に置き換えていく
    const E = pool.E, order = Int32Array.from({ length: E }, (_, i) => i);
    for (let i = E - 1; i > 0; i--) { const j = ri(i + 1), t = order[i]; order[i] = order[j]; order[j] = t; }
    g.table = new Uint8Array(E); // 実際に引く表（変形の途中の状態）。中身は rulesChanged で作る
    g.morph = { order, target: -1, t: 0, len: 0, k: 0, hold: Math.floor(rng() * P.holdMax) };
  }
}

// ルール表の中身が変わった（chaos の変更）→ 変形の途中の表を作り直す
function rulesChanged(g) {
  const m = g.morph;
  if (!m) return;
  g.table.set(g.rules[g.rk].table);
  if (m.target < 0) return;
  const to = g.rules[m.target].table;
  for (let j = 0; j < m.k; j++) { const e = m.order[j]; g.table[e] = to[e]; }
}

/**
 * 領域を「行」の束として1世代進める。
 * flow = false：各行は自分自身の前の世代から次を決める（案C：その場で変化）
 * flow = true ：各行は1つ上流の行の前の世代から次を決める。先頭の行の上流は末尾の行（ぐるっと循環）
 *               → 模様が1世代に1マスずつ流れていき、流れながらルールで形が変わる。
 *                 領域全体は kivi の時空図が流れ続けているのと同じになる。
 *               先頭の行を自分自身から決めると、数百世代で先頭が落ち着き、領域全体が止まってしまう
 */
function stepLines(g, sim, prev, next, flow) {
  const { cols, K, cls, reps } = sim;
  const rule = g.table;
  const { x, y, w, h, dir } = g;
  const vertical = dir < 2; // 下・上へ流れる = 1行が横に並ぶ
  const lineLen = vertical ? w : h, lineCount = vertical ? h : w;
  // start：先頭の行の0番目のセル、di：行内で隣へ進む差、dt：下流の行へ進む差
  const start = dir === 0 ? y * cols + x : dir === 1 ? (y + h - 1) * cols + x : dir === 2 ? y * cols + x : y * cols + (x + w - 1);
  const di = vertical ? 1 : cols;
  const dt = dir === 0 ? cols : dir === 1 ? -cols : dir === 2 ? 1 : -1;
  const ps = prev.state, pr = prev.src, ns = next.state, nr = next.src;
  const hist = g.hist;
  hist.fill(0);

  for (let t = 0; t < lineCount; t++) {
    // 前の世代のどの行を見るか（自分からの差）
    const up = !flow ? 0 : t > 0 ? dt : -(lineCount - 1) * dt;
    for (let i = 0, c = start + t * dt; i < lineLen; i++, c += di) {
      const u = c - up;
      let L, sL, R, sR;
      if (i > 0) { L = ps[u - di]; sL = pr[u - di]; } else { L = g.bVal; sL = g.bSrc; }
      if (i < lineLen - 1) { R = ps[u + di]; sR = pr[u + di]; } else { R = g.bVal; sR = g.bSrc; }
      const C = ps[u], I = cls[c];
      const o = rule[((L * K + C) * K + R) * K + I];
      // 写真タイルの出どころを伝播させる → 「同じマス目が繰り返される」
      let s;
      if (o === C) s = pr[u];        // 前の世代のタイルを引き継ぐ（flow なら上流から流れてくる）
      else if (o === I) s = c;       // 本来その場所にある写真
      else if (o === L) s = sL;
      else if (o === R) s = sR;
      else { const rr = reps[o]; s = rr[hash(c, o) % rr.length]; } // 代表タイル（決定的に選ぶ）
      ns[c] = o; nr[c] = s;
      hist[o]++;
    }
  }
  if (g.morph) morphRule(g, sim, lineLen * lineCount);
  else switchRule(g, sim, lineLen * lineCount);
}

// 領域のエントロピー（0〜1。0 = 一色）
function entropy(g, K, n) {
  let H = 0;
  for (let k = 0; k < K; k++) if (g.hist[k]) { const p = g.hist[k] / n; H -= p * Math.log2(p); }
  return H / Math.log2(K);
}

// ルール切替：一様になりすぎた（エントロピー低下）or 確率的に。乱数は毎世代2つずつ必ず消費する
function switchRule(g, sim, n) {
  const { K, P } = sim;
  const u = g.rng(), v = g.rng();
  if (g.cooldown > 0) { g.cooldown--; return; }
  if (g.rules.length < 2) return;
  if (entropy(g, K, n) < P.entropySwitch || u < P.switchProb) {
    g.rk = (g.rk + 1 + Math.floor(v * (g.rules.length - 1))) % g.rules.length;
    g.table = g.rules[g.rk].table;
    g.cooldown = P.switchCooldown;
  }
}

// A：ルールの変形。「保持」→「数百世代かけて次のルールへ置き換え」→「保持」… を繰り返す。
// 保持中でも、一様になりすぎたらすぐ次の変形を始める。乱数は毎世代2つずつ必ず消費する
function morphRule(g, sim, n) {
  const { K, P } = sim, m = g.morph;
  const u = g.rng(), v = g.rng();
  if (g.rules.length < 2) return;
  if (m.target < 0) {
    if (m.hold > 0 && entropy(g, K, n) >= P.entropySwitch) { m.hold--; return; }
    m.target = (g.rk + 1 + Math.floor(v * (g.rules.length - 1))) % g.rules.length;
    m.len = Math.round(P.morphMin + u * (P.morphMax - P.morphMin));
    m.t = 0; m.k = 0;
    return;
  }
  m.t++;
  const E = g.table.length, k = Math.min(E, Math.floor((E * m.t) / m.len));
  const to = g.rules[m.target].table;
  for (let j = m.k; j < k; j++) { const e = m.order[j]; g.table[e] = to[e]; }
  m.k = k;
  if (m.t >= m.len) { g.rk = m.target; m.target = -1; m.hold = Math.floor(u * P.holdMax); }
}

// 案C：各行（または列）が独立した1D CA。CA の世代 = 映像の世代
const ca = { init: initLines, rulesChanged, step: (g, sim, prev, next) => stepLines(g, sim, prev, next, false) };
// 流れる：kivi の時空図が、領域の中を一方向に流れ続ける
const flow = { init: initLines, rulesChanged, step: (g, sim, prev, next) => stepLines(g, sim, prev, next, true) };

export const MOTIONS = { still, ca, flow };
