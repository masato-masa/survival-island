// スキル段階の上限、ダメージ、クールダウン、覚えているレシピ・種、エリアの開放判定。

import {
  ACTION_COOLDOWN_MS,
  AREAS,
  CROPS,
  FURNITURE,
  FURNITURE_BY_ID,
  ISLAND_LEVEL_POINTS,
  NODES,
  NODE_REQUIRES,
  SKILLS,
  SPEED_PER_LEVEL,
  STAMINA_BASE,
  STAMINA_PER_LEVEL,
  damageForLevel,
  furnitureSize,
  skillCapForIslandLevel,
} from './data';
import type { AreaId, CropId, FurnitureId, MapNode, SaveState, SkillId, World } from './types';

export function staminaMax(save: SaveState): number {
  return STAMINA_BASE + STAMINA_PER_LEVEL * (save.skills.staminaMax ?? 0);
}

/** maxPoints から島レベルを決める（下がらない）。 */
export function islandLevel(save: SaveState): number {
  let level = 1;
  for (let i = 1; i < ISLAND_LEVEL_POINTS.length; i++) {
    const threshold = ISLAND_LEVEL_POINTS[i];
    if (threshold != null && save.maxPoints >= threshold) level = i + 1;
  }
  return level;
}

export function skillCap(save: SaveState, skill: SkillId): number {
  return Math.min(SKILLS[skill].maxLevel, skillCapForIslandLevel(islandLevel(save)));
}

function requirementFor(node: MapNode): { skill: SkillId; level: number } | null {
  const req = NODE_REQUIRES[node.kind];
  if (req) return req;
  if (node.kind === 'borderTree' || node.kind === 'borderRock') {
    const area = AREAS[node.area];
    if (area.border) return { skill: area.border.skill, level: area.border.level };
  }
  return null;
}

/** 対象を壊すのに必要なスキル段階。無ければ null。（world は将来の拡張用。現状は data.ts だけで決まる） */
export function nodeRequirement(world: World, node: MapNode): { skill: SkillId; level: number } | null {
  void world;
  return requirementFor(node);
}

export function canHit(save: SaveState, node: MapNode): boolean {
  const req = requirementFor(node);
  if (!req) return true;
  return (save.skills[req.skill] ?? 0) >= req.level;
}

function powerSkillFor(node: MapNode): SkillId {
  return NODES[node.kind].tool === 'axe' ? 'axePower' : 'pickHard';
}

export function damageFor(save: SaveState, node: MapNode): number {
  const level = save.skills[powerSkillFor(node)] ?? 0;
  return damageForLevel(level);
}

export function cooldownMs(save: SaveState, tool: 'axe' | 'pick' | 'farm'): number {
  const speedSkill: SkillId | null = tool === 'axe' ? 'axeSpeed' : tool === 'pick' ? 'pickSpeed' : null;
  const level = speedSkill ? save.skills[speedSkill] ?? 0 : 0;
  return ACTION_COOLDOWN_MS * (1 - SPEED_PER_LEVEL * level);
}

/** 覚えているレシピ（島レベルで覚えるもの＋宝箱などで覚えたもの）。 */
export function knownRecipes(save: SaveState): FurnitureId[] {
  const level = islandLevel(save);
  const result: FurnitureId[] = [];
  for (const f of FURNITURE) {
    if ('level' in f.learn) {
      if (f.learn.level <= level) result.push(f.id);
    } else if (save.learnedRecipes.includes(f.id)) {
      result.push(f.id);
    }
  }
  return result;
}

/** 覚えている種（島レベルで解禁されたもの）。 */
export function knownCrops(save: SaveState): CropId[] {
  const level = islandLevel(save);
  return (Object.values(CROPS) as { id: CropId; unlockLevel: number }[])
    .filter((c) => c.unlockLevel <= level)
    .map((c) => c.id);
}

