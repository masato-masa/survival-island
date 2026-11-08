// 島のおねがい（SI-11）。効き目が全部効いている間に集めた分だけが進む。
import { describe, expect, it } from 'vitest';

import { cook, hitNode } from '../src/game/actions';
import { REQUESTS } from '../src/game/data';
import { currentRequest } from '../src/game/rules';
import { freshSave, world } from './helpers';

function chopAll(save: ReturnType<typeof freshSave>, now: number, times: number) {
  const trees = world.nodes.filter((n) => n.kind === 'tree');
  let events: unknown[] = [];
  for (let i = 0; i < times; i++) {
    const t = trees[i % trees.length]!;
    for (let k = 0; k < 8; k++) {
      const r = hitNode(world, save, t, now);
      if (r.ok) events = events.concat(r.events);
    }
  }
  return events;
}

describe('島のおねがい', () => {
  it('効き目なしで集めても進まない', () => {
    const save = freshSave();
    save.stamina.value = 999;
    chopAll(save, 0, 3);
    expect(save.request.progress).toBe(0);
  });

  it('力もちの間に木材を集めると進み、目標でごほうびが出て次へ進む', () => {
    const save = freshSave();
    save.stamina.value = 999;
    save.inventory.turnip = 2;
    cook(save, 'turnipSoup', 0);
    const events = chopAll(save, 1000, 8);
    expect(save.request.done).toContain('wood16');
    expect(save.inventory.sapling ?? 0).toBeGreaterThanOrEqual(2);
    expect(events).toContainEqual({ type: 'requestDone', id: 'wood16' });
    expect(currentRequest(save)!.def.id).toBe('fish5');
  });

  it('効き目が切れたあとは進まない', () => {
    const save = freshSave();
    save.stamina.value = 999;
    save.inventory.turnip = 2;
    cook(save, 'turnipSoup', 0);
    chopAll(save, 11 * 60 * 1000, 3);
    expect(save.request.progress).toBe(0);
  });

  it('島レベルが足りないおねがいは受けられない（数えない）', () => {
    const save = freshSave();
    save.request.done = ['wood16', 'fish5'];
    expect(currentRequest(save)).toMatchObject({ locked: true });
    expect(REQUESTS.map((r) => r.id)).toEqual(['wood16', 'fish5', 'crop8', 'stone12', 'wood30']);
  });
});

// ---------------------------------------------------------------------------
// 島のおねがいの収支（SI-12）。おねがい 1 件は「効き目をつけて、その間に集める」だけで、
// 集める作業そのものは普段もやること。なので、ごほうびは作業のスタミナの 3〜9 割に収める
// （それ以上だと、おねがい以外の遊びがすべて損になる）。
// ---------------------------------------------------------------------------
import type { ItemId, MapNode, NodeKind } from '../src/game/types';

/** 資源を叩いて、items が goal 個に届くまでのスタミナ（叩いた回数）。buffed なら力もちを付ける。 */
function staminaToGather(kinds: NodeKind[], items: ItemId[], goal: number, buffed: boolean): number {
  const save = freshSave();
  save.maxPoints = 60;
  save.skills.pickHard = 1;
  save.stamina.value = 9999;
  if (buffed) save.buffs = [{ id: 'power', until: 1e12 }];
  const nodes = kinds.flatMap((k) => world.nodes.filter((n) => n.kind === k)) as MapNode[];
  const got = () => items.reduce((a, i) => a + (save.inventory[i] ?? 0), 0);
  const start = save.xp + save.totalXp;
  let hits = 0;
  for (const n of nodes) {
    while (got() < goal) {
      const r = hitNode(world, save, n, 0);
      if (!r.ok) break;
      hits++;
      const st = save.nodes[n.id];
      if (st?.destroyedAt != null) break;
    }
    if (got() >= goal) break;
  }
  void start;
  return hits;
}

describe('島のおねがいの収支', () => {
  it('ごほうびの価値が、集める作業のスタミナの 3〜9 割に収まる', () => {
    // 1 つあたりのスタミナ換算: 作物 2（植える 1 + 収穫 1）、大物 5、さかな 1/0.65
    const woodCost = staminaToGather(['tree'], ['wood'], 30, false) / 30; // 力もちなしの木材 1 個
    const SAPLING = 3; // 植えて育てると木 1 本ぶん（木材 3 個）がまた採れる。植える手間 1 を引く
    const value = (r: Partial<Record<ItemId, number>>) =>
      (r.sapling ?? 0) * SAPLING + (r.bigFish ?? 0) * 5 + (r.sunflower ?? 0) * 2 + (r.turnip ?? 0) * 2 + (r.wood ?? 0) * woodCost;
    const rows: string[] = [];
    let totalReward = 0;
    const ratios: [string, number][] = [];
    for (const q of REQUESTS) {
      let work: number;
      if (q.id === 'fish5') work = q.goal / 0.65; // 慣れた人の釣れる割合
      else if (q.id === 'crop8') work = (q.goal / 2) * 2; // 豊作で 1 回 2 個。4 回の植える + 収穫
      else if (q.items.includes('stone')) work = staminaToGather(['rock', 'hardRock', 'copperVein'], q.items, q.goal, true);
      else work = staminaToGather(['tree'], q.items, q.goal, true);
      const v = value(q.reward);
      totalReward += v;
      rows.push(`${q.id}: 作業 ${work.toFixed(1)} スタミナ / ごほうび ${v.toFixed(1)} 相当 (${Math.round((v / work) * 100)}%)`);
      ratios.push([q.id, v / work]);
    }
    // eslint-disable-next-line no-console
    console.log(`[おねがい測定] 木材 1 個 = ${woodCost.toFixed(2)} スタミナ（力もちなし）\n${rows.join('\n')}\n5 件の合計ごほうび ${totalReward.toFixed(1)} 相当`);
    for (const [id, r] of ratios) {
      expect(r, id).toBeGreaterThanOrEqual(0.3);
      expect(r, id).toBeLessThanOrEqual(0.9);
    }
  });
});
