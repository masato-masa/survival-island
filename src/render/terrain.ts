// 地面の事前描画（プリレンダー）レイヤー。
//
// マップ全体の「地面」だけを 1 枚のオフスクリーン Canvas に焼いておき、毎フレームは
// そこからカメラの可視範囲をスケールして貼るだけにする（renderer.ts 側）。
// タイル 1 枚ずつスプライトを敷き詰めるだけでは「タイルの継ぎ目」がどうしても
// グリッド状に見えてしまうので、ここでは地面の種類ごとに専用の描画関数を持ち、
// 隣接タイルの境界をノイズでゆらして塗る（水際・道・砂浜・石畳など）。
//
// 決定的な乱数（シード固定）を使うので、同じ World からは何度焼いても同じ絵になる
// （CLAUDE.md: 「決定性を確保する」）。
//
// 重い処理を 1 フレームで終わらせるとカクつくので、行の束ごとに分割して
// requestIdleCallback / setTimeout の間に逃がす（paintTerrainAsync）。

import type { Ground, World } from '@/game/types';

// ---------------------------------------------------------------------------
// 決定的な乱数・ノイズ

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 1 次元のなめらかなゆらぎ（build-map.mjs の wobble と同じ考え方）。 */
function wobble(t: number, seed: number, amp: number, period = 6): number {
  const i = Math.floor(t / period);
  const f = t / period - i;
  const a = hash2i(i, 0, seed) * 2 - 1;
  const b = hash2i(i + 1, 0, seed) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return (a + (b - a) * s) * amp;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 上下左右 4 近傍のオフセット。タプル型を明示し、noUncheckedIndexedAccess で
 *  分割代入の nx/ny が `number | undefined` にならないようにする。 */
const NEIGHBOURS4: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// ---------------------------------------------------------------------------
// パレット（terrain 専用。sprites.ts のパレットより色数を増やし、
// 色相・明度をわずかにずらしたバリエーションを持つ）

const GRASS = ['#7fbb5e', '#8bc36a', '#6fae57', '#9bc774'];
const GRASS_SHADE = '#537f42'; // 森の際の暗い草
const GRASS_FLOWER = ['#e88ab0', '#f0c33a', '#f2f2f2'];
const DIRT = ['#b98a55', '#a8744f', '#8a5a3c'];
const DIRT_WORN = '#c99b66';
const SOIL = ['#6b4a30', '#5a3d28', '#4a3320'];
const SAND = ['#ecd9a0', '#e3cd8e', '#dfc788'];
const SAND_WET = '#c9b276';
const PAVING = ['#a7a9ac', '#949699', '#c7c9cc'];
const PAVING_MORTAR = '#7d8084';
const PAVING_MOSS = '#6f9a5a';
const FOUNDATION_WALL = '#8a8478';
const FOUNDATION_FLOOR = ['#7a5a3f', '#6b4e37'];
const DOCK_WOOD = ['#a8744f', '#8a5a3c', '#c08a52'];
const WATER_SHALLOW = '#3fc9c6';
const WATER_DEEP = '#1a3f6e';
const FOREST_GREEN = ['#3c6e3a', '#4f8f45', '#5a9a4a', '#6fae57'];
const FOREST_DARK = '#264a28';
const FOREST_TRUNK = '#5a3d28';

function mixHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const br = (bh >> 16) & 0xff;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return `rgb(${r},${g},${bl})`;
}

// ---------------------------------------------------------------------------
// 定数

export const TERRAIN_PX = 16; // タイル 1 枚あたりのソース解像度

