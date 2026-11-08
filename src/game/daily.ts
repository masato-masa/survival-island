// 毎日のおねがい（SI-13）。日付（dailyDay）から 3 件が決まる。時刻は now を引数で受ける。

import { DAILY_BIG, DAILY_SMALL, DAILY_TITLES, REQUESTS, type DailyTemplate } from './data';
import { hasBuff } from './rules';
import type { DailyState, RequestDef, SaveState } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 日付の切り替えは日本時間の 0 時。 */
const JST_MS = 9 * 60 * 60 * 1000;

export const DAILY_SLOTS = 3;

export function emptyDaily(): DailyState {
  return { day: -1, progress: [0, 0, 0], claimed: [false, false, false], total: 0 };
}

/** now が何日目か（日本時間の日付で数える）。 */
export function dailyDay(now: number): number {
  return Math.floor((now + JST_MS) / DAY_MS);
}

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

/** その日の 3 件（小さいもの 2 つ + 大きいもの 1 つ）。同じ日なら必ず同じ。 */
export function dailyRequests(day: number): RequestDef[] {
  const rnd = mulberry32(day * 2654435761 + 12345);
  const smalls = [...DAILY_SMALL];
  const pick = (list: DailyTemplate[]) => list.splice(Math.floor(rnd() * list.length), 1)[0]!;
  const chosen = [pick(smalls), pick(smalls), pick([...DAILY_BIG])];
  return chosen.map((t, i) => ({ id: `d${day}-${i}`, name: t.name, buffs: t.buffs, items: t.items, goal: t.goal, reward: t.reward, unlockLevel: 1 }));
}

/** 毎日のおねがいが出ているか（固定の 5 件を終えたあと）。 */
export function dailyOpen(save: SaveState): boolean {
  return REQUESTS.every((r) => save.request.done.includes(r.id));
}

/** 日が変わっていたら進みを 0 に戻す（累計は残す）。 */
export function rollDaily(save: SaveState, now: number): DailyState {
  const day = dailyDay(now);
  const d = save.request.daily;
  if (d.day !== day) save.request.daily = { day, progress: [0, 0, 0], claimed: [false, false, false], total: d.total };
  return save.request.daily;
}

/** 画面用: save を変えずに、今日の 3 件とその進みを返す。 */
export function dailyView(save: SaveState, now: number): { def: RequestDef; progress: number; claimed: boolean }[] {
  const day = dailyDay(now);
  const d = save.request.daily;
  const same = d.day === day;
  return dailyRequests(day).map((def, i) => ({ def, progress: same ? d.progress[i] ?? 0 : 0, claimed: same ? !!d.claimed[i] : false }));
}

/** 集めた物を、今日の（かなえていない）おねがいのうち、効き目が全部効いているものへ数える。 */
export function countDaily(save: SaveState, item: string, amount: number, now: number): void {
  if (!dailyOpen(save)) return;
  const d = rollDaily(save, now);
  dailyRequests(d.day).forEach((def, i) => {
    if (d.claimed[i] || !(def.items as string[]).includes(item)) return;
    if (!def.buffs.every((b) => hasBuff(save, b, now))) return;
    d.progress[i] = (d.progress[i] ?? 0) + amount;
  });
}

export function dailyTitle(total: number): { name: string; next: { total: number; name: string } | null } {
  let idx = 0;
  DAILY_TITLES.forEach((t, i) => {
    if (total >= t.total) idx = i;
  });
  return { name: DAILY_TITLES[idx]!.name, next: DAILY_TITLES[idx + 1] ?? null };
}
