// 暮らしの位（SI-30）。段の合計で位が上がり、最大スタミナが増える。位に着くまでの日数を粗いボットで測る。
import { describe, expect, it } from 'vitest';

import { LIFE } from '../src/game/lifelog';
import { lifeRank, lifeStaminaBonus, LIFE_RANK_AT, LIFE_RANK_STAMINA } from '../src/game/lifeRank';
import { recordLife } from '../src/game/lifelog';
import { staminaMax } from '../src/game/rules';
import { STAMINA_BASE } from '../src/game/data';
import type { GameEvent } from '../src/game/types';
import { freshSave } from './helpers';

describe('暮らしの位', () => {
  it('段の合計 6・12・18・21 で位が上がり、最大スタミナが 2 ずつ増える。位が上がると知らせが出る', () => {
    const save = freshSave();
    expect(lifeRank(save)).toBe(0);
    expect(staminaMax(save)).toBe(STAMINA_BASE);
    const events: GameEvent[] = [];
    // 釣り 100 匹（3 段）・畑 200 個（3 段）で 6 段
    for (let i = 0; i < 100; i++) events.push({ type: 'fished', item: 'fish' });
    events.push({ type: 'harvested', tiles: Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 })), crop: 'turnip', amount: 1 });
    recordLife(save, events, 0);
    expect(lifeRank(save)).toBe(1);
    expect(staminaMax(save)).toBe(STAMINA_BASE + LIFE_RANK_STAMINA);
    expect(events.some((e) => e.type === 'lifeRank' && e.rank === 1)).toBe(true);
    save.life.tier = { fish: 3, crop: 3, wood: 3, flower: 3, meal: 3, sky: 3, treasure: 3 };
    expect(lifeRank(save)).toBe(LIFE_RANK_AT.length);
    expect(lifeStaminaBonus(save)).toBe(LIFE_RANK_AT.length * LIFE_RANK_STAMINA);
  });

  it('位に着くまでの日数（1 日 40 スタミナを安い段から使う。たから探しは 1 日 1 回・三つの空は天気がそろうまで 1.5 倍。粗い見積もり）', () => {
    const costPer: Record<string, number> = { fish: 1.5, crop: 2, wood: 4, flower: 3, meal: 4 };
    const work: number[] = [];
    const gated: number[] = []; // 何日目に終わるか
    for (const d of LIFE) {
      if (d.id === 'treasure') d.tiers.forEach((n) => gated.push(n));
      else if (d.id === 'sky') d.tiers.forEach((n) => gated.push(Math.ceil(n * 1.5)));
      else d.tiers.forEach((n, i) => work.push((n - (i > 0 ? d.tiers[i - 1]! : 0)) * costPer[d.id]!));
    }
    work.sort((a, b) => a - b);
    const reach: Record<number, number> = {};
    let stock = 0;
    let doneWork = 0;
    for (let day = 1; day <= 400; day++) {
      stock += 40;
      while (doneWork < work.length && stock >= work[doneWork]!) stock -= work[doneWork++]!;
      const total = doneWork + gated.filter((g) => g <= day).length;
      for (const n of LIFE_RANK_AT) if (total >= n && reach[n] == null) reach[n] = day;
    }
    // eslint-disable-next-line no-console
    console.log(['[暮らしの位]', ...LIFE_RANK_AT.map((n) => `位 ${n} 段: 約 ${reach[n]} 日`)].join(String.fromCharCode(10)));
    // 目安: 最初の位は 1〜2 週間、最後の位は 1〜3 か月
    expect(reach[LIFE_RANK_AT[0]!]).toBeGreaterThanOrEqual(3);
    expect(reach[LIFE_RANK_AT[0]!]).toBeLessThanOrEqual(14);
    expect(reach[21]).toBeGreaterThanOrEqual(30);
    expect(reach[21]).toBeLessThanOrEqual(120);
  });
});
