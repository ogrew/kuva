// renderer.js — WebGL2 描画
// テクスチャは7枚：
//   写真：パディング済みグリッド全体の画像
//   src ：cols×rows の R32I。セルごとに「描く写真タイルの番号」（毎世代更新）。負の数 ~s はタイル s の色を反転して描く（模様の Invert）
//   flat：cols×rows×(9層 × 倍率3つ) の RGBA8 配列。タイルごとの塗りつぶしの色（0層目の A = 255 なら塗る）。1〜8層目は2色塗りの半分ずつの色
//   kind：cols×rows の R8UI。描く位置ごとの2色塗りの割り方（0 = 1色、1 = 横、2 = 縦、3 = ＼、4 = ／）
//   digit：cols×rows×倍率3つ の R8UI 配列。タイルごとの数字 0〜9（マスに重ねる数字）
//   blk ：cols×rows の R8UI。描く位置ごとの倍率の番号と大きなマスの中の位置（blockCodes）
//   glyph：0〜9 の文字の形（R8 の10層、ミップマップ付き）。1層がマス1つぶん
//   mean：cols×rows×倍率3つ の RGBA8 配列。タイルごとの平均色（縮小したマスの残りを塗る色）
// フラグメントシェーダで 画面のピクセル → セル → src → タイルの位置 → マス内の相対位置 で写真を引く。
// 大きなマス（倍率 s）では、塗りつぶし・2色塗り・数字を大きなマス1つ（左上 = 描くタイル − 中の位置）として引く。
// 写真はマスごとに引く（中の各マスには「左上のタイル＋中の位置」が入っているので、つながった1枚になる）
// 擬似3D（Depth、試作）：1回目でマスの色と高さ（A）を見えない描画先に描き、2回目（DEPTH_FS）で
// 高さから影（柔らかい影）と接地の暗がり（AO）を付けて画面に描く。真上からの正射影。光の高さは 45° に固定

import { FLAT_LAYERS } from '../engine/flat.js';
import { SCALE_LIST } from '../engine/scale.js';

