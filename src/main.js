// main.js — 画像の読み込み、GUI、キー操作、再生ループ
import { Pane } from 'tweakpane';
import { Simulation, TEMPOS, TEMPO_LABELS } from './engine/sim.js';
import { cellMeans } from './engine/analyze.js';
import { PAT_RULES } from './engine/motions.js';
import { flatColors, tileHalves, blockHalves, splitKinds } from './engine/flat.js';
import { SCALE_LIST, blockCodes } from './engine/scale.js';
import { tileDigits } from './engine/digits.js';
import { loadBitmap, gridLayout, paddedCanvas, drawPadded, scaledCanvas, pixelsOf } from './image.js';
import { Camera } from './camera.js';
import { Renderer } from './render/renderer.js';
import { RegionBorders } from './render/region-borders.js';
import { DIGIT_FONTS, GLYPH_SETS, GLYPH_SIZE, KANA_FONTS, formatGlyphText, makeGlyphs, parseGlyphText } from './render/glyphs.js';

const CONFIG = {
  seed: 12345,
  cellSize: 24,   // 1マスの幅（元写真の px）
  cellAspect: 4,  // 1マスの高さの比率（ASPECTS の番号）。高さ = 幅 × 比率。4 = 1:1
  K: 7,           // 状態数 = パレット色数
  bigFrac: 0.3,   // 大きなマス（2×2・4×4 マスを1マスとして計算する）にする領域の割合（即時反映）
  chaos: 0.1,     // ルール表に混ぜる完全ランダムの割合（即時反映）
  gps: 12,        // 世代/秒（即時反映）
  motion: 'flow', // 動き方 'flow'（流れる） | 'ca'（その場で変化）
  direction: 'all', // 進行方向 'all'（領域ごと） | 上下左右 | 斜め 'down-right' など（DIRECTIONS。即時反映）
  diagFrac: 0.1,    // All のとき、斜めに流れる領域の割合（即時反映）
  flatRatio: 0,   // 塗りつぶし：元の位置にないタイルのうち、一色で塗る割合（0 = 塗らない。即時反映）
  flatUnit: 'tile', // 塗り方 'tile'（マスごと） | 'state'（似た色ごと）
  flatColor: 'palette', // 塗りの色 'palette'（代表色） | 'mean'（平均色）
  flatSplit: 0,   // 2色塗りにする領域の割合。割り方（横・縦・斜め）は領域の写真から決める（0 = なし。即時反映）
  // ---- 変化（時間とともに映像を変える仕組み）----
  flavor: 'morph',        // ルールの味付け（FLAVORS）。変えると最初から作り直し
  holdMax: 200,           // A：変形が終わってから次の変形までの最大世代数（即時反映）
  morphMin: 150,          // A：変形にかける世代数の最短（即時反映）
  morphMax: 500,          // A：〃 最長（即時反映）
  inject: true,           // C：写真を流し込む（即時反映。流れるのときだけ効く）
  injectPeriod: 120,      // C：流し込みの周期（世代）（即時反映）
  topology: true,         // 領域の分裂・合体
  topologyInterval: 80,   // 領域ごとの変化の間隔の中心値（世代）
  leakEnabled: true,      // 隣からの漏れ
  leak: 0.6,              // 境界の開放率（OFFでも保持）
  tempo: false,           // E：領域ごとのテンポ（即時反映）
  tempoFast: 1,           // E：テンポの範囲 最速（TEMPOS の番号。即時反映）
  tempoSlow: 4,           // E：〃 最遅
  stagger: 120,           // 領域が崩れ始める世代のばらつき（0〜300。0 = 一斉に始まる。即時反映）
  // ---- 模様（基本セルオートマトンの模様を重ねる）----
  patFrac: 0.2,           // 模様のレイヤーを重ねる領域の割合（即時反映）
  patRules: [30, 90, 110, 150], // 模様に使うルール（即時反映）
  patSkew: true,          // 斜めに流れる領域で、模様も一緒に斜めに流す（試作。即時反映）
  digits: false,  // マスに文字を重ねる（GUI では Glyphs。正方形のマスのときだけ。描画だけに効く）
  digitBy: 'lum', // 番号 0〜9 の決め方（DIGIT_MODES）：'lum'（明るさ順） | 'state'（K色の分類）
  glyphSet: 'digits', // 番号に割り当てる文字（GLYPH_SETS）：'digits'（0〜9） | 'kana'（kanaText）
  digitFont: 'silkscreen', // 数字のフォント（DIGIT_FONTS）
  kanaFont: 'dotgothic',   // ひらがなのフォント（KANA_FONTS）
  kanaText: formatGlyphText([...GLYPH_SETS.kana.chars]), // ひらがなのとき番号 0〜9 に割り当てる文字（区切り。空の枠の番号は描かない。漢字・カタカナも通す）
  digitColor: '#ffffff', // 数字の色（全マス共通）
  digitShow: [0], // 表示する数字（全部に出すとうるさいので、一部だけ。ひらがなのときは使わない）
  // ---- 縮小（ノイズでマスを縮め、残りをタイルの平均色で塗る。描画だけに効く。試作）----
  shrink: 0,           // 縮める強さ（0 = OFF。1 ならノイズの値がそのまま倍率）
  shrinkScale: 4,      // ノイズの細かさ（写真の短辺あたりのノイズの山の数）
  shrinkSpeed: 2,      // ノイズが変わる速さ（100世代あたりの時間の進み）
  shrinkBias: 0,       // ノイズの値に足す量（+ で縮むマスが減る）
  shrinkContrast: 1.5, // ノイズの値の差を広げる倍率
  shrinkSteps: 8,      // 倍率の段数（0 = なめらか）
  shrinkFill: 'mean',  // 残りの塗り方 'mean'（タイルの平均色） | 'solid'（全マス共通の shrinkColor）（試作）
  shrinkColor: '#000000', // 'solid' のときの色
  regionBorders: false, // デバッグ：白い領域境界（描画だけに効く。ON なら PNG にも入る）
  fit: 'contain', // 'contain' = 全体を収める（余白） / 'cover' = 埋める（切り取り）
  // ---- 入力（カメラ。写真テクスチャを毎フレーム差し替え、分類も世代ごとに今のフレームから作り直す）----
  camera: false,    // カメラを入力にする
  camMirror: true,  // 左右反転（自撮り向け。変えると作り直し）
  camDevice: '',    // 使うカメラ（'' = 既定）
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
//   最大：短辺の 6.25%（短辺が16マス。これより粗いと領域に分けたときに CA らしさが出にくい）
const CELL_MIN_FRAC = 0.005, CELL_MAX_FRAC = 0.0625, CELL_MIN_PX = 4;
const cellRange = () => {
  if (!bitmap) return { min: 12, max: 64 };
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
// サイトを開いたときにランダムに決めるもの：seed、K、cellSize（動き方は常に「流れる」から）
// cellSize は写真の短辺の 1%〜6%（対数で一様）。
// 写真の大きさが分かるのは最初の写真を読み込んだときなので、割合だけ先に決めておく
const RANDOM_K = [4, 10], RANDOM_CELL_FRAC = [0.01, 0.06];
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
CONFIG.seed = Math.floor(Math.random() * 1e6);
CONFIG.K = Math.floor(rand(RANDOM_K[0], RANDOM_K[1] + 1));
let pendingCellFrac = Math.exp(rand(Math.log(RANDOM_CELL_FRAC[0]), Math.log(RANDOM_CELL_FRAC[1])));
const ANALYSIS_SUB = 4;     // 平均色の解析解像度（1マスを最大 N×N px で見る）
const MAX_STEPS_PER_FRAME = 8; // 追いつけない分は捨てる（ゆっくりになるだけで、世代の中身は変わらない）

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas);
const borders = new RegionBorders(document.getElementById('region-borders'));

let bitmap = null, imgName = '';
const camera = new Camera();
let still = null;     // カメラを ON にする前の写真 { bitmap, name }（OFF にしたら戻す）
let camFrame = null;  // カメラのフレームを毎回描くキャンバス { g, pad, out, … }（out = 写真テクスチャと同じ寸法）
let sim = null;
let playing = true;
let acc = 0;          // 次の世代までの端数（世代単位）
let status = 'Drop an image';
let uiVisible = true;

// ---------- 作り直し ----------
function rebuild() {
  // カメラ入力では、作り直すときのフレームを「写真」として解析する
  if (camera.on) {
    bitmap = camera.grab(CONFIG.camMirror);
    imgName = 'Camera';
    updateBackdrop(bitmap);
  }
  camFrame = null;
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
  const io = { cols: g.cols, rows: g.rows, Ax, Ay, analysis, cw, ch };
  sim = new Simulation(P, io);
  halves = tileHalves(io);

  // 写真テクスチャは長辺を上限まで縮小する
  const k = Math.min(1, renderer.maxPhotoSize / Math.max(g.GW, g.GH));
  const photo = k < 1 ? scaledCanvas(padded, Math.round(g.GW * k), Math.round(g.GH * k)) : padded;
  renderer.setPhoto(g, photo);
  if (camera.on) {
    const pad = k < 1 ? document.createElement('canvas') : null, out = document.createElement('canvas');
    if (pad) { pad.width = g.GW; pad.height = g.GH; }
    out.width = photo.width; out.height = photo.height;
    // 分類の作り直し用：1マス = 最大 2×2 px に縮めて平均色を取る（作り直しの 4×4 より粗いが、読み戻しが 1/4 になる）
    const an = document.createElement('canvas'), lx = Math.min(2, Ax), ly = Math.min(2, Ay);
    an.width = g.cols * lx; an.height = g.rows * ly;
    camFrame = { g, pad, out, an, io: { cols: g.cols, rows: g.rows, Ax: lx, Ay: ly }, mean: new Float32Array(g.cols * g.rows * 3), dirty: false };
  }
  layers = { sim, flat: [], digits: [], halves: [halves], means: [] };
  updateDigits();
  showSim();
  acc = 0;
  status = `Built in ${Math.round(performance.now() - t0)} ms`;
}

// 今の世代を描画に渡す（模様のレイヤーを重ねたタイル番号）
let layoutRegions = null, layoutScale = -1;
const showSim = () => {
  renderer.setSrc(sim.displaySrc());
  // 分裂・合体で領域が変わったとき・領域の倍率が変わったときだけ、領域ごとの描画の情報を作り直す
  if (layoutRegions !== sim.regions || layoutScale !== sim.scaleVersion) updateLayout();
};

// 領域ごとの描画の情報：大きなマスの倍率と中の位置、塗りつぶし・数字の、使っている倍率の層
function updateLayout() {
  layoutRegions = sim.regions; layoutScale = sim.scaleVersion;
  renderer.setBlocks(blockCodes(sim));
  updateFlat();
  updateDigitLayers();
  updateMeans();
}

// 縮小したマスの残りを塗る色（倍率ごとのタイルの平均色）。使っている倍率の分だけ。カメラ入力中は新しいフレームごとに作り直す
function updateMeans() {
  if (!sim || !(CONFIG.shrink > 0)) return;
  for (const li of scalesInUse()) {
    if (layers.means[li]) continue;
    layers.means[li] = true;
    renderer.setMeans(li, scaleSim(li).mean);
  }
}
// '#rrggbb' → [r, g, b]（0〜1）
const rgb = (s) => { const h = parseInt(s.slice(1, 7), 16); return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]; };
// 縮小のパラメータを描画に渡す（毎フレーム。時間は世代番号と次の世代までの割合から決める）
function updateShrink() {
  if (!sim || !(CONFIG.shrink > 0)) { renderer.setShrink(null); return; }
  renderer.setShrink({
    amount: CONFIG.shrink, scale: CONFIG.shrinkScale, time: (sim.gen + acc) * CONFIG.shrinkSpeed / 100,
    bias: CONFIG.shrinkBias, contrast: CONFIG.shrinkContrast, steps: CONFIG.shrinkSteps, seed: sim.P.seed >>> 0,
    fill: CONFIG.shrinkFill === 'solid' ? rgb(CONFIG.shrinkColor) : null,
  });
}

