import { describe, expect, it } from 'vitest';

import { FURNITURE, NODES, craftMs, STAMINA_REGEN_MS, TREE_GROW_MS } from '../src/game/data';
import { buySkill, collectCraft, craft, openChest, place, plant, travel, workNode } from '../src/game/actions';
import { actionMs, allNodes, canHit, isAreaOpen, islandLevel, knownRecipes, nodeAlive } from '../src/game/rules';
import { currentStamina } from '../src/game/time';
import { applyRespawns } from '../src/game/time';
import { newSave } from '../src/game/save';
import { freeTiles, world } from './helpers';
import type { ItemId, LiveNode, MapNode, NodeKind, Result, SaveState } from '../src/game/types';

/**
 * 「無限に時間をかけられるプレイヤー」を actions API だけで動かし、
 * 4 エリアの開放と島レベル 3 到達に実際どれだけの時間・スタミナがかかるかを測る。
 * ワープ・時間送りはあり（バランス調整用の計測なので移動や当たり判定は見ない）。
 * 1 回の行動（伐採 1 段階・採取 1 回）には actionMs ぶん（約 3 秒）の時間がかかる。
 * 木は復活しないので、切り尽くしたら苗木を植えて育つのを待つ（それが本来の遊び方）。
 */
/** シミュレーション用の時計・行動・資源集めの道具一式。 */
function createSim() {
  const save: SaveState = newSave(world, 0);
  let now = 0;
  let actions = 0;
  let replants = 0;

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

  const gone = (node: MapNode): boolean =>
    node.id.startsWith('p:') ? !save.planted[node.id.slice(2)] : save.nodes[node.id]?.destroyedAt != null;

  /** 時間のかかる行動 1 回（伐採なら 1 段階）。 */
  const work = (node: LiveNode | MapNode): void => {
    act((n) => {
      const r = workNode(world, save, node, n);
      if (r.ok) {
        actions++;
        advance(actionMs(save, NODES[node.kind].tool));
      }
      return r;
    });
  };

  const destroyNode = (node: LiveNode | MapNode): void => {
    while (!gone(node)) work(node);
  };

  /** 今叩ける資源（開いているエリアの、育ちきったもの）。 */
  const findAliveNode = (kinds: NodeKind[]): LiveNode | undefined =>
    allNodes(world, save, now).find(
      (n) =>
        kinds.includes(n.kind) &&
        !n.growing &&
        nodeAlive(save, n, now) &&
        canHit(save, n) &&
        isAreaOpen(world, save, n.area),
    );

  /** 持っている苗木を全部植えて、育つまで待つ。 */
  const replant = (): void => {
    const saplings = save.inventory.sapling ?? 0;
    if (saplings === 0) throw new Error('木も苗木も無い（行き止まり）');
    const tiles = freeTiles(save, saplings);
    if (tiles.length === 0) throw new Error('植える場所が無い');
    for (const t of tiles) act((n) => plant(world, save, t.x, t.y, 'sapling', n));
    replants++;
    advance(TREE_GROW_MS);
  };

  let respawnWaits = 0;
  /** 復活する資源（洞窟の岩など）が全部掘られていたら、いちばん早く戻るものまで待つ。 */
  const waitForRespawn = (kinds: NodeKind[]): void => {
    let soonest = Infinity;
    for (const n of world.nodes) {
      const st = save.nodes[n.id];
      const ms = NODES[n.kind].respawnMs;
      if (!kinds.includes(n.kind) || !st || st.destroyedAt == null || ms == null) continue;
      if (!isAreaOpen(world, save, n.area) || !canHit(save, n)) continue;
      soonest = Math.min(soonest, st.destroyedAt + ms);
    }
    if (soonest === Infinity) throw new Error(`資源が無い: ${kinds.join(',')}`);
    respawnWaits++;
    advance(Math.max(0, soonest - now));
  };

  /** 特定の種類の資源を 1 個破壊する（無ければ苗木を植えて育てる・復活を待つ）。 */
  const destroyOneOf = (kinds: NodeKind[]): void => {
    for (;;) {
      const node = findAliveNode(kinds);
      if (node) {
        destroyNode(node);
        return;
      }
      if (kinds.includes('tree')) replant();
      else waitForRespawn(kinds);
    }
  };

  /** 石・銅を掘る資源（洞窟）。先に並べたものから掘る。 */
  const MINE_FOR: Record<'stone' | 'copper', NodeKind[]> = {
    stone: ['rock', 'hardRock', 'copperVein'],
    copper: ['copperVein', 'hardRock'],
  };

  /** アイテムが目標数に届くまで、対応する資源を壊し続ける。 */
  const ensureItem = (item: ItemId, amount: number): void => {
    // 石・銅は洞窟の岩・鉱脈を掘る（SI-6）。岩場が開いていないと入れない。
    if (item === 'stone' || item === 'copper') {
      while ((save.inventory[item] ?? 0) < amount) {
        const kinds = MINE_FOR[item];
        const node = findAliveNode(kinds.slice(0, 1)) ?? findAliveNode(kinds);
        if (node) destroyNode(node);
        else waitForRespawn(kinds);
      }
      return;
    }
    if (item !== 'wood') throw new Error(`入手方法を決めていない: ${item}`);
    while ((save.inventory[item] ?? 0) < amount) destroyOneOf(['tree']);
  };

  /** 経験値が目標に届くまで、木を壊し続ける。 */
  const ensureXp = (amount: number): void => {
    while (save.xp < amount) destroyOneOf(['tree']);
  };

  const buy = (skill: 'axePower' | 'pickHard', cost: number) => {
    ensureXp(cost);
    const r = buySkill(save, skill);
    if (!r.ok) throw new Error(`スキル購入に失敗: ${r.reason}`);
  };

  const craftAndPlace = (ids: string[], stopAtLevel?: number) => {
    for (const id of ids) {
      if (stopAtLevel != null && islandLevel(save) >= stopAtLevel) break;
      const def = FURNITURE.find((f) => f.id === id);
      if (!def) throw new Error(`no furniture ${id}`);
      for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) ensureItem(item, amount);
      act((n) => craft(save, def.id, n));
      // クラフトは実時間がかかる。終わるまで待ってから受け取る。
      advance(craftMs(def.id));
      const got = collectCraft(save, now);
      if (!got.ok) throw new Error(`受け取りに失敗: ${got.reason}`);
      const [slot] = freeTiles(save, 1);
      if (!slot) throw new Error('空きマスが無い');
      const r = place(world, save, slot.x, slot.y, def.id);
      if (!r.ok) throw new Error(`配置に失敗: ${r.reason}`);
    }
  };

  return {
    save,
    get now() {
      return now;
    },
    get actions() {
      return actions;
    },
    get replants() {
      return replants;
    },
    get respawnWaits() {
      return respawnWaits;
    },
    advance,
    destroyNode,
    ensureItem,
    buy,
    craftAndPlace,
  };
}

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
      ms: sim.now - before.at,
    };
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
        sim.advance(STAMINA_REGEN_MS);
        r = craft(sim.save, id, sim.now);
      }
      expect(r.ok, `${id}: ${r.ok ? '' : r.reason}`).toBe(true);
      sim.advance(craftMs(id));
      expect(collectCraft(sim.save, sim.now).ok).toBe(true);
    }
  });
});
