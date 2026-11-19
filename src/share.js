// share.js — Share：パラメータを URL のクエリにする・URL のクエリから戻す
// 写真・カメラ・世代は引き継がない。既定値と同じ項目は書かない（URL を短くするため。既定値が変われば見え方も変わってよい）
// 値の形は既定値の型で決める：数 → そのまま、真偽 → 1/0、配列 → カンマ区切り、文字列 → そのまま

const encodeValue = (v) => (typeof v === 'boolean' ? (v ? '1' : '0') : Array.isArray(v) ? v.join(',') : String(v));
const same = (a, b) => encodeValue(a) === encodeValue(b);

// config のうち、skip 以外で defaults と違うもの（always は常に）をクエリにする。extra は先頭に足す項目
export function encodeParams(config, defaults, { skip = [], always = [], extra = {} } = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  for (const k of Object.keys(defaults)) {
    if (skip.includes(k)) continue;
    if (always.includes(k) || !same(config[k], defaults[k])) q.set(k, encodeValue(config[k]));
  }
  return q;
}

// クエリから defaults にある項目（skip 以外）を読む。型が合わないものは捨てる（範囲や選択肢の確認は呼ぶ側で）
export function decodeParams(search, defaults, { skip = [] } = {}) {
  const q = new URLSearchParams(search), out = {};
  for (const [k, s] of q) {
    if (!(k in defaults) || skip.includes(k)) continue;
    const d = defaults[k];
    if (typeof d === 'number') {
      const v = Number(s);
      if (s.trim() !== '' && Number.isFinite(v)) out[k] = v;
    } else if (typeof d === 'boolean') {
      if (s === '1' || s === 'true') out[k] = true;
      else if (s === '0' || s === 'false') out[k] = false;
    } else if (Array.isArray(d)) {
      out[k] = s.split(',').filter((x) => x.trim() !== '').map(Number).filter(Number.isInteger);
    } else if (typeof d === 'string') {
      if (s.length <= 200) out[k] = s;
    }
  }
  return out;
}
