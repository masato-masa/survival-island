// プレイヤーの行動。すべて save を書き換えて Result を返す。
// 行動にかかる時間（約 3 秒）はここでは見ない（store.ts が始めて、終わったときにここの関数で結果を出す）。

import {
  FARM_RANGE,
  FURNITURE_BY_ID,
  NODES,
  PLANT_STAMINA,
  SAPLING_DROPS,
  STUMP_DROPS,
  STUMP_HP,
  SKILLS,
  SKILL_COST,
  XP_PER_STAMINA,
  harvestAmount,
} from './data';
import {
  canHit,
  canPlaceAt,
  damageFor,
  isAreaOpen,
  isBuildable,
  knownCrops,
  knownRecipes,
  nodeAlive,
  placementAt,
  plantedNodeId,
  skillCap,
} from './rules';
import { isReady, normalizeStamina } from './time';
import { updateMaxPoints } from './score';
import { key } from './world';
import type {
  Chest,
  CropId,
  Fail,
  FurnitureId,
  GameEvent,
  ItemId,
  MapNode,
  Plot,
  Result,
  SaveState,
  SkillId,
  World,
} from './types';

/** スタミナを消費して経験値を得る。足りなければ何もせず false。 */
export function spend(save: SaveState, amount: number, now: number): boolean {
  normalizeStamina(save, now);
  if (save.stamina.value < amount) return false;
  save.stamina.value -= amount;
  save.xp += amount * XP_PER_STAMINA;
  save.totalXp += amount * XP_PER_STAMINA;
  return true;
}

function addItem(save: SaveState, item: ItemId, amount: number): void {
  save.inventory[item] = (save.inventory[item] ?? 0) + amount;
}

type Drops = Partial<Record<ItemId, number>>;

function addDrops(save: SaveState, drops: Drops): void {
  for (const [item, amount] of Object.entries(drops) as [ItemId, number][]) addItem(save, item, amount);
}

function xpEvent(amount: number): GameEvent {
  return { type: 'xp', amount };
}

/** 切ると「木 → 幹 → 消える」の 2 段階になる資源。 */
const TREE_KINDS = new Set<string>(['tree', 'bigTree', 'borderTree', 'forestTree']);

/** 叩ける資源（地図の資源、または allNodes が返す植えたもの）。growing は育っている途中。 */
type HittableNode = MapNode & { growing?: boolean };

const isPlantedId = (id: string): boolean => id.startsWith('p:');

/** 資源が消えた。植えたものは記録ごと消す（跡地に家具・次の苗を置ける）。 */
function removeNode(save: SaveState, node: MapNode, now: number): void {
  if (isPlantedId(node.id)) {
    delete save.nodes[node.id];
    delete save.planted[node.id.slice(2)];
  } else {
    save.nodes[node.id] = { hp: 0, destroyedAt: now };
  }
}

/**
 * 資源を 1 回叩く（花は 1 回摘む）。スタミナ 1。
 * 木は体力 0 で幹になり（木材）、幹の体力 0 で消える（木材＋苗木）。
 * 花は摘むたびに花びら・種が出て、FLOWER_GATHERS 回で消える。
 */
