// プレイ画面そのもの。ホーム画面を持たないので、このコンポーネントがアプリの全部になる。
// 画面全体が盤面（フルブリード）で、HUD はすべて盤面の上に固定位置で浮かせる
// （CLAUDE.md: 操作でレイアウトが 1px も動かないこと）。

import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { AREAS, CROPS, FURNITURE, FURNITURE_FUNCTION, ISLAND_LEVEL_POINTS } from '@/game/data';
import { store } from '@/game/store';
import { placementAt } from '@/game/rules';
import { spriteDataUrl } from '@/render/sprites';
import type { CropId, Fail, FurnitureId, GameEvent, SkillId, StationKind } from '@/game/types';
import { WorldView } from '@/render/WorldView';

import { CraftSheet } from './CraftSheet';
import { DevSheet } from './DevSheet';
import { GoalSheet } from './GoalSheet';
import { formatCountdown } from './format';
import { HelpSheet } from './HelpSheet';
import { hapticCraft, hapticFail, hapticHarvest, hapticHit, hapticLevelUp, hapticPlace, hapticTap } from './haptics';
import { BagIcon, BrushIcon, GoalIcon, HeartIcon, HelpIcon, SettingsIcon, SproutIcon, StarIcon } from './icons';
import { IntroSheet } from './IntroSheet';
import { InventorySheet } from './InventorySheet';
import { PlaceSheet } from './PlaceSheet';
import { SettingsSheet } from './SettingsSheet';
import { isHapticsEnabled, isSoundEnabled, setHapticsEnabled, setSoundEnabled } from './settings';
import { SignSheet } from './SignSheet';
import { SkillSheet } from './SkillSheet';
import { StationInfoSheet } from './StationInfoSheet';
import { playCraft, playFell, playPop, playFail, playHarvest, playLevelUp, playPlace, playPlant } from './sound';

type SheetState =
  | { kind: 'inventory' }
  | { kind: 'skill' }
  | { kind: 'craft' }
  | { kind: 'goal' }
  | { kind: 'sign'; plotId: string }
  | { kind: 'place'; x: number; y: number }
  | { kind: 'stationInfo'; station: StationKind }
  | { kind: 'help' }
  | { kind: 'settings' }
  | { kind: 'dev' }
  | { kind: 'intro' }
  | null;

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
  cannotPlace: 'この場所には置けません',
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

