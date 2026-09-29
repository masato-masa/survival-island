// Pigg 風スパイクの「地面」プリレンダー。
//
// KEY INSIGHT: Ameba Pigg の地面は緻密にタイリングされたテクスチャではなく、
// なだらかで低周波なノイズを乗せただけのほぼフラットな色面（砂・草・水）で、
// 密度感は地面ではなく「上に置いた物体（草花・岩・家具）」が担っている。
// World 全体を 1 枚のプリレンダー Canvas として一度だけ焼く（タイル繰り返しをしない
// ＝繰り返しの継ぎ目が構造的に存在しない）。
//
// 一度「5×5 マス程度のブロックが連なる」方式を試したが、ユーザーから
// 「ブロック分けは無視してよい、参考画像 1 枚を忠実に再現してほしい」との
// 指示があったため撤回した。今は最初に良かった「斜めの渚 1 本＋池ひとつ」の
// 単一ジオメトリに戻し、そのうえで物体だけタイル格子（TILE）に沿って置く。
//
// 境界は src/render/terrain.ts のドメインワープ＋smoothstep の考え方を踏襲しつつ、
// ピクセル絵ではなく滑らかな Canvas 用に作り直したもの。重い 1 ピクセルずつの
// ループは行の束ごとに分割し、requestIdleCallback/setTimeout(0) の間に逃がして描く
// （terrain.ts の paintTerrainAsync と同じやり口）。
//
// 決定的な乱数（シード固定のハッシュ）を使うので、同じ width/height からは
// 何度焼いても同じ絵になり、物体配置（groundKindAt）とも常に一致する。

export type GroundKind = 'sand' | 'grass' | 'water';

/** 1 タイルの世界 px サイズ。物体はこのグリッドの中心に配置する（プレイヤー移動は無関係、連続座標のまま）。 */
export const TILE = 100;

export interface PondInfo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface Geometry {
  w: number;
  h: number;
  pond: PondInfo;
}

const geometryCache = new Map<string, Geometry>();

/**
 * world の幅・高さから、地面の形（渚の位置・池の位置）を決める。純粋関数・決定的。
 * 池は左上寄り（＝ジャングルの池コーナーをそのあたりに手配置する前提）、
 * 渚は右下ほど砂になる緩い斜め線。
 */
