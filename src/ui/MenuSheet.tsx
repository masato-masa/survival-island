// 左上の顔アイコンから開くメニュー（ピグライフ風の一覧）。「あそびかた」と「設定」。
// 顔の下に落ちるポップオーバー。外側をタップすると閉じる（見えない幕が全面を受ける）。

import { useEffect } from 'react';
import { HelpIcon, SettingsIcon } from './icons';

export function MenuPopover({
  onClose,
  onHelp,
  onSettings,
}: {
  onClose: () => void;
  onHelp: () => void;
  onSettings: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="menu-scrim hud-clickable" onPointerDown={onClose} />
      <div className="menu-pop hud-clickable" role="menu">
        <button className="menu-row" role="menuitem" onClick={onHelp}>
          <span className="menu-row-icon">
            <HelpIcon />
          </span>
          <span className="menu-row-label">あそびかた</span>
        </button>
        <button className="menu-row" role="menuitem" onClick={onSettings}>
          <span className="menu-row-icon">
            <SettingsIcon />
          </span>
          <span className="menu-row-label">設定</span>
        </button>
      </div>
    </>
  );
}