export function hitNode(world: World, save: SaveState, node: HittableNode, now: number): Result {
  if (node.growing) return { ok: false, reason: 'notReady' };
  if (!nodeAlive(save, node, now)) return { ok: false, reason: 'notReady' };
  if (!canHit(save, node)) return { ok: false, reason: 'needSkill' };
  if (!spend(save, 1, now)) return { ok: false, reason: 'noStamina' };

  const def = NODES[node.kind];
  const state = save.nodes[node.id];
  const isTree = TREE_KINDS.has(node.kind);
  const isStump = state?.stump === true;
  const hpBefore = state?.hp ?? def.hp;
  const damage = damageFor(save, node);
  const hpAfter = hpBefore - damage;

  const events: GameEvent[] = [];

  if (def.tool === 'gather') {
    // 花を摘む：摘むたびに drops が出る
    addDrops(save, def.drops);
    const remaining = Math.max(0, hpAfter);
    events.push({ type: 'gathered', x: node.x, y: node.y, kind: node.kind, remaining }, xpEvent(1));
    events.push({ type: 'dropped', x: node.x, y: node.y, items: { ...def.drops } });
    if (remaining > 0) {
      save.nodes[node.id] = { hp: remaining, destroyedAt: null };
    } else {
      removeNode(save, node, now);
      events.push({ type: 'broke', x: node.x, y: node.y, kind: node.kind, drops: {} });
    }
    return { ok: true, events };
  }

  events.push({ type: 'hit', x: node.x, y: node.y, kind: node.kind, damage }, xpEvent(1));

  if (hpAfter > 0) {
    save.nodes[node.id] = { hp: hpAfter, destroyedAt: null, ...(isStump ? { stump: true } : {}) };
  } else if (isTree && !isStump) {
    // 木を切り倒した → 幹（切り株）が残る。幹をもう一度切ると木は消える。
    save.nodes[node.id] = { hp: STUMP_HP, destroyedAt: null, stump: true };
    addDrops(save, def.drops);
    events.push({ type: 'broke', x: node.x, y: node.y, kind: node.kind, drops: def.drops });
    events.push({ type: 'dropped', x: node.x, y: node.y, items: { ...def.drops } });
  } else {
    const wasOpen = isAreaOpen(world, save, node.area);
    removeNode(save, node, now);
    let drops: Drops = isStump ? { ...STUMP_DROPS } : { ...def.drops };
    // 木が消えると苗木が出る（木は復活しないので、これを植えて増やす）
    const saplings = isTree ? SAPLING_DROPS[node.kind] ?? 0 : 0;
    if (saplings > 0) drops = { ...drops, sapling: (drops.sapling ?? 0) + saplings };
    addDrops(save, drops);
    events.push({ type: 'broke', x: node.x, y: node.y, kind: node.kind, drops });
    events.push({ type: 'dropped', x: node.x, y: node.y, items: drops });
    const isOpenNow = isAreaOpen(world, save, node.area);
    if (!wasOpen && isOpenNow) events.push({ type: 'areaOpened', area: node.area });
  }

  return { ok: true, events };
}

/** 資源の「段階」（立っている / 幹 / 消えた）。 */
function nodeStage(save: SaveState, node: MapNode): string {
  if (isPlantedId(node.id) && !save.planted[node.id.slice(2)]) return 'gone';
  const st = save.nodes[node.id];
  if (st?.destroyedAt != null) return 'gone';
  return st?.stump ? 'stump' : 'standing';
}

/**
 * 時間のかかる行動 1 回ぶんの作業。伐採・採掘は段階が変わる（木 → 幹、幹 → 消える）まで hitNode を繰り返す。
 * スタミナは 1 回叩くごとに 1（パワー系スキルが高いほど少なく済む）。途中でスタミナが尽きたらそこで止め、
 * 削った体力は残す（1 回でも叩けていれば成功）。花は 1 回摘むだけ。
 * 伐採の hit はまとめて 1 つ（damage は合計）、xp も合計 1 つにして返す。
 */
export function workNode(world: World, save: SaveState, node: HittableNode, now: number): Result {
  if (NODES[node.kind].tool === 'gather') return hitNode(world, save, node, now);
  const stageBefore = nodeStage(save, node);
  const events: GameEvent[] = [];
  let damage = 0;
  let xp = 0;
  let hits = 0;
  // 体力の合計を超えて叩くことはないが、念のため上限を置く
  for (let guard = 0; guard < 100; guard++) {
    const r = hitNode(world, save, node, now);
    if (!r.ok) {
      if (hits === 0) return r;
      break;
    }
    hits++;
    for (const e of r.events) {
      if (e.type === 'hit') damage += e.damage;
      else if (e.type === 'xp') xp += e.amount;
      else events.push(e);
    }
    if (nodeStage(save, node) !== stageBefore) break;
  }
  return {
    ok: true,
    events: [{ type: 'hit', x: node.x, y: node.y, kind: node.kind, damage }, ...events, xpEvent(xp)],
  };
}

// ---------------------------------------------------------------------------
// 植える（苗木 → 木、花の種 → 花）

/** 苗木・花の種を植えられるマスか（家具を置けるマスで、家具・植えたもの・プレイヤーがいない）。 */
export function canPlantAt(
  world: World,
  save: SaveState,
  x: number,
  y: number,
  playerTile?: { x: number; y: number },
): boolean {
  if (!isBuildable(world, save, x, y)) return false; // 植えたもののあるマスもここで弾かれる
  if (placementAt(save, x, y)) return false;
  if (playerTile && playerTile.x === x && playerTile.y === y) return false;
  return true;
}

