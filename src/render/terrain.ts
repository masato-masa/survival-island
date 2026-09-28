// 地面の事前描画（プリレンダー）レイヤー。
//
// マップ全体の「地面」だけを 1 枚のオフスクリーン Canvas に焼いておき、毎フレームは
// そこからカメラの可視範囲をスケールして貼るだけにする（renderer.ts 側）。
//
// v2: ChatGPT 生成のシームレステクスチャ（tex_*.png, 64×64）をソースに使い、
// タイル境界は「ドメインワープ」したノイズでサンプリング座標そのものを揺らして決める。
// タイルの矩形グリッドをピクセル単位でなぞらないので、境界が有機的な形になる
// （CLAUDE.md 的な言い方をすれば「タイルの継ぎ目」が出ない）。
//
// 森（forest）は地面としては薄暗い下草だけを塗り、木そのものは forestTrees.ts が
// 生成するインスタンスをプレイヤーと同じ y ソートで毎フレーム描く（renderer.ts）。
//
// 決定的な乱数（シード固定）を使うので、同じ World からは何度焼いても同じ絵になる。
// 重い処理は行の束ごとに分割して setTimeout(0) の間に逃がす（paintTerrainAsync）。

import type { World } from '@/game/types';
import { getTexturePixels, loadTextures, TEXTURE_SIZE, type TextureName } from './textures';

// ---------------------------------------------------------------------------
// 決定的な乱数・ノイズ

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2 次元のなめらかな値ノイズ（格子点を hash2i でハッシュしバイリニア補間）。 */
function valueNoise2D(x: number, y: number, seed: number, wavelength: number): number {
  const gx = x / wavelength;
  const gy = y / wavelength;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smoothstep(gx - ix);
  const fy = smoothstep(gy - iy);
  const v00 = hash2i(ix, iy, seed);
  const v10 = hash2i(ix + 1, iy, seed);
  const v01 = hash2i(ix, iy + 1, seed);
  const v11 = hash2i(ix + 1, iy + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const NEIGHBOURS4: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// ---------------------------------------------------------------------------
// 定数

export const TERRAIN_PX = 16; // タイル 1 枚あたりのソース解像度（gen アセットと同じ 16 art px/タイル）

const WARP_AMP = 5; // ドメインワープの振幅（px）
const WARP_WAVELEN = 20; // ドメインワープの波長（px）

// 地面フォールバック色（テクスチャ未読み込み時のみ使う）
const FALLBACK_RGB: Record<string, [number, number, number]> = {
  grass: [139, 195, 106],
  grassFlowers: [139, 195, 106],
  dirt: [168, 116, 79],
  sand: [236, 217, 160],
  wetSand: [201, 178, 118],
  paving: [167, 169, 172],
  dock: [168, 116, 79],
  water: [63, 169, 196],
};

const WATER_DEEP_RGB: [number, number, number] = [0x2f, 0x7f, 0xb5];
const FOREST_DARK_RGB: [number, number, number] = [0x2f, 0x5a, 0x2e];
const FOAM_RGB: [number, number, number] = [0xea, 0xf6, 0xf5];

// 境界・水面パス用の「地面カテゴリ」（優先度と組み合わせの判定に使う軽量な id）
const enum Cat {
  Water = 0,
  Grass = 1,
  Sand = 2,
  Dirt = 3,
  Paving = 4,
  Soil = 5,
  Forest = 6,
}

const PATH_LIKE = new Set<Cat>([Cat.Dirt, Cat.Paving]);
const SOFT_LIKE = new Set<Cat>([Cat.Grass, Cat.Sand]);

// ---------------------------------------------------------------------------
// Canvas ヘルパー

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
// BFS 距離（水からの距離・陸から水までの距離・森からの距離、いずれも小さい半径で十分）

function bfsDistanceFrom(world: World, seedTest: (idx: number) => boolean, maxD: number): Int16Array {
  const { width, height } = world;
  const dist = new Int16Array(width * height).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!seedTest(i)) continue;
      for (const [ddx, ddy] of NEIGHBOURS4) {
        const nx = x + ddx;
        const ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!seedTest(ny * width + nx)) {
          dist[i] = 0;
          queue.push(i);
          break;
        }
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const d = dist[i]!;
    if (d >= maxD) continue;
    const x = i % width;
    const y = (i / width) | 0;
    for (const [ddx, ddy] of NEIGHBOURS4) {
      const nx = x + ddx;
      const ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!seedTest(ni)) continue;
      if ((dist[ni] ?? -1) >= 0) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** 水タイルの「陸からの距離」（0 = 陸に接する水、深いほど大きい）。水面の色の深さに使う。 */
function computeWaterDepth(world: World): Int16Array {
  return bfsDistanceFrom(world, (i) => world.ground[i] === 'water', 8);
}

/** 非水タイルの「水からの距離」（0 = 水に接するマス）。砂浜の濡れ具合に使う。 */
function computeLandDistToWater(world: World): Int16Array {
  return bfsDistanceFrom(world, (i) => world.ground[i] !== 'water', 3);
}

/** 森でないタイルの「森からの距離」。草の日陰に使う。 */
function computeDistToForest(world: World): Int16Array {
  return bfsDistanceFrom(world, (i) => world.ground[i] !== 'forest', 3);
}

// ---------------------------------------------------------------------------
// 「foundation（家の跡地）」の矩形の縁かどうか（縁は石畳、内側は土）

function computeFoundationEdge(world: World): Uint8Array {
  const { width, height, ground } = world;
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ground[i] !== 'foundation') continue;
      let isEdge = false;
      for (const [ddx, ddy] of NEIGHBOURS4) {
        const nx = x + ddx;
        const ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || ground[ny * width + nx] !== 'foundation') {
          isEdge = true;
          break;
        }
      }
      edge[i] = isEdge ? 1 : 0;
    }
  }
  return edge;
}

