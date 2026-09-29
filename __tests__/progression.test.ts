import { describe, expect, it } from 'vitest';

import { STAMINA_REGEN_MS, FURNITURE } from '../src/game/data';
import { buySkill, craft, hitNode, place } from '../src/game/actions';
import { canHit, isAreaOpen, islandLevel, nodeAlive } from '../src/game/rules';
import { applyRespawns } from '../src/game/time';
import { newSave } from '../src/game/save';
import { freeTiles, world } from './helpers';
import type { ItemId, MapNode, NodeKind, Result, SaveState } from '../src/game/types';

/**
 * 「無限に時間をかけられるプレイヤー」を actions API だけで動かし、
 * 4 エリアの開放と島レベル 3 到達に実際どれだけの時間・スタミナがかかるかを測る。
 * ワープ・時間送りはあり（バランス調整用の計測なので移動や当たり判定は見ない）。
 */
describe('進行シミュレーション: 4 エリア開放 + 島レベル3', () => {
  it('actions だけで到達できる。かかった時間とスタミナを記録する', () => {
    const save: SaveState = newSave(world, 0);
    let now = 0;

    const advance = (ms: number) => {
      now += ms;
      applyRespawns(world, save, now);
    };

    // スタミナが足りない間は 1 回復ぶんずつ時計を進めて再試行する。
    const act = (fn: (n: number) => Result): Result => {
      for (;;) {
        const r = fn(now);
        if (r.ok) return r;
        if (r.reason === 'noStamina') {
          advance(STAMINA_REGEN_MS);
          continue;
        }
        throw new Error(`予期しない失敗: ${r.reason}`);
      }
    };

    const findAliveNode = (kinds: NodeKind[]): MapNode | undefined =>
      world.nodes.find((n) => kinds.includes(n.kind) && nodeAlive(save, n, now) && canHit(save, n));

    const hitOnce = (node: MapNode): void => {
      act((n) => hitNode(world, save, node, n));
    };

    const destroyNode = (node: MapNode): void => {
      while (!save.nodes[node.id] || save.nodes[node.id]?.destroyedAt == null) {
        hitOnce(node);
      }
    };

    /** 特定の種類の資源を 1 個破壊する（無ければ復活まで時計を進めて待つ）。 */
    const destroyOneOf = (kinds: NodeKind[]): void => {
      for (;;) {
        const node = findAliveNode(kinds);
        if (node) {
          destroyNode(node);
          return;
        }
        advance(10 * 60 * 1000); // 何も無ければ復活まで待つ
      }
    };

    /** アイテムが目標数に届くまで、対応する資源を壊し続ける。 */
    const ensureItem = (item: ItemId, amount: number, kinds: NodeKind[]): void => {
      // 岩・銅鉱石の入手元は、今後追加する洞窟まで無い（フィールドに岩は置かない）。それまではテストで直接足す。
      if (kinds.length === 0 || item === 'stone' || item === 'copper') {
        save.inventory[item] = Math.max(save.inventory[item] ?? 0, amount);
        return;
      }
      while ((save.inventory[item] ?? 0) < amount) {
        destroyOneOf(kinds);
      }
    };

    /** 経験値が目標に届くまで、木を壊し続ける。 */
    const ensureXp = (amount: number): void => {
      while (save.xp < amount) {
        destroyOneOf(['tree']);
      }
    };

    const buy = (skill: 'axePower' | 'pickHard', cost: number) => {
      ensureXp(cost);
      const r = buySkill(save, skill);
      if (!r.ok) throw new Error(`スキル購入に失敗: ${r.reason}`);
    };

    // --- 1. 森を開く（axePower Lv1 が必要） ---
    buy('axePower', 10);
    const forestBorders = world.nodes.filter((n) => n.area === 'forest' && n.kind === 'borderTree');
    expect(forestBorders.length).toBe(2);
    for (const b of forestBorders) destroyNode(b);
    expect(isAreaOpen(world, save, 'forest')).toBe(true);

    // --- 2. 岩場を開く（pickHard Lv1 が必要） ---
    buy('pickHard', 10);
    const rockBorders = world.nodes.filter((n) => n.area === 'rocks' && n.kind === 'borderRock');
    expect(rockBorders.length).toBe(2);
    for (const b of rockBorders) destroyNode(b);
    expect(isAreaOpen(world, save, 'rocks')).toBe(true);

    // --- 3. 木製シリーズを一式クラフトして置き、島レベル 2 を目指す ---
    const woodItems = FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 1);
    for (const def of woodItems) {
      for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) {
        const kinds: NodeKind[] = item === 'wood' ? ['tree'] : item === 'stone' ? ['rock'] : [];
        if (kinds.length > 0) ensureItem(item, amount, kinds);
      }
      act((n) => craft(save, def.id, n));
      const [slot] = freeTiles(save, 1);
      if (!slot) throw new Error('空きマスが無い');
      const r = place(world, save, slot.x, slot.y, def.id);
      if (!r.ok) throw new Error(`配置に失敗: ${r.reason}`);
    }
    expect(islandLevel(save)).toBeGreaterThanOrEqual(2);

    // --- 4. 丘を開く（axePower Lv2、島レベル2 が必要） ---
    buy('axePower', 25);
    const hillBorders = world.nodes.filter((n) => n.area === 'hill' && n.kind === 'borderTree');
    expect(hillBorders.length).toBe(2);
    for (const b of hillBorders) destroyNode(b);
    expect(isAreaOpen(world, save, 'hill')).toBe(true);

    // --- 5. 石造りシリーズを一式クラフトして置き、島レベル 3 を目指す ---
    const stoneItems = FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 2);
    for (const def of stoneItems) {
      if (islandLevel(save) >= 3) break;
      for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) {
        const kinds: NodeKind[] =
          item === 'wood' ? ['tree'] : item === 'stone' ? ['rock', 'hardRock'] : item === 'copper' ? ['hardRock'] : [];
        if (kinds.length > 0) ensureItem(item, amount, kinds);
      }
      act((n) => craft(save, def.id, n));
      const [slot] = freeTiles(save, 1);
      if (!slot) throw new Error('空きマスが無い');
      const r = place(world, save, slot.x, slot.y, def.id);
      if (!r.ok) throw new Error(`配置に失敗: ${r.reason}`);
    }

    // --- 結果 ---
    expect(isAreaOpen(world, save, 'forest')).toBe(true);
    expect(isAreaOpen(world, save, 'rocks')).toBe(true);
    expect(isAreaOpen(world, save, 'hill')).toBe(true);
    expect(islandLevel(save)).toBeGreaterThanOrEqual(3);

    const hours = now / (60 * 60 * 1000);
    const totalStamina = save.totalXp; // XP は消費スタミナと 1:1 なので合計スタミナ消費に等しい
    // eslint-disable-next-line no-console
    console.log(
      `[進行測定] 4 エリア開放 + 島レベル${islandLevel(save)} 到達: ゲーム内経過 ${hours.toFixed(1)} 時間 / 合計スタミナ消費 ${totalStamina}`,
    );
    expect(hours).toBeGreaterThan(0);
    expect(totalStamina).toBeGreaterThan(0);
  });
});