/** 苗木・花の種を植える。種 1 個とスタミナ PLANT_STAMINA を使う。育つまでは固いが叩けない。 */
export function plant(
  world: World,
  save: SaveState,
  x: number,
  y: number,
  item: 'sapling' | 'flowerSeed',
  now: number,
  playerTile?: { x: number; y: number },
): Result {
  if ((save.inventory[item] ?? 0) < 1) return { ok: false, reason: 'notEnoughItems' };
  if (!canPlantAt(world, save, x, y, playerTile)) return { ok: false, reason: 'cannotPlace' };
  if (!spend(save, PLANT_STAMINA, now)) return { ok: false, reason: 'noStamina' };
  save.inventory[item] = (save.inventory[item] ?? 0) - 1;
  const kind = item === 'sapling' ? 'tree' : 'flower';
  const tileKey = key(x, y);
  save.planted[tileKey] = { kind, plantedAt: now };
  delete save.nodes[plantedNodeId(tileKey)];
  return { ok: true, events: [{ type: 'sowed', x, y, plant: kind }, xpEvent(PLANT_STAMINA)] };
}

// ---------------------------------------------------------------------------
// 畑

function plotState(save: SaveState, plot: Plot) {
  let state = save.plots[plot.id];
  if (!state) {
    state = { selected: null, tiles: {} };
    save.plots[plot.id] = state;
  }
  return state;
}

/** 対象マスを中心にした farmRange のマス（同じ区画のものだけ）。中心が先頭。 */
function rangeTiles(world: World, save: SaveState, plot: Plot, x: number, y: number): { x: number; y: number }[] {
  const level = Math.min(save.skills.farmRange ?? 0, SKILLS.farmRange.maxLevel, FARM_RANGE.length - 1);
  const offsets = FARM_RANGE[level] ?? FARM_RANGE[0] ?? [[0, 0]];
  const plotTileKeys = new Set(plot.tiles.map((t) => key(t.x, t.y)));
  const result: { x: number; y: number }[] = [];
  for (const [dx, dy] of offsets) {
    const tx = x + dx;
    const ty = y + dy;
    if (plotTileKeys.has(key(tx, ty))) result.push({ x: tx, y: ty });
  }
  return result;
}

/** 畑の行動を始めてよいか（3 秒かけて空振りしないよう、始める前に見る）。null なら始めてよい。 */
export function checkFarm(save: SaveState, plot: Plot, x: number, y: number, now: number): Fail | null {
  const state = save.plots[plot.id];
  const tile = state?.tiles[key(x, y)];
  if (tile) {
    if (!isReady(tile, now)) return 'notReady';
  } else if (!state?.selected) {
    return 'noCrop';
  }
  normalizeStamina(save, now);
  if (save.stamina.value < 1) return 'noStamina';
  return null;
}

export function farmAction(world: World, save: SaveState, plot: Plot, x: number, y: number, now: number): Result {
  const state = plotState(save, plot);
  const centerKey = key(x, y);
  const centerTile = state.tiles[centerKey];

  if (centerTile) {
    if (!isReady(centerTile, now)) return { ok: false, reason: 'notReady' };
    return harvestTiles(world, save, plot, x, y, now);
  }
  if (!state.selected) return { ok: false, reason: 'noCrop' };
  return plantTiles(world, save, plot, x, y, now);
}

function plantTiles(world: World, save: SaveState, plot: Plot, x: number, y: number, now: number): Result {
  const state = plotState(save, plot);
  const crop = state.selected;
  if (!crop) return { ok: false, reason: 'noCrop' };
  const candidates = rangeTiles(world, save, plot, x, y).filter((t) => !state.tiles[key(t.x, t.y)]);
  if (candidates.length === 0) return { ok: false, reason: 'noStamina' };

  const planted: { x: number; y: number }[] = [];
  let xpGained = 0;
  for (const t of candidates) {
    if (!spend(save, 1, now)) break;
    state.tiles[key(t.x, t.y)] = { crop, plantedAt: now };
    planted.push(t);
    xpGained += 1;
  }
  if (planted.length === 0) return { ok: false, reason: 'noStamina' };

  const events: GameEvent[] = [{ type: 'planted', tiles: planted }, xpEvent(xpGained)];
  return { ok: true, events };
}

function harvestTiles(world: World, save: SaveState, plot: Plot, x: number, y: number, now: number): Result {
  const state = plotState(save, plot);
  const candidates = rangeTiles(world, save, plot, x, y).filter((t) => {
    const tile = state.tiles[key(t.x, t.y)];
    return tile != null && isReady(tile, now);
  });
  if (candidates.length === 0) return { ok: false, reason: 'notReady' };

  const yieldLevel = save.skills.farmYield ?? 0;
  const amountPerTile = harvestAmount(yieldLevel);
  const byCrop = new Map<CropId, { tiles: { x: number; y: number }[]; amount: number }>();
  let xpGained = 0;

  for (const t of candidates) {
    if (!spend(save, 1, now)) break;
    const tileKey = key(t.x, t.y);
    const tile = state.tiles[tileKey];
    if (!tile) continue;
    delete state.tiles[tileKey];
    addItem(save, tile.crop, amountPerTile);
    const entry = byCrop.get(tile.crop) ?? { tiles: [], amount: 0 };
    entry.tiles.push(t);
    entry.amount += amountPerTile;
    byCrop.set(tile.crop, entry);
    xpGained += 1;
  }

  if (xpGained === 0) return { ok: false, reason: 'noStamina' };

  const events: GameEvent[] = [];
  for (const [crop, { tiles, amount }] of byCrop) {
    events.push({ type: 'harvested', tiles, crop, amount });
    for (const t of tiles) events.push({ type: 'dropped', x: t.x, y: t.y, items: { [crop]: amountPerTile } });
  }
  events.push(xpEvent(xpGained));
  return { ok: true, events };
}

