// テスト用の共通ヘルパー。

import { newSave } from '../src/game/save';
import { getWorld } from '../src/game/world';
import type { SaveState } from '../src/game/types';

export const world = getWorld();

export function freshSave(now = 0): SaveState {
  return newSave(world, now);
}
