// プレイヤーの行動。すべて save を書き換えて Result を返す。
// クールダウンはここでは見ない（store.ts が見る）。

import {
  FARM_RANGE,
  FURNITURE_BY_ID,
  NODES,
  SKILLS,
  SKILL_COST,
  XP_PER_STAMINA,
  harvestAmount,
} from './data';
import { canHit, damageFor, isAreaOpen, knownCrops, knownRecipes, nodeAlive, skillCap } from './rules';
import { isReady, normalizeStamina } from './time';
import { updateMaxPoints } from './score';
import { key } from './world';
import type {
  Chest,
  CropId,
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

function xpEvent(amount: number): GameEvent {
  return { type: 'xp', amount };
}

export function hitNode(world: World, save: SaveState, node: MapNode, now: number): Result {
  if (!nodeAlive(save, node, now)) return { ok: false, reason: 'notReady' };
  if (!canHit(save, node)) return { ok: false, reason: 'needSkill' };
  if (!spend(save, 1, now)) return { ok: false, reason: 'noStamina' };

  const def = NODES[node.kind];
  const state = save.nodes[node.id];
  const hpBefore = state?.hp ?? def.hp;
  const damage = damageFor(save, node);
  const hpAfter = hpBefore - damage;

  const events: GameEvent[] = [{ type: 'hit', x: node.x, y: node.y, kind: node.kind, damage }, xpEvent(1)];

  if (hpAfter <= 0) {
    const wasOpen = isAreaOpen(world, save, node.area);
    save.nodes[node.id] = { hp: 0, destroyedAt: now };
    for (const [item, amount] of Object.entries(def.drops) as [ItemId, number][]) {
      addItem(save, item, amount);
    }
    events.push({ type: 'broke', x: node.x, y: node.y, kind: node.kind, drops: def.drops });
    const isOpenNow = isAreaOpen(world, save, node.area);
    if (!wasOpen && isOpenNow) events.push({ type: 'areaOpened', area: node.area });
  } else {
    save.nodes[node.id] = { hp: hpAfter, destroyedAt: null };
  }

  return { ok: true, events };
}

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

export function place(world: World, save: SaveState, slotId: string, furnitureId: FurnitureId | null): Result {
  const slot = world.slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'wrongAttr' };

  const events: GameEvent[] = [];

  if (furnitureId == null) {
    const old = save.placements[slotId];
    if (!old) return { ok: true, events: [] };
    delete save.placements[slotId];
    save.furniture[old] = (save.furniture[old] ?? 0) + 1;
    events.push({ type: 'placed', slot: slotId, furniture: null });
  } else {
    const def = FURNITURE_BY_ID[furnitureId];
    if (!def) return { ok: false, reason: 'wrongAttr' };
    if (def.attr !== slot.attr) return { ok: false, reason: 'wrongAttr' };
    if ((save.furniture[furnitureId] ?? 0) < 1) return { ok: false, reason: 'notEnoughItems' };

    const old = save.placements[slotId];
    save.furniture[furnitureId] = (save.furniture[furnitureId] ?? 0) - 1;
    if (old) save.furniture[old] = (save.furniture[old] ?? 0) + 1;
    save.placements[slotId] = furnitureId;
    events.push({ type: 'placed', slot: slotId, furniture: furnitureId });
  }

  const levelUp = updateMaxPoints(world, save);
  if (levelUp) events.push(levelUp);

  return { ok: true, events };
}
