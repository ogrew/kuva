// sim.js — シミュレーション本体。映像の中身は「seed・パラメータ・世代番号」だけで決まる。
// 壁時計には依存しない（いつ step() を呼ぶかは呼び出し側が決める）。
import { mulberry32, hash } from './rng.js';
import { analyze, nearest } from './analyze.js';
import { makeRulePool, applyChaos } from './rules.js';
import { evolveRegions, initTopology } from './topology.js';
import { subdivide } from './regions.js';
import { MOTIONS, PAT_RULES } from './motions.js';
import { analyzeScale, classifyScale, regionScale } from './scale.js';

// 生成ロジックを変えたら上げる
export const ENGINE_VERSION = 4;

// E のテンポの段階：1世代あたりに進む回数。1 より大きいと1世代に複数回、1 未満なら 1/n 世代に1回
export const TEMPOS = [2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5];
export const TEMPO_LABELS = ['×2', '×1', '×1/2', '×1/3', '×1/4', '×1/5'];

// 進行方向 → 流れる向き（motions.js の g.dir と同じ：0=下へ 1=上へ 2=右へ 3=左へ）と横へのずれ（-1・0・1）。
// v・sv は行が横に並ぶ領域（g.dir が上下）、h・sh は行が縦に並ぶ領域（g.dir が左右）に使う。
// ずれの + は、縦に流れるなら右、横に流れるなら下。斜めでは、行の向き（横か縦か）は領域ごとの向きのまま残す
const dirOf = (v, sv, h, sh) => ({ v, sv, h, sh });
export const DIRECTIONS = {
  down: dirOf(0, 0, 0, 0), up: dirOf(1, 0, 1, 0), right: dirOf(2, 0, 2, 0), left: dirOf(3, 0, 3, 0),
  'down-right': dirOf(0, 1, 2, 1), 'down-left': dirOf(0, -1, 3, 1),
  'up-right': dirOf(1, 1, 2, -1), 'up-left': dirOf(1, -1, 3, -1),
};

// GUI に出さない内部値
export const ENGINE_DEFAULTS = {
  // 解析
  kmeansSamples: 20000,
  kmeansIter: 12,
  repsPerClass: 8,
  // ルール
  ruleCount: 6,        // 画像全体で使うルールの数
  rulesPerRegion: 3,   // 1領域が持つルール数（この中で切り替わる）
  pull: 0.5,           // 共有プールのルールの本来の値が I（写真へ戻る）になる割合。残りは C（保持）
  switchProb: 0.01,    // 1世代ごとのルール切替確率
  entropySwitch: 0.15, // 領域がこれより一様になったら強制切替（0〜1）
  switchCooldown: 24,  // 切替後、次の切替を禁止する世代数（ruleMorph が false のとき）
  ruleMorph: true,     // A：ルールをぱっと切り替えず、少しずつ変形させる
  morphMin: 150, morphMax: 500, // 変形にかける世代数
  holdMax: 200,        // 変形が終わってから次の変形までの最大世代数
  regionRules: true,   // B：ルールを領域ごとに作り、性格（GENRES）と写真へ戻る割合も抽選する
  inject: false,       // C：flow で、上流から写真を流し込む
  injectPeriod: 200,   // 流し込みの周期（世代）
  tempo: false,        // E：領域ごとのテンポ（何世代に1回進むか）。ときどき変わり、流れる向きも変わる
  tempoFast: 1,        // テンポの範囲（TEMPOS の番号）。最速
  tempoSlow: 4,        // 〃 最遅
  tempoHoldMin: 100, tempoHoldMax: 500, // テンポを引き直す間隔（世代）
  dirChangeProb: 0.3,  // テンポを引き直すとき、流れる向きも変える確率
  patFrac: 0,          // 模様のレイヤーを重ねる領域の割合（0 = なし。GUI の初期値は main.js）
  patMinWidth: 24,     // 模様を重ねる領域の、行の長さ（マス）の最小。小さいと三角形が育たない
  patRules: [30, 90, 110, 150], // 模様に使うルール（PAT_RULES の番号）。領域ごとにこの中からハッシュで1つ選ぶ
  bigFrac: 0,          // 大きなマス（2×2・4×4 マスを1マスとして計算する）にする領域の割合（0 = なし）
  bigMinBlocks: 4,     // 大きなマスが短いほうの辺にこれだけ並ばない領域は、小さい倍率に落とす
  stagger: 0,          // 領域が崩れ始める世代のばらつき。領域ごとに 0〜stagger 世代目まで元写真のまま待つ（0 = 一斉に始まる）
  direction: 'all',    // 進行方向 'all'（領域ごと） | DIRECTIONS のキー（上下左右・斜め4方向）。固定中は E の向き変更も効かない
  diagFrac: 0,         // All のとき、斜めに流れる領域の割合（0 = 上下左右だけ。GUI の初期値は main.js）
  patSkew: true,       // 斜めに流れる領域で、模様も一緒に斜めに流す（false なら模様はまっすぐ流れる）
  // 領域
  maxDepth: 7,
  minDepth: 2,
  stopProb: 0.25,
  minRegionFrac: 0.04,
  splitMin: 0.25, splitMax: 0.75,
  skipProb: 0.1,       // 領域を CA 処理しない確率（元写真がそのまま残る）
  topology: false,    // 局所的な分裂・合体
  topologyInterval: 80, // 領域ごとの間隔の中心値（世代）。実際は0.5〜1.5倍
  leakEnabled: false, // 隣からの漏れ
  leak: 0.6,          // 流れの入口を隣の領域へ開く割合
  motion: 'flow',
};

