// 実行時の状態（セーブ＋時計）。React と Canvas の両方がこれを購読する。
// ここだけが Date.now() を直接呼んでよい（now()）。

import { ISLAND_LEVEL_POINTS, NODES, WALK_SPEED } from './data';
import * as Actions from './actions';
import { islandLevel as islandLevelOf, cooldownMs, staminaMax } from './rules';
import { applyRespawns, currentStamina } from './time';
import { islandPoints } from './score';
import { findTarget, tryMove } from './target';
import { clearSave, loadSave, newSave, writeSave } from './save';
import { getWorld } from './world';
import type { CropId, Fail, FurnitureId, GameEvent, Result, SaveState, SkillId, Target, World } from './types';

const DEV_OFFSET_KEY = 'survival-island:devOffset';

export interface GameStore {
  readonly world: World;
  get(): SaveState;
  now(): number;
  version(): number;
  subscribe(fn: () => void): () => void;
  onEvents(fn: (events: GameEvent[]) => void): () => void;
  onFail(fn: (reason: Fail, detail?: string) => void): () => void;
  move(dx: number, dy: number, dtSec: number): void;
  target(): (Target & { blocked?: Fail }) | null;
  tick(): void;
  actOnTarget(): Result;
  chooseCrop(plotId: string, crop: CropId | null): Result;
  buySkill(id: SkillId): Result;
  craft(id: FurnitureId): Result;
  place(x: number, y: number, furnitureId: FurnitureId | null): Result;
  markIntroSeen(): void;
  stamina(): { value: number; max: number; nextInMs: number };
  islandLevel(): number;
  points(): { total: number; base: number; bonus: number };
  cooldownUntil(): number;
  lastAction(): { at: number; x: number; y: number; kind: 'hit' | 'farm' | 'other' } | null;
  dev: {
    refillStamina(): void;
    addXp(n: number): void;
    addItems(n: number): void;
    advance(ms: number): void;
    bumpIslandLevel(): void;
    reset(): void;
  };
}

export interface CreateStoreOptions {
  storage?: boolean;
  clock?: () => number;
}

