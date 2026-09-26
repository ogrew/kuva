// sim.js — シミュレーション本体。映像の中身は「seed・パラメータ・世代番号」だけで決まる。
// 壁時計には依存しない（いつ step() を呼ぶかは呼び出し側が決める）。
import { mulberry32, hash } from './rng.js';
import { analyze } from './analyze.js';
import { makeRulePool, applyChaos } from './rules.js';
import { subdivide } from './regions.js';
import { MOTIONS } from './motions.js';

// 生成ロジックを変えたら上げる
export const ENGINE_VERSION = 1;

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
  ruleMorph: true,     // 実験 A：ルールをぱっと切り替えず、少しずつ変形させる
  morphMin: 150, morphMax: 500, // 変形にかける世代数
  holdMax: 200,        // 変形が終わってから次の変形までの最大世代数
  regionRules: true,   // 実験 B：ルールを領域ごとに作り、性格（GENRES）と写真へ戻る割合も抽選する
  inject: false,       // 実験 C：flow で、上流から写真を流し込む
  injectPeriod: 600,   // 流し込みの周期（世代）
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
   * io = { cols, rows, Ax, Ay, analysis: {data, stride} }
   */
  constructor(P, io) {
    this.P = P = { ...ENGINE_DEFAULTS, ...P };
    const { cols, rows } = io;
    this.cols = cols; this.rows = rows; this.K = P.K;
    const N = cols * rows;
    const rng = mulberry32(P.seed >>> 0);

    const a = analyze(P, io, rng);
    this.palette = a.palette; this.cls = a.cls; this.reps = a.reps;
    this.pool = makeRulePool(P.K, P.ruleCount, P.pull, rng);

    // 領域ごとに独立した乱数系列を持たせる（後で分裂・合体を足しても他の領域に影響しないように）
    this.regions = subdivide(P, cols, rows, rng).map(([x, y, w, h], r) => {
      const g = { index: r, x, y, w, h, rng: mulberry32(hash(P.seed, r, 0x6B757661)) };
      g.motion = g.rng() < P.skipProb ? 'still' : P.motion;
      MOTIONS[g.motion].init(g, this);
      return g;
    });

    // 前の世代 / 次の世代。0世代は元写真そのもの（状態 = cls、タイル = 自分自身）
    const mk = () => ({ state: this.cls.slice(), src: Int32Array.from({ length: N }, (_, i) => i) });
    this.cur = mk();
    this.nxt = mk();
    this.gen = 0;
    this.setChaos(P.chaos);
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
  static LIVE = ['chaos', 'holdMax', 'morphMin', 'morphMax', 'inject', 'injectPeriod'];
  set(key, value) {
    if (!Simulation.LIVE.includes(key)) throw new Error(`${key} は再生中に変えられません`);
    if (key === 'chaos') this.setChaos(value);
    else this.P[key] = value;
  }

  step() {
    for (const g of this.regions) MOTIONS[g.motion].step(g, this, this.cur, this.nxt);
    const t = this.cur; this.cur = this.nxt; this.nxt = t;
    this.gen++;
  }

  // 現在の世代で各セルに描く写真タイルの番号
  get src() { return this.cur.src; }
}
