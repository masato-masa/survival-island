// プレイ画面そのもの。ホーム画面を持たないので、このコンポーネントがアプリの全部になる。
// 画面全体が盤面（フルブリード）で、HUD はすべて盤面の上に固定位置で浮かせる
// （CLAUDE.md: 操作でレイアウトが 1px も動かないこと）。

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { AREAS, CROPS, FURNITURE, ISLAND_LEVEL_POINTS, NODES } from '@/game/data';
import { store } from '@/game/store';
import type { CropId, Fail, FurnitureId, GameEvent, SkillId, StationKind } from '@/game/types';
import { WorldView } from '@/render/WorldView';

import { CraftSheet } from './CraftSheet';
import { DevSheet } from './DevSheet';
import { GoalSheet } from './GoalSheet';
import { formatCountdown } from './format';
import { HelpSheet } from './HelpSheet';
import { hapticCraft, hapticFail, hapticHarvest, hapticHit, hapticLevelUp, hapticPlace, hapticTap } from './haptics';
import { BagIcon, BrushIcon, GoalIcon, HelpIcon, SettingsIcon } from './icons';
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
  | { kind: 'dev' }
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

const BANNER_SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const;

export function Game() {
  // store の版数を購読し、行動のたびに再描画する。
  useSyncExternalStore(store.subscribe, store.version, store.version);

  const [sheet, setSheet] = useState<SheetState>(() => (store.get().seenIntro ? null : { kind: 'intro' }));
  const [decorate, setDecorate] = useState(false);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [areaBanner, setAreaBanner] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  const failTimer = useRef<number | undefined>(undefined);
  const bannerTimer = useRef<number | undefined>(undefined);
  const areaBannerTimer = useRef<number | undefined>(undefined);
  const lastAreaRef = useRef<string | null>(null);
  const areaBannerShownRef = useRef(false);

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
      window.clearTimeout(areaBannerTimer.current);
    };
  }, []);

  const save = store.get();
  const world = store.world;
  const stamina = store.stamina();
  const islandLevel = store.islandLevel();
  const points = store.points();
  const nextThreshold = ISLAND_LEVEL_POINTS[islandLevel];
  const levelProgress = nextThreshold ? Math.max(0, Math.min(1, points.total / nextThreshold)) : 1;

  const px = Math.floor(save.player.x);
  const py = Math.floor(save.player.y);
  const areaId = world.area[py * world.width + px] ?? null;
  const areaName = areaId ? AREAS[areaId].name : '';

  // エリアが変わった（起動直後を含む）ら、名前を数秒だけ中央上部に出す。
  useEffect(() => {
    if (!areaName) return;
    if (lastAreaRef.current === areaName && areaBannerShownRef.current) return;
    lastAreaRef.current = areaName;
    areaBannerShownRef.current = true;
    window.clearTimeout(areaBannerTimer.current);
    setAreaBanner(areaName);
    areaBannerTimer.current = window.setTimeout(() => setAreaBanner(null), 2000);
  }, [areaName]);

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

  const onStationTap = (kind: StationKind) => {
    if (sheet !== null) return; // シートが開いている間は二重に開かない
    setSheet({ kind: kind === 'ruins' ? 'skill' : 'craft' });
    hapticTap();
  };

  const staminaPct = Math.max(0, Math.min(1, stamina.value / stamina.max)) * 100;

  return (
    <div className="field-app">
      <div className="field-map">
        <WorldView
          decorate={decorate}
          paused={sheet !== null}
          onSignTap={(plotId) => setSheet({ kind: 'sign', plotId })}
          onSlotTap={(slotId) => setSheet({ kind: 'place', slotId })}
          onStationTap={onStationTap}
        />
      </div>

      <div className="hud-layer">
        {/* 左上: スタミナ・島レベル */}
        <div className="hud-topleft panel">
          <div className="hud-row" aria-label={`スタミナ ${stamina.value}/${stamina.max}`}>
            <svg className="hud-icon" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7 1 2.5 7H6l-1 4 4.5-6H6z" fill="currentColor" />
            </svg>
            <span className="hud-bar-track">
              <span className="hud-bar-fill" style={{ width: `${staminaPct}%` }} />
            </span>
            <span className="hud-num">
              {stamina.value}/{stamina.max}
            </span>
          </div>
          <div className="hud-row">
            <span style={{ width: 14 }} />
            {/* 満タンでも場所は取っておく（行の高さ・幅が数値で動かないように）。 */}
            <span className="hud-countdown" style={{ visibility: stamina.value < stamina.max ? 'visible' : 'hidden' }}>
              {formatCountdown(stamina.value < stamina.max ? stamina.nextInMs : 0)}
            </span>
          </div>
          <div className="hud-level-row">
            <span className="hud-level-label">島Lv {islandLevel}</span>
            <span className="hud-bar-track">
              <span className="hud-bar-fill is-level" style={{ width: `${levelProgress * 100}%` }} />
            </span>
          </div>
          <div className="hud-xp">経験値 {save.xp}</div>
        </div>

        {/* 右上: 設定・ヘルプ */}
        <div className="hud-topright">
          <button className="icon-btn" aria-label="あそびかた" onClick={() => setSheet({ kind: 'help' })}>
            <HelpIcon />
          </button>
          <button className="icon-btn" aria-label="設定" onClick={() => setSheet({ kind: 'settings' })}>
            <SettingsIcon />
          </button>
        </div>

        {/* 右辺中央: もちもの・もくひょう・模様替え */}
        <div className="hud-rightcol">
          <button className="hud-tool" aria-label="もちもの" onClick={() => setSheet({ kind: 'inventory' })}>
            <span className="hud-tool-btn">
              <BagIcon />
            </span>
            <span className="hud-tool-label">もちもの</span>
          </button>
          <button className="hud-tool" aria-label="もくひょう" onClick={() => setSheet({ kind: 'goal' })}>
            <span className="hud-tool-btn">
              <GoalIcon />
            </span>
            <span className="hud-tool-label">もくひょう</span>
          </button>
          <button
            className={`hud-tool${decorate ? ' is-active' : ''}`}
            aria-label="模様替え"
            aria-pressed={decorate}
            onClick={() => setDecorate((v) => !v)}
          >
            <span className="hud-tool-btn">
              <BrushIcon />
            </span>
            <span className="hud-tool-label">模様替え</span>
          </button>
        </div>

        {/* 左下: テスト用 */}
        <button className="dev-pill hud-clickable" onClick={() => setSheet({ kind: 'dev' })}>
          テスト用
        </button>

        <AnimatePresence>
          {areaBanner ? (
            <motion.div
              key={areaBanner}
              className="area-banner"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0, transition: BANNER_SPRING }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
            >
              {areaBanner}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {failMsg ? <div className="fail-toast">{failMsg}</div> : null}
        {banner ? (
          <div className="levelup-banner">
            {banner.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>

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
        {sheet?.kind === 'dev' ? <DevSheet key="dev" onClose={closeSheet} onChange={() => {}} /> : null}
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
