// main.js — 画像の読み込み、GUI、キー操作、再生ループ
import { Pane } from 'tweakpane';
import { Simulation, TEMPOS, TEMPO_LABELS } from './engine/sim.js';
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
  // ---- 実験（見比べ用）----
  flavor: 'morph+region', // ルールの味付け（FLAVORS）。変えると最初から作り直し
  holdMax: 200,           // A：変形が終わってから次の変形までの最大世代数（即時反映）
  morphMin: 150,          // A：変形にかける世代数の最短（即時反映）
  morphMax: 500,          // A：〃 最長（即時反映）
  inject: false,          // C：上流から写真を流し込む（即時反映。流れるのときだけ効く）
  injectPeriod: 200,      // C：流し込みの周期（世代）（即時反映）
  tempo: false,           // E：領域ごとのテンポ（即時反映）
  tempoFast: 1,           // E：テンポの範囲 最速（TEMPOS の番号。即時反映）
  tempoSlow: 4,           // E：〃 最遅
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
const CELL_MIN = 12, CELL_MAX = 128; // cellSize の範囲（px）
const ASPECTS = [
  { p: 1 / 5, label: '1/5' }, { p: 1 / 4, label: '1/4' }, { p: 1 / 3, label: '1/3' },
  { p: 1 / 2, label: '1/2' }, { p: 1, label: '1' }, { p: 2, label: '2' },
  { p: 3, label: '3' }, { p: 4, label: '4' }, { p: 5, label: '5' },
];
const cellDims = () => {
  const cw = Math.min(CELL_MAX, Math.max(CELL_MIN, Math.round(CONFIG.cellSize)));
  const a = ASPECTS[Math.round(CONFIG.cellAspect)] || ASPECTS[4];
  return { cw, ch: Math.max(2, Math.round(cw * a.p)), label: a.label };
};
const ANALYSIS_SUB = 4;     // 平均色の解析解像度（1マスを最大 N×N px で見る）
const MAX_STEPS_PER_FRAME = 8; // 追いつけない分は捨てる（ゆっくりになるだけで、世代の中身は変わらない）

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas);

let bitmap = null, imgName = '';
let sim = null;
let playing = true;
let acc = 0;          // 次の世代までの端数（世代単位）
let status = '写真をドロップしてください';
let uiVisible = true;

// ---------- 作り直し ----------
function rebuild() {
  if (!bitmap) return;
  const t0 = performance.now();
  const { cw, ch } = cellDims();
  const g = gridLayout(bitmap.width, bitmap.height, cw, ch);
  if (g.cols < 4 || g.rows < 4) { status = 'マスが大きすぎます（cellSize か高さ比を下げてください）'; return; }
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
  renderer.setSrc(sim.src);
  updateFlat();
  acc = 0;
  status = `初期処理 ${Math.round(performance.now() - t0)}ms`;
}

// 塗りつぶしの色を作り直して描画に渡す（描画だけに効くので、作り直しは不要）
function updateFlat() {
  if (!sim) return;
  renderer.setFlat(CONFIG.flatRatio > 0 ? flatColors(sim, CONFIG.flatRatio, CONFIG.flatUnit, CONFIG.flatColor) : null);
}

async function loadImage(blob, name) {
  try {
    status = '読み込み中…';
    bitmap = await loadBitmap(blob);
    imgName = name;
    rebuild();
  } catch (e) {
    console.error(e);
    status = '画像を読み込めませんでした';
  }
}

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
    if (n) renderer.setSrc(sim.src);
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
  stats.play = !sim ? '―' : playing ? '再生中' : '一時停止';
  stats.gen = sim ? sim.gen : 0;
  if (sim) {
    const { cw, ch } = renderer.grid;
    stats.grid = `${sim.cols}×${sim.rows}（cell ${cw}×${ch}px）`;
    stats.regions = sim.regions.length;
    stats.seed = sim.P.seed;
    stats.image = `${imgName} ${bitmap.width}×${bitmap.height}`;
  }
}

// ---------- GUI（Tweakpane v4） ----------
const pane = new Pane({ title: 'kuva' });
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
const statPane = new Pane({ title: '状態', container: document.getElementById('stat') });
const mon = (key, label, opts = {}) => statPane.addBinding(stats, key, { label, readonly: true, ...opts });
mon('status', 'メッセージ');
mon('play', '再生');
mon('gen', '世代', { format: (v) => String(Math.round(v)) });
mon('rate', '世代/秒（実測）', { format: (v) => v.toFixed(1) });
mon('rate', '', { view: 'graph', min: 0, max: 60 });
mon('grid', 'grid');
mon('regions', '領域', { format: (v) => String(Math.round(v)) });
mon('seed', 'seed', { format: (v) => String(Math.round(v)) });
mon('image', '写真');

