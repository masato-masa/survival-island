// 暮らしの記録（SI-25）。長く遊んだ先の目標。釣り・畑・木こり・花・ごはん・天気の日数を数え、段（3 段）ごとにごほうびが出る。
// 重みで調整する: 段の数と、ごほうびは「その段までの作業スタミナの 2〜4 割」に収める（lifelog.test.ts が測る）。
// 時刻は now を引数で受ける。ごほうびは「集めた」には数えない（おねがいの進みにならない）。

import { dailyDay } from './daily';
import type { GameEvent, ItemId, SaveState } from './types';
import { weatherAt } from './weather';

export type LifeId = 'fish' | 'crop' | 'wood' | 'flower' | 'meal' | 'sky' | 'treasure';

export interface LifeDef {
  id: LifeId;
  name: string;
  /** 数えるもの（画面の「あと N」の言い方）。 */
  unit: string;
  /** 段ごとの目標の数。 */
  tiers: [number, number, number];
  /** 段ごとのごほうび。 */
  rewards: [Partial<Record<ItemId, number>>, Partial<Record<ItemId, number>>, Partial<Record<ItemId, number>>];
  hint: string;
}

export const LIFE: LifeDef[] = [
  { id: 'fish', name: 'さかな名人', unit: '匹', tiers: [10, 30, 100], rewards: [{ bigFish: 1 }, { bigFish: 2 }, { bigFish: 4 }], hint: '桟橋で釣る' },
  { id: 'crop', name: '畑の人', unit: '個', tiers: [20, 60, 200], rewards: [{ turnip: 4 }, { sunflower: 6 }, { tomato: 10 }], hint: '畑で収穫する' },
  { id: 'wood', name: 'きこり', unit: '本', tiers: [8, 30, 100], rewards: [{ sapling: 2 }, { sapling: 4 }, { sapling: 10 }], hint: '木を切り倒す' },
  { id: 'flower', name: '花つみ', unit: '輪', tiers: [10, 40, 120], rewards: [{ petal: 6 }, { petal: 16 }, { petal: 40 }], hint: '花を摘みきる' },
  { id: 'meal', name: 'ごはん好き', unit: '食', tiers: [5, 20, 60], rewards: [{ fish: 2 }, { fish: 3 }, { bigFish: 3 }], hint: '作業台で食べる' },
  { id: 'treasure', name: 'たから探し', unit: '回', tiers: [3, 10, 30], rewards: [{ petal: 6 }, { copper: 4 }, { bigFish: 3 }], hint: '光る地面を掘る（島レベル 5 から）' },
  { id: 'sky', name: '三つの空', unit: '日', tiers: [1, 3, 8], rewards: [{ copper: 3 }, { copper: 6 }, { copper: 10 }], hint: '晴れ・くもり・雨を それぞれ遊ぶ' },
];

export interface LifeState {
  /** 数えた数（sky は 3 つの天気の日数の最小で、ここには持たない）。 */
  count: Partial<Record<LifeId, number>>;
  /** 受け取った段の数（0〜3）。 */
  tier: Partial<Record<LifeId, number>>;
  /** 天気ごとに遊んだ日数。 */
  days: { sunny: number; cloudy: number; rainy: number };
  /** 最後に数えた日（dailyDay）。 */
  dayMark: number;
}

export function emptyLife(): LifeState {
  return { count: {}, tier: {}, days: { sunny: 0, cloudy: 0, rainy: 0 }, dayMark: -1 };
}

const TREE_KINDS = new Set<string>(['tree', 'bigTree', 'borderTree', 'forestTree']);

/** 今の数（sky は 3 つの天気の日数の最小）。 */
export function lifeCount(save: SaveState, id: LifeId): number {
  if (id === 'sky') return Math.min(save.life.days.sunny, save.life.days.cloudy, save.life.days.rainy);
  return save.life.count[id] ?? 0;
}

function gain(events: GameEvent[]): Partial<Record<LifeId, number>> {
  const g: Partial<Record<LifeId, number>> = {};
  const add = (id: LifeId, n: number) => (g[id] = (g[id] ?? 0) + n);
  for (const ev of events) {
    if (ev.type === 'fished' && ev.item) add('fish', 1);
    else if (ev.type === 'harvested') add('crop', ev.tiles.length * ev.amount);
    else if (ev.type === 'broke') {
      if (TREE_KINDS.has(ev.kind) && (ev.drops.wood ?? 0) > 0) add('wood', 1);
      else if (ev.kind === 'flower') add('flower', 1);
    } else if (ev.type === 'ate') add('meal', 1);
    else if (ev.type === 'treasureFound') add('treasure', 1);
  }
  return g;
}

/**
 * 行動の結果（events）を数え、段を越えたらごほうびを入れて lifeTier の知らせを events に足す。
 * 今日が初めてなら、今日の天気の日数も 1 増やす（行動した日だけ数える）。
 */
export function recordLife(save: SaveState, events: GameEvent[], now: number): void {
  const life = save.life;
  const day = dailyDay(now);
  if (life.dayMark !== day) {
    life.dayMark = day;
    const w = weatherAt(now);
    if (w === 'sunny' || w === 'cloudy' || w === 'rainy') life.days[w] += 1;
  }
  const g = gain(events);
  for (const [id, n] of Object.entries(g) as [LifeId, number][]) life.count[id] = (life.count[id] ?? 0) + n;
  for (const def of LIFE) {
    const have = lifeCount(save, def.id);
    let tier = life.tier[def.id] ?? 0;
    while (tier < 3 && have >= def.tiers[tier]!) {
      const reward = def.rewards[tier]!;
      for (const [item, n] of Object.entries(reward) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) + n;
      tier += 1;
      life.tier[def.id] = tier;
      events.push({ type: 'lifeTier', id: def.id, name: def.name, tier, reward });
    }
  }
}
