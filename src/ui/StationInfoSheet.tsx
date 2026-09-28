// 設備の説明シート。家の跡地・船着き場など、まだ機能を持たない設備に触れたときに
// 「これは何か」だけ短く伝える（M2 で機能がつく前提の仮の中身）。

import { STATIONS } from '@/game/data';
import type { StationKind } from '@/game/types';

import { Sheet } from './Sheets';

export function StationInfoSheet({ kind, onClose }: { kind: StationKind; onClose: () => void }) {
  const def = STATIONS[kind];
  return (
    <Sheet title={def.name} onClose={onClose}>
      <p className="help-list">{def.hint}</p>
    </Sheet>
  );
}
