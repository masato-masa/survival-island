// テスト用（開発者メニュー）。プレイ画面左下の小さなピルからだけ開く。
// 元は Home.tsx にあったものをそのまま移した（ホーム画面を廃止したため）。

import { useState } from 'react';

import { store } from '@/game/store';
import { getArtMode, setArtMode } from '@/render/sprites';

import { Sheet } from './Sheets';

export function DevSheet({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [artMode, setArtModeState] = useState(getArtMode);

  return (
    <Sheet title="テスト用" subtitle="数値はすぐ反映される" onClose={onClose}>
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
            onChange();
          }}
        />
      </div>
      <button
        className="sheet-row"
        onClick={() => {
          store.dev.refillStamina();
          onChange();
        }}
      >
        スタミナ全快
      </button>
      <button
        className="sheet-row"
        onClick={() => {
          store.dev.addXp(50);
          onChange();
        }}
      >
        経験値 +50
      </button>
      <button
        className="sheet-row"
        onClick={() => {
          store.dev.addItems(20);
          onChange();
        }}
      >
        素材 +20（木材・石・銅・作物）
      </button>
      <button
        className="sheet-row"
        onClick={() => {
          store.dev.advance(60 * 60 * 1000);
          onChange();
        }}
      >
        時計を 1 時間進める
      </button>
      <button
        className="sheet-row"
        onClick={() => {
          store.dev.bumpIslandLevel();
          onChange();
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
              onChange();
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
  );
}
