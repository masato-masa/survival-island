// 料理（SI-8）。畑の作物を食べてスタミナを戻す。
import { describe, expect, it } from 'vitest';

import { cook } from '../src/game/actions';
import { BUFF_MS, MEALS, MEAL_ORDER, STAMINA_BASE } from '../src/game/data';
import { actionMs, damageFor, hasBuff, knownMeals } from '../src/game/rules';
import { currentStamina } from '../src/game/time';
import { freshSave, world } from './helpers';

describe('料理', () => {
  it('島レベルで作れる料理が増える', () => {
    const save = freshSave();
    expect(knownMeals(save)).toEqual(['turnipSoup', 'grilledFish']);
    save.maxPoints = 30; // 島レベル 3
    expect(knownMeals(save)).toEqual(MEAL_ORDER);
  });

  it('材料の作物を使ってスタミナが回復する。経験値は入らない', () => {
    const save = freshSave();
    save.stamina.value = 10;
    save.inventory.turnip = 3;
    const xp = save.xp;
    const r = cook(save, 'turnipSoup', 0);
    expect(r.ok).toBe(true);
    expect(save.stamina.value).toBe(10 + MEALS.turnipSoup.restore);
    expect(save.inventory.turnip).toBe(1);
    expect(save.xp).toBe(xp);
    if (r.ok) expect(r.events).toEqual([{ type: 'ate', meal: 'turnipSoup', restore: MEALS.turnipSoup.restore }]);
  });

  it('回復は上限で切れ、イベントには実際に回復した量が入る', () => {
    const save = freshSave();
    save.stamina.value = STAMINA_BASE - 2;
    save.inventory.turnip = 2;
    const r = cook(save, 'turnipSoup', 0);
    expect(r.ok).toBe(true);
    expect(currentStamina(save, 0).value).toBe(STAMINA_BASE);
    if (r.ok) expect(r.events[0]).toMatchObject({ type: 'ate', restore: 2 });
  });

  it('満タンでも食べられる（回復は 0、効き目だけ付く）', () => {
    const save = freshSave();
    save.inventory.turnip = 2;
    const r = cook(save, 'turnipSoup', 0);
    expect(r.ok).toBe(true);
    expect(save.inventory.turnip).toBe(0);
    expect(hasBuff(save, 'power', 1000)).toBe(true);
  });

  it('効き目: 力もちは叩く力 +1、手早いは行動 3 割はやい、豊作は収穫 +1。10 分で切れ、同じものは延ばし直すだけ', () => {
    const save = freshSave();
    const tree = world.nodes.find((n) => n.kind === 'tree')!;
    const base = damageFor(save, tree, 0);
    const baseMs = actionMs(save, 'axe', 0);
    save.inventory.turnip = 1;
    save.inventory.sunflower = 1;
    save.inventory.tomato = 1;
    save.maxPoints = 30;
    save.stamina.value = 10;
    expect(cook(save, 'gardenSalad', 0).ok).toBe(true);
    expect(damageFor(save, tree, 1000)).toBe(base + 1);
    expect(actionMs(save, 'axe', 1000)).toBeCloseTo(baseMs * 0.7);
    expect(hasBuff(save, 'bounty', 1000)).toBe(true);
    expect(damageFor(save, tree, BUFF_MS + 1)).toBe(base);
    expect(actionMs(save, 'axe', BUFF_MS + 1)).toBe(baseMs);
    // 再び食べても buffs は増えない
    save.inventory.turnip = 2;
    cook(save, 'turnipSoup', 5000);
    expect(save.buffs.filter((b) => b.id === 'power')).toHaveLength(1);
    expect(save.buffs.find((b) => b.id === 'power')!.until).toBe(5000 + BUFF_MS);
  });

  it('材料が足りない・まだ覚えていないときは断る', () => {
    const save = freshSave();
    save.stamina.value = 5;
    expect(cook(save, 'turnipSoup', 0)).toEqual({ ok: false, reason: 'notEnoughItems' });
    save.inventory.sunflower = 2;
    expect(cook(save, 'sunflowerCookie', 0)).toEqual({ ok: false, reason: 'notLearned' });
  });

  it('収支: 材料 1 個ぶんのスタミナ（作物は植える 1 ＋ 収穫 1、魚は釣る 1 ÷ 釣れる割合）に対し、回復は 1.2〜2.5 倍に収める', () => {
    // 魚は 1 回 1 スタミナで、うまく釣れるのが 65%（さかな）。大物は完璧に合わせて半々なので約 5
    const STAMINA_PER: Record<string, number> = { turnip: 2, sunflower: 2, tomato: 2, fish: 1 / 0.65, bigFish: 5 };
    for (const id of MEAL_ORDER) {
      const meal = MEALS[id];
      const spent = Object.entries(meal.cost).reduce((a, [item, n]) => a + (n ?? 0) * STAMINA_PER[item]!, 0);
      const ratio = meal.restore / spent;
      expect(ratio, `${meal.name} の回復/消費`).toBeGreaterThanOrEqual(1.2);
      expect(ratio, `${meal.name} の回復/消費`).toBeLessThanOrEqual(2.5);
    }
  });
});
