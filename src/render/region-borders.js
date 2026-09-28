// デバッグ用の領域境界。映像とは別のキャンバスなので PNG 保存には入らない。
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
    this.previous = { grid, regions, fit, w, h, dpr };
    c.width = w; c.height = h;
    const { W, H, ox, oy, cw, ch } = grid;
    const scale = (fit === 'cover' ? Math.max : Math.min)(w / W, h / H);
    const dx = (w - W * scale) / 2, dy = (h - H * scale) / 2;
    const ctx = this.ctx;
    ctx.save();
    // パディングされたセルの境界を、元写真の範囲で切る。余白には描かない。
    ctx.beginPath(); ctx.rect(dx, dy, W * scale, H * scale); ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = dpr; // 写真の拡大率によらず 1 CSS px
    ctx.beginPath();
    for (const g of regions) {
      ctx.rect(dx + (g.x * cw - ox) * scale, dy + (g.y * ch - oy) * scale, g.w * cw * scale, g.h * ch * scale);
    }
    ctx.stroke();
    ctx.restore();
  }
}
