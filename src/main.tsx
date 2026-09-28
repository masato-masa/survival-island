import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';

import { App } from './App';
import { store } from './game/store';
import { loadArt } from './render/sprites';

// 開発中だけ、ブラウザのコンソールや自動テストから状態を覗けるようにする。
if (import.meta.env.DEV) (window as unknown as { __store: typeof store }).__store = store;

function render() {
  // 端末の「動きを減らす」設定に、アプリ全体で従う。
  // reducedMotion="user" は transform と opacity の動きだけを止め、
  // 色や影の変化は残すので、見た目が壊れない。
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </StrictMode>,
  );
}

// Kenney 素材を先に読み込んでから初回描画する（差し替え忘れのチラつき防止）。
// ただし読み込みが遅い・失敗する場合に画面が固まらないよう、1.5 秒でタイムアウト
// してコード版フォールバックのまま進む（CLAUDE.md: 無言で固まる 1 秒は許容しない）。
function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Promise.race([loadArt(), timeout(1500)]).then(render);
