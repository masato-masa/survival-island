import { describe, expect, it } from 'vitest';

import {
  baseScaleFor,
  clampCameraCenter,
  clampZoom,
  computeClampBounds,
  screenToWorld,
  stepCamera,
  TILE,
  worldToScreen,
  type CameraState,
  type Viewport,
} from '../src/render/camera';

describe('baseScaleFor', () => {
  it('縦持ち（幅が短辺）では、幅に 10.5 マスが収まるスケールを返す', () => {
    const s = baseScaleFor(390, 844);
    expect(s).toBeCloseTo(390 / (10.5 * TILE));
    const tilesAcross = 390 / s / TILE;
    expect(tilesAcross).toBeCloseTo(10.5);
  });

  it('横持ち・PC（高さが短辺）では、高さに 10.5 マスが収まるスケールを返す', () => {
    const s = baseScaleFor(1100, 700);
    expect(s).toBeCloseTo(700 / (10.5 * TILE));
    const tilesTall = 700 / s / TILE;
    expect(tilesTall).toBeCloseTo(10.5);
  });
});

describe('clampZoom', () => {
  it('0.6〜2.0 の範囲にクランプする', () => {
    expect(clampZoom(0.1)).toBe(0.6);
    expect(clampZoom(5)).toBe(2.0);
    expect(clampZoom(1.2)).toBe(1.2);
  });
});

describe('computeClampBounds / clampCameraCenter', () => {
  it('マップがビューポートより大きい時は端で止める', () => {
    const bounds = computeClampBounds(2000, 2000, 800, 600);
    expect(bounds.minX).toBe(400);
    expect(bounds.maxX).toBe(2000 - 400);
    const c = clampCameraCenter(-100, 5000, bounds);
    expect(c.x).toBe(bounds.minX);
    expect(c.y).toBe(bounds.maxY);
  });

  it('マップがビューポートより小さい軸は中央寄せになる', () => {
    const bounds = computeClampBounds(300, 300, 800, 600);
    expect(bounds.minX).toBe(bounds.maxX);
    expect(bounds.minX).toBe(150);
    expect(bounds.minY).toBe(bounds.maxY);
    expect(bounds.minY).toBe(150);
  });
});

describe('stepCamera', () => {
  it('プレイヤーへ滑らかに近づき、マップ外へは出ない', () => {
    let cam: CameraState = { x: 0, y: 0, zoom: 1 };
    const mapW = 2000;
    const mapH = 2000;
    const vw = 800;
    const vh = 600;
    for (let i = 0; i < 200; i++) {
      cam = stepCamera(cam, 5000, 5000, 1 / 60, mapW, mapH, vw, vh);
    }
    // 十分な時間が経てば許容範囲の最大値（マップ端でのクランプ）に収束する
    const bounds = computeClampBounds(mapW, mapH, vw, vh);
    expect(cam.x).toBeCloseTo(bounds.maxX, 0);
    expect(cam.y).toBeCloseTo(bounds.maxY, 0);
  });

  it('小さいマップでは中央から動かない', () => {
    let cam: CameraState = { x: 150, y: 150, zoom: 1 };
    cam = stepCamera(cam, 999, 999, 1 / 60, 300, 300, 800, 600);
    expect(cam.x).toBe(150);
    expect(cam.y).toBe(150);
  });
});

describe('worldToScreen / screenToWorld round trip', () => {
  it('往復すると元に戻る', () => {
    const cam: CameraState = { x: 320, y: 480, zoom: 1.3 };
    const viewport: Viewport = { widthCssPx: 800, heightCssPx: 600, baseScale: 2.5 };
    const world = { x: 111.5, y: 222.25 };
    const screen = worldToScreen(world.x, world.y, cam, viewport);
    const back = screenToWorld(screen.x, screen.y, cam, viewport);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('カメラ中心はビューポート中心に描かれる', () => {
    const cam: CameraState = { x: 100, y: 100, zoom: 1 };
    const viewport: Viewport = { widthCssPx: 800, heightCssPx: 600, baseScale: 1 };
    const s = worldToScreen(100, 100, cam, viewport);
    expect(s.x).toBeCloseTo(400);
    expect(s.y).toBeCloseTo(300);
  });
});
