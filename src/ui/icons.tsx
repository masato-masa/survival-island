// このゲーム専用のアイコン。shared-ui のものではないので、ここに直接置く。
// すべて 24x24 の枠に stroke="currentColor" で描く（塗りは使わない）。

/** 右上「?」。あそびかたを開く。 */
export function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 9 a2.5 2.5 0 1 1 3.6 2.24 C12 12 12 12.6 12 13.6" />
      <circle cx="12" cy="17.4" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6 v2.6 M12 18.8 v2.6 M21.4 12 h-2.6 M5.2 12 H2.6 M18.7 5.3 l-1.84 1.84 M7.14 16.86 l-1.84 1.84 M18.7 18.7 l-1.84-1.84 M7.14 7.14 L5.3 5.3" />
    </svg>
  );
}

/** 右辺「もちもの」。荷物袋。 */
export function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8 h12 l1 12 a2 2 0 0 1 -2 2 H7 a2 2 0 0 1 -2 -2 Z" />
      <path d="M9 8 V6 a3 3 0 0 1 6 0 v2" />
    </svg>
  );
}

/** 右辺「もくひょう」。旗。 */
export function GoalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3 v18" />
      <path d="M6 4 h12 l-3 3.5 L18 11 H6" />
    </svg>
  );
}

/** 右辺「模様替え」。塗りローラー。 */
export function BrushIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="12" height="5" rx="1.2" />
      <path d="M8 9 v4 h4" />
      <path d="M12 13 h3 a2 2 0 0 1 2 2 v4" />
      <circle cx="17" cy="19.2" r="1.4" />
    </svg>
  );
}
