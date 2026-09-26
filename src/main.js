// main.js — 画像の読み込み、GUI、キー操作、再生ループ
import GUI from 'lil-gui';
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
const info = document.getElementById('info');
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
let rate = { t: lastT, n: 0, value: 0 }; // 実測の世代/秒
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
  if (t - rate.t >= 1000) { rate.value = (rate.n * 1000) / (t - rate.t); rate.t = t; rate.n = 0; }
  renderer.draw(CONFIG.fit);
  updateInfo();
  requestAnimationFrame(frame);
}

let lastInfo = '';
function updateInfo() {
  let s = status;
  if (sim) {
    s += `   |   ${playing ? '再生中' : '一時停止'}   世代 ${sim.gen}   ${rate.value.toFixed(1)} 世代/秒`;
    const { cw, ch } = renderer.grid;
    s += `   |   grid ${sim.cols}×${sim.rows}   cell ${cw}×${ch}px   領域 ${sim.regions.length}   seed ${sim.P.seed}`;
    s += `   |   ${imgName} ${bitmap.width}×${bitmap.height}`;
  }
  if (s !== lastInfo) { info.textContent = s; lastInfo = s; }
}

// ---------- GUI ----------
const gui = new GUI({ title: 'kuva' });
const actions = {
  play: () => togglePlay(),
  newSeed: () => { CONFIG.seed = Math.floor(Math.random() * 1e6); cSeed.updateDisplay(); rebuild(); },
  restart: () => rebuild(),
};
const cPlay = gui.add(actions, 'play');
const cSeed = gui.add(CONFIG, 'seed', 0, 999999, 1).onFinishChange(rebuild);
gui.add(actions, 'newSeed').name('新しい seed (N)');
const cCell = gui.add(CONFIG, 'cellSize', CELL_MIN, CELL_MAX, 1).name('cellSize (幅px)');
// 高さ比：番号のスライダー。表示名に今の比率と高さを出す
const cAspect = gui.add(CONFIG, 'cellAspect', 0, ASPECTS.length - 1, 1);
const aspectName = () => { const d = cellDims(); cAspect.name(`高さ比 ×${d.label}（${d.cw}×${d.ch}px）`); };
cCell.onChange(aspectName).onFinishChange(rebuild);
cAspect.onChange(aspectName).onFinishChange(rebuild);
aspectName();
gui.add(CONFIG, 'K', 2, 12, 1).name('K (色数)').onFinishChange(rebuild);
gui.add(CONFIG, 'motion', { '流れる': 'flow', 'その場で変化': 'ca' }).name('動き方').onChange(rebuild);
gui.add(CONFIG, 'direction', { 'ALL': 'all', '下': 'down', '上': 'up', '右': 'right', '左': 'left' }).name('進行方向')
  .onChange((v) => sim && sim.set('direction', v))
  .domElement.title = 'ALL：領域ごとに違う向き（E では、ときどき変わる）／それ以外：全領域をその向きに流す';
