import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { AREAS, CROPS, FURNITURE, NODES } from '@/game/data';
import { store } from '@/game/store';
import type { CropId, Fail, FurnitureId, GameEvent, SkillId } from '@/game/types';
import { WorldView } from '@/render/WorldView';

import { CraftSheet } from './CraftSheet';
import { GoalSheet } from './GoalSheet';
import { formatCountdown } from './format';
import { HelpSheet } from './HelpSheet';
import { hapticCraft, hapticFail, hapticHarvest, hapticHit, hapticLevelUp, hapticPlace, hapticTap } from './haptics';
import { BackIcon, CraftIcon, DecorateIcon, GoalIcon, InventoryIcon, SettingsIcon, SkillIcon } from './icons';
import { IntroSheet } from './IntroSheet';
import { InventorySheet } from './InventorySheet';
import { PlaceSheet } from './PlaceSheet';
import { SettingsSheet } from './SettingsSheet';
import { isHapticsEnabled, isSoundEnabled, setHapticsEnabled, setSoundEnabled } from './settings';
import { SignSheet } from './SignSheet';
import { SkillSheet } from './SkillSheet';
import { playBreak, playChop, playCraft, playFail, playHarvest, playLevelUp, playMine, playPlace, playPlant } from './sound';

type SheetState =
  | { kind: 'inventory' }
  | { kind: 'skill' }
  | { kind: 'craft' }
  | { kind: 'goal' }
  | { kind: 'sign'; plotId: string }
  | { kind: 'place'; slotId: string }
  | { kind: 'help' }
  | { kind: 'settings' }
  | { kind: 'intro' }
  | null;

function isPickNode(kind: keyof typeof NODES): boolean {
  return NODES[kind].tool === 'pick';
}

const FAIL_MESSAGES: Record<Fail, string> = {
  noStamina: 'スタミナが足りません',
  needSkill: 'スキルが足りません',
  cooldown: '',
  noCrop: '看板で育てる作物を選んでください',
  notReady: 'まだ準備できていません',
  notEnoughItems: '素材が足りません',
  notLearned: 'まだ覚えていません',
  levelCap: '島レベルの上限です',
  maxLevel: 'もう最大まで上げています',
  noXp: '経験値が足りません',
  wrongAttr: 'この場所には置けません',
};

/** 島レベルが上がったときに何が増えたかを一言でまとめる。 */
function collectUnlocks(level: number): string[] {
  const unlocks: string[] = [];
  for (const f of FURNITURE) {
    if ('level' in f.learn && f.learn.level === level) unlocks.push(f.name);
  }
  for (const c of Object.values(CROPS)) {
    if (c.unlockLevel === level) unlocks.push(`${c.name}の種`);
  }
  unlocks.push(`スキル上限 Lv${level}`);
  return unlocks;
}

