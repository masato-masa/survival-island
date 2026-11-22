// 長く遊んだ先（島レベル 5 以降）のテンポ（SI-27）。商船・見張り台を直し終えるまでの日数を、1 日 1 回あそぶ人で数える。
// ボット（tempo.test.ts の延長）: 毎日 1 回、満タンのスタミナ（Lv5 の上限）を使い切り、日替わりの贈り物（商船・見張り台）を受け取る。
// 全部で必要な作業スタミナは ship.test.ts・tower.test.ts の測定値（力もちなし 271 + 223 = 494、力もちあり 185 + 144 = 329）。
// （モデルは粗い見積もり: 贈り物は直した割合に比例して増えるとして数える。天気は 1 回の上限スタミナに効かないので入れない）
// 贈り物は直した段階ぶんだけ増える（全部直して 1 日 17 + 12 相当）ので、直すほど速くなる（山場のあとの下り坂）。
import { describe, expect, it } from 'vitest';

const SHIP_WORK = 271;
const TOWER_WORK = 223;
/** 毎日のたから探しの宝（作業スタミナ換算の平均。treasure.test.ts は 5〜6）。 */
const TREASURE_DAILY = 5.5;
const SHIP_FULL_GIFT = 17;
const TOWER_FULL_GIFT = 12;

/** 1 日 1 回あそぶ人が、全部直し終えるまでの日数。session = 1 回で使うスタミナ。buffed = 力もちを使うか（作業 33% 減）。 */
function daysToFinish(session: number, buffed: boolean, treasure = 0): number {
  const factor = buffed ? 0.66 : 1;
  const total = (SHIP_WORK + TOWER_WORK) * factor;
  let done = 0;
  let day = 0;
  while (done < total && day < 365) {
    day++;
    // 贈り物は、いま直してある割合に応じて増える（前の日までの進み）
    const gift = (SHIP_FULL_GIFT + TOWER_FULL_GIFT) * Math.min(1, done / total);
    done += session + gift + treasure;
  }
  return day;
}

describe('テンポ: 島レベル 5 以降', () => {
  it('1 日 1 回あそぶ人が、商船と見張り台を直し終えるまでの日数（表）', () => {
    const rows: string[] = [];
    for (const session of [30, 40, 60]) {
      const a = daysToFinish(session, false);
      const b = daysToFinish(session, true);
      const c = daysToFinish(session, true, TREASURE_DAILY);
      rows.push(`1 回 ${session} スタミナ: 力もちなし ${a} 日 / 力もちあり ${b} 日 / 力もちあり＋毎日のたから探し ${c} 日`);
    }
    // eslint-disable-next-line no-console
    console.log('[山場のテンポ]\n' + rows.join('\n'));
    // 目安: 40 スタミナの人が 1〜3 週間で直し終える（延々と続かず、すぐ終わりもしない）
    const d = daysToFinish(40, true);
    expect(d).toBeGreaterThanOrEqual(5);
    expect(d).toBeLessThanOrEqual(21);
    expect(daysToFinish(40, false)).toBeLessThanOrEqual(30);
  });
});