const VS = `#version 300 es
void main() {
  // 画面全体を覆う三角形1枚
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
uniform sampler2D uPhoto;
uniform isampler2D uSrc;
uniform highp sampler2DArray uFlat;
uniform highp usampler2D uKind;
uniform bool uFlatOn;
uniform int uCols;
uniform vec2 uGrid;     // (cols, rows)
uniform vec2 uTexSize;  // 写真テクスチャの寸法
uniform float uCanvasH;
uniform vec2 uOff;      // キャンバス座標(px) → グリッド座標(セル) の変換：g = uOff + p * uScale
uniform vec2 uScale;
uniform vec2 uImgMin;   // 元写真の範囲（グリッド座標）。外側は余白
uniform vec2 uImgMax;
uniform highp usampler2D uBlk;
uniform highp usampler2DArray uDigit;
uniform highp sampler2DArray uGlyph;
uniform bool uDigitsOn;
uniform int uDigitMask;  // 描く数字（ビット d が 1 なら数字 d を描く）
uniform vec3 uDigitColor;
uniform highp sampler2DArray uMean;
uniform bool uShrinkOn;
uniform float uShrinkAmt;   // 0 = 縮めない、1 = ノイズの値がそのまま倍率
uniform vec2 uNoiseK;       // グリッド座標 → ノイズの座標（写真の短辺 = 1 にして Scale を掛けたもの）
uniform vec3 uNoiseOff;     // seed ごとのずれ
uniform float uNoiseT;      // ノイズの時間（世代番号から決める）
uniform float uNoiseBias;
uniform float uNoiseContrast;
uniform int uNoiseSteps;    // 0 = なめらか、2 以上 = その段数に丸める
uniform vec4 uShrinkFill;   // a = 1 なら残りを全マス共通のこの色で塗る（0 ならタイルの平均色）
uniform bool uDepthOn;      // A に高さを書く（0 = 余白、1/255〜1 = 高さ 0〜DEPTH_MAX）
uniform int uDepthMode;     // 高さの式（heightOf）
uniform float uDepthW;      // 大きさの効き（0 = 色だけ。+ なら小さいマスほど高く、− なら大きいマスほど高く）
uniform float uAccent;      // 高さの緩急（タイルごとの揺らぎ・突き抜けて高いマス・極端に低いマス。0 = なし）
out vec4 outColor;
const float DEPTH_MAX = 8.0; // A に書ける高さの上限（突き抜けて高いマスの分まで）
const int FLAT_LAYERS = ${FLAT_LAYERS};
const float SCALES[${SCALE_LIST.length}] = float[](${SCALE_LIST.map((s) => s.toFixed(1)).join(', ')});

// 3D simplex noise（Ashima Arts / Stefan Gustavson, MIT）。戻り値はおよそ -1〜1
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec3 ns = 0.142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// マス（大きなマスなら大きなマス1つ）の大きさの倍率。center = マスの中心（グリッド座標）
float cellScale(vec2 center) {
  float n = snoise(vec3((center - uImgMin) * uNoiseK, uNoiseT) + uNoiseOff) * 0.5 + 0.5;
  float v = clamp((n - 0.5) * uNoiseContrast + 0.5 + uNoiseBias, 0.0, 1.0);
  if (uNoiseSteps >= 2) v = floor(v * float(uNoiseSteps) * 0.9999) / float(uNoiseSteps - 1);
  return 1.0 - uShrinkAmt * (1.0 - v);
}

// 描く位置 c にタイル si を描いたときの色（塗りつぶし、または写真）
// q = 大きなマスの中の位置（0〜1）、bo = 大きなタイルの左上、li = 倍率の番号（倍率 1 なら q = fract(g)、bo = si、li = 0）
// face = 高さを決める面の色（塗りつぶしならその色。写真なら呼ぶ側がタイルの平均色を入れておく）
vec3 tileColor(vec2 g, ivec2 c, ivec2 si, vec2 gx, vec2 gy, vec2 q, ivec2 bo, int li, inout vec3 face) {
  vec2 sc = vec2(si);
  // 塗りつぶし：元の位置にないタイル（CA で運ばれてきたもの）だけを塗る
  if (uFlatOn && si != c) {
    int L = li * FLAT_LAYERS;
    vec4 f = texelFetch(uFlat, ivec3(bo, L), 0);
    if (f.a > 0.5) {
      // 2色塗り：描く位置の領域の割り方で、大きなマスの中のどちらの半分かを決める
      uint k = texelFetch(uKind, c, 0).r;
      if (k != 0u) {
        int layer = k == 1u ? (q.y < 0.5 ? 1 : 2) : k == 2u ? (q.x < 0.5 ? 3 : 4)
                  : k == 3u ? (q.x < q.y ? 5 : 6) : (q.x + q.y < 1.0 ? 7 : 8);
        f = texelFetch(uFlat, ivec3(bo, L + layer), 0);
      }
      face = f.rgb;
      return f.rgb;
    }
  }
  // マス内の位置。隣のマスがにじまないよう、マスの内側半テクセルにクランプする
  vec2 texCell = uTexSize / uGrid;
  vec2 local = clamp(fract(g) * texCell, vec2(0.5), texCell - 0.5);
  vec2 uv = (sc * texCell + local) / uTexSize;
  return textureGrad(uPhoto, uv, gx, gy).rgb;
}

// 高さ。L = 面の明るさ（明るいほど高い）、S = マスの大きさ（基本のマス = 1）。
// uDepthW が + なら小さいほど高く、− なら大きいほど高く（S = 1 ではどちらも 1 倍）
float heightOf(float L, float S) {
  float big = pow(max(S, 0.25), -uDepthW);
  float ls = 0.5 * log2(max(S, 0.25));
  float size = clamp(uDepthW >= 0.0 ? 1.0 - ls : 1.0 + ls, 0.0, 2.0); // Sum の大きさの項（S = 1 で 1）
  if (uDepthMode == 0) return mix(L, size, abs(uDepthW));                                       // Sum：足し合わせ
  if (uDepthMode == 1) return L * big;                                                         // Product：掛け合わせ
  if (uDepthMode == 2) return min(floor(L * 5.0), 4.0) / 4.0 * big;                            // Terrace：5段
  return pow(L, 2.5) * big;                                                                    // Peak：明るいところだけ高い
}
// 高さの緩急：写真タイルごとの倍率（タイルと一緒に動く）。対数正規の揺らぎに、まれに塔（×3〜6）と穴（×0.08）を混ぜる
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float accent(ivec2 bo, int li) {
  if (uAccent <= 0.0) return 1.0;
  vec2 p = vec2(bo) + vec2(float(li) * 4099.0, 0.0);
  float z = (hash12(p) + hash12(p + 17.1) + hash12(p + 41.7) - 1.5) * 2.0; // およそ標準正規
  float m = exp(0.5 * uAccent * z);
  float d = hash12(p + 73.3);
  if (d < 0.05 * uAccent) m *= 3.0 + 3.0 * fract(d * 97.0);
  else if (d > 1.0 - 0.15 * uAccent) m *= 0.08;
  return m;
}
// A に高さを書く。低いところの差が残るよう平方根で詰める（0 = 余白、1/255〜1 = 高さ 0〜DEPTH_MAX）
vec4 emit(vec3 col, float h) {
  return uDepthOn ? vec4(col, (1.0 + sqrt(clamp(h / DEPTH_MAX, 0.0, 1.0)) * 254.0) / 255.0) : vec4(col, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 g = uOff + p * uScale;
  // ミップマップの段は、マス境界で飛ばない連続な座標から決める（境界に線が出ないように）。
  // g は画面の位置の一次式なので、微分は uScale そのもの。dFdx を使うと、隣の画素が先に return した
  // 2×2 のまとまりで値が壊れ、塗りのマスと接する写真の画素がぼやけた色（線）になる
  vec2 gx = vec2(uScale.x, 0.0) / uGrid, gy = vec2(0.0, uScale.y) / uGrid;
  // 元写真の外側（余白）は透明にして、ページの背景（写真のぼかし）を見せる
  if (any(lessThan(g, uImgMin)) || any(greaterThanEqual(g, uImgMax))) { outColor = vec4(0.0); return; }
  ivec2 c = clamp(ivec2(floor(g)), ivec2(0), ivec2(uGrid) - 1);
  int s = texelFetch(uSrc, c, 0).r;
  // 負の数は、模様の Invert：そのマス（塗り・縮めた残り・文字も）の色を反転する
  bool inv = s < 0;
  if (inv) s = ~s;
  ivec2 si = ivec2(s % uCols, s / uCols);
  // 大きなマス：倍率の番号と中の位置 → 大きなマスの中の位置 q と、大きなタイルの左上 bo
  uint b = texelFetch(uBlk, c, 0).r;
  int li = int(b & 3u);
  float bs = SCALES[li];
  ivec2 off = ivec2(int((b >> 2) & 7u), int((b >> 5) & 7u));
  vec2 q = (vec2(off) + fract(g)) / bs;
  float k = 1.0;
  // 縮小：マス（大きなマス）の中心を基準に、ノイズで決めた倍率 k で縮めた位置 g から引き直す。
  // 外側は、もとの位置に描いているタイルの平均色で塗る（描くタイル・倍率が変わる前の c, si, b で引く）
  if (uShrinkOn) {
    vec2 origin = vec2(c - off);
    k = cellScale(origin + 0.5 * bs);
    vec2 q2 = (q - 0.5) / max(k, 1e-4) + 0.5;
    ivec2 bo0 = clamp(si - off, ivec2(0), ivec2(uGrid) - 1);
    vec3 mc = uShrinkFill.a > 0.5 ? uShrinkFill.rgb : texelFetch(uMean, ivec3(bo0, li), 0).rgb;
    if (inv) mc = 1.0 - mc;
    if (k <= 0.0 || any(lessThan(q2, vec2(0.0))) || any(greaterThanEqual(q2, vec2(1.0)))) { outColor = emit(mc, 0.0); return; }
    vec2 g2 = origin + q2 * bs;
    ivec2 c2 = clamp(ivec2(floor(g2)), ivec2(0), ivec2(uGrid) - 1);
    uint b2 = texelFetch(uBlk, c2, 0).r;
    ivec2 off2 = ivec2(int((b2 >> 2) & 7u), int((b2 >> 5) & 7u));
    // 画面の右端・下端で欠けた大きなマスで、縮めた先が別のマス（大きなマスの外）になったら、そこも平均色
    if (c2 - off2 != c - off || int(b2 & 3u) != li) { outColor = emit(mc, 0.0); return; }
    g = g2; c = c2; b = b2; off = off2; q = q2;
    s = texelFetch(uSrc, c, 0).r;
    inv = s < 0;
    if (inv) s = ~s;
    si = ivec2(s % uCols, s / uCols);
    gx /= k; gy /= k;
  }
  // 倍率が変わった直後（まだ進んでいない領域）は中がそろっていないので、グリッドの内側に収める
  ivec2 bo = clamp(si - off, ivec2(0), ivec2(uGrid) - 1);
  vec3 face = texelFetch(uMean, ivec3(bo, li), 0).rgb;
  vec3 col = tileColor(g, c, si, gx, gy, q, bo, li, face);
  // 数字：描くタイルの数字を、大きなマスいっぱいの大きさで重ねる（文字の形の1層 = マス1つぶん）。
  // ミップマップの段は、マス内の位置の微分（= uScale / 倍率。縮小中はさらに / k）から決める
  if (uDigitsOn) {
    int d = int(texelFetch(uDigit, ivec3(bo, li), 0).r);
    if (((uDigitMask >> d) & 1) != 0) {
      float a = textureGrad(uGlyph, vec3(q, float(d)), vec2(gx.x * uGrid.x / bs, 0.0), vec2(0.0, gy.y * uGrid.y / bs)).r;
      col = mix(col, uDigitColor, a);
    }
  }
  if (inv) { col = 1.0 - col; face = 1.0 - face; }
  float h = uDepthOn ? heightOf(dot(face, vec3(0.299, 0.587, 0.114)), bs * k) * accent(bo, li) : 0.0;
  outColor = emit(col, h);
}`;

