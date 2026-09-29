// テスト用の共通ヘルパー。

import { newSave } from '../src/game/save';
import { getWorld } from '../src/game/world';
import { isBuildable, placementAt } from '../src/game/rules';
import type { AreaId, SaveState } from '../src/game/types';

export const world = getWorld();

export function freshSave(now = 0): SaveState {
  return newSave(world, now);
}

/** 家具を置ける空きマスを n 個返す（指定エリア内。家具・資源・設備の上は除く）。 */
export function freeTiles(save: SaveState, n: number, area: AreaId = 'plaza'): { x: number; y: number; id: string }[] {
  const out: { x: number; y: number; id: string }[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (out.length >= n) return out;
      if (world.area[y * world.width + x] !== area) continue;
      if (!isBuildable(world, save, x, y) || placementAt(save, x, y)) continue;
      out.push({ x, y, id: `${x},${y}` });
    }
  }
  return out;
}
