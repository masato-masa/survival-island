// 見張り台の建て増し（SI-15）。素材を納めて段階的に建て増し、眺めと毎日の贈り物が増える。
import { describe, expect, it } from 'vitest';

import { hitNode } from '../src/game/actions';
import { FURNITURE_FUNCTION, SHIP_STAGES, TOWER_STAGES } from '../src/game/data';
import { dailyDay } from '../src/game/daily';
import { migrate } from '../src/game/save';
import { claimTowerGift, compass, lookout, mealAdvice, nextTowerStage, towerGift, towerGiftOn, towerGiftReady, upgradeTower } from '../src/game/tower';
import { findTarget } from '../src/game/target';
import type { ItemId, MapNode, NodeKind } from '../src/game/types';
import { freeTiles, freshSave, world } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 100 * DAY;

function give(save: ReturnType<typeof freshSave>, cost: Partial<Record<ItemId, number>>) {
  for (const [k, n] of Object.entries(cost) as [ItemId, number][]) save.inventory[k] = (save.inventory[k] ?? 0) + n;
}

describe('見張り台の建て増し', () => {
  it('最初は建て増し 0 段階で、古いセーブにも欄が入る', () => {
    const save = freshSave();
    expect(save.tower).toEqual({ stage: 0, giftDay: -1 });
    expect(migrate({}).tower).toEqual({ stage: 0, giftDay: -1 });
    expect(migrate({ ship: { stage: 3, giftDay: 1 } }).tower).toEqual({ stage: 0, giftDay: -1 });
    expect(migrate({ tower: { stage: 2, giftDay: 7 } }).tower).toEqual({ stage: 2, giftDay: 7 });
  });

  it('置いた見張り台に触れると、機能のある家具として対象になる', () => {
    expect(FURNITURE_FUNCTION.woodTower).toBe('tower');
    const save = freshSave();
    const [t] = freeTiles(save, 1);
    save.placements[`${t!.x},${t!.y}`] = 'woodTower';
    const target = findTarget(world, save, t!.x + 0.5, t!.y + 0.5, 'down', 0);
    expect(target?.kind).toBe('furniture');
    if (target?.kind === 'furniture') expect(target.furnitureId).toBe('woodTower');
  });

  it('素材が足りなければ建て増せず、島レベルが足りなくても建て増せない。素材は納めた分だけ減る', () => {
    const save = freshSave();
    save.maxPoints = 100;
    expect(upgradeTower(save)).toMatchObject({ ok: false, reason: 'notEnoughItems' });
    give(save, TOWER_STAGES[0]!.cost);
    save.maxPoints = 0;
    expect(upgradeTower(save)).toMatchObject({ ok: false, reason: 'levelCap' });
    save.maxPoints = 100;
    expect(upgradeTower(save)).toMatchObject({ ok: true });
    expect(save.tower.stage).toBe(1);
    expect(Object.values(save.inventory).every((n) => n === 0)).toBe(true);
  });

  it('全部建て増すと次は無い', () => {
    const save = freshSave();
    save.maxPoints = 100;
    for (const st of TOWER_STAGES) {
      give(save, st.cost);
      expect(upgradeTower(save).ok).toBe(true);
    }
    expect(save.tower.stage).toBe(TOWER_STAGES.length);
    expect(nextTowerStage(save)).toBeNull();
    expect(upgradeTower(save)).toMatchObject({ ok: false, reason: 'maxLevel' });
  });

  it('贈り物は建て増さないと来ず、1 日 1 回だけ。中身は日付で決まり（同じ日は同じ）、日が変わると変わる', () => {
    const save = freshSave(T0);
    save.maxPoints = 100;
    expect(claimTowerGift(save, T0)).toMatchObject({ ok: false });
    give(save, TOWER_STAGES[0]!.cost);
    upgradeTower(save);
    expect(towerGiftReady(save, T0)).toBe(true);
    const day = dailyDay(T0);
    expect(towerGift(save, T0)).toEqual(towerGiftOn(1, day));
    expect(towerGiftOn(1, day)).not.toEqual(towerGiftOn(1, day + 1));
    expect(claimTowerGift(save, T0)).toMatchObject({ ok: true });
    const got = Object.entries(towerGiftOn(1, day))[0]!;
    expect(save.inventory[got[0] as ItemId]).toBe(got[1]);
    expect(claimTowerGift(save, T0 + 60_000)).toMatchObject({ ok: false });
    expect(claimTowerGift(save, T0 + DAY)).toMatchObject({ ok: true });
  });

  it('段階が上がるほど贈り物の枠が増える（総量が増え続ける）', () => {
    for (const day of [0, 1, 2, 3, 50]) {
      let prev = 0;
      for (let s = 1; s <= TOWER_STAGES.length; s++) {
        const total = Object.values(towerGiftOn(s, day)).reduce((a, b) => a + (b ?? 0), 0);
        expect(total).toBeGreaterThan(prev);
        prev = total;
      }
    }
  });
});

