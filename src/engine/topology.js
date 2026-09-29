// 画面全体を作り直さず、一組の領域だけ分裂・合体する。
import { hash, mulberry32 } from './rng.js';
import { applyChaos } from './rules.js';
import { MOTIONS } from './motions.js';

// 長方形になる、辺全体を共有した組だけ合体できる。
export function unionRect(a, b) {
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x))
    return [Math.min(a.x, b.x), a.y, a.w + b.w, a.h];
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y))
    return [a.x, Math.min(a.y, b.y), a.w, a.h + b.h];
  return null;
}

export function evolveRegions(sim) {
  if (--sim.topologyWait > 0) return;
  // 既存のルール・テンポ用乱数を消費しない。
  const rng = mulberry32(hash(sim.P.seed, sim.topologyTick++, 0x73706c69));
  const interval = Math.max(1, Math.round(sim.P.topologyInterval));
  const minWait = Math.max(1, Math.round(interval * 0.5));
  const maxWait = Math.max(minWait, Math.round(interval * 1.5));
  sim.topologyWait = minWait + Math.floor(rng() * (maxWait - minWait + 1));
  const rs = sim.regions;
  const long = Math.max(sim.cols * sim.cw, sim.rows * sim.ch);
  const minX = Math.max(2, Math.round(sim.P.minRegionFrac * long / sim.cw));
  const minY = Math.max(2, Math.round(sim.P.minRegionFrac * long / sim.ch));
  const splits = rs.filter(g => g.started && (g.w >= minX * 2 || g.h >= minY * 2));
  const merges = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    if (!rs[i].started || !rs[j].started) continue;
    const rect = unionRect(rs[i], rs[j]);
    if (rect) merges.push({ a: rs[i], b: rs[j], rect });
  }
  const canSplit = splits.length > 0 && rs.length < sim.maxRegions;
  const canMerge = merges.length > 0 && rs.length > 2;
  if (!canSplit && !canMerge) return;
  const split = canSplit && (!canMerge || rng() < 0.5);
  let removed, rects, from;
  if (split) {
    const a = splits[Math.floor(rng() * splits.length)];
    const vertical = a.w >= 2 * minX && (a.h < 2 * minY || rng() < (a.w * sim.cw > a.h * sim.ch ? 0.7 : 0.3));
    const length = vertical ? a.w : a.h, min = vertical ? minX : minY;
    let cut = Math.max(min, Math.min(length - min, Math.round(length * (0.35 + rng() * 0.3))));
    // 大きなマスの領域は、切る位置を倍率の倍数にそろえる（子は同じ倍率を引き継ぐので、大きなマスの並びがそのまま残る）
    const s = a.scale, aligned = Math.round(cut / s) * s;
    if (aligned >= min && aligned <= length - min) cut = aligned;
    rects = vertical ? [[a.x, a.y, cut, a.h], [a.x + cut, a.y, a.w - cut, a.h]]
      : [[a.x, a.y, a.w, cut], [a.x, a.y + cut, a.w, a.h - cut]];
    removed = [a];
    from = a;
    sim.topologyEvents.split++;
  } else {
    const { a, b, rect } = merges[Math.floor(rng() * merges.length)];
    removed = [a, b]; rects = [rect];
    from = a.w * a.h >= b.w * b.h ? a : b; // 大きなマスにするかは、面積の大きいほうから引き継ぐ
    sim.topologyEvents.merge++;
  }
  const added = rects.map(rect => {
    const g = sim.createRegion(...rect, sim.nextRegionId++, from);
    // 開始済みの領域だけを組み替える。Staggerで再び待たせない。
    g.started = true;
    if (g.rules) applyChaos(g.rules, sim.P.chaos);
    MOTIONS[g.motion].rulesChanged?.(g);
    const rules = sim.P.patRules;
    g.patRule = rules.length ? rules[Math.floor(g.patRuleU * rules.length)] : 0;
    g.patReset = true;
    // 写真タイル・CA状態は保ち、古い境界に沿った模様だけ消す。
    for (let y = g.y; y < g.y + g.h; y++) {
      const a = y * sim.cols + g.x;
      sim.cur.mask.fill(0, a, a + g.w);
      sim.nxt.mask.fill(0, a, a + g.w);
    }
    return g;
  });
  sim.regions = rs.filter(g => !removed.includes(g)).concat(added);
  sim.makeInk();
}
