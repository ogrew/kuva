// 開発サーバ用の比較ページ。通常のアプリと同じエンジン・描画を使う。
import { Simulation } from '../src/engine/sim.js';
import { Renderer } from '../src/render/renderer.js';
import { gridLayout, paddedCanvas, scaledCanvas, pixelsOf } from '../src/image.js';
import sample from '../samples/sample01.png?url';

// M で切り替える初期の分け方
const layouts = [
  { name: 'BSP', regionLayout: 'bsp' },
  { name: 'Quadtree', regionLayout: 'quadtree' },
];
export const studies = [
  { title: '従来', topology: false, leak: 0 },
  { title: '分裂・合体', topology: true, leak: 0 },
  { title: '隣からの漏れ', topology: false, leak: 0.6 },
  { title: '分裂・合体 ＋ 漏れ', topology: true, leak: 0.6 },
];
let bitmap, layout, io, photo, running = true, outlines = false, layoutIndex = 0, acc = 0, last = 0, loadSeq = 0;
const status = document.querySelector('#status');
window.studies = studies; // コンソールから調べる用
for (const item of studies) {
  const article = document.createElement('article');
  article.innerHTML = `<h2>${item.title}<span class="count"></span></h2><div class="frame"><canvas class="image"></canvas><canvas class="outline"></canvas></div>`;
  document.querySelector('main').append(article);
  item.renderer = new Renderer(article.querySelector('.image'));
  item.outline = article.querySelector('.outline');
  item.count = article.querySelector('.count');
  item.frame = article.querySelector('.frame');
}

export function reset() {
  if (!io) return;
  for (const item of studies) {
    item.sim = new Simulation({ seed: 42, K: 7, chaos: 0.15, motion: 'flow', regionLayout: layouts[layoutIndex].regionLayout, ruleMorph: true, regionRules: false,
      topology: item.topology, leakEnabled: item.leak > 0, leak: item.leak, inject: false, tempo: false, patFrac: 0 }, io);
    item.renderer.setPhoto(layout, photo);
  }
  acc = 0;
  draw();
}
export function advance(n = 1) {
  if (!io) return;
  for (let k = 0; k < n; k++) for (const item of studies) item.sim.step();
  draw();
}
function draw() {
  for (const item of studies) {
    if (!item.sim) continue;
    item.renderer.setSrc(item.sim.displaySrc());
    item.renderer.draw('contain');
    const { split, merge } = item.sim.topologyEvents;
    item.count.textContent = `${item.sim.regions.length}領域` + (item.topology ? ` / 分裂${split}・合体${merge}` : '');
    const c = item.outline, ctx = c.getContext('2d');
    c.width = item.renderer.canvas.width; c.height = item.renderer.canvas.height;
    if (outlines) {
      const scale = Math.min(c.width / layout.W, c.height / layout.H);
      const dx = (c.width - layout.W * scale) / 2 - layout.ox * scale;
      const dy = (c.height - layout.H * scale) / 2 - layout.oy * scale;
      ctx.strokeStyle = '#ffffffa0'; ctx.lineWidth = devicePixelRatio || 1;
      for (const g of item.sim.regions) ctx.strokeRect(dx + g.x * layout.cw * scale, dy + g.y * layout.ch * scale, g.w * layout.cw * scale, g.h * layout.ch * scale);
    }
  }
  status.textContent = `${running ? '再生中' : '停止'} / ${studies[0].sim?.gen ?? 0}世代 / seed 42 / 初期の分け方 ${layouts[layoutIndex].name} / 境界線${outlines ? 'ON' : 'OFF'}`;
}
async function load(blob) {
  const seq = ++loadSeq;
  const next = await createImageBitmap(blob);
  if (seq !== loadSeq) { next.close(); return; }
  bitmap?.close(); bitmap = next;
  const cell = Math.max(4, Math.round(Math.min(bitmap.width, bitmap.height) / (Number(new URLSearchParams(location.search).get('cells')) || 72))); // ?cells= で短辺のマス数
  layout = gridLayout(bitmap.width, bitmap.height, cell, cell);
  const padded = paddedCanvas(bitmap, layout), sub = 4;
  io = { cols: layout.cols, rows: layout.rows, cw: cell, ch: cell, Ax: sub, Ay: sub,
    analysis: { data: pixelsOf(scaledCanvas(padded, layout.cols * sub, layout.rows * sub)), stride: layout.cols * sub } };
  const limit = Math.min(...studies.map(i => i.renderer.maxPhotoSize));
  const scale = Math.min(1, limit / Math.max(layout.GW, layout.GH));
  photo = scale < 1 ? scaledCanvas(padded, Math.round(layout.GW * scale), Math.round(layout.GH * scale)) : padded;
  for (const item of studies) item.frame.style.aspectRatio = `${bitmap.width} / ${bitmap.height}`;
  reset();
}
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); running = !running; acc = 0; draw(); }
  if (e.key.toLowerCase() === 'r') reset();
  if (e.key.toLowerCase() === 'b') { outlines = !outlines; draw(); }
  if (e.key.toLowerCase() === 'm') { layoutIndex = (layoutIndex + 1) % layouts.length; reset(); }
});
window.addEventListener('resize', draw);
document.addEventListener('visibilitychange', () => { if (document.hidden) { running = false; acc = 0; draw(); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) load(file).catch(() => { status.textContent = '写真を読み込めませんでした'; });
});
function frame(now) {
  if (running && io) {
    acc += Math.min((now - last) / 1000, 0.25) * 12;
    const n = Math.min(8, Math.floor(acc));
    if (n) { acc -= n; advance(n); }
  }
  last = now;
  requestAnimationFrame(frame);
}
fetch(sample).then(r => r.blob()).then(load).catch(() => { status.textContent = '写真を読み込めませんでした'; });
requestAnimationFrame(frame);
