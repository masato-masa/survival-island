// 地面の色を計算する純粋な部分（DOM・Canvas を使わない）。terrain.ts と terrainWorker.ts の両方から使う。
//
// 地面の事前描画（プリレンダー）レイヤー。
//
// マップ全体の「地面」だけを 1 枚のオフスクリーン Canvas に焼いておき、毎フレームは
// そこからカメラの可視範囲をスケールして貼るだけにする（renderer.ts 側）。
//
// pigg 風の地面は、タイル絵を敷き詰めるのではなく「明るい平らな色面に、ごく低周波の
// 濃淡」を乗せたもの（草の葉先は forestTrees.ts の見た目だけの物体として別に散らす）。
// 密度感は地面ではなく上に置く物体が担う。
// なので画像テクスチャは一切使わず、色はすべてここで計算する。
//
// 境界はタイルの格子をなぞらない。各ピクセルを低周波ノイズでゆがめ（ドメインワープ）、
// 周囲 4 タイルの種別を距離で重みづけして一番強い種別に決める。すると境界はなめらかな
// 曲線になり、隣り合う 2 種の差（margin）が小さい帯だけ色をなじませて縁を柔らかくできる。
// 渚の泡・道の縁取り・濡れ砂はこの margin を使って描く。
//
// 決定的な乱数（シード固定）を使うので、同じ World からは何度焼いても同じ絵になる。
// 重い処理は Web Worker（terrainWorker.ts）へ出す。Worker が使えない環境では terrain.ts が
// 行の束ごとに分けてメインスレッドで塗る。

// ---------------------------------------------------------------------------
// 決定的な乱数・ノイズ

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 2 次元のなめらかな値ノイズ（格子点を hash2i でハッシュしバイリニア補間）。wavelength が大きいほどゆっくり変化。 */
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

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number, out: RGB): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

// ---------------------------------------------------------------------------
// 定数

/** タイル 1 枚あたりのプリレンダー解像度。滑らかな塗りなので 32px あれば拡大してもほぼ崩れない。 */
export const TERRAIN_PX = 64;

const WARP_AMP = 0.11 * TERRAIN_PX; // ドメインワープの振幅（px）
const WARP_WAVELEN = 3 * TERRAIN_PX;
const EDGE_SOFT = 0.1; // 境界をなじませる幅（weights の差。1 タイル ≒ 1.0）

const enum K {
  Water = 0,
  Grass = 1,
  Forest = 2,
  Sand = 3,
  Dirt = 4,
  Paving = 5,
  Dock = 6,
  Soil = 7,
  Count = 8,
}

const isPathLike = (k: number): boolean => k === K.Dirt || k === K.Paving || k === K.Dock;
const isSoft = (k: number): boolean => k === K.Grass || k === K.Forest || k === K.Sand;

// 色（参考画像から実測した値を基準にしたやわらかい配色）
const GRASS_A: RGB = [147, 204, 111];
const GRASS_B: RGB = [128, 191, 92];
const GRASS_C: RGB = [160, 212, 122];
const FOREST_A: RGB = [136, 197, 102];
const FOREST_B: RGB = [122, 185, 90];
const SAND_A: RGB = [240, 224, 172];
const SAND_B: RGB = [229, 208, 152];
const SAND_WET: RGB = [214, 192, 140];
const DIRT_A: RGB = [228, 193, 142];
const DIRT_B: RGB = [216, 178, 126];
const PAVE_A: RGB = [214, 210, 200];
const PAVE_MORTAR: RGB = [176, 171, 158];
const SOIL_A: RGB = [122, 80, 54];
const SOIL_B: RGB = [158, 110, 76];
const WATER_SHALLOW: RGB = [128, 214, 228];
const WATER_DEEP: RGB = [84, 176, 210];
const FOAM: RGB = [246, 253, 252];
const WOOD_TONES: RGB[] = [
  [214, 172, 116],
  [204, 160, 104],
  [220, 182, 126],
  [196, 152, 98],
];

// ---------------------------------------------------------------------------
// タイル種別・水深

export function classify(width: number, height: number, ground: readonly string[]): Uint8Array {
  const out = new Uint8Array(width * height);
  const isFoundation = (x: number, y: number) => ground[y * width + x] === 'foundation';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = ground[y * width + x];
      let k: number;
      switch (g) {
        case 'water': k = K.Water; break;
        case 'grass': k = K.Grass; break;
        case 'forest': k = K.Forest; break;
        case 'sand': k = K.Sand; break;
        case 'dirt': k = K.Dirt; break;
        case 'paving': k = K.Paving; break;
        case 'dock': k = K.Dock; break;
        case 'soil': k = K.Soil; break;
        case 'foundation': {
          // 家の跡地: ふちだけ石畳、中は土
          const edge =
            x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !isFoundation(x - 1, y) || !isFoundation(x + 1, y) || !isFoundation(x, y - 1) || !isFoundation(x, y + 1);
          k = edge ? K.Paving : K.Dirt;
          break;
        }
        default: k = K.Grass;
      }
      out[y * width + x] = k;
    }
  }
  return out;
}

