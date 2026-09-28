import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';

import { App } from './App';
import { store } from './game/store';

// 開発中だけ、ブラウザのコンソールや自動テストから状態を覗けるようにする。
if (import.meta.env.DEV) (window as unknown as { __store: typeof store }).__store = store;

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
