import { describe, expect, it } from 'vitest';

import {
  baseScaleFor,
  clampCameraCenter,
  clampZoom,
  computeClampBounds,
  ELEV_DEG,
  GROUND_DEPTH,
  HEIGHT_SCALE,
  project3,
  screenToWorld,
  stepCamera,
  TILE,
  TILES_ACROSS_WIDTH,
  worldToScreen,
  type CameraState,
  type Viewport,
} from '../src/render/camera';

describe('baseScaleFor', () => {
  it('向きによらず、横幅に TILES_ACROSS_WIDTH マスが収まるスケールを返す', () => {
    for (const [w, h] of [[390, 844], [1100, 700]] as const) {
      const s = baseScaleFor(w, h);
      expect(w / s / TILE).toBeCloseTo(TILES_ACROSS_WIDTH);
    }
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

  it('anchorY を 0.5 より大きくすると、上側の余白を広く・下側を狭くクランプする', () => {
    const bounds = computeClampBounds(2000, 2000, 800, 600, 0.5, 0.66);
    // 上側の許容量（minY）は anchorY 分だけ大きく、下側（マップ端からの距離）は
    // その分だけ小さくなる。合計は anchor によらず viewHeightPx のまま。
    expect(bounds.minY).toBeCloseTo(600 * 0.66);
    expect(bounds.maxY).toBeCloseTo(2000 - 600 * 0.34);
    // X は anchorX を省略しているので従来どおり中央対称。
    expect(bounds.minX).toBe(400);
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

  it('anchorY を指定すると、カメラ中心はその比率の高さに描かれる（pigg 風の低いカメラ）', () => {
    const cam: CameraState = { x: 100, y: 100, zoom: 1 };
    const viewport: Viewport = { widthCssPx: 800, heightCssPx: 600, baseScale: 1, anchorY: 0.66 };
    const s = worldToScreen(100, 100, cam, viewport);
    expect(s.x).toBeCloseTo(400); // anchorX は省略時 0.5 のまま
    expect(s.y).toBeCloseTo(600 * 0.66);
    const back = screenToWorld(s.x, s.y, cam, viewport);
    expect(back.x).toBeCloseTo(100, 6);
    expect(back.y).toBeCloseTo(100, 6);
  });
});

describe('斜め上からの視点（仰角）', () => {
  const cam: CameraState = { x: 640, y: 640, zoom: 1 };
  const viewport: Viewport = { widthCssPx: 390, heightCssPx: 844, baseScale: 390 / (TILES_ACROSS_WIDTH * TILE), anchorY: 0.62 };

  it('地面の奥行きは sin(仰角)、高さは cos(仰角) に縮む（焦点の地点で）', () => {
    const rad = (ELEV_DEG * Math.PI) / 180;
    expect(GROUND_DEPTH).toBeCloseTo(Math.sin(rad));
    expect(HEIGHT_SCALE).toBeCloseTo(Math.cos(rad));
    const s = viewport.baseScale;
    const o = worldToScreen(cam.x, cam.y, cam, viewport);
    // 焦点のまわりの微小な変位で比べる（遠近の影響を消す）
    const right = worldToScreen(cam.x + 0.01, cam.y, cam, viewport);
    const south = worldToScreen(cam.x, cam.y + 0.01, cam, viewport);
    const up = project3(cam.x, cam.y, 0.01, cam, viewport);
    expect((right.x - o.x) / 0.01).toBeCloseTo(s, 4);
    expect((south.y - o.y) / 0.01).toBeCloseTo(s * GROUND_DEPTH, 3);
    expect((o.y - up.y) / 0.01).toBeCloseTo(s * HEIGHT_SCALE, 3);
  });

  it('z=0 の project3 は worldToScreen と同じ', () => {
    const a = project3(500.5, 700.25, 0, cam, viewport);
    const b = worldToScreen(500.5, 700.25, cam, viewport);
    expect(a).toEqual(b);
  });

  it('奥（北）ほど小さく、手前ほど大きい。ただし画面の上下で 2 倍以上は違わない（弱い遠近）', () => {
    const top = screenToWorld(195, 0, cam, viewport);
    const bottom = screenToWorld(195, 844, cam, viewport);
    const kTop = worldToScreen(top.x, top.y, cam, viewport).k;
    const kBottom = worldToScreen(bottom.x, bottom.y, cam, viewport).k;
    expect(kTop).toBeLessThan(kBottom);
    expect(kBottom / kTop).toBeLessThan(2);
  });

  it('箱の上面が見える：高い点ほど画面の上に来る', () => {
    const base = project3(600, 600, 0, cam, viewport);
    const top = project3(600, 600, 30, cam, viewport);
    const backTopEdge = project3(600, 580, 30, cam, viewport);
    expect(top.y).toBeLessThan(base.y);
    expect(backTopEdge.y).toBeLessThan(top.y); // 上面の奥の縁は手前の縁より上 = 上面に面積がある
  });

  it('タップしたマスの判定がずれない：どのマスの内側の点を投影して逆投影しても、同じマスに戻る', () => {
    for (const zoom of [0.6, 1, 2]) {
      const c: CameraState = { ...cam, zoom };
      for (let ty = 8; ty < 32; ty++) {
        for (let tx = 12; tx < 28; tx++) {
          for (const [fx, fy] of [[0.01, 0.01], [0.5, 0.5], [0.99, 0.99], [0.01, 0.99]] as const) {
            const s = worldToScreen((tx + fx) * TILE, (ty + fy) * TILE, c, viewport);
            if (s.y < 0 || s.y > viewport.heightCssPx) continue;
            const w = screenToWorld(s.x, s.y, c, viewport);
            expect(Math.floor(w.x / TILE)).toBe(tx);
            expect(Math.floor(w.y / TILE)).toBe(ty);
          }
        }
      }
    }
  });

  it('マスの台形の内側の画面の点は、そのマスに当たる（画面側から見ても境界が一致する）', () => {
    // マス (20, 20) の四隅を投影し、台形の中心を逆投影する
    const q = [
      worldToScreen(20 * TILE, 20 * TILE, cam, viewport),
      worldToScreen(21 * TILE, 20 * TILE, cam, viewport),
      worldToScreen(21 * TILE, 21 * TILE, cam, viewport),
      worldToScreen(20 * TILE, 21 * TILE, cam, viewport),
    ];
    const cx = q.reduce((a, p) => a + p.x, 0) / 4;
    const cy = q.reduce((a, p) => a + p.y, 0) / 4;
    const w = screenToWorld(cx, cy, cam, viewport);
    expect(Math.floor(w.x / TILE)).toBe(20);
    expect(Math.floor(w.y / TILE)).toBe(20);
    // 上の辺のすぐ上は 1 つ奥のマス
    const above = screenToWorld(cx, q[0]!.y - 0.5, cam, viewport);
    expect(Math.floor(above.y / TILE)).toBe(19);
  });
});
