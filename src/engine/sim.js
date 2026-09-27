// sim.js — シミュレーション本体。映像の中身は「seed・パラメータ・世代番号」だけで決まる。
// 壁時計には依存しない（いつ step() を呼ぶかは呼び出し側が決める）。
import { mulberry32, hash } from './rng.js';
import { analyze } from './analyze.js';
import { makeRulePool, applyChaos } from './rules.js';
import { subdivide } from './regions.js';
import { MOTIONS, PAT_RULES } from './motions.js';

// 生成ロジックを変えたら上げる
export const ENGINE_VERSION = 1;

// E のテンポの段階：1世代あたりに進む回数。1 より大きいと1世代に複数回、1 未満なら 1/n 世代に1回
export const TEMPOS = [2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5];
export const TEMPO_LABELS = ['×2', '×1', '×1/2', '×1/3', '×1/4', '×1/5'];

// 進行方向 → 向きの番号（motions.js の g.dir と同じ：0=下へ 1=上へ 2=右へ 3=左へ）
export const DIRECTIONS = { down: 0, up: 1, right: 2, left: 3 };

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
  patFrac: 0,          // 実験：模様のレイヤーを重ねる領域の割合（0 = なし）
  patMinWidth: 24,     // 模様を重ねる領域の、行の長さ（マス）の最小。小さいと三角形が育たない
  patRules: [30, 90, 110, 150], // 模様に使うルール（PAT_RULES の番号）。領域ごとにこの中からハッシュで1つ選ぶ
  direction: 'all',    // 進行方向 'all'（領域ごと） | 'down' | 'up' | 'right' | 'left'。固定中は E の向き変更も効かない
  // 領域
  maxDepth: 7,
  minDepth: 2,
  stopProb: 0.25,
  minRegionFrac: 0.04,
  splitMin: 0.25, splitMax: 0.75,
  skipProb: 0.1,       // 領域を CA 処理しない確率（元写真がそのまま残る）
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
    this.palette = a.palette; this.cls = a.cls; this.reps = a.reps; this.mean = a.mean;
    this.pool = makeRulePool(P.K, P.ruleCount, P.pull, rng);

    // 領域ごとに独立した乱数系列を持たせる（後で分裂・合体を足しても他の領域に影響しないように）
    this.regions = subdivide(P, cols, rows, rng, io.cw ?? 1, io.ch ?? 1).map(([x, y, w, h], r) => {
      const g = { index: r, x, y, w, h, rng: mulberry32(hash(P.seed, r, 0x6B757661)) };
      // 模様のレイヤー（実験）：選ばれやすさ・置き直しの間隔・ルール。乱数は使わずハッシュ
      g.patU = hash(P.seed, r, 0x706174) / 4294967296;
      g.patV = hash(P.seed, r, 0x70657231) / 4294967296;
      g.patRuleU = hash(P.seed, r, 0x72756C65) / 4294967296;
      g.patRule = 0;
      g.patT = 0;
      g.motion = g.rng() < P.skipProb ? 'still' : P.motion;
      MOTIONS[g.motion].init(g, this);
      // E のテンポ用の乱数は別系列（E を切り替えても、他の乱数の流れは変わらない）
      g.trng = mulberry32(hash(P.seed, r, 0x74656D70));
      g.tempoPhase = Math.floor(g.trng() * 12);
      this.retime(g, false);
      return g;
    });

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
  static LIVE = ['chaos', 'holdMax', 'morphMin', 'morphMax', 'inject', 'injectPeriod', 'tempo', 'tempoFast', 'tempoSlow', 'direction', 'patFrac', 'patRules'];
  set(key, value) {
    if (!Simulation.LIVE.includes(key)) throw new Error(`${key} は再生中に変えられません`);
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
    if (key === 'direction') this.fixedDir = DIRECTIONS[value]; // 'all' なら undefined
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

  tempoRange() {
    const n = TEMPOS.length - 1, a = Math.round(this.P.tempoFast), b = Math.round(this.P.tempoSlow);
    return [Math.max(0, Math.min(n, Math.min(a, b))), Math.max(0, Math.min(n, Math.max(a, b)))];
  }

  step() {
    for (const g of this.regions) {
      const m = MOTIONS[g.motion];
      if (!this.P.tempo || g.motion === 'still') { m.step(g, this, this.cur, this.nxt); continue; }
      if (--g.tempoLeft <= 0) this.retime(g);
      const rate = TEMPOS[g.level];
      if (rate >= 1) {
        // 1世代に rate 回進む。領域は自分のセルしか読まないので、途中の結果を cur に書き戻して続けてよい
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

  // 描画に渡すタイル番号。模様が 1 のマスは inkTile、それ以外は src そのもの（返す配列は使い回す）
  displaySrc() {
    const { src, mask } = this.cur, d = this.disp;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? this.inkTile[i] : src[i];
    return d;
  }
}
