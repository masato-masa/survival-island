import { describe, expect, it } from 'vitest';

import { CROPS, NODES, craftMs, damageForLevel } from '../src/game/data';
import { migrate } from '../src/game/save';
import {
  buySkill,
  chooseCrop,
  collectCraft,
  craft,
  farmAction,
  hitNode,
  openChest,
  place,
} from '../src/game/actions';
import { isAreaOpen, isBuildable } from '../src/game/rules';
import { freeTiles, freshSave, world } from './helpers';

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

    // 2 発目で切り倒れて幹になる（hp=2, ダメージ1ずつ）。木材が出て、木はまだ消えない
    const r2 = hitNode(world, save, tree, 0);
    expect(r2.ok).toBe(true);
    expect(save.nodes[tree.id]?.stump).toBe(true);
    expect(save.nodes[tree.id]?.destroyedAt).toBeNull();
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
      // hp=3, ダメージ 1（axePower Lv1）なので木が倒れるまで 3 発、幹を切るのに 2 発
      for (let i = 0; i < 5; i++) {
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
  it('素材を消費して作業が始まり、時間が経つと受け取れる', () => {
    const save = freshSave(0);
    save.inventory.wood = 2;
    const r = craft(save, 'woodFence', 0);
    expect(r.ok).toBe(true);
    expect(save.inventory.wood).toBe(0);
    expect(save.furniture.woodFence ?? 0).toBe(0);
    expect(save.crafting).toEqual({ furnitureId: 'woodFence', startedAt: 0, endsAt: craftMs('woodFence') });

    // 途中では受け取れない
    const early = collectCraft(save, craftMs('woodFence') - 1);
    expect(early.ok).toBe(false);
    expect(save.crafting).not.toBeNull();

    const done = collectCraft(save, craftMs('woodFence'));
    expect(done.ok).toBe(true);
    expect(save.furniture.woodFence).toBe(1);
    expect(save.crafting).toBeNull();
    // 二重に受け取れない
    expect(collectCraft(save, craftMs('woodFence')).ok).toBe(false);
    expect(save.furniture.woodFence).toBe(1);
  });

  it('作業中は別の家具を作れない（素材は減らない）', () => {
    const save = freshSave(0);
    save.inventory.wood = 4;
    expect(craft(save, 'woodFence', 0).ok).toBe(true);
    const r = craft(save, 'woodPath', 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('busy');
    expect(save.inventory.wood).toBe(2);
  });

  it('クラフト時間は島ポイントに比例する', () => {
    expect(craftMs('woodFence')).toBe(30_000);
    expect(craftMs('woodTower')).toBe(240_000);
    expect(craftMs('stoneStatue')).toBe(300_000);
  });

  it('古いセーブ（crafting なし）は null で読み込まれる', () => {
    const save = migrate({});
    expect(save.crafting).toBeNull();
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
  it('水の上・資源の上には置けない', () => {
    const save = freshSave(0);
    save.furniture.woodFence = 2;
    const waterIdx = world.ground.indexOf('water');
    const r = place(world, save, waterIdx % world.width, Math.floor(waterIdx / world.width), 'woodFence');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cannotPlace');
    const node = world.nodes[0];
    if (!node) throw new Error('no node');
    expect(place(world, save, node.x, node.y, 'woodFence').ok).toBe(false);
  });

  it('どの種類の家具も、空いている歩けるマスなら自由に置ける', () => {
    const save = freshSave(0);
    save.furniture.woodBench = 1;
    save.furniture.woodDesk = 1;
    const [a, b] = freeTiles(save, 2);
    if (!a || !b) throw new Error('no free tiles');
    expect(place(world, save, a.x, a.y, 'woodBench').ok).toBe(true);
    expect(place(world, save, b.x, b.y, 'woodDesk').ok).toBe(true);
  });

  it('置く・入れ替える・しまう', () => {
    const save = freshSave(0);
    save.furniture.woodFence = 1;
    save.furniture.stoneFence = 1;
    const [t] = freeTiles(save, 1);
    if (!t) throw new Error('no free tile');

    expect(place(world, save, t.x, t.y, 'woodFence').ok).toBe(true);
    expect(save.placements[t.id]).toBe('woodFence');
    expect(save.furniture.woodFence).toBe(0);

    // 入れ替え：元の家具は持ち物に戻る
    expect(place(world, save, t.x, t.y, 'stoneFence').ok).toBe(true);
    expect(save.placements[t.id]).toBe('stoneFence');
    expect(save.furniture.woodFence).toBe(1);
    expect(save.furniture.stoneFence).toBe(0);

    // しまう
    expect(place(world, save, t.x, t.y, null).ok).toBe(true);
    expect(save.placements[t.id]).toBeUndefined();
    expect(save.furniture.stoneFence).toBe(1);
  });

  it('ランドマークは 2x2 を占め、重なる場所には置けない', () => {
    const save = freshSave(0);
    save.furniture.woodTower = 1;
    save.furniture.woodFence = 1;
    let anchor: { x: number; y: number } | null = null;
    for (let y = 0; y < world.height - 1 && !anchor; y++) {
      for (let x = 0; x < world.width - 1 && !anchor; x++) {
        if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => isBuildable(world, save, x + dx!, y + dy!))) anchor = { x, y };
      }
    }
    if (!anchor) throw new Error('no 2x2 space');
    expect(place(world, save, anchor.x, anchor.y, 'woodTower').ok).toBe(true);
    expect(place(world, save, anchor.x + 1, anchor.y + 1, 'woodFence').ok).toBe(false);
    // 塔の右下のマスをタップして「しまう」と塔がしまわれる
    expect(place(world, save, anchor.x + 1, anchor.y + 1, null).ok).toBe(true);
    expect(save.placements[`${anchor.x},${anchor.y}`]).toBeUndefined();
  });

  it('統一ボーナスと maxPoints は下がらない', () => {
    const save = freshSave(0);
    const tiles = freeTiles(save, 3);
    expect(tiles.length).toBe(3);
    save.furniture.woodFence = 3;
    for (const t of tiles) expect(place(world, save, t.x, t.y, 'woodFence').ok).toBe(true);
    // 3 個で wood シリーズのボーナス +2 が入る（1個1点 x3 + ボーナス2 = 5）
    expect(save.maxPoints).toBeGreaterThanOrEqual(5);
    const afterPlacing = save.maxPoints;
    place(world, save, tiles[0]!.x, tiles[0]!.y, null);
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

describe('木は 切る → 幹 → 消える', () => {
  it('木を切ると幹になり、幹を切ると消える', () => {
    const save = freshSave(0);
    const node = world.nodes.find((n) => n.kind === 'tree');
    if (!node) throw new Error('no tree');
    let now = 0;
    const hit = () => {
      const r = hitNode(world, save, node, now);
      now += 60_000; // クールダウン・スタミナ回復ぶん進める
      save.stamina = { value: 30, updatedAt: now };
      return r;
    };
    // 幹になるまで
    while (!save.nodes[node.id]?.stump) expect(hit().ok).toBe(true);
    expect(save.nodes[node.id]?.destroyedAt).toBeNull();
    expect(save.inventory.wood ?? 0).toBeGreaterThan(0);
    // 幹を切ると消える
    while (save.nodes[node.id]?.destroyedAt == null) expect(hit().ok).toBe(true);
    expect(save.nodes[node.id]?.destroyedAt).not.toBeNull();
  });

  it('森の木は最高段階の斧でしか切れず、消えた跡地には家具を置ける', () => {
    const save = freshSave(0);
    const node = world.nodes.find((n) => n.kind === 'forestTree' && n.x > 0);
    if (!node) throw new Error('no forest tree');
    const r = hitNode(world, save, node, 0);
    expect(r.ok).toBe(false);
    save.skills.axePower = 5;
    let now = 0;
    while (save.nodes[node.id]?.destroyedAt == null) {
      const hr = hitNode(world, save, node, now);
      expect(hr.ok).toBe(true);
      now += 60_000;
      save.stamina = { value: 30, updatedAt: now };
    }
    expect(isBuildable(world, save, node.x, node.y)).toBe(true);
    expect(isAreaOpen(world, save, 'plaza')).toBe(true);
  });
});
