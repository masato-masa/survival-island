import { useState } from 'react';

import { Game } from './ui/Game';
import { Home } from './ui/Home';
import './ui/shared/tokens.css';
import './ui/shared/chrome.css';
import './ui/styles.css';

// セーブは store（シングルトン）が一元管理するので、ここではホームと
// プレイ画面のどちらを見せているかだけを持てばよい。
export function App() {
  const [screen, setScreen] = useState<'home' | 'game'>('home');

  if (screen === 'home') {
    return <Home onStart={() => setScreen('game')} />;
  }
  return <Game onExit={() => setScreen('home')} />;
}
