import uiBag from '@/assets/gen/ui_bag.png';
import uiFlag from '@/assets/gen/ui_flag.png';
import uiSofa from '@/assets/gen/ui_sofa.png';
import uiHeart from '@/assets/gen/ui_heart.png';
import uiStar from '@/assets/gen/ui_star.png';
import uiSprout from '@/assets/gen/ui_sprout.png';
import weatherCloudy from '@/assets/gen/weather_cloudy.png';
import weatherRainy from '@/assets/gen/weather_rainy.png';
import weatherSunny from '@/assets/gen/weather_sunny.png';

// このゲーム専用のアイコン。shared-ui のものではないので、ここに直接置く。
// ピグライフのボタンの絵に合わせて「塗りの 2 色 + 同じ色相の濃い輪郭 + 左上の白いつや」で描く
// （線だけのアイコンは使わない）。すべて 24x24 の枠。実測値の一覧は styles.css の先頭。


/** 右上「?」。あそびかたを開く。茶色 #8a6640 の太字。 */
export function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.6 9.2a3.4 3.4 0 1 1 5.1 2.95c-1 .58-1.7 1.1-1.7 2.35"
        fill="none"
        stroke="#8a6640"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="18.6" r="1.9" fill="#8a6640" />
    </svg>
  );
}

/** 右上の歯車。ピグの右上の歯車と同じく茶の塗り。 */
export function SettingsIcon() {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return `rotate(${(a * 180) / Math.PI} 12 12)`;
  });
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {teeth.map((t, i) => (
        <rect key={i} x="10" y="2.2" width="4" height="5" rx="1.2" fill="#8a6640" transform={t} />
      ))}
      <circle cx="12" cy="12" r="7" fill="#8a6640" />
      <circle cx="12" cy="12" r="2.8" fill="#f4dec0" />
    </svg>
  );
}

/** 下「もちもの」。革の肩かけかばん。 */
export function BagIcon() {
  return <img src={uiBag} alt="" draggable={false} />;
}

/** 下「もくひょう」。赤い旗。 */
export function GoalIcon() {
  return <img src={uiFlag} alt="" draggable={false} />;
}

/** 下「模様替え」。ピンクのソファ（家具を置く操作だと一目でわかる絵）。 */
export function BrushIcon() {
  return <img src={uiSofa} alt="" draggable={false} />;
}

/** シート右上の × （赤い丸の上に白い太線）。 */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  );
}

/** スタミナのゲージのつまみ。ピンクのハート + 白いつや。 */
export function HeartIcon() {
  return <img src={uiHeart} alt="" draggable={false} />;
}

/** 経験値のゲージのつまみ。ラベンダーの星（ピグのジェムの星ゲージと同じ紫 #8992e6）。 */
export function StarIcon() {
  return <img src={uiStar} alt="" draggable={false} />;
}

/** 島レベルのゲージのつまみ。緑の双葉（ピグの経験値の葉っぱと同じ緑 #3fda43 / #1aaf1f）。 */
export function SproutIcon() {
  return <img src={uiSprout} alt="" draggable={false} />;
}

/** 天気のアイコン（HUD と もくひょう用）。ChatGPT 製の絵（scripts/slice-gen.mjs の weather シート）。 */
export function WeatherIcon({ id }: { id: 'sunny' | 'cloudy' | 'rainy' | 'plain' }) {
  const src = id === 'sunny' ? weatherSunny : id === 'rainy' ? weatherRainy : weatherCloudy;
  return <img src={src} alt="" draggable={false} />;
}
