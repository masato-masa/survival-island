// カメラ：プレイヤーを滑らかに追いつつ、マップの外を映さない。
// 純粋なデータ操作だけを置く（Canvas に触らない）。テストしやすくするため。

export const TILE = 32; // 1 マス = 32 ワールドピクセル

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.0;

/** 基準の見え方：画面の横幅にちょうど 10 マス収まる大きさ（向きによらず横幅が基準）。 */
export const TILES_ACROSS_WIDTH = 10;

/** 基準スケール：画面の横幅に 10 マスが収まる大きさ。 */
export function baseScaleFor(viewportWidthCssPx: number, _viewportHeightCssPx: number): number {
  return viewportWidthCssPx / (TILES_ACROSS_WIDTH * TILE);
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
 *
 * anchorX/anchorY（既定 0.5）は「プレイヤーを画面のどこに固定するか」（0=最上/左、
 * 1=最下/右）。pigg 風の低いカメラでは Y を 0.5 より大きくして、プレイヤーを画面の
 * やや下に置く（進行方向側が広く見える）。左右・上下の余白配分が変わるだけで、
 * 合計（leftExtent+rightExtent など）は anchor によらず常に viewWidthPx/viewHeightPx
 * なので、「マップがビューポートより小さいか」の判定式自体は変えなくてよい。
 */
export function computeClampBounds(
  mapWidthPx: number,
  mapHeightPx: number,
  viewWidthPx: number,
  viewHeightPx: number,
  anchorX = 0.5,
  anchorY = 0.5,
): ClampBounds {
  const leftExtent = viewWidthPx * anchorX;
  const rightExtent = viewWidthPx * (1 - anchorX);
  const topExtent = viewHeightPx * anchorY;
  const bottomExtent = viewHeightPx * (1 - anchorY);

  let minX: number;
  let maxX: number;
  if (mapWidthPx <= viewWidthPx) {
    minX = maxX = mapWidthPx / 2;
  } else {
    minX = leftExtent;
    maxX = mapWidthPx - rightExtent;
  }

  let minY: number;
  let maxY: number;
  if (mapHeightPx <= viewHeightPx) {
    minY = maxY = mapHeightPx / 2;
  } else {
    minY = topExtent;
    maxY = mapHeightPx - bottomExtent;
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
  anchorX = 0.5,
  anchorY = 0.5,
): CameraState {
  const f = followFactor(dtSec, halfLifeSec);
  const nx = cam.x + (targetWorldPxX - cam.x) * f;
  const ny = cam.y + (targetWorldPxY - cam.y) * f;
  const bounds = computeClampBounds(mapWidthPx, mapHeightPx, viewWidthPx, viewHeightPx, anchorX, anchorY);
  const clamped = clampCameraCenter(nx, ny, bounds);
  return { x: clamped.x, y: clamped.y, zoom: cam.zoom };
}

export interface Viewport {
  widthCssPx: number;
  heightCssPx: number;
  baseScale: number;
  // プレイヤー（＝カメラ中心）を画面のどこに固定するか（0=最上/左、1=最下/右）。
  // 省略時は 0.5（画面中央）＝これまでどおりの見下ろし視点。pigg 風の低いカメラでは
  // WorldView 側が anchorY を 0.5 より大きくして渡す。
  anchorX?: number;
  anchorY?: number;
}

export function effectiveScale(cam: CameraState, baseScale: number): number {
  return baseScale * clampZoom(cam.zoom);
}

// ---------------------------------------------------------------------------
// 斜めから見る視点（遠近法つき）。
//
// 地面は「真上から TILT だけ手前に傾けたカメラ」で見る。焦点（cam.x, cam.y）の地点では 1 ワールド px が
// scale px（= baseScale × ズーム）になり、そこより奥（北）は小さく、手前（南）は大きく見える。
// だから縦に並んだマスは台形（奥ほど狭い）になり、背の高い物は手前の物の後ろに隠れる。
// 立っている物（木・家具・人）は、足元の投影点に「まっすぐ立てた板」として、その地点の倍率 k で描く。

/** カメラの傾き（真上から手前へ）。0 で真上、90° で真横。 */
export const TILT_DEG = 42;
const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);
const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);
/** カメラから焦点までの距離（ワールド px）。小さいほど遠近が強い。 */
export const CAMERA_DISTANCE = 9 * TILE;

export interface ScreenPoint {
  x: number;
  y: number;
  /** その地点での倍率（1 ワールド px が何 css px か）。立てて描く物の大きさに掛ける。 */
  k: number;
}

/** ワールド px → 画面 css px（キャンバスの CSS サイズ基準。DPR は描画側で別に掛ける）。 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  cam: CameraState,
  viewport: Viewport,
): ScreenPoint {
  const scale = effectiveScale(cam, viewport.baseScale);
  const ax = viewport.anchorX ?? 0.5;
  const ay = viewport.anchorY ?? 0.5;
  const dx = worldX - cam.x;
  const dy = worldY - cam.y;
  const depth = Math.max(CAMERA_DISTANCE * 0.25, CAMERA_DISTANCE - dy * TILT_SIN);
  const k = (scale * CAMERA_DISTANCE) / depth;
  return {
    x: viewport.widthCssPx * ax + dx * k,
    y: viewport.heightCssPx * ay + dy * TILT_COS * k,
    k,
  };
}

/** 画面 css px → 地面のワールド px（worldToScreen の逆）。 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  cam: CameraState,
  viewport: Viewport,
): { x: number; y: number } {
  const scale = effectiveScale(cam, viewport.baseScale);
  const ax = viewport.anchorX ?? 0.5;
  const ay = viewport.anchorY ?? 0.5;
  const sy = screenY - viewport.heightCssPx * ay;
  const dy = (sy * CAMERA_DISTANCE) / (scale * CAMERA_DISTANCE * TILT_COS + sy * TILT_SIN);
  const depth = CAMERA_DISTANCE - dy * TILT_SIN;
  const k = (scale * CAMERA_DISTANCE) / depth;
  return {
    x: (screenX - viewport.widthCssPx * ax) / k + cam.x,
    y: dy + cam.y,
  };
}

/** タイル座標（マス単位、浮動小数）→ ワールド px。 */
export function tileToWorldPx(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE, y: ty * TILE };
}