export interface PaintedTerrain {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tilePx: number;
  width: number; // タイル数
  height: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// 水からの距離（浅瀬→深海のグラデーション用）。BFS で陸からの距離を測る。

function computeWaterDepth(world: World): Float32Array {
  const { width, height, ground } = world;
  const dist = new Float32Array(width * height).fill(-1);
  const queue: number[] = [];
  const isWater = (i: number) => ground[i] === 'water';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isWater(i)) continue;
      // 陸に隣接する水マスを距離 0 の種にする
      for (const [ddx, ddy] of NEIGHBOURS4) {
        const nx = x + ddx;
        const ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!isWater(ny * width + nx)) {
          dist[i] = 0;
          queue.push(i);
          break;
        }
      }
    }
  }
  let head = 0;
  const MAX_D = 8;
  while (head < queue.length) {
    const i = queue[head++]!;
    const d = dist[i]!;
    if (d >= MAX_D) continue;
    const x = i % width;
    const y = (i / width) | 0;
    for (const [ddx, ddy] of NEIGHBOURS4) {
      const nx = x + ddx;
      const ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!isWater(ni)) continue;
      if ((dist[ni] ?? -1) >= 0) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// タイル種別ごとの塗り（1 タイル = TERRAIN_PX 四方。ox,oy はそのタイルの
// オフスクリーン Canvas 上の左上ピクセル）

function paintGrass(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number, shaded: boolean): void {
  const base = shaded ? mixHex(GRASS[0]!, GRASS_SHADE, 0.55) : GRASS[(Math.floor(hash2i(tx, ty, 1) * 4))]!;
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  // ソフトなノイズパッチ（少し濃い緑の斑）
  for (let y = 0; y < TERRAIN_PX; y += 2) {
    for (let x = 0; x < TERRAIN_PX; x += 2) {
      const n = hash2i(tx * 8 + x, ty * 8 + y, 7);
      if (n < 0.22) {
        ctx.fillStyle = shaded ? mixHex(GRASS_SHADE, '#000000', 0.15) : GRASS[2]!;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(ox + x, oy + y, 2, 2);
        ctx.globalAlpha = 1;
      }
    }
  }
  // 葉先・草のブレード（小さな縦線）
  const tufts = 3 + Math.floor(hash2i(tx, ty, 3) * 3);
  for (let i = 0; i < tufts; i++) {
    const rx = Math.floor(hash2i(tx * 3 + i, ty * 5, 4) * (TERRAIN_PX - 2)) + 1;
    const ry = Math.floor(hash2i(tx * 5, ty * 3 + i, 5) * (TERRAIN_PX - 3)) + 1;
    ctx.strokeStyle = shaded ? GRASS_SHADE : GRASS[3]!;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + rx, oy + ry + 2);
    ctx.lineTo(ox + rx + (hash2i(rx, ry, 6) < 0.5 ? -1 : 1), oy + ry);
    ctx.stroke();
  }
  // まれに小さな花
  if (!shaded && hash2i(tx, ty, 9) < 0.16) {
    const fx = Math.floor(hash2i(tx, ty, 10) * (TERRAIN_PX - 2)) + 1;
    const fy = Math.floor(hash2i(tx, ty, 11) * (TERRAIN_PX - 2)) + 1;
    ctx.fillStyle = GRASS_FLOWER[Math.floor(hash2i(tx, ty, 12) * GRASS_FLOWER.length)]!;
    ctx.fillRect(ox + fx, oy + fy, 1, 1);
  }
}