// 擬似3D の2回目：1回目の色と高さ（uScene の A）から、影と AO を付ける。座標は描画先の px（高さも px）
const DEPTH_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uHpx;     // 高さ DEPTH_MAX が何 px か
uniform float uCellPx;  // 基本のマス1つが何 px か（縦横の相乗平均）
uniform vec2 uLight;    // 光の来る向き（描画先の px、y は上向き）。高さは 45° 固定（1px 進むと 1px 上がる）
uniform float uSoft;    // 影の柔らかさ（0 = 固い影）
uniform float uShadow;  // 影の濃さ
uniform float uAO;      // 接地の暗がりの濃さ
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// 高さ（px）。余白（A = 0）と描画先の外は 0
float heightAt(ivec2 p, ivec2 size) {
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return 0.0;
  float a = texelFetch(uScene, p, 0).a;
  float v = (a * 255.0 - 1.0) / 254.0;
  return a == 0.0 ? 0.0 : v * v * uHpx;
}

void main() {
  ivec2 size = textureSize(uScene, 0);
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 sc = texelFetch(uScene, ip, 0);
  if (sc.a == 0.0) { outColor = vec4(0.0); return; }
  vec3 col = sc.rgb;
  float h0 = heightAt(ip, size);
  float jit = hash(gl_FragCoord.xy);

  // 影：光の向きに進みながら、光線（45°で上がる）より高いところがあるかを見る。
  // 柔らかい影は、光線とさえぎるものの高さの差 ÷ 進んだ距離 の最小値から（距離が遠いほどぼける）
  float lit = 1.0;
  float maxT = uHpx - h0;
  if (maxT > 0.5) {
    int n = int(min(160.0, ceil(maxT / max(1.0, uCellPx * 0.3))));
    float dt = maxT / float(n);
    float kk = mix(0.02, 1.2, uSoft);
    for (int i = 0; i < n; i++) {
      float t = (float(i) + jit) * dt + 0.5;
      float hs = heightAt(ivec2(gl_FragCoord.xy + uLight * t), size);
      float d = h0 + t - hs;
      lit = min(lit, d / (kk * t));
      if (lit <= 0.0) break;
    }
    lit = clamp(lit, 0.0, 1.0);
    lit = lit * lit * (3.0 - 2.0 * lit);
  }

  // AO：まわりの高いところ（壁の根元）ほど暗く。8方向 × 3つの半径
  float occ = 0.0, wsum = 0.0;
  float R = min(uCellPx, uHpx) * 0.8;
  for (int j = 0; j < 3; j++) {
    float r = R * (0.15 + 0.35 * float(j) * float(j)) + 1.0;
    float w = 1.0 / (1.0 + float(j));
    for (int a = 0; a < 8; a++) {
      float ang = (float(a) + jit) * 0.785398 + float(j) * 0.4;
      float hs = heightAt(ivec2(gl_FragCoord.xy + vec2(cos(ang), sin(ang)) * r), size);
      occ += clamp((hs - h0) / r, 0.0, 1.0) * w;
      wsum += w;
    }
  }
  float ao = 1.0 - uAO * clamp(occ / wsum * 1.6, 0.0, 1.0);

  // 影の色：暗くするだけでなく、色を濃くする（安い CG っぽい灰色の影にしない）
  vec3 shade = pow(col, vec3(1.6)) * 0.55;
  col = mix(col, shade, uShadow * (1.0 - lit));
  col *= ao;
  outColor = vec4(col, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl; this.canvas = canvas;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = {};
    for (const n of ['uPhoto', 'uSrc', 'uFlat', 'uKind', 'uFlatOn', 'uBlk', 'uDigit', 'uGlyph', 'uDigitsOn', 'uDigitMask', 'uDigitColor', 'uMean', 'uShrinkOn', 'uShrinkAmt', 'uNoiseK', 'uNoiseOff', 'uNoiseT', 'uNoiseBias', 'uNoiseContrast', 'uNoiseSteps', 'uShrinkFill', 'uDepthOn', 'uDepthMode', 'uDepthW', 'uAccent', 'uCols', 'uGrid', 'uTexSize', 'uCanvasH', 'uOff', 'uScale', 'uImgMin', 'uImgMax']) this.u[n] = gl.getUniformLocation(prog, n);
    const dprog = gl.createProgram();
    gl.attachShader(dprog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(dprog, sh(gl.FRAGMENT_SHADER, DEPTH_FS));
    gl.linkProgram(dprog);
    if (!gl.getProgramParameter(dprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(dprog));
    this.dprog = dprog;
    this.du = {};
    for (const n of ['uScene', 'uHpx', 'uCellPx', 'uLight', 'uSoft', 'uShadow', 'uAO']) this.du[n] = gl.getUniformLocation(dprog, n);
    this.depth = null; this.scene = null;
    this.vao = gl.createVertexArray();
    this.photoTex = null; this.srcTex = null; this.flatTex = null; this.kindTex = null; this.blkTex = null; this.flatOn = false; this.grid = null;
    this.digitTex = null; this.glyphTex = null; this.digitsOn = false; this.digitColor = [1, 1, 1]; this.digitMask = 0;
    this.meanTex = null; this.shrink = null;
  }

  // 写真テクスチャの長辺の上限
  get maxPhotoSize() { return Math.min(4096, this.maxTex); }

  /** layout = gridLayout の結果、photo = パディング済みグリッド全体のキャンバス（縮小済みでもよい） */
  setPhoto(layout, photo) {
    const gl = this.gl;
    if (this.photoTex) gl.deleteTexture(this.photoTex);
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    if (this.flatTex) gl.deleteTexture(this.flatTex);
    if (this.kindTex) gl.deleteTexture(this.kindTex);
    if (this.digitTex) gl.deleteTexture(this.digitTex);
    if (this.blkTex) gl.deleteTexture(this.blkTex);
    if (this.meanTex) gl.deleteTexture(this.meanTex);
    this.grid = layout;
    this.texSize = [photo.width, photo.height];

    this.photoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, photo);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, layout.cols, layout.rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.flatTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flatTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, layout.cols, layout.rows, FLAT_LAYERS * SCALE_LIST.length);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.flatOn = false;

    this.kindTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.kindTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, layout.cols, layout.rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.digitTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.digitTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, layout.cols, layout.rows, SCALE_LIST.length);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // 倍率の番号と中の位置。最初はすべて倍率 1（0）
    this.blkTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blkTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, layout.cols, layout.rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.setBlocks(new Uint8Array(layout.cols * layout.rows));

    this.meanTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.meanTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, layout.cols, layout.rows, SCALE_LIST.length);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /** li = 倍率の番号（SCALE_LIST）、mean = その倍率のタイルごとの平均色（Float32Array、セル数 × 3） */
  setMeans(li, mean) {
    const gl = this.gl, { cols, rows } = this.grid, N = cols * rows;
    const px = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      px[i * 4] = mean[i * 3]; px[i * 4 + 1] = mean[i * 3 + 1]; px[i * 4 + 2] = mean[i * 3 + 2]; px[i * 4 + 3] = 255;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.meanTex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, li, cols, rows, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }

  /**
   * マスの縮小。null なら縮めない。
   * { amount, scale（写真の短辺あたりのノイズの数）, time, bias, contrast, steps, seed,
   *   fill（残りを塗る色 [r, g, b]（0〜1）。null ならタイルの平均色） }
   */
  setShrink(p) { this.shrink = p && p.amount > 0 ? p : null; }

  /**
   * 擬似3D（試作）。null なら平らに描く。
   * { height（基本のマスの幅の何倍まで。rise を掛ける）, mode（高さの式の番号）, weight（大きさの効き）,
   *   accent（高さの緩急）, light（光の来る向き。度、0 = 上・時計回り）, soft, shadow, ao（0〜1） }
   */
  setDepth(p) { this.depth = p && p.height > 0 ? p : null; }

  // 1回目の描画先（色と高さ）。大きさが変わったら作り直す
  sceneTarget(w, h) {
    const gl = this.gl;
    if (this.scene && this.scene.w === w && this.scene.h === h) return this.scene;
    if (this.scene) { gl.deleteFramebuffer(this.scene.fb); gl.deleteTexture(this.scene.tex); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.scene = { w, h, tex, fb };
    return this.scene;
  }

  /** 写真テクスチャの中身だけを差し替える（カメラ入力。photo は setPhoto と同じ寸法のキャンバス） */
  updatePhoto(photo) {
    const gl = this.gl;
    if (!this.photoTex || photo.width !== this.texSize[0] || photo.height !== this.texSize[1]) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, photo);
    gl.generateMipmap(gl.TEXTURE_2D);
    return true;
  }

  /** codes = blockCodes の結果（描く位置ごとの倍率の番号と中の位置） */
  setBlocks(codes) {
    const gl = this.gl, { cols, rows } = this.grid;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.blkTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, codes);
  }

  /** li = 倍率の番号（SCALE_LIST）、digits = その倍率の tileDigits の結果（タイルごとの数字 0〜9） */
  setDigits(li, digits) {
    const gl = this.gl, { cols, rows } = this.grid;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.digitTex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, li, cols, rows, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, digits);
  }

  /** 0〜9 の文字の形。data = size×size×10 の濃さ（0〜255、size は2の累乗）。写真とは関係ないので、写真を入れ替えても残す */
  setGlyphs(data, size) {
    const gl = this.gl;
    if (this.glyphTex) gl.deleteTexture(this.glyphTex);
    this.glyphTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.glyphTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, gl.R8, size, size, 10);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, size, size, 10, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** on = 数字を描くか（文字の形がまだなければ描かない）、color = [r, g, b]（0〜1）、mask = 描く数字のビット */
  setDigitStyle(on, color, mask) {
    this.digitsOn = on;
    this.digitColor = color;
    this.digitMask = mask;
  }

  /** on = 塗るか、kinds = splitKinds の結果（on のときだけ） */
  setFlat(on, kinds) {
    this.flatOn = on;
    if (!on) return;
    const gl = this.gl, { cols, rows } = this.grid;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.kindTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, kinds);
  }

  /** li = 倍率の番号（SCALE_LIST）、colors = その倍率の flatColors の結果（層ごとのタイルの RGBA） */
  setFlatColors(li, colors) {
    const gl = this.gl, { cols, rows } = this.grid;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flatTex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, li * FLAT_LAYERS, cols, rows, FLAT_LAYERS, gl.RGBA, gl.UNSIGNED_BYTE, colors);
  }

  setSrc(src) {
    const gl = this.gl, { cols, rows } = this.grid;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED_INTEGER, gl.INT, src);
  }

  // キャンバスの画素数を表示サイズ × devicePixelRatio に合わせる
  resize() {
    const c = this.canvas, d = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * d), h = Math.round(c.clientHeight * d);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  /** fit = 'contain'（全体を収める・余白） | 'cover'（埋める・切り取り） */
  draw(fit) {
    const gl = this.gl, c = this.canvas;
    this.resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.grid) {
      gl.viewport(0, 0, c.width, c.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const { W, H } = this.grid;
    // 写真 1px をキャンバス何 px で描くか
    const s = (fit === 'cover' ? Math.max : Math.min)(c.width / W, c.height / H);
    this.drawTo(c.width, c.height, s, s, (c.width - W * s) / 2, (c.height - H * s) / 2);
  }

  // 今バインドされている描画先（w×h px）に描く。sx, sy = 写真 1px を描画先の何 px にするか、dx, dy = 写真の左上の位置
  drawTo(w, h, sx, sy, dx, dy) {
    const dp = this.depth;
    if (!dp) { this.drawBase(w, h, sx, sy, dx, dy, false); return; }
    const gl = this.gl, target = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const sc = this.sceneTarget(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fb);
    this.drawBase(w, h, sx, sy, dx, dy, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { cw, ch } = this.grid, du = this.du;
    const cellPx = Math.sqrt(sx * cw * sy * ch);
    const a = (dp.light * Math.PI) / 180;
    gl.useProgram(this.dprog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.tex);
    gl.uniform1i(du.uScene, 0);
    gl.uniform1f(du.uHpx, dp.height * 8 * cellPx); // 8 = シェーダの DEPTH_MAX
    gl.uniform1f(du.uCellPx, cellPx);
    gl.uniform2f(du.uLight, Math.sin(a), Math.cos(a));
    gl.uniform1f(du.uSoft, dp.soft);
    gl.uniform1f(du.uShadow, dp.shadow);
    gl.uniform1f(du.uAO, dp.ao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // depth = A に高さを書く（擬似3D の1回目）
  drawBase(w, h, sx, sy, dx, dy, depth) {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { cols, rows, ox, oy, W, H, cw, ch } = this.grid;
    const scale = [1 / (sx * cw), 1 / (sy * ch)]; // 描画先 1px = グリッド何セルか
    const min = [ox / cw, oy / ch];

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.flatTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.kindTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.digitTex);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.glyphTex);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.blkTex);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.meanTex);
    const u = this.u;
    gl.uniform1i(u.uPhoto, 0);
    gl.uniform1i(u.uSrc, 1);
    gl.uniform1i(u.uFlat, 2);
    gl.uniform1i(u.uKind, 3);
    gl.uniform1i(u.uFlatOn, this.flatOn ? 1 : 0);
    gl.uniform1i(u.uDigit, 4);
    gl.uniform1i(u.uGlyph, 5);
    gl.uniform1i(u.uBlk, 6);
    gl.uniform1i(u.uDigitsOn, this.digitsOn && this.glyphTex ? 1 : 0);
    gl.uniform3fv(u.uDigitColor, this.digitColor);
    gl.uniform1i(u.uDigitMask, this.digitMask);
    gl.uniform1i(u.uCols, cols);
    gl.uniform2f(u.uGrid, cols, rows);
    gl.uniform2f(u.uTexSize, this.texSize[0], this.texSize[1]);
    gl.uniform1f(u.uCanvasH, h);
    gl.uniform2f(u.uOff, min[0] - dx * scale[0], min[1] - dy * scale[1]);
    gl.uniform2f(u.uScale, scale[0], scale[1]);
    gl.uniform2f(u.uImgMin, min[0], min[1]);
    gl.uniform2f(u.uImgMax, min[0] + W / cw, min[1] + H / ch);
    gl.uniform1i(u.uMean, 7);
    gl.uniform1i(u.uDepthOn, depth ? 1 : 0);
    if (depth) {
      gl.uniform1i(u.uDepthMode, this.depth.mode);
      gl.uniform1f(u.uDepthW, this.depth.weight);
      gl.uniform1f(u.uAccent, this.depth.accent);
    }
    const sk = this.shrink;
    gl.uniform1i(u.uShrinkOn, sk ? 1 : 0);
    if (sk) {
      const k = sk.scale / Math.min(W, H); // 元写真 1px あたりのノイズの座標
      // seed ごとのずれ（大きな値だと精度が落ちるので 0〜100 に収める）
      const h = (x) => ((Math.imul(sk.seed ^ x, 0x9E3779B1) >>> 0) % 100000) / 1000;
      gl.uniform1f(u.uShrinkAmt, Math.min(1, sk.amount));
      gl.uniform2f(u.uNoiseK, cw * k, ch * k);
      gl.uniform3f(u.uNoiseOff, h(0x51), h(0x2C7), h(0x1F3));
      gl.uniform1f(u.uNoiseT, sk.time);
      gl.uniform1f(u.uNoiseBias, sk.bias);
      gl.uniform1f(u.uNoiseContrast, sk.contrast);
      gl.uniform1i(u.uNoiseSteps, sk.steps);
      const f = sk.fill;
      gl.uniform4f(u.uShrinkFill, f ? f[0] : 0, f ? f[1] : 0, f ? f[2] : 0, f ? 1 : 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 今の世代を、元写真の範囲だけ・写真テクスチャと同じ解像度で描いて、2D キャンバスで返す（画面の表示には関係しない）
  snapshot() {
    if (!this.grid) return null;
    const gl = this.gl, { W, H, GW } = this.grid;
    const k = this.texSize[0] / GW; // 元写真 1px = 写真テクスチャ何 px か
    const lim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    const f = Math.min(k, lim / Math.max(W, H));
    const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));

    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const px = new Uint8Array(w * h * 4);
    try {
      // 縦横を別々に合わせて、端まで写真で埋める（丸めで余白の線が出ないように）
      this.drawTo(w, h, w / W, h / H, 0, 0);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteRenderbuffer(rb);
    }
    // readPixels は下の行から並ぶので、上下を入れ替える
    const img = new ImageData(w, h), row = w * 4;
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').putImageData(img, 0, 0);
    return cv;
  }
}
