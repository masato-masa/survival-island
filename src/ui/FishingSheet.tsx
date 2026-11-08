// 釣り（SI-9）: 桟橋で開く。浮きが左右に動くので、中央のあたりで「つる！」を押す。
// 中央のいちばん狭いところで合わせると大物が出ることがある。1 回 1 スタミナ。

import { useEffect, useRef, useState } from 'react';

import { fishQuality } from '@/game/actions';
import { FISH_GOOD_HALF, FISH_PERFECT_HALF, SWIFT_FISH_WIDEN } from '@/game/data';
import { hasBuff } from '@/game/rules';
import type { CatchQuality } from '@/game/actions';
import { currentStamina } from '@/game/time';
import type { Result, SaveState } from '@/game/types';
import { spriteDataUrl } from '@/render/sprites';

import { Sheet } from './Sheets';

/** 浮きが端から端まで行くのにかかる時間（ms）。 */
const SWEEP_MS = 1300;
/** 結果を見せている間、浮きを止める時間（ms）。 */
const HOLD_MS = 900;

/** 時間 t（ms）から、0〜1 を往復する浮きの位置。 */
export function bobberPos(t: number): number {
  const phase = (t % (SWEEP_MS * 2)) / SWEEP_MS;
  return phase < 1 ? phase : 2 - phase;
}

const MESSAGES: Record<string, string> = {
  fish: 'さかなが釣れた！',
  bigFish: '大物だ！ 大きなさかなが釣れた！',
  none: '逃げられた…',
};

export function FishingSheet({
  save,
  now,
  onCast,
  onClose,
}: {
  save: SaveState;
  now: () => number;
  onCast: (quality: CatchQuality) => Result;
  onClose: () => void;
}) {
  const [pos, setPos] = useState(0);
  const [held, setHeld] = useState<{ quality: CatchQuality; message: string } | null>(null);
  const [, bump] = useState(0);
  const posRef = useRef(0);
  const heldRef = useRef(false);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      if (!heldRef.current) {
        posRef.current = bobberPos(t - start);
        setPos(posRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stamina = currentStamina(save, now()).value;
  const swift = hasBuff(save, 'swift', now());
  const w = swift ? SWIFT_FISH_WIDEN : 1;
  const zone = (half: number) => ({ left: `${(0.5 - half * w) * 100}%`, width: `${half * w * 200}%` });
  const fish = save.inventory.fish ?? 0;
  const big = save.inventory.bigFish ?? 0;

  const cast = () => {
    if (heldRef.current) return;
    const quality = fishQuality(posRef.current, hasBuff(save, 'swift', now()));
    const r = onCast(quality);
    if (!r.ok) {
      setHeld({ quality: 'miss', message: 'スタミナが足りません' });
    } else {
      const ev = r.events.find((e) => e.type === 'fished');
      const item = ev && ev.type === 'fished' ? ev.item : null;
      setHeld({ quality, message: MESSAGES[item ?? 'none'] ?? '' });
    }
    heldRef.current = true;
    bump((n) => n + 1);
    window.setTimeout(() => {
      heldRef.current = false;
      setHeld(null);
    }, HOLD_MS);
  };

  return (
    <Sheet title="釣り" subtitle="浮きが中央に来たところで「つる！」" onClose={onClose}>
      <div className="fish-bar" aria-hidden>
        <div className="fish-zone good" style={zone(FISH_GOOD_HALF)} />
        <div className="fish-zone perfect" style={zone(FISH_PERFECT_HALF)} />
        <div className={`fish-bobber${held ? ` ${held.quality}` : ''}`} style={{ left: `${pos * 100}%` }} />
      </div>
      {swift && <p className="sheet-text">手早い効き目で、合わせられる幅が広がっています。</p>}
      <p className="sheet-text fish-msg">{held ? held.message : stamina < 1 ? 'スタミナが足りません' : '浮きをよく見て…'}</p>
      <button type="button" className="fish-cast" disabled={stamina < 1 || held !== null} onClick={cast}>
        つる！（スタミナ 1）
      </button>
      <div className="fish-stock">
        <span><img src={spriteDataUrl('item_fish')} alt="" /> さかな {fish}</span>
        <span><img src={spriteDataUrl('item_bigFish')} alt="" /> 大きなさかな {big}</span>
      </div>
      <p className="sheet-text">釣った魚は、作業台の「ごはん」で焼き魚などにして食べられます。</p>
    </Sheet>
  );
}
