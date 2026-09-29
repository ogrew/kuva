// image.js — 画像の読み込みと、グリッドに合わせた下ごしらえ（kivi sketch.js から流用）

export async function loadBitmap(blob) {
  return createImageBitmap(blob);
}

/**
 * グリッド配置。入力 W×H を覆うだけのマス（cw×ch）を並べ、中央寄せにする（四辺のマスが少しずつ欠ける）。
 */
export function gridLayout(W, H, cw, ch) {
  const cols = Math.ceil(W / cw), rows = Math.ceil(H / ch);
  const GW = cols * cw, GH = rows * ch;
  return { cols, rows, GW, GH, ox: Math.floor((GW - W) / 2), oy: Math.floor((GH - H) / 2), W, H, cw, ch };
}

// マス目がちょうど収まる大きさ (GW×GH) のキャンバスに、元画像を中央寄せで置く。
// はみ出す余白は画像の端のピクセルを引き延ばして埋める（端のマスの色解析と描画用）。
export function paddedCanvas(img, g) {
  const cv = document.createElement('canvas');
  cv.width = g.GW; cv.height = g.GH;
  drawPadded(cv.getContext('2d', { willReadFrequently: true }), img, g);
  return cv;
}

// GW×GH のキャンバスの ctx に、元画像を中央寄せで置いて余白を埋める（カメラ入力では毎フレーム同じキャンバスに描く）。
// mirror = 左右反転して置く
export function drawPadded(ctx, img, g, mirror = false) {
  const { GW, GH, ox, oy, W, H } = g, cv = ctx.canvas;
  ctx.imageSmoothingEnabled = false;
  if (mirror) {
    ctx.setTransform(-1, 0, 0, 1, 2 * ox + W, 0);
    ctx.drawImage(img, ox, oy, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else ctx.drawImage(img, ox, oy, W, H);
  // 余白は、置いた画像の端の1列・1行を引き延ばす
  const r = GW - ox - W, b = GH - oy - H;
  if (ox > 0) ctx.drawImage(cv, ox, oy, 1, H, 0, oy, ox, H);
  if (r > 0) ctx.drawImage(cv, ox + W - 1, oy, 1, H, ox + W, oy, r, H);
  if (oy > 0) ctx.drawImage(cv, 0, oy, GW, 1, 0, 0, GW, oy);
  if (b > 0) ctx.drawImage(cv, 0, oy + H - 1, GW, 1, 0, oy + H, GW, b);
}

// キャンバス全体を (dw, dh) に縮小したキャンバスを返す
export function scaledCanvas(cv, dw, dh) {
  const out = document.createElement('canvas');
  out.width = dw; out.height = dh;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, dw, dh);
  return out;
}

export const pixelsOf = (cv) => cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
