// もくひょう: 島ポイントの現在値と次の島レベルまでの距離、次で増えるもの、
// エリアごとの開放状況と必要スキルを見せる。

import { AREA_ORDER, AREAS, ISLAND_LEVEL_POINTS, SKILLS } from '@/game/data';
import { isAreaOpen } from '@/game/rules';
import { islandPoints } from '@/game/score';
import type { SaveState, World } from '@/game/types';

import { Sheet } from './Sheets';

export function GoalSheet({
  world,
  save,
  islandLevel,
  onClose,
}: {
  world: World;
  save: SaveState;
  islandLevel: number;
  onClose: () => void;
}) {
  const points = islandPoints(world, save);
  const nextThreshold = ISLAND_LEVEL_POINTS[islandLevel];
  const progress = nextThreshold ? Math.min(1, points.total / nextThreshold) : 1;

  return (
    <Sheet
      title="もくひょう"
      subtitle={`島ポイント ${points.total}${nextThreshold ? ` / ${nextThreshold}` : '（最大）'}`}
      onClose={onClose}
    >
      <div className="goal-progress">
        <div className="goal-progress-bar">
          <div className="goal-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="sheet-text">
          {nextThreshold
            ? `次の島レベルまであと ${Math.max(0, nextThreshold - points.total)} ポイント`
            : '島レベルは最大です'}
        </p>
      </div>
      <p className="sheet-text">次の島レベルで増えるもの: スキルの上限・新しいレシピ・新しい種</p>
      <div className="sheet-list">
        {AREA_ORDER.map((areaId) => {
          const area = AREAS[areaId];
          const open = isAreaOpen(world, save, areaId);
          return (
            <div className="sheet-row static goal-area-row" key={areaId}>
              <span>{area.name}</span>
              <span className={open ? 'goal-open' : 'goal-locked'}>
                {open
                  ? '開放済み'
                  : area.border
                    ? `${SKILLS[area.border.skill].name} Lv${area.border.level} で境界を壊す`
                    : ''}
              </span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
