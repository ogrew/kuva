// glyphs.js — マスに重ねる文字（数字 0〜9、またはひらがな あ〜こ）の形を作る（Canvas 2D。写真やグリッドとは関係ない）
// 1文字 = size×size の正方形1枚（マス1つぶん）。番号 d（0〜9）の文字を d 枚目に描く。
//   フォントで描くもの：10文字で同じ文字サイズにし、10文字の外形の最大の幅・高さがちょうど正方形に収まる大きさにする。
//                       各文字は自分の外形で中央に置く
//   コードで描くもの（7セグ・ドット）：図形として描く。フォントの読み込みがいらず、オフラインでも同じ見た目

// 7セグ：点灯する区画（a = 上、b = 右上、c = 右下、d = 下、e = 左下、f = 左上、g = 中央）
const SEG7 = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function drawSeg7(cx, d, S) {
  const W = S * 0.56, t = S * 0.13, gap = S * 0.012;
  const L = (S - W) / 2 + t / 2, R = (S + W) / 2 - t / 2, T = t / 2, M = S / 2, B = S - t / 2;
  // 両端をとがらせた細長い六角形。(x0, y0) → (x1, y1) は水平か垂直
  const seg = (x0, y0, x1, y1) => {
    const h = y0 === y1, a = t / 2;
    if (h) { x0 += gap; x1 -= gap; } else { y0 += gap; y1 -= gap; }
    cx.beginPath();
    if (h) {
      cx.moveTo(x0, y0); cx.lineTo(x0 + a, y0 - a); cx.lineTo(x1 - a, y0 - a);
      cx.lineTo(x1, y0); cx.lineTo(x1 - a, y0 + a); cx.lineTo(x0 + a, y0 + a);
    } else {
      cx.moveTo(x0, y0); cx.lineTo(x0 + a, y0 + a); cx.lineTo(x0 + a, y1 - a);
      cx.lineTo(x0, y1); cx.lineTo(x0 - a, y1 - a); cx.lineTo(x0 - a, y0 + a);
    }
    cx.closePath(); cx.fill();
  };
  const P = { a: [L, T, R, T], b: [R, T, R, M], c: [R, M, R, B], d: [L, B, R, B], e: [L, M, L, B], f: [L, T, L, M], g: [L, M, R, M] };
  for (const s of SEG7[d]) seg(...P[s]);
}

// ドット 5×7（LED の電光掲示板の数字）。1行 = 5桁の2進数
const DOT57 = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [31, 2, 4, 2, 1, 17, 14],
  [2, 6, 10, 18, 31, 2, 2], [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8],
  [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12],
];
function drawDot57(cx, d, S) {
  const p = S / 7, r = p * 0.42, x0 = (S - 5 * p) / 2;
  DOT57[d].forEach((row, y) => {
    for (let x = 0; x < 5; x++) {
      if (!(row >> (4 - x) & 1)) continue;
      cx.beginPath(); cx.arc(x0 + (x + 0.5) * p, (y + 0.5) * p, r, 0, Math.PI * 2); cx.fill();
    }
  });
}

// 文字の種類。番号 0〜9 に割り当てる10文字
export const GLYPH_SETS = {
  digits: { label: 'Digits', chars: '0123456789' },
  kana: { label: 'Hiragana', chars: 'あいうえおかきくけこ' },
};

// GUI のフォントの選択肢（文字の種類ごと）。web = Web フォントの名前（index.html で使う文字だけ読み込んでいる）、draw = コードで描く
export const DIGIT_FONTS = {
  grotesk: { label: 'Grotesk', css: '"Space Grotesk", sans-serif', web: 'Space Grotesk', weight: 700 },
  mono: { label: 'Mono', css: 'Menlo, Consolas, "Courier New", monospace', weight: 700 },
  seg7: { label: '7-segment', draw: drawSeg7 },
  dot: { label: 'Dot 5×7', draw: drawDot57 },
  silkscreen: { label: 'Silkscreen', css: '"Silkscreen", monospace', web: 'Silkscreen', weight: 400 },
  orbitron: { label: 'Orbitron', css: '"Orbitron", sans-serif', web: 'Orbitron', weight: 700 },
};
// ひらがな：デジタルっぽいもの（ドット）と、パネルと同じもの（M PLUS 1p はパネル用に読み込み済み）
export const KANA_FONTS = {
  dotgothic: { label: 'DotGothic16', css: '"DotGothic16", sans-serif', web: 'DotGothic16', weight: 400 },
  mplus: { label: 'M PLUS 1p', css: '"M PLUS 1p", sans-serif', web: 'M PLUS 1p', weight: 700 },
};
const FONTS = { digits: DIGIT_FONTS, kana: KANA_FONTS };
const DEFAULT_FONT = { digits: 'silkscreen', kana: 'dotgothic' };
export const GLYPH_SIZE = 256;

/**
 * 文字の形を作る。set = 文字の種類（GLYPH_SETS）、key = その種類のフォント（DIGIT_FONTS・KANA_FONTS）。
 * Web フォントは読み込みを待つ（オフラインなどで読めなければ、代わりのフォントで描く）
 */
export async function makeGlyphs(set, key, size = GLYPH_SIZE) {
  const fonts = FONTS[set] || FONTS.digits, chars = [...(GLYPH_SETS[set] || GLYPH_SETS.digits).chars];
  const f = fonts[key] || fonts[DEFAULT_FONT[set] || 'silkscreen'];
  if (f.web) {
    try { await document.fonts.load(`${f.weight} 100px "${f.web}"`, chars.join('')); } catch { /* 代わりのフォントで描く */ }
  }
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff';
  const out = new Uint8Array(size * size * 10);
  const grab = (d) => {
    const px = cx.getImageData(0, 0, size, size).data;
    for (let i = 0, o = d * size * size; i < size * size; i++) out[o + i] = px[i * 4 + 3];
  };
  if (f.draw) {
    for (let d = 0; d < 10; d++) { cx.clearRect(0, 0, size, size); f.draw(cx, d, size); grab(d); }
    return out;
  }
  // 基準の大きさで10文字の外形を測り、いちばん大きい幅・高さが size に収まるよう拡大する
  const REF = 100;
  cx.font = `${f.weight} ${REF}px ${f.css}`;
  const ms = chars.map((ch) => cx.measureText(ch));
  let mw = 0, mh = 0;
  for (const m of ms) {
    mw = Math.max(mw, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    mh = Math.max(mh, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  }
  const k = size / Math.max(mw, mh, 1);
  cx.font = `${f.weight} ${REF * k}px ${f.css}`;
  for (let d = 0; d < 10; d++) {
    const m = ms[d];
    cx.clearRect(0, 0, size, size);
    // 外形の中心を正方形の中心に合わせる（textAlign = left、textBaseline = alphabetic の基準点から）
    const x = size / 2 - ((m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2) * k;
    const y = size / 2 + ((m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2) * k;
    cx.fillText(chars[d], x, y);
    grab(d);
  }
  return out;
}
