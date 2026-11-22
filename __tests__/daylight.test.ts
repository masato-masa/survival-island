// 時間帯の光（SI-33）。昼は何も重ねず、夜でも見えなくならない（濃さ 0.2 以下）。
import { describe, expect, it } from 'vitest';

import { daylightAt } from '../src/render/ambient';

describe('時間帯の光', () => {
  it('昼（9〜16 時）は無し。朝・夕・夜は薄く重なる', () => {
    for (const h of [9, 12, 15.5]) expect(daylightAt(h)).toBeNull();
    for (const h of [0, 3, 6.5, 17.5, 19, 22]) expect(daylightAt(h)).not.toBeNull();
  });
  it('どの時刻でも濃さは 0.2 以下で、24 時間なめらかにつながる（1 分の差で 0.01 を超えて動かない）', () => {
    let prev = daylightAt(0)?.alpha ?? 0;
    for (let m = 1; m <= 24 * 60; m++) {
      const a = daylightAt(m / 60)?.alpha ?? 0;
      expect(a).toBeLessThanOrEqual(0.2);
      expect(Math.abs(a - prev)).toBeLessThan(0.01);
      prev = a;
    }
  });
});