/** 水タイルの「岸からの距離」（タイル単位、最大 8）。 */
export function waterDepth(width: number, height: number, cls: Uint8Array): Float32Array {
  const dist = new Float32Array(width * height).fill(8);
  const queue: number[] = [];
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== K.Water) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width;
    const y = (i / width) | 0;
    const d = dist[i]! + 1;
    if (d > 8) continue;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (d < dist[j]!) {
        dist[j] = d;
        queue.push(j);
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// ピクセルの色

/** 種別 k の (px,py) の色を out に書く。depth は水のときだけ使う（岸からの距離、タイル単位）。 */
function baseColor(k: number, px: number, py: number, depth: number, out: RGB): void {
  switch (k) {
    case K.Water: {
      const t = Math.min(1, Math.max(0, (depth - 0.5) / 4.5));
      mix(WATER_SHALLOW, WATER_DEEP, t, out);
      // ゆるいゆらぎ（明るい筋）
      const n = valueNoise2D(px, py * 1.6, 71, 2.4 * TERRAIN_PX) - 0.5;
      const lift = n * 16;
      out[0] += lift;
      out[1] += lift;
      out[2] += lift * 0.6;
      return;
    }
    case K.Grass: {
      const n1 = valueNoise2D(px, py, 3, 3.6 * TERRAIN_PX);
      const n2 = valueNoise2D(px, py, 41, 6.5 * TERRAIN_PX);
      const n = n1 * 0.6 + n2 * 0.4;
      if (n < 0.5) mix(GRASS_A, GRASS_B, (0.5 - n) * 1.7, out);
      else mix(GRASS_A, GRASS_C, (n - 0.5) * 1.6, out);
      const f = (valueNoise2D(px, py, 88, 0.5 * TERRAIN_PX) - 0.5) * 5;
      out[0] += f;
      out[1] += f;
      out[2] += f;
      return;
    }
    case K.Forest: {
      const n = valueNoise2D(px, py, 5, 3 * TERRAIN_PX);
      mix(FOREST_A, FOREST_B, n, out);
      return;
    }
    case K.Sand: {
      const n = valueNoise2D(px, py, 17, 4 * TERRAIN_PX);
      mix(SAND_A, SAND_B, n, out);
      return;
    }
    case K.Dirt: {
      const n = valueNoise2D(px, py, 23, 2.5 * TERRAIN_PX);
      mix(DIRT_A, DIRT_B, n * 0.8, out);
      return;
    }
    case K.Paving: {
      // 石畳: 半マスずつずらした 2 段の石。石ごとに明るさを変え、目地は暗く。
      const cell = TERRAIN_PX / 4;
      const row = Math.floor(py / cell);
      const shifted = px + (row % 2 === 0 ? 0 : cell / 2);
      const col = Math.floor(shifted / cell);
      const lx = shifted - col * cell;
      const ly = py - row * cell;
      const tone = 0.94 + hash2i(col, row, 91) * 0.1;
      out[0] = PAVE_A[0] * tone;
      out[1] = PAVE_A[1] * tone;
      out[2] = PAVE_A[2] * tone;
      const edge = Math.min(lx, cell - lx, ly, cell - ly);
      if (edge < 1.8) mix(out, PAVE_MORTAR, 1 - edge / 1.8, out);
      else if (ly < 4 && lx > 3 && lx < cell - 3) {
        out[0] += 6;
        out[1] += 6;
        out[2] += 6;
      }
      return;
    }
    case K.Dock: {
      // 桟橋: 横板。板ごとに色を変え、板の間に暗い線、たまに継ぎ目。
      const bandH = TERRAIN_PX / 8;
      const band = Math.floor(py / bandH);
      const ly = py - band * bandH;
      const tone = WOOD_TONES[Math.floor(hash2i(band, 0, 33) * WOOD_TONES.length)]!;
      out[0] = tone[0];
      out[1] = tone[1];
      out[2] = tone[2];
      const joint = Math.floor((px + hash2i(band, 1, 34) * TERRAIN_PX * 2) / (TERRAIN_PX * 1.5));
      const jx = (px + hash2i(band, 1, 34) * TERRAIN_PX * 2) - joint * TERRAIN_PX * 1.5;
      if (ly < 1.4 || jx < 1.2) mix(out, [120, 82, 50], 0.55, out);
      else if (ly < 3.4) {
        out[0] += 8;
        out[1] += 8;
        out[2] += 6;
      }
      return;
    }
    case K.Soil: {
      // 畑の土: 横畝。畝の頂点を明るく。
      const ridge = 0.5 + 0.5 * Math.sin((py / TERRAIN_PX) * Math.PI * 8);
      mix(SOIL_A, SOIL_B, ridge, out);
      const f = (valueNoise2D(px, py, 61, 0.6 * TERRAIN_PX) - 0.5) * 12;
      out[0] += f;
      out[1] += f;
      out[2] += f;
      return;
    }
    default:
      out[0] = 255;
      out[1] = 0;
      out[2] = 255;
  }
}

// ---------------------------------------------------------------------------
// 行ごとの塗り

export interface TerrainState {
  width: number; // タイル数
  height: number;
  cls: Uint8Array;
  depth: Float32Array;
}

export function buildTerrainState(width: number, height: number, ground: readonly string[]): TerrainState {
  const cls = classify(width, height, ground);
  return { width, height, cls, depth: waterDepth(width, height, cls) };
}

const weights = new Float32Array(K.Count);
const rgbA: RGB = [0, 0, 0];
const rgbB: RGB = [0, 0, 0];

/** ピクセル行 [fromY, toY) を data（RGBA、幅 = width*TERRAIN_PX）へ書く。 */
export function paintRows(st: TerrainState, fromY: number, toY: number, data: Uint8ClampedArray): void {
  const { width: tw, height: th, cls, depth: depthTiles } = st;
  const canvasW = tw * TERRAIN_PX;
  for (let py = fromY; py < toY; py++) {
    for (let px = 0; px < canvasW; px++) {
      const wx = px + (valueNoise2D(px, py, 11, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
      const wy = py + (valueNoise2D(px, py, 29, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
      const u = wx / TERRAIN_PX - 0.5;
      const v = wy / TERRAIN_PX - 0.5;
      const i0 = Math.floor(u);
      const j0 = Math.floor(v);
      const fx = u - i0;
      const fy = v - j0;
      const xa = clampInt(i0, 0, tw - 1);
      const xb = clampInt(i0 + 1, 0, tw - 1);
      const ya = clampInt(j0, 0, th - 1);
      const yb = clampInt(j0 + 1, 0, th - 1);
      const t00 = ya * tw + xa;
      const t10 = ya * tw + xb;
      const t01 = yb * tw + xa;
      const t11 = yb * tw + xb;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      weights.fill(0);
      weights[cls[t00]!]! += w00;
      weights[cls[t10]!]! += w10;
      weights[cls[t01]!]! += w01;
      weights[cls[t11]!]! += w11;
      // 畑・石畳・桟橋は角が丸まりすぎないよう、重みを少し盛る（四角い区画に見せる）
      weights[K.Soil]! *= 1.5;
      weights[K.Paving]! *= 1.3;
      weights[K.Dock]! *= 1.3;

      let best = 0;
      let bestW = -1;
      let second = 0;
      let secondW = -1;
      for (let k = 0; k < K.Count; k++) {
        const w = weights[k]!;
        if (w > bestW) {
          second = best;
          secondW = bestW;
          best = k;
          bestW = w;
        } else if (w > secondW) {
          second = k;
          secondW = w;
        }
      }
      const margin = bestW - Math.max(0, secondW);
      const depth =
        depthTiles[t00]! * w00 + depthTiles[t10]! * w10 + depthTiles[t01]! * w01 + depthTiles[t11]! * w11;

      baseColor(best, px, py, depth, rgbA);

      if (margin < EDGE_SOFT * 2.4) {
        // --- 渚: 水側は白い泡の帯、陸側は濡れ砂の帯 ---
        if (best === K.Water && secondW > 0 && second !== K.Water) {
          const foam = 1 - smoothstep(margin / 0.3);
          mix(rgbA, FOAM, foam * 0.9, rgbA);
        } else if (second === K.Water && best !== K.Water && secondW > 0 && margin < 0.36) {
          if (best === K.Sand) mix(rgbA, SAND_WET, (1 - margin / 0.36) * 0.55, rgbA);
          else {
            rgbA[0] *= 0.94;
            rgbA[1] *= 0.95;
            rgbA[2] *= 0.95;
          }
        }

        // --- 道の縁: 内側に細い濃い縁取り ---
        if (isPathLike(best) && isSoft(second)) {
          const rim = (1 - smoothstep(margin / 0.14)) * 0.16;
          rgbA[0] *= 1 - rim;
          rgbA[1] *= 1 - rim * 1.05;
          rgbA[2] *= 1 - rim * 1.2;
        }

        // --- 種別どうしをなじませる（縁のジャギーをなくす） ---
        if (secondW > 0 && margin < EDGE_SOFT) {
          baseColor(second, px, py, depth, rgbB);
          const t = 0.5 - 0.5 * smoothstep(margin / EDGE_SOFT);
          mix(rgbA, rgbB, t, rgbA);
        }
      }

      const o = (py * canvasW + px) * 4;
      data[o] = rgbA[0] < 0 ? 0 : rgbA[0] > 255 ? 255 : rgbA[0];
      data[o + 1] = rgbA[1] < 0 ? 0 : rgbA[1] > 255 ? 255 : rgbA[1];
      data[o + 2] = rgbA[2] < 0 ? 0 : rgbA[2] > 255 ? 255 : rgbA[2];
      data[o + 3] = 255;
    }
  }
}
