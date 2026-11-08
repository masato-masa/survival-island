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

// ---------------------------------------------------------------------------
// 毎日のおねがい（SI-13）
// ---------------------------------------------------------------------------
import { DAILY_BIG, DAILY_SMALL } from '../src/game/data';
import { dailyDay, dailyOpen, dailyRequests, dailyView, emptyDaily } from '../src/game/daily';
import { migrate } from '../src/game/save';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 100 * DAY; // 日本時間の 100 日目の 9 時

function introDone() {
  const save = freshSave(T0);
  save.request.done = REQUESTS.map((r) => r.id);
  save.request.daily = emptyDaily();
  save.maxPoints = 100;
  save.stamina.value = 9999;
  save.stamina.updatedAt = T0;
  return save;
}

describe('毎日のおねがい', () => {
  it('固定の 5 件を終えるまでは出ない・数えない', () => {
    const save = freshSave(T0);
    save.stamina.value = 999;
    expect(dailyOpen(save)).toBe(false);
    save.buffs = [{ id: 'power', until: 1e15 }];
    chopAll(save, T0, 3);
    expect(save.request.daily.progress).toEqual([0, 0, 0]);
  });

  it('同じ日は同じ 3 件（小 2 + 大 1）。日が変われば変わる', () => {
    const a = dailyRequests(100);
    expect(dailyRequests(100)).toEqual(a);
    expect(a.map((q) => q.buffs.length)).toEqual([1, 1, 2]);
    expect(new Set(a.slice(0, 2).map((q) => q.name)).size).toBe(2);
    const sigs = new Set<string>();
    for (let d = 0; d < 60; d++) sigs.add(dailyRequests(d).map((q) => q.name).join('|'));
    expect(sigs.size).toBeGreaterThan(20);
  });

  it('日付は日本時間の 0 時で切り替わる', () => {
    expect(dailyDay(T0 + 14 * 60 * 60 * 1000 - 1)).toBe(dailyDay(T0));
    expect(dailyDay(T0 + 15 * 60 * 60 * 1000)).toBe(dailyDay(T0) + 1);
  });

  it('効き目の合う全部のおねがいに同じ作業が数えられ、届いたらごほうびが出る。日が変われば戻る', () => {
    const save = introDone();
    const list = dailyRequests(dailyDay(T0));
    // 今日の 3 件を全部満たす効き目を付ける
    save.buffs = [
      { id: 'power', until: 1e15 },
      { id: 'swift', until: 1e15 },
      { id: 'bounty', until: 1e15 },
    ];
    save.inventory = {};
    const items = list[0]!.items[0]!;
    save.inventory[items] = 0;
    // 集める代わりにテストでは addItem 相当を hitNode / harvest で行う代わりに、進みを直接見る: 木を叩く
    chopAll(save, T0, 12);
    const view = dailyView(save, T0);
    const woodOnes = view.filter((v) => v.def.items.includes('wood'));
    for (const w of woodOnes) expect(w.progress + (w.claimed ? w.def.goal : 0)).toBeGreaterThan(0);
    // 翌日は進みが戻る
    const next = dailyView(save, T0 + DAY);
    expect(next.every((v) => v.progress === 0 && !v.claimed)).toBe(true);
  });

  it('目標に届くと 1 日 1 回だけごほうびが出て、かなえた数が増える', () => {
    const save = introDone();
    // 木材のおねがいが今日に出る日を探す
    let day = 0;
    for (; day < 400; day++) if (dailyRequests(day).some((q) => q.items.length === 1 && q.items[0] === 'wood' && q.buffs.length === 1)) break;
    const t = day * DAY - 9 * 60 * 60 * 1000 + 3600_000; // その日の 1 時
    expect(dailyDay(t)).toBe(day);
    save.buffs = [{ id: 'power', until: 1e15 }];
    save.stamina.updatedAt = t;
    const events = chopAll(save, t, 18);
    const slot = dailyRequests(day).findIndex((q) => q.items.length === 1 && q.items[0] === 'wood' && q.buffs.length === 1);
    expect(save.request.daily.claimed[slot]).toBe(true);
    expect(save.request.daily.total).toBe(1);
    expect(events.filter((e) => (e as { type: string }).type === 'requestDone').length).toBe(1);
    // もう一度木を叩いても、同じおねがいは二重にならない
    const before = save.request.daily.total;
    chopAll(save, t, 18);
    expect(save.request.daily.total).toBe(before);
  });

  it('古いセーブにも毎日のおねがいの欄が入る', () => {
    const save = migrate({ request: { done: ['wood16'], progress: 3 } });
    expect(save.request.daily).toEqual(emptyDaily());
    expect(save.request.progress).toBe(3);
  });
});

describe('毎日のおねがいの収支（全部の型）', () => {
  it('どの型もごほうびが作業のスタミナの 3〜9 割に収まる', () => {
    const woodCost = staminaToGather(['tree'], ['wood'], 30, false) / 30;
    const SAPLING = 3;
    const value = (r: Partial<Record<ItemId, number>>) =>
      (r.sapling ?? 0) * SAPLING + (r.bigFish ?? 0) * 5 + (r.sunflower ?? 0) * 2 + (r.turnip ?? 0) * 2 + (r.wood ?? 0) * woodCost;
    const rows: string[] = [];
    let smallTotal = 0;
    for (const t of [...DAILY_SMALL, ...DAILY_BIG]) {
      let work: number;
      if (t.items.includes('fish')) work = t.goal / 0.65;
      else if (t.items.includes('turnip')) work = (t.goal / 2) * 2;
      else if (t.items.includes('stone')) work = staminaToGather(['rock', 'hardRock', 'copperVein'], t.items, t.goal, true);
      else work = staminaToGather(['tree'], t.items, t.goal, true);
      const v = value(t.reward);
      rows.push(`${t.key}: 作業 ${work.toFixed(1)} / ごほうび ${v.toFixed(1)} (${Math.round((v / work) * 100)}%)`);
      expect(v / work, t.key).toBeGreaterThanOrEqual(0.3);
      expect(v / work, t.key).toBeLessThanOrEqual(0.9);
      smallTotal += t.buffs.length === 1 ? v : 0;
    }
    // eslint-disable-next-line no-console
    console.log(`[毎日のおねがい測定] 木材 1 個 = ${woodCost.toFixed(2)}\n${rows.join('\n')}`);
    void smallTotal;
  });
});
