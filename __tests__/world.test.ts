import { describe, expect, it } from 'vitest';

import { AREA_ORDER } from '../src/game/data';
import { buildWorld } from '../src/game/world';
import type { AreaId } from '../src/game/types';

const world = buildWorld();

describe('buildWorld', () => {
  it('マップは 40x30', () => {
    expect(world.width).toBe(40);
    expect(world.height).toBe(30);
  });

  it('4 エリアすべてが空でない', () => {
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
      if (area === 'beach') continue;
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

  it('浜には 2x2 と 3x3 の区画がある', () => {
    const beachPlots = world.plots.filter((p) => p.area === 'beach');
    expect(beachPlots.length).toBe(2);
    const sizes = beachPlots.map((p) => p.tiles.length).sort((a, b) => a - b);
    expect(sizes).toEqual([4, 9]);
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

  it('宝箱はエリアごとのレシピを持つ', () => {
    expect(world.chests.length).toBeGreaterThan(0);
    for (const chest of world.chests) {
      expect(chest.recipe).toBeTruthy();
    }
  });
});

describe('設備', () => {
  it('はじまりの浜に遺跡と作業台が 1 つずつある', () => {
    const kinds = world.stations.filter((s) => s.area === 'beach').map((s) => s.kind).sort();
    expect(kinds).toEqual(['ruins', 'workbench']);
  });
});