export class Simulation {
  /**
   * P = { seed, K, chaos, motion, ...ENGINE_DEFAULTS }
   *   motion = 'flow'（流れる） | 'ca'（その場で変化）。CA 処理する領域すべてに使う
   * io = { cols, rows, Ax, Ay, analysis: {data, stride}, cw, ch }（cw・ch = 1マスの幅・高さ px。省略時は正方形）
   */
  constructor(P, io) {
    this.P = P = { ...ENGINE_DEFAULTS, ...P };
    const { cols, rows } = io;
    this.cols = cols; this.rows = rows; this.K = P.K;
    const N = cols * rows;
    const rng = mulberry32(P.seed >>> 0);

    const a = analyze(P, io, rng);
    this.palette = a.palette; this.cls = a.cls; this.reps = a.reps; this.mean = a.mean; this.centers = a.centers;
    this.pool = makeRulePool(P.K, P.ruleCount, P.pull, rng);

    // 領域ごとに独立した乱数系列を持たせる（後で分裂・合体を足しても他の領域に影響しないように）
    this.cw = io.cw ?? 1; this.ch = io.ch ?? 1;
    // 大きなマスの解析（倍率ごと）。最初に使うときに作る（乱数は使わないので、いつ作っても同じ）
    this.scales = { 1: { cls: this.cls, reps: this.reps, mean: this.mean } };
    this.scaleVersion = 0; // 領域の倍率が変わるたびに増える（描画側が作り直しに使う）
    this.regions = subdivide(P, cols, rows, rng, this.cw, this.ch)
      .map(([x, y, w, h], r) => this.createRegion(x, y, w, h, r));
    this.nextRegionId = this.initialRegions = this.regions.length;
    this.maxRegions = Math.max(16, this.regions.length * 2);
    this.topologyEvents = { split: 0, merge: 0 };

    // 前の世代 / 次の世代。0世代は元写真そのもの（状態 = cls、タイル = 自分自身）
    const mk = () => ({ state: this.cls.slice(), src: Int32Array.from({ length: N }, (_, i) => i), mask: new Uint8Array(N) });
    this.cur = mk();
    this.nxt = mk();
    this.gen = 0;
    this.makeInk();
    this.disp = new Int32Array(N);
    this.setChaos(P.chaos);
    this.set('direction', P.direction);
    this.set('patRules', P.patRules);
  }