export function createStore(opts: CreateStoreOptions = {}): GameStore {
  const storageEnabled = opts.storage !== false;
  const world = getWorld();

  let devOffset = 0;
  if (storageEnabled && !opts.clock) {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(DEV_OFFSET_KEY);
        if (raw) devOffset = Number(raw) || 0;
      }
    } catch {
      devOffset = 0;
    }
  }

  const now = (): number => (opts.clock ? opts.clock() : Date.now() + devOffset);

  const persistDevOffset = (): void => {
    if (!storageEnabled || opts.clock) return;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DEV_OFFSET_KEY, String(devOffset));
    } catch {
      // 無視する
    }
  };

  let save: SaveState = storageEnabled ? loadSave(world, now()) : newSave(world, now());

  let ver = 0;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(events: GameEvent[]) => void>();
  const failListeners = new Set<(reason: Fail, detail?: string) => void>();

  let nextActionAt = 0;
  let lastActionInfo: { at: number; x: number; y: number; kind: 'hit' | 'farm' | 'other' } | null = null;
  let lastPositionSaveAt = now();
  let lastStaminaValue = currentStamina(save, now()).value;

  const persist = (): void => {
    if (!storageEnabled) return;
    writeSave(save);
  };

  const notify = (): void => {
    ver++;
    for (const fn of listeners) fn();
  };

  const fail = (reason: Fail, detail?: string): Result => {
    for (const fn of failListeners) fn(reason, detail);
    return { ok: false, reason, detail };
  };

  const runAction = (result: Result): Result => {
    if (result.ok) {
      persist();
      notify();
      for (const fn of eventListeners) fn(result.events);
    } else {
      for (const fn of failListeners) fn(result.reason, result.detail);
    }
    return result;
  };

  if (storageEnabled && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      writeSave(save);
    });
  }

  const store: GameStore = {
    world,

    get: () => save,

    now,

    version: () => ver,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    onEvents(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },

    onFail(fn) {
      failListeners.add(fn);
      return () => failListeners.delete(fn);
    },

    move(dx, dy, dtSec) {
      const mag = Math.hypot(dx, dy);
      if (mag > 0.1) {
        save.player.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
      if (mag > 0) {
        const t = now();
        const stepX = dx * WALK_SPEED * dtSec;
        const stepY = dy * WALK_SPEED * dtSec;
        const moved = tryMove(world, save, t, save.player.x, save.player.y, stepX, stepY);
        save.player.x = moved.x;
        save.player.y = moved.y;
      }
      const t = now();
      if (t - lastPositionSaveAt > 5000) {
        lastPositionSaveAt = t;
        persist();
      }
    },

    target() {
      return findTarget(world, save, save.player.x, save.player.y, save.player.dir, now());
    },

    tick() {
      const t = now();
      const beforeNodes = Object.keys(save.nodes).length;
      const playerTile = { x: Math.floor(save.player.x), y: Math.floor(save.player.y) };
      applyRespawns(world, save, t, playerTile);
      const afterNodes = Object.keys(save.nodes).length;
      const stam = currentStamina(save, t);
      const changed = beforeNodes !== afterNodes || stam.value !== lastStaminaValue;
      lastStaminaValue = stam.value;
      if (changed) notify();
    },

    actOnTarget() {
      const t = now();
      const tgt = findTarget(world, save, save.player.x, save.player.y, save.player.dir, t);
      if (!tgt) return fail('notReady');
      if (tgt.blocked) return fail(tgt.blocked);

      // 看板・設備は画面を開くだけ。開くのは UI 側（target().kind を見て判断する）。
      if (tgt.kind === 'sign' || tgt.kind === 'station') return { ok: true, events: [] };

      if (tgt.kind === 'chest') {
        const result = Actions.openChest(world, save, tgt.chest);
        if (result.ok) lastActionInfo = { at: t, x: tgt.x, y: tgt.y, kind: 'other' };
        return runAction(result);
      }

      if (tgt.kind === 'node') {
        if (t < nextActionAt) return fail('cooldown');
        const tool = NODES[tgt.node.kind].tool;
        const result = Actions.hitNode(world, save, tgt.node, t);
        if (result.ok) {
          nextActionAt = t + cooldownMs(save, tool);
          lastActionInfo = { at: t, x: tgt.x, y: tgt.y, kind: 'hit' };
        }
        return runAction(result);
      }

      // farm
      if (t < nextActionAt) return fail('cooldown');
      const result = Actions.farmAction(world, save, tgt.plot, tgt.x, tgt.y, t);
      if (result.ok) {
        nextActionAt = t + cooldownMs(save, 'farm');
        lastActionInfo = { at: t, x: tgt.x, y: tgt.y, kind: 'farm' };
      }
      return runAction(result);
    },

    chooseCrop(plotId, crop) {
      return runAction(Actions.chooseCrop(save, plotId, crop));
    },

    buySkill(id) {
      return runAction(Actions.buySkill(save, id));
    },

    craft(id) {
      return runAction(Actions.craft(save, id, now()));
    },

    place(x, y, furnitureId) {
      return runAction(Actions.place(world, save, x, y, furnitureId));
    },

    markIntroSeen() {
      save.seenIntro = true;
      persist();
      notify();
    },

    stamina() {
      return currentStamina(save, now());
    },

    islandLevel() {
      return islandLevelOf(save);
    },

    points() {
      const { total, base, bonus } = islandPoints(world, save);
      return { total, base, bonus };
    },

    cooldownUntil: () => nextActionAt,

    lastAction: () => lastActionInfo,

    dev: {
      refillStamina() {
        save.stamina.value = staminaMax(save);
        save.stamina.updatedAt = now();
        persist();
        notify();
      },
      addXp(n) {
        save.xp += n;
        save.totalXp += n;
        persist();
        notify();
      },
      addItems(n) {
        for (const item of ['wood', 'stone', 'copper', 'turnip', 'sunflower', 'tomato'] as const) {
          save.inventory[item] = (save.inventory[item] ?? 0) + n;
        }
        persist();
        notify();
      },
      advance(ms) {
        devOffset += ms;
        persistDevOffset();
        notify();
      },
      bumpIslandLevel() {
        const level = islandLevelOf(save);
        const next = ISLAND_LEVEL_POINTS[level];
        if (next != null && next > save.maxPoints) save.maxPoints = next;
        persist();
        notify();
      },
      reset() {
        if (storageEnabled) clearSave();
        save = newSave(world, now());
        nextActionAt = 0;
        lastActionInfo = null;
        lastStaminaValue = currentStamina(save, now()).value;
        persist();
        notify();
      },
    },
  };

  return store;
}

export const store: GameStore = createStore();
