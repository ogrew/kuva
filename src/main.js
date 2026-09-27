// main.js — 画像の読み込み、GUI、キー操作、再生ループ
import { Pane } from 'tweakpane';
import { Simulation, TEMPOS, TEMPO_LABELS } from './engine/sim.js';
import { PAT_RULES } from './engine/motions.js';
import { flatColors } from './engine/flat.js';
import { loadBitmap, gridLayout, paddedCanvas, scaledCanvas, pixelsOf } from './image.js';
import { Renderer } from './render/renderer.js';

const CONFIG = {
  seed: 12345,
  cellSize: 24,   // 1マスの幅（元写真の px）
  cellAspect: 4,  // 1マスの高さの比率（ASPECTS の番号）。高さ = 幅 × 比率。4 = 1:1
  K: 7,           // 状態数 = パレット色数
  chaos: 0.1,     // ルール表に混ぜる完全ランダムの割合（即時反映）
  gps: 12,        // 世代/秒（即時反映）
  motion: 'flow', // 動き方 'flow'（流れる） | 'ca'（その場で変化）
  direction: 'all', // 進行方向 'all'（領域ごと） | 'down' | 'up' | 'right' | 'left'（即時反映）
  flatRatio: 0,   // 塗りつぶし：元の位置にないタイルのうち、一色で塗る割合（0 = 塗らない。即時反映）
  flatUnit: 'tile', // 塗り方 'tile'（マスごと） | 'state'（似た色ごと）
  flatColor: 'palette', // 塗りの色 'palette'（代表色） | 'mean'（平均色）
  // ---- 変化（時間とともに映像を変える仕組み）----
  flavor: 'morph',        // ルールの味付け（FLAVORS）。変えると最初から作り直し
  holdMax: 200,           // A：変形が終わってから次の変形までの最大世代数（即時反映）
  morphMin: 150,          // A：変形にかける世代数の最短（即時反映）
  morphMax: 500,          // A：〃 最長（即時反映）
  inject: true,           // C：写真を流し込む（即時反映。流れるのときだけ効く）
  injectPeriod: 200,      // C：流し込みの周期（世代）（即時反映）
  tempo: false,           // E：領域ごとのテンポ（即時反映）
  tempoFast: 1,           // E：テンポの範囲 最速（TEMPOS の番号。即時反映）
  tempoSlow: 4,           // E：〃 最遅
  // ---- 模様（基本セルオートマトンの模様を重ねる）----
  patFrac: 0.2,           // 模様のレイヤーを重ねる領域の割合（即時反映）
  patRules: [30, 90, 110, 150], // 模様に使うルール（即時反映）
  fit: 'contain', // 'contain' = 全体を収める（余白） / 'cover' = 埋める（切り取り）
};
// ルールの味付け → エンジンの設定
const FLAVORS = {
  'none':         { ruleMorph: false, regionRules: false },
  'morph':        { ruleMorph: true,  regionRules: false },
  'region':       { ruleMorph: false, regionRules: true },
  'morph+region': { ruleMorph: true,  regionRules: true },
};
// マスの高さ比率の段階（高さ = 幅 × p）。kivi と同じ
// cellSize の範囲は写真の短辺に対する割合で決める（写真が変わると範囲も変わる）
//   最小：短辺の 0.5%（短辺が約200マス。写真の大きさに関係なくマスの数が一定になり、重さも一定）
//   最大：短辺の 12.5%（短辺が8マス。これより粗いと領域に分けたときに CA らしさが出にくい）
const CELL_MIN_FRAC = 0.005, CELL_MAX_FRAC = 0.125, CELL_MIN_PX = 4;
const cellRange = () => {
  if (!bitmap) return { min: 12, max: 128 };
  const s = Math.min(bitmap.width, bitmap.height);
  const min = Math.max(CELL_MIN_PX, Math.round(s * CELL_MIN_FRAC));
  return { min, max: Math.max(min + 1, Math.round(s * CELL_MAX_FRAC)) };
};
const ASPECTS = [
  { p: 1 / 5, label: '1/5' }, { p: 1 / 4, label: '1/4' }, { p: 1 / 3, label: '1/3' },
  { p: 1 / 2, label: '1/2' }, { p: 1, label: '1' }, { p: 2, label: '2' },
  { p: 3, label: '3' }, { p: 4, label: '4' }, { p: 5, label: '5' },
];
const cellDims = () => {
  const { min, max } = cellRange();
  const cw = Math.min(max, Math.max(min, Math.round(CONFIG.cellSize)));
  const a = ASPECTS[Math.round(CONFIG.cellAspect)] || ASPECTS[4];
  return { cw, ch: Math.max(2, Math.round(cw * a.p)), label: a.label };
};
// サイトを開いたときにランダムに決めるもの：seed、K、動き方、cellSize
// cellSize は写真の短辺の 1%〜6%（対数で一様）。範囲いっぱい（0.5%〜12.5%）だと粗すぎて写真が分からない回が多いため。
// 写真の大きさが分かるのは最初の写真を読み込んだときなので、割合だけ先に決めておく
const RANDOM_K = [4, 10], RANDOM_CELL_FRAC = [0.01, 0.06];
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
CONFIG.seed = Math.floor(Math.random() * 1e6);
CONFIG.K = Math.floor(rand(RANDOM_K[0], RANDOM_K[1] + 1));
CONFIG.motion = Math.random() < 0.5 ? 'flow' : 'ca';
let pendingCellFrac = Math.exp(rand(Math.log(RANDOM_CELL_FRAC[0]), Math.log(RANDOM_CELL_FRAC[1])));
const ANALYSIS_SUB = 4;     // 平均色の解析解像度（1マスを最大 N×N px で見る）
const MAX_STEPS_PER_FRAME = 8; // 追いつけない分は捨てる（ゆっくりになるだけで、世代の中身は変わらない）

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas);

