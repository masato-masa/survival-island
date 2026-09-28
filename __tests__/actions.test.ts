import { describe, expect, it } from 'vitest';

import { CROPS, NODES, damageForLevel } from '../src/game/data';
import {
  buySkill,
  chooseCrop,
  craft,
  farmAction,
  hitNode,
  openChest,
  place,
} from '../src/game/actions';
import { isAreaOpen } from '../src/game/rules';
import { freshSave, world } from './helpers';

function findCenterWithNeighbour(tiles: { x: number; y: number }[]): { x: number; y: number } | undefined {
  const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
  return tiles.find(
    (t) =>
      keys.has(`${t.x + 1},${t.y}`) ||
      keys.has(`${t.x - 1},${t.y}`) ||
      keys.has(`${t.x},${t.y + 1}`) ||
      keys.has(`${t.x},${t.y - 1}`),
  );
}

describe('hitNode: 木を叩く', () => {
  it('体力が減り、壊れたら素材が出てスタミナと経験値が動く', () => {
    const save = freshSave(0);
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    const startStamina = save.stamina.value;

    const r1 = hitNode(world, save, tree, 0);
    expect(r1.ok).toBe(true);
    expect(save.stamina.value).toBe(startStamina - 1);
    expect(save.xp).toBe(1);
    expect(save.nodes[tree.id]?.hp).toBe(NODES.tree.hp - damageForLevel(0));

    // 2 発目で壊れる（hp=2, ダメージ1ずつ）
    const r2 = hitNode(world, save, tree, 0);
    expect(r2.ok).toBe(true);
    expect(save.nodes[tree.id]?.destroyedAt).toBe(0);
    expect(save.inventory.wood).toBe(NODES.tree.drops.wood);
    if (r2.ok) {
      expect(r2.events.some((e) => e.type === 'broke')).toBe(true);
    }
  });

  it('スタミナが無ければ何もしない', () => {
    const save = freshSave(0);
    save.stamina.value = 0;
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    const r = hitNode(world, save, tree, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('noStamina');
  });
});

describe('hitNode: 太い木はスキルが無いと弾かれる', () => {
  it('needSkill で失敗し、状態が変わらない', () => {
    const save = freshSave(0);
    const bigTree = world.nodes.find((n) => n.kind === 'bigTree');
    if (!bigTree) throw new Error('no bigTree');
    const r = hitNode(world, save, bigTree, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('needSkill');
    expect(save.nodes[bigTree.id]).toBeUndefined();
  });
});

describe('境界を壊すとエリアが開く', () => {
  it('forest の境界 2 マスを両方壊すと areaOpened が出る', () => {
    const save = freshSave(0);
    save.skills.axePower = 1; // forest border requires axePower 1
    const borders = world.nodes.filter((n) => n.area === 'forest' && n.kind === 'borderTree');
    expect(borders.length).toBe(2);
    expect(isAreaOpen(world, save, 'forest')).toBe(false);

    let now = 0;
    let openedEventSeen = false;
    for (const border of borders) {
      // hp=3, ダメージ 1（axePower Lv1）なので 3 発必要
      for (let i = 0; i < 3; i++) {
        const r = hitNode(world, save, border, now);
        expect(r.ok).toBe(true);
        if (r.ok && r.events.some((e) => e.type === 'areaOpened')) openedEventSeen = true;
        now += 1;
      }
    }
    expect(isAreaOpen(world, save, 'forest')).toBe(true);
    expect(openedEventSeen).toBe(true);
  });
});

describe('スキル購入', () => {
  it('経験値を消費して段階が上がる', () => {
    const save = freshSave(0);
    save.xp = 100;
    const r = buySkill(save, 'axePower');
    expect(r.ok).toBe(true);
    expect(save.skills.axePower).toBe(1);
    expect(save.xp).toBe(100 - 10); // SKILL_COST[0] = 10
  });

  it('経験値が足りなければ失敗', () => {
    const save = freshSave(0);
    save.xp = 0;
    const r = buySkill(save, 'axePower');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('noXp');
  });

  it('島レベルの上限を超えて上げられない', () => {
    const save = freshSave(0); // island level 1
    save.xp = 100000;
    const r = buySkill(save, 'axePower'); // level 1 -> 1 は OK（cap=1）
    expect(r.ok).toBe(true);
    const r2 = buySkill(save, 'axePower'); // 2 段階目は cap=1 を超える
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('levelCap');
  });
});

describe('クラフト', () => {
  it('素材を消費して家具ができる', () => {
    const save = freshSave(0);
    save.inventory.wood = 2;
    const r = craft(save, 'woodFence', 0);
    expect(r.ok).toBe(true);
    expect(save.inventory.wood).toBe(0);
    expect(save.furniture.woodFence).toBe(1);
  });

  it('素材が足りなければ失敗', () => {
    const save = freshSave(0);
    save.inventory.wood = 0;
    const r = craft(save, 'woodFence', 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('notEnoughItems');
  });

  it('覚えていないレシピは作れない', () => {
    const save = freshSave(0);
    save.inventory.wood = 100;
    save.inventory.stone = 100;
    const r = craft(save, 'stonePath', 0); // island level 2 で覚える
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('notLearned');
  });
});

describe('配置', () => {
  it('属性が違うと置けない', () => {
    const save = freshSave(0);
    save.furniture.woodFence = 1;
    const benchSlot = world.slots.find((s) => s.attr === 'bench');
    if (!benchSlot) throw new Error('no bench slot');
    const r = place(world, save, benchSlot.id, 'woodFence');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrongAttr');
  });

  it('置く・入れ替える・しまう', () => {
    const save = freshSave(0);
    save.furniture.woodFence = 1;
    save.furniture.stoneFence = 1;
    const fenceSlot = world.slots.find((s) => s.attr === 'fence');
    if (!fenceSlot) throw new Error('no fence slot');

    const r1 = place(world, save, fenceSlot.id, 'woodFence');
    expect(r1.ok).toBe(true);
    expect(save.placements[fenceSlot.id]).toBe('woodFence');
    expect(save.furniture.woodFence).toBe(0);

    // 入れ替え：元の家具は持ち物に戻る
    const r2 = place(world, save, fenceSlot.id, 'stoneFence');
    expect(r2.ok).toBe(true);
    expect(save.placements[fenceSlot.id]).toBe('stoneFence');
    expect(save.furniture.woodFence).toBe(1);
    expect(save.furniture.stoneFence).toBe(0);

    // しまう
    const r3 = place(world, save, fenceSlot.id, null);
    expect(r3.ok).toBe(true);
    expect(save.placements[fenceSlot.id]).toBeUndefined();
    expect(save.furniture.stoneFence).toBe(1);
  });

  it('統一ボーナスと maxPoints は下がらない', () => {
    const save = freshSave(0);
    const fenceSlots = world.slots.filter((s) => s.attr === 'fence' && s.area === 'beach');
    expect(fenceSlots.length).toBeGreaterThanOrEqual(3);
    save.furniture.woodFence = 3;

    for (let i = 0; i < 3; i++) {
      const slot = fenceSlots[i];
      if (!slot) throw new Error('missing slot');
      const r = place(world, save, slot.id, 'woodFence');
      expect(r.ok).toBe(true);
    }
    // 3 個で wood シリーズのボーナス +2 が入る（1個1点 x3 + ボーナス2 = 5）
    expect(save.maxPoints).toBeGreaterThanOrEqual(5);
    const afterPlacing = save.maxPoints;

    // 1 つしまうとボーナスが消えて現在の得点は下がるが、maxPoints は下がらない
    const firstSlot = fenceSlots[0];
    if (!firstSlot) throw new Error('missing slot');
    place(world, save, firstSlot.id, null);
    expect(save.maxPoints).toBe(afterPlacing);
  });
});

describe('宝箱', () => {
  it('開けるとレシピを覚える。二度目は何もしない', () => {
    const save = freshSave(0);
    const chest = world.chests[0];
    if (!chest) throw new Error('no chest');
    const r = openChest(world, save, chest);
    expect(r.ok).toBe(true);
    expect(save.learnedRecipes).toContain(chest.recipe);
    expect(save.chestsOpened).toContain(chest.id);

    const r2 = openChest(world, save, chest);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.events.length).toBe(0);
  });
});

describe('畑: 植える → 育成中 → 収穫', () => {
  it('選んでいないと植えられない', () => {
    const save = freshSave(0);
    const plot = world.plots[0];
    if (!plot) throw new Error('no plot');
    const tile = plot.tiles[0];
    if (!tile) throw new Error('no tile');
    const r = farmAction(world, save, plot, tile.x, tile.y, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('noCrop');
  });

  it('植えて、育つ前は収穫できず、育ったら収穫できる', () => {
    const save = freshSave(0);
    const plot = world.plots[0];
    if (!plot) throw new Error('no plot');
    const tile = plot.tiles[0];
    if (!tile) throw new Error('no tile');

    chooseCrop(save, plot.id, 'turnip');
    const rPlant = farmAction(world, save, plot, tile.x, tile.y, 0);
    expect(rPlant.ok).toBe(true);

    const growMs = CROPS.turnip.growMs;
    const rTooSoon = farmAction(world, save, plot, tile.x, tile.y, growMs - 1000);
    expect(rTooSoon.ok).toBe(false);
    if (!rTooSoon.ok) expect(rTooSoon.reason).toBe('notReady');

    const before = save.inventory.turnip ?? 0;
    const rHarvest = farmAction(world, save, plot, tile.x, tile.y, growMs + 1000);
    expect(rHarvest.ok).toBe(true);
    expect((save.inventory.turnip ?? 0) - before).toBeGreaterThan(0);
  });

  it('farmRange を上げると範囲でまとめて種まき・収穫できる', () => {
    const save = freshSave(0);
    save.skills.farmRange = 1; // 十字 5 マス
    const plot = world.plots.find((p) => p.tiles.length >= 4);
    if (!plot) throw new Error('need a bigger plot');
    const center = findCenterWithNeighbour(plot.tiles);
    if (!center) throw new Error('no suitable center tile in this plot shape');

    chooseCrop(save, plot.id, 'turnip');
    const r = farmAction(world, save, plot, center.x, center.y, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const planted = r.events.find((e) => e.type === 'planted');
      expect(planted && planted.type === 'planted' ? planted.tiles.length : 0).toBeGreaterThan(1);
    }
  });

  it('スタミナが足りないときは足りる分だけ植える', () => {
    const save = freshSave(0);
    save.skills.farmRange = 1;
    save.stamina.value = 2;
    const plot = world.plots.find((p) => p.tiles.length >= 4);
    if (!plot) throw new Error('need a bigger plot');
    const center = findCenterWithNeighbour(plot.tiles);
    if (!center) throw new Error('no suitable center tile');

    chooseCrop(save, plot.id, 'turnip');
    const r = farmAction(world, save, plot, center.x, center.y, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const planted = r.events.find((e) => e.type === 'planted');
      expect(planted && planted.type === 'planted' ? planted.tiles.length : 0).toBe(2);
    }
    expect(save.stamina.value).toBe(0);
  });
});
