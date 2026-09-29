// デバッグ用の領域境界。映像とは別のキャンバスに描く。PNG 保存には drawOnto() で書き足す。
export class RegionBorders {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.previous = null;
    canvas.hidden = true;
  }

  draw(enabled, grid, regions, fit) {
    const c = this.canvas;
    c.hidden = !enabled || !grid;
    if (c.hidden) { this.previous = null; return; }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    const old = this.previous;
    // 境界・表示条件が変わったときだけ描き直す。一時停止中のリサイズにも対応。
    if (old && old.grid === grid && old.regions === regions && old.fit === fit && old.w === w && old.h === h && old.dpr === dpr) return;
    const { W, H } = grid;
    const scale = (fit === 'cover' ? Math.max : Math.min)(w / W, h / H);
    this.previous = { grid, regions, fit, w, h, dpr, scale };
    c.width = w; c.height = h;
    const dx = (w - W * scale) / 2, dy = (h - H * scale) / 2;
    stroke(this.ctx, grid, regions, dx, dy, scale, scale, dpr); // 写真の拡大率によらず 1 CSS px
  }

  // PNG 書き出し用：元写真の範囲だけを描いたキャンバス（snapshot()）に境界を重ねる。
  // 線の太さは、画面で見えている太さと写真に対して同じ割合にする（最低 1px）
  drawOnto(cv, grid, regions) {
    const { W, H } = grid;
    const sx = cv.width / W, sy = cv.height / H;
    const p = this.previous;
    const lw = p ? Math.max(1, p.dpr * Math.max(sx, sy) / p.scale) : 1;
    stroke(cv.getContext('2d'), grid, regions, 0, 0, sx, sy, lw);
  }
}

// (dx, dy) に置いた元写真（元写真 1px = sx × sy）の上に、領域の境界を描く
function stroke(ctx, grid, regions, dx, dy, sx, sy, lineWidth) {
  const { W, H, ox, oy, cw, ch } = grid;
  ctx.save();
  // パディングされたセルの境界を、元写真の範囲で切る。余白には描かない。
  ctx.beginPath(); ctx.rect(dx, dy, W * sx, H * sy); ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const g of regions) {
    ctx.rect(dx + (g.x * cw - ox) * sx, dy + (g.y * ch - oy) * sy, g.w * cw * sx, g.h * ch * sy);
  }
  ctx.stroke();
  ctx.restore();
}
