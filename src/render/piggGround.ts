// Pigg 風スパイクの「地面」プリレンダー。
//
// KEY INSIGHT: Ameba Pigg の地面は緻密にタイリングされたテクスチャではなく、
// なだらかで低周波なノイズを乗せただけのほぼフラットな色面（砂・草・水）で、
// 密度感は地面ではなく「上に置いた物体（草花・岩・家具）」が担っている。
// なので旧来の 220px タイル繰り返し（継ぎ目が見える）をやめ、
// World 全体を 1 枚のプリレンダー Canvas として一度だけ焼く。
//
// 境界（砂↔草、草の中の池）は src/render/terrain.ts のドメインワープ＋smoothstep の
// 考え方を踏襲しつつ、ピクセル絵ではなく滑らかな Canvas 用に作り直したもの。
// 重い1ピクセルずつのループは行の束ごとに分割し、requestIdleCallback/setTimeout(0) の
// 間に逃がして描く（terrain.ts の paintTerrainAsync と同じやり口）。
//
// 決定的な乱数（シード固定のハッシュ）を使うので、同じ width/height からは
// 何度焼いても同じ絵になり、物体配置（kindAt）とも常に一致する。

export type GroundKind = 'sand' | 'grass' | 'water';

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
//
// 砂は src/assets/pigg/pigg_sand.png を実測（平均 ≈ #FAD179）。
// 草・水は refs/gen/pigg/terrain-angle.png の草（実測 ≈ #74B443 系）と、
// 既存スパイクの水色フォールバック #4FB0D8（styles.css .pigg-field）に寄せたターコイズ。

type RGB = readonly [number, number, number];

const SAND: RGB = [247, 206, 121]; // #F7CE79
const SAND_LIGHT: RGB = [252, 226, 165];
const SAND_DARK: RGB = [222, 175, 92];

const GRASS: RGB = [124, 194, 74]; // #7CC24A
const GRASS_LIGHT: RGB = [166, 221, 112];
const GRASS_DARK: RGB = [79, 148, 46];

const WATER: RGB = [79, 190, 208]; // #4FBED0（styles.css の #4fb0d8 に近い、少し明るく）
const WATER_LIGHT: RGB = [143, 226, 232];
const WATER_DARK: RGB = [37, 138, 165];

function mix(a: RGB, b: RGB, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------
// 境界の形（World サイズに対して相対的に決める）
//
// 砂↔草は斜めの渚（左下が砂、右上が草＝terrain-angle.png の構図）。
// 草の中に池（水）を 1 つ切り取る。どちらも大波長ノイズで縁をゆらす（有機的な曲線）。

const BOUNDARY_FEATHER = 60; // px。渚の柔らかさ（仕様の 40〜80px の中央）
const WARP_WAVELEN = 420; // px。境界を揺らすノイズの波長（広くゆっくり）
const WARP_AMP = 130; // px。境界の揺れ幅

const NOISE_AMP = 9; // 明度の広いノイズの強さ（±9 階調程度。仕様の「ごく淡い」に相当）

interface GroundGeometry {
  w: number;
  h: number;
  // 渚のライン: y = baseline(x) より下（y 大）が砂、上が草
  slope: number;
  baseY: number;
  // 池（草の中の水たまり）
  pondCx: number;
  pondCy: number;
  pondRx: number;
  pondRy: number;
}

function makeGeometry(w: number, h: number): GroundGeometry {
  return {
    w,
    h,
    // 右に行くほど境界が上（小さい y）に上がる＝右上ほど草が広い、左下ほど砂が広い。
    slope: 0.42,
    baseY: h * 0.62,
    // 草エリア（右上）の中、水辺の生き物（睡蓮っぽい草）を置ける池を 1 つ用意する。
    pondCx: w * 0.78,
    pondCy: h * 0.24,
    pondRx: w * 0.14,
    pondRy: h * 0.13,
  };
}

/** 0=完全に砂 / 1=完全に草。滑らかな smoothstep で feather 幅だけ混ぜる。 */
function grassAmount(geo: GroundGeometry, x: number, y: number): number {
  const warp = (valueNoise2D(x, y, 7, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const boundaryY = geo.baseY - (x - geo.w / 2) * geo.slope + warp;
  const d = boundaryY - y; // 正なら草側
  return smoothstep(d / BOUNDARY_FEATHER / 2 + 0.5);
}

/** 0=草・砂 / 1=完全に水。楕円距離場を smoothstep で滲ませる。 */
function waterAmount(geo: GroundGeometry, x: number, y: number): number {
  const warpX = (valueNoise2D(x, y, 17, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
  const warpY = (valueNoise2D(x, y, 23, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
  const nx = (x + warpX - geo.pondCx) / geo.pondRx;
  const ny = (y + warpY - geo.pondCy) / geo.pondRy;
  const d = Math.sqrt(nx * nx + ny * ny); // 1.0 = 楕円の縁
  const featherNorm = BOUNDARY_FEATHER / Math.min(geo.pondRx, geo.pondRy);
  return smoothstep(1 - (d - 1) / featherNorm - featherNorm);
}

/** 指定座標の地面種別（物体を置いてよい場所の判定に使う）。ground 焼き込みと必ず同じ式を使う。 */
export function groundKindAt(x: number, y: number, w: number, h: number): GroundKind {
  const geo = makeGeometry(w, h);
  if (waterAmount(geo, x, y) > 0.5) return 'water';
  return grassAmount(geo, x, y) > 0.5 ? 'grass' : 'sand';
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

/**
 * canvas（width/height は呼び出し側で World サイズに設定済みのもの）へ地面を焼き込む。
 * 行の束ごとに setTimeout(0)/requestIdleCallback へ逃がすので画面は固まらない。
 * 完了後、微かな濃淡の斑（ブロブ）を安いグラデーション塗りで重ねる。
 */
export function paintPiggGroundAsync(canvas: HTMLCanvasElement, onProgress?: (p: PaintProgress) => void): Promise<void> {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  const geo = makeGeometry(w, h);

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

          // 広くゆっくりした明度ノイズ（2 オクターブ）。小さい高周波の粒ではなく、
          // 「光の当たり方のムラ」程度のごく淡いドリフトを、地面種別ごとの
          // 明色/暗色トーンへごく弱く寄せる形で表現する（フラットな塗りに見えないように）。
          const n1 = valueNoise2D(x, y, 3, 520);
          const n2 = valueNoise2D(x, y, 41, 900);
          const n = (n1 * 0.6 + n2 * 0.4) * 2 - 1; // -1..1
          const tint = n > 0 ? tintSet[1]! : tintSet[2]!;
          const tintStrength = (Math.abs(n) * NOISE_AMP) / 255; // ごく淡く（NOISE_AMP 階調相当）
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
