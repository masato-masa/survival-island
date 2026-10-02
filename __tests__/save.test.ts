import { describe, expect, it } from 'vitest';

import { migrate, newSave } from '../src/game/save';
import { STAMINA_BASE } from '../src/game/data';
import { world } from './helpers';

describe('newSave', () => {
  it('開始位置・満タンのスタミナ・空の持ち物で始まる', () => {
    const save = newSave(world, 1000);
    expect(save.player.x).toBe(world.start.x + 0.5);
    expect(save.player.y).toBe(world.start.y + 0.5);
    expect(save.player.dir).toBe('down');
    expect(save.stamina.value).toBe(STAMINA_BASE);
    expect(save.seenIntro).toBe(false);
    expect(save.version).toBe(1);
    expect(Object.keys(save.inventory).length).toBe(0);
    for (const level of Object.values(save.skills)) expect(level).toBe(0);
  });
});

describe('migrate', () => {
  it('空のオブジェクトから既定値で埋める', () => {
    const save = migrate({});
    expect(save.version).toBe(1);
    expect(save.stamina.value).toBe(STAMINA_BASE);
    expect(save.player).toEqual({ x: 0, y: 0, dir: 'down' });
    expect(save.maxPoints).toBe(0);
    expect(save.chestsOpened).toEqual([]);
  });

  it('既存のフィールドは保持し、欠けたものだけ埋める', () => {
    const partial = {
      xp: 42,
      skills: { axePower: 3 },
      inventory: { wood: 5 },
    };
    const save = migrate(partial);
    expect(save.xp).toBe(42);
    expect(save.skills.axePower).toBe(3);
    expect(save.skills.pickHard).toBe(0); // 欠けていた分は既定値
    expect(save.inventory.wood).toBe(5);
  });

  it('壊れた入力でも例外を投げない', () => {
    expect(() => migrate(null)).not.toThrow();
    expect(() => migrate('garbage')).not.toThrow();
    expect(() => migrate(42)).not.toThrow();
  });

  it('古いセーブには植えたもの {} を足し、最初からある家具を一度だけ入れる（埋まっているマスは飛ばす）', () => {
    const bench = world.initialFurniture.find((f) => f.furniture === 'woodWorkbench');
    const pillar = world.initialFurniture.find((f) => f.furniture === 'oldPillar');
    if (!bench || !pillar) throw new Error('no initial furniture');
    const old = { placements: { [`${bench.x},${bench.y}`]: 'woodFence' } };
    const save = migrate(old, world);
    expect(save.planted).toEqual({});
    expect(save.seededV2).toBe(true);
    expect(save.placements[`${bench.x},${bench.y}`]).toBe('woodFence');
    expect(save.placements[`${pillar.x},${pillar.y}`]).toBe('oldPillar');

    // 一度入れたら、しまっても次の読み込みで戻らない
    delete save.placements[`${pillar.x},${pillar.y}`];
    const again = migrate(JSON.parse(JSON.stringify(save)), world);
    expect(again.placements[`${pillar.x},${pillar.y}`]).toBeUndefined();
  });
});
