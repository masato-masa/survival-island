// 季節（SI-35）。日本時間の月から春夏秋冬が決まる（3〜5 月 春 / 6〜8 月 夏 / 9〜11 月 秋 / 12〜2 月 冬）。時刻は now を引数で受ける。
//   作物: 季節の作物は育つのが 3 割はやい（春=カブ・夏=ヒマワリ・秋=トマト）。冬はどれも 2 割おそい（カブだけ普通）。
//   魚: 夏は大物 +5%、秋は +10%（脂がのる）、冬は -5%。
//   花: 春は花を摘むと花びらが 1 枚多い。
//   景色: 画面に季節の薄い色（春=桃・秋=橙・冬=青白）。夏は何も重ねない。

import type { CropId } from './types';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter' | 'none';

export interface SeasonDef {
  id: Exclude<SeasonId, 'none'>;
  name: string;
  crop: CropId | null;
  effect: string;
}

export const SEASONS: Record<Exclude<SeasonId, 'none'>, SeasonDef> = {
  spring: { id: 'spring', name: '春', crop: 'turnip', effect: 'カブが 3 割はやく育つ。花を摘むと花びらが 1 枚多い' },
  summer: { id: 'summer', name: '夏', crop: 'sunflower', effect: 'ヒマワリが 3 割はやく育つ。大物が少し釣れやすい' },
  autumn: { id: 'autumn', name: '秋', crop: 'tomato', effect: 'トマトが 3 割はやく育つ。魚に脂がのって大物が釣れやすい' },
  winter: { id: 'winter', name: '冬', crop: null, effect: '作物はカブ以外 2 割おそく育つ。大物は少し釣れにくい' },
};

/** 作物が育つ速さ: 植えた時点で、育ちきるまでの時間のこの割合ぶん「進んだ（正）／遅れた（負）」状態にする。 */
export const SEASON_CROP_HEADSTART = 0.3;
export const WINTER_CROP_DELAY = 0.2;
export const SEASON_FISH_BONUS: Record<Exclude<SeasonId, 'none'>, number> = { spring: 0, summer: 0.05, autumn: 0.1, winter: -0.05 };

const JST_MS = 9 * 60 * 60 * 1000;

export function seasonOfMonth(month0: number): Exclude<SeasonId, 'none'> {
  if (month0 >= 2 && month0 <= 4) return 'spring';
  if (month0 >= 5 && month0 <= 7) return 'summer';
  if (month0 >= 8 && month0 <= 10) return 'autumn';
  return 'winter';
}

/** 確認用（?dev&season=winter）とテスト（'none' = 何も効かない）。保存しない。 */
let override: SeasonId | null = null;
export function setSeasonOverride(id: SeasonId | null): void {
  override = id;
}

export function seasonAt(now: number): SeasonId {
  if (override) return override;
  return seasonOfMonth(new Date(now + JST_MS).getUTCMonth());
}

/** 作物 crop を now に植えたときの、進み具合の補正（正 = 進んだ状態から、負 = 遅れて）。 */
export function cropHeadstart(crop: CropId, now: number): number {
  const s = seasonAt(now);
  if (s === 'none') return 0;
  const def = SEASONS[s];
  if (def.crop === crop) return SEASON_CROP_HEADSTART;
  if (s === 'winter' && crop !== 'turnip') return -WINTER_CROP_DELAY;
  return 0;
}

export function fishBonus(now: number): number {
  const s = seasonAt(now);
  return s === 'none' ? 0 : SEASON_FISH_BONUS[s];
}

export function flowerPetalBonus(now: number): number {
  return seasonAt(now) === 'spring' ? 1 : 0;
}
