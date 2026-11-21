// もくひょう: 島ポイントの現在値と次の島レベルまでの距離、次で増えるもの、
// エリアごとの開放状況と必要スキルを見せる。

import { AREA_ORDER, AREAS, BUFFS, ISLAND_LEVEL_POINTS, ITEMS, REQUESTS, SHIP_STAGES, SKILLS, TOWER_STAGES } from '@/game/data';
import { dailyOpen, dailyTitle, dailyView } from '@/game/daily';
import { currentRequest, hasBuff, isAreaOpen } from '@/game/rules';
import { islandPoints } from '@/game/score';
import type { SaveState, World } from '@/game/types';

import { tomorrowWeather, WEATHERS, weatherAt } from '@/game/weather';

import { WeatherIcon } from './icons';
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
    <Sheet title="もくひょう" onClose={onClose}>
      <div className="goal-scroll">
        <div className="goal-card goal-weather">
          <div className="goal-head">
            <b className="goal-weather-now">
              <WeatherIcon id={weatherAt(now)} />
              今日は{WEATHERS[weatherAt(now)].name}
            </b>
            {save.tower.stage >= 2 ? <span>あしたは{WEATHERS[tomorrowWeather(now)].name}</span> : null}
          </div>
          <p className="goal-main">{WEATHERS[weatherAt(now)].effect}</p>
          {save.tower.stage < 2 ? <p className="goal-note">見張り台を 2 段階建て増すと、あしたの天気が分かります。</p> : null}
        </div>
        <div className="goal-card">
          <div className="goal-head">
            <b>島レベル {islandLevel}</b>
            <span>{nextThreshold ? `${points.total} / ${nextThreshold} pt` : '最大'}</span>
          </div>
          <Bar ratio={progress} />
          <p className="goal-note">
            {nextThreshold ? `あと ${Math.max(0, nextThreshold - points.total)} ポイントで次のレベル` : '島レベルは最大です'}
            ・ひらいたエリア {openAreas}/{AREA_ORDER.length}
          </p>
        </div>
        <div className="goal-card">
          <div className="goal-head">
            <b>島のおねがい</b>
            <span>
              {save.request.done.length} / {REQUESTS.length}
            </span>
          </div>
          {req ? (
            req.locked ? (
              <p className="goal-note">「{req.def.name}」は 島レベル {req.def.unlockLevel} で受けられます</p>
            ) : (
              <>
                <p className="goal-main">
                  {req.def.buffs.map((b) => BUFFS[b].name).join('と')}の間に {req.def.items.map((i) => ITEMS[i].name).join('・')}を {req.def.goal} 個
                </p>
                <Bar ratio={save.request.progress / req.def.goal} label={`${save.request.progress} / ${req.def.goal}`} />
                <p className="goal-note">ごほうび: {itemList(req.def.reward)}</p>
                <p className="goal-note">
                  {req.def.buffs.every((b) => hasBuff(save, b, now))
                    ? '効き目が効いています。今のうちに！'
                    : `作業台のごはんで ${req.def.buffs.map((b) => BUFFS[b].name).join('・')} を付けてから（効いていない間は数えません）`}
                </p>
              </>
            )
          ) : (
            <p className="goal-note">全部かないました！</p>
          )}
        </div>
        {dailyOpen(save) && (
          <div className="goal-card">
            <div className="goal-head">
              <b>毎日のおねがい</b>
              <span>{dailyTitle(save.request.daily.total).name}</span>
            </div>
            {dailyView(save, now).map(({ def, progress: pr, claimed }) => (
              <div key={def.id} className="goal-daily">
                <p className="goal-main">
                  {def.buffs.map((b) => BUFFS[b].name).join('と')}の間に {def.items.map((i) => ITEMS[i].name).join('・')}を {def.goal} 個
                </p>
                <Bar ratio={claimed ? 1 : pr / def.goal} label={claimed ? 'かなえた！' : `${Math.min(pr, def.goal)} / ${def.goal}`} />
                <p className="goal-note">ごほうび: {itemList(def.reward)}</p>
              </div>
            ))}
            <p className="goal-note">かなえた数 {save.request.daily.total}。同じ作業は合うおねがい全部に数えます。</p>
          </div>
        )}
        <div className="goal-card">
          <div className="goal-head">
            <b>商船の修理</b>
            <span>
              {save.ship.stage} / {SHIP_STAGES.length}
            </span>
          </div>
          <Bar ratio={save.ship.stage / SHIP_STAGES.length} />
          <p className="goal-note">
            {SHIP_STAGES[save.ship.stage]
              ? `次: ${SHIP_STAGES[save.ship.stage]!.name}（島レベル ${SHIP_STAGES[save.ship.stage]!.unlockLevel}〜）。桟橋の商船へ`
              : 'すっかり直りました'}
          </p>
        </div>
        <div className="goal-card">
          <div className="goal-head">
            <b>見張り台の建て増し</b>
            <span>
              {save.tower.stage} / {TOWER_STAGES.length}
            </span>
          </div>
          <Bar ratio={save.tower.stage / TOWER_STAGES.length} />
          <p className="goal-note">
            {TOWER_STAGES[save.tower.stage]
              ? `次: ${TOWER_STAGES[save.tower.stage]!.name}（島レベル ${TOWER_STAGES[save.tower.stage]!.unlockLevel}〜）。丸太の見張り台を置いて触ろう`
              : '島一番の高さになりました'}
          </p>
        </div>
        <div className="goal-card">
          <div className="goal-head">
            <b>エリア</b>
            <span>
              {openAreas} / {AREA_ORDER.length}
            </span>
          </div>
          {AREA_ORDER.map((areaId) => {
            const area = AREAS[areaId];
            const open = isAreaOpen(world, save, areaId);
            return (
              <div className="goal-area-row" key={areaId}>
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
      </div>
    </Sheet>
  );
}

function Bar({ ratio, label }: { ratio: number; label?: string }) {
  const r = Math.max(0, Math.min(1, ratio));
  return (
    <div className="goal-bar">
      <div className="goal-bar-fill" style={{ width: `${r * 100}%` }} />
      {label ? <span className="goal-bar-label">{label}</span> : null}
    </div>
  );
}
