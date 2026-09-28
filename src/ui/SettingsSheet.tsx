// 設定: 効果音・振動の入切だけ。

import { Sheet } from './Sheets';

export function SettingsSheet({
  soundOn,
  hapticsOn,
  onToggleSound,
  onToggleHaptics,
  onClose,
}: {
  soundOn: boolean;
  hapticsOn: boolean;
  onToggleSound: () => void;
  onToggleHaptics: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="設定" onClose={onClose}>
      <div className="sheet-row static">
        <span>効果音</span>
        <button className="switch" role="switch" aria-checked={soundOn} aria-label="効果音" onClick={onToggleSound} />
      </div>
      <div className="sheet-row static">
        <span>振動</span>
        <button className="switch" role="switch" aria-checked={hapticsOn} aria-label="振動" onClick={onToggleHaptics} />
      </div>
    </Sheet>
  );
}
