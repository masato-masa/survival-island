import { describe, expect, it } from 'vitest';

import { FURNITURE, NODES, craftMs } from '../src/game/data';
import { collectCraft, craft, openChest, travel } from '../src/game/actions';
import { canHit, isAreaOpen, islandLevel, knownRecipes } from '../src/game/rules';
import { currentStamina, regenMs } from '../src/game/time';
import { world } from './helpers';
import type { ItemId } from '../src/game/types';

/**
 * 「無限に時間をかけられるプレイヤー」を actions API だけで動かし、
 * 4 エリアの開放と島レベル 3 到達に実際どれだけの時間・スタミナがかかるかを測る。
 * ワープ・時間送りはあり（バランス調整用の計測なので移動や当たり判定は見ない）。
 * 1 回の行動（伐採 1 段階・採取 1 回）には actionMs ぶん（約 3 秒）の時間がかかる。
 * 木は復活しないので、切り尽くしたら苗木を植えて育つのを待つ（それが本来の遊び方）。
 */
import { createSim } from './sim';

describe('進行シミュレーション: 4 エリア開放 + 島レベル3', () => {
  it('actions だけで到達できる。かかった時間とスタミナを記録する', () => {
    const sim = createSim();
    const { save, destroyNode, buy, craftAndPlace } = sim;

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
    craftAndPlace(FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 1).map((f) => f.id));
    expect(islandLevel(save)).toBeGreaterThanOrEqual(2);

    // --- 4. 丘を開く（axePower Lv2、島レベル2 が必要） ---
    buy('axePower', 25);
    const hillBorders = world.nodes.filter((n) => n.area === 'hill' && n.kind === 'borderTree');
    expect(hillBorders.length).toBe(2);
    for (const b of hillBorders) destroyNode(b);
    expect(isAreaOpen(world, save, 'hill')).toBe(true);

    // --- 5. 石造りシリーズを一式クラフトして置き、島レベル 3 を目指す ---
    craftAndPlace(FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 2).map((f) => f.id), 3);

    // --- 結果 ---
    expect(isAreaOpen(world, save, 'forest')).toBe(true);
    expect(isAreaOpen(world, save, 'rocks')).toBe(true);
    expect(isAreaOpen(world, save, 'hill')).toBe(true);
    expect(islandLevel(save)).toBeGreaterThanOrEqual(3);

    const hours = sim.now / (60 * 60 * 1000);
    const totalStamina = save.totalXp; // XP は消費スタミナと 1:1 なので合計スタミナ消費に等しい
    const treesCut = Object.entries(save.nodes).filter(
      ([id, st]) => st.destroyedAt != null && world.nodes.find((n) => n.id === id)?.kind === 'tree',
    ).length;
    // eslint-disable-next-line no-console
    console.log(
      `[進行測定] 4 エリア開放 + 島レベル${islandLevel(save)} 到達: ゲーム内経過 ${hours.toFixed(2)} 時間 / ` +
        `合計スタミナ消費 ${totalStamina} / 行動 ${sim.actions} 回 / 地図の木を切り倒した数 ${treesCut} / 植え直し ${sim.replants} 回`,
    );
    expect(hours).toBeGreaterThan(0);
    expect(totalStamina).toBeGreaterThan(0);
  });
});

describe('進行シミュレーション: 木を切り尽くしたあと', () => {
  it('苗木を植えて育てれば、木材を集め続けられる（行き止まりにならない）', () => {
    const sim = createSim();
    const target = 150;
    sim.ensureItem('wood', target);
    expect(sim.save.inventory.wood ?? 0).toBeGreaterThanOrEqual(target);
    expect(sim.replants).toBeGreaterThan(0);
    const hours = sim.now / (60 * 60 * 1000);
    // eslint-disable-next-line no-console
    console.log(
      `[進行測定] 木材 ${target}: ゲーム内経過 ${hours.toFixed(1)} 時間 / 合計スタミナ消費 ${sim.save.totalXp} / ` +
        `行動 ${sim.actions} 回 / 植え直し ${sim.replants} 回`,
    );
  });
});

