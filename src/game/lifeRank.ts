// 暮らしの位（SI-30）。暮らしの記録（lifelog.ts）の段を合わせた数で、位が上がる。位ごとに最大スタミナが増える（ずっと残る）。
// rules.ts から読まれるので、他のゲームの部品を import しない（循環を避ける）。

import type { SaveState } from './types';

/** 位が上がる、記録の段の合計（7 項目 × 3 段 = 21 段まで）。 */
export const LIFE_RANK_AT = [6, 12, 18, 21];
/** 位 1 つにつき増える最大スタミナ。 */
export const LIFE_RANK_STAMINA = 2;
export const LIFE_RANK_NAMES = ['島の住人', '島の働き手', '島の名人', '島の主'];

export function lifeTierTotal(save: SaveState): number {
  return Object.values(save.life.tier).reduce((n, v) => n + (v ?? 0), 0);
}

/** 今の位（0〜4）。 */
export function lifeRank(save: SaveState): number {
  const total = lifeTierTotal(save);
  return LIFE_RANK_AT.filter((n) => total >= n).length;
}

export function lifeStaminaBonus(save: SaveState): number {
  return lifeRank(save) * LIFE_RANK_STAMINA;
}
