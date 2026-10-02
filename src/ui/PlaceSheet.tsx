// 配置（模様替えモードでマスをタップしたときのシート）:
// そのマスの家具をしまう操作と、持っている家具の一覧。家具はどの種類でも、置けるマスなら自由に置ける。
// 下に「植える」（苗木・花の種）も並べる。

import { FURNITURE_BY_ID, ITEMS } from '@/game/data';
import { canPlantAt } from '@/game/actions';
import { canPlaceAt, placementAt } from '@/game/rules';
import type { FurnitureId, SaveState, World } from '@/game/types';

import { Sheet } from './Sheets';

const PLANT_ITEMS = [
  { item: 'sapling', grows: '木' },
  { item: 'flowerSeed', grows: '花' },
] as const;

export function PlaceSheet({
  world,
  save,
  x,
  y,
  onPlace,
  onPlant,
  onClose,
}: {
  world: World;
  save: SaveState;
  x: number;
  y: number;
  onPlace: (furnitureId: FurnitureId | null) => void;
  onPlant: (item: 'sapling' | 'flowerSeed') => void;
  onClose: () => void;
}) {
  const anchor = placementAt(save, x, y);
  const placedId = anchor ? save.placements[anchor] ?? null : null;
  const placedDef = placedId ? FURNITURE_BY_ID[placedId] : null;
  const owned = Object.entries(save.furniture).filter(([id, count]) => count > 0 && FURNITURE_BY_ID[id]);
  const playerTile = { x: Math.floor(save.player.x), y: Math.floor(save.player.y) };
  const plantable = canPlantAt(world, save, x, y, playerTile);

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

      <p className="sheet-subtitle">植える</p>
      {!plantable ? (
        <p className="sheet-text">
          {placedDef ? 'このマスには家具があるので植えられません。' : 'このマスには植えられません。'}
        </p>
      ) : null}
      <div className="sheet-list">
        {PLANT_ITEMS.map(({ item, grows }) => {
          const count = save.inventory[item] ?? 0;
          return (
            <div key={item} className="sheet-row static">
              <span>
                {ITEMS[item].name}（{grows}になる）×{count}
              </span>
              <button className="sheet-btn quiet" disabled={!plantable || count < 1} onClick={() => onPlant(item)}>
                植える
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
