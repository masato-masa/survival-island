// たから探し（SI-28）。日付で決まる場所・手がかり・掘る・宝の強さ。
import { describe, expect, it } from 'vitest';

import { dig } from '../src/game/actions';
import { isAreaOpen } from '../src/game/rules';
import { findTarget, isSolidTile } from '../src/game/target';
import { compass } from '../src/game/tower';
import { recordLife, lifeCount } from '../src/game/lifelog';
import { rollTreasure, todaysTreasure, treasureClue, treasureReward, TREASURES } from '../src/game/treasure';
import type { AreaId, GameEvent } from '../src/game/types';
import { freshSave, world } from './helpers';

const DAY = 86400000;
const open = (save: ReturnType<typeof freshSave>) => (a: string) => isAreaOpen(world, save, a as AreaId);

describe('たから探し', () => {
  it('その日の最初に場所が決まり、同じ日は動かない。日が替わると別の場所になる', () => {
    const save = freshSave();
    const t0 = 20800 * DAY;
    const a = { ...rollTreasure(world, save, t0, open(save)) };
    const b = rollTreasure(world, save, t0 + 3600000, open(save));
    expect(b).toEqual(a);
    const places = new Set<string>();
    for (let d = 0; d < 30; d++) {
      const s = freshSave();
      const r = rollTreasure(world, s, (20800 + d) * DAY, open(s));
      places.add(`${r.x},${r.y}`);
    }
    expect(places.size).toBeGreaterThan(20);
  });

  it('場所は、開いているエリアの中の、歩いて行ける空きマス（地図の物の上ではない）', () => {
    for (let d = 0; d < 60; d++) {
      const s = freshSave();
      const r = rollTreasure(world, s, (20800 + d) * DAY, open(s));
      expect(isSolidTile(world, s, r.x, r.y, 0)).toBe(false);
      const area = world.area[r.y * world.width + r.x];
      expect(area).not.toBeNull();
      expect(isAreaOpen(world, s, area!)).toBe(true);
    }
  });

  it('そばに立つと対象になり、掘ると宝が入って 1 スタミナ減る。1 日 1 回', () => {
    const save = freshSave();
    const now = 20800 * DAY;
    const r = rollTreasure(world, save, now, open(save));
    save.player.x = r.x + 0.5;
    save.player.y = r.y + 0.9;
    const tgt = findTarget(world, save, save.player.x, save.player.y, 'down', now);
    expect(tgt?.kind).toBe('treasure');
    const before = save.stamina.value;
    const res = dig(save, now);
    expect(res.ok).toBe(true);
    expect(save.stamina.value).toBe(before - 1);
    const reward = treasureReward(r.day);
    for (const [k, n] of Object.entries(reward)) expect(save.inventory[k as keyof typeof save.inventory]).toBe(n);
    expect(todaysTreasure(save, now)).toBeNull();
    expect(dig(save, now).ok).toBe(false);
    // 遠くでは対象にならない
    const save2 = freshSave();
    const r2 = rollTreasure(world, save2, now, open(save2));
    save2.player.x = r2.x + 6;
    save2.player.y = r2.y + 6;
    expect(findTarget(world, save2, save2.player.x, save2.player.y, 'down', now)?.kind).not.toBe('treasure');
  });

  it('手がかり: エリア名は常に、方角は見張り台 1 段階から、距離は 3 段階から', () => {
    const save = freshSave();
    const now = 20800 * DAY;
    rollTreasure(world, save, now, open(save));
    const c0 = treasureClue(world, save, now, compass)!;
    expect(c0.area.length).toBeGreaterThan(0);
    expect(c0.dir).toBeNull();
    save.tower.stage = 1;
    expect(treasureClue(world, save, now, compass)!.dir).not.toBeNull();
    expect(treasureClue(world, save, now, compass)!.dist).toBeNull();
    save.tower.stage = 3;
    expect(treasureClue(world, save, now, compass)!.dist).toBeGreaterThanOrEqual(0);
  });

  it('宝は作業スタミナ 5〜7 相当（値打ちの見積もりは lifelog.test.ts と同じ）。暮らしの記録に数える', () => {
    const value: Record<string, number> = { copper: 2.5, stone: 1, wood: 1, petal: 0.5, sapling: 2, bigFish: 5, sunflower: 2.5, tomato: 3, fish: 1.5 };
    const rows: string[] = [];
    for (const t of TREASURES) {
      const v = Object.entries(t).reduce((s, [k, n]) => s + value[k]! * (n as number), 0);
      rows.push(`${JSON.stringify(t)} → ${v}`);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(7);
    }
    // eslint-disable-next-line no-console
    console.log('[たから探しの宝]\n' + rows.join('\n'));
    const save = freshSave();
    const ev: GameEvent[] = [{ type: 'treasureFound', items: { copper: 2 }, x: 1, y: 1 }];
    recordLife(save, ev, 0);
    expect(lifeCount(save, 'treasure')).toBe(1);
  });
});