export function Game() {
  // store の版数を購読し、行動のたびに再描画する。
  useSyncExternalStore(store.subscribe, store.version, store.version);

  const [sheet, setSheet] = useState<SheetState>(() => (store.get().seenIntro ? null : { kind: 'intro' }));
  const [decorate, setDecorate] = useState(false);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [areaName, setAreaName] = useState('');
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  const failTimer = useRef<number | undefined>(undefined);
  const bannerTimer = useRef<number | undefined>(undefined);
  const lastAreaRef = useRef<string | null>(null);

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
          // 'hit' の音・振動は、道具が当たる瞬間ごとに WorldView が出す（ここで鳴らすと 1 回多くなる）
          case 'broke': {
            // 木が幹になった → 倒れる音。幹・花・岩が消えた → ポン
            const ns = store.get().nodes;
            if (ns[`${ev.x},${ev.y}`]?.stump || ns[`p:${ev.x},${ev.y}`]?.stump) playFell();
            else playPop();
            hapticHit();
            break;
          }
          case 'gathered':
            playHarvest();
            hapticHarvest();
            break;
          case 'planted':
          case 'sowed':
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
  const points = store.points();
  const nextThreshold = ISLAND_LEVEL_POINTS[islandLevel];
  const levelProgress = nextThreshold ? Math.max(0, Math.min(1, points.total / nextThreshold)) : 1;

  // エリアが変わった（起動直後・テレポート・セーブ読み込み含む）ら、名前を数秒だけ
  // 中央上部に出す。プレイヤーの移動は store.move() が毎フレーム座標を書き換えるだけで
  // 再描画（store.notify）を伴わないため、このコンポーネントの再レンダーには乗らない。
  // なので専用のポーリングで store.get() を直接見に行く（100ms ごとで十分反応が良い）。
  useEffect(() => {
    const checkArea = () => {
      const s = store.get();
      const w = store.world;
      const tx = Math.floor(s.player.x);
      const ty = Math.floor(s.player.y);
      const aId = w.area[ty * w.width + tx] ?? null;
      const name = aId ? AREAS[aId].name : '';
      if (!name || name === lastAreaRef.current) return;
      lastAreaRef.current = name;
      setAreaName(name);
    };
    checkArea();
    const id = window.setInterval(checkArea, 100);
    return () => window.clearInterval(id);
  }, []);

  const closeSheet = () => setSheet(null);

  const buySkill = (id: SkillId) => store.buySkill(id);
  const craft = (id: FurnitureId) => store.craft(id);
  const chooseCrop = (plotId: string, crop: CropId | null) => {
    store.chooseCrop(plotId, crop);
    closeSheet();
  };
  const place = (x: number, y: number, furnitureId: FurnitureId | null) => {
    // すでに家具が載っているマスなら、その家具の左上マスを基準に入れ替える
    const anchor = placementAt(store.get(), x, y);
    const [ax, ay] = anchor ? anchor.split(',').map(Number) : [x, y];
    store.place(ax ?? x, ay ?? y, furnitureId);
    closeSheet();
  };

  const onStationTap = (kind: StationKind) => {
    if (sheet !== null) return; // シートが開いている間は二重に開かない
    if (kind === 'ruins') setSheet({ kind: 'skill' });
    else setSheet({ kind: 'stationInfo', station: kind });
    hapticTap();
  };

  /** 機能のある家具に触れた（作業台 → クラフト）。 */
  const onFurnitureTap = (furnitureId: FurnitureId) => {
    if (sheet !== null) return;
    if (FURNITURE_FUNCTION[furnitureId] === 'craft') setSheet({ kind: 'craft' });
    hapticTap();
  };

  const plant = (x: number, y: number, item: 'sapling' | 'flowerSeed') => {
    const r = store.plant(x, y, item);
    if (r.ok) closeSheet();
  };

  const staminaPct = Math.max(0, Math.min(1, stamina.value / stamina.max)) * 100;

  return (
    <div className="field-app">
      <div className="field-stage">
      <div className="field-map">
        <WorldView
          decorate={decorate}
          paused={sheet !== null}
          onSignTap={(plotId) => setSheet({ kind: 'sign', plotId })}
          onSlotTap={(x, y) => setSheet({ kind: 'place', x, y })}
          onStationTap={onStationTap}
          onFurnitureTap={onFurnitureTap}
        />
      </div>

      <div className="hud-layer">
        {/* 左上: 木の輪の顔アイコン + いるエリアの名前（ピグライフの左上の顔・上部の案内札） */}
        <div className="hud-topleft">
          <span className="hud-portrait">
            <img src={spriteDataUrl('player_down0')} alt="" />
          </span>
          <span className="hud-area-name">{areaName}</span>
        </div>

        {/* 右上: ? と設定（木の丸ボタン）。その下にゲージを縦に積む（ピグライフの右上と同じ並び） */}
        <div className="hud-topright">
          <div className="hud-topbtns">
            <button className="wood-btn is-small" aria-label="あそびかた" onClick={() => setSheet({ kind: 'help' })}>
              <HelpIcon />
            </button>
            <button className="wood-btn is-small" aria-label="設定" onClick={() => setSheet({ kind: 'settings' })}>
              <SettingsIcon />
            </button>
          </div>

          <div className="hud-gauges">
            <div className="gauge is-stamina" aria-label={`スタミナ ${stamina.value}/${stamina.max}`}>
              <span className="gauge-icon">
                <HeartIcon />
              </span>
              <span className="gauge-bar">
                <span className="gauge-track"><span className="gauge-fill" style={{ width: `${staminaPct}%` }} /></span>
                <span className="gauge-text">
                  {stamina.value} / {stamina.max}
                </span>
              </span>
            </div>
            {/* 回復までの残り時間（満タンでも高さを取って、下のゲージが上下に動かないようにする） */}
            <span className="gauge-note" style={{ visibility: stamina.value < stamina.max ? 'visible' : 'hidden' }}>
              回復まで {formatCountdown(stamina.value < stamina.max ? stamina.nextInMs : 0)}
            </span>

            <div className="gauge is-level" aria-label={`島レベル ${islandLevel}`}>
              <span className="gauge-icon">
                <SproutIcon />
                <span className="gauge-badge">{islandLevel}</span>
              </span>
              <span className="gauge-bar">
                <span className="gauge-track"><span className="gauge-fill" style={{ width: `${levelProgress * 100}%` }} /></span>
                <span className="gauge-text">
                  {nextThreshold ? `あと${Math.max(0, nextThreshold - points.total)}pt` : 'MAX'}
                </span>
              </span>
            </div>

            <div className="gauge is-xp" aria-label={`経験値 ${save.xp}`}>
              <span className="gauge-icon">
                <StarIcon />
              </span>
              <span className="gauge-bar">
                <span className="gauge-track"><span className="gauge-fill" style={{ width: '100%' }} /></span>
                <span className="gauge-text">{save.xp}</span>
              </span>
            </div>
          </div>
        </div>

        {/* 右辺中央: もちもの・もくひょう・模様替え */}
        <div className="hud-rightcol">
          <button className="hud-tool" aria-label="もちもの" onClick={() => setSheet({ kind: 'inventory' })}>
            <span className="wood-btn">
              <BagIcon />
            </span>
            <span className="hud-tool-label">もちもの</span>
          </button>
          <button className="hud-tool" aria-label="もくひょう" onClick={() => setSheet({ kind: 'goal' })}>
            <span className="wood-btn">
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
            <span className="wood-btn">
              <BrushIcon />
            </span>
            <span className="hud-tool-label">{decorate ? 'おわる' : '模様替え'}</span>
          </button>
        </div>

        {/* 左下: テスト用 */}
        <button className="dev-pill hud-clickable" onClick={() => setSheet({ kind: 'dev' })}>
          テスト用
        </button>

        {failMsg ? <div className="fail-toast">{failMsg}</div> : null}
        {banner ? (
          <div className="levelup-banner">
            {banner.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>

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
            x={sheet.x}
            y={sheet.y}
            onPlace={(furnitureId) => place(sheet.x, sheet.y, furnitureId)}
            onPlant={(item) => plant(sheet.x, sheet.y, item)}
            onClose={closeSheet}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{sheet?.kind === 'help' ? <HelpSheet key="help" onClose={closeSheet} /> : null}</AnimatePresence>

      <AnimatePresence>
        {sheet?.kind === 'stationInfo' ? (
          <StationInfoSheet key="stationInfo" kind={sheet.station} onClose={closeSheet} />
        ) : null}
      </AnimatePresence>

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
        {sheet?.kind === 'dev' ? (
          <DevSheet key="dev" onClose={closeSheet} onChange={() => {}} />
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
