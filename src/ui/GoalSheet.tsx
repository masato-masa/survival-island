// もくひょう: 島ポイントの現在値と次の島レベルまでの距離、次で増えるもの、
// エリアごとの開放状況と必要スキルを見せる。

import { AREA_ORDER, AREAS, BUFFS, ISLAND_LEVEL_POINTS, ITEMS, REQUESTS, SHIP_STAGES, SKILLS } from '@/game/data';
import { dailyOpen, dailyTitle, dailyView } from '@/game/daily';
import { currentRequest, hasBuff, isAreaOpen } from '@/game/rules';
import { islandPoints } from '@/game/score';
import type { SaveState, World } from '@/game/types';

import { Sheet } from './Sheets';

export function GoalSheet({
  world,
  save,
  islandLevel,
  now,
  onClose,
}: {
  world: World;
  save: SaveState;
  islandLevel: number;
  now: number;
  onClose: () => void;
}) {
  const points = islandPoints(world, save);
  const nextThreshold = ISLAND_LEVEL_POINTS[islandLevel];
  const progress = nextThreshold ? Math.min(1, points.total / nextThreshold) : 1;
  const req = currentRequest(save);
  const itemList = (m: Partial<Record<string, number>>) =>
    Object.entries(m)
      .map(([k, n]) => `${ITEMS[k as keyof typeof ITEMS].name}×${n}`)
      .join('・');
  const openAreas = AREA_ORDER.filter((area) => isAreaOpen(world, save, area)).length;

  return (
    <Sheet
      title="もくひょう"
      subtitle={`島ポイント ${points.total}${nextThreshold ? ` / ${nextThreshold}` : '（最大）'}`}
      onClose={onClose}
    >
      <p className="sheet-text">
        島レベル {islandLevel}・ひらいたエリア {openAreas}/{AREA_ORDER.length}
      </p>
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
      <div className="goal-request">
        <div className="goal-request-title">島のおねがい {save.request.done.length}/{REQUESTS.length}</div>
        {req ? (
          req.locked ? (
            <p className="sheet-text">「{req.def.name}」は 島レベル {req.def.unlockLevel} で受けられます</p>
          ) : (
            <>
              <p className="sheet-text">
                <b>{req.def.name}</b>：{req.def.buffs.map((b) => BUFFS[b].name).join('と')}が効いている間に{' '}
                {req.def.items.map((i) => ITEMS[i].name).join('・')}を {req.def.goal} 個集める
              </p>
              <div className="goal-progress-bar">
                <div className="goal-progress-fill" style={{ width: `${Math.min(100, (save.request.progress / req.def.goal) * 100)}%` }} />
              </div>
              <p className="sheet-text">
                {save.request.progress} / {req.def.goal}　ごほうび: {itemList(req.def.reward)}
              </p>
              <p className="sheet-text">
                {req.def.buffs.every((b) => hasBuff(save, b, now))
                  ? '効き目が効いています。今のうちに！'
                  : `作業台のごはんで ${req.def.buffs.map((b) => BUFFS[b].name).join('・')} を付けてから集めよう（効いていない間は数えません）`}
              </p>
            </>
          )
        ) : (
          <p className="sheet-text">島のおねがいは全部かないました！</p>
        )}
      </div>
      {dailyOpen(save) && (
        <div className="goal-request">
          <div className="goal-request-title">毎日のおねがい（日付で入れ替わる）</div>
          <p className="sheet-text">
            称号: <b>{dailyTitle(save.request.daily.total).name}</b>（かなえた数 {save.request.daily.total}
            {dailyTitle(save.request.daily.total).next
              ? `、「${dailyTitle(save.request.daily.total).next!.name}」まであと ${dailyTitle(save.request.daily.total).next!.total - save.request.daily.total}`
              : ''}
            ）
          </p>
          {dailyView(save, now).map(({ def, progress, claimed }) => (
            <div key={def.id} style={{ marginTop: 8 }}>
              <p className="sheet-text">
                <b>{def.name}</b>：{def.buffs.map((b) => BUFFS[b].name).join('と')}が効いている間に{' '}
                {def.items.map((i) => ITEMS[i].name).join('・')}を {def.goal} 個
              </p>
              <div className="goal-progress-bar">
                <div className="goal-progress-fill" style={{ width: `${claimed ? 100 : Math.min(100, (progress / def.goal) * 100)}%` }} />
              </div>
              <p className="sheet-text">
                {claimed ? 'かなえた！' : `${Math.min(progress, def.goal)} / ${def.goal}${def.buffs.every((b) => hasBuff(save, b, now)) ? '　効き目が効いています' : ''}`}　ごほうび: {itemList(def.reward)}
              </p>
            </div>
          ))}
          <p className="sheet-text">同じ作業が、効き目の合うおねがい全部に数えられます。</p>
        </div>
      )}
      <div className="goal-request">
        <div className="goal-request-title">商船の修理 {save.ship.stage}/{SHIP_STAGES.length}</div>
        <div className="goal-progress-bar">
          <div className="goal-progress-fill" style={{ width: `${(save.ship.stage / SHIP_STAGES.length) * 100}%` }} />
        </div>
        <p className="sheet-text">
          {SHIP_STAGES[save.ship.stage]
            ? `次: ${SHIP_STAGES[save.ship.stage]!.name}（島レベル ${SHIP_STAGES[save.ship.stage]!.unlockLevel}〜）。桟橋の商船に触れて素材を納めよう`
            : '商船は すっかり直りました'}
        </p>
      </div>
      <p className="sheet-text">次の島レベルで増えるもの: スキルの上限・新しいレシピ・新しい種</p>
      <p className="sheet-text">謎の遺跡でスキルを授かり、作業台で家具をクラフトできます。</p>
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
                    : area.entry
                      ? `${AREAS[area.entry].name}の奥に入口がある`
                      : ''}
              </span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