// 倍率ごとの解析（塗りつぶし・数字に使う）。使っている倍率の分だけ、必要になったときに作って残す
// layers.flat[li]・layers.digits[li] = 描画に渡した層のパラメータ（同じなら作り直さない）
let layers = null;
const scalesInUse = () => new Set([0, ...sim.regions.map((g) => SCALE_LIST.indexOf(g.scale))]);
function scaleSim(li) {
  if (li === 0) return sim;
  const { cls, mean } = sim.scaleData(SCALE_LIST[li]);
  return { cls, mean, palette: sim.palette, K: sim.K, P: sim.P };
}
const scaleHalves = (li) => (layers.halves[li] ??= blockHalves(sim, halves, SCALE_LIST[li]));

// 塗りつぶしの色を作り直して描画に渡す（描画だけに効くので、作り直しは不要）
let halves = null; // タイルごとの半分ずつの平均色（2色塗り用。写真・グリッドが変わったときに作り直す）
function updateFlat() {
  if (!sim) return;
  if (!(CONFIG.flatRatio > 0)) { renderer.setFlat(false); return; }
  // 大きなマスの2色塗りの色は、2色塗りを使うときだけ作る（倍率 1 は写真を読み込んだときに作ってある）
  const split = CONFIG.flatSplit > 0;
  const key = [CONFIG.flatRatio, CONFIG.flatUnit, CONFIG.flatColor, split].join();
  for (const li of scalesInUse()) {
    if (layers.flat[li] === key) continue;
    layers.flat[li] = key;
    const h = li === 0 ? halves : split ? scaleHalves(li) : null;
    renderer.setFlatColors(li, flatColors(scaleSim(li), CONFIG.flatRatio, CONFIG.flatUnit, CONFIG.flatColor, h, SCALE_LIST[li] - 1));
  }
  renderer.setFlat(true, splitKinds(sim, halves, CONFIG.flatSplit));
}

