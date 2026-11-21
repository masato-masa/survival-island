// 進行シミュレーション用の道具一式（progression.test.ts と tempo.test.ts が使う）。
import { NODES, craftMs, TREE_GROW_MS, FURNITURE } from '../src/game/data';
import { buySkill, collectCraft, craft, place, plant, workNode } from '../src/game/actions';
import { actionMs, allNodes, canHit, isAreaOpen, islandLevel, nodeAlive } from '../src/game/rules';
import { applyRespawns, regenMs } from '../src/game/time';
import { newSave } from '../src/game/save';
import { freeTiles, world } from './helpers';
import type { ItemId, LiveNode, MapNode, NodeKind, Result, SaveState } from '../src/game/types';

export /** シミュレーション用の時計・行動・資源集めの道具一式。 */
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
        advance(regenMs(save, now));
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

