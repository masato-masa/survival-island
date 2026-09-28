// 看板: この畑で育てる作物を選ぶ。「なし」も選べる。

import { CROPS } from '@/game/data';
import { knownCrops } from '@/game/rules';
import type { CropId, SaveState } from '@/game/types';

import { formatDuration } from './format';
import { Sheet } from './Sheets';

export function SignSheet({
  save,
  plotId,
  onChoose,
  onClose,
}: {
  save: SaveState;
  plotId: string;
  onChoose: (crop: CropId | null) => void;
  onClose: () => void;
}) {
  const crops = knownCrops(save);
  const current = save.plots[plotId]?.selected ?? null;

  return (
    <Sheet title="看板" onClose={onClose}>
      <p className="sheet-text">育てている途中のものは、次に植えるときから変わります。</p>
      <div className="sheet-list">
        <button className={`sheet-row${current === null ? ' is-selected' : ''}`} onClick={() => onChoose(null)}>
          <span>なし</span>
        </button>
        {crops.map((id) => {
          const def = CROPS[id];
          return (
            <button key={id} className={`sheet-row${current === id ? ' is-selected' : ''}`} onClick={() => onChoose(id)}>
              <span>{def.name}</span>
              <span className="sign-grow-time">{formatDuration(def.growMs)}で収穫</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
