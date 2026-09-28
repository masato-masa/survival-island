import { useState } from 'react';

import { Game } from './ui/Game';
import { PiggTestField } from './ui/PiggTestField';
import './ui/styles.css';

// アイドル/箱庭ゲームとして作り直したので、ホーム画面を持たない。
// 起動したら即プレイ画面（初回だけ神のお告げシートが重なる）。
//
// piggTest はゲーム本体と無関係な見た目確認用スパイク。テスト用メニューからだけ開ける。
export function App() {
  const [screen, setScreen] = useState<'game' | 'piggTest'>('game');
  if (screen === 'piggTest') return <PiggTestField onClose={() => setScreen('game')} />;
  return <Game onOpenPiggTest={() => setScreen('piggTest')} />;
}
