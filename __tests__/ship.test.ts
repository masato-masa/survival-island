// 商船の修理（SI-14）。素材を納めて段階的に直し、毎日 1 回お届けが来る。
import { describe, expect, it } from 'vitest';

import { hitNode } from '../src/game/actions';
import { SHIP_STAGES } from '../src/game/data';
import { dailyDay } from '../src/game/daily';
import { migrate } from '../src/game/save';
import { claimShipGift, nextShipStage, repairShip, shipGift, shipGiftReady } from '../src/game/ship';
import { findTarget } from '../src/game/target';
import type { ItemId, MapNode, NodeKind } from '../src/game/types';
import { freshSave, world } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 100 * DAY;

function give(save: ReturnType<typeof freshSave>, cost: Partial<Record<ItemId, number>>) {
  for (const [k, n] of Object.entries(cost) as [ItemId, number][]) save.inventory[k] = (save.inventory[k] ?? 0) + n;
}

describe('商船の修理', () => {
  it('壊れたまま始まり、古いセーブにも欄が入る', () => {
    const save = freshSave();
    expect(save.ship).toEqual({ stage: 0, giftDay: -1 });
    expect(migrate({}).ship).toEqual({ stage: 0, giftDay: -1 });
    expect(migrate({ ship: { stage: 2, giftDay: 7 } }).ship).toEqual({ stage: 2, giftDay: 7 });
  });

  it('桟橋から商船に触れられる（係留柱とは別の設備）', () => {
    const ships = world.stations.filter((s) => s.kind === 'ship');
    expect(ships.length).toBeGreaterThanOrEqual(2);
    const save = freshSave();
    const s = ships[0]!;
    // 桟橋の上（商船の左隣）に立つ
    const t = findTarget(world, save, s.x - 0.3, s.y + 1, 'right', 0);
    expect(t?.kind).toBe('station');
    if (t?.kind === 'station') expect(t.station.kind).toBe('ship');
  });

  it('素材が足りなければ直せず、島レベルが足りなくても直せない。素材は納めた分だけ減る', () => {
    const save = freshSave();
    save.maxPoints = 100;
    expect(repairShip(save)).toMatchObject({ ok: false, reason: 'notEnoughItems' });
    give(save, SHIP_STAGES[0]!.cost);
    save.maxPoints = 0;
    expect(repairShip(save)).toMatchObject({ ok: false, reason: 'levelCap' });
    save.maxPoints = 100;
    const r = repairShip(save);
    expect(r).toMatchObject({ ok: true });
    expect(save.ship.stage).toBe(1);
    expect(Object.values(save.inventory).every((n) => n === 0)).toBe(true);
  });

  it('全部直すと次は無く、お届けは直した段階の分が足される', () => {
    const save = freshSave();
    save.maxPoints = 100;
    for (const st of SHIP_STAGES) {
      expect(shipGift(save)).toEqual(
        SHIP_STAGES.slice(0, save.ship.stage).reduce<Partial<Record<ItemId, number>>>((a, s) => {
          for (const [k, n] of Object.entries(s.gift) as [ItemId, number][]) a[k] = (a[k] ?? 0) + n;
          return a;
        }, {}),
      );
      give(save, st.cost);
      expect(repairShip(save).ok).toBe(true);
    }
    expect(save.ship.stage).toBe(SHIP_STAGES.length);
    expect(nextShipStage(save)).toBeNull();
    expect(repairShip(save)).toMatchObject({ ok: false, reason: 'maxLevel' });
  });

  it('お届けは直していないと来ず、1 日 1 回だけ。日本時間 0 時で新しくなる', () => {
    const save = freshSave(T0);
    save.maxPoints = 100;
    expect(claimShipGift(save, T0)).toMatchObject({ ok: false });
    give(save, SHIP_STAGES[0]!.cost);
    repairShip(save);
    expect(shipGiftReady(save, T0)).toBe(true);
    const before = save.inventory.fish ?? 0;
    expect(claimShipGift(save, T0)).toMatchObject({ ok: true });
    expect((save.inventory.fish ?? 0) - before).toBe(2);
    expect(claimShipGift(save, T0 + 60_000)).toMatchObject({ ok: false });
    expect(dailyDay(T0 + DAY)).toBe(dailyDay(T0) + 1);
    expect(claimShipGift(save, T0 + DAY)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 収支。素材 1 個あたりのスタミナを実際に叩いて測り、段階ごとの合計と、お届けの回収日数を出す。
// ---------------------------------------------------------------------------
function rate(kinds: NodeKind[], items: ItemId[], goal: number, power: boolean): number {
  const save = freshSave();
  save.maxPoints = 100;
  save.skills.pickHard = 1;
  save.stamina.value = 9999;
  if (power) save.buffs = [{ id: 'power', until: 1e12 }];
  const nodes = kinds.flatMap((k) => world.nodes.filter((n) => n.kind === k)) as MapNode[];
  const got = () => items.reduce((a, i) => a + (save.inventory[i] ?? 0), 0);
  let hits = 0;
  for (const n of nodes) {
    while (got() < goal) {
      const r = hitNode(world, save, n, 0);
      if (!r.ok) break;
      hits++;
      if (save.nodes[n.id]?.destroyedAt != null) break;
    }
    if (got() >= goal) break;
  }
  expect(got(), `${items.join('/')} を ${goal} 個集められる`).toBeGreaterThanOrEqual(goal);
  return hits / got();
}

describe('商船の収支', () => {
  const cost = (power: boolean): Partial<Record<ItemId, number>> => ({
    wood: rate(['tree'], ['wood'], 30, power),
    stone: rate(['rock', 'hardRock', 'copperVein'], ['stone'], 12, power),
    copper: rate(['copperVein'], ['copper'], 3, power),
    petal: rate(['flower'], ['petal'], 12, power),
    fish: 1 / 0.65,
    bigFish: 5,
    turnip: 2,
    sunflower: 2,
    tomato: 2,
  });
  const stageStamina = (c: Partial<Record<ItemId, number>>) =>
    SHIP_STAGES.map((st) => (Object.entries(st.cost) as [ItemId, number][]).reduce((a, [k, n]) => a + n * (c[k] ?? 0), 0));
  const giftValue = (c: Partial<Record<ItemId, number>>, g: Partial<Record<ItemId, number>>) => {
    const v: Partial<Record<ItemId, number>> = { ...c, sapling: 3, wood: c.wood };
    return (Object.entries(g) as [ItemId, number][]).reduce((a, [k, n]) => a + n * (v[k] ?? 0), 0);
  };

  it('全部直すのに数時間ぶんのスタミナがかかり、力もちの準備で木材・石が安くなり、お届けは回収に十分な日数がかかる', () => {
    const plain = cost(false);
    const strong = cost(true);
    const a = stageStamina(plain);
    const b = stageStamina(strong);
    const totalA = a.reduce((x, y) => x + y, 0);
    const totalB = b.reduce((x, y) => x + y, 0);
    const gift = giftValue(plain, shipGift({ ...freshSave(), ship: { stage: SHIP_STAGES.length, giftDay: -1 } } as never));
    // eslint-disable-next-line no-console
    console.log(
      `[商船測定] 1 個あたり(力もちなし→あり): 木材 ${plain.wood!.toFixed(2)}→${strong.wood!.toFixed(2)} 石 ${plain.stone!.toFixed(2)}→${strong.stone!.toFixed(2)} 銅 ${plain.copper!.toFixed(2)}→${strong.copper!.toFixed(2)} 花びら ${plain.petal!.toFixed(2)}→${strong.petal!.toFixed(2)}\n` +
        SHIP_STAGES.map((s, i) => `${i + 1}. ${s.name}: ${a[i]!.toFixed(0)} → ${b[i]!.toFixed(0)} スタミナ`).join('\n') +
        `\n合計 ${totalA.toFixed(0)} → ${totalB.toFixed(0)}（満タン 40 の ${(totalA / 40).toFixed(1)} 本 → ${(totalB / 40).toFixed(1)} 本）／お届け(全部直したあと) 1 日 ${gift.toFixed(1)} 相当 → 回収 ${(totalA / gift).toFixed(0)} 日`,
    );
    expect(totalA).toBeGreaterThan(200);
    expect(totalA).toBeLessThan(450);
    expect(totalB / totalA).toBeLessThan(0.85);
    expect(plain.wood! / strong.wood!).toBeGreaterThan(1.3);
    for (const x of a) expect(x).toBeGreaterThan(20); // 1 段階が軽すぎない
    expect(gift).toBeLessThan(20);
    expect(totalA / gift).toBeGreaterThan(15);
  });

  it('1 段階の素材は、家具やおねがいの素材より重い（取り合いになる）', () => {
    // いちばん高い家具（ランドマーク）の素材の個数と比べる
    const furnitureMax = 20; // 丸太の見張り台 木材 20
    expect(SHIP_STAGES[1]!.cost.wood!).toBeGreaterThan(furnitureMax);
  });
});