const live = (k) => (v) => sim && sim.set(k, v);
gui.add(CONFIG, 'chaos', 0, 1, 0.01).name('chaos (ランダム混入)').onChange(live('chaos'));
gui.add(CONFIG, 'gps', 0.5, 60, 0.5).name('世代/秒');
gui.add(CONFIG, 'fit', { '全体を収める': 'contain', '埋める': 'cover' }).name('縦横比');
const cFlat = gui.add(CONFIG, 'flatRatio', 0, 1, 0.01).name('塗りつぶし割合');
const cFlatSub = [
  gui.add(CONFIG, 'flatUnit', { 'マスごと': 'tile', '似た色ごと': 'state' }).name('　└ 塗り方'),
  gui.add(CONFIG, 'flatColor', { '代表色': 'palette', '平均色': 'mean' }).name('　└ 塗りの色'),
];
cFlat.domElement.title = 'CA で運ばれてきたマス（元の位置にない写真タイル）のうち、写真の代わりに一色で塗る割合。0 なら塗らない';
cFlatSub[0].domElement.title = 'マスごと：写真タイルごとに、塗るかどうかを決める\n似た色ごと：K色に分けたとき同じ色になるタイルを、まとめて塗る';
cFlatSub[1].domElement.title = '代表色：K色のうち、そのタイルが属する色\n平均色：そのタイル自身の平均の色';
const refreshFlat = () => cFlatSub.forEach((c) => c.show(CONFIG.flatRatio > 0));
cFlat.onChange(() => { refreshFlat(); updateFlat(); });
cFlatSub.forEach((c) => c.onChange(updateFlat));
refreshFlat();
gui.add(actions, 'restart').name('最初から (R)');
const fx = gui.addFolder('実験');
const cFlavor = fx.add(CONFIG, 'flavor', {
  'なし（ぱっと切替）': 'none', 'A 少しずつ変形': 'morph', 'B 領域ごとのルール': 'region', 'A＋B': 'morph+region',
}).name('ルールの味付け');
const cMorph = [
  fx.add(CONFIG, 'holdMax', 0, 2000, 10).name('　└ 保持（最大・世代）').onChange(live('holdMax')),
  fx.add(CONFIG, 'morphMin', 1, 3000, 10).name('　└ 変形（最短・世代）').onChange(live('morphMin')),
  fx.add(CONFIG, 'morphMax', 1, 3000, 10).name('　└ 変形（最長・世代）').onChange(live('morphMax')),
];
const cInject = fx.add(CONFIG, 'inject').name('C 上流から写真を流し込む');
const cPeriod = fx.add(CONFIG, 'injectPeriod', 20, 600, 10).name('　└ 周期（世代）').onChange(live('injectPeriod'));
const cTempo = fx.add(CONFIG, 'tempo').name('E 領域ごとのテンポ');
cTempo.domElement.title = '領域ごとに進む速さが違います。100〜500世代ごとに速さが変わり、ときどき流れる向きも変わります';
const cTempoRange = ['tempoFast', 'tempoSlow'].map((k) => fx.add(CONFIG, k, 0, TEMPOS.length - 1, 1));
const tempoName = () => {
  cTempoRange[0].name(`　└ 最速 ${TEMPO_LABELS[CONFIG.tempoFast]}`);
  cTempoRange[1].name(`　└ 最遅 ${TEMPO_LABELS[CONFIG.tempoSlow]}`);
};
cTempoRange.forEach((c) => c.onChange((v) => { live(c.property)(v); tempoName(); }));
tempoName();
cInject.domElement.title = '「流れる」のときだけ効きます。領域ごとに時期をずらして、周期ごとに写真を上流から流し込みます';
const refreshFx = () => {
  cMorph.forEach((c) => c.show(FLAVORS[CONFIG.flavor].ruleMorph));
  cPeriod.show(CONFIG.inject);
  cTempoRange.forEach((c) => c.show(CONFIG.tempo));
};
cFlavor.onChange(() => { refreshFx(); rebuild(); });
cInject.onChange((v) => { live('inject')(v); refreshFx(); });
cTempo.onChange((v) => { live('tempo')(v); refreshFx(); });
refreshFx();
gui.add({ fs: toggleFullscreen }, 'fs').name('フルスクリーン (F)');
gui.add({ ui: toggleUI }, 'ui').name('GUI を隠す (H)');

function togglePlay() {
  playing = !playing;
  cPlay.name(playing ? '一時停止 (Space)' : '再生 (Space)');
}
cPlay.name('一時停止 (Space)');

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((e) => { status = `フルスクリーンにできません（${e.message}）`; });
}

function toggleUI() {
  uiVisible = !uiVisible;
  gui.show(uiVisible);
  info.hidden = !uiVisible;
  document.body.classList.toggle('bare', !uiVisible);
}

// ---------- キー操作 ----------
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') toggleUI();
  else if (k === 'n') actions.newSeed();
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
