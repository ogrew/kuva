// main.js — 画像の読み込み、GUI、キー操作、再生ループ
import GUI from 'lil-gui';
import { Simulation } from './engine/sim.js';
import { loadBitmap, gridLayout, paddedCanvas, scaledCanvas, pixelsOf } from './image.js';
import { Renderer } from './render/renderer.js';

const CONFIG = {
  seed: 12345,
  cellSize: 24,   // 1マスの幅・高さ（元写真の px）
  K: 7,           // 状態数 = パレット色数
  chaos: 0.1,     // ルール表に混ぜる完全ランダムの割合（即時反映）
  gps: 12,        // 世代/秒（即時反映）
  motion: 'flow', // 動き方 'flow'（流れる） | 'ca'（その場で変化）
  // ---- 実験（見比べ用）----
  flavor: 'morph+region', // ルールの味付け（FLAVORS）。変えると最初から作り直し
  holdMax: 200,           // A：変形が終わってから次の変形までの最大世代数（即時反映）
  morphMin: 150,          // A：変形にかける世代数の最短（即時反映）
  morphMax: 500,          // A：〃 最長（即時反映）
  inject: false,          // C：上流から写真を流し込む（即時反映。流れるのときだけ効く）
  injectPeriod: 600,      // C：流し込みの周期（世代）（即時反映）
  fit: 'contain', // 'contain' = 全体を収める（余白） / 'cover' = 埋める（切り取り）
};
// ルールの味付け → エンジンの設定
const FLAVORS = {
  'none':         { ruleMorph: false, regionRules: false },
  'morph':        { ruleMorph: true,  regionRules: false },
  'region':       { ruleMorph: false, regionRules: true },
  'morph+region': { ruleMorph: true,  regionRules: true },
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
  const cell = Math.max(4, Math.round(CONFIG.cellSize));
  const g = gridLayout(bitmap.width, bitmap.height, cell);
  if (g.cols < 4 || g.rows < 4) { status = 'マスが大きすぎます（cellSize を下げてください）'; return; }
  const padded = paddedCanvas(bitmap, g);
  const A = Math.max(1, Math.min(ANALYSIS_SUB, cell));
  const analysis = { data: pixelsOf(scaledCanvas(padded, g.cols * A, g.rows * A)), stride: g.cols * A };
  const P = { seed: CONFIG.seed, K: CONFIG.K, motion: CONFIG.motion, ...FLAVORS[CONFIG.flavor] };
  for (const k of Simulation.LIVE) P[k] = CONFIG[k];
  sim = new Simulation(P, { cols: g.cols, rows: g.rows, Ax: A, Ay: A, analysis });

  // 写真テクスチャは長辺を上限まで縮小する
  const k = Math.min(1, renderer.maxPhotoSize / Math.max(g.GW, g.GH));
  const photo = k < 1 ? scaledCanvas(padded, Math.round(g.GW * k), Math.round(g.GH * k)) : padded;
  renderer.setPhoto(g, photo);
  renderer.setSrc(sim.src);
  acc = 0;
  status = `初期処理 ${Math.round(performance.now() - t0)}ms`;
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
    s += `   |   grid ${sim.cols}×${sim.rows}   領域 ${sim.regions.length}   seed ${sim.P.seed}`;
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
gui.add(CONFIG, 'cellSize', 4, 256, 1).name('cellSize (px)').onFinishChange(rebuild);
gui.add(CONFIG, 'K', 2, 12, 1).name('K (色数)').onFinishChange(rebuild);
gui.add(CONFIG, 'motion', { '流れる': 'flow', 'その場で変化': 'ca' }).name('動き方').onChange(rebuild);
const live = (k) => (v) => sim && sim.set(k, v);
gui.add(CONFIG, 'chaos', 0, 1, 0.01).name('chaos (ランダム混入)').onChange(live('chaos'));
gui.add(CONFIG, 'gps', 0.5, 60, 0.5).name('世代/秒');
gui.add(CONFIG, 'fit', { '全体を収める': 'contain', '埋める': 'cover' }).name('縦横比');
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
cInject.domElement.title = '「流れる」のときだけ効きます。領域ごとに時期をずらして、周期ごとに写真を上流から流し込みます';
const refreshFx = () => {
  cMorph.forEach((c) => c.show(FLAVORS[CONFIG.flavor].ruleMorph));
  cPeriod.show(CONFIG.inject);
};
cFlavor.onChange(() => { refreshFx(); rebuild(); });
cInject.onChange((v) => { live('inject')(v); refreshFx(); });
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
