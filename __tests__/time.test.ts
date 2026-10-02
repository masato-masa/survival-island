import { describe, expect, it } from 'vitest';

import { STAMINA_BASE, STAMINA_REGEN_MS } from '../src/game/data';
import { applyRespawns, cropProgress, currentStamina, isReady, normalizeStamina } from '../src/game/time';
import { buildWorld } from '../src/game/world';
import { freshSave, world } from './helpers';

describe('currentStamina', () => {
  it('時間が経っていなければそのまま', () => {
    const save = freshSave(0);
    save.stamina.value = 5;
    const info = currentStamina(save, 0);
    expect(info.value).toBe(5);
    expect(info.max).toBe(STAMINA_BASE);
  });

  it('3 分ごとに 1 回復する', () => {
    const save = freshSave(0);
    save.stamina.value = 5;
    save.stamina.updatedAt = 0;
    const info = currentStamina(save, STAMINA_REGEN_MS * 2);
    expect(info.value).toBe(7);
  });

  it('アプリを閉じていた間（オフライン）も回復する', () => {
    const save = freshSave(0);
    save.stamina.value = 0;
    save.stamina.updatedAt = 0;
    const offlineMs = STAMINA_REGEN_MS * 100; // 十分に長い
    const info = currentStamina(save, offlineMs);
    expect(info.value).toBe(STAMINA_BASE); // 上限でクランプ
  });

  it('上限に達しているときの nextInMs は 0', () => {
    const save = freshSave(0);
    save.stamina.value = STAMINA_BASE;
    save.stamina.updatedAt = 0;
    const info = currentStamina(save, 10_000);
    expect(info.nextInMs).toBe(0);
  });

  it('回復途中の nextInMs は残り時間', () => {
    const save = freshSave(0);
    save.stamina.value = 0;
    save.stamina.updatedAt = 0;
    const info = currentStamina(save, 1000);
    expect(info.nextInMs).toBe(STAMINA_REGEN_MS - 1000);
  });
});

describe('normalizeStamina', () => {
  it('端数（あまり）を保持して updatedAt を進める', () => {
    const save = freshSave(0);
    save.stamina.value = 0;
    save.stamina.updatedAt = 0;
    const now = STAMINA_REGEN_MS * 2 + 1000; // 2 回復 + 端数 1 秒
    normalizeStamina(save, now);
    expect(save.stamina.value).toBe(2);
    expect(save.stamina.updatedAt).toBe(STAMINA_REGEN_MS * 2);
    // 端数が保持されているので、続きの回復も正しく進む
    const info = currentStamina(save, now);
    expect(info.nextInMs).toBe(STAMINA_REGEN_MS - 1000);
  });

  it('上限に達したら updatedAt は now になる', () => {
    const save = freshSave(0);
    save.stamina.value = 0;
    save.stamina.updatedAt = 0;
    const now = STAMINA_REGEN_MS * 1000;
    normalizeStamina(save, now);
    expect(save.stamina.value).toBe(STAMINA_BASE);
    expect(save.stamina.updatedAt).toBe(now);
  });

  it('時間が経っていなければ何もしない', () => {
    const save = freshSave(0);
    save.stamina.value = 3;
    save.stamina.updatedAt = 1000;
    normalizeStamina(save, 1500);
    expect(save.stamina.value).toBe(3);
    expect(save.stamina.updatedAt).toBe(1000);
  });
});

describe('cropProgress / isReady', () => {
  it('植えた直後は 0、成長しきったら 1', () => {
    const tile = { crop: 'turnip' as const, plantedAt: 0 };
    expect(cropProgress(tile, 0)).toBe(0);
    expect(cropProgress(tile, 999_999_999)).toBe(1);
  });

  it('growMs 経過で収穫可能になる', () => {
    const tile = { crop: 'turnip' as const, plantedAt: 1000 };
    expect(isReady(tile, 1000)).toBe(false);
    // カブの growMs は 2 分
    expect(isReady(tile, 1000 + 2 * 60 * 1000)).toBe(true);
  });
});

describe('applyRespawns', () => {
  // 木は復活しなくなった（苗木を植えて増やす）。復活するのは岩だけ（フィールドには無いので小さなマップで見る）。
  const rockWorld = buildWorld(['~~~~', '~@R~', '~~~~']);

  it('復活時刻を過ぎたら nodes から消える', () => {
    const save = freshSave(0);
    const node = rockWorld.nodes.find((n) => n.kind === 'rock');
    if (!node) throw new Error('rock not found');
    save.nodes[node.id] = { hp: 0, destroyedAt: 0 };
    applyRespawns(rockWorld, save, 10 * 60 * 1000 + 1, undefined);
    expect(save.nodes[node.id]).toBeUndefined();
  });

  it('プレイヤーが立っているマスは復活させない', () => {
    const save = freshSave(0);
    const node = rockWorld.nodes.find((n) => n.kind === 'rock');
    if (!node) throw new Error('rock not found');
    save.nodes[node.id] = { hp: 0, destroyedAt: 0 };
    applyRespawns(rockWorld, save, 10 * 60 * 1000 + 1, { x: node.x, y: node.y });
    expect(save.nodes[node.id]).toBeDefined();
  });

  it('木は復活しない', () => {
    const save = freshSave(0);
    const node = world.nodes.find((n) => n.kind === 'tree');
    if (!node) throw new Error('tree not found');
    save.nodes[node.id] = { hp: 0, destroyedAt: 0 };
    applyRespawns(world, save, 999_999_999_999, undefined);
    expect(save.nodes[node.id]).toBeDefined();
  });

  it('境界は復活しない', () => {
    const save = freshSave(0);
    const border = world.nodes.find((n) => n.kind === 'borderTree' || n.kind === 'borderRock');
    if (!border) throw new Error('border not found');
    save.nodes[border.id] = { hp: 0, destroyedAt: 0 };
    applyRespawns(world, save, 999_999_999_999, undefined);
    expect(save.nodes[border.id]).toBeDefined();
  });
});