export function Game({ onExit }: { onExit: () => void }) {
  // store の版数を購読し、行動のたびに再描画する。
  useSyncExternalStore(store.subscribe, store.version, store.version);

  const [sheet, setSheet] = useState<SheetState>(() => (store.get().seenIntro ? null : { kind: 'intro' }));
  const [decorate, setDecorate] = useState(false);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  const failTimer = useRef<number | undefined>(undefined);
  const bannerTimer = useRef<number | undefined>(undefined);

  // スタミナ回復・作物の成長を反映するため、1 秒ごとに時計を進めて再描画する。
  useEffect(() => {
    const id = window.setInterval(() => store.tick(), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const showFail = (reason: Fail, detail?: string) => {
      if (reason === 'cooldown') return; // クールダウンは見せるほどの情報ではない
      const msg = reason === 'needSkill' && detail ? `${detail} が必要です` : FAIL_MESSAGES[reason];
      window.clearTimeout(failTimer.current);
      setFailMsg(msg);
      failTimer.current = window.setTimeout(() => setFailMsg(null), 1600);
      playFail();
      hapticFail();
    };

    const showBanner = (text: string) => {
      window.clearTimeout(bannerTimer.current);
      setBanner(text);
      bannerTimer.current = window.setTimeout(() => setBanner(null), 2600);
    };

    const handleEvents = (events: GameEvent[]) => {
      for (const ev of events) {
        switch (ev.type) {
          case 'hit':
            if (isPickNode(ev.kind)) playMine();
            else playChop();
            hapticHit();
            break;
          case 'broke':
            playBreak();
            hapticHit();
            break;
          case 'planted':
            playPlant();
            hapticTap();
            break;
          case 'harvested':
            playHarvest();
            hapticHarvest();
            break;
          case 'chest':
          case 'crafted':
            playCraft();
            hapticCraft();
            break;
          case 'placed':
            playPlace();
            hapticPlace();
            break;
          case 'skill':
            playCraft();
            hapticTap();
            break;
          case 'areaOpened':
            showBanner(`${AREAS[ev.area].name}が開放されました！`);
            playLevelUp();
            hapticLevelUp();
            break;
          case 'islandLevelUp':
            showBanner(`島レベル ${ev.level}！\n${collectUnlocks(ev.level).join('・')}`);
            playLevelUp();
            hapticLevelUp();
            break;
          default:
            break;
        }
      }
    };

    const offEvents = store.onEvents(handleEvents);
    const offFail = store.onFail(showFail);
    return () => {
      offEvents();
      offFail();
      window.clearTimeout(failTimer.current);
      window.clearTimeout(bannerTimer.current);
    };
  }, []);

  const save = store.get();
  const world = store.world;
  const stamina = store.stamina();
  const islandLevel = store.islandLevel();

  const px = Math.floor(save.player.x);
  const py = Math.floor(save.player.y);
  const areaId = world.area[py * world.width + px] ?? null;
  const areaName = areaId ? AREAS[areaId].name : '';

  const closeSheet = () => setSheet(null);

  const buySkill = (id: SkillId) => store.buySkill(id);
  const craft = (id: FurnitureId) => store.craft(id);
  const chooseCrop = (plotId: string, crop: CropId | null) => {
    store.chooseCrop(plotId, crop);
    closeSheet();
  };
  const place = (slotId: string, furnitureId: FurnitureId | null) => {
    store.place(slotId, furnitureId);
    closeSheet();
  };

  return (
    <div className="app app-play">
      <header className="header">
        <div className="header-row">
          <div className="header-left">
            <button className="icon-btn" aria-label="戻る" onClick={onExit}>
              <BackIcon />
            </button>
          </div>
          <h1 className="title">{areaName}</h1>
          <div className="header-actions">
            <button className="icon-btn" aria-label="あそびかた" onClick={() => setSheet({ kind: 'help' })}>
              ?
            </button>
            <button className="icon-btn" aria-label="設定" onClick={() => setSheet({ kind: 'settings' })}>
              <SettingsIcon />
            </button>
          </div>
        </div>
        <div className="status-bar">
          <span className="stat stamina-stat" aria-label={`スタミナ ${stamina.value}/${stamina.max}`}>
            <svg className="stamina-icon" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7 1 2.5 7H6l-1 4 4.5-6H6z" fill="currentColor" />
            </svg>
            <span className="stamina-bar">
              <span
                className="stamina-bar-fill"
                style={{ width: `${Math.max(0, Math.min(1, stamina.value / stamina.max)) * 100}%` }}
              />
            </span>
            <span className="stat-num">
              {stamina.value}/{stamina.max}
            </span>
            {/* 満タンでも場所は取っておく。出たり消えたりで行 2 の幅が変わると、隣の表示が揺れる。 */}
            <span className="stamina-next" style={{ visibility: stamina.value < stamina.max ? 'visible' : 'hidden' }}>
              {formatCountdown(stamina.value < stamina.max ? stamina.nextInMs : 0)}
            </span>
          </span>
          <span className="stat">
            <span className="stat-label">島Lv</span>
            <span className="stat-num">{islandLevel}</span>
          </span>
          <span className="stat">
            <span className="stat-label">経験値</span>
            <span className="stat-num">{save.xp}</span>
          </span>
        </div>
      </header>

      <main className="play">
        <div className="map-area">
          <WorldView
            decorate={decorate}
            paused={sheet !== null}
            onSignTap={(plotId) => setSheet({ kind: 'sign', plotId })}
            onSlotTap={(slotId) => setSheet({ kind: 'place', slotId })}
          />

          {failMsg ? <div className="fail-toast">{failMsg}</div> : null}
          {banner ? (
            <div className="levelup-banner">
              {banner.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="footer">
          <button className="tool" aria-label="もちもの" onClick={() => setSheet({ kind: 'inventory' })}>
            <InventoryIcon />
          </button>
          <button className="tool" aria-label="スキル" onClick={() => setSheet({ kind: 'skill' })}>
            <SkillIcon />
          </button>
          <button className="tool" aria-label="クラフト" onClick={() => setSheet({ kind: 'craft' })}>
            <CraftIcon />
          </button>
          <button className="tool" aria-label="もくひょう" onClick={() => setSheet({ kind: 'goal' })}>
            <GoalIcon />
          </button>
          <button
            className={`tool${decorate ? ' is-active' : ''}`}
            aria-label="模様替え"
            aria-pressed={decorate}
            onClick={() => setDecorate((v) => !v)}
          >
            <DecorateIcon />
          </button>
        </footer>
      </main>

      <AnimatePresence>
        {sheet?.kind === 'inventory' ? <InventorySheet key="inventory" save={save} onClose={closeSheet} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'skill' ? <SkillSheet key="skill" save={save} onBuy={buySkill} onClose={closeSheet} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'craft' ? <CraftSheet key="craft" save={save} onCraft={craft} onClose={closeSheet} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'goal' ? (
          <GoalSheet key="goal" world={world} save={save} islandLevel={islandLevel} onClose={closeSheet} />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'sign' ? (
          <SignSheet
            key="sign"
            save={save}
            plotId={sheet.plotId}
            onChoose={(crop) => chooseCrop(sheet.plotId, crop)}
            onClose={closeSheet}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'place' ? (
          <PlaceSheet
            key="place"
            world={world}
            save={save}
            slotId={sheet.slotId}
            onPlace={(furnitureId) => place(sheet.slotId, furnitureId)}
            onClose={closeSheet}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{sheet?.kind === 'help' ? <HelpSheet key="help" onClose={closeSheet} /> : null}</AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'settings' ? (
          <SettingsSheet
            key="settings"
            soundOn={soundOn}
            hapticsOn={hapticsOn}
            onToggleSound={() => {
              const next = !soundOn;
              setSoundOn(next);
              setSoundEnabled(next);
            }}
            onToggleHaptics={() => {
              const next = !hapticsOn;
              setHapticsOn(next);
              setHapticsEnabled(next);
            }}
            onClose={closeSheet}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'intro' ? (
          <IntroSheet
            key="intro"
            onReceive={() => {
              store.markIntroSeen();
              closeSheet();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
