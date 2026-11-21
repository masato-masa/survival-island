// 暮らしの記録（SI-25）。数え方・段のごほうび・古いセーブ・ごほうびの強さ。
import { describe, expect, it } from 'vitest';

import { migrate } from '../src/game/save';
import { LIFE, lifeCount, recordLife } from '../src/game/lifelog';
import { setWeatherOverride } from '../src/game/weather';
import type { GameEvent } from '../src/game/types';
import { freshSave } from './helpers';

const DAY = 86400000;

describe('暮らしの記録', () => {
  it('釣り・収穫・木・花・ごはんを数え、段を越えたらごほうびが入る', () => {
    const save = freshSave();
    const events: GameEvent[] = [];
    for (let i = 0; i < 10; i++) events.push({ type: 'fished', item: i % 3 === 0 ? 'bigFish' : 'fish' });
    events.push({ type: 'fished', item: null });
    recordLife(save, events, 0);
    expect(lifeCount(save, 'fish')).toBe(10);
    expect(save.life.tier.fish).toBe(1);
    expect(save.inventory.bigFish).toBe(1);
    expect(events.some((e) => e.type === 'lifeTier' && e.id === 'fish' && e.tier === 1)).toBe(true);
    // 木は薪（drops に wood）が出たときだけ。幹が消えるだけ（drops なし）は数えない
    const t: GameEvent[] = [
      { type: 'broke', x: 1, y: 1, kind: 'tree', drops: { wood: 2 } },
      { type: 'broke', x: 1, y: 1, kind: 'tree', drops: {} },
      { type: 'broke', x: 2, y: 2, kind: 'flower', drops: { petal: 1 } },
      { type: 'ate', meal: 'turnipSoup', restore: 6 },
      { type: 'harvested', tiles: [{ x: 1, y: 1 }, { x: 2, y: 1 }], crop: 'turnip', amount: 2 },
    ];
    recordLife(save, t, 0);
    expect(lifeCount(save, 'wood')).toBe(1);
    expect(lifeCount(save, 'flower')).toBe(1);
    expect(lifeCount(save, 'meal')).toBe(1);
    expect(lifeCount(save, 'crop')).toBe(4);
  });

  it('いっぺんに複数の段を越えても、段ぶんのごほうびが全部入る', () => {
    const save = freshSave();
    const events: GameEvent[] = [];
    for (let i = 0; i < 30; i++) events.push({ type: 'fished', item: 'fish' });
    recordLife(save, events, 0);
    expect(save.life.tier.fish).toBe(2);
    expect(save.inventory.bigFish).toBe(3);
  });

  it('三つの空: 晴れ・くもり・雨をそれぞれ遊んだ日数の最小で数える。同じ日は 1 回', () => {
    const save = freshSave();
    for (const [i, w] of (['sunny', 'cloudy', 'rainy'] as const).entries()) {
      setWeatherOverride(w);
      recordLife(save, [], i * DAY);
      recordLife(save, [], i * DAY + 1000);
    }
    expect(save.life.days).toEqual({ sunny: 1, cloudy: 1, rainy: 1 });
    expect(lifeCount(save, 'sky')).toBe(1);
    expect(save.life.tier.sky).toBe(1);
    expect(save.inventory.copper).toBe(3);
    setWeatherOverride('plain');
  });

  it('古いセーブ（life の欄が無い）でも読める', () => {
    const old = freshSave() as unknown as Record<string, unknown>;
    delete old.life;
    const loaded = migrate(old);
    expect(loaded.life.count).toEqual({});
    expect(loaded.life.days.rainy).toBe(0);
  });

  it('ごほうびは、その段までの作業スタミナの 4 割以下（なさすぎもしない 5% 以上）。sky は日数なので除く', () => {
    // 1 つあたりの作業スタミナと、品物の値打ち（スタミナ換算。cooking・ship のテストと同じ見積もり）
    const costPer: Record<string, number> = { fish: 1.5, crop: 2, wood: 4, flower: 3, meal: 4 };
    const value: Record<string, number> = { copper: 2.5, sapling: 2, petal: 0.5, turnip: 2, sunflower: 2.5, tomato: 3, fish: 1.5, bigFish: 5, wood: 1, stone: 1, flowerSeed: 1 };
    const rows: string[] = [];
    for (const d of LIFE) {
      if (d.id === 'sky') continue;
      d.tiers.forEach((n, i) => {
        const cost = n * costPer[d.id]!;
        const reward = Object.entries(d.rewards[i]!).reduce((s, [k, v]) => s + value[k]! * (v as number), 0);
        rows.push(`${d.name} ${i + 1}段 ${n}${d.unit}: 作業 ${cost} → ごほうび ${reward.toFixed(1)}（${((reward / cost) * 100).toFixed(0)}%）`);
        expect(reward / cost).toBeLessThanOrEqual(0.4);
        expect(reward / cost).toBeGreaterThanOrEqual(0.05);
      });
    }
    // eslint-disable-next-line no-console
    console.log('[暮らしの記録]\n' + rows.join('\n'));
  });
});
