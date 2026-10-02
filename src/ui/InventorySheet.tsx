// もちもの: 素材・植物・作物の数と、置いていない家具の数を見せるだけの画面。

import { FURNITURE_BY_ID, ITEMS } from '@/game/data';
import type { SaveState } from '@/game/types';
import { spriteDataUrl, type SpriteName } from '@/render/sprites';

import { Sheet } from './Sheets';

const MATERIAL_IDS = ['wood', 'stone', 'copper'] as const;
const PLANT_IDS = ['sapling', 'flowerSeed', 'petal'] as const;
const CROP_IDS = ['turnip', 'sunflower', 'tomato'] as const;

type ItemList = readonly (keyof typeof ITEMS)[];

function ItemGrid({ ids, save }: { ids: ItemList; save: SaveState }) {
  return (
    <div className="icon-grid">
      {ids.map((id) => (
        <div className="icon-cell" key={id}>
          {/* item_<ItemId> は sprites.ts の SpriteName と 1 対 1 で対応している契約 */}
          <img src={spriteDataUrl(`item_${id}` as SpriteName)} alt="" />
          <span>{ITEMS[id].name}</span>
          <span className="icon-cell-count">{save.inventory[id] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

export function InventorySheet({ save, onClose }: { save: SaveState; onClose: () => void }) {
  const furnitureOwned = Object.entries(save.furniture).filter(([, count]) => count > 0);

  return (
    <Sheet title="もちもの" onClose={onClose}>
      <div className="sheet-list">
        <p className="sheet-subtitle">素材</p>
        <ItemGrid ids={MATERIAL_IDS} save={save} />

        <p className="sheet-subtitle">植物</p>
        <ItemGrid ids={PLANT_IDS} save={save} />
        <p className="sheet-text">苗木・花の種は、模様替えでマスを選んで植えられます。</p>

        <p className="sheet-subtitle">作物</p>
        <ItemGrid ids={CROP_IDS} save={save} />

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