  // 初期領域と新しく生まれた領域で同じ初期化を使う。IDごとに独立した乱数。
  // from = 分裂・合体の元の領域。大きなマスにするかどうか（bigU・bigV）だけ引き継ぐ
  createRegion(x, y, w, h, r, from = null) {
    const P = this.P;
    const g = { index: r, x, y, w, h, rng: mulberry32(hash(P.seed, r, 0x6B757661)) };
    // 模様のレイヤー：選ばれやすさ・置き直しの間隔・ルール。乱数は使わずハッシュ
    g.patU = hash(P.seed, r, 0x706174) / 4294967296;
    g.patV = hash(P.seed, r, 0x70657231) / 4294967296;
    g.patRuleU = hash(P.seed, r, 0x72756C65) / 4294967296;
    g.patRule = 0;
    g.startU = hash(P.seed, r, 0x73746172) / 4294967296;
    g.bigU = from ? from.bigU : hash(P.seed, r, 0x62696775) / 4294967296; // 大きなマスにするか
    g.bigV = from ? from.bigV : hash(P.seed, r, 0x62696776) / 4294967296; // 〃 倍率
    g.diagU = hash(P.seed, r, 0x64696175) / 4294967296; // All のとき斜めに流れるか（diagFrac と比べる）
    g.started = false;
    g.patT = 0;
    g.motion = g.rng() < P.skipProb ? 'still' : P.motion;
    MOTIONS[g.motion].init(g, this);
    // E のテンポ用の乱数は別系列（E を切り替えても、他の乱数の流れは変わらない）
    g.trng = mulberry32(hash(P.seed, r, 0x74656D70));
    g.tempoPhase = Math.floor(g.trng() * 12);
    this.retime(g, false);
    this.rescale(g);
    // 分裂・合体の待ち時間（領域ごと。乱数は hash(seed, 領域, 回数) の別系列）
    initTopology(this, g);
    return g;
  }

  // 領域の倍率を決め直す。変わったら写真の流し込みは打ち切り、模様は種から置き直す（次の世代から反映）
  rescale(g) {
    const s = regionScale(this, g);
    if (g.scale !== undefined && s !== g.scale) { g.inj = -1; g.patReset = true; this.scaleVersion++; }
    g.scale = s;
  }

  // 次の世代から反映される
  setChaos(chaos) {
    this.P.chaos = chaos;
    applyChaos(this.pool.rules, chaos);
    for (const g of this.regions) {
      if (this.P.regionRules && g.rules) applyChaos(g.rules, chaos);
      MOTIONS[g.motion].rulesChanged?.(g);
    }
  }

  // 再生中に変えられるパラメータ（次の世代から反映）。グリッドやルールの作りに関わるものは作り直しが必要
  static LIVE = ['chaos', 'holdMax', 'morphMin', 'morphMax', 'inject', 'injectPeriod', 'tempo', 'tempoFast', 'tempoSlow', 'direction', 'patFrac', 'patRules', 'stagger', 'topology', 'topologyInterval', 'leakEnabled', 'leak', 'bigFrac', 'diagFrac', 'patSkew'];
  set(key, value) {
    if (!Simulation.LIVE.includes(key)) throw new Error(`${key} は再生中に変えられません`);
    if (key === 'topologyInterval') {
      if (!Number.isFinite(value) || value < 1) throw new Error('変化の間隔は1以上の数値にしてください');
      // 領域ごとの待ち時間の進捗を保ち、新しい間隔をすぐ反映する。
      for (const g of this.regions) g.topoWait = Math.max(1, Math.ceil(g.topoWait * value / this.P.topologyInterval));
    }
    if (key === 'chaos') this.setChaos(value);
    else this.P[key] = value;
    if (key === 'patRules') {
      // 使うルールが変わったら、領域ごとに選び直す。変わった領域は種から置き直す
      const list = value.filter((r) => r in PAT_RULES).sort((a, b) => a - b);
      this.P.patRules = list;
      for (const g of this.regions) {
        const r = list.length ? list[Math.floor(g.patRuleU * list.length)] : 0;
        if (r !== g.patRule) { g.patRule = r; g.patReset = true; }
      }
    }
    if (key === 'bigFrac') for (const g of this.regions) this.rescale(g);
    if (key === 'direction') {
      if (value !== 'all' && !(value in DIRECTIONS)) throw new Error(`direction は 'all' か ${Object.keys(DIRECTIONS).join('・')} にしてください`);
      this.fixedDir = DIRECTIONS[value]; // 'all' なら undefined
    }
    if (key === 'patSkew') for (const g of this.regions) g.patReset = true; // 古い模様は捨てて種から置き直す
    if (key === 'tempoFast' || key === 'tempoSlow') {
      // 範囲の外にいる領域は、すぐ範囲内に寄せる
      const [lo, hi] = this.tempoRange();
      for (const g of this.regions) g.level = Math.min(hi, Math.max(lo, g.level));
    }
  }

