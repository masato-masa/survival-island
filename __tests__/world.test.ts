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

  it('ランドマークの配置スペースは 2x2 が開けた土地に 1 つだけ', () => {
    const landmarks = world.slots.filter((s) => s.attr === 'landmark' && s.w === 2 && s.h === 2);
    expect(landmarks.length).toBe(1);
    expect(landmarks[0]?.area).toBe('plaza');
    expect(landmarks[0]?.h).toBe(2);
  });

  it('配置スペースがエリアごとに数えられる', () => {
    expect(world.slots.length).toBeGreaterThan(0);
    for (const slot of world.slots) {
      expect(AREA_ORDER).toContain(slot.area);
    }
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
  it('遺跡は遺跡エリア、作業台と家の跡地は開けた土地、船着き場は浜にある', () => {
    const byKind = new Map(world.stations.map((s) => [s.kind, s]));
    expect(byKind.get('ruins')?.area).toBe('ruins');
    expect(byKind.get('workbench')?.area).toBe('plaza');
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
