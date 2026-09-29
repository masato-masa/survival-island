// 配置（模様替えモードでマスをタップしたときのシート）:
// そのマスの家具をしまう操作と、持っている家具の一覧。家具はどの種類でも、置けるマスなら自由に置ける。

import { FURNITURE_BY_ID } from '@/game/data';
import { canPlaceAt, placementAt } from '@/game/rules';
import type { FurnitureId, SaveState, World } from '@/game/types';

import { Sheet } from './Sheets';

export function PlaceSheet({
  world,
  save,
  x,
  y,
  onPlace,
  onClose,
}: {
  world: World;
  save: SaveState;
  x: number;
  y: number;
  onPlace: (furnitureId: FurnitureId | null) => void;
  onClose: () => void;
}) {
  const anchor = placementAt(save, x, y);
  const placedId = anchor ? save.placements[anchor] ?? null : null;
  const placedDef = placedId ? FURNITURE_BY_ID[placedId] : null;
  const owned = Object.entries(save.furniture).filter(([id, count]) => count > 0 && FURNITURE_BY_ID[id]);

  return (
    <Sheet title="配置" subtitle="このマスに置く家具を選ぶ" onClose={onClose}>
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
        <p className="sheet-text">持っている家具がありません。クラフトで作れます。</p>
      ) : (
        <div className="sheet-list">
          {owned.map(([id, count]) => {
            const def = FURNITURE_BY_ID[id];
            if (!def) return null;
            // 2×2 のランドマークは、このマスを左上にして 4 マス空いているときだけ置ける
            const ok = canPlaceAt(world, save, anchor ? Number(anchor.split(',')[0]) : x, anchor ? Number(anchor.split(',')[1]) : y, id);
            return (
              <button key={id} className="sheet-row" disabled={!ok} onClick={() => onPlace(id)}>
                <span>{def.name}</span>
                <span className="place-owned-count">{ok ? `×${count}` : `×${count}（ここには置けません）`}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
