// たから探し（SI-28）。島レベル 5 のあと、毎日ちがう場所に「光る地面」が 1 つ出る。探して掘ると、その日の宝が出る。
//   - 場所は日付（日本時間 0 時切替）から決まる。その日の最初に開いているエリアの中から選び、save に覚える（途中で動かない）。
//   - 手がかりは もくひょうに出る（エリア名）。見張り台を建て増すほど、方角・距離まで分かる。
//   - 近づくと地面がきらきら光る（描画は ambient.ts の drawTreasureGlint）。触ると 1 スタミナで掘る。
//   - 宝は作業スタミナ 5〜6 相当（`TREASURES`）。1 日 1 回。暮らしの記録（lifelog.ts）の「たから探し」に数える。
// 時刻は now を引数で受ける。

import { AREAS, TARGET_RADIUS } from './data';
import { dailyDay } from './daily';
import type { GameEvent, ItemId, Result, SaveState, World } from './types';
import { key } from './world';

/** たから探しが出る島レベル。 */
export const TREASURE_LEVEL = 5;

export interface TreasureState {
  day: number;
  x: number;
  y: number;
  found: boolean;
}

export function emptyTreasure(): TreasureState {
  return { day: -1, x: 0, y: 0, found: false };
}

/** 宝の中身（作業スタミナ 5〜6 相当。値打ちは lifelog.test.ts と同じ見積もり）。日付から 1 つ決まる。 */
export const TREASURES: Partial<Record<ItemId, number>>[] = [
  { copper: 2 },
  { stone: 6 },
  { wood: 6 },
  { petal: 10 },
  { sapling: 3 },
  { bigFish: 1 },
  { sunflower: 2 },
  { tomato: 2 },
  { fish: 4 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** その日の宝の中身。 */
export function treasureReward(day: number): Partial<Record<ItemId, number>> {
  const rnd = mulberry32(day * 7919 + 31337);
  rnd();
  return TREASURES[Math.floor(rnd() * TREASURES.length)]!;
}

const blockedCache = new WeakMap<World, Set<string>>();
/** 地図に最初からある物（資源・畑・宝箱・設備・固い飾り・最初の家具）が占めるマス。宝はここに置かない。 */
function staticBlocked(world: World): Set<string> {
  let s = blockedCache.get(world);
  if (s) return s;
  s = new Set<string>();
  for (const n of world.nodes) s.add(key(n.x, n.y));
  for (const p of world.plots) {
    s.add(key(p.sign.x, p.sign.y));
    for (const t of p.tiles) s.add(key(t.x, t.y));
  }
  for (const c of world.chests) s.add(key(c.x, c.y));
  for (const st of world.stations) s.add(key(st.x, st.y));
  for (const d of world.decor) {
    if (!d.solid) continue;
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) s.add(key(x, y));
  }
  for (const f of world.initialFurniture) s.add(key(f.x, f.y));
  blockedCache.set(world, s);
  return s;
}

/** 宝を置ける候補のマス: 島の中（洞窟の外）で、歩けて、地図の物が無く、今開いているエリア。 */
function candidates(world: World, save: SaveState, isOpen: (a: string) => boolean): { x: number; y: number }[] {
  const blocked = staticBlocked(world);
  const island = world.regions[0];
  const yMax = island ? island.y1 : world.height;
  const walkable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.width || y >= yMax) return false;
    const i = y * world.width + x;
    return !!world.area[i] && world.ground[i] !== 'water' && !blocked.has(key(x, y));
  };
  // 開始位置から歩いてたどり着けるマスだけ（木や岩に囲まれた所には置かない）
  const seen = new Set<string>([key(Math.floor(world.start.x), Math.floor(world.start.y))]);
  const queue: [number, number][] = [[Math.floor(world.start.x), Math.floor(world.start.y)]];
  while (queue.length) {
    const [cx, cy] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (seen.has(key(nx, ny)) || !walkable(nx, ny)) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let y = 1; y < yMax - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      const a = world.area[y * world.width + x];
      if (a && seen.has(key(x, y)) && isOpen(a)) out.push({ x, y });
    }
  }
  void save;
  return out;
}

/** 今日の宝の場所を決めて save に覚える（その日の最初の 1 回だけ。同じ日は動かない）。 */
export function rollTreasure(world: World, save: SaveState, now: number, isOpen: (area: string) => boolean): TreasureState {
  const day = dailyDay(now);
  if (save.treasure.day === day) return save.treasure;
  const list = candidates(world, save, isOpen);
  const rnd = mulberry32(day * 2654435761 + 99);
  const pick = list[Math.floor(rnd() * list.length)] ?? { x: world.start.x, y: world.start.y };
  save.treasure = { day, x: pick.x, y: pick.y, found: false };
  return save.treasure;
}

/** 今日の宝（まだ見つけていないものだけ）。無ければ null。save は変えない。 */
export function todaysTreasure(save: SaveState, now: number): TreasureState | null {
  const t = save.treasure;
  return t.day === dailyDay(now) && !t.found ? t : null;
}

/** 宝のマスの中心から体の中心までの距離が TARGET_RADIUS 以内か（target.ts と同じ測り方で呼ぶ）。 */
export function treasureReach(px: number, py: number, t: TreasureState, originUp: number): number {
  const dx = t.x + 0.5 - px;
  const dy = t.y + 0.5 - (py - originUp);
  return Math.sqrt(dx * dx + dy * dy);
}

export { TARGET_RADIUS as TREASURE_RADIUS };

/** 掘る。1 スタミナ。今日の宝のそばで、まだ掘っていないときだけ。 */
export function digTreasure(
  save: SaveState,
  now: number,
  spend: (save: SaveState, n: number, now: number) => boolean,
): Result {
  const t = todaysTreasure(save, now);
  if (!t) return { ok: false, reason: 'notReady', detail: '今日の宝は見つけました' };
  if (!spend(save, 1, now)) return { ok: false, reason: 'noStamina' };
  t.found = true;
  const reward = treasureReward(t.day);
  for (const [item, n] of Object.entries(reward) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) + n;
  const events: GameEvent[] = [{ type: 'treasureFound', items: reward, x: t.x, y: t.y }];
  return { ok: true, events };
}

/** 手がかり（画面用）。エリア名は常に、方角と距離は見張り台の段階で。 */
export function treasureClue(
  world: World,
  save: SaveState,
  now: number,
  compass: (dx: number, dy: number) => string,
): { found: boolean; area: string; dir: string | null; dist: number | null } | null {
  const t = save.treasure;
  if (t.day !== dailyDay(now)) return null;
  const area = world.area[t.y * world.width + t.x];
  const name = area ? AREAS[area].name : '島のどこか';
  const stage = save.tower.stage;
  const dx = t.x - save.player.x;
  const dy = t.y - save.player.y;
  return {
    found: t.found,
    area: name,
    dir: stage >= 1 ? compass(dx, dy) : null,
    dist: stage >= 3 ? Math.round(Math.hypot(dx, dy)) : null,
  };
}
