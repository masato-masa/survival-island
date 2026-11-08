// 商船の修理（SI-14）。素材を納めて 1 段階ずつ直し、毎日 1 回お届けを受け取る。時刻は now を引数で受ける。

import { ITEMS, SHIP_STAGES } from './data';
import { dailyDay } from './daily';
import { islandLevel } from './rules';
import type { GameEvent, ItemId, Result, SaveState, ShipStageDef } from './types';

export const SHIP_FULL = SHIP_STAGES.length;

/** 次に直す段階。全部直していれば null。 */
export function nextShipStage(save: SaveState): ShipStageDef | null {
  return SHIP_STAGES[save.ship.stage] ?? null;
}

/** 直した段階ぶんの、毎日のお届け（合計）。 */
export function shipGift(save: SaveState): Partial<Record<ItemId, number>> {
  const gift: Partial<Record<ItemId, number>> = {};
  for (const st of SHIP_STAGES.slice(0, save.ship.stage)) {
    for (const [item, n] of Object.entries(st.gift) as [ItemId, number][]) gift[item] = (gift[item] ?? 0) + n;
  }
  return gift;
}

/** 今日のお届けをまだ受け取っていないか（1 段階でも直していて、今日の分が未受け取り）。 */
export function shipGiftReady(save: SaveState, now: number): boolean {
  return save.ship.stage > 0 && save.ship.giftDay !== dailyDay(now);
}

/** 次の段階を直す。素材が足りなければ 'notEnoughItems'、島レベル不足は 'levelCap'、全部直していれば 'maxLevel'。 */
export function repairShip(save: SaveState): Result {
  const st = nextShipStage(save);
  if (!st) return { ok: false, reason: 'maxLevel' };
  if (islandLevel(save) < st.unlockLevel) return { ok: false, reason: 'levelCap', detail: `島レベル ${st.unlockLevel} で取りかかれます` };
  for (const [item, n] of Object.entries(st.cost) as [ItemId, number][]) {
    if ((save.inventory[item] ?? 0) < n) return { ok: false, reason: 'notEnoughItems', detail: `${ITEMS[item].name}が足りません` };
  }
  for (const [item, n] of Object.entries(st.cost) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) - n;
  save.ship.stage += 1;
  return { ok: true, events: [{ type: 'shipRepaired', stage: save.ship.stage }] };
}

/** 今日のお届けを受け取る（1 日 1 回）。お届けは「集めた」には数えない（おねがいの進みにならない）。 */
export function claimShipGift(save: SaveState, now: number): Result {
  if (save.ship.stage === 0) return { ok: false, reason: 'notReady', detail: 'まだ船が直っていません' };
  if (!shipGiftReady(save, now)) return { ok: false, reason: 'notReady', detail: '今日の分は受け取りました' };
  const gift = shipGift(save);
  for (const [item, n] of Object.entries(gift) as [ItemId, number][]) save.inventory[item] = (save.inventory[item] ?? 0) + n;
  save.ship.giftDay = dailyDay(now);
  const events: GameEvent[] = [{ type: 'shipGift', items: gift }];
  return { ok: true, events };
}
