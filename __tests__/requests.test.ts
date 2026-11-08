// 島のおねがい（SI-11）。効き目が全部効いている間に集めた分だけが進む。
import { describe, expect, it } from 'vitest';

import { cook, hitNode } from '../src/game/actions';
import { REQUESTS } from '../src/game/data';
import { currentRequest } from '../src/game/rules';
import { freshSave, world } from './helpers';

function chopAll(save: ReturnType<typeof freshSave>, now: number, times: number) {
  const trees = world.nodes.filter((n) => n.kind === 'tree');
  let events: unknown[] = [];
  for (let i = 0; i < times; i++) {
    const t = trees[i % trees.length]!;
    for (let k = 0; k < 8; k++) {
      const r = hitNode(world, save, t, now);
      if (r.ok) events = events.concat(r.events);
    }
  }
  return events;
}

describe('島のおねがい', () => {
  it('効き目なしで集めても進まない', () => {
    const save = freshSave();
    save.stamina.value = 999;
    chopAll(save, 0, 3);
    expect(save.request.progress).toBe(0);
  });

  it('力もちの間に木材を集めると進み、目標でごほうびが出て次へ進む', () => {
    const save = freshSave();
    save.stamina.value = 999;
    save.inventory.turnip = 2;
    cook(save, 'turnipSoup', 0);
    const events = chopAll(save, 1000, 8);
    expect(save.request.done).toContain('wood16');
    expect(save.inventory.sapling ?? 0).toBeGreaterThanOrEqual(3);
    expect(events).toContainEqual({ type: 'requestDone', id: 'wood16' });
    expect(currentRequest(save)!.def.id).toBe('fish5');
  });

  it('効き目が切れたあとは進まない', () => {
    const save = freshSave();
    save.stamina.value = 999;
    save.inventory.turnip = 2;
    cook(save, 'turnipSoup', 0);
    chopAll(save, 11 * 60 * 1000, 3);
    expect(save.request.progress).toBe(0);
  });

  it('島レベルが足りないおねがいは受けられない（数えない）', () => {
    const save = freshSave();
    save.request.done = ['wood16', 'fish5'];
    expect(currentRequest(save)).toMatchObject({ locked: true });
    expect(REQUESTS.map((r) => r.id)).toEqual(['wood16', 'fish5', 'crop8', 'stone12', 'wood30']);
  });
});
