// ピグライフ風の採取: 1 回の行動で 1 段階、苗木・花・植える、ドロップ、作れない家具。

import { describe, expect, it } from 'vitest';

import { CROPS, FLOWER_GATHERS, FLOWER_GROW_MS, NODES, TREE_GROW_MS } from '../src/game/data';
import { canPlantAt, chooseCrop, craft, farmAction, hitNode, place, plant, workNode } from '../src/game/actions';
import { allNodes, isBuildable, liveNodeById } from '../src/game/rules';
import { isSolidTile } from '../src/game/target';
import type { GameEvent, SaveState } from '../src/game/types';
import { freeTiles, freshSave, world } from './helpers';

const findEvent = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('workNode: 1 回の行動で 1 段階', () => {
  it('木 → 幹 → 消える の 2 回。幹を切ると苗木が出て、dropped が出る', () => {
    const save = freshSave(0);
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');

    const r1 = workNode(world, save, tree, 0);
    expect(r1.ok).toBe(true);
    expect(save.nodes[tree.id]?.stump).toBe(true);
    expect(save.stamina.value).toBe(30 - NODES.tree.hp); // 1 回叩くごとに 1
    if (r1.ok) {
      expect(findEvent(r1.events, 'hit')).toHaveLength(1);
      expect(findEvent(r1.events, 'hit')[0]?.damage).toBe(NODES.tree.hp);
      expect(findEvent(r1.events, 'dropped')[0]?.items).toEqual({ wood: 2 });
      expect(findEvent(r1.events, 'xp')[0]?.amount).toBe(NODES.tree.hp);
    }

    const r2 = workNode(world, save, tree, 0);
    expect(r2.ok).toBe(true);
    expect(save.nodes[tree.id]?.destroyedAt).not.toBeNull();
    expect(save.inventory.sapling).toBe(1);
    if (r2.ok) expect(findEvent(r2.events, 'dropped')[0]?.items).toEqual({ wood: 1, sapling: 1 });
    // 木は復活しないので、跡地には家具も苗も置ける
    expect(isBuildable(world, save, tree.x, tree.y)).toBe(true);
  });

  it('パワー系スキルが高いとスタミナが少なく済む', () => {
    const save = freshSave(0);
    save.skills.axePower = 2; // ダメージ 2
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    expect(workNode(world, save, tree, 0).ok).toBe(true);
    expect(save.stamina.value).toBe(29);
  });

  it('途中でスタミナが尽きたら削った分を残して止まる。0 なら noStamina', () => {
    const save = freshSave(0);
    save.stamina.value = 1;
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    expect(workNode(world, save, tree, 0).ok).toBe(true);
    expect(save.nodes[tree.id]).toEqual({ hp: 1, destroyedAt: null });
    const r = workNode(world, save, tree, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('noStamina');
  });

  it('太い木の幹は苗木 2 本', () => {
    const save = freshSave(0);
    save.skills.axePower = 1;
    const big = world.nodes.find((n) => n.kind === 'bigTree');
    if (!big) throw new Error('no bigTree');
    expect(workNode(world, save, big, 0).ok).toBe(true);
    expect(workNode(world, save, big, 0).ok).toBe(true);
    expect(save.inventory.sapling).toBe(2);
  });
});

describe('花を摘む', () => {
  it('1 回ごとに 花びら 2・花の種 1。3 回で消えて二度と戻らない', () => {
    const save = freshSave(0);
    const flower = world.nodes.find((n) => n.kind === 'flower');
    if (!flower) throw new Error('no flower');
    for (let i = 1; i <= FLOWER_GATHERS; i++) {
      const r = workNode(world, save, flower, 0);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(findEvent(r.events, 'gathered')[0]?.remaining).toBe(FLOWER_GATHERS - i);
        expect(findEvent(r.events, 'dropped')[0]?.items).toEqual({ petal: 2, flowerSeed: 1 });
      }
    }
    expect(save.inventory.petal).toBe(2 * FLOWER_GATHERS);
    expect(save.inventory.flowerSeed).toBe(FLOWER_GATHERS);
    expect(save.stamina.value).toBe(30 - FLOWER_GATHERS);
    expect(hitNode(world, save, flower, 10 ** 12).ok).toBe(false);
    expect(isSolidTile(world, save, flower.x, flower.y, 10 ** 12)).toBe(false);
  });
});