// 数字の層（倍率ごとのタイルの数字）。決め方を変えたら作り直す。カメラ入力中は新しいフレームごとに作り直す
function updateDigitLayers() {
  if (!sim) return;
  for (const li of scalesInUse()) {
    if (layers.digits[li] === CONFIG.digitBy) continue;
    layers.digits[li] = CONFIG.digitBy;
    renderer.setDigits(li, tileDigits(scaleSim(li), CONFIG.digitBy));
  }
}

// 文字：正方形のマス（Aspect = 1）のときだけ描く。文字の形は文字の種類・フォントを変えたときだけ作り直す
const isSquare = () => ASPECTS[Math.round(CONFIG.cellAspect)]?.p === 1;
let glyphFont = '', glyphSeq = 0;
function updateDigits() {
  const g = renderer.grid;
  // 描く番号：数字は Show で選んだもの、ひらがなは文字の入っている枠
  const kana = CONFIG.glyphSet === 'kana', chars = parseGlyphText(CONFIG.kanaText);
  const mask = kana ? chars.reduce((m, c, d) => (c ? m | (1 << d) : m), 0) : CONFIG.digitShow.reduce((m, d) => m | (1 << d), 0);
  const on = CONFIG.digits && !!g && g.cw === g.ch && mask !== 0;
  renderer.setDigitStyle(on, rgb(CONFIG.digitColor), mask);
  if (on) updateDigitLayers();
  const set = CONFIG.glyphSet, font = kana ? CONFIG.kanaFont : CONFIG.digitFont, key = `${set}/${font}/${kana ? chars.join(',') : ''}`;
  if (on && glyphFont !== key) {
    glyphFont = key;
    const seq = ++glyphSeq;
    makeGlyphs(set, font, kana ? chars : null).then((data) => { if (seq === glyphSeq) renderer.setGlyphs(data, GLYPH_SIZE); });
  }
}

