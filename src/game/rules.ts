// スキル段階の上限、ダメージ、クールダウン、覚えているレシピ・種、エリアの開放判定。

import {
  ACTION_COOLDOWN_MS,
  AREAS,
  CROPS,
  FURNITURE,
  ISLAND_LEVEL_POINTS,
  NODES,
  NODE_REQUIRES,
  SKILLS,
  SPEED_PER_LEVEL,
  STAMINA_BASE,
  STAMINA_PER_LEVEL,
  damageForLevel,
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
