// motions.js — 領域の「動き方」
// 各動き方は init(region, sim) と step(region, sim, prev, next)、必要なら rulesChanged(region) を持つ。
//   prev / next = { state, src }（前の世代 / 次の世代。書き込みは領域内だけ）
//   漏れの読み取りだけは sim.boundary（世代開始時の写し）から領域外を参照する。
// 乱数は region.rng（領域ごとに独立した系列）だけを使い、1世代あたりの消費量を一定にする。
// → 他の領域の有無や、動き方の中身に関係なく、領域ごとの乱数列がずれない。
import { hash } from './rng.js';
import { makeRule, GENRES } from './rules.js';
import { fillBlocks } from './scale.js';

// 元写真のまま（CA 処理しない領域）
const still = {
  init() {},
  step(g, sim, prev, next) {
    const { cols } = sim;
    for (let y = g.y; y < g.y + g.h; y++) {
      const a = y * cols + g.x, b = a + g.w;
      next.state.set(prev.state.subarray(a, b), a);
      next.src.set(prev.src.subarray(a, b), a);
      next.mask.set(prev.mask.subarray(a, b), a);
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
  g.inj = -1; // 写真の流し込みの進み具合（-1 = 流し込み中でない）
  g.injPhase = hash(P.seed, g.index, 0x696E6A) % 1000003; // 流し込みの時期のずれ（乱数を消費しない）
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
 * 大きなマスの領域（g.scale = s > 1）は、s×s マスを1マスとして同じ計算をする。値は大きなマスの左上に書き、
 * 最後に中の各マスへ書き写す（fillBlocks）。分類・代表タイルは倍率ごとのもの。模様は重ねない
 */
function stepLines(g, sim, prev, next, flow) {
  const { cols, K } = sim;
  const sc = g.scale ?? 1;
  const { cls, reps } = sim.scaleData(sc);
  const bSrc = sc === 1 ? g.bSrc : reps[g.bVal][0];
  const rule = g.table;
  const { x, y, w, h } = g;
  const bw = Math.ceil(w / sc), bh = Math.ceil(h / sc); // 大きなマスの数（端は欠けたまま）
  // 実際に流れる向き：進行方向が固定されていればそれ、ALL なら領域の向き
  const dir = sim.fixedDir ?? g.dir;
  // 向きが変わったら流し込みは打ち切り、模様は種から置き直す
  let turned = false;
  if (dir !== g.lastDir) { turned = g.lastDir !== undefined; g.lastDir = dir; g.inj = -1; }
  const vertical = dir < 2; // 下・上へ流れる = 1行が横に並ぶ
  const lineLen = vertical ? bw : bh, lineCount = vertical ? bh : bw;
  // start：先頭の行の0番目のセル、di：行内で隣へ進む差、dt：下流の行へ進む差、dt1：dt の向きに1マス
  const start = dir === 0 ? y * cols + x : dir === 1 ? (y + (bh - 1) * sc) * cols + x : dir === 2 ? y * cols + x : y * cols + (x + (bw - 1) * sc);
  const di = vertical ? sc : sc * cols;
  const dt1 = dir === 0 ? cols : dir === 1 ? -cols : dir === 2 ? 1 : -1, dt = dt1 * sc;
  const ps = prev.state, pr = prev.src, ns = next.state, nr = next.src;
  const hist = g.hist;
  hist.fill(0);
  const inj = flow ? injectRow(g, sim, lineCount) : -1;
  // 流し込み中は、写真が入ってきた部分（先頭から j 行）をルールをかけずにそのまま運ぶ。
  // 1マス流れるたびにルールをかけると、写真の帯が先頭から数マスで崩れて見えなくなるため
  const j = inj >= 0 ? lineCount - 1 - inj : -1;

  for (let t = 0; t < lineCount; t++) {
    // 前の世代のどの行を見るか（自分からの差）。flow の先頭の行は末尾の行（循環）、
    // 写真の流し込み中は元写真の行 inj を読む
    const photo = t === 0 && inj >= 0;
    const up = !flow ? 0 : t > 0 ? dt : -(photo ? inj : lineCount - 1) * dt;
    const raw = t <= j;
    for (let i = 0, c = start + t * dt; i < lineLen; i++, c += di) {
      const u = c - up;
      // 上流の境界を部分的に開く。行の幅を4等分した帯ごとに、24世代保って開閉を決める（点状のちらつきを避ける。大きなマスの領域は大きなマスの数で4等分）。
      // 写真を復元している最中は写真を優先する。画面外にはつながない。
      if (flow && t === 0 && !raw && sim.P.leakEnabled && sim.P.leak > 0) {
        const outside = dir === 0 ? y > 0 : dir === 1 ? y + h < sim.rows : dir === 2 ? x > 0 : x + w < cols;
        const open = hash(sim.P.seed, g.index, Math.floor(i * 4 / lineLen), Math.floor(sim.gen / 24)) / 4294967296 < sim.P.leak;
        if (outside && open) {
          const n = c - dt1;
          ns[c] = sim.boundary.state[n]; nr[c] = sim.boundary.src[n];
          hist[ns[c]]++;
          continue;
        }
      }
      if (raw) {
        const o = photo ? cls[u] : ps[u];
        ns[c] = o; nr[c] = photo ? u : pr[u];
        hist[o]++;
        continue;
      }
      let L, sL, C, sC, R, sR;
      if (photo) {
        // 元写真（状態 = cls、タイル = 自分自身）
        C = cls[u]; sC = u;
        if (i > 0) { L = cls[u - di]; sL = u - di; } else { L = g.bVal; sL = bSrc; }
        if (i < lineLen - 1) { R = cls[u + di]; sR = u + di; } else { R = g.bVal; sR = bSrc; }
      } else {
        C = ps[u]; sC = pr[u];
        if (i > 0) { L = ps[u - di]; sL = pr[u - di]; } else { L = g.bVal; sL = bSrc; }
        if (i < lineLen - 1) { R = ps[u + di]; sR = pr[u + di]; } else { R = g.bVal; sR = bSrc; }
      }
      const I = cls[c];
      const o = rule[((L * K + C) * K + R) * K + I];
      // 写真タイルの出どころを伝播させる → 「同じマス目が繰り返される」
      let s;
      if (o === C) s = sC;           // 前の世代のタイルを引き継ぐ（flow なら上流から流れてくる）
      else if (o === I) s = c;       // 本来その場所にある写真
      else if (o === L) s = sL;
      else if (o === R) s = sR;
      else { const rr = reps[o]; s = rr[hash(c, o) % rr.length]; } // 代表タイル（決定的に選ぶ）
      ns[c] = o; nr[c] = s;
      hist[o]++;
    }
  }
  if (sc > 1) { fillBlocks(g, sim, next, sc); g.patT = 0; }
  else if (flow) stepPattern(g, sim, prev.mask, next.mask, start, di, dt, lineLen, lineCount, turned);
  if (g.morph) morphRule(g, sim, lineLen * lineCount);
  else switchRule(g, sim, lineLen * lineCount);
}

// 模様のルール（ウルフラムの基本セルオートマトンの番号）と、種の置き方
//   one    : 先頭の行の真ん中に1個。三角形が端に届く前に置き直す（90・150 はフラクタル、30 はカオスの三角形）
//   random : 先頭の行にランダムにばらまく。置き直すのは始めたときと向きが変わったときだけ（110 は粒が走る）。
//            行の両端はつなげる（端を 0 で閉じると、1 が端から抜けていくルールでは、しばらくすると何もなくなる）
// ルール18 は、種が1個だと 90 とまったく同じ模様になるので外した。縞のルール184 は不採用
export const PAT_RULES = { 30: 'one', 90: 'one', 110: 'random', 150: 'one' };

/**
 * 模様のレイヤー。写真のタイルを運ぶ CA とは別に、2状態（0/1）の基本セルオートマトンを重ねる。
 * 先頭の行だけが時間とともにルールで変化し、下流の行はそのまま運ぶ → 領域の中を時空図（kivi の静止画と同じもの）がスクロールする。
 * 種の置き方はルールごと（PAT_RULES）。真ん中に1個のときは、三角形が領域の端に届く前（領域の幅の 0.3〜0.5倍の回数だけ進んだら）に
 * 置き直す。端に届くと壁で跳ね返って模様が埋まり、市松模様のかたまりになってしまうため。
 * 模様が 1 のマスは、描画で領域ごとの1枚のタイルに置き換わる（CA の状態・タイルには影響しない）。乱数は使わずハッシュ
 */
function stepPattern(g, sim, pm, nm, start, di, dt, lineLen, lineCount, turned) {
  const P = sim.P;
  const on = g.patU < P.patFrac && lineLen >= P.patMinWidth && g.patRule > 0;
  const zero = (t0) => { for (let t = t0; t < lineCount; t++) for (let i = 0; i < lineLen; i++) nm[start + t * dt + i * di] = 0; };
  if (!on) { zero(0); g.patT = 0; return; }
  const period = Math.max(12, Math.round(lineLen * (0.3 + 0.2 * g.patV)));
  if (turned || g.patReset) { zero(1); g.patT = 0; g.patReset = false; } // 向き・ルールが変わったら、古い模様は捨てる
  else for (let t = lineCount - 1; t >= 1; t--) for (let i = 0; i < lineLen; i++) nm[start + t * dt + i * di] = pm[start + (t - 1) * dt + i * di];
  const rule = g.patRule, mid = Math.floor(lineLen / 2), one = PAT_RULES[rule] === 'one';
  const reseed = one ? g.patT % period === 0 : g.patT === 0;
  for (let i = 0; i < lineLen; i++) {
    const u = start + i * di;
    if (reseed) { nm[u] = one ? (i === mid ? 1 : 0) : hash(P.seed, g.index, g.lastDir, i) & 1; continue; }
    const L = i > 0 ? pm[u - di] : one ? 0 : pm[start + (lineLen - 1) * di];
    const R = i < lineLen - 1 ? pm[u + di] : one ? 0 : pm[start];
    nm[u] = (rule >> ((L << 2) | (pm[u] << 1) | R)) & 1;
  }
  g.patT++;
}

/**
 * C：上流から写真を流し込む。period 世代ごと（領域ごとに時期をずらす）に始まり、lineCount 世代続く。
 * 流し込みの j 世代目は、元写真の行 lineCount-1-j を先頭の行へ入れる
 * → 写真の末尾の行から順に滑り込み、流し込み終わると写真がちょうど元の位置に並ぶ。そこからまた崩れ始める。
 * 戻り値：この世代に先頭へ入れる元写真の行（流し込み中でなければ -1）。乱数は使わない
 */
function injectRow(g, sim, lineCount) {
  const P = sim.P;
  if (!P.inject) { g.inj = -1; g.injEpoch = undefined; return -1; }
  const period = Math.max(1, Math.round(P.injectPeriod));
  // 周期の区切りをまたいだら始める（テンポ E で進まない世代があっても取りこぼさないように）
  const epoch = Math.floor((sim.gen + g.injPhase) / period);
  if (g.injEpoch === undefined) g.injEpoch = Math.floor((sim.gen + g.injPhase - 1) / period);
  if (epoch !== g.injEpoch) { g.injEpoch = epoch; g.inj = 0; }
  if (!(g.inj >= 0 && g.inj < lineCount)) { g.inj = -1; return -1; }
  return lineCount - 1 - g.inj++;
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
    const lo = Math.min(P.morphMin, P.morphMax), hi = Math.max(P.morphMin, P.morphMax);
    m.len = Math.max(1, Math.round(lo + u * (hi - lo)));
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
