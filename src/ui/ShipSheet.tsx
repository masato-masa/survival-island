// 商船（SI-14）。素材を納めて 1 段階ずつ直す。直した段階ぶんのお届けが毎日 1 回届く。

import { ITEMS, SHIP_STAGES } from '@/game/data';
import { nextShipStage, shipGift, shipGiftReady } from '@/game/ship';
import type { ItemId, SaveState } from '@/game/types';
import { spriteDataUrl, type SpriteName } from '@/render/sprites';

import { Sheet } from './Sheets';

const giftText = (g: Partial<Record<ItemId, number>>) =>
  Object.entries(g)
    .map(([k, n]) => `${ITEMS[k as ItemId].name}×${n}`)
    .join('・');

export function ShipSheet({
  save,
  now,
  islandLevel,
  onRepair,
  onClaim,
  onClose,
}: {
  save: SaveState;
  now: () => number;
  islandLevel: number;
  onRepair: () => void;
  onClaim: () => void;
  onClose: () => void;
}) {
  const stage = save.ship.stage;
  const next = nextShipStage(save);
  const lockedByLevel = next != null && islandLevel < next.unlockLevel;
  const costEntries = next ? (Object.entries(next.cost) as [ItemId, number][]) : [];
  const canAfford = costEntries.every(([item, need]) => (save.inventory[item] ?? 0) >= need);
  const ready = shipGiftReady(save, now());
  const gift = shipGift(save);


  return (
    <Sheet title="商船" subtitle={`直した段階 ${stage}/${SHIP_STAGES.length}`} onClose={onClose}>
      <div className="ship-view">
        <img src={spriteDataUrl(`decor_ship${stage}` as SpriteName)} alt="" />
      </div>
      {next ? (
        <div className="craft-row">
          <div className="craft-info">
            <div className="craft-name">
              {stage + 1}. {next.name}
            </div>
            <div className="craft-meta">{lockedByLevel ? `島レベル ${next.unlockLevel} で取りかかれる` : `直すと毎日のお届けに ${giftText(next.gift)} が増える`}</div>
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
            </div>
          </div>
          <button className="sheet-btn craft-btn" disabled={lockedByLevel || !canAfford} onClick={onRepair}>
            直す
          </button>
        </div>
      ) : (
        <p className="sheet-text">船は すっかり直りました。赤い旗をかかげて、毎日お届けが来ます。</p>
      )}
      <p className="sheet-text">
        木材・石は木こりと岩掘りで、銅は洞窟で。力もちのごはんを食べてから集めると、木材も石もスタミナが3割ほど少なくてすみます。
      </p>
      <div className="craft-row">
        <div className="craft-info">
          <div className="craft-name">毎日のお届け</div>
          <div className="craft-meta">
            {stage === 0 ? '船を 1 段階直すと、毎日お届けが来ます' : `${giftText(gift)}（日本時間の 0 時に新しくなります）`}
          </div>
        </div>
        <button className="sheet-btn craft-btn" disabled={!ready} onClick={onClaim}>
          {stage === 0 ? '—' : ready ? '受け取る' : '受け取り済み'}
        </button>
      </div>
      <div className="sheet-list">
        {SHIP_STAGES.map((st, i) => (
          <div className={`craft-row${i < stage ? '' : ' is-locked'}`} key={st.id}>
            <div className="craft-info">
              <div className="craft-name">
                {i < stage ? '✓ ' : ''}
                {i + 1}. {st.name}
              </div>
              <div className="craft-meta">{i < stage ? st.after : `お届け: ${giftText(st.gift)}`}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
