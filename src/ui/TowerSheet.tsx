// 見張り台（SI-15）。素材を納めて 1 段階ずつ建て増す。段階ごとに眺めで分かることと、毎日の贈り物の枠が増える。

import { useEffect, useRef } from 'react';

import { ITEMS, MEALS, TOWER_STAGES } from '@/game/data';
import { lookout, mealAdvice, nextTowerStage, towerGift, towerGiftReady } from '@/game/tower';
import { getWorld } from '@/game/world';
import type { ItemId, SaveState } from '@/game/types';
import { paintModelIcon } from '@/render/models';
import { spriteDataUrl } from '@/render/sprites';

import { Sheet } from './Sheets';

const giftText = (g: Partial<Record<ItemId, number>>) =>
  Object.entries(g)
    .map(([k, n]) => `${ITEMS[k as ItemId].name}×${n}`)
    .join('・');

/** 建て増しの段階の見張り台の絵（ゲーム内と同じ模型）。 */
function TowerView({ stage }: { stage: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    paintModelIcon(ctx, stage > 0 ? `tower${stage}` : 'woodTower', 2, c.width, c.height, 4);
  }, [stage]);
  return <canvas ref={ref} width={300} height={300} className="tower-view" />;
}

export function TowerSheet({
  save,
  now,
  islandLevel,
  onUpgrade,
  onClaim,
  onClose,
}: {
  save: SaveState;
  now: () => number;
  islandLevel: number;
  onUpgrade: () => void;
  onClaim: () => void;
  onClose: () => void;
}) {
  const stage = save.tower.stage;
  const next = nextTowerStage(save);
  const lockedByLevel = next != null && islandLevel < next.unlockLevel;
  const costEntries = next ? (Object.entries(next.cost) as [ItemId, number][]) : [];
  const canAfford = costEntries.every(([item, need]) => (save.inventory[item] ?? 0) >= need);
  const t = now();
  const ready = towerGiftReady(save, t);
  const gift = towerGift(save, t);
  const view = stage >= 1 ? lookout(getWorld(), save, t) : [];
  const advice = stage >= 3 ? mealAdvice(save, t) : null;

  return (
    <Sheet title="見張り台" subtitle={`建て増し ${stage}/${TOWER_STAGES.length}`} onClose={onClose}>
      <div className="ship-view">
        <TowerView stage={stage} />
      </div>
      {next ? (
        <div className="craft-row">
          <div className="craft-info">
            <div className="craft-name">
              {stage + 1}. {next.name}
            </div>
            <div className="craft-meta">{lockedByLevel ? `島レベル ${next.unlockLevel} で取りかかれる` : `建て増すと: ${next.view}。贈り物の枠が 1 つ増える`}</div>
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
          <button className="sheet-btn craft-btn" disabled={lockedByLevel || !canAfford} onClick={onUpgrade}>
            建て増す
          </button>
        </div>
      ) : (
        <p className="sheet-text">見張り台は島一番の高さになりました。赤い旗の上から、島じゅうが見渡せます。</p>
      )}

      <div className="craft-row">
        <div className="craft-info">
          <div className="craft-name">今日の贈り物</div>
          <div className="craft-meta">
            {stage === 0 ? '1 段階建て増すと、毎日 見張り台から贈り物が届きます' : `${giftText(gift)}（中身は日替わり。日本時間の 0 時に新しくなります）`}
          </div>
        </div>
        <button className="sheet-btn craft-btn" disabled={!ready} onClick={onClaim}>
          {stage === 0 ? '—' : ready ? '受け取る' : '受け取り済み'}
        </button>
      </div>

      <div className="goal-request">
        <div className="goal-request-title">眺め</div>
        {stage === 0 ? (
          <p className="sheet-text">まだ高さが足りず、遠くは見えません。建て増すと島のようすが分かるようになります。</p>
        ) : (
          <div className="sheet-list">
            {view.map((e) => (
              <div className="sheet-row static goal-area-row" key={e.kind}>
                <span>{e.label}（いま叩ける・摘める物 {e.total}）</span>
                <span>{e.nearest ? `いちばん近いのは ${e.nearest.dir}へ ${Math.max(1, Math.round(e.nearest.dist))} マス` : 'ここには無い'}</span>
              </div>
            ))}
            {stage >= 3 && (
              <div className="sheet-row static goal-area-row">
                <span>今日のおすすめごはん</span>
                <span>
                  {advice
                    ? `${MEALS[advice.meal].name}（効き目で${advice.total}件中${advice.covers}件${advice.bigName ? `／大きいのは「${advice.bigName}」` : ''}）`
                    : '作れるごはんがまだありません'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sheet-list">
        {TOWER_STAGES.map((st, i) => (
          <div className={`craft-row${i < stage ? '' : ' is-locked'}`} key={st.id}>
            <div className="craft-info">
              <div className="craft-name">
                {i < stage ? '✓ ' : ''}
                {i + 1}. {st.name}
              </div>
              <div className="craft-meta">{i < stage ? st.after : `${st.view}／贈り物: ${st.gift.map(([k, n]) => `${ITEMS[k].name}×${n}`).join('か')}`}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
