// もちもの: 素材・作物の数と、置いていない家具の数を見せるだけの画面。

import { FURNITURE_BY_ID, ITEMS } from '@/game/data';
import type { SaveState } from '@/game/types';
import { spriteDataUrl, type SpriteName } from '@/render/sprites';

import { Sheet } from './Sheets';

const MATERIAL_IDS = ['wood', 'stone', 'copper'] as const;
const CROP_IDS = ['turnip', 'sunflower', 'tomato'] as const;

export function InventorySheet({ save, onClose }: { save: SaveState; onClose: () => void }) {
  const furnitureOwned = Object.entries(save.furniture).filter(([, count]) => count > 0);

  return (
    <Sheet title="もちもの" onClose={onClose}>
      <div className="sheet-list">
        <p className="sheet-subtitle">素材</p>
        <div className="icon-grid">
          {MATERIAL_IDS.map((id) => (
            <div className="icon-cell" key={id}>
              <img src={spriteDataUrl(`item_${id}`)} alt="" />
              <span>{ITEMS[id].name}</span>
              <span className="icon-cell-count">{save.inventory[id] ?? 0}</span>
            </div>
          ))}
        </div>

        <p className="sheet-subtitle">作物</p>
        <div className="icon-grid">
          {CROP_IDS.map((id) => (
            <div className="icon-cell" key={id}>
              <img src={spriteDataUrl(`item_${id}`)} alt="" />
              <span>{ITEMS[id].name}</span>
              <span className="icon-cell-count">{save.inventory[id] ?? 0}</span>
            </div>
          ))}
        </div>

        <p className="sheet-subtitle">家具</p>
        {furnitureOwned.length === 0 ? (
          <p className="sheet-text">持っている家具はありません。クラフトで作れます。</p>
        ) : (
          <div className="icon-grid">
            {furnitureOwned.map(([id, count]) => {
              const def = FURNITURE_BY_ID[id];
              return (
                <div className="icon-cell" key={id}>
                  {/* f_<furnitureId> は data.ts の FURNITURE と 1 対 1 で対応している契約。
                      FurnitureId は型上ただの string なのでここだけキャストする。 */}
                  <img src={spriteDataUrl(`f_${id}` as SpriteName)} alt="" />
                  <span>{def?.name ?? id}</span>
                  <span className="icon-cell-count">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
