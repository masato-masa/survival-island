// スパイク: 「Pigg Island 風の質感」がこのゲームで作れるか確かめるための試作フィールド。
//
// ゲーム本体（src/game）・Canvas 描画（src/render）には一切つながっていない。
// 砂浜に木を置いただけの見た目確認用の使い捨て画面。テスト用メニューからだけ開ける。
//
// 現在のドット絵パイプライン（16px グリッド・ニアレストネイバー拡大）とは別物で、
// ここでは滑らかな塗りの絵をそのままの解像度で使っている（image-rendering は既定の滑らか）。

import piggPalm from '@/assets/pigg/pigg_palm.png?url';
import piggRock from '@/assets/pigg/pigg_rock.png?url';
import piggSand from '@/assets/pigg/pigg_sand.png?url';

// 決定的に散らす（毎回同じ配置になるように、Math.random は使わない）。
function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const PALM_COUNT = 9;
const ROCK_COUNT = 5;

export function PiggTestField({ onClose }: { onClose: () => void }) {
  const palms = Array.from({ length: PALM_COUNT }, (_, i) => ({
    left: 4 + hash(i * 2) * 88,
    top: 6 + hash(i * 2 + 1) * 22,
    scale: 0.75 + hash(i * 2 + 5) * 0.5,
  }));
  const rocks = Array.from({ length: ROCK_COUNT }, (_, i) => ({
    left: 8 + hash(i * 3 + 100) * 84,
    top: 38 + hash(i * 3 + 101) * 50,
    scale: 0.5 + hash(i * 3 + 105) * 0.4,
  }));

  return (
    <div className="pigg-field">
      <div
        className="pigg-field-ground"
        style={{ backgroundImage: `url(${piggSand})` }}
      />
      {palms.map((p, i) => (
        <img
          key={`palm-${i}`}
          src={piggPalm}
          className="pigg-obj"
          style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.scale * 22}vmin` }}
          alt=""
        />
      ))}
      {rocks.map((r, i) => (
        <img
          key={`rock-${i}`}
          src={piggRock}
          className="pigg-obj"
          style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.scale * 9}vmin` }}
          alt=""
        />
      ))}
      <div className="pigg-field-badge">
        絵柄テスト（試作・スパイク）
        <span>ゲーム本体にはつながっていません</span>
      </div>
      <button className="pigg-field-close" onClick={onClose}>
        もどる
      </button>
    </div>
  );
}
