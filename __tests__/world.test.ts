import { describe, expect, it } from 'vitest';

import { AREA_ORDER } from '../src/game/data';
import { newSave } from '../src/game/save';
import { isSolidTile } from '../src/game/target';
import { buildWorld, worldIndex } from '../src/game/world';
import type { AreaId } from '../src/game/types';

const world = buildWorld();

describe('buildWorld', () => {
  it('マップは 32x35（細かい 64x70 の設計を 2x2 ずつまとめたもの）', () => {
    expect(world.width).toBe(32);
    expect(world.height).toBe(35);
  });

  it('7 エリアすべてが空でない', () => {
    for (const area of AREA_ORDER) {
      const tiles = world.area.filter((a) => a === area).length;
      expect(tiles).toBeGreaterThan(0);
    }
  });

  it('境界の文字はそれぞれちょうど 2 マス', () => {
    const borderNodes = world.nodes.filter((n) => n.kind === 'borderTree' || n.kind === 'borderRock');
    const byArea = new Map<AreaId, number>();
    for (const n of borderNodes) byArea.set(n.area, (byArea.get(n.area) ?? 0) + 1);
    for (const area of AREA_ORDER) {
      if (['beach', 'woods', 'plaza', 'ruins'].includes(area)) continue;
      expect(byArea.get(area)).toBe(2);
    }
  });

  it('すべての区画に看板がある', () => {
    expect(world.plots.length).toBeGreaterThan(0);
    for (const plot of world.plots) {
      expect(plot.sign).toBeTruthy();
      expect(plot.tiles.length).toBeGreaterThan(0);
    }
  });

  it('配置スペースは無い（家具は歩ける全マスに自由に置く）', () => {
    expect((world as unknown as { slots?: unknown }).slots).toBeUndefined();
  });

  it('水以外のすべてのマスがどこかのエリアに属する', () => {
    for (let i = 0; i < world.ground.length; i++) {
      if (world.ground[i] === 'water') continue;
      expect(world.area[i]).not.toBeNull();
    }
  });

  it('宝箱は 3 つ、それぞれエリアごとのレシピを持つ', () => {
    expect(world.chests.length).toBe(3);
    for (const chest of world.chests) {
      expect(chest.recipe).toBeTruthy();
    }
  });

  it('商船は 4x3 の Decor 1 つで、通れない', () => {
    const ships = world.decor.filter((d) => d.kind === 'ship');
    expect(ships.length).toBe(1);
    expect(ships[0]).toMatchObject({ w: 4, h: 3, solid: true });
  });
});

describe('設備', () => {
  it('遺跡は遺跡エリア、家の跡地は開けた土地、船着き場は浜にある', () => {
    const byKind = new Map(world.stations.map((s) => [s.kind, s]));
    expect(byKind.get('ruins')?.area).toBe('ruins');
    expect(byKind.get('housePlot')?.area).toBe('plaza');
    expect(byKind.get('dock')?.area).toBe('beach');
  });

  it('家の跡地は非ソリッド（上に立てる）で、それ以外の設備はソリッド', () => {
    const save = newSave(world, 0);
    for (const s of world.stations) {
      const solid = isSolidTile(world, save, s.x, s.y, 0);
      if (s.kind === 'housePlot') expect(solid).toBe(false);
      else expect(solid).toBe(true);
    }
  });
});

describe('最初から置く家具・花・砂浜', () => {
  const at = (x: number, y: number) => world.ground[worldIndex(x, y, world.width)];

  it('作業台は開けた土地の家具、古い柱は柱の数だけ、たき火と遺跡のアーチも 1 つずつ', () => {
    const count = (id: string) => world.initialFurniture.filter((f) => f.furniture === id).length;
    const bench = world.initialFurniture.find((f) => f.furniture === 'woodWorkbench');
    expect(bench).toBeTruthy();
    if (bench) expect(world.area[worldIndex(bench.x, bench.y, world.width)]).toBe('plaza');
    expect(count('woodWorkbench')).toBe(1);
    expect(count('oldPillar')).toBeGreaterThan(0);
    expect(world.initialFurniture).toContainEqual({ x: 15, y: 17, furniture: 'campfire' });
    expect(world.initialFurniture).toContainEqual({ x: 7, y: 14, furniture: 'ruinArch' });
    expect(world.decor.some((d) => (d.kind as string) === 'pillar')).toBe(false);
    expect(world.stations.some((s) => (s.kind as string) === 'workbench')).toBe(false);
  });

  it('新規セーブには最初から置く家具がすべて入っている（置けないマスは無い）', () => {
    const save = newSave(world, 0);
    for (const f of world.initialFurniture) expect(save.placements[`${f.x},${f.y}`]).toBe(f.furniture);
  });

  it('花は草の上にあり、砂浜には無い。10 本以上ある', () => {
    const flowers = world.nodes.filter((n) => n.kind === 'flower');
    expect(flowers.length).toBeGreaterThanOrEqual(10);
    for (const f of flowers) {
      expect(at(f.x, f.y)).toBe('grass');
      expect(f.area).not.toBe('beach');
    }
  });

  it('砂の上に木は無い', () => {
    const trees = world.nodes.filter((n) => n.kind === 'tree' || n.kind === 'bigTree');
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) expect(at(t.x, t.y)).not.toBe('sand');
  });

  it('最初から入れるエリアに、斧なしで切れる木がある', () => {
    const early = world.nodes.filter((n) => n.kind === 'tree' && ['woods', 'plaza'].includes(n.area));
    expect(early.length).toBeGreaterThanOrEqual(5);
  });
});

describe('到達可能性（BFS）', () => {
  const bfsFrom = (start: { x: number; y: number }, blocked: (x: number, y: number) => boolean) => {
    const visited = new Array<boolean>(world.width * world.height).fill(false);
    const startIdx = worldIndex(start.x, start.y, world.width);
    visited[startIdx] = true;
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const idx = worldIndex(nx, ny, world.width);
        if (visited[idx] || blocked(nx, ny)) continue;
        visited[idx] = true;
        stack.push({ x: nx, y: ny });
      }
    }
    return visited;
  };

  it('境界が立っている間は、始まりの4エリアだけに届き、封じられた3エリアには届かない', () => {
    const save = newSave(world, 0); // 境界ノードは壊れていない＝壁
    const visited = bfsFrom(world.start, (x, y) => isSolidTile(world, save, x, y, 0));

    const reachedAreas = new Set<AreaId>();
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!visited[worldIndex(x, y, world.width)]) continue;
        const a = world.area[worldIndex(x, y, world.width)];
        if (a) reachedAreas.add(a);
      }
    }
    expect([...reachedAreas].sort()).toEqual(['beach', 'plaza', 'ruins', 'woods'].sort());
  });

  it('境界を壊すと、地図上のすべての歩けるマスに届く', () => {
    const save = newSave(world, 0);
    for (const n of world.nodes) {
      if (n.kind === 'borderTree' || n.kind === 'borderRock') {
        save.nodes[n.id] = { hp: 0, destroyedAt: 0 };
      }
    }
    const visited = bfsFrom(world.start, (x, y) => isSolidTile(world, save, x, y, 0));

    const unreached: string[] = [];
    let totalWalkable = 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (isSolidTile(world, save, x, y, 0)) continue;
        totalWalkable++;
        if (!visited[worldIndex(x, y, world.width)]) unreached.push(`${x},${y}`);
      }
    }
    // 生成器が森に囲まれた孤立マスを森で埋めるので、歩けるマスはすべてたどり着ける。
    expect(unreached).toEqual([]);
  });
});