  // E：テンポを引き直す（乱数は毎回4つずつ消費する）
  retime(g, turn = true) {
    const P = this.P, r = g.trng;
    const [lo, hi] = this.tempoRange();
    g.level = lo + Math.floor(r() * (hi - lo + 1));
    const u = r(), d = Math.floor(r() * 4);
    if (turn && g.dir !== undefined && u < P.dirChangeProb && d !== g.dir) { g.dir = d; g.inj = -1; }
    g.tempoLeft = P.tempoHoldMin + Math.floor(r() * (P.tempoHoldMax - P.tempoHoldMin));
  }

  // 大きなマスの領域（倍率 s）は s 世代に1回進む（画面上の流れる速さを他の領域とそろえる）。
  // テンポ（E）とは掛け合わせる：1世代あたり a/b 回進む。進む回数は (gen + tempoPhase) で決め、乱数は使わない
  stepBig(g, m) {
    let a = 1, b = g.scale;
    if (this.P.tempo) {
      if (--g.tempoLeft <= 0) this.retime(g);
      const r = TEMPOS[g.level];
      if (r >= 1) a = r; else b *= Math.round(1 / r);
    }
    const t = this.gen + g.tempoPhase, n = Math.floor(((t + 1) * a) / b) - Math.floor((t * a) / b);
    if (!n) { MOTIONS.still.step(g, this, this.cur, this.nxt); return; } // この世代は進まない
    for (let k = 0; k < n; k++) {
      if (k > 0) MOTIONS.still.step(g, this, this.nxt, this.cur);
      m.step(g, this, this.cur, this.nxt);
    }
  }

  /**
   * カメラ入力（段階2）：マスごとの平均色を差し替え、パレットは固定のまま分類（cls。I が指す写真の状態）を作り直す。
   * 大きなマスの分類も作り直す。代表タイルは変えない。乱数は使わない（何世代目に何を渡したかが同じなら同じ映像）。
   * 一度も CA にかかっていない領域（崩れ始める前・最初から元写真のまま）は、状態も新しい分類にそろえる（写真がそのまま映っているため）。
   * 分裂・合体でできた元写真のままの領域は、運ばれたタイルと状態を持っているので触らない。
   * mean = cols×rows×3 の平均色。次の世代から反映される
   */
  setColors(mean) {
    const { K, centers: cen } = this, N = this.cols * this.rows;
    this.mean.set(mean);
    for (let i = 0; i < N; i++) this.cls[i] = nearest(this.mean, i, cen, K);
    for (const s of Object.keys(this.scales)) {
      if (+s === 1) continue;
      const d = this.scales[s];
      classifyScale(this, +s, d.cls, d.mean);
    }
    const { state: st, src } = this.cur, cols = this.cols;
    for (const g of this.regions) {
      if (g.started && !(g.motion === 'still' && g.index < this.initialRegions)) continue;
      for (let y = g.y; y < g.y + g.h; y++) for (let i = y * cols + g.x, e = i + g.w; i < e; i++) if (src[i] === i) st[i] = this.cls[i];
    }
  }

