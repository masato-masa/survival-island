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
//
// --- ブロック方式（今回の改修） ---------------------------------------------
// 以前は「世界全体に斜めの渚 1 本＋池 1 つ」という単一ジオメトリだったが、
// ユーザー指示で「タイルに沿った物体配置」「5×5 マス程度の『ブロック』が
// 連なった世界」に変更した。地面の種別（砂/草/水）は、もはや世界座標の
// 単一の斜め線では決まらず、「そのピクセルがどのブロックに属し、
// そのブロックの地面種別が何か」で決まる。ブロック境界をまたぐところだけ
// 従来と同じ有機的（ドメインワープ＋smoothstep）なブレンドをかけて、
// 隣接ブロックが違う地面種別でも継ぎ目が見えないようにする。

export type GroundKind = 'sand' | 'grass' | 'water';

/** ブロックの飾りテーマ（地面種別だけでなく、PiggTestField 側の配置密度・素材選びにも使う）。 */
export type BlockTheme = 'beach' | 'meadow' | 'grove' | 'jungle_pond';

/** 1 タイルの世界 px サイズ。物体はこのグリッドの中心に配置する（プレイヤー移動は無関係、連続座標のまま）。 */
export const TILE = 100;

/** ブロックの並び（5 列 × 4 行）。列・行のタイル数は世界サイズから逆算し、余りは右端/下端の列・行に足す。 */
const BLOCK_COLS = 5;
const BLOCK_ROWS = 4;

// 列 0..4 × 行 0..3 のテーマ表。元のスパイク（左下＝砂、右上＝草、右上の角に池）の
// 構図を踏襲しつつ、密な木立（grove）を混ぜてブロックごとの違いを出す。
const THEME_GRID: readonly BlockTheme[][] = [
  // row 0（上端）
  ['beach', 'beach', 'meadow', 'meadow', 'jungle_pond'],
  // row 1
  ['beach', 'meadow', 'grove', 'meadow', 'meadow'],
  // row 2
  ['beach', 'beach', 'meadow', 'grove', 'meadow'],
  // row 3（下端）
  ['beach', 'beach', 'beach', 'meadow', 'meadow'],
];

function themeBaseKind(theme: BlockTheme): 'sand' | 'grass' {
  return theme === 'beach' ? 'sand' : 'grass';
}

function kindValue(k: 'sand' | 'grass'): number {
  return k === 'grass' ? 1 : 0;
}

/** total を parts 個に、できるだけ均等に分ける（余りは末尾の要素に足す）。 */
function splitCount(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  const sizes = new Array<number>(parts).fill(base);
  for (let i = 0; i < rem; i++) sizes[parts - 1 - i]!++;
  return sizes;
}

export interface BlockInfo {
  bi: number; // 列インデックス
  bj: number; // 行インデックス
  theme: BlockTheme;
  baseKind: 'sand' | 'grass';
  // タイル座標での範囲（gx1/gy1 は exclusive）
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  // 世界 px での範囲
  px0: number;
  py0: number;
  px1: number;
  py1: number;
  // jungle_pond ブロックだけ、そのブロック内に局所的な池の楕円を持つ。
  pond?: { cx: number; cy: number; rx: number; ry: number };
}

interface BlockLayout {
  blocks: BlockInfo[];
  grid: BlockInfo[][]; // grid[bj][bi]
  colBoundariesPx: number[]; // 長さ BLOCK_COLS+1
  rowBoundariesPx: number[]; // 長さ BLOCK_ROWS+1
}

const layoutCache = new Map<string, BlockLayout>();