let bitmap = null, imgName = '';
let sim = null;
let playing = true;
let acc = 0;          // 次の世代までの端数（世代単位）
let status = 'Drop an image';
let uiVisible = true;

// ---------- 作り直し ----------
function rebuild() {
  if (!bitmap) return;
  const t0 = performance.now();
  const { cw, ch } = cellDims();
  const g = gridLayout(bitmap.width, bitmap.height, cw, ch);
  if (g.cols < 4 || g.rows < 4) { status = 'Cells too large (lower Cell size or Aspect)'; return; }
  const padded = paddedCanvas(bitmap, g);
  const Ax = Math.max(1, Math.min(ANALYSIS_SUB, cw)), Ay = Math.max(1, Math.min(ANALYSIS_SUB, ch));
  const analysis = { data: pixelsOf(scaledCanvas(padded, g.cols * Ax, g.rows * Ay)), stride: g.cols * Ax };
  const P = { seed: CONFIG.seed, K: CONFIG.K, motion: CONFIG.motion, ...FLAVORS[CONFIG.flavor] };
  for (const k of Simulation.LIVE) P[k] = CONFIG[k];
  sim = new Simulation(P, { cols: g.cols, rows: g.rows, Ax, Ay, analysis, cw, ch });

  // 写真テクスチャは長辺を上限まで縮小する
  const k = Math.min(1, renderer.maxPhotoSize / Math.max(g.GW, g.GH));
  const photo = k < 1 ? scaledCanvas(padded, Math.round(g.GW * k), Math.round(g.GH * k)) : padded;
  renderer.setPhoto(g, photo);
  showSim();
  updateFlat();
  acc = 0;
  status = `Built in ${Math.round(performance.now() - t0)} ms`;
}

// 今の世代を描画に渡す（模様のレイヤーを重ねたタイル番号）
const showSim = () => renderer.setSrc(sim.displaySrc());