// 背景：写真のぼかし。写真を読み込んだときに1回だけ、小さく縮めてぼかした画像を作る（毎フレームは描かない）
let backdropURL = '';
function updateBackdrop(bm) {
  const S = 256, B = 12; // 縮小後の長辺、ぼかしの半径（px）
  const k = S / Math.max(bm.width, bm.height);
  const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.filter = `blur(${B}px)`;
  // 端が透けて暗くならないよう、少し大きく描いてはみ出させる
  cx.drawImage(bm, -2 * B, -2 * B, w + 4 * B, h + 4 * B);
  cv.toBlob((blob) => {
    if (!blob || bitmap !== bm) return;
    if (backdropURL) URL.revokeObjectURL(backdropURL);
    backdropURL = URL.createObjectURL(blob);
    document.getElementById('bg').style.backgroundImage = `url(${backdropURL})`;
  });
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
    updateBackdrop(bm);
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
let rate = { t: lastT, n: 0, frames: 0 }; // 実測の世代/秒（0.5秒ごとに stats.rate を更新）
let camFps = 0; // カメラから届いたフレーム/秒

// カメラの新しいフレームを写真テクスチャに送る（CA の状態は変えない。一時停止中も映像は動く）
function updateCameraFrame() {
  if (!camera.on || !camera.fresh || !camFrame || !bitmap) return;
  camera.fresh = false;
  // 途中でカメラの解像度が変わったら、そのフレームで作り直す
  if (camera.width !== bitmap.width || camera.height !== bitmap.height) { onCameraSize(); return; }
  const { g, pad, out } = camFrame;
  if (pad) {
    drawPadded(pad.getContext('2d'), camera.video, g, CONFIG.camMirror);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(pad, 0, 0, out.width, out.height);
  } else drawPadded(out.getContext('2d'), camera.video, g, CONFIG.camMirror);
  renderer.updatePhoto(out);
  camFrame.dirty = true;
}

// 今のフレームのマスごとの平均色をエンジンに渡す（パレットは固定のまま分類だけ作り直す。I がカメラに追従する）。
// 世代を進める直前に、新しいフレームがあるときだけ（1世代に最大1回）
let liveMs = 0; // かかった時間（Status に出す）
function feedCamera() {
  if (!camFrame?.dirty) return;
  camFrame.dirty = false;
  const t0 = performance.now();
  const { out, an, io, mean } = camFrame;
  // 縮小は GPU のキャンバスで行い、小さくなった画像だけを読み戻す（CPU のキャンバスに描くと、1080p の全体が読み戻される）
  const ctx = an.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(out, 0, 0, an.width, an.height);
  cellMeans({ ...io, analysis: { data: ctx.getImageData(0, 0, an.width, an.height).data, stride: an.width } }, mean);
  sim.setColors(mean);
  // 数字もタイルの今の平均色から決め直す（描いていないときは印だけ消して、描き始めたときに作る）
  layers.digits = [];
  if (renderer.digitsOn) updateDigitLayers();
  layers.means = [];
  updateMeans();
  liveMs = liveMs * 0.9 + (performance.now() - t0) * 0.1;
}
function frame(t) {
  const dt = Math.min(0.25, (t - lastT) / 1000);
  lastT = t;
  updateCameraFrame();
  if (sim && playing) {
    acc += dt * CONFIG.gps;
    let n = 0;
    while (acc >= 1 && n < MAX_STEPS_PER_FRAME) { if (!n) feedCamera(); sim.step(); acc -= 1; n++; }
    if (acc >= 1) acc = 0;
    if (n) showSim();
    rate.n += n;
  }
  if (t - rate.t >= 500) {
    stats.rate = (rate.n * 1000) / (t - rate.t);
    camFps = ((camera.frames - rate.frames) * 1000) / (t - rate.t);
    rate.t = t; rate.n = 0; rate.frames = camera.frames;
  }

  updateShrink();
  renderer.draw(CONFIG.fit);
  borders.draw(CONFIG.regionBorders, renderer.grid, sim?.regions ?? [], CONFIG.fit);
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
    stats.image = `${imgName} ${bitmap.width}×${bitmap.height}` + (camera.on ? ` ${Math.round(camFps)}fps live ${liveMs.toFixed(1)}ms` : '');
  }
}

