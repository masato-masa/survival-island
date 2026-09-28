import { Game } from './ui/Game';
import './ui/styles.css';

// アイドル/箱庭ゲームとして作り直したので、ホーム画面を持たない。
// 起動したら即プレイ画面（初回だけ神のお告げシートが重なる）。
export function App() {
  return <Game />;
}