function paintSand(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number, wet: boolean): void {
  ctx.fillStyle = wet ? SAND_WET : SAND[Math.floor(hash2i(tx, ty, 20) * 3)]!;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  for (let y = 0; y < TERRAIN_PX; y++) {
    for (let x = 0; x < TERRAIN_PX; x++) {
      const n = hash2i(tx * 16 + x, ty * 16 + y, 21);
      if (n < 0.1) {
        ctx.fillStyle = wet ? mixHex(SAND_WET, '#000000', 0.2) : SAND[2]!;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function paintDirt(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number): void {
  ctx.fillStyle = DIRT[1]!;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  // 轍で踏み固められた明るい中央帯
  ctx.fillStyle = DIRT_WORN;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(ox + 3, oy, TERRAIN_PX - 6, TERRAIN_PX);
  ctx.globalAlpha = 1;
  for (let y = 0; y < TERRAIN_PX; y += 2) {
    for (let x = 0; x < TERRAIN_PX; x += 2) {
      const n = hash2i(tx * 9 + x, ty * 9 + y, 22);
      if (n < 0.14) {
        ctx.fillStyle = DIRT[2]!;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(ox + x, oy + y, 2, 2);
        ctx.globalAlpha = 1;
      }
    }
  }
  // 小石
  const pebbles = 2 + Math.floor(hash2i(tx, ty, 23) * 3);
  for (let i = 0; i < pebbles; i++) {
    const px = Math.floor(hash2i(tx * 7 + i, ty, 24) * (TERRAIN_PX - 2)) + 1;
    const py = Math.floor(hash2i(tx, ty * 7 + i, 25) * (TERRAIN_PX - 2)) + 1;
    ctx.fillStyle = PAVING[0]!;
    ctx.fillRect(ox + px, oy + py, 1, 1);
  }
}

function paintSoil(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number): void {
  ctx.fillStyle = SOIL[0]!;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  for (let y = 0; y < TERRAIN_PX; y += 2) {
    ctx.fillStyle = (y / 2) % 2 === 0 ? SOIL[1]! : SOIL[0]!;
    ctx.fillRect(ox, oy + y, TERRAIN_PX, 1);
  }
  for (let i = 0; i < 3; i++) {
    const px = Math.floor(hash2i(tx * 5 + i, ty, 26) * TERRAIN_PX);
    const py = Math.floor(hash2i(tx, ty * 5 + i, 27) * TERRAIN_PX);
    ctx.fillStyle = SOIL[2]!;
    ctx.fillRect(ox + px, oy + py, 1, 1);
  }
}

function paintPaving(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number): void {
  // 不揃いな石畳：4〜6 枚のスラブ＋目地。タイルごとにオフセットして継ぎ目をずらす。
  ctx.fillStyle = PAVING_MORTAR;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  const cols = 2;
  const rows = 2;
  const jitterSeed = tx * 31 + ty * 17;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = Math.floor(hash2i(jitterSeed + c, r, 30) * 2) - 1;
      const jy = Math.floor(hash2i(c, jitterSeed + r, 31) * 2) - 1;
      const x0 = c * 8 + 1 + jx;
      const y0 = r * 8 + 1 + jy;
      const w = 6;
      const h = 6;
      const missing = hash2i(tx * 3 + c, ty * 3 + r, 32) < 0.05;
      if (missing) {
        ctx.fillStyle = SOIL[0]!;
        ctx.fillRect(ox + x0, oy + y0, w, h);
        continue;
      }
      ctx.fillStyle = PAVING[Math.floor(hash2i(tx + c, ty + r, 33) * 3)]!;
      ctx.fillRect(ox + x0, oy + y0, w, h);
      // ひび
      if (hash2i(tx + c, ty + r, 34) < 0.3) {
        ctx.strokeStyle = PAVING_MORTAR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox + x0 + 1, oy + y0 + 1);
        ctx.lineTo(ox + x0 + w - 1, oy + y0 + h - 2);
        ctx.stroke();
      }
    }
  }
  // 苔・草のすき間
  if (hash2i(tx, ty, 35) < 0.35) {
    const mx = Math.floor(hash2i(tx, ty, 36) * (TERRAIN_PX - 2)) + 1;
    const my = Math.floor(hash2i(tx, ty, 37) * (TERRAIN_PX - 2)) + 1;
    ctx.fillStyle = hash2i(tx, ty, 38) < 0.5 ? PAVING_MOSS : GRASS[1]!;
    ctx.fillRect(ox + mx, oy + my, 2, 1);
  }
}

function paintFoundation(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number): void {
  paintSoil(ctx, ox, oy, tx, ty);
  ctx.fillStyle = FOUNDATION_FLOOR[Math.floor(hash2i(tx, ty, 40) * 2)]!;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  ctx.globalAlpha = 1;
  if (hash2i(tx, ty, 41) < 0.2) {
    // 崩れ落ちた石ブロック
    ctx.fillStyle = FOUNDATION_WALL;
    const bx = Math.floor(hash2i(tx, ty, 42) * 9) + 2;
    const by = Math.floor(hash2i(tx, ty, 43) * 9) + 2;
    ctx.fillRect(ox + bx, oy + by, 4, 3);
    ctx.fillStyle = PAVING[2]!;
    ctx.fillRect(ox + bx, oy + by, 4, 1);
  }
}

function paintDock(ctx: Ctx2D, ox: number, oy: number, tx: number, ty: number): void {
  ctx.fillStyle = DOCK_WOOD[Math.floor(hash2i(tx, ty, 50) * 3)]!;
  ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
  // 板目（横方向の板が並ぶ）
  for (let y = 0; y < TERRAIN_PX; y += 4) {
    ctx.strokeStyle = DOCK_WOOD[1]!;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(ox, oy + y);
    ctx.lineTo(ox + TERRAIN_PX, oy + y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 釘
  for (let y = 1; y < TERRAIN_PX; y += 4) {
    for (let x = 2; x < TERRAIN_PX; x += 6) {
      ctx.fillStyle = '#3d2b2e';
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 森（forest）：木々のかたまり。地面パスの後、別パスでクラウンを重ねる。

interface Crown {
  cx: number; // ワールド px（オフスクリーン Canvas 座標）
  cy: number;
  r: number;
  color: string;
}

function forestCrownsForTile(world: World, tx: number, ty: number): Crown[] {
  const crowns: Crown[] = [];
  const n = 2 + Math.floor(hash2i(tx, ty, 60) * 2);
  const baseX = tx * TERRAIN_PX + TERRAIN_PX / 2;
  const baseY = ty * TERRAIN_PX + TERRAIN_PX / 2;
  for (let i = 0; i < n; i++) {
    const jx = (hash2i(tx * 4 + i, ty, 61) - 0.5) * TERRAIN_PX * 1.1;
    const jy = (hash2i(tx, ty * 4 + i, 62) - 0.5) * TERRAIN_PX * 0.9;
    const r = 9 + hash2i(tx + i, ty + i, 63) * 5;
    const color = FOREST_GREEN[Math.floor(hash2i(tx * 2 + i, ty * 2 + i, 64) * FOREST_GREEN.length)]!;
    crowns.push({ cx: baseX + jx, cy: baseY + jy, r, color });
  }
  void world;
  return crowns;
}

function paintForestCanopy(ctx: Ctx2D, world: World, tx: number, ty: number): void {
  const { width, height, ground } = world;
  const isForest = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return ground[y * width + x] === 'forest';
  };
  // 南の縁に幹を見せる（森がその先で終わっている場合）
  if (!isForest(tx, ty + 1)) {
    const trunks = 1 + Math.floor(hash2i(tx, ty, 70) * 2);
    for (let i = 0; i < trunks; i++) {
      const tw = 2;
      const tx2 = tx * TERRAIN_PX + 2 + Math.floor(hash2i(tx * 3 + i, ty, 71) * (TERRAIN_PX - 6));
      ctx.fillStyle = FOREST_TRUNK;
      ctx.fillRect(tx2, ty * TERRAIN_PX + TERRAIN_PX - 6, tw, 8);
    }
  }
  // 影：森の南隣が森でない場合、そのマスの上端に落ちる柔らかい影
  if (!isForest(tx, ty + 1) && ty + 1 < height) {
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.16;
    ctx.fillRect(tx * TERRAIN_PX, (ty + 1) * TERRAIN_PX, TERRAIN_PX, 5);
    ctx.globalAlpha = 1;
  }
  // クラウン本体（隣接する非森タイルへ半マス程度はみ出す）
  const crowns = forestCrownsForTile(world, tx, ty);
  // 深い影（重なりの間）を先に、次に本体、最後にハイライト
  for (const c of crowns) {
    ctx.fillStyle = FOREST_DARK;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy + 1, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const c of crowns) {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, c.r * 0.88, 0, Math.PI * 2);
    ctx.fill();
    // 左上ハイライト
    ctx.fillStyle = mixHex(c.color, '#ffffff', 0.35);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(c.cx - c.r * 0.3, c.cy - c.r * 0.3, c.r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 輪郭（森を「壁」として読ませる濃い縁）
  ctx.strokeStyle = FOREST_DARK;
  ctx.lineWidth = 1;
  for (const c of crowns) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, c.r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// 地面の色（境界のブレンド計算用に、そのタイル種別の「代表色」を 1 つ返す）

function groundRepColor(g: Ground, depth: number): string {
  switch (g) {
    case 'water':
      return mixHex(WATER_SHALLOW, WATER_DEEP, clamp01(depth / 8));
    case 'grass':
      return GRASS[1]!;
    case 'sand':
      return SAND[1]!;
    case 'dirt':
      return DIRT[1]!;
    case 'soil':
      return SOIL[0]!;
    case 'paving':
      return PAVING[0]!;
    case 'foundation':
      return FOUNDATION_FLOOR[0]!;
    case 'dock':
      return DOCK_WOOD[0]!;
    case 'forest':
      return FOREST_GREEN[1]!;
    default:
      return '#000000';
  }
}

// 優先度：低いほど「下」に塗られる（水が最下層、道・石畳が最上層に見えるように、
// 境界を有利にゆらす側を決める）。
const GROUND_PRIORITY: Record<Ground, number> = {
  water: 0,
  forest: 1,
  grass: 2,
  sand: 3,
  soil: 4,
  dirt: 5,
  foundation: 5,
  paving: 6,
  dock: 6,
};

// ---------------------------------------------------------------------------
// メインの焼き処理（行の束ごとに分割して呼べるよう、1 バンド分の関数を分離）

interface PaintCtxState {
  world: World;
  ctx: Ctx2D;
  waterDepth: Float32Array;
}

function paintTileBase(state: PaintCtxState, tx: number, ty: number): void {
  const { world, ctx, waterDepth } = state;
  const idx = ty * world.width + tx;
  const g = world.ground[idx];
  const ox = tx * TERRAIN_PX;
  const oy = ty * TERRAIN_PX;

  if (g === undefined) return;
  if (g === 'water') {
    const d = waterDepth[idx] ?? 8;
    ctx.fillStyle = groundRepColor('water', d);
    ctx.fillRect(ox, oy, TERRAIN_PX, TERRAIN_PX);
    return;
  }
  if (g === 'grass') {
    // 森の際は少し暗くする
    let shaded = false;
    for (const [dx, dy] of NEIGHBOURS4) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      if (world.ground[ny * world.width + nx] === 'forest') shaded = true;
    }
    paintGrass(ctx, ox, oy, tx, ty, shaded);
    return;
  }
  if (g === 'sand') {
    let wet = false;
    for (const [dx, dy] of NEIGHBOURS4) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      if (world.ground[ny * world.width + nx] === 'water') wet = true;
    }
    paintSand(ctx, ox, oy, tx, ty, wet);
    return;
  }
  if (g === 'dirt') return paintDirt(ctx, ox, oy, tx, ty);
  if (g === 'soil') return paintSoil(ctx, ox, oy, tx, ty);
  if (g === 'paving') return paintPaving(ctx, ox, oy, tx, ty);
  if (g === 'foundation') return paintFoundation(ctx, ox, oy, tx, ty);
  if (g === 'dock') return paintDock(ctx, ox, oy, tx, ty);
  if (g === 'forest') {
    // 森タイルの地面自体は下草程度（この上にクラウンを重ねて隠す）
    paintGrass(ctx, ox, oy, tx, ty, true);
    return;
  }
}

/** タイル境界を per-pixel 風のノイズで崩す（列単位・行単位の短冊で近似し、軽くする）。 */
function paintBoundaries(state: PaintCtxState, tx: number, ty: number): void {
  const { world, ctx } = state;
  const idx = ty * world.width + tx;
  const g = world.ground[idx];
  if (g === undefined || g === 'forest') return; // 森の境界はクラウンで隠れるので不要
  const ox = tx * TERRAIN_PX;
  const oy = ty * TERRAIN_PX;

  const tryEdge = (nx: number, ny: number, edge: 'E' | 'S') => {
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return;
    const ng = world.ground[ny * world.width + nx];
    if (ng === undefined || ng === g) return;
    if (ng === 'forest') return;
    const winnerIsNeighbour = GROUND_PRIORITY[ng] > GROUND_PRIORITY[g];
    const winnerGround = winnerIsNeighbour ? ng : g;
    const seedBase = tx * 977 + ty * 733 + (edge === 'E' ? 11 : 23);
    const dOff = winnerIsNeighbour ? 1 : -1; // 勝った方がこちらへ食い込む

    if (edge === 'E') {
      for (let by = 0; by < TERRAIN_PX; by += 2) {
        const jitter = Math.round(wobble(by + ty * TERRAIN_PX, seedBase, 2.2, 4));
        const cut = TERRAIN_PX + Math.min(2, Math.max(-2, jitter)) * dOff;
        if (dOff > 0) {
          // 隣（勝者）の色でこちら側を上書き
          paintPatchColor(ctx, winnerGround, ox + Math.max(0, cut), oy + by, TERRAIN_PX - Math.max(0, cut), 2, tx, ty);
        }
      }
    } else {
      for (let bx = 0; bx < TERRAIN_PX; bx += 2) {
        const jitter = Math.round(wobble(bx + tx * TERRAIN_PX, seedBase, 2.2, 4));
        const cut = TERRAIN_PX + Math.min(2, Math.max(-2, jitter)) * dOff;
        if (dOff > 0) {
          paintPatchColor(ctx, winnerGround, ox + bx, oy + Math.max(0, cut), 2, TERRAIN_PX - Math.max(0, cut), tx, ty);
        }
      }
    }
    // 低い側（負けた方）の縁に 1px 暗い縁取り
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    if (edge === 'E') ctx.fillRect(ox + TERRAIN_PX - 1, oy, 1, TERRAIN_PX);
    else ctx.fillRect(ox, oy + TERRAIN_PX - 1, TERRAIN_PX, 1);
  };

  tryEdge(tx + 1, ty, 'E');
  tryEdge(tx, ty + 1, 'S');
}

function paintPatchColor(ctx: Ctx2D, g: Ground, x: number, y: number, w: number, h: number, tx: number, ty: number): void {
  if (w <= 0 || h <= 0) return;
  const shade = hash2i(tx, ty, 99) < 0.5;
  let color: string;
  switch (g) {
    case 'grass':
      color = GRASS[shade ? 2 : 0]!;
      break;
    case 'sand':
      color = SAND[shade ? 2 : 0]!;
      break;
    case 'dirt':
      color = DIRT[shade ? 2 : 0]!;
      break;
    case 'water':
      color = WATER_SHALLOW;
      break;
    case 'paving':
      color = PAVING[shade ? 1 : 2]!;
      break;
    case 'soil':
      color = SOIL[shade ? 1 : 0]!;
      break;
    case 'foundation':
      color = FOUNDATION_FLOOR[0]!;
      break;
    case 'dock':
      color = DOCK_WOOD[0]!;
      break;
    default:
      color = groundRepColor(g, 0);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// 公開 API

/** 同期版（テストや小さいマップ向け）。大きいマップでは paintTerrainAsync を使う。 */
export function paintTerrainSync(world: World): PaintedTerrain {
  const canvas = makeCanvas(world.width * TERRAIN_PX, world.height * TERRAIN_PX);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  const result: PaintedTerrain = { canvas, tilePx: TERRAIN_PX, width: world.width, height: world.height };
  if (!ctx) return result;
  ctx.imageSmoothingEnabled = false;
  const state: PaintCtxState = { world, ctx, waterDepth: computeWaterDepth(world) };
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) paintTileBase(state, x, y);
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) paintBoundaries(state, x, y);
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      if (world.ground[y * world.width + x] === 'forest') paintForestCanopy(ctx, world, x, y);
    }
  return result;
}

export interface PaintProgress {
  done: number;
  total: number;
}

/**
 * 分割して焼く。1 チャンクが長くても ~8ms で終わるよう行数を区切り、
 * setTimeout(0) で次のチャンクをスケジュールする（メインスレッドを固め続けない）。
 * onProgress はローディング表示用。戻り値の Promise は焼き終わったときに解決する。
 */
export function paintTerrainAsync(
  world: World,
  onProgress?: (p: PaintProgress) => void
): Promise<PaintedTerrain & { paintMs: number }> {
  const canvas = makeCanvas(world.width * TERRAIN_PX, world.height * TERRAIN_PX);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  const result = { canvas, tilePx: TERRAIN_PX, width: world.width, height: world.height, paintMs: 0 };
  if (!ctx) return Promise.resolve(result);
  ctx.imageSmoothingEnabled = false;
  const state: PaintCtxState = { world, ctx, waterDepth: computeWaterDepth(world) };

  const rowsPerChunk = 6;
  const totalRows = world.height * 3; // base + boundaries + forest の 3 パス分
  let doneRows = 0;
  let started = false;
  let t0 = 0;

  return new Promise((resolve) => {
    const runChunk = (phase: 0 | 1 | 2, fromY: number) => {
      if (!started) {
        started = true;
        t0 = performance.now();
      }
      const toY = Math.min(world.height, fromY + rowsPerChunk);
      for (let y = fromY; y < toY; y++) {
        for (let x = 0; x < world.width; x++) {
          if (phase === 0) paintTileBase(state, x, y);
          else if (phase === 1) paintBoundaries(state, x, y);
          else if (world.ground[y * world.width + x] === 'forest') paintForestCanopy(ctx, world, x, y);
        }
        doneRows++;
      }
      onProgress?.({ done: doneRows, total: totalRows });

      if (toY < world.height) {
        schedule(() => runChunk(phase, toY));
        return;
      }
      if (phase < 2) {
        schedule(() => runChunk((phase + 1) as 0 | 1 | 2, 0));
        return;
      }
      result.paintMs = performance.now() - t0;
      resolve(result);
    };
    runChunk(0, 0);
  });
}

function schedule(fn: () => void): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 0);
}