// ---------- GUI（Tweakpane v4） ----------
const pane = new Pane({ title: 'kuva', container: document.getElementById('ui') });
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

// Input（カメラ入力）
const fi = pane.addFolder({ title: 'Input' });
const cCamera = fi.addBinding(CONFIG, 'camera', { label: 'Camera' });
tip(cCamera, 'Use the camera as the image (C). The frame at the moment of building sets the palette and regions; after that the picture inside the cells and the pull back toward the image follow the camera. Rebuilding (R, seed, cell size…) takes the current frame. Off returns to the previous image');
const cMirror = fi.addBinding(CONFIG, 'camMirror', { label: '　└ Mirror' });
tip(cMirror, 'Flip horizontally (for a front camera)');
let cDevice = null;
// カメラの一覧（許可を取ったあとで名前が分かる）。Tweakpane は選択肢をあとから変えられないので、同じ位置に作り直す
async function updateDevices() {
  let list = [];
  try { list = await Camera.devices(); } catch (e) { console.error(e); }
  let index;
  if (cDevice) { index = fi.children.indexOf(cDevice); cDevice.dispose(); }
  const opts = Object.fromEntries(list.map((d) => [d.label, d.id]));
  if (!list.some((d) => d.id === CONFIG.camDevice)) CONFIG.camDevice = list[0]?.id ?? '';
  cDevice = fi.addBinding(CONFIG, 'camDevice', { label: '　└ Device', options: list.length ? opts : { 'Default': '' }, index });
  tip(cDevice, 'Camera to use (webcams, capture cards, virtual cameras)');
  cDevice.hidden = !CONFIG.camera;
  cDevice.on('change', (ev) => { if (!guiSyncing && camera.on && ev.value !== camera.deviceId) startCamera(); });
}
const refreshInput = () => {
  cMirror.hidden = !CONFIG.camera;
  if (cDevice) cDevice.hidden = !CONFIG.camera;
};
cCamera.on('change', (ev) => { if (!guiSyncing) setCamera(ev.value); });
onRebuild(cMirror);
refreshInput();

// cellSize は写真の短辺に対する割合を保つ（カメラと写真で短辺が違うので）
function keepCellFrac(from, to) {
  if (!from || !to) return;
  CONFIG.cellSize = Math.round(CONFIG.cellSize * Math.min(to.width, to.height) / Math.min(from.width, from.height));
}

function setCamera(on) {
  refreshInput();
  if (on) startCamera();
  else stopCamera();
}

let camSeq = 0;
async function startCamera() {
  const seq = ++camSeq;
  ++loadSeq; // 読み込み中の写真があれば捨てる
  status = 'Starting camera…';
  try {
    if (!camera.on && bitmap) still = { bitmap, name: imgName };
    await camera.start(CONFIG.camDevice);
    if (seq !== camSeq || !CONFIG.camera) { if (seq === camSeq) camera.stop(); return; }
    CONFIG.camDevice = camera.deviceId;
    await updateDevices();
    guiSync();
    onCameraSize();
    status = 'Camera';
  } catch (e) {
    console.error(e);
    if (seq !== camSeq) return;
    camera.stop();
    CONFIG.camera = false;
    guiSync();
    refreshInput();
    status = `Camera unavailable (${e.name || e.message})`;
  }
}

// カメラの寸法が決まった・変わったとき：cellSize の範囲を合わせて作り直す（rebuild がそのフレームを写真にする）
function onCameraSize() {
  const prev = bitmap;
  const size = { width: camera.width, height: camera.height };
  bitmap = size; // cellRange が寸法を読むので先に入れる（rebuild で実際のフレームに置き換わる）
  keepCellFrac(prev, size);
  updateCellRange();
  aspectName();
  rebuild();
}

// restore = 前の写真に戻す（写真をドロップしたときは戻さずに、ドロップした写真を読み込む）
function stopCamera(restore = true) {
  ++camSeq;
  if (camera.on) camera.stop();
  camFrame = null;
  if (CONFIG.camera) { CONFIG.camera = false; guiSync(); }
  refreshInput();
  if (!restore) still = null;
  if (!still) return;
  keepCellFrac(bitmap, still.bitmap);
  bitmap = still.bitmap; imgName = still.name; still = null;
  updateBackdrop(bitmap);
  updateCellRange();
  aspectName();
  rebuild();
  status = '';
}

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
  tip(cCell, `Cell width in image px (${min}–${max}: 0.5%–6.25% of the short side). The range changes with the image`);
}
updateCellRange();
// 高さ比：番号のスライダー。表示名に今の比率と高さを出す
const cAspect = num(f1, 'cellAspect', '', 0, ASPECTS.length - 1, 1);
const aspectName = () => { const d = cellDims(); cAspect.label = `Aspect ×${d.label} (${d.cw}×${d.ch})`; };
onRebuild(cAspect, () => { aspectName(); refreshDigits(); });
tip(cAspect, 'Cell height = width × 1/5 … 5');
aspectName();
tip(onRebuild(num(f1, 'K', 'Colors', 2, 12, 1)), 'Number of states (K). Cells are clustered into K colors by k-means');
tip(onLive(num(f1, 'bigFrac', 'Big cells', 0, 1, 0.1), 'bigFrac', () => sim && showSim()), // 一時停止中も描画の情報を更新する
  'Share of regions computed with 2×2 or 4×4 cells as one cell (half each). They step every 2 or 4 generations, so everything flows at the same speed on screen. 0 = off');