describe('進行シミュレーション: 洞窟（SI-6）', () => {
  it('岩場を開けば洞窟に入れ、銅のレシピを作れる。かかった時間とスタミナを記録する', () => {
    const sim = createSim();
    const { save, destroyNode, buy } = sim;
    const minutes = (ms: number) => (ms / 60000).toFixed(1);

    // --- 1. 洞窟に入れるまで（採掘 Lv1 → 岩場の境界の大岩 2 つ） ---
    expect(isAreaOpen(world, save, 'cave')).toBe(false);
    expect(travel(world, save, 'caveEntrance').ok).toBe(false);
    buy('pickHard', 10);
    for (const b of world.nodes.filter((n) => n.area === 'rocks' && n.kind === 'borderRock')) destroyNode(b);
    expect(isAreaOpen(world, save, 'cave')).toBe(true);
    expect(travel(world, save, 'caveEntrance').ok).toBe(true);
    expect(world.area[Math.floor(save.player.y) * world.width + Math.floor(save.player.x)]).toBe('cave');
    const openAt = sim.now;
    const openStamina = save.totalXp;

    // --- 2. 銅のレシピを 1 つ作るまで（岩場の宝箱で銅のランタンを覚える → 洞窟で掘る → 作業台） ---
    const chest = world.chests.find((c) => c.area === 'rocks');
    if (!chest) throw new Error('岩場の宝箱が無い');
    openChest(world, save, chest);
    expect(knownRecipes(save)).toContain('copperLamp');
    const lamp = FURNITURE.find((f) => f.id === 'copperLamp');
    if (!lamp) throw new Error('no copperLamp');
    for (const [item, amount] of Object.entries(lamp.cost) as [ItemId, number][]) sim.ensureItem(item, amount);
    expect(craft(save, 'copperLamp', sim.now).ok).toBe(true);
    sim.advance(craftMs('copperLamp'));
    expect(collectCraft(save, sim.now).ok).toBe(true);
    expect(save.furniture.copperLamp).toBe(1);
    const lampAt = sim.now;
    const lampStamina = save.totalXp;

    // --- 3. 満タンのスタミナ 1 本で洞窟を 1 周（全部掘る）すると、何が手に入るか ---
    sim.advance(60 * 60 * 1000); // 全部戻って、スタミナも満タン
    const staminaBefore = currentStamina(save, sim.now).value;
    const before = { stone: save.inventory.stone ?? 0, copper: save.inventory.copper ?? 0, xp: save.totalXp, at: sim.now };
    const caveNodes = world.nodes.filter((n) => n.area === 'cave' && canHit(save, n));
    for (const n of caveNodes) destroyNode(n);
    const lap = {
      stone: (save.inventory.stone ?? 0) - before.stone,
      copper: (save.inventory.copper ?? 0) - before.copper,
      stamina: save.totalXp - before.xp,
      ms: sim.now - before.at };
    const slowest = Math.max(...caveNodes.map((n) => NODES[n.kind].respawnMs ?? 0));

    // eslint-disable-next-line no-console
    console.log(
      `[洞窟測定] 洞窟に入れるまで: ゲーム内 ${minutes(openAt)} 分 / スタミナ ${openStamina}` +
        ` | 銅のランタン完成まで: ${minutes(lampAt)} 分 / スタミナ ${lampStamina}（復活待ち ${sim.respawnWaits} 回）` +
        ` | 1 周（${caveNodes.length} か所）: 石 ${lap.stone}・銅 ${lap.copper} / スタミナ ${lap.stamina}（満タン ${staminaBefore}）/ 行動 ${minutes(lap.ms)} 分` +
        ` | 全部戻るまで ${minutes(slowest)} 分`,
    );
    // 「今日の分」: 満タン 1 本で 1 周でき、銅のレシピ 1 つぶん（最大 3 個）以上が採れる
    expect(lap.stamina).toBeLessThanOrEqual(staminaBefore);
    expect(lap.copper).toBeGreaterThanOrEqual(3);
  });

  it('開いたレシピはすべて、洞窟の石・銅で作れる（入手元の無い材料が無い）', () => {
    const sim = createSim();
    sim.buy('pickHard', 10);
    for (const b of world.nodes.filter((n) => n.area === 'rocks' && n.kind === 'borderRock')) sim.destroyNode(b);
    sim.save.maxPoints = 100; // 島レベル 5
    for (const c of world.chests) openChest(world, sim.save, c);
    for (const id of knownRecipes(sim.save)) {
      const def = FURNITURE.find((f) => f.id === id);
      if (!def) throw new Error(`no furniture ${id}`);
      for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) {
        if (item === 'stone' || item === 'copper' || item === 'wood') sim.ensureItem(item, amount);
        else sim.save.inventory[item] = Math.max(sim.save.inventory[item] ?? 0, amount); // 花びら・作物は花と畑で採る（ここでは足す）
      }
      let r = craft(sim.save, id, sim.now);
      while (!r.ok && r.reason === 'noStamina') {
        sim.advance(regenMs(sim.save, sim.now));
        r = craft(sim.save, id, sim.now);
      }
      expect(r.ok, `${id}: ${r.ok ? '' : r.reason}`).toBe(true);
      sim.advance(craftMs(id));
      expect(collectCraft(sim.save, sim.now).ok).toBe(true);
    }
  });
});
