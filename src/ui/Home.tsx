import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { AREA_ORDER } from '@/game/data';
import { isAreaOpen } from '@/game/rules';
import { store } from '@/game/store';

import { hapticTap } from './haptics';
import { SettingsIcon } from './icons';
import { Sheet } from './Sheets';
import { SettingsSheet } from './SettingsSheet';
import { primeAudio, playUiTap } from './sound';
import { isHapticsEnabled, isSoundEnabled, setHapticsEnabled, setSoundEnabled } from './settings';
import { getArtMode, setArtMode } from '@/render/sprites';

const SPRING = { type: 'spring', stiffness: 320, damping: 28, mass: 0.9 } as const;
const ENTER = [
  { hidden: { opacity: 0, y: -14 }, delay: 0 },
  { hidden: { opacity: 0, y: 16 }, delay: 0.08 },
  { hidden: { opacity: 0, y: 12 }, delay: 0.16 },
] as const;

/** 登場アニメーションを再生してよいか。隠れたタブや「動きを減らす」設定では
 *  最初から最終形で描く（city-builders/Home.tsx と同じ考え方）。 */
function shouldAnimateEntrance(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Home({ onStart }: { onStart: () => void }) {
  const [animateEntrance] = useState(shouldAnimateEntrance);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  const [artMode, setArtModeState] = useState(getArtMode);
  // dev メニューの操作をすぐ画面に反映させるための再描画トリガー。
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const save = store.get();
  const islandLevel = store.islandLevel();
  const openAreas = AREA_ORDER.filter((area) => isAreaOpen(store.world, save, area)).length;

  return (
    <div className="app app-home">
      <div className="home-top">
        <button className="icon-btn" aria-label="設定" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </button>
      </div>

      <div className="home">
        <motion.div
          initial={animateEntrance ? ENTER[0].hidden : false}
          animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: ENTER[0].delay } }}
        >
          <h1 className="home-title">むじんとうスローライフ</h1>
          <p className="home-sub">なにもない島を、ひとつの工具で</p>
        </motion.div>

        <motion.div
          className="home-buttons"
          initial={animateEntrance ? ENTER[1].hidden : false}
          animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: ENTER[1].delay } }}
        >
          <button
            className="home-btn primary"
            onClick={() => {
              primeAudio();
              playUiTap();
              hapticTap();
              onStart();
            }}
          >
            {save.seenIntro ? 'つづきから' : 'はじめる'}
          </button>
        </motion.div>

        <motion.p
          className="home-progress"
          initial={animateEntrance ? ENTER[2].hidden : false}
          animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: ENTER[2].delay } }}
        >
          島レベル {islandLevel}・ひらいたエリア {openAreas}/{AREA_ORDER.length}
        </motion.p>
      </div>

      <button className="dev-pill" onClick={() => setDevOpen(true)}>
        テスト用
      </button>

      <AnimatePresence>
        {settingsOpen ? (
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
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {devOpen ? (
          <Sheet
            key="dev"
            title="テスト用"
            subtitle="数値はすぐ反映される"
            onClose={() => {
              setDevOpen(false);
              setConfirmReset(false);
            }}
          >
            <div className="sheet-row static">
              <span>素材: Kenney / 仮素材</span>
              <button
                className="switch"
                role="switch"
                aria-checked={artMode === 'kenney'}
                aria-label="素材: Kenney / 仮素材"
                onClick={() => {
                  const next = artMode === 'kenney' ? 'code' : 'kenney';
                  setArtMode(next);
                  setArtModeState(next);
                  bump();
                }}
              />
            </div>
            <button
              className="sheet-row"
              onClick={() => {
                store.dev.refillStamina();
                bump();
              }}
            >
              スタミナ全快
            </button>
            <button
              className="sheet-row"
              onClick={() => {
                store.dev.addXp(50);
                bump();
              }}
            >
              経験値 +50
            </button>
            <button
              className="sheet-row"
              onClick={() => {
                store.dev.addItems(20);
                bump();
              }}
            >
              素材 +20（木材・石・銅・作物）
            </button>
            <button
              className="sheet-row"
              onClick={() => {
                store.dev.advance(60 * 60 * 1000);
                bump();
              }}
            >
              時計を 1 時間進める
            </button>
            <button
              className="sheet-row"
              onClick={() => {
                store.dev.bumpIslandLevel();
                bump();
              }}
            >
              島レベルを上げる
            </button>

            {confirmReset ? (
              <>
                <p className="sheet-text">本当にきろくを消しますか？元に戻せません。</p>
                <button
                  className="sheet-row danger"
                  onClick={() => {
                    store.dev.reset();
                    setConfirmReset(false);
                    bump();
                  }}
                >
                  消す
                </button>
                <button className="sheet-link" onClick={() => setConfirmReset(false)}>
                  やめる
                </button>
              </>
            ) : (
              <button className="sheet-row danger" onClick={() => setConfirmReset(true)}>
                記録を消す
              </button>
            )}
          </Sheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