// 基本
const f1 = pane.addFolder({ title: '基本' });
onRebuild(num(f1, 'seed', 'seed', 0, 999999, 1));
const cCell = num(f1, 'cellSize', 'cellSize (幅px)', CELL_MIN, CELL_MAX, 1);
// 高さ比：番号のスライダー。表示名に今の比率と高さを出す
const cAspect = num(f1, 'cellAspect', '', 0, ASPECTS.length - 1, 1);
const aspectName = () => { const d = cellDims(); cAspect.label = `高さ比 ×${d.label}（${d.cw}×${d.ch}px）`; };
onRebuild(cCell, aspectName);
onRebuild(cAspect, aspectName);
aspectName();
onRebuild(num(f1, 'K', 'K (色数)', 2, 12, 1));
onRebuild(list(f1, 'motion', '動き方', { '流れる': 'flow', 'その場で変化': 'ca' }));
const cDir = list(f1, 'direction', '進行方向', { 'ALL': 'all', '下': 'down', '上': 'up', '右': 'right', '左': 'left' });
onLive(cDir, 'direction');
tip(cDir, 'ALL：領域ごとに違う向き（E では、ときどき変わる）／それ以外：全領域をその向きに流す');
onLive(num(f1, 'chaos', 'chaos (ランダム混入)', 0, 1, 0.01), 'chaos');
num(f1, 'gps', '世代/秒', 0.5, 60, 0.5); // 再生ループが毎フレーム読む

// 描画（描画だけに効く。作り直し不要）
const f2 = pane.addFolder({ title: '描画' });
list(f2, 'fit', '縦横比', { '全体を収める': 'contain', '埋める': 'cover' });
const cFlat = num(f2, 'flatRatio', '塗りつぶし割合', 0, 1, 0.01);
const cFlatSub = [
  list(f2, 'flatUnit', '　└ 塗り方', { 'マスごと': 'tile', '似た色ごと': 'state' }),
  list(f2, 'flatColor', '　└ 塗りの色', { '代表色': 'palette', '平均色': 'mean' }),
];
tip(cFlat, 'CA で運ばれてきたマス（元の位置にない写真タイル）のうち、写真の代わりに一色で塗る割合。0 なら塗らない');
tip(cFlatSub[0], 'マスごと：写真タイルごとに、塗るかどうかを決める\n似た色ごと：K色に分けたとき同じ色になるタイルを、まとめて塗る');
tip(cFlatSub[1], '代表色：K色のうち、そのタイルが属する色\n平均色：そのタイル自身の平均の色');
const refreshFlat = () => cFlatSub.forEach((c) => { c.hidden = !(CONFIG.flatRatio > 0); });
[cFlat, ...cFlatSub].forEach((c) => c.on('change', () => { refreshFlat(); updateFlat(); }));
refreshFlat();

// 実験
const fx = pane.addFolder({ title: '実験' });
const cFlavor = list(fx, 'flavor', 'ルールの味付け', {
  'なし（ぱっと切替）': 'none', 'A 少しずつ変形': 'morph', 'B 領域ごとのルール': 'region', 'A＋B': 'morph+region',
});
const cMorph = [
  num(fx, 'holdMax', '　└ 保持（最大・世代）', 0, 2000, 10),
  num(fx, 'morphMin', '　└ 変形（最短・世代）', 1, 3000, 10),
  num(fx, 'morphMax', '　└ 変形（最長・世代）', 1, 3000, 10),
];
cMorph.forEach((c) => onLive(c, c.key));
const cInject = fx.addBinding(CONFIG, 'inject', { label: 'C 上流から写真を流し込む' });
tip(cInject, '「流れる」のときだけ効きます。領域ごとに時期をずらして、周期ごとに写真を上流から流し込みます');
const cPeriod = num(fx, 'injectPeriod', '　└ 周期（世代）', 20, 600, 10);
onLive(cPeriod, 'injectPeriod');
const cTempo = fx.addBinding(CONFIG, 'tempo', { label: 'E 領域ごとのテンポ' });
tip(cTempo, '領域ごとに進む速さが違います。100〜500世代ごとに速さが変わり、ときどき流れる向きも変わります');
const cTempoRange = ['tempoFast', 'tempoSlow'].map((k) => num(fx, k, '', 0, TEMPOS.length - 1, 1));
const tempoName = () => {
  cTempoRange[0].label = `　└ 最速 ${TEMPO_LABELS[CONFIG.tempoFast]}`;
  cTempoRange[1].label = `　└ 最遅 ${TEMPO_LABELS[CONFIG.tempoSlow]}`;
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

// 操作ボタン（一番下にまとめる）
pane.addBlade({ view: 'separator' });
const cPlay = pane.addButton({ title: 'PAUSE(Space)' }).on('click', () => togglePlay());
pane.addButton({ title: 'NEW SEED(N)' }).on('click', () => newSeed());
pane.addButton({ title: 'RESET(R)' }).on('click', () => rebuild());
pane.addButton({ title: 'FULLSCREEN(F)' }).on('click', () => toggleFullscreen());
pane.addButton({ title: 'HIDE GUI(H)' }).on('click', () => toggleUI());

function newSeed() {
  CONFIG.seed = Math.floor(Math.random() * 1e6);
  guiSync();
  rebuild();
}

function togglePlay() { setPlaying(!playing); }
const AUTO_PAUSED = 'タブが非アクティブになったので一時停止しました';
function setPlaying(v) {
  playing = v;
  if (playing && status === AUTO_PAUSED) status = '';
  cPlay.title = playing ? 'PAUSE(Space)' : 'PLAY(Space)';
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
  else document.documentElement.requestFullscreen().catch((e) => { status = `フルスクリーンにできません（${e.message}）`; });
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
  if (!f.type.startsWith('image/')) { status = '画像ファイルをドロップしてください'; return; }
  loadImage(f, f.name);
});

// 開発用：?img=URL で読み込む
const q = new URLSearchParams(location.search).get('img');
if (q) fetch(q).then((r) => r.blob()).then((b) => loadImage(b, q.split('/').pop())).catch(() => { status = `${q} を読み込めません`; });

requestAnimationFrame(frame);
