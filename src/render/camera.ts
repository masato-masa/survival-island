// カメラ：プレイヤーを滑らかに追いつつ、マップの外を映さない。
// 純粋なデータ操作だけを置く（Canvas に触らない）。テストしやすくするため。

export const TILE = 32; // 1 マス = 32 ワールドピクセル

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.0;

/** Stardew 風の見え方に寄せた基準タイル数：画面の短辺に 10.5 マス収まる大きさ
 *  （縦持ちスマホなら幅、横持ち・PC なら高さが「短辺」になる）。 */
export const TILES_ACROSS_SHORT_SIDE = 10.5;

/** 基準スケール：画面の短辺に ~10.5 マスが収まる大きさ。 */
export function baseScaleFor(viewportWidthCssPx: number, viewportHeightCssPx: number): number {
  const shortSide = Math.min(viewportWidthCssPx, viewportHeightCssPx);
  return shortSide / (TILES_ACROSS_SHORT_SIDE * TILE);
}

export interface CameraState {
  x: number; // ワールド px（見ている中心）
  y: number;
  zoom: number; // ユーザーズーム倍率（baseScale に掛ける）
}

export function createCamera(): CameraState {
  return { x: 0, y: 0, zoom: 1 };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * 臨界減衰ばね的な追従。frame-rate に依存しないよう exponential decay を使う。
 * halfLifeSec 後に距離が半分になるような lerp 係数を dt から作る。
 */
export function followFactor(dtSec: number, halfLifeSec: number): number {
  if (halfLifeSec <= 0) return 1;
  return 1 - Math.pow(0.5, dtSec / halfLifeSec);
}

export interface ClampBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

/**
 * ビューポート（ワールド px 単位）に対して、マップ（ワールド px 単位）の外を
 * 映さないためのカメラ中心の許容範囲を作る。マップがビューポートより小さい軸は
 * 中央寄せ（min == max == センター）にする。
 */
export function computeClampBounds(
  mapWidthPx: number,
  mapHeightPx: number,
  viewWidthPx: number,
  viewHeightPx: number,
): ClampBounds {
  const halfW = viewWidthPx / 2;
  const halfH = viewHeightPx / 2;

  let minX: number;
  let maxX: number;
  if (mapWidthPx <= viewWidthPx) {
    minX = maxX = mapWidthPx / 2;
  } else {
    minX = halfW;
    maxX = mapWidthPx - halfW;
  }

  let minY: number;
  let maxY: number;
  if (mapHeightPx <= viewHeightPx) {
    minY = maxY = mapHeightPx / 2;
  } else {
    minY = halfH;
    maxY = mapHeightPx - halfH;
  }

  return { minX, maxX, minY, maxY, centerX: mapWidthPx / 2, centerY: mapHeightPx / 2 };
}

export function clampCameraCenter(x: number, y: number, bounds: ClampBounds): { x: number; y: number } {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  };
}

/**
 * カメラを 1 フレーム分更新する。targetXY はワールド px（プレイヤー位置など）。
 * 戻り値は新しい CameraState（クランプ済み）。
 */
export function stepCamera(
  cam: CameraState,
  targetWorldPxX: number,
  targetWorldPxY: number,
  dtSec: number,
  mapWidthPx: number,
  mapHeightPx: number,
  viewWidthPx: number,
  viewHeightPx: number,
  // WALK_SPEED を上げた分、追従を少し締めないとプレイヤーが画面中心から
  // 目に見えて遅れる（0.12 → 0.09）。
  halfLifeSec = 0.09,
): CameraState {
  const f = followFactor(dtSec, halfLifeSec);
  const nx = cam.x + (targetWorldPxX - cam.x) * f;
  const ny = cam.y + (targetWorldPxY - cam.y) * f;
  const bounds = computeClampBounds(mapWidthPx, mapHeightPx, viewWidthPx, viewHeightPx);
  const clamped = clampCameraCenter(nx, ny, bounds);
  return { x: clamped.x, y: clamped.y, zoom: cam.zoom };
}

export interface Viewport {
  widthCssPx: number;
  heightCssPx: number;
  baseScale: number;
}

export function effectiveScale(cam: CameraState, baseScale: number): number {
  return baseScale * clampZoom(cam.zoom);
}

/** ワールド px → 画面 css px（キャンバスの CSS サイズ基準。DPR は描画側で別に掛ける）。 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  cam: CameraState,
  viewport: Viewport,
): { x: number; y: number } {
  const scale = effectiveScale(cam, viewport.baseScale);
  return {
    x: (worldX - cam.x) * scale + viewport.widthCssPx / 2,
    y: (worldY - cam.y) * scale + viewport.heightCssPx / 2,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  cam: CameraState,
  viewport: Viewport,
): { x: number; y: number } {
  const scale = effectiveScale(cam, viewport.baseScale);
  return {
    x: (screenX - viewport.widthCssPx / 2) / scale + cam.x,
    y: (screenY - viewport.heightCssPx / 2) / scale + cam.y,
  };
}

/** タイル座標（マス単位、浮動小数）→ ワールド px。 */
export function tileToWorldPx(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE, y: ty * TILE };
}
