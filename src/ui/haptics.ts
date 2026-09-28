// 振動。navigator.vibrate を使う。対応していない環境・設定で切ってあるときは
// 黙って何もしない（例外を投げない）。city-builders と同じ方針。

import { isHapticsEnabled } from './settings';

function vibrate(pattern: number | number[]): void {
  if (!isHapticsEnabled()) return;
  try {
    if (typeof navigator === 'undefined') return;
    if (typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern);
  } catch {
    // 対応していない・拒否された場合も黙って続行
  }
}

/** 叩く（伐採・採掘）: ごく短い 1 回 */
export function hapticHit(): void {
  vibrate(10);
}

/** 植える・タップ全般: さらに軽い 1 回 */
export function hapticTap(): void {
  vibrate(8);
}

/** 収穫: 軽い 2 連 */
export function hapticHarvest(): void {
  vibrate([12, 30, 12]);
}

/** クラフト: 少し長い 2 連 */
export function hapticCraft(): void {
  vibrate([16, 40, 20]);
}

/** 配置: 短く重い 1 回 */
export function hapticPlace(): void {
  vibrate(18);
}

/** 島レベルアップ・境界の開放: 弾むような 3 連 */
export function hapticLevelUp(): void {
  vibrate([16, 55, 16, 55, 36]);
}

/** 失敗: ごく短い 2 連 */
export function hapticFail(): void {
  vibrate([8, 30, 8]);
}
