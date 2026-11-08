// 見張り台の建て増し（SI-15）。素材を納めて 1 段階ずつ建て増し、眺めで分かることと毎日の贈り物が増える。
// 時刻は now を引数で受ける。

import { ITEMS, MEALS, TOWER_STAGES } from './data';
import { dailyDay, dailyOpen, dailyView } from './daily';
import { allNodes, canHit, currentRequest, isAreaOpen, islandLevel, knownMeals, nodeAlive } from './rules';
import { regionAt } from './world';
import type { GameEvent, ItemId, MealId, NodeKind, Result, SaveState, TowerStageDef, World } from './types';

export const TOWER_FULL = TOWER_STAGES.length;

/** 次に建て増す段階。全部建て増していれば null。 */
export function nextTowerStage(save: SaveState): TowerStageDef | null {
  return TOWER_STAGES[save.tower.stage] ?? null;
}

/** 今日の贈り物（建て増した段階ぶんの合計）。枠ごとに、日付で pool のどれか 1 つが届く。 */
export function towerGift(save: SaveState, now: number): Partial<Record<ItemId, number>> {
  return towerGiftOn(save.tower.stage, dailyDay(now));
}

/** day 日目の贈り物（stage 段階ぶん）。 */
export function towerGiftOn(stage: number, day: number): Partial<Record<ItemId, number>> {
  const gift: Partial<Record<ItemId, number>> = {};
  TOWER_STAGES.slice(0, stage).forEach((st, i) => {
    const [item, n] = st.gift[(((day + i) % st.gift.length) + st.gift.length) % st.gift.length]!;
    gift[item] = (gift[item] ?? 0) + n;
  });
  return gift;
}

export function towerGiftReady(save: SaveState, now: number): boolean {
  return save.tower.stage > 0 && save.tower.giftDay !== dailyDay(now);
}

/** 次の段階を建て増す。素材不足 'notEnoughItems'、島レベル不足 'levelCap'、全部なら 'maxLevel'。 */
export function upgradeTower(save: SaveState): Result {
  const st = nextTowerStage(save);
  if (!st) return { ok: false, reason: 'maxLevel' };
  if (islandLevel(save) < st.unlockLevel) return { ok: false, reason: 'levelCap', detail: `島レベル ${st.unlockLevel} で取りかかれます` };
  for (const [item, n] of Object.entries(st.cost) as [ItemId, number][]) {
    if ((save.inventory[item] ?? 0) < n) return { ok: false, reason: 'notEnoughItems', detail: `${ITEMS[item].name}が足りません` };
  }
  for (const [item, n] of Object.entries(st.cost) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) - n;
  save.tower.stage += 1;
  return { ok: true, events: [{ type: 'towerBuilt', stage: save.tower.stage }] };
}

/** 今日の贈り物を受け取る（1 日 1 回。「集めた」には数えない）。 */
export function claimTowerGift(save: SaveState, now: number): Result {
  if (save.tower.stage === 0) return { ok: false, reason: 'notReady', detail: 'まだ見張り台を建て増していません' };
  if (!towerGiftReady(save, now)) return { ok: false, reason: 'notReady', detail: '今日の分は受け取りました' };
  const gift = towerGift(save, now);
  for (const [item, n] of Object.entries(gift) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) + n;
  save.tower.giftDay = dailyDay(now);
  const events: GameEvent[] = [{ type: 'towerGift', items: gift }];
  return { ok: true, events };
}

// ---------------------------------------------------------------------------
// 眺め

export type LookoutKind = 'wood' | 'flower' | 'stone' | 'copper';

export const LOOKOUT_LABEL: Record<LookoutKind, string> = { wood: '木', flower: '花', stone: '岩', copper: '銅の鉱脈' };
const LOOKOUT_NODES: Record<LookoutKind, NodeKind[]> = {
  wood: ['tree', 'bigTree', 'forestTree', 'borderTree'],
  flower: ['flower'],
  stone: ['rock', 'hardRock', 'borderRock'],
  copper: ['copperVein'],
};
/** 段階 n になると眺められるもの。 */
const LOOKOUT_STAGE: Record<LookoutKind, number> = { wood: 1, flower: 1, stone: 2, copper: 2 };

