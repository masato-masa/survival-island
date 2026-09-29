// 島ポイント（得点＋統一ボーナス）と島レベル。

import { FURNITURE_BY_ID, SERIES_BONUS } from './data';
import { islandLevel } from './rules';
import type { AreaId, GameEvent, SaveState, SeriesId, World } from './types';

export interface IslandPoints {
  total: number;
  base: number;
  bonus: number;
  byArea: Partial<Record<AreaId, number>>;
}

/** 配置済みの家具から島ポイントを計算する。 */
export function islandPoints(world: World, save: SaveState): IslandPoints {
  const byArea: Partial<Record<AreaId, number>> = {};
  const seriesCounts = new Map<AreaId, Partial<Record<SeriesId, number>>>();
  let base = 0;

  for (const [anchor, furnitureId] of Object.entries(save.placements)) {
    const def = furnitureId ? FURNITURE_BY_ID[furnitureId] : undefined;
    if (!def) continue;
    const [xs, ys] = anchor.split(',');
    const area = world.area[Number(ys) * world.width + Number(xs)];
    if (!area) continue;
    base += def.points;
    byArea[area] = (byArea[area] ?? 0) + def.points;
    const counts = seriesCounts.get(area) ?? {};
    counts[def.series] = (counts[def.series] ?? 0) + 1;
    seriesCounts.set(area, counts);
  }

  let bonus = 0;
  for (const [area, counts] of seriesCounts) {
    for (const count of Object.values(counts)) {
      if (count == null) continue;
      const tier = SERIES_BONUS.find((t) => count >= t.count);
      if (!tier) continue;
      bonus += tier.bonus;
      byArea[area] = (byArea[area] ?? 0) + tier.bonus;
    }
  }

  return { total: base + bonus, base, bonus, byArea };
}

/** maxPoints を更新する。島レベルが上がったら islandLevelUp イベントを返す。 */
export function updateMaxPoints(world: World, save: SaveState): GameEvent | null {
  const before = islandLevel(save);
  const { total } = islandPoints(world, save);
  if (total > save.maxPoints) save.maxPoints = total;
  const after = islandLevel(save);
  if (after > before) return { type: 'islandLevelUp', level: after };
  return null;
}
