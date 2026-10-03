// スキル: 系統ごとに並べ、段階を丸（pip）で見せる。上限を超える段階は鍵つきで
// グレーにする（「島Lv N で解放」）。獲得ボタンは経験値不足・上限到達で disabled。

import { SKILL_BRANCHES, SKILL_COST, SKILLS } from '@/game/data';
import { skillCap } from '@/game/rules';
import type { SaveState, SkillId } from '@/game/types';

import { Sheet } from './Sheets';

export function SkillSheet({
  save,
  onBuy,
  onClose,
}: {
  save: SaveState;
  onBuy: (id: SkillId) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="スキル" subtitle={`経験値 残り ${save.xp}`} onClose={onClose}>
      <div className="sheet-list">
        {SKILL_BRANCHES.map((branch) => (
          <div className="skill-branch" key={branch.id}>
            <p className="sheet-subtitle">{branch.name}</p>
            {branch.skills.map((id) => {
              const def = SKILLS[id];
              const level = save.skills[id] ?? 0;
              const cap = skillCap(save, id);
              const atMax = level >= def.maxLevel;
              const locked = !atMax && level >= cap;
              const nextCost = SKILL_COST[level];
              const canBuy = !atMax && !locked && nextCost !== undefined && save.xp >= nextCost;

              return (
                <div className="skill-row" key={id}>
                  <div className="skill-row-head">
                    <span className="skill-name">{def.name}</span>
                    <div className="pips">
                      {Array.from({ length: def.maxLevel }, (_, i) => {
                        const n = i + 1;
                        const filled = n <= level;
                        const isLocked = !filled && n > cap;
                        return <span key={n} className={`pip${filled ? ' is-filled' : ''}${isLocked ? ' is-locked' : ''}`} />;
                      })}
                    </div>
                  </div>
                  <p className="skill-desc">
                    {atMax ? '最大まで習得しました' : locked ? `島Lv ${level + 1} で解放` : def.levelText[level]}
                  </p>
                  <button className="sheet-btn skill-buy" disabled={!canBuy} onClick={() => onBuy(id)}>
                    {atMax ? '習得済み' : locked ? `島Lv ${level + 1} で解放` : `獲得（経験値 ${nextCost}）`}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
