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
// 斜め上から見下ろす視点（弱い遠近法つき）。
//
// カメラは焦点（cam.x, cam.y）の真南・上空にあり、地面から ELEV_DEG だけ見下ろす。
//   - 地面の奥行き（南北）は sin(仰角) 倍に縮む … マスは横長の台形になる
//   - 高さ（z）は cos(仰角) 倍に縮む          … 箱の上面が見え、側面は低く見える
// 焦点の地点では横 1 ワールド px が scale px（= baseScale × ズーム）。奥（北）ほど小さく、手前（南）ほど大きい。
//
// 数値はピグライフの画面を実測して決めた（App Store のスクリーンショット 1286×594 のエッジ方向の分布）:
//   - 地面の線は ±23〜27° に集まる → 2:1 のひし形（ひし形の高さ/幅 = 0.50）＝ 仰角 30° の平行投影
//   - 遠近は無い（平行投影）
//   - 1 マスの立方体の見え方は「上面のひし形の高さ 0.71 : 側面の高さ 0.71〜0.87」→ 上面が全高の 45〜50%
// このゲームのマス目は回さない（縦横そろい）ので、立方体の上面が全高の半分になる仰角は 45°。
// ただし 45° では地面が 0.71 に縮み、絵のまま立てる木（ビルボード）が相対的に高く見えて、かえって低い視点に
// 見えた（森が幹の壁になる）。木や人の絵はもともと斜め上から描かれているので、地面をあまりつぶさない 55° にする
// （地面 0.82・高さ 0.57、立方体の上面は全高の 59%）。
// 遠近は少しだけ残す（スマホ縦の画面の上端と下端で倍率 0.77〜1.14 倍。前は 0.46〜1.33 倍（約 3 倍）も違って、低い視点に見えた）。

/** 地面からの見下ろし角（0° で真横、90° で真上）。 */
export const ELEV_DEG = 55;
const ELEV_RAD = (ELEV_DEG * Math.PI) / 180;
/** 地面の奥行きの縮み（南北 1 ワールド px が、横 1 px に対して何倍に見えるか）。 */
export const GROUND_DEPTH = Math.sin(ELEV_RAD);
/** 高さの縮み（z 1 ワールド px が、横 1 px に対して何倍に見えるか）。 */
export const HEIGHT_SCALE = Math.cos(ELEV_RAD);
/** カメラから焦点までの距離（ワールド px）。大きいほど平行投影に近い。 */
export const CAMERA_DISTANCE = 40 * TILE;

export interface ScreenPoint {
  x: number;
  y: number;
  /** その地点での倍率（1 ワールド px が何 css px か）。立てて描く物の大きさに掛ける。 */
  k: number;
}

/** ワールド (x, y, 高さ z)（px）→ 画面 css px。z を省くと地面の点。DPR は描画側で別に掛ける。 */
export function project3(
  worldX: number,
  worldY: number,
  z: number,
  cam: CameraState,
  viewport: Viewport,
): ScreenPoint {
  const scale = effectiveScale(cam, viewport.baseScale);
  const ax = viewport.anchorX ?? 0.5;
  const ay = viewport.anchorY ?? 0.5;
  const dx = worldX - cam.x;
  const dy = worldY - cam.y;
  const depth = Math.max(CAMERA_DISTANCE * 0.25, CAMERA_DISTANCE - dy * HEIGHT_SCALE - z * GROUND_DEPTH);
  const k = (scale * CAMERA_DISTANCE) / depth;
  return {
    x: viewport.widthCssPx * ax + dx * k,
    y: viewport.heightCssPx * ay + (dy * GROUND_DEPTH - z * HEIGHT_SCALE) * k,
    k,
  };
}

/** ワールド px（地面）→ 画面 css px。 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  cam: CameraState,
  viewport: Viewport,
): ScreenPoint {
  return project3(worldX, worldY, 0, cam, viewport);
}

/** 画面 css px → 地面のワールド px（worldToScreen の逆）。タップしたマスの判定に使う。 */
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
  // sy = dy·G·scale·D / (D − dy·H)  を dy について解く
  const dy = (sy * CAMERA_DISTANCE) / (scale * CAMERA_DISTANCE * GROUND_DEPTH + sy * HEIGHT_SCALE);
  const depth = CAMERA_DISTANCE - dy * HEIGHT_SCALE;
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