  // 倍率 s の解析（{ cls, reps }）
  scaleData(s) { return this.scales[s] ??= analyzeScale(this, s); }

  tempoRange() {
    const n = TEMPOS.length - 1, a = Math.round(this.P.tempoFast), b = Math.round(this.P.tempoSlow);
    return [Math.max(0, Math.min(n, Math.min(a, b))), Math.max(0, Math.min(n, Math.max(a, b)))];
  }

  step() {
    if (this.P.topology) evolveRegions(this);
    // ×2 の途中結果は cur に書き戻されるため、領域外は世代開始時の写しだけ読む。
    if (this.P.leakEnabled && this.P.leak > 0) {
      this.boundary ??= { state: new Uint8Array(this.cur.state.length), src: new Int32Array(this.cur.src.length) };
      this.boundary.state.set(this.cur.state);
      this.boundary.src.set(this.cur.src);
    }
    for (const g of this.regions) {
      const m = MOTIONS[g.motion];
      // 崩れ始める前は元写真のまま待つ。一度始まった領域は、stagger をあとで上げても止まらない
      if (!g.started) {
        if (this.gen < Math.floor(g.startU * this.P.stagger)) { MOTIONS.still.step(g, this, this.cur, this.nxt); continue; }
        g.started = true;
      }
      if (g.scale > 1) { this.stepBig(g, m); continue; }
      if (!this.P.tempo || g.motion === 'still') { m.step(g, this, this.cur, this.nxt); continue; }
      if (--g.tempoLeft <= 0) this.retime(g);
      const rate = TEMPOS[g.level];
      if (rate >= 1) {
        // 1世代に rate 回進む。領域外の読み取りは boundary に固定し、領域内の途中結果だけ cur に書き戻す
        for (let k = 0; k < rate; k++) {
          if (k > 0) MOTIONS.still.step(g, this, this.nxt, this.cur);
          m.step(g, this, this.cur, this.nxt);
        }
      } else if ((this.gen + g.tempoPhase) % Math.round(1 / rate) === 0) m.step(g, this, this.cur, this.nxt);
      else MOTIONS.still.step(g, this, this.cur, this.nxt); // この世代は進まない：前の世代のまま
    }
    const t = this.cur; this.cur = this.nxt; this.nxt = t;
    this.gen++;
  }

  // 現在の世代で各セルに描く写真タイルの番号
  get src() { return this.cur.src; }

  // 模様を描くタイル（inkTile、セルごと）：領域の写真が明るければ暗い状態（0）の、暗ければ明るい状態（K-1）の代表タイル
  makeInk() {
    const N = this.cols * this.rows, K = this.K;
    this.inkTile = new Int32Array(N);
    for (const g of this.regions) {
      let lum = 0;
      for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
        const c = (y * this.cols + x) * 3;
        lum += 0.2126 * this.mean[c] + 0.7152 * this.mean[c + 1] + 0.0722 * this.mean[c + 2];
      }
      const k = lum / (g.w * g.h) > 110 ? 0 : K - 1, tile = this.reps[k][0];
      for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) {
        this.inkTile[y * this.cols + x] = tile;
      }
    }
  }

  // 描画に渡すタイル番号（返す配列は使い回す）。模様が 1 のマスは、ink = 'tile' なら inkTile、
  // 'invert' なら ~src（負の数。シェーダはそのマスの色を反転して描く）。それ以外は src そのもの
  displaySrc(ink = 'tile') {
    const { src, mask } = this.cur, d = this.disp;
    if (ink === 'invert') for (let i = 0; i < d.length; i++) d[i] = mask[i] ? ~src[i] : src[i];
    else for (let i = 0; i < d.length; i++) d[i] = mask[i] ? this.inkTile[i] : src[i];
    return d;
  }
}
