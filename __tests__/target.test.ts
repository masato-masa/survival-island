import { describe, expect, it } from 'vitest';

import { buildWorld } from '../src/game/world';
import { findTarget, isSolidTile, tryMove } from '../src/game/target';
import { freshSave, world } from './helpers';

// 当たり判定・移動のテスト用に小さな独立マップを使う（本物の 40x30 マップに依存しない）。
const smallMap = ['~~~~~', '~@..~', '~.T.~', '~...~', '~~~~~'];
const smallWorld = buildWorld(smallMap);

describe('isSolidTile', () => {
  it('水は通れない', () => {
    const save = freshSave(0);
    expect(isSolidTile(smallWorld, save, 0, 0, 0)).toBe(true);
  });

  it('マップ外は通れない', () => {
    const save = freshSave(0);
    expect(isSolidTile(smallWorld, save, -1, 0, 0)).toBe(true);
    expect(isSolidTile(smallWorld, save, 100, 0, 0)).toBe(true);
  });

  it('生きている資源は通れない、壊れたら通れる', () => {
    const save = freshSave(0);
    expect(isSolidTile(smallWorld, save, 2, 2, 0)).toBe(true);
    const tree = smallWorld.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    save.nodes[tree.id] = { hp: 0, destroyedAt: 0 };
    expect(isSolidTile(smallWorld, save, 2, 2, 100)).toBe(false);
  });
});

describe('tryMove', () => {
  it('壁（木）に向かって進むと止まる', () => {
    const save = freshSave(0);
    // 木は (2,2)。その真左のマス中心 (1.5, 2.5) からスタートして東へ大きく進もうとする。
    const start = { x: 1.5, y: 2.5 };
    const result = tryMove(smallWorld, save, 0, start.x, start.y, 1, 0);
    expect(result.x).toBe(start.x); // 木にぶつかって動けない
    expect(result.y).toBe(start.y);
  });

  it('片方の軸だけ壁でも、もう片方には滑って進める', () => {
    const save = freshSave(0);
    // 木は (2,2)。木と同じ高さ、真左 (1.5, 2.2) から右下へ動こうとする。
    // x 方向（木の列）はぶつかるが、y 方向（下）は開いているので進めるはず。
    const start = { x: 1.5, y: 2.2 };
    const result = tryMove(smallWorld, save, 0, start.x, start.y, 1, 1);
    expect(result.x).toBe(start.x); // x は木にぶつかる
    expect(result.y).toBeGreaterThan(start.y); // y はそのまま進む
  });

  it('水には入れない', () => {
    const save = freshSave(0);
    const start = { x: 1.5, y: 1.5 }; // '.' タイル
    const result = tryMove(smallWorld, save, 0, start.x, start.y, -1, -1);
    expect(result.x).toBe(start.x);
    expect(result.y).toBe(start.y);
  });
});

describe('findTarget', () => {
  it('半径内で最も近いものを選ぶ', () => {
    const save = freshSave(0);
    const tree = world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    const px = tree.x + 0.5 + 0.3; // 木のすぐ近く
    const py = tree.y + 0.5;
    const target = findTarget(world, save, px, py, 'right', 0);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe('node');
    if (target?.kind === 'node') expect(target.node.id).toBe(tree.id);
  });

  it('スキル不足の資源は blocked フラグ付きで候補になる', () => {
    const save = freshSave(0);
    const bigTree = world.nodes.find((n) => n.kind === 'bigTree');
    if (!bigTree) throw new Error('no bigTree');
    const px = bigTree.x + 0.5;
    const py = bigTree.y + 0.5 + 0.2;
    const target = findTarget(world, save, px, py, 'up', 0);
    expect(target).not.toBeNull();
    expect(target?.blocked).toBe('needSkill');
  });

  it('遠すぎると何も選ばれない', () => {
    const save = freshSave(0);
    const target = findTarget(world, save, -100, -100, 'down', 0);
    expect(target).toBeNull();
  });
});

describe('設備の対象', () => {
  it('遺跡の隣に立つと遺跡が対象になり、通り抜けられない', async () => {
    const { buildWorld } = await import('../src/game/world');
    const { newSave } = await import('../src/game/save');
    const { findTarget, isSolidTile } = await import('../src/game/target');
    const w = buildWorld();
    const ruins = w.stations.find((s) => s.kind === 'ruins')!;
    const save = newSave(w, 0);
    const t = findTarget(w, save, ruins.x + 0.5, ruins.y + 1.6, 'up', 0);
    expect(t?.kind).toBe('station');
    expect(isSolidTile(w, save, ruins.x, ruins.y, 0)).toBe(true);
  });
});
