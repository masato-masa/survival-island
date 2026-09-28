// 表示用の小さな整形関数。ゲームロジックには依存しない。

/** ミリ秒 → "2:31" 形式（スタミナ回復までの残り秒数の表示用）。 */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ミリ秒 → "2分" 形式（作物の成長時間の表示用）。 */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  return `${min}分`;
}
