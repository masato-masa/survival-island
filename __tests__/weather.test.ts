// 天気（SI-18）。日付から決まり、暮らしに効く。
import { afterEach, describe, expect, it } from 'vitest';

import { cook, fish } from '../src/game/actions';
import { BUFF_MS, CHOP_ACTION_MS, CROPS } from '../src/game/data';
import { actionMs } from '../src/game/rules';
import { currentStamina, regenMs } from '../src/game/time';
import {
  CLOUDY_BUFF_FACTOR,
  RAIN_ACTION_FACTOR,
  RAIN_BIG_FISH_BONUS,
  RAIN_CROP_HEADSTART,
  SUNNY_ACTION_FACTOR,
  setWeatherOverride,
  tomorrowWeather,
  WEATHERS,
  WEATHER_ORDER,
  weatherOnDay,
  type WeatherId,
} from '../src/game/weather';
import { freshSave } from './helpers';

afterEach(() => setWeatherOverride('plain'));

describe('天気', () => {
  it('同じ日なら必ず同じ。あしたの天気は あしたになれば今日の天気', () => {
    for (let d = 20000; d < 20100; d++) expect(weatherOnDay(d)).toBe(weatherOnDay(d));
    setWeatherOverride(null);
    const day = 20800;
    const now = day * 86400000 - 9 * 3600000 + 1000;
    const tomorrow = tomorrowWeather(now);
    expect(tomorrow).toBe(weatherOnDay(day + 1));
  });

  it('3 種が重みどおりに出る（1000 日で 晴れ 4〜5 割・くもり 2〜3 割・雨 2.5〜3.5 割）。雨が 5 日続くことはまず無い', () => {
    const count: Record<string, number> = { sunny: 0, cloudy: 0, rainy: 0 };
    let run = 0;
    let longest = 0;
    let prev: WeatherId | null = null;
    for (let d = 20000; d < 21000; d++) {
      const w = weatherOnDay(d);
      count[w]!++;
      run = w === 'rainy' && prev === 'rainy' ? run + 1 : w === 'rainy' ? 1 : 0;
      longest = Math.max(longest, run);
      prev = w;
    }
    expect(count.sunny! / 1000).toBeGreaterThan(0.4);
    expect(count.sunny! / 1000).toBeLessThan(0.5);
    expect(count.cloudy! / 1000).toBeGreaterThan(0.2);
    expect(count.cloudy! / 1000).toBeLessThan(0.3);
    expect(count.rainy! / 1000).toBeGreaterThan(0.25);
    expect(count.rainy! / 1000).toBeLessThan(0.35);
    expect(longest).toBeLessThanOrEqual(7);
    expect(WEATHER_ORDER.every((id) => WEATHERS[id].effect.length > 0)).toBe(true);
  });

  it('晴れは作業が 1 割はやく、雨は 1 割おそい', () => {
    const save = freshSave();
    setWeatherOverride('sunny');
    expect(actionMs(save, 'axe', 0)).toBeCloseTo(CHOP_ACTION_MS * SUNNY_ACTION_FACTOR);
    setWeatherOverride('rainy');
    expect(actionMs(save, 'axe', 0)).toBeCloseTo(CHOP_ACTION_MS * RAIN_ACTION_FACTOR);
    setWeatherOverride('cloudy');
    expect(actionMs(save, 'axe', 0)).toBe(CHOP_ACTION_MS);
  });

  it('晴れはスタミナの回復が 2 割はやい（30 分で 30 → 37 回復）', () => {
    const save = freshSave();
    save.stamina.value = 0;
    save.stamina.updatedAt = 0;
    save.maxPoints = 30; // 島レベル 3（回復は 60 秒）
    setWeatherOverride('plain');
    expect(regenMs(save, 0)).toBe(60000);
    expect(currentStamina(save, 1800000).value).toBe(30);
    setWeatherOverride('sunny');
    expect(regenMs(save, 0)).toBe(48000);
    expect(currentStamina(save, 1800000).value).toBe(37);
  });

  it('くもりはごはんの効き目が 1.5 倍長持ち', () => {
    const save = freshSave();
    save.inventory.turnip = 4;
    setWeatherOverride('cloudy');
    cook(save, 'turnipSoup', 0);
    expect(save.buffs[0]!.until).toBe(BUFF_MS * CLOUDY_BUFF_FACTOR);
    setWeatherOverride('sunny');
    cook(save, 'turnipSoup', 0);
    expect(save.buffs.find((b) => b.id === 'power')!.until).toBe(BUFF_MS);
  });

  it('雨の日は大物が出やすい（0.5 → 0.65）', () => {
    const save = freshSave();
    setWeatherOverride('plain');
    fish(save, 'perfect', 0.6, 0);
    expect(save.inventory.bigFish ?? 0).toBe(0);
    setWeatherOverride('rainy');
    fish(save, 'perfect', 0.6, 0);
    expect(save.inventory.bigFish).toBe(1);
    expect(0.5 + RAIN_BIG_FISH_BONUS).toBeCloseTo(0.65);
  });

  it('雨の日に植えた作物は 3 割育った状態から（カブ 2 分 → 1 分 24 秒）', () => {
    expect(CROPS.turnip.growMs * (1 - RAIN_CROP_HEADSTART)).toBe(84000);
  });
});
