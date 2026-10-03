// このゲーム専用のアイコン。shared-ui のものではないので、ここに直接置く。
// ピグライフのボタンの絵に合わせて「塗りの 2 色 + 同じ色相の濃い輪郭 + 左上の白いつや」で描く
// （線だけのアイコンは使わない）。すべて 24x24 の枠。実測値の一覧は styles.css の先頭。

const OUTLINE = 1.1;

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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8.5V7a4 4 0 0 1 8 0v1.5" fill="none" stroke="#a8682e" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.2 10.4c0-1.3 1-2.2 2.3-2.2h11c1.3 0 2.3.9 2.3 2.2l-.6 8.6c-.1 1.4-1.2 2.4-2.6 2.4H7.4c-1.4 0-2.5-1-2.6-2.4z" fill="#e9a85a" stroke="#a8682e" strokeWidth={OUTLINE} />
      <path d="M4.3 10.6c2.4 2.2 5 3.2 7.7 3.2s5.3-1 7.7-3.2c0-1.4-1-2.4-2.3-2.4H6.6c-1.3 0-2.3 1-2.3 2.4z" fill="#f6c27a" stroke="#a8682e" strokeWidth={OUTLINE} />
      <rect x="10.4" y="12.3" width="3.2" height="3.2" rx="0.9" fill="#ffe08a" stroke="#a8682e" strokeWidth={OUTLINE} />
      <path d="M6.6 10.2c.6-.5 1.3-.7 2.3-.7" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

/** 下「もくひょう」。赤い旗。 */
export function GoalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.2 3.2v18" stroke="#a8743c" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7 4.2h11.4c.7 0 1 .8.5 1.3L16 8.4l2.9 2.9c.5.5.2 1.3-.5 1.3H7z" fill="#ff7c79" stroke="#d24f4c" strokeWidth={OUTLINE} strokeLinejoin="round" />
      <path d="M8.6 6h5.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />
      <circle cx="6.2" cy="3" r="1.7" fill="#ffd34d" stroke="#c9952a" strokeWidth="0.9" />
    </svg>
  );
}

/** 下「模様替え」。ピンクのソファ（家具を置く操作だと一目でわかる絵）。 */
export function BrushIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.2 10.5V8.4c0-1.8 1.4-3.2 3.2-3.2h7.2c1.8 0 3.2 1.4 3.2 3.2v2.1" fill="#ffb3c4" stroke="#d76f8c" strokeWidth={OUTLINE} />
      <rect x="2.6" y="10" width="18.8" height="7.6" rx="2.6" fill="#ff98b0" stroke="#d76f8c" strokeWidth={OUTLINE} />
      <rect x="6.4" y="11.6" width="11.2" height="3.4" rx="1.4" fill="#ffc6d3" stroke="#d76f8c" strokeWidth="0.9" />
      <path d="M5 17.6v2.2M19 17.6v2.2" stroke="#a8743c" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 7.2c.8-.5 1.7-.7 3-.7" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="hud-heart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9db4" />
          <stop offset="1" stopColor="#ff5a72" />
        </linearGradient>
      </defs>
      <path d="M12 21.2S2.6 15.4 2.6 9a5 5 0 0 1 9.4-2.4A5 5 0 0 1 21.4 9c0 6.4-9.4 12.2-9.4 12.2z" fill="url(#hud-heart)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <ellipse cx="7.4" cy="8.6" rx="2.1" ry="1.4" fill="#fff" opacity="0.75" transform="rotate(-30 7.4 8.6)" />
    </svg>
  );
}

/** 経験値のゲージのつまみ。ラベンダーの星（ピグのジェムの星ゲージと同じ紫 #8992e6）。 */
export function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="hud-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6d9ff" />
          <stop offset="1" stopColor="#8f86ea" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.4l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.2l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"
        fill="url(#hud-star)"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <ellipse cx="9.6" cy="9.4" rx="1.6" ry="1" fill="#fff" opacity="0.8" transform="rotate(-25 9.6 9.4)" />
    </svg>
  );
}

/** 島レベルのゲージのつまみ。緑の双葉（ピグの経験値の葉っぱと同じ緑 #3fda43 / #1aaf1f）。 */
export function SproutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="hud-leaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9cf07c" />
          <stop offset="1" stopColor="#1aaf1f" />
        </linearGradient>
      </defs>
      {/* ピグの経験値の葉と同じ、ふっくらした 1 枚葉（白の太いふち・左上のつや） */}
      <path
        d="M4.2 19.8C2.6 12.6 6.4 4.6 19.6 3.2c1.2 7.4-2.4 16-12.6 16.8-1.1.1-2 .1-2.8-.2z"
        fill="url(#hud-leaf)"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M5.6 18.4C8.8 13.6 12.4 10 16.6 6.8" fill="none" stroke="#1a8f1f" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      <ellipse cx="9.6" cy="9.4" rx="2.6" ry="1.5" fill="#fff" opacity="0.7" transform="rotate(-38 9.6 9.4)" />
    </svg>
  );
}