export function chooseCrop(save: SaveState, plotId: string, crop: CropId | null): Result {
  if (crop != null && !knownCrops(save).includes(crop)) return { ok: false, reason: 'notLearned' };
  const state = save.plots[plotId] ?? { selected: null, tiles: {} };
  state.selected = crop;
  save.plots[plotId] = state;
  return { ok: true, events: [] };
}

export function openChest(world: World, save: SaveState, chest: Chest): Result {
  void world;
  if (save.chestsOpened.includes(chest.id)) return { ok: true, events: [] };
  save.chestsOpened.push(chest.id);
  if (!save.learnedRecipes.includes(chest.recipe)) save.learnedRecipes.push(chest.recipe);
  return { ok: true, events: [{ type: 'chest', x: chest.x, y: chest.y, recipe: chest.recipe }] };
}

export function buySkill(save: SaveState, skill: SkillId): Result {
  const current = save.skills[skill] ?? 0;
  const cap = skillCap(save, skill);
  if (current >= SKILLS[skill].maxLevel) return { ok: false, reason: 'maxLevel' };
  if (current >= cap) return { ok: false, reason: 'levelCap' };
  const cost = SKILL_COST[current];
  if (cost == null) return { ok: false, reason: 'maxLevel' };
  if (save.xp < cost) return { ok: false, reason: 'noXp' };
  save.xp -= cost;
  save.skills[skill] = current + 1;
  return { ok: true, events: [{ type: 'skill', skill, level: current + 1 }] };
}

export function craft(save: SaveState, furnitureId: FurnitureId, now: number): Result {
  const def = FURNITURE_BY_ID[furnitureId];
  if (!def) return { ok: false, reason: 'notLearned' };
  if (!knownRecipes(save).includes(furnitureId)) return { ok: false, reason: 'notLearned' };
  for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) {
    if ((save.inventory[item] ?? 0) < amount) return { ok: false, reason: 'notEnoughItems' };
  }
  if (!spend(save, def.stamina, now)) return { ok: false, reason: 'noStamina' };
  for (const [item, amount] of Object.entries(def.cost) as [ItemId, number][]) {
    save.inventory[item] = (save.inventory[item] ?? 0) - amount;
  }
  save.furniture[furnitureId] = (save.furniture[furnitureId] ?? 0) + 1;
  return { ok: true, events: [{ type: 'crafted', furniture: furnitureId }, xpEvent(def.stamina)] };
}

/** (x, y) に家具を置く（null ならそのマスの家具をしまう）。どのマスにも自由に置ける。 */
export function place(world: World, save: SaveState, x: number, y: number, furnitureId: FurnitureId | null): Result {
  const events: GameEvent[] = [];

  if (furnitureId == null) {
    const anchor = placementAt(save, x, y);
    if (!anchor) return { ok: true, events: [] };
    const old = save.placements[anchor];
    if (old) save.furniture[old] = (save.furniture[old] ?? 0) + 1;
    delete save.placements[anchor];
    events.push({ type: 'placed', slot: anchor, furniture: null });
  } else {
    const def = FURNITURE_BY_ID[furnitureId];
    if (!def) return { ok: false, reason: 'cannotPlace' };
    if ((save.furniture[furnitureId] ?? 0) < 1) return { ok: false, reason: 'notEnoughItems' };
    if (!canPlaceAt(world, save, x, y, furnitureId)) return { ok: false, reason: 'cannotPlace' };

    const anchor = key(x, y);
    const old = save.placements[anchor];
    save.furniture[furnitureId] = (save.furniture[furnitureId] ?? 0) - 1;
    if (old) save.furniture[old] = (save.furniture[old] ?? 0) + 1;
    save.placements[anchor] = furnitureId;
    events.push({ type: 'placed', slot: anchor, furniture: furnitureId });
  }

  const levelUp = updateMaxPoints(world, save);
  if (levelUp) events.push(levelUp);

  return { ok: true, events };
}
