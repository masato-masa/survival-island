// 実行時の状態（セーブ＋時計）。React と Canvas の両方がこれを購読する。
// ここだけが Date.now() を直接呼んでよい（now()）。

import { ISLAND_LEVEL_POINTS, NODES, WALK_SPEED } from './data';
import * as Actions from './actions';
import { actionMs, islandLevel as islandLevelOf, liveNodeById, needSkillDetail, staminaMax } from './rules';
import { applyRespawns, currentStamina } from './time';
import { islandPoints } from './score';
import { findTarget, tryMove } from './target';
import { clearSave, loadSave, newSave, writeSave } from './save';
import { getWorld } from './world';
import type {
  CraftJob,
  CropId,
  Fail,
  FurnitureId,
  GameEvent,
  Result,
  SaveState,
  SkillId,
  Target,
  TimedAction,
  World,
} from './types';

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
  /**
   * 目の前の対象に行動する。伐採・採取・畑は約 3 秒かかる行動を「始める」だけ（結果は update() が出す）。
   * 宝箱はその場で開く。看板・設備・作業台は ok を返すだけ（画面を開くのは UI 側）。
   * 行動中は 'cooldown' で失敗する。
   */
  actOnTarget(): Result;
  /** 今やっている時間のかかる行動。無ければ null。行動中はプレイヤーが動けない。 */
  currentAction(): TimedAction | null;
  /** 毎フレーム呼ぶ。行動の終わる時刻を過ぎていたら結果を出す（保存・イベント）。 */
  update(): void;
  /** 苗木・花の種を (x, y) に植える。 */
  plant(x: number, y: number, item: 'sapling' | 'flowerSeed'): Result;
  chooseCrop(plotId: string, crop: CropId | null): Result;
  buySkill(id: SkillId): Result;
  /** 作業台のクラフトを始める（素材・スタミナはここで払う）。作業中は 'busy'。 */
  craft(id: FurnitureId): Result;
  /** 作業中（または受け取り待ち）のクラフト。無ければ null。endsAt <= now() なら完成。 */
  craftJob(): CraftJob | null;
  /** 完成したクラフトを受け取って持ち物に入れる。まだなら 'notReady'。 */
  collectCraft(): Result;
  place(x: number, y: number, furnitureId: FurnitureId | null): Result;
  markIntroSeen(): void;
  stamina(): { value: number; max: number; nextInMs: number };
  islandLevel(): number;
  points(): { total: number; base: number; bonus: number };
  /** 今の行動が終わる時刻（行動していなければ 0）。 */
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

  /** 時間のかかる行動と、終わったときに結果を出す関数。 */
  let pending: { action: TimedAction; resolve: (t: number) => Result } | null = null;
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

  const startAction = (action: TimedAction, resolve: (t: number) => Result): Result => {
    pending = { action, resolve };
    const events: GameEvent[] = [{ type: 'actionStarted', action }];
    notify();
    for (const fn of eventListeners) fn(events);
    return { ok: true, events };
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
      if (pending) return; // 作業中は動けない
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
      if (pending) return fail('cooldown');
      const t = now();
      const tgt = findTarget(world, save, save.player.x, save.player.y, save.player.dir, t);
      if (!tgt) return fail('notReady');
      if (tgt.blocked) return fail(tgt.blocked, tgt.kind === 'node' ? needSkillDetail(tgt.node) : undefined);

      // 看板・設備・作業台は画面を開くだけ。開くのは UI 側（target().kind を見て判断する）。
      if (tgt.kind === 'sign' || tgt.kind === 'station' || tgt.kind === 'furniture') return { ok: true, events: [] };

      if (tgt.kind === 'chest') {
        const result = Actions.openChest(world, save, tgt.chest);
        if (result.ok) lastActionInfo = { at: t, x: tgt.x, y: tgt.y, kind: 'other' };
        return runAction(result);
      }

      // 3 秒振って空振り、にならないよう、スタミナは始める前に見る
      if (currentStamina(save, t).value < 1) return fail('noStamina');

      if (tgt.kind === 'node') {
        const node = tgt.node;
        const tool = NODES[node.kind].tool;
        const action: TimedAction = {
          kind: tool === 'gather' ? 'gather' : 'chop',
          x: node.x,
          y: node.y,
          nodeId: node.id,
          nodeKind: node.kind,
          startedAt: t,
          endsAt: t + actionMs(save, tool),
        };
        return startAction(action, (tt) => {
          const live = liveNodeById(world, save, node.id, tt);
          if (!live) return { ok: false, reason: 'notReady' };
          return Actions.workNode(world, save, live, tt);
        });
      }

      // farm
      const blocked = Actions.checkFarm(save, tgt.plot, tgt.x, tgt.y, t);
      if (blocked) return fail(blocked);
      const plot = tgt.plot;
      const action: TimedAction = { kind: 'farm', x: tgt.x, y: tgt.y, startedAt: t, endsAt: t + actionMs(save, 'farm') };
      return startAction(action, (tt) => Actions.farmAction(world, save, plot, action.x, action.y, tt));
    },

    currentAction: () => pending?.action ?? null,

    update() {
      if (!pending) return;
      const t = now();
      if (t < pending.action.endsAt) return;
      const { action, resolve } = pending;
      pending = null;
      const result = resolve(t);
      if (result.ok) lastActionInfo = { at: t, x: action.x, y: action.y, kind: action.kind === 'farm' ? 'farm' : 'hit' };
      else notify(); // 失敗でも「行動中」が終わったことは知らせる
      runAction(result);
    },

    plant(x, y, item) {
      const playerTile = { x: Math.floor(save.player.x), y: Math.floor(save.player.y) };
      return runAction(Actions.plant(world, save, x, y, item, now(), playerTile));
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

    craftJob: () => save.crafting,

    collectCraft() {
      return runAction(Actions.collectCraft(save, now()));
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

    cooldownUntil: () => pending?.action.endsAt ?? 0,

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
        for (const item of ['wood', 'stone', 'copper', 'sapling', 'flowerSeed', 'petal', 'turnip', 'sunflower', 'tomato'] as const) {
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
        pending = null;
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