function buildGeometry(w: number, h: number): Geometry {
  const key = `${w}x${h}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geo: Geometry = {
    w,
    h,
    pond: { cx: w * 0.24, cy: h * 0.22, rx: w * 0.16, ry: h * 0.13 },
  };
  geometryCache.set(key, geo);
  return geo;
}

/** PiggTestField 側（池コーナーの手配置）から使う。world サイズごとに 1 回だけ計算される。 */
export function getPond(w: number, h: number): PondInfo {
  return buildGeometry(w, h).pond;
}

// ---------------------------------------------------------------------------
// 決定的な値ノイズ（terrain.ts と同じ作り：格子点ハッシュ→smoothstep 補間）

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 2 次元のなめらかな値ノイズ。wavelength が大きいほど「広く・ゆっくり」変化する。 */
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

// ---------------------------------------------------------------------------
// 色（実測値ベース）

type RGB = readonly [number, number, number];

const SAND: RGB = [247, 206, 121];
const SAND_LIGHT: RGB = [252, 226, 165];
const SAND_DARK: RGB = [222, 175, 92];

const GRASS: RGB = [124, 194, 74];
const GRASS_LIGHT: RGB = [166, 221, 112];
const GRASS_DARK: RGB = [79, 148, 46];

const WATER: RGB = [79, 190, 208];
const WATER_LIGHT: RGB = [143, 226, 232];
const WATER_DARK: RGB = [37, 138, 165];

function mix(a: RGB, b: RGB, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------
// 境界の形（斜めの渚 1 本＋池ひとつ、という単一ジオメトリ）

const BOUNDARY_FEATHER = 70; // px。渚の柔らかさ
const WARP_WAVELEN = 420; // px。境界を揺らすノイズの波長
const WARP_AMP = 130; // px。境界の揺れ幅
const NOISE_AMP = 9; // 明度の広いノイズの強さ（±9 階調程度）

/** 0=完全に砂 / 1=完全に草。右下ほど砂に寄る緩い斜め線を、ノイズで有機的にゆらす。 */
function grassAmount(geo: Geometry, x: number, y: number): number {
  const warpX = (valueNoise2D(x, y, 7, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const warpY = (valueNoise2D(x, y, 11, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const wx = x + warpX;
  const wy = y + warpY;
  // 正規化した斜め座標（0=左上寄り=草、1=右下寄り=砂）。
  const t = wx / geo.w * 0.42 + wy / geo.h * 0.58;
  const grass = 1 - smoothstep((t - 0.52) / (BOUNDARY_FEATHER / Math.min(geo.w, geo.h)) + 0.5);
  return clamp01(grass);
}

/** 0=草・砂 / 1=完全に水。ジオメトリが持つ 1 つの池の楕円だけを見る。 */
function waterAmount(geo: Geometry, x: number, y: number): number {
  const warpX = (valueNoise2D(x, y, 17, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
  const warpY = (valueNoise2D(x, y, 23, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
  const nx = (x + warpX - geo.pond.cx) / geo.pond.rx;
  const ny = (y + warpY - geo.pond.cy) / geo.pond.ry;
  const d = Math.sqrt(nx * nx + ny * ny); // 1.0 = 楕円の縁
  const featherNorm = BOUNDARY_FEATHER / Math.min(geo.pond.rx, geo.pond.ry);
  return smoothstep(1 - (d - 1) / featherNorm - featherNorm);
}

/** 指定座標の地面種別（物体を置いてよい場所の判定に使う）。ground 焼き込みと必ず同じ式を使う。 */
export function groundKindAt(x: number, y: number, w: number, h: number): GroundKind {
  const geo = buildGeometry(w, h);
  if (waterAmount(geo, x, y) > 0.5) return 'water';
  return grassAmount(geo, x, y) > 0.5 ? 'grass' : 'sand';
}

// ---------------------------------------------------------------------------
// 草の質感: 短い葉先ストロークを草の上にだけ密に散らす（色面だけで済ませない）。

const GRASS_BLADE_CELL = 22; // サンプリング格子の 1 辺（px）。小さいほど密。

function paintGrassBlade(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number): void {
  const h1 = hash2i(cx, cy, seed + 1);
  const h2 = hash2i(cx, cy, seed + 2);
  const h3 = hash2i(cx, cy, seed + 3);
  const h4 = hash2i(cx, cy, seed + 4);
  const jitterX = (h1 - 0.5) * GRASS_BLADE_CELL * 0.9;
  const jitterY = (h2 - 0.5) * GRASS_BLADE_CELL * 0.9;
  const x = cx + jitterX;
  const y = cy + jitterY;
  const height = 6 + h3 * 8; // 6〜14px
  const width = 2 + h4 * 2; // 2〜4px
  const lean = (hash2i(cx, cy, seed + 5) - 0.5) * 0.9;
  const light = hash2i(cx, cy, seed + 6) > 0.5;
  const base: RGB = light ? GRASS_LIGHT : GRASS_DARK;
  const tipX = x + Math.sin(lean) * height * 0.6;
  const tipY = y - height;
  const midX = x + Math.sin(lean) * height * 0.3;
  const midY = y - height * 0.55;
  ctx.strokeStyle = `rgb(${base[0] | 0}, ${base[1] | 0}, ${base[2] | 0})`;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(midX, midY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

function paintGrassBladesForRows(ctx: CanvasRenderingContext2D, geo: Geometry, w: number, fromY: number, toY: number): void {
  const cell = GRASS_BLADE_CELL;
  const rowStart = Math.floor(fromY / cell) * cell;
  for (let cy = rowStart; cy < toY; cy += cell) {
    if (cy < fromY - cell) continue;
    for (let cx = 0; cx < w; cx += cell) {
      const gT = grassAmount(geo, cx, cy);
      const wT = waterAmount(geo, cx, cy);
      if (gT <= 0.55 || wT > 0.3) continue;
      const pick = hash2i(cx, cy, 777);
      const count = pick > 0.85 ? 2 : pick > 0.15 ? 1 : 0;
      for (let k = 0; k < count; k++) paintGrassBlade(ctx, cx, cy, 1000 + k * 37);
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas への焼き込み（チャンク分割・非同期）

export interface PaintProgress {
  done: number;
  total: number;
}

function schedule(fn: () => void): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 0);
}

export function paintPiggGroundAsync(canvas: HTMLCanvasElement, onProgress?: (p: PaintProgress) => void): Promise<void> {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  const geo = buildGeometry(w, h);

  return new Promise((resolve) => {
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    const rowsPerChunk = 40;
    let doneRows = 0;

    const fillChunk = (fromY: number) => {
      const toY = Math.min(h, fromY + rowsPerChunk);
      for (let y = fromY; y < toY; y++) {
        const rowOff = y * w;
        for (let x = 0; x < w; x++) {
          const gT = grassAmount(geo, x, y);
          const base = gT > 0.5 ? [GRASS, GRASS_LIGHT, GRASS_DARK] : [SAND, SAND_LIGHT, SAND_DARK];
          let rgb = mix(SAND, GRASS, gT);
          const wT = waterAmount(geo, x, y);
          if (wT > 0.4) rgb = mix(rgb, WATER, wT);
          const tintSet = wT > 0.4 ? [WATER, WATER_LIGHT, WATER_DARK] : base;

          const n1 = valueNoise2D(x, y, 3, 520);
          const n2 = valueNoise2D(x, y, 41, 900);
          const n = (n1 * 0.6 + n2 * 0.4) * 2 - 1;
          const tint = n > 0 ? tintSet[1]! : tintSet[2]!;
          const tintStrength = (Math.abs(n) * NOISE_AMP) / 255;
          rgb = mix(rgb, tint, tintStrength);

          const i4 = (rowOff + x) * 4;
          data[i4] = clamp01(rgb[0] / 255) * 255;
          data[i4 + 1] = clamp01(rgb[1] / 255) * 255;
          data[i4 + 2] = clamp01(rgb[2] / 255) * 255;
          data[i4 + 3] = 255;
        }
        doneRows++;
      }
      onProgress?.({ done: doneRows, total: h });
      if (toY < h) {
        schedule(() => fillChunk(toY));
      } else {
        ctx.putImageData(imageData, 0, 0);
        paintSoftBlobs(ctx, w, h);
        paintGrassBladesForRows(ctx, geo, w, 0, h);
        resolve();
      }
    };

    fillChunk(0);
  });
}

/** ごく薄い大きな斑を数個、安いグラデーション塗りで重ねる（タイリングしないので継ぎ目リスクゼロ）。 */
function paintSoftBlobs(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const blobs = 12;
  for (let i = 0; i < blobs; i++) {
    const hx = hash2i(i, 0, 501);
    const hy = hash2i(i, 0, 502);
    const hr = hash2i(i, 0, 503);
    const hs = hash2i(i, 0, 504);
    const x = hx * w;
    const y = hy * h;
    const r = 90 + hr * 170;
    const dark = hs > 0.5;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = 0.05 + hash2i(i, 0, 505) * 0.035;
    grad.addColorStop(0, dark ? `rgba(20,30,10,${alpha})` : `rgba(255,255,240,${alpha})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
