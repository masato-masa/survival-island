import { describe, expect, it } from 'vitest';

import { islandPoints, updateMaxPoints } from '../src/game/score';
import { freshSave, world } from './helpers';

describe('islandPoints', () => {
  it('配置した家具の得点を合計する', () => {
    const save = freshSave(0);
    const slot = world.slots.find((s) => s.attr === 'fence');
    if (!slot) throw new Error('no fence slot');
    save.placements[slot.id] = 'woodFence'; // points: 1
    const points = islandPoints(world, save);
    expect(points.base).toBe(1);
    expect(points.total).toBe(1);
  });

  it('同じシリーズが 3 個そろうとボーナスが付く', () => {
    const save = freshSave(0);
    const fenceArea = world.slots.find((s) => s.attr === 'fence')?.area;
    const slots = world.slots.filter((s) => s.attr === 'fence' && s.area === fenceArea).slice(0, 3);
    expect(slots.length).toBe(3);
    for (const s of slots) save.placements[s.id] = 'woodFence';
    const points = islandPoints(world, save);
    expect(points.base).toBe(3);
    expect(points.bonus).toBe(2); // SERIES_BONUS: count>=3 -> +2
    expect(points.total).toBe(5);
  });
});

describe('updateMaxPoints', () => {
  it('島レベルが上がったら islandLevelUp イベントを返す', () => {
    const save = freshSave(0);
    const fenceArea = world.slots.find((s) => s.attr === 'fence')?.area;
    const slots = world.slots.filter((s) => s.attr === 'fence' && s.area === fenceArea).slice(0, 3);
    for (const s of slots) save.placements[s.id] = 'woodFence';
    const event = updateMaxPoints(world, save);
    // base3 + bonus2 = 5 < ISLAND_LEVEL_POINTS[1]=10 なのでまだ上がらない
    expect(save.maxPoints).toBe(5);
    expect(event).toBeNull();
  });

  it('しきい値を超えたらレベルアップイベント', () => {
    const save = freshSave(0);
    // 木製シリーズを 3 種類（bench, desk, workbench）同じエリアに置く: 3+3+4=10 base + 3個でボーナス2 = 12
    const workbenchSlot = world.slots.find((s) => s.attr === 'workbench');
    const area = workbenchSlot?.area;
    const benchSlot = world.slots.find((s) => s.attr === 'bench' && s.area === area);
    const deskSlot = world.slots.find((s) => s.attr === 'desk' && s.area === area);
    if (!benchSlot || !deskSlot || !workbenchSlot) throw new Error('missing slots');

    save.placements[benchSlot.id] = 'woodBench';
    expect(updateMaxPoints(world, save)).toBeNull(); // 3 点、まだ届かない

    save.placements[deskSlot.id] = 'woodDesk';
    expect(updateMaxPoints(world, save)).toBeNull(); // 6 点、まだ届かない

    save.placements[workbenchSlot.id] = 'woodWorkbench';
    const event = updateMaxPoints(world, save); // 10 + ボーナス2 = 12 で島レベル2 へ
    expect(event).not.toBeNull();
    if (event) expect(event.type).toBe('islandLevelUp');
    expect(save.maxPoints).toBe(12);
  });
});