describe('見張り台の眺め', () => {
  it('方角は y が下 = 南', () => {
    expect(compass(1, 0)).toBe('東');
    expect(compass(0, 1)).toBe('南');
    expect(compass(-1, 0)).toBe('西');
    expect(compass(0, -1)).toBe('北');
    expect(compass(1, -1)).toBe('北東');
  });

  it('建て増しの段階で見えるものが増える（0 段階は何も見えない）', () => {
    const save = freshSave(T0);
    expect(lookout(world, save, T0)).toEqual([]);
    save.tower.stage = 1;
    expect(lookout(world, save, T0).map((e) => e.kind)).toEqual(['wood', 'flower']);
    save.tower.stage = 2;
    expect(lookout(world, save, T0).map((e) => e.kind)).toEqual(['wood', 'flower', 'stone', 'copper']);
  });

  it('いちばん近い物の距離が手で測った値と合い、切って無くなればそれを数えない', () => {
    const save = freshSave(T0);
    save.tower.stage = 1;
    const wood = lookout(world, save, T0).find((e) => e.kind === 'wood')!;
    expect(wood.nearest).not.toBeNull();
    const trees = world.nodes.filter((n) => n.kind === 'tree');
    const d = (n: MapNode) => Math.hypot(n.x + 0.5 - save.player.x, n.y + 0.5 - save.player.y);
    trees.sort((a, b) => d(a) - d(b));
    // 若木のほかに近い木（カシなど）があれば、そちらが最短かもしれない。どれが近くても「若木までの距離以下」
    expect(wood.nearest!.dist).toBeLessThanOrEqual(d(trees[0]!) + 1e-9);
    const before = wood.total;
    save.stamina.value = 999;
    for (let i = 0; i < 20 && save.nodes[trees[0]!.id]?.destroyedAt == null; i++) hitNode(world, save, trees[0]!, T0);
    expect(save.nodes[trees[0]!.id]?.destroyedAt).not.toBeNull();
    // 若木は幹になって残る（幹も叩ける）ので数は変わらないか、幹を切って減る。増えない
    expect(lookout(world, save, T0).find((e) => e.kind === 'wood')!.total).toBeLessThanOrEqual(before);
  });

  it('洞窟にいるときは、洞窟の中の物だけを距離で測る（洞窟に木は無い）', () => {
    const save = freshSave(T0);
    save.tower.stage = 2;
    save.skills.pickHard = 1;
    for (const n of world.nodes) if (n.kind === 'borderRock' || n.kind === 'borderTree') save.nodes[n.id] = { hp: 0, destroyedAt: 0 }; // 岩場を開けて、洞窟に入れるようにする
    const cave =world.regions.find((r) => r.id === 'cave');
    expect(cave).toBeDefined();
    save.player.y = cave!.y0 + 3;
    save.player.x = 10;
    const v = lookout(world, save, T0);
    const copper = v.find((e) => e.kind === 'copper')!;
    expect(copper.nearest).not.toBeNull();
    expect(copper.nearest!.dist).toBeLessThan(40);
    expect(v.find((e) => e.kind === 'wood')!.nearest).toBeNull();
    expect(v.find((e) => e.kind === 'wood')!.total).toBeGreaterThan(0); // 島には木がある
  });
});

describe('今日のおすすめごはん', () => {
  it('固定のおねがいの間は、いまのおねがい（最初は力もち）に合うごはんを勧める', () => {
    const save = freshSave(T0);
    save.maxPoints = 100;
    const a = mealAdvice(save, T0)!;
    expect(a.total).toBe(1);
    expect(a.covers).toBe(1);
    expect(['turnipSoup', 'gardenSalad', 'fishStew']).toContain(a.meal);
  });

  it('毎日のおねがいが出たら、3 件にいちばん多く効くごはんを勧める（サラダなら全部まかなえる）', () => {
    const save = freshSave(T0);
    save.maxPoints = 100;
    save.request.done = ['wood16', 'fish5', 'crop8', 'stone12', 'wood30'];
    const a = mealAdvice(save, T0)!;
    expect(a.total).toBe(3);
    expect(a.covers).toBe(3);
    expect(a.meal).toBe('gardenSalad');
    expect(a.bigName).not.toBeNull();
  });

  it('島レベルが低くて解禁されたごはんだけから選ぶ（サラダは島レベル 3 から）', () => {
    const save = freshSave(T0);
    save.maxPoints = 0;
    save.request.done = ['wood16', 'fish5', 'crop8', 'stone12', 'wood30'];
    const a = mealAdvice(save, T0)!;
    expect(a.meal).not.toBe('gardenSalad');
  });
});

// ---------------------------------------------------------------------------
// 収支。素材 1 個あたりのスタミナを実際に叩いて測り、段階ごとの合計と、贈り物の回収日数を出す。
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