// Motion（動き方と速さ）
const f2 = pane.addFolder({ title: 'Motion' });
tip(onRebuild(list(f2, 'motion', 'Motion', { 'Flow': 'flow', 'In place': 'ca' }), () => { refreshFx(); refreshDir(); }),
  'Flow: the space-time diagram flows through each region\nIn place: each row changes in place as a 1D CA (for comparison)');
const cDir = list(f2, 'direction', 'Direction', {
  'All': 'all', 'Down': 'down', 'Up': 'up', 'Right': 'right', 'Left': 'left',
  'Down-right': 'down-right', 'Down-left': 'down-left', 'Up-right': 'up-right', 'Up-left': 'up-left',
});
tip(cDir, 'All: each region flows its own way, some of them diagonally (changes now and then with Region tempo)\nOthers: every region flows that way. Diagonal flow wraps around the sides of each region');
const cDiag = num(f2, 'diagFrac', '　└ Diagonal', 0, 1, 0.1);
onLive(cDiag, 'diagFrac');
tip(cDiag, 'Share of regions that flow diagonally when Direction is All. 0 = straight only');
const refreshDir = () => { cDiag.hidden = CONFIG.direction !== 'all' || CONFIG.motion !== 'flow'; };
onLive(cDir, 'direction', refreshDir);
refreshDir();
tip(onLive(num(f2, 'chaos', 'Chaos', 0, 1, 0.01), 'chaos'), 'Share of fully random entries mixed into the rule tables');
tip(num(f2, 'gps', 'Speed', 0.5, 48, 0.5), 'Generations per second'); // 再生ループが毎フレーム読む

// Render（描画だけに効く。作り直し不要）
const f3 = pane.addFolder({ title: 'Render' });
tip(list(f3, 'fit', 'Fit', { 'Contain': 'contain', 'Cover': 'cover' }), 'Contain: fit the whole image (letterbox)\nCover: fill the screen (crop)');
tip(f3.addBinding(CONFIG, 'regionBorders', { label: 'Region borders' }),
  'Show region boundaries as thin white lines. Also included in saved PNGs');
