// image.js — 画像の読み込みと、グリッドに合わせた下ごしらえ（kivi sketch.js から流用）

export async function loadBitmap(blob) {
  return createImageBitmap(blob);
}

/**
 * グリッド配置。入力 W×H を覆うだけのマス（cell×cell）を並べ、中央寄せにする（四辺のマスが少しずつ欠ける）。
 */
export function gridLayout(W, H, cell) {
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const GW = cols * cell, GH = rows * cell;
  return { cols, rows, GW, GH, ox: Math.floor((GW - W) / 2), oy: Math.floor((GH - H) / 2), W, H, cell };
}

// マス目がちょうど収まる大きさ (GW×GH) のキャンバスに、元画像を中央寄せで置く。
// はみ出す余白は画像の端のピクセルを引き延ばして埋める（端のマスの色解析と描画用）。
export function paddedCanvas(img, g) {
  const { GW, GH, ox, oy, W, H } = g;
  const cv = document.createElement('canvas');
  cv.width = GW; cv.height = GH;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ox, oy);
  const r = GW - ox - W, b = GH - oy - H;
  if (ox > 0) ctx.drawImage(img, 0, 0, 1, H, 0, oy, ox, H);
  if (r > 0) ctx.drawImage(img, W - 1, 0, 1, H, ox + W, oy, r, H);
  if (oy > 0) ctx.drawImage(cv, 0, oy, GW, 1, 0, 0, GW, oy);
  if (b > 0) ctx.drawImage(cv, 0, oy + H - 1, GW, 1, 0, oy + H, GW, b);
  return cv;
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