/** エリアが開いているか（境界が null のエリアは常に開いている。他は境界ノードが全て壊れている）。 */
export function isAreaOpen(world: World, save: SaveState, area: AreaId): boolean {
  if (AREAS[area].border == null) return true;
  const borders = world.nodes.filter(
    (n) => n.area === area && (n.kind === 'borderTree' || n.kind === 'borderRock'),
  );
  if (borders.length === 0) return true;
  return borders.every((n) => save.nodes[n.id]?.destroyedAt != null);
}

/** ノードが今生きているか（壊れていない）。復活時刻を過ぎていれば生きている扱い。 */
export function nodeAlive(save: SaveState, node: MapNode, now: number): boolean {
  const state = save.nodes[node.id];
  if (!state || state.destroyedAt == null) return true;
  const def = NODES[node.kind];
  if (def.respawnMs != null && state.destroyedAt + def.respawnMs <= now) return true;
  return false;
}


// ---------------------------------------------------------------------------
// 家具の自由配置

const BUILDABLE_GROUND = new Set(['grass', 'sand', 'dirt', 'paving', 'foundation', 'dock']);

/** 家具の左上マス → その家具の占める矩形。 */
export function placementRect(anchorKey: string, furnitureId: FurnitureId): { x: number; y: number; size: number } {
  const [xs, ys] = anchorKey.split(',');
  const def = FURNITURE_BY_ID[furnitureId];
  return { x: Number(xs), y: Number(ys), size: def ? furnitureSize(def.attr) : 1 };
}

/** 置いてある家具が占めているマス（"x,y"）の集合。except に指定したアンカーの家具は数えない。 */
export function occupiedByFurniture(save: SaveState, except?: string): Set<string> {
  const out = new Set<string>();
  for (const [anchor, id] of Object.entries(save.placements)) {
    if (anchor === except) continue;
    const r = placementRect(anchor, id);
    for (let dy = 0; dy < r.size; dy++) for (let dx = 0; dx < r.size; dx++) out.add(`${r.x + dx},${r.y + dy}`);
  }
  return out;
}

/** そのマスを占めている家具のアンカー（左上マスの "x,y"）。無ければ null。 */
export function placementAt(save: SaveState, x: number, y: number): string | null {
  for (const [anchor, id] of Object.entries(save.placements)) {
    const r = placementRect(anchor, id);
    if (x >= r.x && x < r.x + r.size && y >= r.y && y < r.y + r.size) return anchor;
  }
  return null;
}

/**
 * 家具を置いてよいマスか（家具そのものは見ない）。水・畑・看板・宝箱・設備・飾り・立っている資源の上には置けない。
 * 復活しない資源（森の木・境界）が完全に消えたあとの跡地には置ける。
 */
export function isBuildable(world: World, save: SaveState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const ground = world.ground[y * world.width + x];
  if (!ground || !BUILDABLE_GROUND.has(ground)) return false;
  for (const node of world.nodes) {
    if (node.x !== x || node.y !== y) continue;
    const gone = save.nodes[node.id]?.destroyedAt != null && NODES[node.kind].respawnMs === null;
    if (!gone) return false;
  }
  for (const plot of world.plots) {
    if (plot.sign.x === x && plot.sign.y === y) return false;
    if (plot.tiles.some((t) => t.x === x && t.y === y)) return false;
  }
  for (const c of world.chests) if (c.x === x && c.y === y) return false;
  for (const st of world.stations) if (st.kind !== 'housePlot' && st.x === x && st.y === y) return false;
  for (const d of world.decor) if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return false;
  return true;
}

/** (x, y)（左上）に furnitureId を置けるか。同じ左上にある古い家具（入れ替え対象）は無視する。 */
export function canPlaceAt(world: World, save: SaveState, x: number, y: number, furnitureId: FurnitureId): boolean {
  const def = FURNITURE_BY_ID[furnitureId];
  if (!def) return false;
  const size = furnitureSize(def.attr);
  const others = occupiedByFurniture(save, `${x},${y}`);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (!isBuildable(world, save, x + dx, y + dy)) return false;
      if (others.has(`${x + dx},${y + dy}`)) return false;
    }
  }
  return true;
}