// 塗りつぶしの色を作り直して描画に渡す（描画だけに効くので、作り直しは不要）
function updateFlat() {
  if (!sim) return;
  renderer.setFlat(CONFIG.flatRatio > 0 ? flatColors(sim, CONFIG.flatRatio, CONFIG.flatUnit, CONFIG.flatColor) : null);
}

// 読み込みの順番。読み込み中に別の写真がドロップされたら、古いほうの結果は捨てる
let loadSeq = 0;
async function loadImage(blob, name, seq = ++loadSeq, done = '') {
  try {
    status = 'Loading…';
    const bm = await loadBitmap(blob);
    if (seq !== loadSeq) return;
    bitmap = bm;
    imgName = name;
    if (pendingCellFrac) { // 最初の写真だけ、cellSize をランダムに決める
      CONFIG.cellSize = Math.round(pendingCellFrac * Math.min(bm.width, bm.height));
      pendingCellFrac = 0;
    }
    updateCellRange();
    aspectName();
    rebuild();
    if (done) status = done;
  } catch (e) {
    console.error(e);
    if (seq === loadSeq) status = 'Could not load the image';
  }
}

async function loadURL(url, name, done) {
  const seq = ++loadSeq;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    await loadImage(await r.blob(), name, seq, done);
  } catch (e) {
    console.error(e);
    if (seq === loadSeq) status = `Could not load ${name}`;
  }
}

