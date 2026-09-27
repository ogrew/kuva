// renderer.js — WebGL2 描画
// テクスチャは3枚：
//   写真：パディング済みグリッド全体の画像
//   src ：cols×rows の R32I。セルごとに「描く写真タイルの番号」（毎世代更新）
//   flat：cols×rows の RGBA8。タイルごとの塗りつぶしの色（A = 255 なら塗る）
// フラグメントシェーダで 画面のピクセル → セル → src → タイルの位置 → マス内の相対位置 で写真を引く。

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
uniform sampler2D uFlat;
uniform bool uFlatOn;
uniform int uCols;
uniform vec2 uGrid;     // (cols, rows)
uniform vec2 uTexSize;  // 写真テクスチャの寸法
uniform float uCanvasH;
uniform vec2 uOff;      // キャンバス座標(px) → グリッド座標(セル) の変換：g = uOff + p * uScale
uniform vec2 uScale;
uniform vec2 uImgMin;   // 元写真の範囲（グリッド座標）。外側は余白
uniform vec2 uImgMax;
out vec4 outColor;

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 g = uOff + p * uScale;
  if (any(lessThan(g, uImgMin)) || any(greaterThanEqual(g, uImgMax))) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  ivec2 c = clamp(ivec2(floor(g)), ivec2(0), ivec2(uGrid) - 1);
  int s = texelFetch(uSrc, c, 0).r;
  ivec2 si = ivec2(s % uCols, s / uCols);
  vec2 sc = vec2(si);
  // 塗りつぶし：元の位置にないタイル（CA で運ばれてきたもの）だけを塗る
  if (uFlatOn && si != c) {
    vec4 f = texelFetch(uFlat, si, 0);
    if (f.a > 0.5) { outColor = vec4(f.rgb, 1.0); return; }
  }
  // マス内の位置。隣のマスがにじまないよう、マスの内側半テクセルにクランプする
  vec2 texCell = uTexSize / uGrid;
  vec2 local = clamp(fract(g) * texCell, vec2(0.5), texCell - 0.5);
  vec2 uv = (sc * texCell + local) / uTexSize;
  // ミップマップの段は、マス境界で飛ばない連続な座標から決める（境界に線が出ないように）
  outColor = vec4(textureGrad(uPhoto, uv, dFdx(g) / uGrid, dFdy(g) / uGrid).rgb, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
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
    for (const n of ['uPhoto', 'uSrc', 'uFlat', 'uFlatOn', 'uCols', 'uGrid', 'uTexSize', 'uCanvasH', 'uOff', 'uScale', 'uImgMin', 'uImgMax']) this.u[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    this.photoTex = null; this.srcTex = null; this.flatTex = null; this.flatOn = false; this.grid = null;
  }

  // 写真テクスチャの長辺の上限
  get maxPhotoSize() { return Math.min(4096, this.maxTex); }

  /** layout = gridLayout の結果、photo = パディング済みグリッド全体のキャンバス（縮小済みでもよい） */
  setPhoto(layout, photo) {
    const gl = this.gl;
    if (this.photoTex) gl.deleteTexture(this.photoTex);
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    if (this.flatTex) gl.deleteTexture(this.flatTex);
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
    gl.bindTexture(gl.TEXTURE_2D, this.flatTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, layout.cols, layout.rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.flatOn = false;

  }

  /** colors = flatColors の結果（タイルごとの RGBA）。null なら塗らない */
  setFlat(colors) {
    this.flatOn = !!colors;
    if (!colors) return;
    const gl = this.gl, { cols, rows } = this.grid;
    gl.bindTexture(gl.TEXTURE_2D, this.flatTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, colors);
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
      gl.clearColor(0, 0, 0, 1);
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
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { cols, rows, ox, oy, W, H, cw, ch } = this.grid;
    const scale = [1 / (sx * cw), 1 / (sy * ch)]; // 描画先 1px = グリッド何セルか
    const min = [ox / cw, oy / ch];

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.photoTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.flatTex);
    const u = this.u;
    gl.uniform1i(u.uPhoto, 0);
    gl.uniform1i(u.uSrc, 1);
    gl.uniform1i(u.uFlat, 2);
    gl.uniform1i(u.uFlatOn, this.flatOn ? 1 : 0);
    gl.uniform1i(u.uCols, cols);
    gl.uniform2f(u.uGrid, cols, rows);
    gl.uniform2f(u.uTexSize, this.texSize[0], this.texSize[1]);
    gl.uniform1f(u.uCanvasH, h);
    gl.uniform2f(u.uOff, min[0] - dx * scale[0], min[1] - dy * scale[1]);
    gl.uniform2f(u.uScale, scale[0], scale[1]);
    gl.uniform2f(u.uImgMin, min[0], min[1]);
    gl.uniform2f(u.uImgMax, min[0] + W / cw, min[1] + H / ch);
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
