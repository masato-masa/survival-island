// スキル段階の上限、ダメージ、クールダウン、覚えているレシピ・種、エリアの開放判定。

import {
  AREAS,
  CHOP_ACTION_MS,
  CROPS,
  FARM_ACTION_MS,
  FLOWER_GROW_MS,
  FURNITURE,
  FURNITURE_BY_ID,
  GATHER_ACTION_MS,
  ISLAND_LEVEL_POINTS,
  NODES,
  NODE_REQUIRES,
  SKILLS,
  SPEED_PER_LEVEL,
  STAMINA_BASE,
  STAMINA_PER_LEVEL,
  TREE_GROW_MS,
  damageForLevel,
  furnitureSize,
  skillCapForIslandLevel,
} from './data';
import type { AreaId, CropId, FurnitureId, LiveNode, MapNode, SaveState, SkillId, World } from './types';

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

function powerSkillFor(node: MapNode): SkillId | null {
  const tool = NODES[node.kind].tool;
  return tool === 'axe' ? 'axePower' : tool === 'pick' ? 'pickHard' : null;
}

/** 1 回叩いたときに減る体力。花（採取）は常に 1（1 回摘む）。 */
export function damageFor(save: SaveState, node: MapNode): number {
  const skill = powerSkillFor(node);
  if (!skill) return 1;
  return damageForLevel(save.skills[skill] ?? 0);
}

/** 時間のかかる行動 1 回の長さ（ミリ秒）。伐採・採掘は速度スキル 1 段階ごとに 10% 短い。 */
export function actionMs(save: SaveState, tool: 'axe' | 'pick' | 'gather' | 'farm'): number {
  if (tool === 'farm') return FARM_ACTION_MS;
  if (tool === 'gather') return GATHER_ACTION_MS;
  const level = save.skills[tool === 'axe' ? 'axeSpeed' : 'pickSpeed'] ?? 0;
  return CHOP_ACTION_MS * (1 - SPEED_PER_LEVEL * level);
}

/** 覚えているレシピ（島レベルで覚えるもの＋宝箱などで覚えたもの）。 */
export function knownRecipes(save: SaveState): FurnitureId[] {
  const level = islandLevel(save);
  const result: FurnitureId[] = [];
  for (const f of FURNITURE) {
    if ('none' in f.learn) continue; // 作れない家具（最初から置いてあるだけ）
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

/** ノードが今生きているか（壊れていない）。復活時刻を過ぎていれば生きている扱い。
 *  植えたもの（allNodes が返すもの）は育っている途中でも true（固い。叩けるかは growing を見る）。 */
export function nodeAlive(save: SaveState, node: MapNode, now: number): boolean {
  const state = save.nodes[node.id];
  if (!state || state.destroyedAt == null) return true;
  const def = NODES[node.kind];
  if (def.respawnMs != null && state.destroyedAt + def.respawnMs <= now) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 植えた木・花と、地図の資源をまとめた「いまフィールドにある資源」

/** 植えたものの資源 id（save.nodes のキーにもなる）。 */
export const plantedNodeId = (tileKey: string): string => `p:${tileKey}`;

const staticLiveCache = new WeakMap<World, LiveNode[]>();

function staticLiveNodes(world: World): LiveNode[] {
  let list = staticLiveCache.get(world);
  if (!list) {
    list = world.nodes.map((n) => ({ ...n, planted: false, growing: false, growth: 1 }));
    staticLiveCache.set(world, list);
  }
  return list;
}

/** save.planted の 1 件を資源にする。 */
function plantedLiveNode(world: World, save: SaveState, tileKey: string, now: number): LiveNode | null {
  const p = save.planted[tileKey];
  if (!p) return null;
  const [xs, ys] = tileKey.split(',');
  const x = Number(xs);
  const y = Number(ys);
  const growMs = p.kind === 'tree' ? TREE_GROW_MS : FLOWER_GROW_MS;
  const growth = Math.min(1, Math.max(0, (now - p.plantedAt) / growMs));
  return {
    id: plantedNodeId(tileKey),
    x,
    y,
    kind: p.kind,
    area: world.area[y * world.width + x] ?? 'beach',
    planted: true,
    growing: growth < 1,
    growth,
  };
}

/**
 * 地図の資源（world.nodes。壊れたものも含む。生死は nodeAlive で見る）と、植えた木・花をまとめて返す。
 * 植えたものの id は "p:x,y"。体力・幹の状態は地図の資源と同じく save.nodes[id] に入る。
 */
export function allNodes(world: World, save: SaveState, now: number): LiveNode[] {
  const statics = staticLiveNodes(world);
  const keys = Object.keys(save.planted);
  if (keys.length === 0) return statics;
  const out = statics.slice();
  for (const k of keys) {
    const n = plantedLiveNode(world, save, k, now);
    if (n) out.push(n);
  }
  return out;
}

/** id から資源を引く（地図の資源・植えたもの）。無ければ null。 */
export function liveNodeById(world: World, save: SaveState, id: string, now: number): LiveNode | null {
  if (id.startsWith('p:')) return plantedLiveNode(world, save, id.slice(2), now);
  return staticLiveNodes(world).find((n) => n.id === id) ?? null;
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
 * 家具を置いてよいマスか（家具そのものは見ない）。水・畑・看板・宝箱・設備・飾り・立っている資源・植えたものの上には置けない。
 * 復活しない資源（木・森の木・境界・花）が完全に消えたあとの跡地には置ける。苗木・花の種を植えられるのも同じマス。
 */
export function isBuildable(world: World, save: SaveState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const ground = world.ground[y * world.width + x];
  if (!ground || !BUILDABLE_GROUND.has(ground)) return false;
  if (save.planted[`${x},${y}`]) return false;
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