// サンプル画像（samples/ にあるもの）。一覧はビルド時に作られるので、画像を足すだけで候補に入る
const SAMPLES = Object.entries(import.meta.glob('/samples/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }))
  .map(([path, url]) => ({ name: path.split('/').pop(), url }));

// ---------- 再生ループ ----------
// 映像の中身は世代番号だけで決まる。壁時計は「いつ step するか」にしか使わない
let lastT = performance.now();
let rate = { t: lastT, n: 0 }; // 実測の世代/秒（0.5秒ごとに stats.rate を更新）
function frame(t) {
  const dt = Math.min(0.25, (t - lastT) / 1000);
  lastT = t;
  if (sim && playing) {
    acc += dt * CONFIG.gps;
    let n = 0;
    while (acc >= 1 && n < MAX_STEPS_PER_FRAME) { sim.step(); acc -= 1; n++; }
    if (acc >= 1) acc = 0;
    if (n) showSim();
    rate.n += n;
  }
  if (t - rate.t >= 500) { stats.rate = (rate.n * 1000) / (t - rate.t); rate.t = t; rate.n = 0; }

  renderer.draw(CONFIG.fit);
  updateInfo();
  requestAnimationFrame(frame);
}

// 「状態」パネルに出す値（モニターが定期的に読む）
function updateInfo() {
  stats.status = status;
  stats.play = !sim ? '―' : playing ? 'Playing' : 'Paused';
  stats.gen = sim ? sim.gen : 0;
  if (sim) {
    const { cw, ch } = renderer.grid;
    stats.grid = `${sim.cols}×${sim.rows} (cell ${cw}×${ch}px)`;
    stats.regions = sim.regions.length;
    stats.seed = sim.P.seed;
    stats.image = `${imgName} ${bitmap.width}×${bitmap.height}`;
  }
}

// ---------- GUI（Tweakpane v4） ----------
const pane = new Pane({ title: 'kuva' });
// パネルの先頭：名前と一行の説明。タイトルバー（押すと畳める）を大きくして、説明を足す
{
  const bar = pane.element.querySelector('.tp-rotv_b');
  bar.classList.add('head');
  bar.insertAdjacentHTML('beforeend', '<span class="sub">PHOTO × 1D CELLULAR AUTOMATA</span>');
}
// コードから CONFIG を書き換えたら guiSync() を呼ぶ。pane.refresh() は change イベントを出すので、その間は処理を止める
let guiSyncing = false;
function guiSync() {
  guiSyncing = true;
  pane.refresh();
  guiSyncing = false;
}
const num = (f, key, label, min, max, step) => f.addBinding(CONFIG, key, { label, min, max, step });
const list = (f, key, label, options) => f.addBinding(CONFIG, key, { label, options });
// 作り直し：スライダーは離したとき（ev.last）だけ。即時：動かしている間も反映する
const onRebuild = (b, also) => b.on('change', (ev) => { if (guiSyncing) return; also?.(); if (ev.last) rebuild(); });
const onLive = (b, key, also) => b.on('change', (ev) => { if (guiSyncing) return; if (sim) sim.set(key, ev.value); also?.(); });
const tip = (b, text) => { b.element.title = text; };


// 状態（読み取り専用のモニター。左下の別パネル）
const stats = { status: '', play: '―', gen: 0, rate: 0, grid: '―', regions: 0, seed: 0, image: '―' };
const statPane = new Pane({ title: 'Status', container: document.getElementById('stat') });
const mon = (key, label, opts = {}) => statPane.addBinding(stats, key, { label, readonly: true, ...opts });
mon('status', 'Message');
mon('play', 'State');
mon('gen', 'Gen', { format: (v) => String(Math.round(v)) });
mon('rate', 'Gen/s', { format: (v) => v.toFixed(1) });
mon('rate', '', { view: 'graph', min: 0, max: 60 });
mon('grid', 'Grid');
mon('regions', 'Regions', { format: (v) => String(Math.round(v)) });
mon('seed', 'Seed', { format: (v) => String(Math.round(v)) });
mon('image', 'Image');

// Grid（グリッドと状態数。すべて作り直し）
const f1 = pane.addFolder({ title: 'Grid' });
tip(onRebuild(num(f1, 'seed', 'Seed', 0, 999999, 1)), 'Random seed. Same image, parameters and seed give the same video');
let cCell = null;
// cellSize のスライダーを今の写真の範囲で作り直す（Tweakpane はあとから min・max を変えられないので、同じ位置に作り直す）。
// 範囲の外にある値は範囲内に寄せる
function updateCellRange() {
  const { min, max } = cellRange();
  CONFIG.cellSize = Math.min(max, Math.max(min, Math.round(CONFIG.cellSize)));
  let index;
  if (cCell) { index = f1.children.indexOf(cCell); cCell.dispose(); }
  cCell = f1.addBinding(CONFIG, 'cellSize', { label: 'Cell size', min, max, step: 1, index });
  onRebuild(cCell, () => aspectName()); // aspectName はこの下で定義される
  tip(cCell, `Cell width in image px (${min}–${max}: 0.5%–12.5% of the short side). The range changes with the image`);
}
updateCellRange();
// 高さ比：番号のスライダー。表示名に今の比率と高さを出す
const cAspect = num(f1, 'cellAspect', '', 0, ASPECTS.length - 1, 1);
const aspectName = () => { const d = cellDims(); cAspect.label = `Aspect ×${d.label} (${d.cw}×${d.ch})`; };
onRebuild(cAspect, aspectName);
tip(cAspect, 'Cell height = width × 1/5 … 5');
aspectName();
tip(onRebuild(num(f1, 'K', 'Colors', 2, 12, 1)), 'Number of states (K). Cells are clustered into K colors by k-means');

// Motion（動き方と速さ）
const f2 = pane.addFolder({ title: 'Motion' });
tip(onRebuild(list(f2, 'motion', 'Motion', { 'Flow': 'flow', 'In place': 'ca' })),
  'Flow: the space-time diagram flows through each region\nIn place: each row changes in place as a 1D CA (for comparison)');
const cDir = list(f2, 'direction', 'Direction', { 'All': 'all', 'Down': 'down', 'Up': 'up', 'Right': 'right', 'Left': 'left' });
onLive(cDir, 'direction');
tip(cDir, 'All: each region flows its own way (changes now and then with Region tempo)\nOthers: every region flows that way');
tip(onLive(num(f2, 'chaos', 'Chaos', 0, 1, 0.01), 'chaos'), 'Share of fully random entries mixed into the rule tables');
tip(num(f2, 'gps', 'Speed', 0.5, 60, 0.5), 'Generations per second'); // 再生ループが毎フレーム読む

// Render（描画だけに効く。作り直し不要）
const f3 = pane.addFolder({ title: 'Render' });
tip(list(f3, 'fit', 'Fit', { 'Contain': 'contain', 'Cover': 'cover' }), 'Contain: fit the whole image (letterbox)\nCover: fill the screen (crop)');
const cFlat = num(f3, 'flatRatio', 'Flat fill', 0, 1, 0.01);
const cFlatSub = [
  list(f3, 'flatUnit', '　└ Group', { 'Per tile': 'tile', 'Per color': 'state' }),
  list(f3, 'flatColor', '　└ Color', { 'Palette': 'palette', 'Mean': 'mean' }),
];
tip(cFlat, 'Share of carried cells (photo tiles away from their original place) painted in a flat color instead. 0 = off');
tip(cFlatSub[0], 'Per tile: decide for each photo tile\nPer color: paint all tiles of the same K color together');
tip(cFlatSub[1], 'Palette: the K color the tile belongs to\nMean: the tile\'s own average color');
const refreshFlat = () => cFlatSub.forEach((c) => { c.hidden = !(CONFIG.flatRatio > 0); });
[cFlat, ...cFlatSub].forEach((c) => c.on('change', () => { refreshFlat(); updateFlat(); }));
refreshFlat();

// Evolve（時間とともに映像を変える仕組み）
const fx = pane.addFolder({ title: 'Evolve' });
const cFlavor = list(fx, 'flavor', 'Rule mode', {
  'Switch': 'none', 'Morph': 'morph', 'Per region': 'region', 'Morph + region': 'morph+region',
});
tip(cFlavor, 'Switch: swap rules at once\nMorph: blend into the next rule over hundreds of generations\nPer region: each region gets its own rules\nMorph + region: both');
const cMorph = [
  num(fx, 'holdMax', '　└ Hold max', 0, 2000, 10),
  num(fx, 'morphMin', '　└ Morph min', 1, 3000, 10),
  num(fx, 'morphMax', '　└ Morph max', 1, 3000, 10),
];
cMorph.forEach((c) => onLive(c, c.key));
tip(cMorph[0], 'Longest hold between morphs (generations)');
tip(cMorph[1], 'Shortest morph (generations)');
tip(cMorph[2], 'Longest morph (generations)');
const cInject = fx.addBinding(CONFIG, 'inject', { label: 'Reinject' });
tip(cInject, 'Flow only. Periodically feeds the photo in from upstream, staggered per region');
const cPeriod = num(fx, 'injectPeriod', '　└ Period', 20, 600, 10);
tip(cPeriod, 'Reinject period (generations)');
onLive(cPeriod, 'injectPeriod');
const cTempo = fx.addBinding(CONFIG, 'tempo', { label: 'Region tempo' });
tip(cTempo, 'Each region runs at its own speed, which changes every 100–500 generations. The flow direction sometimes changes too');
const cTempoRange = ['tempoFast', 'tempoSlow'].map((k) => num(fx, k, '', 0, TEMPOS.length - 1, 1));
const tempoName = () => {
  cTempoRange[0].label = `　└ Fastest ${TEMPO_LABELS[CONFIG.tempoFast]}`;
  cTempoRange[1].label = `　└ Slowest ${TEMPO_LABELS[CONFIG.tempoSlow]}`;
};
cTempoRange.forEach((c) => onLive(c, c.key, tempoName));
tempoName();
const refreshFx = () => {
  cMorph.forEach((c) => { c.hidden = !FLAVORS[CONFIG.flavor].ruleMorph; });
  cPeriod.hidden = !CONFIG.inject;
  cTempoRange.forEach((c) => { c.hidden = !CONFIG.tempo; });
};
onRebuild(cFlavor, refreshFx);
onLive(cInject, 'inject', refreshFx);
onLive(cTempo, 'tempo', refreshFx);
refreshFx();

// Pattern（基本セルオートマトンの模様を重ねる）
const fe = pane.addFolder({ title: 'Pattern' });
const cPat = num(fe, 'patFrac', 'Amount', 0, 1, 0.01);
onLive(cPat, 'patFrac');
tip(cPat, 'Share of regions (rows of 24+ cells) overlaid with an elementary CA pattern, drawn with one photo tile per region. Pick the rules below');
// 模様に使うルール：ルールごとのチェックボックス。各領域は ON のルールの中から1つ選ぶ
const patOn = Object.fromEntries(Object.keys(PAT_RULES).map((r) => [r, CONFIG.patRules.includes(+r)]));
for (const r of Object.keys(PAT_RULES)) {
  const c = fe.addBinding(patOn, r, { label: `　└ Rule ${r}` });
  c.on('change', () => {
    CONFIG.patRules = Object.keys(patOn).filter((k) => patOn[k]).map(Number);
    if (sim) sim.set('patRules', CONFIG.patRules);
  });
}

// キー操作の一覧（パネルの一番下。ボタンは置かず、操作はキーだけ）
pane.addBlade({ view: 'separator' });
{
  const keys = document.createElement('dl');
  keys.className = 'keys';
  for (const [k, v] of [['Space', 'PLAY / PAUSE'], ['N', 'NEW SEED'], ['R', 'RESET'], ['F', 'FULLSCREEN'], ['H', 'HIDE GUI']]) {
    keys.insertAdjacentHTML('beforeend', `<dt>${k}</dt><dd>${v}</dd>`);
  }
  // パネルの中身の入れ物に入れる（タイトルを押して畳んだときに一緒に隠れるように）
  pane.element.querySelector('.tp-rotv_c').appendChild(keys);
}

function newSeed() {
  CONFIG.seed = Math.floor(Math.random() * 1e6);
  guiSync();
  rebuild();
}

function togglePlay() { setPlaying(!playing); }
const AUTO_PAUSED = 'Paused (tab hidden)';
function setPlaying(v) {
  playing = v;
  if (playing && status === AUTO_PAUSED) status = '';
}

// タブが見えなくなったら（タブの切り替え・最小化など）一時停止する。見えるようになっても自動では再開しない。
// ウィンドウのフォーカスが外れただけ（blur）では止めない：2画面目に映しながら別のアプリを触ることがあるため
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) {
    setPlaying(false);
    status = AUTO_PAUSED;
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((e) => { status = `Fullscreen failed (${e.message})`; });
}

function toggleUI() {
  uiVisible = !uiVisible;
  pane.hidden = !uiVisible;
  statPane.hidden = !uiVisible;
  document.body.classList.toggle('bare', !uiVisible);
}

// ---------- キー操作 ----------
window.addEventListener('keydown', (e) => {
  const el = document.activeElement, tag = el && el.tagName;
  // 文字を入力する欄だけは、キー操作を奪わない（チェックボックスを触ったあとでも H や Space は効くように）
  if ((tag === 'INPUT' && el.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (tag === 'INPUT') el.blur();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // GUI のボタンにフォーカスが残っていると、Space でそのボタンも押されてしまうので外す
  if (tag === 'BUTTON') document.activeElement.blur();
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') toggleUI();
  else if (k === 'n') newSeed();
  else if (k === 'r') rebuild();
});

// ---------- D&D ----------
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!f.type.startsWith('image/')) { status = 'Drop an image file'; return; }
  loadImage(f, f.name);
});

// 最初の写真：?img=URL があればそれ（開発用）、なければサンプル画像からランダムに1枚
const q = new URLSearchParams(location.search).get('img');
if (q) loadURL(q, q.split('/').pop());
else if (SAMPLES.length) {
  const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  loadURL(s.url, s.name, 'Sample (drop to replace)');
}

requestAnimationFrame(frame);
