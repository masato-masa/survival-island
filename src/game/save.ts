// 新規セーブ、localStorage の読み書き、形式の補正。
// localStorage に触るのはこのファイルだけ（try/catch で必ず守る）。

import { SKILLS, STAMINA_BASE } from './data';
import { isBuildable, placementAt } from './rules';
import { getWorld } from './world';
import type { SaveState, SkillId, World } from './types';

export const SAVE_KEY = 'survival-island:save:v1';

function emptySkills(): Record<SkillId, number> {
  const skills = {} as Record<SkillId, number>;
  for (const id of Object.keys(SKILLS) as SkillId[]) skills[id] = 0;
  return skills;
}

/**
 * 島に最初からある家具（作業台・古い柱・たき火・遺跡のアーチ）を placements に入れる。
 * 置けないマス・もう何かがあるマス・プレイヤーが立っているマスは飛ばす。seededV2 を立てる。
 */
export function seedInitialFurniture(world: World, save: SaveState): void {
  const px = Math.floor(save.player.x);
  const py = Math.floor(save.player.y);
  for (const f of world.initialFurniture) {
    if (f.x === px && f.y === py) continue;
    if (!isBuildable(world, save, f.x, f.y) || placementAt(save, f.x, f.y)) continue;
    save.placements[`${f.x},${f.y}`] = f.furniture;
  }
  save.seededV2 = true;
}

export function newSave(world: World, now: number): SaveState {
  const save = newSaveBare(world, now);
  seedInitialFurniture(world, save);
  return save;
}

function newSaveBare(world: World, now: number): SaveState {
  return {
    version: 1,
    player: { x: world.start.x + 0.5, y: world.start.y + 0.5, dir: 'down' },
    stamina: { value: STAMINA_BASE, updatedAt: now },
    xp: 0,
    totalXp: 0,
    skills: emptySkills(),
    inventory: {},
    furniture: {},
    learnedRecipes: [],
    nodes: {},
    plots: {},
    placements: {},
    maxPoints: 0,
    chestsOpened: [],
    seenIntro: false,
    buffs: [],
    planted: {},
    seededV2: false,
    crafting: null,
  };
}

/** 欠けたフィールドを既定値で埋める。形式が増えても壊れないようにする。
 *  古いセーブ（seededV2 が無い）には、最初からある家具を一度だけ入れる。 */
export function migrate(raw: unknown, world: World = getWorld()): SaveState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SaveState>;
  const player = r.player ?? { x: 0, y: 0, dir: 'down' };
  const stamina = r.stamina ?? { value: STAMINA_BASE, updatedAt: 0 };
  const skills = { ...emptySkills(), ...(r.skills ?? {}) };
  const save: SaveState = {
    version: 1,
    player: { x: player.x ?? 0, y: player.y ?? 0, dir: player.dir ?? 'down' },
    stamina: { value: stamina.value ?? STAMINA_BASE, updatedAt: stamina.updatedAt ?? 0 },
    xp: r.xp ?? 0,
    totalXp: r.totalXp ?? 0,
    skills,
    inventory: r.inventory ?? {},
    furniture: r.furniture ?? {},
    learnedRecipes: r.learnedRecipes ?? [],
    nodes: r.nodes ?? {},
    plots: r.plots ?? {},
    placements: r.placements ?? {},
    maxPoints: r.maxPoints ?? 0,
    chestsOpened: r.chestsOpened ?? [],
    seenIntro: r.seenIntro ?? false,
    buffs: r.buffs ?? [],
    planted: r.planted ?? {},
    seededV2: r.seededV2 ?? false,
    crafting: r.crafting ?? null,
  };
  if (!save.seededV2) seedInitialFurniture(world, save);
  return save;
}

export function loadSave(world: World, now: number): SaveState {
  try {
    if (typeof localStorage === 'undefined') return newSave(world, now);
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newSave(world, now);
    return migrate(JSON.parse(raw), world);
  } catch {
    return newSave(world, now);
  }
}

export function writeSave(save: SaveState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // 保存できなくてもゲームは続行する
  }
}

export function clearSave(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // 無視する
  }
}
