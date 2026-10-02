// 画面全体を作り直さず、領域ごとのタイミングで分裂・合体する。
import { hash, mulberry32 } from './rng.js';
import { applyChaos } from './rules.js';
import { MOTIONS } from './motions.js';
import { alignCut } from './regions.js';

// 長方形になる、辺全体を共有した組だけ合体できる。
export function unionRect(a, b) {
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x))
    return [Math.min(a.x, b.x), a.y, a.w + b.w, a.h];
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y))
    return [a.x, Math.min(a.y, b.y), a.w, a.h + b.h];
  return null;
}

// 領域ごとの乱数（topoN 回目）。既存のルール・テンポ用乱数を消費しない。
function topologyRng(P, g) {
  return mulberry32(hash(P.seed, g.index, g.topoN++, 0x73706c69));
}

// 次に組み替えを試すまでの世代数：間隔の0.5〜1.5倍
export function topologyWait(P, rng) {
  const interval = Math.max(1, Math.round(P.topologyInterval));
  const minWait = Math.max(1, Math.round(interval * 0.5));
  const maxWait = Math.max(minWait, Math.round(interval * 1.5));
  return minWait + Math.floor(rng() * (maxWait - minWait + 1));
}

// 新しい領域の最初の待ち時間（createRegion から。乱数を使うのはこの領域の系列だけ）
export function initTopology(sim, g) {
  g.topoN = 0;
  g.topoWait = topologyWait(sim.P, topologyRng(sim.P, g));
}

// 崩れ始めた領域ごとに待ち時間を減らし、0 になった領域が自分の分裂か隣との合体を試す。
// 同じ世代に組み替えた領域（消えた・新しくできた）は、その世代ではもう触らない。
export function evolveRegions(sim) {
  const P = sim.P;
  const long = Math.max(sim.cols * sim.cw, sim.rows * sim.ch);
  const minX = Math.max(2, Math.round(P.minRegionFrac * long / sim.cw));
  const minY = Math.max(2, Math.round(P.minRegionFrac * long / sim.ch));
  const touched = new Set();
  let rs = sim.regions, changed = false;
  for (const a of sim.regions) {
    if (!a.started || touched.has(a)) continue;
    if (--a.topoWait > 0) continue;
    const rng = topologyRng(P, a);
    a.topoWait = topologyWait(P, rng);
    const canSplit = (a.w >= minX * 2 || a.h >= minY * 2) && rs.length < sim.maxRegions;
    const merges = [];
    if (rs.length > 2) for (const b of rs) {
      if (b === a || !b.started || touched.has(b)) continue;
      const rect = unionRect(a, b);
      if (rect) merges.push({ b, rect });
    }
    if (!canSplit && !merges.length) continue;
    const split = canSplit && (!merges.length || rng() < 0.5);
    let removed, rects, from;
    if (split) {
      const vertical = a.w >= 2 * minX && (a.h < 2 * minY || rng() < (a.w * sim.cw > a.h * sim.ch ? 0.7 : 0.3));
      const length = vertical ? a.w : a.h, min = vertical ? minX : minY;
      let cut = Math.max(min, Math.min(length - min, Math.round(length * (0.35 + rng() * 0.3))));
      // 切る位置は初期の分割と同じく REGION_ALIGN マスの倍数にそろえる（大きなマスの倍率でも割り切れるので、子は親の大きなマスの並びをそのまま使える）。
      // そろえられなかったときも、大きなマスの領域は倍率の倍数にする
      cut = alignCut(vertical ? a.x : a.y, length, cut, min);
      const s = a.scale, aligned = Math.round(cut / s) * s;
      if (cut % s && aligned >= min && aligned <= length - min) cut = aligned;
      rects = vertical ? [[a.x, a.y, cut, a.h], [a.x + cut, a.y, a.w - cut, a.h]]
        : [[a.x, a.y, a.w, cut], [a.x, a.y + cut, a.w, a.h - cut]];
      removed = [a];
      from = a;
      sim.topologyEvents.split++;
    } else {
      const { b, rect } = merges[Math.floor(rng() * merges.length)];
      removed = [a, b]; rects = [rect];
      from = a.w * a.h >= b.w * b.h ? a : b; // 大きなマスにするかは、面積の大きいほうから引き継ぐ
      sim.topologyEvents.merge++;
    }
    const added = rects.map(rect => {
      const g = sim.createRegion(...rect, sim.nextRegionId++, from);
      // 開始済みの領域だけを組み替える。Staggerで再び待たせない。
      g.started = true;
      if (g.rules) applyChaos(g.rules, P.chaos);
      MOTIONS[g.motion].rulesChanged?.(g);
      const rules = P.patRules;
      g.patRule = rules.length ? rules[Math.floor(g.patRuleU * rules.length)] : 0;
      g.patReset = true;
      // 写真タイル・CA状態は保ち、古い境界に沿った模様だけ消す。
      for (let y = g.y; y < g.y + g.h; y++) {
        const c = y * sim.cols + g.x;
        sim.cur.mask.fill(0, c, c + g.w);
        sim.nxt.mask.fill(0, c, c + g.w);
      }
      touched.add(g);
      return g;
    });
    for (const g of removed) touched.add(g);
    rs = rs.filter(g => !removed.includes(g)).concat(added);
    changed = true;
  }
  if (!changed) return;
  sim.regions = rs;
  sim.makeInk();
}
