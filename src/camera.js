// camera.js — カメラ入力
// 作り直すときのフレームを「写真」として解析・初期化し、以降は写真テクスチャの中身を新しいフレームに差し替える。
// 分類（I の引き戻し先）も世代ごとに今のフレームから作り直す（main.js の feedCamera、sim.setColors）。
// パレット・代表タイル・塗りの色・数字などは作り直したときのフレームのまま

export class Camera {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.deviceId = '';  // 使っているカメラ
    this.fresh = false;  // 前回テクスチャに送ってから、新しいフレームが来たか
    this.frames = 0;     // 届いたフレーム数（fps の表示用）
  }

  get on() { return !!this.stream; }
  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }

  /** deviceId = '' なら既定のカメラ。解像度は 1920×1080 を目安に頼む（写真テクスチャの上限を超えないように） */
  async start(deviceId = '') {
    this.stop();
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.stream = stream;
    this.deviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
    this.video.srcObject = stream;
    await this.video.play();
    // 最初のフレームが届いて寸法が決まるまで待つ
    if (!this.width) await new Promise((res) => this.video.addEventListener('loadedmetadata', res, { once: true }));
    this.watch();
  }

  stop() {
    if (!this.stream) return;
    for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.fresh = false;
  }

  // 新しいフレームが来たら印を付ける（テクスチャへの転送は描画ループで1回だけ）
  watch() {
    const v = this.video, stream = this.stream;
    const tick = () => {
      if (this.stream !== stream) return;
      this.fresh = true; this.frames++;
      v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
  }

  /** 今のフレームを新しいキャンバスに写す（解析・背景用。mirror = 左右反転） */
  grab(mirror) {
    const cv = document.createElement('canvas');
    cv.width = this.width; cv.height = this.height;
    const ctx = cv.getContext('2d');
    if (mirror) ctx.setTransform(-1, 0, 0, 1, cv.width, 0);
    ctx.drawImage(this.video, 0, 0);
    return cv;
  }

  /** 使えるカメラの一覧 [{ id, label }]（許可を取ったあとでないと名前が空になる） */
  static async devices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }
}