const cFlat = num(f3, 'flatRatio', 'Flat fill', 0, 1, 0.1);
const cFlatSub = [
  list(f3, 'flatUnit', '　└ Group', { 'Per tile': 'tile', 'Per color': 'state' }),
  list(f3, 'flatColor', '　└ Color', { 'Palette': 'palette', 'Mean': 'mean' }),
  num(f3, 'flatSplit', '　└ Split', 0, 1, 0.01),
];
tip(cFlat, 'Share of carried cells (photo tiles away from their original place) painted in a flat color instead. 0 = off');
tip(cFlatSub[0], 'Per tile: decide for each photo tile\nPer color: paint all tiles of the same K color together');
tip(cFlatSub[1], 'Palette: the K color the tile belongs to\nMean: the tile\'s own average color');
tip(cFlatSub[2], 'Share of regions painted in two colors: each tile is halved and each half gets its own color. The cut (horizontal, vertical or either diagonal) is picked per region to fit the photo. 0 = off');
const cDigits = f3.addBinding(CONFIG, 'digits', { label: 'Glyphs' });
const fontList = (fonts) => Object.fromEntries(Object.entries(fonts).map(([k, f]) => [f.label, k]));
const cDigitSub = [
  list(f3, 'digitBy', '　└ By', { 'Brightness': 'lum', 'State': 'state' }),
  list(f3, 'glyphSet', '　└ Set', Object.fromEntries(Object.entries(GLYPH_SETS).map(([k, g]) => [g.label, k]))),
  // フォントは文字の種類ごとに別の項目にし、使わないほうは隠す（Tweakpane は選択肢をあとから変えられない）
  list(f3, 'digitFont', '　└ Font', fontList(DIGIT_FONTS)),
  list(f3, 'kanaFont', '　└ Font', fontList(KANA_FONTS)),
  f3.addBinding(CONFIG, 'digitColor', { label: '　└ Color' }),
];
// 表示する文字：0〜9 番の切り替えを横に並べた1行（Tweakpane にない部品なので、同じ見た目の行を作って Color の下に入れる）
const cDigitShow = document.createElement('div');
cDigitShow.className = 'tp-lblv digit-show';
cDigitShow.title = 'Glyphs to draw. Cells whose glyph is off show the photo only';
cDigitShow.innerHTML = '<div class="tp-lblv_l">　└ Show</div><div class="tp-lblv_v"></div>';
for (let d = 0; d < 10; d++) {
  const el = document.createElement('label');
  el.innerHTML = `<input type="checkbox"${CONFIG.digitShow.includes(d) ? ' checked' : ''}><span>${d}</span>`;
  el.querySelector('input').addEventListener('change', () => {
    CONFIG.digitShow = [...cDigitShow.querySelectorAll('input')].flatMap((e, i) => (e.checked ? [i] : []));
    updateDigits();
  });
  cDigitShow.lastChild.appendChild(el);
}
cDigitSub[4].element.after(cDigitShow);
// ひらがなの文字：Show の代わりに入力欄（区切りで番号 0〜9。確定したら「あ,い,…」の形に書き直す）
const cKanaText = f3.addBinding(CONFIG, 'kanaText', { label: '　└ Text' });
cDigitShow.after(cKanaText.element);
cKanaText.on('change', () => {
  const t = formatGlyphText(parseGlyphText(CONFIG.kanaText));
  if (t !== CONFIG.kanaText) { CONFIG.kanaText = t; guiSync(); }
  updateDigits();
});
tip(cKanaText, 'Comma-separated, one character per glyph 0–9 (dark = 0 with Brightness). Leave a slot empty to skip that glyph, e.g. ",,,,,,,,け," draws only 8. Without commas, characters are assigned from 0 in order');
tip(cDigits, 'Square cells (Aspect ×1) only. Draws a glyph (a digit 0–9 or one of your characters) in each cell. Tiles of the same average color get the same glyph, and it moves with the tile');
tip(cDigitSub[0], 'Brightness: 10 steps by brightness, each glyph about equally common (dark = 0 / 1st character)\nState: the K color the CA sees (ones digit when K > 10)');
tip(cDigitSub[1], 'Digits: 0–9\nHiragana: the characters in Text (one per glyph 0–9)');
tip(cDigitSub[2], 'Font of the digits');
tip(cDigitSub[3], 'Font of the hiragana');
tip(cDigitSub[4], 'Color of the glyphs (same for every cell)');
const refreshDigits = () => {
  const show = isSquare() && CONFIG.digits, kana = CONFIG.glyphSet === 'kana';
  cDigits.hidden = !isSquare();
  cDigitSub.forEach((c) => { c.hidden = !show; });
  cDigitSub[2].hidden = !show || kana;
  cDigitSub[3].hidden = !show || !kana;
  cDigitShow.hidden = !show || kana;
  cKanaText.hidden = !show || !kana;
};
[cDigits, ...cDigitSub].forEach((c) => c.on('change', () => { refreshDigits(); updateDigits(); }));
cDigitSub[0].on('change', updateDigitLayers);
refreshDigits();
const refreshFlat = () => cFlatSub.forEach((c) => { c.hidden = !(CONFIG.flatRatio > 0); });
[cFlat, ...cFlatSub].forEach((c) => c.on('change', () => { refreshFlat(); updateFlat(); }));
refreshFlat();

