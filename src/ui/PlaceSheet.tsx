// 配置（模様替えモードでスペースをタップしたときのシート）:
// 現在置いている家具のしまう操作と、同じ属性の持っている家具の一覧。

import { FURNITURE_BY_ID, SLOT_ATTRS } from '@/game/data';
import type { FurnitureId, SaveState, World } from '@/game/types';

import { Sheet } from './Sheets';

export function PlaceSheet({
  world,
  save,
  slotId,
  onPlace,
  onClose,
}: {
  world: World;
  save: SaveState;
  slotId: string;
  onPlace: (furnitureId: FurnitureId | null) => void;
  onClose: () => void;
}) {
  const slot = world.slots.find((s) => s.id === slotId);
  if (!slot) return null;

  const placedId = save.placements[slotId] ?? null;
  const placedDef = placedId ? FURNITURE_BY_ID[placedId] : null;
  const owned = Object.entries(save.furniture).filter(
    ([id, count]) => count > 0 && FURNITURE_BY_ID[id]?.attr === slot.attr,
  );

  return (
    <Sheet title="配置" subtitle={SLOT_ATTRS[slot.attr]} onClose={onClose}>
      {placedDef ? (
        <div className="sheet-row static place-current">
          <span>{placedDef.name}</span>
          <button className="sheet-btn quiet" onClick={() => onPlace(null)}>
            しまう
          </button>
        </div>
      ) : (
        <p className="sheet-text">何も置いていません。</p>
      )}

      {owned.length === 0 ? (
        <p className="sheet-text">この属性の家具を持っていません。クラフトで作れます。</p>
      ) : (
        <div className="sheet-list">
          {owned.map(([id, count]) => {
            const def = FURNITURE_BY_ID[id];
            if (!def) return null;
            return (
              <button key={id} className="sheet-row" onClick={() => onPlace(id)}>
                <span>{def.name}</span>
                <span className="place-owned-count">×{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
