// 季節（SI-35）。月から決まり、作物・魚・花に効く。1 年を通した効きの平均が暮らしを壊さない。
import { afterEach, describe, expect, it } from 'vitest';

import { chooseCrop, farmAction, fish, hitNode } from '../src/game/actions';
import { CROPS } from '../src/game/data';
import { isReady } from '../src/game/time';
import {
  fishBonus,
  flowerPetalBonus,
  cropHeadstart,
  seasonOfMonth,
  setSeasonOverride,
  SEASONS,
  type SeasonId,
} from '../src/game/season';
import { freshSave, world } from './helpers';

afterEach(() => setSeasonOverride('none'));

const at = (month1: number) => Date.UTC(2027, month1 - 1, 15, 3);

describe('季節', () => {
  it('3〜5 月 春・6〜8 月 夏・9〜11 月 秋・12〜2 月 冬', () => {
    const names = Array.from({ length: 12 }, (_, m) => seasonOfMonth(m));
    expect(names).toEqual(['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']);
  });

  it('季節の作物は 3 割はやい（植えて 0.7 倍の時間で収穫できる）。冬はカブ以外が 2 割おそい', () => {
    const plot = world.plots[0]!;
    const tile = plot.tiles[0]!;
    const check = (season: Exclude<SeasonId, 'none'>, crop: 'turnip' | 'sunflower' | 'tomato') => {
      setSeasonOverride(season);
      const save = freshSave(0);
      save.maxPoints = 100;
      chooseCrop(save, plot.id, crop);
      farmAction(world, save, plot, tile.x, tile.y, 0);
      const t = save.plots[plot.id]!.tiles[`${tile.x},${tile.y}`]!;
      const ms = CROPS[crop].growMs;
      return { fast: isReady(t, ms * 0.71), slow: isReady(t, ms * 0.9), full: isReady(t, ms * 1.0), ms };
    };
    expect(check('spring', 'turnip').fast).toBe(true);
    expect(check('spring', 'sunflower').fast).toBe(false);
    expect(check('summer', 'sunflower').fast).toBe(true);
    expect(check('autumn', 'tomato').fast).toBe(true);
    const w = check('winter', 'tomato');
    expect(w.slow).toBe(false);
    expect(w.full).toBe(false);
    expect(check('winter', 'turnip').full).toBe(true);
  });

  it('魚: 夏 +5%・秋 +10%・冬 -5%。花: 春だけ花びら +1', () => {
    setSeasonOverride('autumn');
    const save = freshSave();
    // 大物率 0.5 + 0.1 = 0.6 → roll 0.55 は大物
    fish(save, 'perfect', 0.55, 0);
    expect(save.inventory.bigFish).toBe(1);
    setSeasonOverride('winter');
    fish(save, 'perfect', 0.47, 0); // 0.5 - 0.05 = 0.45 → 0.47 は普通のさかな
    expect(save.inventory.fish).toBe(1);
    expect(fishBonus(0)).toBe(-0.05);
    setSeasonOverride('spring');
    const flower = world.nodes.find((n) => n.kind === 'flower')!;
    const s2 = freshSave();
    s2.stamina.value = 40;
    hitNode(world, s2, flower, 0);
    const springPetals = s2.inventory.petal ?? 0;
    setSeasonOverride('summer');
    const s3 = freshSave();
    hitNode(world, s3, flower, 0);
    expect(springPetals).toBe((s3.inventory.petal ?? 0) + 1);
    expect(flowerPetalBonus(0)).toBe(0);
  });

  it('1 年を通した効きの平均（暮らしを壊さない）: 各作物が速い季節は 1/4、冬の遅れは 3/4 の作物が受ける → 平均の育ちは ほぼ等速（±5%）', () => {
    const avg = (crop: 'turnip' | 'sunflower' | 'tomato') => {
      let sum = 0;
      for (const m of [1, 4, 7, 10]) {
        setSeasonOverride(seasonOfMonth(m - 1));
        sum += cropHeadstart(crop, at(m));
      }
      return sum / 4;
    };
    const rows = (['turnip', 'sunflower', 'tomato'] as const).map((c) => `${c}: 年平均の進み ${(avg(c) * 100).toFixed(1)}%`);
    // eslint-disable-next-line no-console
    console.log('[季節の効き]\n' + rows.join('\n') + '\n' + Object.values(SEASONS).map((s) => `${s.name}: ${s.effect}`).join('\n'));
    expect(avg('turnip')).toBeCloseTo(0.075, 3); // 春 +0.3 のみ（冬もカブは遅れない）
    expect(Math.abs(avg('sunflower'))).toBeLessThan(0.06);
    expect(Math.abs(avg('tomato'))).toBeLessThan(0.06);
  });
});