// Shrink（試作：ノイズでマスを縮め、残りをタイルの平均色で塗る。描画だけに効く）
const fs = pane.addFolder({ title: 'Shrink' });
const cShrink = num(fs, 'shrink', 'Amount', 0, 1, 0.01);
const cShrinkSub = [
  num(fs, 'shrinkScale', '　└ Scale', 0.5, 40, 0.5),
  num(fs, 'shrinkSpeed', '　└ Speed', 0, 20, 0.1),
  num(fs, 'shrinkBias', '　└ Bias', -1, 1, 0.01),
  num(fs, 'shrinkContrast', '　└ Contrast', 0.5, 6, 0.1),
  num(fs, 'shrinkSteps', '　└ Steps', 0, 8, 1),
  list(fs, 'shrinkFill', '　└ Fill', { 'Mean': 'mean', 'Solid': 'solid' }),
  fs.addBinding(CONFIG, 'shrinkColor', { label: '　└ Color' }),
];
tip(cShrink, 'Shrinks each cell (a big cell as one) around its center by a noise field over the image, and fills the rest with the tile\'s average color. 1 = the noise value is the scale (down to nothing). 0 = off');
tip(cShrinkSub[0], 'Noise features across the short side of the image. Larger = finer');
tip(cShrinkSub[1], 'How fast the noise changes, per 100 generations (follows the generation, so it stops when paused)');
tip(cShrinkSub[2], 'Added to the noise value. + = fewer cells shrink, − = more');
tip(cShrinkSub[3], 'Spreads the noise values apart. Higher = more cells fully kept or fully shrunk');
tip(cShrinkSub[4], 'Number of size steps. 0 = smooth');
tip(cShrinkSub[5], 'Color of the space left by shrinking\nMean: the average color of the tile drawn there\nSolid: one color for every cell (Color)');
tip(cShrinkSub[6], 'Fill color of the shrunk space (Solid)');
const refreshShrink = () => {
  cShrinkSub.forEach((c) => { c.hidden = !(CONFIG.shrink > 0); });
  cShrinkSub[6].hidden = !(CONFIG.shrink > 0) || CONFIG.shrinkFill !== 'solid';
};
cShrink.on('change', () => { refreshShrink(); updateMeans(); });
cShrinkSub[5].on('change', refreshShrink);
refreshShrink();

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
const cPeriod = num(fx, 'injectPeriod', '　└ Period', 20, 360, 10);
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
const cTopology = fx.addBinding(CONFIG, 'topology', { label: 'Split / merge' });
const cTopologyInterval = num(fx, 'topologyInterval', '　└ Interval', 12, 120, 1);
onLive(cTopologyInterval, 'topologyInterval');
tip(cTopology, 'Split or merge local regions, preserving photo tiles while changing boundaries and rules. Off freezes the current layout; R restores the initial layout');
tip(cTopologyInterval, 'Generations between changes of each region (12–120). Each region waits 0.5 to 1.5 times this value: 80 means 40–120 generations, then splits itself or merges with a neighbor. Changes also scale the remaining waits');
const cLeakEnabled = fx.addBinding(CONFIG, 'leakEnabled', { label: 'Region leak' });
const cLeak = num(fx, 'leak', '　└ Amount', 0, 1, 0.05);
onLive(cLeak, 'leak');
tip(cLeakEnabled, 'Flow only. Takes in tiles from neighboring regions. Off retains the amount; tiles already carried in remain');
tip(cLeak, 'Share of the upstream edge open to neighbors. The edge is split into 4 bands, each opened or closed for 24 generations. 0 = closed, 1 = fully open. Reinject takes priority; screen edges stay closed');
const refreshFx = () => {
  cMorph.forEach((c) => { c.hidden = !FLAVORS[CONFIG.flavor].ruleMorph; });
  cPeriod.hidden = !CONFIG.inject;
  cTopologyInterval.hidden = !CONFIG.topology;
  cLeakEnabled.hidden = CONFIG.motion !== 'flow';
  cLeak.hidden = CONFIG.motion !== 'flow' || !CONFIG.leakEnabled;
  cTempoRange.forEach((c) => { c.hidden = !CONFIG.tempo; });
};
onRebuild(cFlavor, refreshFx);
onLive(cInject, 'inject', refreshFx);
onLive(cTempo, 'tempo', refreshFx);
onLive(cTopology, 'topology', refreshFx);
onLive(cLeakEnabled, 'leakEnabled', refreshFx);
refreshFx();
const cStagger = num(fx, 'stagger', 'Stagger', 0, 300, 1);
onLive(cStagger, 'stagger');
tip(cStagger, 'Each region stays as the photo until a generation between 0 and this value, then starts to break up. 0 = all regions start together. Changing it only affects regions that have not started yet');

// Pattern（基本セルオートマトンの模様を重ねる）
const fe = pane.addFolder({ title: 'Pattern' });
const cPat = num(fe, 'patFrac', 'Amount', 0, 1, 0.1);
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
// 試作：斜めに流れる領域で、模様（三角形）も一緒に斜めに流すか
tip(onLive(fe.addBinding(CONFIG, 'patSkew', { label: 'Skew' }), 'patSkew'),
  'In diagonally flowing regions, the pattern flows diagonally too (the triangles lean). Off: the pattern flows straight');

// キー操作の一覧（パネルの一番下。ボタンは置かず、操作はキーだけ）
pane.addBlade({ view: 'separator' });
{
  const keys = document.createElement('dl');
  keys.className = 'keys';
  for (const [k, v] of [['Space', 'PLAY / PAUSE'], ['N', 'NEW SEED'], ['R', 'RESET'], ['F', 'FULLSCREEN'], ['H', 'HIDE GUI'], ['S', 'SAVE PNG'], ['C', 'CAMERA']]) {
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

// PNG 書き出し：今の世代を、元写真の範囲・写真テクスチャと同じ解像度で（画面の余白・切り取りには関係しない）
// 乱数も step() も使わないので、書き出しても映像は変わらない
function savePNG() {
  if (!sim) return;
  const gen = sim.gen, seed = sim.P.seed;
  const cv = renderer.snapshot();
  if (!cv) return;
  if (CONFIG.regionBorders) borders.drawOnto(cv, renderer.grid, sim.regions); // 画面で見えているときは PNG にも入れる
  cv.toBlob((blob) => {
    if (!blob) { status = 'PNG を書き出せませんでした'; return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kuva_s${seed}_g${String(gen).padStart(6, '0')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status = `書き出し ${a.download}（${cv.width}×${cv.height}）`;
  }, 'image/png');
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
  // パネルの入れ物（.panel）・リンクごと CSS で隠す
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
  else if (k === 's') savePNG();
  else if (k === 'c') { CONFIG.camera = !CONFIG.camera; guiSync(); setCamera(CONFIG.camera); }
});

// ---------- D&D ----------
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!f.type.startsWith('image/')) { status = 'Drop an image file'; return; }
  if (camera.on) stopCamera(false);
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
