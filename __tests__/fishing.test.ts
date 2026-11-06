// 釣り（SI-9）。桟橋で浮きを合わせて魚を釣る。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cook, fish, fishQuality } from '../src/game/actions';
import { bobberPos, FishingSheet } from '../src/ui/FishingSheet';
import { CraftSheet } from '../src/ui/CraftSheet';
import { freshSave } from './helpers';

describe('釣り', () => {
  it('浮きが中央に近いほどよく釣れる', () => {
    expect(fishQuality(0.5)).toBe('perfect');
    expect(fishQuality(0.45)).toBe('perfect');
    expect(fishQuality(0.35)).toBe('good');
    expect(fishQuality(0.7)).toBe('good');
    expect(fishQuality(0.1)).toBe('miss');
    expect(fishQuality(0.95)).toBe('miss');
  });

  it('1 回 1 スタミナ。外すと何も釣れないが、スタミナは減る', () => {
    const save = freshSave();
    const before = save.stamina.value;
    const r = fish(save, 'miss', 0, 0);
    expect(r).toEqual({ ok: true, events: [{ type: 'fished', item: null }] });
    expect(save.stamina.value).toBe(before - 1);
    expect(save.inventory.fish ?? 0).toBe(0);
  });

  it('よく合わせるとさかな、ちょうどだと半々で大物', () => {
    const save = freshSave();
    fish(save, 'good', 0, 0);
    expect(save.inventory.fish).toBe(1);
    fish(save, 'perfect', 0.2, 0);
    expect(save.inventory.bigFish).toBe(1);
    fish(save, 'perfect', 0.8, 0);
    expect(save.inventory.fish).toBe(2);
  });

  it('スタミナが無ければ釣れない', () => {
    const save = freshSave();
    save.stamina.value = 0;
    expect(fish(save, 'perfect', 0, 0)).toEqual({ ok: false, reason: 'noStamina' });
  });

  it('魚は料理になる（焼き魚: さかな 2 匹）', () => {
    const save = freshSave();
    save.stamina.value = 5;
    save.inventory.fish = 2;
    const r = cook(save, 'grilledFish', 0);
    expect(r.ok).toBe(true);
    expect(save.inventory.fish).toBe(0);
    expect(save.stamina.value).toBe(11);
  });

  it('浮きは 0〜1 を往復する', () => {
    const seen = Array.from({ length: 80 }, (_, i) => bobberPos(i * 65));
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(Math.max(...seen)).toBeGreaterThan(0.9);
    expect(Math.min(...seen)).toBeLessThan(0.1);
  });

  it('適当に押したときの釣れる割合は 4 割前後（技で上げられる余地を残す）', () => {
    let hit = 0;
    for (let i = 0; i < 1000; i++) if (fishQuality(i / 1000) !== 'miss') hit++;
    expect(hit / 1000).toBeGreaterThan(0.38);
    expect(hit / 1000).toBeLessThan(0.48);
  });

  it('釣りの画面に、浮き・ボタン・魚の数が出る。スタミナ切れならボタンが押せない', () => {
    const save = freshSave();
    save.inventory.fish = 3;
    const props = { save, now: () => 0, onCast: () => ({ ok: true as const, events: [] }), onClose: () => {} };
    const html = renderToStaticMarkup(createElement(FishingSheet, props));
    expect(html).toContain('つる！');
    expect(html).toContain('さかな 3');
    expect(html).not.toContain('disabled');
    save.stamina.value = 0;
    expect(renderToStaticMarkup(createElement(FishingSheet, props))).toContain('disabled');
  });

  it('作業台のごはんの欄に焼き魚が並ぶ', () => {
    // 島レベル 1 で覚える（魚は桟橋でいつでも釣れる）
    const save = freshSave();
    const html = renderToStaticMarkup(
      createElement(CraftSheet, { save, now: () => 0, onClose: () => {}, onCraft: () => {}, onCollect: () => {}, onCook: () => {} }),
    );
    expect(html).toContain('焼き魚');
  });
});
