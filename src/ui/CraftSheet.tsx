// クラフト: 覚えているレシピを先に並べる。未取得は「島Lv N で覚える」または
// 「どこかの宝箱で見つかる」を添えてグレーにする。素材の過不足は色で示す。

import { useEffect, useState } from 'react';

import { FURNITURE, FURNITURE_BY_ID, SERIES, craftMs } from '@/game/data';
import { knownRecipes } from '@/game/rules';
import type { FurnitureId, ItemId, SaveState } from '@/game/types';
import { spriteDataUrl, type SpriteName } from '@/render/sprites';

import { Sheet } from './Sheets';

/** ms を m:ss に（切り上げ。残り 0.3 秒でも 0:01 と出す）。 */
function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CraftSheet({
  save,
  now,
  onCraft,
  onCollect,
  onClose,
}: {
  save: SaveState;
  /** 現在時刻（開発者メニューの時間送りを含む）。store.now を渡す。 */
  now: () => number;
  onCraft: (id: FurnitureId) => void;
  onCollect: () => void;
  onClose: () => void;
}) {
  // 残り時間を 1 秒ごとに描き直す
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const known = new Set(knownRecipes(save));
  // 作れない家具（たき火・古い柱など、島に最初からあるだけのもの）は並べない
  const sorted = [...FURNITURE].filter((f) => !('none' in f.learn)).sort((a, b) => Number(known.has(b.id)) - Number(known.has(a.id)));

  const job = save.crafting;
  const jobDef = job ? FURNITURE_BY_ID[job.furnitureId] : undefined;
  const t = now();
  const done = job != null && t >= job.endsAt;
  const ratio = job ? Math.min(1, Math.max(0, (t - job.startedAt) / Math.max(1, job.endsAt - job.startedAt))) : 0;

  return (
    <Sheet title="クラフト" onClose={onClose}>
      {job && jobDef ? (
        <div className="craft-row craft-job">
          <img src={spriteDataUrl(`f_${job.furnitureId}` as SpriteName)} alt="" className="craft-icon" />
          <div className="craft-info">
            <div className="craft-name">{jobDef.name}</div>
            <div className="craft-meta">{done ? 'できあがり！' : `作っています… のこり ${formatTime(job.endsAt - t)}`}</div>
            <div className="goal-progress-bar craft-job-bar">
              <div className="goal-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
          </div>
          {done ? (
            <button className="sheet-btn craft-btn" onClick={onCollect}>
              受け取る
            </button>
          ) : null}
        </div>
      ) : null}
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
                  {SERIES[f.series]} ・ {f.points}pt ・ ⏱ {formatTime(craftMs(f.id))}
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
              <button className="sheet-btn craft-btn" disabled={!isKnown || !canAfford || job != null} onClick={() => onCraft(f.id)}>
                {job != null ? '作業中' : '作る'}
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
