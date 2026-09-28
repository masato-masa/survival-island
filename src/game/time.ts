// 時間まわりの計算。スタミナの現在値・正規化、作物の成長、資源の復活。
// now は必ず引数で受け取る。ここで Date.now() を呼ばない。

import { CROPS, NODES, STAMINA_REGEN_MS } from './data';
import { staminaMax } from './rules';
import type { CropTile, SaveState, World } from './types';

export interface StaminaInfo {
  value: number;
  max: number;
  /** 次の 1 回復までの残りミリ秒。上限に達しているときは 0。 */
  nextInMs: number;
}

/** 現在のスタミナを計算する（save は変更しない）。 */
export function currentStamina(save: SaveState, now: number): StaminaInfo {
  const max = staminaMax(save);
  const elapsed = Math.max(0, now - save.stamina.updatedAt);
  const gained = Math.floor(elapsed / STAMINA_REGEN_MS);
  const value = Math.min(max, save.stamina.value + gained);
  const nextInMs = value >= max ? 0 : STAMINA_REGEN_MS - (elapsed % STAMINA_REGEN_MS);
  return { value, max, nextInMs };
}

/**
 * save.stamina を現在値に正規化する（消費する前に必ず呼ぶ）。
 * updatedAt は回復に使った分だけ進める。上限に達していたら now にする。
 */
export function normalizeStamina(save: SaveState, now: number): void {
  const max = staminaMax(save);
  const elapsed = now - save.stamina.updatedAt;
  const gained = Math.floor(elapsed / STAMINA_REGEN_MS);
  if (gained <= 0) return;
  const value = Math.min(max, save.stamina.value + gained);
  if (value >= max) {
    save.stamina.value = max;
    save.stamina.updatedAt = now;
  } else {
    save.stamina.value = value;
    save.stamina.updatedAt = save.stamina.updatedAt + gained * STAMINA_REGEN_MS;
  }
}

/** 作物の成長割合（0〜1）。 */
export function cropProgress(tile: CropTile, now: number): number {
  const def = CROPS[tile.crop];
  const ratio = (now - tile.plantedAt) / def.growMs;
  return Math.min(1, Math.max(0, ratio));
}

/** 収穫できるか。 */
export function isReady(tile: CropTile, now: number): boolean {
  return now >= tile.plantedAt + CROPS[tile.crop].growMs;
}

/**
 * 壊れた資源のうち復活時刻を過ぎたものを元に戻す（save.nodes から消す）。
 * プレイヤーが立っているマスは戻さない。境界（respawnMs null）は対象外。
 */
export function applyRespawns(
  world: World,
  save: SaveState,
  now: number,
  playerTile?: { x: number; y: number },
): void {
  for (const id of Object.keys(save.nodes)) {
    const state = save.nodes[id];
    if (!state || state.destroyedAt == null) continue;
    const node = world.nodes.find((n) => n.id === id);
    if (!node) continue;
    const def = NODES[node.kind];
    if (def.respawnMs == null) continue;
    if (state.destroyedAt + def.respawnMs > now) continue;
    if (playerTile && playerTile.x === node.x && playerTile.y === node.y) continue;
    delete save.nodes[id];
  }
}