/** world の幅・高さから、ブロック区画（5×4）を組み立てる。純粋関数・決定的。 */
function buildBlockLayout(w: number, h: number): BlockLayout {
  const key = `${w}x${h}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const gxCount = Math.round(w / TILE);
  const gyCount = Math.round(h / TILE);
  const colTiles = splitCount(gxCount, BLOCK_COLS);
  const rowTiles = splitCount(gyCount, BLOCK_ROWS);

  const colBoundariesTile: number[] = [0];
  for (const c of colTiles) colBoundariesTile.push(colBoundariesTile[colBoundariesTile.length - 1]! + c);
  const rowBoundariesTile: number[] = [0];
  for (const r of rowTiles) rowBoundariesTile.push(rowBoundariesTile[rowBoundariesTile.length - 1]! + r);

  const grid: BlockInfo[][] = [];
  const blocks: BlockInfo[] = [];
  for (let bj = 0; bj < BLOCK_ROWS; bj++) {
    const row: BlockInfo[] = [];
    for (let bi = 0; bi < BLOCK_COLS; bi++) {
      const theme = THEME_GRID[bj]![bi]!;
      const gx0 = colBoundariesTile[bi]!;
      const gx1 = colBoundariesTile[bi + 1]!;
      const gy0 = rowBoundariesTile[bj]!;
      const gy1 = rowBoundariesTile[bj + 1]!;
      const px0 = gx0 * TILE;
      const px1 = gx1 * TILE;
      const py0 = gy0 * TILE;
      const py1 = gy1 * TILE;
      const block: BlockInfo = {
        bi,
        bj,
        theme,
        baseKind: themeBaseKind(theme),
        gx0,
        gy0,
        gx1,
        gy1,
        px0,
        py0,
        px1,
        py1,
      };
      if (theme === 'jungle_pond') {
        block.pond = {
          cx: (px0 + px1) / 2,
          cy: (py0 + py1) / 2,
          rx: (px1 - px0) * 0.3,
          ry: (py1 - py0) * 0.28,
        };
      }
      row.push(block);
      blocks.push(block);
    }
    grid.push(row);
  }

  const colBoundariesPx = colBoundariesTile.map((t) => t * TILE);
  const rowBoundariesPx = rowBoundariesTile.map((t) => t * TILE);

  const layout: BlockLayout = { blocks, grid, colBoundariesPx, rowBoundariesPx };
  layoutCache.set(key, layout);
  return layout;
}

/** PiggTestField 側（物体のブロック単位配置）から使う。world サイズごとに 1 回だけ計算される。 */
export function getBlocks(w: number, h: number): BlockInfo[] {
  return buildBlockLayout(w, h).blocks;
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

function mix1(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
// 境界の形（ブロック境界ベース）
//
// 各ブロックは「砂」か「草」のどちらかを基調とする（jungle_pond は草基調＋局所的な池）。
// ピクセルがどのブロック境界に近いかを見て、隣接ブロックの値とだけブレンドする
// （前段の makeGeometry() の「渚の斜め線 1 本」を、ブロック境界の集合に一般化したもの）。

const BOUNDARY_FEATHER = 60; // px。渚の柔らかさ（仕様の 40〜80px の中央）
const WARP_WAVELEN = 420; // px。境界を揺らすノイズの波長（広くゆっくり）
const WARP_AMP = 90; // px。境界の揺れ幅（ブロック幅 500px 前後に対して大きすぎない値に調整）

const NOISE_AMP = 9; // 明度の広いノイズの強さ（±9 階調程度。仕様の「ごく淡い」に相当）

/**
 * 1 軸（x なら列、y なら行）方向のブレンド値を返す。
 * own（自分のブロック）の値から始めて、両隣のブロックとの境界に近ければ、
 * その境界からの符号付き距離で滑らかに補間する（境界上でちょうど平均になる）。
 */
function axisBlend(coordWarped: number, boundariesPx: number[], idx: number, valAt: (i: number) => number): number {
  const ownVal = valAt(idx);
  const leftEdge = boundariesPx[idx]!;
  const rightEdge = boundariesPx[idx + 1]!;
  if (idx > 0) {
    const d = coordWarped - leftEdge;
    if (d < BOUNDARY_FEATHER) {
      const nb = valAt(idx - 1);
      const t = smoothstep(d / BOUNDARY_FEATHER / 2 + 0.5);
      return mix1(nb, ownVal, t);
    }
  }
  if (idx < boundariesPx.length - 2) {
    const d = rightEdge - coordWarped;
    if (d < BOUNDARY_FEATHER) {
      const nb = valAt(idx + 1);
      const t = smoothstep(d / BOUNDARY_FEATHER / 2 + 0.5);
      return mix1(nb, ownVal, t);
    }
  }
  return ownVal;
}

function findSegment(boundariesPx: number[], coord: number): number {
  for (let i = 0; i < boundariesPx.length - 1; i++) {
    if (coord < boundariesPx[i + 1]! || i === boundariesPx.length - 2) return i;
  }
  return 0;
}

/** 0=完全に砂 / 1=完全に草。ブロック境界だけを滑らかにブレンドする。 */
function grassAmount(layout: BlockLayout, x: number, y: number): number {
  const warpX = (valueNoise2D(x, y, 7, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const warpY = (valueNoise2D(x, y, 11, WARP_WAVELEN) * 2 - 1) * WARP_AMP;
  const wx = x + warpX;
  const wy = y + warpY;
  const bi = findSegment(layout.colBoundariesPx, wx);
  const bj = findSegment(layout.rowBoundariesPx, wy);
  const ownVal = kindValue(layout.grid[bj]![bi]!.baseKind);
  const vVal = axisBlend(wx, layout.colBoundariesPx, bi, (i) => kindValue(layout.grid[bj]![i]!.baseKind));
  const hVal = axisBlend(wy, layout.rowBoundariesPx, bj, (i) => kindValue(layout.grid[i]![bi]!.baseKind));
  // vVal・hVal はどちらも「own からの差分」を含む値なので、own を 1 回だけ足す形で合成する
  // （どちらも境界から遠ければ own に一致するので、通常はそのまま own が返る）。
  return clamp01(vVal + hVal - ownVal);
}

/** 0=草・砂 / 1=完全に水。jungle_pond ブロックの局所的な楕円だけを見る。 */
function waterAmount(layout: BlockLayout, x: number, y: number): number {
  // 池は 1 ブロックに収まる大きさで作ってあるので、該当ブロック（と隣接ブロックへの
  // わずかな滲み出し）だけ調べれば十分。全ブロックを毎ピクセル走査すると重いので、
  // pond を持つブロックだけを対象にする。
  let best = 0;
  for (const block of layout.blocks) {
    if (!block.pond) continue;
    const warpX = (valueNoise2D(x, y, 17, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
    const warpY = (valueNoise2D(x, y, 23, WARP_WAVELEN * 0.8) * 2 - 1) * (WARP_AMP * 0.5);
    const nx = (x + warpX - block.pond.cx) / block.pond.rx;
    const ny = (y + warpY - block.pond.cy) / block.pond.ry;
    const d = Math.sqrt(nx * nx + ny * ny); // 1.0 = 楕円の縁
    const featherNorm = BOUNDARY_FEATHER / Math.min(block.pond.rx, block.pond.ry);
    const v = smoothstep(1 - (d - 1) / featherNorm - featherNorm);
    if (v > best) best = v;
  }
  return best;
}

/** 指定座標の地面種別（物体を置いてよい場所の判定に使う）。ground 焼き込みと必ず同じ式を使う。 */
export function groundKindAt(x: number, y: number, w: number, h: number): GroundKind {
  const layout = buildBlockLayout(w, h);
  if (waterAmount(layout, x, y) > 0.5) return 'water';
  return grassAmount(layout, x, y) > 0.5 ? 'grass' : 'sand';
}

// ---------------------------------------------------------------------------
// 草の質感（新規）
//
// 従来は「地面はほぼフラット、密度感は物体が担う」という方針だったが、
// ユーザー指示で「実際に草の葉のパターンを描いてほしい」となったため、
// 草ブロックの上にだけ、短い葉先ストローク（幅 2〜4px・高さ 6〜14px、
// わずかに回転/曲げたもの）を決定的な乱数で密に散らす。ズームアウトした
// 通常プレイ画面では「テクスチャがある」程度に見え、うるさくならない密度。

const GRASS_BLADE_DENSITY = 1 / 480; // 1 px^2 あたりの本数（間引き済みのグリッドサンプリングで使う）
const GRASS_BLADE_CELL = Math.round(1 / Math.sqrt(GRASS_BLADE_DENSITY)); // サンプリング格子の 1 辺（px）

/**
 * 草ブレードを 1 本描く。grid セルの中に決定的な位置・角度・色でランダムに置く。
 * 曲がった短いストロークを 2 つの線分で近似する（quadraticCurveTo は行単位の分割描画と
 * 相性が悪い＝チャンク境界をまたいで見えるので、単純な 2 点折れ線の太いストロークで代用）。
 */
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
  const lean = (hash2i(cx, cy, seed + 5) - 0.5) * 0.9; // 左右への傾き（ラジアン程度の値域）
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

/**
 * 指定した行範囲（fromY..toY）の中で、草である場所にだけブレードを散らす。
 * ベース塗り（fillChunk）が終わったあとに重ねて描く。格子サンプリングにすることで
 * 「密度は一定だが位置は決定的に不規則」を安く実現する（1px ずつ判定するより軽い）。
 */
function paintGrassBladesForRows(ctx: CanvasRenderingContext2D, layout: BlockLayout, w: number, fromY: number, toY: number): void {
  const cell = GRASS_BLADE_CELL;
  const rowStart = Math.floor(fromY / cell) * cell;
  for (let cy = rowStart; cy < toY; cy += cell) {
    if (cy < fromY - cell) continue;
    for (let cx = 0; cx < w; cx += cell) {
      const gT = grassAmount(layout, cx, cy);
      const wT = waterAmount(layout, cx, cy);
      if (gT <= 0.55 || wT > 0.3) continue; // 草の内側だけ（渚・水際はブレード無し）
      // 密度: セルごとに 1〜2 本、たまに 0 本（乱数で間引く）にして機械的な格子感を消す。
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

/**
 * canvas（width/height は呼び出し側で World サイズに設定済みのもの）へ地面を焼き込む。
 * 行の束ごとに setTimeout(0)/requestIdleCallback へ逃がすので画面は固まらない。
 * 完了後、微かな濃淡の斑（ブロブ）と、草ブロックの上にだけ葉のブレードを重ねる。
 */
export function paintPiggGroundAsync(canvas: HTMLCanvasElement, onProgress?: (p: PaintProgress) => void): Promise<void> {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  const layout = buildBlockLayout(w, h);

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
          const gT = grassAmount(layout, x, y);
          const base = gT > 0.5 ? [GRASS, GRASS_LIGHT, GRASS_DARK] : [SAND, SAND_LIGHT, SAND_DARK];
          let rgb = mix(SAND, GRASS, gT);
          const wT = waterAmount(layout, x, y);
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
        paintGrassBladesForRows(ctx, layout, w, 0, h);
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