// ---------------------------------------------------------------------------
// テクスチャサンプリング

function sampleTexture(name: TextureName, px: number, py: number, out: [number, number, number]): void {
  const pix = getTexturePixels(name);
  const sx = ((px % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
  const sy = ((py % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
  if (!pix) {
    const fb = FALLBACK_RGB[name] ?? [180, 180, 180];
    out[0] = fb[0];
    out[1] = fb[1];
    out[2] = fb[2];
    return;
  }
  const idx = (sy * TEXTURE_SIZE + sx) * 4;
  out[0] = pix[idx]!;
  out[1] = pix[idx + 1]!;
  out[2] = pix[idx + 2]!;
}

function mixRGB(a: [number, number, number], b: [number, number, number], t: number, out: [number, number, number]): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function darken(rgb: [number, number, number], amount: number): void {
  rgb[0] *= 1 - amount;
  rgb[1] *= 1 - amount;
  rgb[2] *= 1 - amount;
}

// ---------------------------------------------------------------------------
// 状態

interface PaintState {
  world: World;
  waterDepth: Int16Array;
  landDistToWater: Int16Array;
  distToForest: Int16Array;
  foundationEdge: Uint8Array;
}

function buildState(world: World): PaintState {
  return {
    world,
    waterDepth: computeWaterDepth(world),
    landDistToWater: computeLandDistToWater(world),
    distToForest: computeDistToForest(world),
    foundationEdge: computeFoundationEdge(world),
  };
}

const tmpA: [number, number, number] = [0, 0, 0];

/** 1 ピクセル分の色とカテゴリを解決する。px,py はソース Canvas 全体のピクセル座標。 */
function resolvePixel(state: PaintState, px: number, py: number, outRGB: [number, number, number]): Cat {
  const { world } = state;
  const warpX = (valueNoise2D(px, py, 11, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const warpY = (valueNoise2D(px, py, 29, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const twx = clampInt(Math.floor((px + warpX) / TERRAIN_PX), 0, world.width - 1);
  const twy = clampInt(Math.floor((py + warpY) / TERRAIN_PX), 0, world.height - 1);
  const tIdx = twy * world.width + twx;
  const g = world.ground[tIdx];

  switch (g) {
    case 'water': {
      sampleTexture('water', px, py, outRGB);
      const depth = state.waterDepth[tIdx] ?? 8;
      const t = clamp01(depth / 4);
      mixRGB(outRGB, WATER_DEEP_RGB, t * 0.7, outRGB);
      return Cat.Water;
    }
    case 'forest': {
      sampleTexture('grass', px, py, outRGB);
      mixRGB(outRGB, FOREST_DARK_RGB, 0.72, outRGB);
      return Cat.Forest;
    }
    case 'grass': {
      const flowerN = valueNoise2D(px, py, 41, 48);
      const useFlowers = flowerN < 0.15;
      sampleTexture(useFlowers ? 'grassFlowers' : 'grass', px, py, outRGB);
      const fd = state.distToForest[tIdx] ?? -1;
      if (fd >= 0 && fd <= 1) darken(outRGB, 0.14);
      return Cat.Grass;
    }
    case 'sand': {
      const wd = state.landDistToWater[tIdx] ?? -1;
      const wet = wd >= 0 && wd <= 1;
      sampleTexture(wet ? 'wetSand' : 'sand', px, py, outRGB);
      return Cat.Sand;
    }
    case 'dirt':
      sampleTexture('dirt', px, py, outRGB);
      return Cat.Dirt;
    case 'paving':
      sampleTexture('paving', px, py, outRGB);
      return Cat.Paving;
    case 'dock':
      sampleTexture('dock', px, py, outRGB);
      return Cat.Paving;
    case 'soil': {
      sampleTexture('dirt', px, py, outRGB);
      darken(outRGB, 0.15);
      if (((py % 4) + 4) % 4 === 0) darken(outRGB, 0.12); // 畝（うね）の筋
      return Cat.Soil;
    }
    case 'foundation': {
      const edge = state.foundationEdge[tIdx] === 1;
      sampleTexture(edge ? 'paving' : 'dirt', px, py, outRGB);
      return edge ? Cat.Paving : Cat.Dirt;
    }
    default:
      outRGB[0] = 255;
      outRGB[1] = 0;
      outRGB[2] = 255;
      return Cat.Grass;
  }
}

// ---------------------------------------------------------------------------
// 公開 API

export interface PaintProgress {
  done: number;
  total: number;
}

/**
 * 分割して焼く。1 チャンクが長くても数 ms で終わるよう行数を区切り、setTimeout(0) で
 * 次のチャンクをスケジュールする（メインスレッドを固め続けない）。
 * テクスチャの読み込みを内部で待つので、WorldView 側は今まで通り呼ぶだけでよい。
 */
export function paintTerrainAsync(
  world: World,
  onProgress?: (p: PaintProgress) => void
): Promise<PaintedTerrain & { paintMs: number }> {
  const canvasW = world.width * TERRAIN_PX;
  const canvasH = world.height * TERRAIN_PX;
  const canvas = makeCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  const result = { canvas, tilePx: TERRAIN_PX, width: world.width, height: world.height, paintMs: 0 };
  if (!ctx) return Promise.resolve(result);
  ctx.imageSmoothingEnabled = false;

  return loadTextures().then(
    () =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const state = buildState(world);

        // RGB バッファ（アルファは常に不透明）＋ カテゴリバッファ（境界・波打ち際の判定用）
        const rgb = new Uint8ClampedArray(canvasW * canvasH * 3);
        const cat = new Uint8Array(canvasW * canvasH);

        const rowsPerChunk = 48; // ソース px 単位（タイル 3 行分）
        let doneRows = 0;
        const totalRows = canvasH * 2; // フィル + 境界仕上げの 2 パス

        const fillChunk = (fromY: number) => {
          const toY = Math.min(canvasH, fromY + rowsPerChunk);
          for (let py = fromY; py < toY; py++) {
            const rowOff = py * canvasW;
            for (let px = 0; px < canvasW; px++) {
              const c = resolvePixel(state, px, py, tmpA);
              const i3 = (rowOff + px) * 3;
              rgb[i3] = tmpA[0];
              rgb[i3 + 1] = tmpA[1];
              rgb[i3 + 2] = tmpA[2];
              cat[rowOff + px] = c;
            }
            doneRows++;
          }
          onProgress?.({ done: doneRows, total: totalRows });
          if (toY < canvasH) {
            schedule(() => fillChunk(toY));
          } else {
            schedule(() => edgeChunk(0));
          }
        };

        // 第 2 パス：カテゴリバッファを見て、道の縁の暗い縁取りと水際の泡を足す。
        // ノイズの再計算はしない（境界はすでに 1 パス目のワープで有機的になっている）ので軽い。
        const edgeChunk = (fromY: number) => {
          const toY = Math.min(canvasH, fromY + rowsPerChunk);
          for (let py = fromY; py < toY; py++) {
            const rowOff = py * canvasW;
            for (let px = 0; px < canvasW; px++) {
              const idx = rowOff + px;
              const c = cat[idx] as Cat;
              const i3 = idx * 3;

              let touchesSoft = false;
              let touchesLand = false;
              for (const [ddx, ddy] of NEIGHBOURS4) {
                const nx = px + ddx;
                const ny = py + ddy;
                if (nx < 0 || ny < 0 || nx >= canvasW || ny >= canvasH) continue;
                const nc = cat[ny * canvasW + nx] as Cat;
                if (SOFT_LIKE.has(nc)) touchesSoft = true;
                if (nc !== Cat.Water) touchesLand = true;
              }

              if (PATH_LIKE.has(c) && touchesSoft) {
                rgb[i3] = rgb[i3]! * 0.84;
                rgb[i3 + 1] = rgb[i3 + 1]! * 0.84;
                rgb[i3 + 2] = rgb[i3 + 2]! * 0.84;
              } else if (c === Cat.Water && touchesLand) {
                const t = 0.35;
                rgb[i3] = rgb[i3]! + (FOAM_RGB[0] - rgb[i3]!) * t;
                rgb[i3 + 1] = rgb[i3 + 1]! + (FOAM_RGB[1] - rgb[i3 + 1]!) * t;
                rgb[i3 + 2] = rgb[i3 + 2]! + (FOAM_RGB[2] - rgb[i3 + 2]!) * t;
              }
            }
            doneRows++;
          }
          onProgress?.({ done: doneRows, total: totalRows });
          if (toY < canvasH) {
            schedule(() => edgeChunk(toY));
          } else {
            finish();
          }
        };

        const finish = () => {
          // 桟橋タイルの下（南）に水面がある場所は、水面の上端 2px を少し暗くする（板の影）。
          paintDockShadows(state, rgb, canvasW, canvasH);

          const imageData = ctx.createImageData(canvasW, canvasH);
          const data = imageData.data;
          const n = canvasW * canvasH;
          for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            data[i4] = rgb[i3]!;
            data[i4 + 1] = rgb[i3 + 1]!;
            data[i4 + 2] = rgb[i3 + 2]!;
            data[i4 + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);
          result.paintMs = performance.now() - t0;
          resolve(result);
        };

        fillChunk(0);
      })
  );
}

function paintDockShadows(state: PaintState, rgb: Uint8ClampedArray, canvasW: number, canvasH: number): void {
  const { world } = state;
  for (let ty = 0; ty < world.height - 1; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      if (world.ground[ty * world.width + tx] !== 'dock') continue;
      if (world.ground[(ty + 1) * world.width + tx] !== 'water') continue;
      const py0 = (ty + 1) * TERRAIN_PX;
      for (let dy = 0; dy < 2; dy++) {
        const py = py0 + dy;
        if (py >= canvasH) continue;
        const rowOff = py * canvasW;
        for (let dx = 0; dx < TERRAIN_PX; dx++) {
          const px = tx * TERRAIN_PX + dx;
          if (px >= canvasW) continue;
          const i3 = (rowOff + px) * 3;
          rgb[i3] = rgb[i3]! * 0.6;
          rgb[i3 + 1] = rgb[i3 + 1]! * 0.6;
          rgb[i3 + 2] = rgb[i3 + 2]! * 0.6;
        }
      }
    }
  }
}

function schedule(fn: () => void): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 0);
}