describe('植える', () => {
  const freeTile = (save: SaveState) => {
    const [t] = freeTiles(save, 1);
    if (!t) throw new Error('no free tile');
    return t;
  };

  it('苗木は育つまで固くて叩けず、10 分で木になり、切ると苗木が戻る', () => {
    const save = freshSave(0);
    save.inventory.sapling = 1;
    const t = freeTile(save);
    expect(plant(world, save, t.x, t.y, 'sapling', 0).ok).toBe(true);
    expect(save.inventory.sapling).toBe(0);
    expect(save.stamina.value).toBe(29);
    expect(isSolidTile(world, save, t.x, t.y, 0)).toBe(true);
    expect(isBuildable(world, save, t.x, t.y)).toBe(false);

    const id = `p:${t.x},${t.y}`;
    const growing = liveNodeById(world, save, id, TREE_GROW_MS / 2);
    expect(growing).toMatchObject({ kind: 'tree', planted: true, growing: true, growth: 0.5 });
    expect(allNodes(world, save, 0).some((n) => n.id === id)).toBe(true);
    if (!growing) throw new Error('no planted node');
    expect(hitNode(world, save, growing, TREE_GROW_MS / 2).ok).toBe(false);

    const grown = liveNodeById(world, save, id, TREE_GROW_MS);
    expect(grown?.growing).toBe(false);
    if (!grown) throw new Error('no grown');
    expect(workNode(world, save, grown, TREE_GROW_MS).ok).toBe(true); // 幹になる
    expect(save.nodes[id]?.stump).toBe(true);
    expect(workNode(world, save, grown, TREE_GROW_MS).ok).toBe(true); // 消える
    expect(save.planted[`${t.x},${t.y}`]).toBeUndefined();
    expect(save.nodes[id]).toBeUndefined();
    expect(save.inventory.sapling).toBe(1);
    expect(isBuildable(world, save, t.x, t.y)).toBe(true);
  });

  it('花の種は 3 分で花になり、摘める', () => {
    const save = freshSave(0);
    save.inventory.flowerSeed = 1;
    const t = freeTile(save);
    expect(plant(world, save, t.x, t.y, 'flowerSeed', 0).ok).toBe(true);
    const flower = liveNodeById(world, save, `p:${t.x},${t.y}`, FLOWER_GROW_MS);
    expect(flower).toMatchObject({ kind: 'flower', growing: false });
    if (!flower) throw new Error('no flower');
    expect(workNode(world, save, flower, FLOWER_GROW_MS).ok).toBe(true);
    expect(save.inventory.petal).toBe(2);
  });

  it('種が無い・家具の上・植えたものの上・水・プレイヤーのマスには植えられない', () => {
    const save = freshSave(0);
    const t = freeTile(save);
    expect(plant(world, save, t.x, t.y, 'sapling', 0).ok).toBe(false);
    save.inventory.sapling = 5;
    expect(canPlantAt(world, save, t.x, t.y, { x: t.x, y: t.y })).toBe(false);
    expect(plant(world, save, t.x, t.y, 'sapling', 0).ok).toBe(true);
    expect(plant(world, save, t.x, t.y, 'sapling', 0).ok).toBe(false);
    const water = world.ground.indexOf('water');
    expect(plant(world, save, water % world.width, Math.floor(water / world.width), 'sapling', 0).ok).toBe(false);
    const anchor = Object.keys(save.placements)[0];
    if (!anchor) throw new Error('no placed furniture');
    const [ax, ay] = anchor.split(',').map(Number);
    expect(plant(world, save, ax ?? 0, ay ?? 0, 'sapling', 0).ok).toBe(false);
  });
});

describe('作れない家具・最初からある家具', () => {
  it('たき火はクラフトできない', () => {
    const save = freshSave(0);
    save.maxPoints = 1000;
    expect(craft(save, 'campfire', 0).ok).toBe(false);
  });

  it('最初からある作業台はしまって、別のマスに置き直せる', () => {
    const save = freshSave(0);
    const anchor = Object.entries(save.placements).find(([, id]) => id === 'woodWorkbench')?.[0];
    if (!anchor) throw new Error('no workbench');
    const [x, y] = anchor.split(',').map(Number);
    expect(place(world, save, x ?? 0, y ?? 0, null).ok).toBe(true);
    expect(save.furniture.woodWorkbench).toBe(1);
    const [t] = freeTiles(save, 1);
    if (!t) throw new Error('no free tile');
    expect(place(world, save, t.x, t.y, 'woodWorkbench').ok).toBe(true);
  });
});

describe('畑の収穫で dropped が出る', () => {
  it('収穫したマスごとに作物の dropped', () => {
    const save = freshSave(0);
    const plot = world.plots[0];
    const tile = plot?.tiles[0];
    if (!plot || !tile) throw new Error('no plot');
    chooseCrop(save, plot.id, 'turnip');
    farmAction(world, save, plot, tile.x, tile.y, 0);
    const r = farmAction(world, save, plot, tile.x, tile.y, CROPS.turnip.growMs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(findEvent(r.events, 'dropped')[0]).toMatchObject({ x: tile.x, y: tile.y, items: { turnip: 1 } });
  });
});
