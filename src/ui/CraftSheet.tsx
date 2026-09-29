// クラフト: 覚えているレシピを先に並べる。未取得は「島Lv N で覚える」または
// 「どこかの宝箱で見つかる」を添えてグレーにする。素材の過不足は色で示す。

import { FURNITURE, SERIES } from '@/game/data';
import { knownRecipes } from '@/game/rules';
import type { FurnitureId, ItemId, SaveState } from '@/game/types';
import { spriteDataUrl, type SpriteName } from '@/render/sprites';

import { Sheet } from './Sheets';

export function CraftSheet({
  save,
  onCraft,
  onClose,
}: {
  save: SaveState;
  onCraft: (id: FurnitureId) => void;
  onClose: () => void;
}) {
  const known = new Set(knownRecipes(save));
  const sorted = [...FURNITURE].sort((a, b) => Number(known.has(b.id)) - Number(known.has(a.id)));

  return (
    <Sheet title="クラフト" onClose={onClose}>
      <div className="sheet-list">
        {sorted.map((f) => {
          const isKnown = known.has(f.id);
          const costEntries = Object.entries(f.cost) as [ItemId, number][];
          const canAfford = costEntries.every(([item, need]) => (save.inventory[item] ?? 0) >= need);

          return (
            <div className={`craft-row${isKnown ? '' : ' is-locked'}`} key={f.id}>
              {/* 家具のスプライト名は `f_<furnitureId>` で、data.ts の FURNITURE と
                  sprites.ts の SpriteName が 1 対 1 に対応している契約。FurnitureId は
                  型上ただの string なので、ここだけ SpriteName にキャストする。 */}
              <img src={spriteDataUrl(`f_${f.id}` as SpriteName)} alt="" className="craft-icon" />
              <div className="craft-info">
                <div className="craft-name">{f.name}</div>
                <div className="craft-meta">
                  {SERIES[f.series]} ・ {f.points}pt
                </div>
                {isKnown ? (
                  <div className="cost-chips">
                    {costEntries.map(([item, need]) => {
                      const have = save.inventory[item] ?? 0;
                      return (
                        <span key={item} className={`cost-chip${have >= need ? ' is-ok' : ' is-short'}`}>
                          <img src={spriteDataUrl(`item_${item}`)} alt="" />
                          {have}/{need}
                        </span>
                      );
                    })}
                    <span className="cost-chip stamina-chip">スタミナ {f.stamina}</span>
                  </div>
                ) : (
                  <div className="craft-locked-text">
                    {'level' in f.learn ? `島Lv ${f.learn.level} で覚える` : 'どこかの宝箱で見つかる'}
                  </div>
                )}
              </div>
              <button className="sheet-btn quiet craft-btn" disabled={!isKnown || !canAfford} onClick={() => onCraft(f.id)}>
                作る
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
