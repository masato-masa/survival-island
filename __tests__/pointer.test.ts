import { describe, expect, it } from 'vitest';

import {
  distance,
  dragStickAnchor,
  isDrag,
  isTap,
  JOYSTICK_DRAG_RADIUS_PX,
  JOYSTICK_FULL_RADIUS_PX,
  keyToDir,
  pinchZoom,
  stickVector,
  TAP_MAX_MS,
  TAP_THRESHOLD_PX,
  vectorFromKeys,
  wheelZoomDelta,
} from '../src/input/pointer';

describe('isDrag / isTap', () => {
  it('しきい値未満の移動はドラッグではない', () => {
    expect(isDrag(0, 0, TAP_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it('しきい値以上の移動はドラッグ', () => {
    expect(isDrag(0, 0, TAP_THRESHOLD_PX, 0)).toBe(true);
    expect(isDrag(0, 0, 0, TAP_THRESHOLD_PX + 5)).toBe(true);
  });

  it('短時間・小移動ならタップ', () => {
    expect(isTap(0, 0, 2, 2, 100)).toBe(true);
  });

  it('移動量が十分でもタップ判定にはならない', () => {
    expect(isTap(0, 0, 50, 0, 100)).toBe(false);
  });

  it('押しっぱなしが長いとタップにならない', () => {
    expect(isTap(0, 0, 1, 1, TAP_MAX_MS + 1)).toBe(false);
  });
});

describe('stickVector', () => {
  it('中心と同じ位置ならゼロベクトル', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 0, y: 0 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('全速の半径以内では距離に比例した大きさ', () => {
    const half = JOYSTICK_FULL_RADIUS_PX / 2;
    const v = stickVector({ x: 0, y: 0 }, { x: half, y: 0 });
    const mag = Math.sqrt(v.x * v.x + v.y * v.y);
    expect(mag).toBeCloseTo(0.5, 5);
    expect(v.x).toBeCloseTo(0.5, 5);
  });

  it('全速半径を超えると大きさは 1 に頭打ち', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: JOYSTICK_FULL_RADIUS_PX * 3, y: 0 });
    const mag = Math.sqrt(v.x * v.x + v.y * v.y);
    expect(mag).toBeCloseTo(1, 5);
  });

  it('方向は 8 方向に丸めずベクトルそのまま', () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 10, y: 20 });
    expect(v.x / v.y).toBeCloseTo(10 / 20, 5);
  });
});

describe('dragStickAnchor（浮くスティック）', () => {
  it('ドラッグ半径以内なら中心は動かない', () => {
    const a = dragStickAnchor({ x: 0, y: 0 }, { x: JOYSTICK_DRAG_RADIUS_PX - 1, y: 0 });
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });

  it('ドラッグ半径を超えたら指の方向へ中心を引きずり、半径ちょうどに保つ', () => {
    const finger = { x: JOYSTICK_DRAG_RADIUS_PX + 30, y: 0 };
    const a = dragStickAnchor({ x: 0, y: 0 }, finger);
    const dist = distance(a, finger);
    expect(dist).toBeCloseTo(JOYSTICK_DRAG_RADIUS_PX, 5);
    expect(a.x).toBeGreaterThan(0);
  });
});

describe('pinchZoom', () => {
  it('距離が 2 倍になればズームも 2 倍', () => {
    const z = pinchZoom(100, 200, 1);
    expect(z).toBeCloseTo(2, 5);
  });

  it('開始距離が 0 なら現在のズームを維持', () => {
    expect(pinchZoom(0, 200, 1.5)).toBe(1.5);
  });
});

describe('wheelZoomDelta', () => {
  it('上スクロール（負の deltaY）で拡大方向', () => {
    expect(wheelZoomDelta(-100)).toBeGreaterThan(1);
  });

  it('下スクロール（正の deltaY）で縮小方向', () => {
    expect(wheelZoomDelta(100)).toBeLessThan(1);
  });
});

describe('keyToDir / vectorFromKeys', () => {
  it('矢印キーと WASD の両方を認識する', () => {
    expect(keyToDir('ArrowUp')).toBe('up');
    expect(keyToDir('w')).toBe('up');
    expect(keyToDir('d')).toBe('right');
    expect(keyToDir('x')).toBeNull();
  });

  it('複数キー押下は正規化された斜め方向になる', () => {
    const v = vectorFromKeys(new Set(['up', 'right']));
    const mag = Math.sqrt(v.x * v.x + v.y * v.y);
    expect(mag).toBeCloseTo(1, 5);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
  });

  it('相反するキーは打ち消し合う', () => {
    const v = vectorFromKeys(new Set(['up', 'down', 'left']));
    expect(v.y).toBe(0);
    expect(v.x).toBeCloseTo(-1, 5);
  });

  it('何も押していなければゼロベクトル', () => {
    const v = vectorFromKeys(new Set());
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });
});
