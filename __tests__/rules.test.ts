import { describe, expect, it } from 'vitest';

import { ISLAND_LEVEL_POINTS, damageForLevel } from '../src/game/data';
import { actionMs, canHit, damageFor, islandLevel, isAreaOpen, knownCrops, knownRecipes, skillCap } from '../src/game/rules';
import { freshSave, world } from './helpers';

describe('islandLevel', () => {
  it('maxPoints から段階的に決まる', () => {
    const save = freshSave(0);
    save.maxPoints = 0;
    expect(islandLevel(save)).toBe(1);
    save.maxPoints = ISLAND_LEVEL_POINTS[1] ?? 0;
    expect(islandLevel(save)).toBe(2);
    save.maxPoints = (ISLAND_LEVEL_POINTS[2] ?? 0) - 1;
    expect(islandLevel(save)).toBe(2);
    save.maxPoints = ISLAND_LEVEL_POINTS[4] ?? 0;
    expect(islandLevel(save)).toBe(5);
  });
});

describe('skillCap', () => {
  it('島レベルと maxLevel の小さい方', () => {
    const save = freshSave(0);
    save.maxPoints = 0; // level 1
    expect(skillCap(save, 'axePower')).toBe(1);
    save.maxPoints = ISLAND_LEVEL_POINTS[3] ?? 0; // level 4
    expect(skillCap(save, 'axePower')).toBe(4);
    save.maxPoints = ISLAND_LEVEL_POINTS[4] ?? 0; // level 5, farmRange maxLevel 2
    expect(skillCap(save, 'farmRange')).toBe(2);
  });
});

describe('canHit / damageFor', () => {
  it('太い木はスキル無しでは叩けない', () => {
    const save = freshSave(0);
    const bigTree = world.nodes.find((n) => n.kind === 'bigTree');
    if (!bigTree) throw new Error('no bigTree');
    expect(canHit(save, bigTree)).toBe(false);
    save.skills.axePower = 1;
    expect(canHit(save, bigTree)).toBe(true);
  });

  it('ダメージはパワー系スキルの段階から決まる', () => {
    const save = freshSave(0);
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    expect(damageFor(save, tree)).toBe(damageForLevel(0));
    save.skills.axePower = 3;
    expect(damageFor(save, tree)).toBe(damageForLevel(3));
  });
});

describe('actionMs', () => {
  it('伐採は 3 秒で、速度スキル 1 段階ごとに 10% 短くなる', () => {
    const save = freshSave(0);
    const base = actionMs(save, 'axe');
    expect(base).toBe(3000);
    save.skills.axeSpeed = 2;
    expect(actionMs(save, 'axe')).toBeCloseTo(base * 0.8);
  });

  it('畑・採取は速度スキルに関係なく 3 秒', () => {
    const save = freshSave(0);
    save.skills.axeSpeed = 5;
    save.skills.pickSpeed = 5;
    expect(actionMs(save, 'farm')).toBe(3000);
    expect(actionMs(save, 'gather')).toBe(3000);
  });
});

describe('knownRecipes / knownCrops', () => {
  it('島レベル 1 で覚えているレシピ', () => {
    const save = freshSave(0);
    const recipes = knownRecipes(save);
    expect(recipes).toContain('woodFence');
    expect(recipes).not.toContain('stonePath'); // レベル2
  });

  it('作れない家具（たき火・古い柱など）は覚えない', () => {
    const save = freshSave(0);
    save.maxPoints = 1000;
    const recipes = knownRecipes(save);
    for (const id of ['campfire', 'ruinArch', 'oldPillar']) expect(recipes).not.toContain(id);
  });

  it('宝箱で覚えたレシピも含む', () => {
    const save = freshSave(0);
    save.learnedRecipes.push('woodTower');
    expect(knownRecipes(save)).toContain('woodTower');
  });

  it('島レベルで解禁される種', () => {
    const save = freshSave(0);
    expect(knownCrops(save)).toEqual(['turnip']);
    save.maxPoints = ISLAND_LEVEL_POINTS[2] ?? 0; // level 3
    expect(knownCrops(save).sort()).toEqual(['sunflower', 'tomato', 'turnip'].sort());
  });
});

describe('isAreaOpen', () => {
  it('浜は常に開いている', () => {
    const save = freshSave(0);
    expect(isAreaOpen(world, save, 'beach')).toBe(true);
  });

  it('境界が残っていれば閉じている', () => {
    const save = freshSave(0);
    expect(isAreaOpen(world, save, 'forest')).toBe(false);
  });

  it('境界を全部壊すと開く', () => {
    const save = freshSave(0);
    const borders = world.nodes.filter((n) => n.area === 'forest' && n.kind === 'borderTree');
    for (const b of borders) save.nodes[b.id] = { hp: 0, destroyedAt: 0 };
    expect(isAreaOpen(world, save, 'forest')).toBe(true);
  });
});