export interface LookoutEntry {
  kind: LookoutKind;
  label: string;
  /** 今、叩ける・摘める物の数（地図ぜんぶ）。 */
  total: number;
  /** 今いる区画（島 or 洞窟）で一番近い物。無ければ null。 */
  nearest: { dist: number; dir: string } | null;
}

const DIRS = ['東', '南東', '南', '南西', '西', '北西', '北', '北東'];

/** (dx, dy)（マス、y は下が南）の方角。 */
export function compass(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx); // 東 = 0、南 = +π/2
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]!;
}

/**
 * 眺め。建て増した段階で見えるものだけ返す。叩ける物（体力が残り、スキルが足り、エリアが開いている）だけ数える。
 * 距離は今いる区画の中で測る（洞窟と島は歩いてはつながらない）。
 */
export function lookout(world: World, save: SaveState, now: number): LookoutEntry[] {
  const stage = save.tower.stage;
  const region = regionAt(world, save.player.y);
  const nodes = allNodes(world, save, now).filter((n) => !n.growing && nodeAlive(save, n, now) && canHit(save, n) && isAreaOpen(world, save, n.area));
  const out: LookoutEntry[] = [];
  for (const kind of Object.keys(LOOKOUT_NODES) as LookoutKind[]) {
    if (stage < LOOKOUT_STAGE[kind]) continue;
    const kinds = LOOKOUT_NODES[kind];
    const list = nodes.filter((n) => kinds.includes(n.kind));
    let best: { dist: number; dir: string } | null = null;
    for (const n of list) {
      if (n.y < region.y0 || n.y >= region.y1) continue;
      const dx = n.x + 0.5 - save.player.x;
      const dy = n.y + 0.5 - save.player.y;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { dist, dir: compass(dx, dy) };
    }
    out.push({ kind, label: LOOKOUT_LABEL[kind], total: list.length, nearest: best });
  }
  return out;
}

export interface MealAdvice {
  meal: MealId;
  /** 今日の（まだかなえていない）おねがいのうち、このごはんの効き目だけで足りるもの。 */
  covers: number;
  /** 今日の（まだかなえていない）おねがいの数。 */
  total: number;
  /** 一番大きいおねがいの名前（無ければ null）。 */
  bigName: string | null;
}

/**
 * 今日のおすすめごはん。毎日のおねがい（無ければ島のおねがい）のうち、まだかなえていないものを数え、
 * 効き目が全部まかなえる数がいちばん多い料理を選ぶ。同点なら効き目が多い（一部だけ合うものも数える）→ 回復の多い順。
 * 作れる料理（島レベルと作物で解禁済み）だけを選ぶ。
 */
export function mealAdvice(save: SaveState, now: number): MealAdvice | null {
  const reqs = dailyOpen(save)
    ? dailyView(save, now).filter((v) => !v.claimed).map((v) => v.def)
    : [currentRequest(save)?.def].filter((d): d is NonNullable<typeof d> => !!d);
  if (reqs.length === 0) return null;
  const meals = knownMeals(save);
  if (meals.length === 0) return null;
  let best: { meal: MealId; score: number; covers: number } | null = null;
  for (const id of meals) {
    const buffs = MEALS[id].buffs;
    const covers = reqs.filter((r) => r.buffs.every((b) => buffs.includes(b))).length;
    const partial = reqs.filter((r) => r.buffs.some((b) => buffs.includes(b))).length;
    const score = covers * 100 + partial * 10 + MEALS[id].restore / 100;
    if (!best || score > best.score) best = { meal: id, score, covers };
  }
  const big = reqs.reduce<(typeof reqs)[number] | null>((a, r) => (!a || r.buffs.length > a.buffs.length ? r : a), null);
  return { meal: best!.meal, covers: best!.covers, total: reqs.length, bigName: big && big.buffs.length > 1 ? big.name : null };
}