describe('見張り台の収支', () => {
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
    sapling: 3,
  });
  const stamina = (defs: { cost: Partial<Record<ItemId, number>> }[], c: Partial<Record<ItemId, number>>) =>
    defs.map((st) => (Object.entries(st.cost) as [ItemId, number][]).reduce((a, [k, n]) => a + n * (c[k] ?? 0), 0));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  /** 贈り物の 1 日あたりの平均（52 日ぶんの中身の平均。スタミナ換算）。 */
  const giftAvg = (c: Partial<Record<ItemId, number>>) => {
    let t = 0;
    const days = 52;
    for (let d = 0; d < days; d++) {
      t += (Object.entries(towerGiftOn(TOWER_STAGES.length, d)) as [ItemId, number][]).reduce((a, [k, n]) => a + n * (c[k] ?? 0), 0);
    }
    return t / days;
  };

  it('商船より軽く、力もちで安くなり、贈り物は回収に十分な日数がかかる。商船と合わせた総量も前→後で示す', () => {
    const plain = cost(false);
    const strong = cost(true);
    const a = stamina(TOWER_STAGES, plain);
    const b = stamina(TOWER_STAGES, strong);
    const totalA = sum(a);
    const totalB = sum(b);
    const shipA = sum(stamina(SHIP_STAGES, plain));
    const shipB = sum(stamina(SHIP_STAGES, strong));
    const gift = giftAvg(plain);
    const shipGiftValue = 17; // ship.test.ts の測定（1 日 17 相当）
    // eslint-disable-next-line no-console
    console.log(
      `[見張り台測定] 1 個あたり(力もちなし→あり): 木材 ${plain.wood!.toFixed(2)}→${strong.wood!.toFixed(2)} 石 ${plain.stone!.toFixed(2)}→${strong.stone!.toFixed(2)} 銅 ${plain.copper!.toFixed(2)}→${strong.copper!.toFixed(2)} 花びら ${plain.petal!.toFixed(2)}→${strong.petal!.toFixed(2)}\n` +
        TOWER_STAGES.map((s, i) => `${i + 1}. ${s.name}: ${a[i]!.toFixed(0)} → ${b[i]!.toFixed(0)} スタミナ`).join('\n') +
        `\n見張り台 合計 ${totalA.toFixed(0)} → ${totalB.toFixed(0)}（満タン 40 の ${(totalA / 40).toFixed(1)} 本 → ${(totalB / 40).toFixed(1)} 本）／贈り物(全部建て増したあと) 1 日 平均 ${gift.toFixed(1)} 相当 → 回収 ${(totalA / gift).toFixed(0)} 日\n` +
        `商船だけ → 商船 + 見張り台: 合計 ${shipA.toFixed(0)} → ${(shipA + totalA).toFixed(0)}（満タン ${(shipA / 40).toFixed(1)} 本 → ${((shipA + totalA) / 40).toFixed(1)} 本、力もち ${shipB.toFixed(0)} → ${(shipB + totalB).toFixed(0)}）／お届け 1 日 ${shipGiftValue} → ${(shipGiftValue + gift).toFixed(1)} 相当`,
    );
    expect(totalA).toBeGreaterThan(150);
    expect(totalA).toBeLessThan(shipA); // 商船より軽い
    expect(totalB / totalA).toBeLessThan(0.85);
    for (const x of a) expect(x).toBeGreaterThan(20); // 1 段階が軽すぎない
    expect(gift).toBeLessThan(15);
    expect(totalA / gift).toBeGreaterThan(15);
    // 商船と合わせても、お届けの合計が 1 日 30 相当（満タン 40 の 3/4）を超えない
    expect(shipGiftValue + gift).toBeLessThan(30);
  });

  it('素材は商船・家具と取り合う（木材・石・花びら・銅・作物・魚が重なる）', () => {
    const towerUse = (item: ItemId) => TOWER_STAGES.reduce((a, s) => a + (s.cost[item] ?? 0), 0);
    const shipUse = (item: ItemId) => SHIP_STAGES.reduce((a, s) => a + (s.cost[item] ?? 0), 0);
    for (const item of ['wood', 'stone', 'copper', 'petal', 'sunflower', 'turnip', 'tomato', 'fish', 'bigFish'] as ItemId[]) {
      expect(towerUse(item), item).toBeGreaterThan(0);
      expect(shipUse(item), item).toBeGreaterThan(0);
    }
    // 木材は進行テストの目標（150 個 = 3.4 時間）を、商船と見張り台だけで超える
    expect(towerUse('wood') + shipUse('wood')).toBeGreaterThan(150);
    // 1 段階の木材・石は、丸太の見張り台そのもの（木材 20）や石の像（石 15）の素材に並ぶ
    expect(Math.max(...TOWER_STAGES.map((s) => s.cost.wood ?? 0))).toBeGreaterThanOrEqual(20);
    expect(Math.max(...TOWER_STAGES.map((s) => s.cost.stone ?? 0))).toBeGreaterThanOrEqual(15);
  });
});
