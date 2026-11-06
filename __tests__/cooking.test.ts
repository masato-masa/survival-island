// 料理（SI-8）。畑の作物を食べてスタミナを戻す。
import { describe, expect, it } from 'vitest';

import { cook } from '../src/game/actions';
import { MEALS, MEAL_ORDER, STAMINA_BASE } from '../src/game/data';
import { knownMeals } from '../src/game/rules';
import { currentStamina } from '../src/game/time';
import { freshSave } from './helpers';

describe('料理', () => {
  it('島レベルで作れる料理が増える', () => {
    const save = freshSave();
    expect(knownMeals(save)).toEqual(['turnipSoup']);
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

  it('満タンのときは材料を使わずに断る', () => {
    const save = freshSave();
    save.inventory.turnip = 2;
    const r = cook(save, 'turnipSoup', 0);
    expect(r).toEqual({ ok: false, reason: 'staminaFull' });
    expect(save.inventory.turnip).toBe(2);
  });

  it('材料が足りない・まだ覚えていないときは断る', () => {
    const save = freshSave();
    save.stamina.value = 5;
    expect(cook(save, 'turnipSoup', 0)).toEqual({ ok: false, reason: 'notEnoughItems' });
    save.inventory.sunflower = 2;
    expect(cook(save, 'sunflowerCookie', 0)).toEqual({ ok: false, reason: 'notLearned' });
  });

  it('収支: 作物 1 個は植える 1 ＋ 収穫 1 のスタミナ。回復は 1.2〜2.5 倍に収める', () => {
    for (const id of MEAL_ORDER) {
      const meal = MEALS[id];
      const crops = Object.values(meal.cost).reduce((a, b) => a + (b ?? 0), 0);
      const spent = crops * 2; // 収穫量が基本 1 のとき
      const ratio = meal.restore / spent;
      expect(ratio, `${meal.name} の回復/消費`).toBeGreaterThanOrEqual(1.2);
      expect(ratio, `${meal.name} の回復/消費`).toBeLessThanOrEqual(2.5);
    }
  });
});
