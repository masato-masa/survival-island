// ドット絵のスプライト定義。React・DOM・Canvas に依存しない「定義」の部分と、
// 実際に Canvas へ焼く「baking」の部分を分けている。
//
// 各スプライトは 16×16（一部はもっと縦長）の文字グリッド＋パレット（文字→色）。
// `getSprite('tree')` のように名前で引く。焼くのは初回アクセス時（遅延）なので、
// このファイル自体は Canvas の無いテスト環境（vitest / jsdom 抜き）でも import できる。
//
// 1 マス = 32 ワールドピクセル。スプライトは 16 幅を 2 倍して 32 幅にする。
// 縦に長いスプライト（木など）はタイルの「下辺・中央」に合わせて描く
// （描画側は `tileBottomY - baked.h` を y にすればよい）。

// ---------------------------------------------------------------------------
// パレット（全スプライト共通の 1 つのオブジェクトを使い回す）
//
// クリーム色の背景 #f6f5ef に馴染む、少し落ち着いた暖色寄りのパステル。
// 輪郭線は純黒ではなく #3d2b2e（焦げ茶）。

const PALETTE: Record<string, string> = {
  K: '#3d2b2e', // 輪郭線
  g: '#8bc36a', // 草
  G: '#6fae57', // 草（濃い）
  s: '#ecd9a0', // 砂
  S: '#dfc788', // 砂（濃い）
  w: '#6cc3d5', // 水
  W: '#4fa9c4', // 水（濃い）
  f: '#eaf6f5', // 泡・白波
  o: '#a8744f', // 土
  O: '#8a5a3c', // 土（濃い）／木の濃い色
  b: '#c08a52', // 木材
  B: '#8a5a3c', // 木材（濃い・幹）
  h: '#e0b378', // 木材（明るい）
  l: '#8bc36a', // 葉
  L: '#4f8f45', // 葉（濃い）
  r: '#a7a9ac', // 石
  R: '#7d8084', // 石（濃い）
  p: '#c7c9cc', // 石（明るい）
  c: '#c97b4a', // 銅
  C: '#e8a86a', // 銅（明るい）
  k: '#e8b48a', // 肌
  y: '#e8c33f', // 麦わら帽子
  Y: '#b89448', // 麦わら帽子（影）
  m: '#d96a5a', // シャツ
  M: '#b8503f', // シャツ（影）
  n: '#5a7a9a', // ズボン
  N: '#46607a', // ズボン（影）
  e: '#f6f5ef', // 白・クリーム
  d: '#c0453f', // 赤（トマト・実）
  j: '#5a9a4a', // 緑（作物の葉）
  u: '#e88ab0', // ピンクの花びら
  i: '#f0c33a', // 黄色の花びら
  z: '#6b4a35', // 濃い茶（道具の柄など）
  x: '#7a9a5a', // 苔
  q: '#8a9aa8', // 青みがかった灰色（境界の大岩）
  v: '#d4af37', // 金
  A: '#5fe3c9', // 遺跡の光る紋様（発光する青緑）
  a: '#2fae95', // 遺跡の光る紋様（濃い側）
};

// ---------------------------------------------------------------------------
// グリッド作成のヘルパー

type Grid = string[][];

const T = '.'; // 透明

function newGrid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => T));
}

function gridToRows(g: Grid): string[] {
  return g.map((row) => row.join(''));
}

function px(g: Grid, x: number, y: number, c: string): void {
  const row = g[y];
  if (row && x >= 0 && x < row.length) row[x] = c;
}

function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, c);
}

function circleFill(g: Grid, cx: number, cy: number, r: number, c: string): void {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      if (dx * dx + dy * dy <= r * r) px(g, x, y, c);
    }
  }
}

/** 塗られたマスの周り 1px を輪郭線色で囲む（透明なマスだけを上書き）。 */
function outlineShape(g: Grid, oc: string): void {
  const h = g.length;
  const w = g[0]?.length ?? 0;
  const src = g.map((row) => row.slice());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y]?.[x] !== T) continue;
      const touches =
        (src[y - 1]?.[x] ?? T) !== T ||
        (src[y + 1]?.[x] ?? T) !== T ||
        (src[y]?.[x - 1] ?? T) !== T ||
        (src[y]?.[x + 1] ?? T) !== T;
      if (touches) px(g, x, y, oc);
    }
  }
}

function mirrorRows(rows: string[]): string[] {
  return rows.map((row) => row.split('').reverse().join(''));
}

// ---------------------------------------------------------------------------
// 地面タイル（16×16・継ぎ目なし・輪郭線なし）

function tileGrass(seed: number, tufts: [number, number][]): Grid {
  const g = newGrid(16, 16);
  rect(g, 0, 0, 15, 15, 'g');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((x * 13 + y * 7 + seed * 11) % 17 < 3) px(g, x, y, 'G');
    }
  }
  for (const [x, y] of tufts) {
    px(g, x, y, 'G');
    px(g, x, y - 1, 'G');
  }
  return g;
}

function tileSand(): Grid {
  const g = newGrid(16, 16);
  rect(g, 0, 0, 15, 15, 's');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((x * 9 + y * 5) % 19 < 3) px(g, x, y, 'S');
    }
  }
  return g;
}

function tileWater(frame: 0 | 1): Grid {
  const g = newGrid(16, 16);
  rect(g, 0, 0, 15, 15, 'w');
  const shift = frame === 0 ? 0 : 3;
  for (let y = 0; y < 16; y++) {
    if (y % 4 < 2) {
      for (let x = 0; x < 16; x++) {
        if ((x + shift) % 6 < 2) px(g, x, y, 'W');
      }
    }
  }
  return g;
}

function tileSoil(): Grid {
  const g = newGrid(16, 16);
  rect(g, 0, 0, 15, 15, 'o');
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 1 || y % 4 === 2) rect(g, 0, y, 15, y, 'O');
  }
  return g;
}

// ---------------------------------------------------------------------------
// 波打ち際（水タイルの上に重ねる。陸に接する辺だけ泡を置く）

function shoreOverlay(dir: 'N' | 'S' | 'E' | 'W'): Grid {
  const g = newGrid(16, 16);
  if (dir === 'N') {
    rect(g, 0, 0, 15, 1, 'f');
    for (let x = 0; x < 16; x += 3) px(g, x, 2, 'f');
  } else if (dir === 'S') {
    rect(g, 0, 14, 15, 15, 'f');
    for (let x = 1; x < 16; x += 3) px(g, x, 13, 'f');
  } else if (dir === 'E') {
    rect(g, 14, 0, 15, 15, 'f');
    for (let y = 1; y < 16; y += 3) px(g, 13, y, 'f');
  } else {
    rect(g, 0, 0, 1, 15, 'f');
    for (let y = 0; y < 16; y += 3) px(g, 2, y, 'f');
  }
  return g;
}

// ---------------------------------------------------------------------------
// 資源ノード

function treeGrid(): Grid {
  const g = newGrid(16, 24);
  rect(g, 7, 18, 8, 23, 'B');
  circleFill(g, 8, 12, 7, 'L');
  circleFill(g, 7, 9, 5, 'l');
  outlineShape(g, 'K');
  return g;
}

function bigTreeGrid(): Grid {
  const g = newGrid(16, 32);
  rect(g, 5, 25, 10, 31, 'B');
  rect(g, 5, 25, 6, 31, 'O');
  circleFill(g, 8, 16, 9, 'L');
  circleFill(g, 7, 12, 7, 'l');
  outlineShape(g, 'K');
  return g;
}

function rockGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 3, 12, 13, 15, 'r');
  circleFill(g, 8, 10, 6, 'r');
  circleFill(g, 6, 8, 3, 'p');
  outlineShape(g, 'K');
  return g;
}

function hardRockGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 3, 12, 13, 15, 'R');
  circleFill(g, 8, 10, 6, 'R');
  circleFill(g, 6, 8, 3, 'r');
  for (const [x, y] of [
    [5, 9],
    [10, 7],
    [9, 12],
    [6, 13],
  ] as [number, number][]) {
    px(g, x, y, 'c');
  }
  outlineShape(g, 'K');
  return g;
}

function borderTreeGrid(): Grid {
  const g = newGrid(16, 32);
  rect(g, 4, 24, 11, 31, 'B');
  rect(g, 4, 24, 6, 31, 'O');
  circleFill(g, 8, 15, 10, 'L');
  circleFill(g, 7, 11, 7, 'l');
  for (const [x, y] of [
    [3, 10],
    [13, 9],
    [5, 20],
    [11, 22],
    [8, 6],
  ] as [number, number][]) {
    circleFill(g, x, y, 1, 'x');
  }
  outlineShape(g, 'K');
  return g;
}

function borderRockGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 13, 14, 15, 'q');
  circleFill(g, 8, 9, 7, 'q');
  circleFill(g, 6, 7, 3, 'p');
  px(g, 6, 5, 'K');
  px(g, 7, 6, 'K');
  px(g, 7, 7, 'K');
  px(g, 8, 8, 'K');
  px(g, 8, 9, 'K');
  px(g, 9, 10, 'K');
  outlineShape(g, 'K');
  return g;
}

/** ヤシの木（砂浜の tree ノード用）。幹が緩くカーブし、房状の葉を扇状に広げる。 */
function palmGrid(): Grid {
  const g = newGrid(16, 40);
  // 幹（下から上へ緩くカーブ）
  for (let y = 39; y >= 14; y--) {
    const t = (39 - y) / 25;
    const cx = 7 + Math.round(Math.sin(t * 1.6) * 2.2);
    px(g, cx, y, 'O');
    px(g, cx + 1, y, 'B');
  }
  // 葉（扇状に 6 房）
  const fronds: [number, number][] = [
    [2, 8],
    [4, 6],
    [7, 5],
    [10, 6],
    [13, 8],
    [8, 9],
  ];
  for (const [fx, fy] of fronds) {
    circleFill(g, fx, fy, 3, 'L');
    circleFill(g, fx, fy - 1, 2, 'l');
  }
  circleFill(g, 8, 8, 2, 'B');
  outlineShape(g, 'K');
  return g;
}

function stumpGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 6, 10, 9, 15, 'B');
  circleFill(g, 7, 10, 2, 'O');
  outlineShape(g, 'K');
  return g;
}

function rubbleGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 5, 13, 2, 'r');
  circleFill(g, 9, 14, 2, 'R');
  circleFill(g, 12, 12, 1, 'r');
  outlineShape(g, 'K');
  return g;
}

/** 昔の暮らしの名残：低い瓦礫の山（decor_rubble）。歩ける想定なので低め。 */
function decorRubbleGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 4, 12, 3, 'r');
  circleFill(g, 9, 13, 3, 'R');
  circleFill(g, 12, 10, 2, 'r');
  circleFill(g, 6, 9, 1, 'p');
  for (const [x, y] of [
    [3, 10],
    [10, 9],
  ] as [number, number][]) {
    circleFill(g, x, y, 1, 'x');
  }
  outlineShape(g, 'K');
  return g;
}

/** 崩れた石ブロック（decor_brokenStone）。四角い切石が斜めに崩れている。 */
function decorBrokenStoneGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 9, 9, 14, 'R');
  rect(g, 2, 9, 9, 10, 'p');
  rect(g, 8, 12, 14, 15, 'r');
  circleFill(g, 5, 7, 1, 'x');
  circleFill(g, 12, 13, 1, 'x');
  outlineShape(g, 'K');
  return g;
}

/** 折れた石柱（decor_pillar）。16×32。苔むした古代の柱、上半分が欠けている。 */
function decorPillarGrid(): Grid {
  const g = newGrid(16, 32);
  // 台座
  rect(g, 3, 28, 12, 31, 'R');
  // 柱身（縦の溝を筋で表現）
  rect(g, 5, 9, 10, 28, 'q');
  rect(g, 5, 9, 6, 28, 'R');
  for (let y = 10; y < 28; y += 4) px(g, 8, y, 'p');
  // 折れた断面（斜めに欠けている）
  rect(g, 5, 6, 12, 9, 'p');
  px(g, 11, 5, 'p');
  px(g, 12, 6, 'r');
  // 苔
  circleFill(g, 4, 20, 1, 'x');
  circleFill(g, 11, 24, 1, 'x');
  circleFill(g, 4, 30, 1, 'x');
  outlineShape(g, 'K');
  return g;
}

/** 商船（decor_ship）。7×8 マスの大きな置き物。船体・マスト・帆・小さな旗。 */
function decorShipGrid(): Grid {
  const TILE_PX = 16;
  const w = TILE_PX * 7;
  const h = TILE_PX * 8;
  const g = newGrid(w, h);
  const cx = Math.floor(w / 2);
  // 船体（下 1/3、台形）
  const hullTop = Math.floor(h * 0.62);
  const hullBottom = h - 10;
  for (let y = hullTop; y <= hullBottom; y++) {
    const t = (y - hullTop) / (hullBottom - hullTop);
    const halfW = Math.round((w / 2 - 6) * (1 - t * 0.55));
    rect(g, cx - halfW, y, cx + halfW, y, 'O');
  }
  for (let y = hullTop; y <= hullTop + 4; y++) {
    const t = (y - hullTop) / (hullBottom - hullTop);
    const halfW = Math.round((w / 2 - 6) * (1 - t * 0.55));
    rect(g, cx - halfW, y, cx + halfW, y, 'b');
  }
  // 波打ち際の影（船体の下）
  for (let x = cx - Math.floor(w / 2) + 4; x < cx + Math.floor(w / 2) - 4; x++) {
    px(g, x, hullBottom + 1, 'W');
    px(g, x, hullBottom + 2, 'w');
  }
  // マスト
  const mastX = cx - 4;
  rect(g, mastX, Math.floor(h * 0.08), mastX + 1, hullTop, 'B');
  // 帆（クリーム色・少したわむ台形）
  const sailTop = Math.floor(h * 0.1);
  const sailBottom = Math.floor(h * 0.5);
  for (let y = sailTop; y <= sailBottom; y++) {
    const t = (y - sailTop) / (sailBottom - sailTop);
    const rightW = Math.round(18 * Math.sin(t * Math.PI));
    rect(g, mastX + 2, y, mastX + 2 + Math.max(2, rightW), y, 'e');
  }
  // 帆のたわみの陰影
  for (let y = sailTop; y <= sailBottom; y += 3) {
    const t = (y - sailTop) / (sailBottom - sailTop);
    const rightW = Math.round(18 * Math.sin(t * Math.PI));
    px(g, mastX + 2 + Math.max(2, rightW) - 1, y, 'S');
  }
  // 旗
  rect(g, mastX + 1, sailTop - 5, mastX + 6, sailTop - 2, 'd');
  // 横帆桁
  rect(g, mastX - 6, sailTop - 1, mastX + 20, sailTop, 'z');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 設備（遺跡・作業台）
//
// 「ただの岩」に見えないよう、遺跡は縦長の石碑＋発光する紋様で「古代・魔法」を
// 強く出す。作業台は f_woodWorkbench（家具）と見分けがつくよう、天板の上に
// のこぎり・金づちを直接乗せた形にする。

function stationRuinsGrid(): Grid {
  const g = newGrid(16, 32);
  // 台座
  rect(g, 2, 27, 13, 31, 'R');
  rect(g, 2, 27, 13, 28, 'r');
  // 石碑本体（少し先細りの角柱）
  rect(g, 4, 6, 11, 27, 'q');
  rect(g, 4, 6, 6, 27, 'R');
  rect(g, 5, 3, 10, 6, 'q');
  // 苔
  for (const [x, y] of [
    [3, 24],
    [12, 20],
    [3, 15],
    [11, 9],
  ] as [number, number][]) {
    circleFill(g, x, y, 1, 'x');
  }
  // 発光する紋様（同心の輪＋十字）
  circleFill(g, 8, 15, 3, 'a');
  circleFill(g, 8, 15, 2, 'A');
  rect(g, 7, 10, 8, 20, 'a');
  rect(g, 3, 14, 12, 15, 'a');
  px(g, 8, 15, 'A');
  outlineShape(g, 'K');
  return g;
}

/** 船着き場の係留柱：太い杭にロープが巻きついている。 */
function stationDockGrid(): Grid {
  const g = newGrid(16, 24);
  rect(g, 6, 4, 9, 23, 'O');
  rect(g, 6, 4, 7, 23, 'B');
  for (const y of [8, 12, 16]) {
    rect(g, 4, y, 11, y + 1, 'z');
  }
  circleFill(g, 7, 4, 3, 'R');
  outlineShape(g, 'K');
  return g;
}

function stationWorkbenchGrid(): Grid {
  const g = newGrid(16, 24);
  // 脚
  rect(g, 2, 18, 3, 23, 'B');
  rect(g, 12, 18, 13, 23, 'B');
  // 天板
  rect(g, 1, 13, 14, 17, 'b');
  rect(g, 1, 13, 14, 14, 'h');
  // のこぎり（斜めの刃＋柄）
  rect(g, 2, 9, 9, 10, 'r');
  rect(g, 2, 9, 3, 12, 'z');
  for (let x = 3; x <= 9; x += 2) px(g, x, 11, 'r');
  // 金づち（頭＋柄）
  rect(g, 10, 5, 13, 8, 'R');
  rect(g, 11, 8, 12, 12, 'z');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 畑まわり

function signGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 7, 8, 15, 'B');
  rect(g, 2, 2, 13, 8, 'b');
  rect(g, 2, 2, 13, 3, 'h');
  outlineShape(g, 'K');
  return g;
}

function chestGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 7, 13, 14, 'b');
  rect(g, 2, 4, 13, 7, 'B');
  rect(g, 7, 8, 8, 11, 'v');
  outlineShape(g, 'K');
  return g;
}

function chestOpenGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 8, 13, 14, 'b');
  rect(g, 2, 8, 13, 9, 'O');
  rect(g, 2, 1, 13, 4, 'B');
  rect(g, 7, 10, 8, 12, 'v');
  outlineShape(g, 'K');
  return g;
}

function sproutGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 10, 8, 14, 'O');
  circleFill(g, 6, 9, 2, 'j');
  circleFill(g, 10, 9, 2, 'j');
  outlineShape(g, 'K');
  return g;
}

function midPlantGrid(accent: string): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 9, 8, 14, 'O');
  circleFill(g, 5, 8, 3, 'j');
  circleFill(g, 11, 8, 3, 'j');
  circleFill(g, 8, 6, 2, accent);
  outlineShape(g, 'K');
  return g;
}

function turnipRipeGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 6, 4, 2, 'j');
  circleFill(g, 10, 4, 2, 'j');
  circleFill(g, 8, 10, 5, 'e');
  circleFill(g, 8, 9, 4, 'u');
  outlineShape(g, 'K');
  return g;
}

function sunflowerRipeGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 10, 8, 15, 'j');
  circleFill(g, 8, 7, 5, 'i');
  circleFill(g, 8, 7, 2, 'O');
  outlineShape(g, 'K');
  return g;
}

function tomatoRipeGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 8, 5, 2, 'j');
  circleFill(g, 5, 7, 1, 'j');
  circleFill(g, 11, 7, 1, 'j');
  circleFill(g, 6, 10, 3, 'd');
  circleFill(g, 10, 10, 3, 'd');
  circleFill(g, 8, 13, 3, 'd');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// アイテムアイコン

function itemWoodGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 6, 13, 10, 'b');
  rect(g, 2, 6, 13, 7, 'h');
  circleFill(g, 2, 8, 2, 'O');
  circleFill(g, 13, 8, 2, 'O');
  outlineShape(g, 'K');
  return g;
}

function itemStoneGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 8, 9, 6, 'r');
  circleFill(g, 6, 7, 2, 'p');
  outlineShape(g, 'K');
  return g;
}

function itemCopperGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 8, 9, 6, 'R');
  for (const [x, y] of [
    [6, 8],
    [10, 7],
    [8, 11],
    [5, 11],
  ] as [number, number][]) {
    px(g, x, y, 'c');
  }
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 家具（f_<id>）

function fWoodFenceGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 4, 3, 15, 'b');
  rect(g, 12, 4, 13, 15, 'b');
  rect(g, 1, 6, 14, 8, 'h');
  rect(g, 1, 11, 14, 13, 'h');
  outlineShape(g, 'K');
  return g;
}

function fWoodPathGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 1, 14, 14, 'b');
  rect(g, 1, 1, 14, 2, 'h');
  rect(g, 1, 7, 14, 8, 'O');
  return g;
}

function fWoodSignGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 6, 2, 9, 15, 'B');
  rect(g, 6, 5, 9, 9, 'h');
  outlineShape(g, 'K');
  return g;
}

function fWoodBenchGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 10, 13, 11, 'b');
  rect(g, 2, 4, 13, 5, 'h');
  rect(g, 2, 6, 3, 10, 'B');
  rect(g, 12, 6, 13, 10, 'B');
  rect(g, 3, 12, 4, 15, 'B');
  rect(g, 11, 12, 12, 15, 'B');
  outlineShape(g, 'K');
  return g;
}

function fWoodDeskGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 7, 13, 9, 'b');
  rect(g, 2, 10, 13, 12, 'h');
  rect(g, 3, 10, 4, 15, 'B');
  rect(g, 11, 10, 12, 15, 'B');
  outlineShape(g, 'K');
  return g;
}

function fWoodWorkbenchGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 8, 14, 10, 'b');
  rect(g, 2, 11, 3, 15, 'B');
  rect(g, 12, 11, 13, 15, 'B');
  rect(g, 3, 3, 4, 8, 'z');
  rect(g, 3, 3, 10, 4, 'z');
  circleFill(g, 11, 5, 2, 'r');
  outlineShape(g, 'K');
  return g;
}

function fWoodTowerGrid(): Grid {
  const g = newGrid(16, 32);
  rect(g, 3, 10, 4, 31, 'B');
  rect(g, 11, 10, 12, 31, 'B');
  rect(g, 2, 8, 13, 11, 'b');
  rect(g, 4, 0, 11, 8, 'h');
  rect(g, 4, 0, 11, 1, 'O');
  outlineShape(g, 'K');
  return g;
}

function fStonePathGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 1, 14, 14, 'r');
  rect(g, 1, 1, 7, 7, 'p');
  rect(g, 8, 8, 14, 14, 'p');
  return g;
}

function fStoneFenceGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 6, 14, 15, 'r');
  rect(g, 1, 6, 14, 7, 'p');
  for (let x = 1; x < 14; x += 4) rect(g, x, 6, x, 15, 'R');
  outlineShape(g, 'K');
  return g;
}

function fStoneBenchGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 9, 13, 11, 'r');
  rect(g, 3, 12, 5, 15, 'R');
  rect(g, 10, 12, 12, 15, 'R');
  outlineShape(g, 'K');
  return g;
}

function fStoneOvenGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 6, 13, 15, 'r');
  rect(g, 10, 1, 12, 6, 'R');
  circleFill(g, 8, 11, 3, 'K');
  circleFill(g, 8, 11, 2, 'O');
  outlineShape(g, 'K');
  return g;
}

function fStoneLanternGrid(): Grid {
  const g = newGrid(16, 24);
  rect(g, 7, 10, 8, 23, 'r');
  rect(g, 4, 1, 11, 4, 'r');
  rect(g, 5, 4, 10, 10, 'R');
  rect(g, 6, 5, 9, 9, 'v');
  outlineShape(g, 'K');
  return g;
}

function fCopperLampGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 9, 8, 15, 'B');
  circleFill(g, 8, 7, 4, 'c');
  circleFill(g, 8, 7, 2, 'v');
  outlineShape(g, 'K');
  return g;
}

function fFlowerBedGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 10, 14, 14, 'O');
  for (const [x, y, c] of [
    [3, 9, 'u'],
    [6, 8, 'i'],
    [9, 9, 'u'],
    [12, 8, 'i'],
  ] as [number, number, string][]) {
    circleFill(g, x, y, 1, c);
    px(g, x, y + 1, 'j');
  }
  outlineShape(g, 'K');
  return g;
}

function fFlowerPotGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 5, 10, 10, 15, 'o');
  rect(g, 5, 10, 10, 11, 'O');
  circleFill(g, 8, 7, 3, 'j');
  circleFill(g, 6, 6, 1, 'u');
  circleFill(g, 10, 6, 1, 'i');
  circleFill(g, 8, 4, 1, 'u');
  outlineShape(g, 'K');
  return g;
}

function fFruitTableGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 9, 13, 10, 'b');
  rect(g, 3, 11, 4, 15, 'B');
  rect(g, 11, 11, 12, 15, 'B');
  circleFill(g, 6, 7, 2, 'd');
  circleFill(g, 10, 7, 2, 'j');
  outlineShape(g, 'K');
  return g;
}

function fVeggieStandGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 1, 9, 14, 10, 'b');
  rect(g, 2, 11, 3, 15, 'B');
  rect(g, 12, 11, 13, 15, 'B');
  rect(g, 3, 1, 12, 9, 'h');
  circleFill(g, 5, 6, 2, 'u');
  circleFill(g, 8, 5, 2, 'd');
  circleFill(g, 11, 6, 2, 'j');
  outlineShape(g, 'K');
  return g;
}

function fFlowerArchGrid(): Grid {
  const g = newGrid(16, 32);
  rect(g, 2, 10, 4, 31, 'B');
  rect(g, 11, 10, 13, 31, 'B');
  rect(g, 2, 4, 13, 10, 'B');
  for (const [x, y, c] of [
    [2, 4, 'u'],
    [5, 3, 'i'],
    [8, 3, 'u'],
    [11, 3, 'i'],
    [13, 4, 'u'],
    [2, 10, 'j'],
    [13, 10, 'j'],
  ] as [number, number, string][]) {
    circleFill(g, x, y, 2, c);
  }
  outlineShape(g, 'K');
  return g;
}

function fStoneStatueGrid(): Grid {
  const g = newGrid(16, 32);
  rect(g, 4, 26, 11, 31, 'R');
  rect(g, 6, 10, 9, 27, 'r');
  rect(g, 4, 10, 5, 20, 'r');
  rect(g, 10, 10, 11, 20, 'r');
  circleFill(g, 8, 7, 4, 'p');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// プレイヤー（4 方向 × 2 歩行フレーム。right は left を左右反転して作る）

function playerGrid(dir: 'down' | 'up' | 'left', frame: 0 | 1): Grid {
  const g = newGrid(16, 16);
  const frontLeg = frame === 0 ? 'n' : 'N';
  const backLeg = frame === 0 ? 'N' : 'n';
  rect(g, 5, 13, 6, 15, frontLeg);
  rect(g, 9, 13, 10, 15, backLeg);
  rect(g, 4, 8, 11, 13, 'm');
  if (dir === 'left') {
    rect(g, 2, 9, 3, 12, 'M');
  } else if (dir === 'down') {
    rect(g, 3, 9, 4, 12, 'M');
    rect(g, 11, 9, 12, 12, 'M');
  }
  circleFill(g, 8, 6, 4, 'k');
  if (dir === 'down') {
    px(g, 6, 6, 'K');
    px(g, 10, 6, 'K');
  }
  rect(g, 3, 2, 12, 3, 'y');
  rect(g, 5, 0, 10, 2, 'Y');
  if (dir === 'left') {
    rect(g, 1, 2, 3, 3, 'y');
  }
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 道具アイコン（振り動作のオーバーレイ）

function toolAxeGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 4, 3, 5, 13, 'b');
  rect(g, 6, 2, 12, 7, 'p');
  rect(g, 6, 2, 12, 3, 'r');
  outlineShape(g, 'K');
  return g;
}

function toolPickGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 5, 8, 14, 'b');
  rect(g, 2, 2, 5, 5, 'R');
  rect(g, 5, 3, 10, 6, 'R');
  rect(g, 9, 2, 13, 5, 'R');
  outlineShape(g, 'K');
  return g;
}

function toolHoeGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 2, 8, 12, 'b');
  rect(g, 3, 12, 12, 14, 'O');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 配置スペースの属性アイコン（白い記号＋輪郭線。輪郭が無いとクリーム背景に
// 白がほぼ溶けて見えなくなるため、他のスプライトと同じく 1px の暗い輪郭を足す）

function slotBenchGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 7, 13, 8, 'e');
  rect(g, 3, 9, 4, 12, 'e');
  rect(g, 11, 9, 12, 12, 'e');
  outlineShape(g, 'K');
  return g;
}

function slotLandmarkGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 7, 2, 8, 13, 'e');
  rect(g, 8, 2, 13, 7, 'e');
  outlineShape(g, 'K');
  return g;
}

function slotPathGrid(): Grid {
  const g = newGrid(16, 16);
  for (let i = 0; i < 4; i++) rect(g, 2 + i * 4, 7, 4 + i * 4, 8, 'e');
  outlineShape(g, 'K');
  return g;
}

function slotWorkbenchGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 3, 3, 4, 12, 'e');
  rect(g, 2, 2, 12, 4, 'e');
  rect(g, 10, 3, 13, 5, 'e');
  outlineShape(g, 'K');
  return g;
}

function slotKitchenGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 3, 7, 12, 12, 'e');
  rect(g, 6, 3, 9, 6, 'e');
  outlineShape(g, 'K');
  return g;
}

function slotDeskGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 3, 3, 12, 13, 'e');
  rect(g, 5, 6, 10, 6, T);
  rect(g, 5, 9, 10, 9, T);
  outlineShape(g, 'K');
  return g;
}

function slotDecorGrid(): Grid {
  const g = newGrid(16, 16);
  circleFill(g, 8, 8, 1, 'e');
  for (const [dx, dy] of [
    [0, -4],
    [0, 4],
    [-4, 0],
    [4, 0],
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as [number, number][]) {
    px(g, 8 + dx, 8 + dy, 'e');
  }
  outlineShape(g, 'K');
  return g;
}

function slotFenceGrid(): Grid {
  const g = newGrid(16, 16);
  rect(g, 2, 4, 3, 13, 'e');
  rect(g, 12, 4, 13, 13, 'e');
  rect(g, 1, 7, 14, 8, 'e');
  outlineShape(g, 'K');
  return g;
}

// ---------------------------------------------------------------------------
// 素材モード（Kenney / 仮素材）
//
// 既定は 'kenney'。localStorage に保存し、次に開いたときも保たれる
// （settings.ts の sound/haptics と同じ形）。モジュール読み込み時ではなく、
// 値が最初に要求されたタイミングで localStorage を読むのは、テスト環境や
// サーバーサイドでも安全に import できるようにするため。

export type ArtMode = 'kenney' | 'code';

const ART_KEY = 'survival-island:art';

let artMode: ArtMode | null = null;

function readArtMode(): ArtMode {
  try {
    const raw = localStorage.getItem(ART_KEY);
    return raw === 'code' ? 'code' : 'kenney';
  } catch {
    return 'kenney';
  }
}

function writeArtMode(mode: ArtMode): void {
  try {
    localStorage.setItem(ART_KEY, mode);
  } catch {
    // 保存できなくても遊べる
  }
}

export function getArtMode(): ArtMode {
  if (artMode === null) artMode = readArtMode();
  return artMode;
}

export function setArtMode(mode: ArtMode): void {
  artMode = mode;
  writeArtMode(mode);
  bakedCache.clear();
  dataUrlCache.clear();
}

// ---------------------------------------------------------------------------
// Kenney アトラス（scripts/build-atlas.mjs が生成する PNG + JSON）
//
// JSON は素の座標データなので DOM に触らず import できる。PNG は Vite の
// `?url` でファイル URL だけを取り、実際に読み込むのは loadArt() が呼ばれた
// ときだけ（= このファイル自体はモジュール読み込み時に Image を作らない）。

import atlasMeta from '../assets/kenney-atlas.json';
import atlasUrl from '../assets/kenney-atlas.png?url';

type AtlasRect = { x: number; y: number; w: number; h: number };
const ATLAS: Record<string, AtlasRect> = atlasMeta;

let atlasImage: HTMLImageElement | null = null;

/** Kenney アトラス画像を読み込む。main.tsx から最初の描画前に await される。
 *  失敗しても解決する（getSprite はコード版にフォールバックする）ので、
 *  ここで例外を投げて画面を止めることはない。 */
export function loadArt(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      atlasImage = img;
      bakedCache.clear();
      dataUrlCache.clear();
      resolve();
    };
    img.onerror = () => resolve();
    img.src = atlasUrl as unknown as string;
  });
}

// ---------------------------------------------------------------------------
// スプライト名とその定義

export type SpriteName =
  | 'grass'
  | 'grass2'
  | 'sand'
  | 'water'
  | 'water2'
  | 'soil'
  | 'shoreN'
  | 'shoreS'
  | 'shoreE'
  | 'shoreW'
  | 'tree'
  | 'bigTree'
  | 'rock'
  | 'hardRock'
  | 'borderTree'
  | 'borderRock'
  | 'stump'
  | 'rubble'
  | 'palm'
  | 'decor_rubble'
  | 'decor_brokenStone'
  | 'decor_pillar'
  | 'decor_ship'
  | 'station_ruins'
  | 'station_workbench'
  | 'station_dock'
  | 'sign'
  | 'chest'
  | 'chestOpen'
  | 'turnip0'
  | 'turnip1'
  | 'turnip2'
  | 'sunflower0'
  | 'sunflower1'
  | 'sunflower2'
  | 'tomato0'
  | 'tomato1'
  | 'tomato2'
  | 'item_wood'
  | 'item_stone'
  | 'item_copper'
  | 'item_turnip'
  | 'item_sunflower'
  | 'item_tomato'
  | 'f_woodFence'
  | 'f_woodPath'
  | 'f_woodSign'
  | 'f_woodBench'
  | 'f_woodDesk'
  | 'f_woodWorkbench'
  | 'f_woodTower'
  | 'f_stonePath'
  | 'f_stoneFence'
  | 'f_stoneBench'
  | 'f_stoneOven'
  | 'f_stoneLantern'
  | 'f_copperLamp'
  | 'f_flowerBed'
  | 'f_flowerPot'
  | 'f_fruitTable'
  | 'f_veggieStand'
  | 'f_flowerArch'
  | 'f_stoneStatue'
  | 'player_down0'
  | 'player_down1'
  | 'player_up0'
  | 'player_up1'
  | 'player_left0'
  | 'player_left1'
  | 'player_right0'
  | 'player_right1'
  | 'tool_axe'
  | 'tool_pick'
  | 'tool_hoe'
  | 'slot_bench'
  | 'slot_landmark'
  | 'slot_path'
  | 'slot_workbench'
  | 'slot_kitchen'
  | 'slot_desk'
  | 'slot_decor'
  | 'slot_fence';

export interface SpriteDef {
  rows: string[];
  palette: Record<string, string>;
}

const playerLeft0 = gridToRows(playerGrid('left', 0));
const playerLeft1 = gridToRows(playerGrid('left', 1));

export const SPRITE_DEFS: Record<SpriteName, SpriteDef> = {
  grass: { rows: gridToRows(tileGrass(0, [])), palette: PALETTE },
  grass2: {
    rows: gridToRows(
      tileGrass(3, [
        [2, 3],
        [9, 2],
        [13, 8],
        [4, 11],
        [11, 13],
        [6, 7],
      ])
    ),
    palette: PALETTE,
  },
  sand: { rows: gridToRows(tileSand()), palette: PALETTE },
  water: { rows: gridToRows(tileWater(0)), palette: PALETTE },
  water2: { rows: gridToRows(tileWater(1)), palette: PALETTE },
  soil: { rows: gridToRows(tileSoil()), palette: PALETTE },

  shoreN: { rows: gridToRows(shoreOverlay('N')), palette: PALETTE },
  shoreS: { rows: gridToRows(shoreOverlay('S')), palette: PALETTE },
  shoreE: { rows: gridToRows(shoreOverlay('E')), palette: PALETTE },
  shoreW: { rows: gridToRows(shoreOverlay('W')), palette: PALETTE },

  tree: { rows: gridToRows(treeGrid()), palette: PALETTE },
  bigTree: { rows: gridToRows(bigTreeGrid()), palette: PALETTE },
  rock: { rows: gridToRows(rockGrid()), palette: PALETTE },
  hardRock: { rows: gridToRows(hardRockGrid()), palette: PALETTE },
  borderTree: { rows: gridToRows(borderTreeGrid()), palette: PALETTE },
  borderRock: { rows: gridToRows(borderRockGrid()), palette: PALETTE },
  stump: { rows: gridToRows(stumpGrid()), palette: PALETTE },
  rubble: { rows: gridToRows(rubbleGrid()), palette: PALETTE },
  palm: { rows: gridToRows(palmGrid()), palette: PALETTE },
  decor_rubble: { rows: gridToRows(decorRubbleGrid()), palette: PALETTE },
  decor_brokenStone: { rows: gridToRows(decorBrokenStoneGrid()), palette: PALETTE },
  decor_pillar: { rows: gridToRows(decorPillarGrid()), palette: PALETTE },
  decor_ship: { rows: gridToRows(decorShipGrid()), palette: PALETTE },
  station_ruins: { rows: gridToRows(stationRuinsGrid()), palette: PALETTE },
  station_workbench: { rows: gridToRows(stationWorkbenchGrid()), palette: PALETTE },
  station_dock: { rows: gridToRows(stationDockGrid()), palette: PALETTE },

  sign: { rows: gridToRows(signGrid()), palette: PALETTE },
  chest: { rows: gridToRows(chestGrid()), palette: PALETTE },
  chestOpen: { rows: gridToRows(chestOpenGrid()), palette: PALETTE },

  turnip0: { rows: gridToRows(sproutGrid()), palette: PALETTE },
  turnip1: { rows: gridToRows(midPlantGrid('u')), palette: PALETTE },
  turnip2: { rows: gridToRows(turnipRipeGrid()), palette: PALETTE },
  sunflower0: { rows: gridToRows(sproutGrid()), palette: PALETTE },
  sunflower1: { rows: gridToRows(midPlantGrid('i')), palette: PALETTE },
  sunflower2: { rows: gridToRows(sunflowerRipeGrid()), palette: PALETTE },
  tomato0: { rows: gridToRows(sproutGrid()), palette: PALETTE },
  tomato1: { rows: gridToRows(midPlantGrid('d')), palette: PALETTE },
  tomato2: { rows: gridToRows(tomatoRipeGrid()), palette: PALETTE },

  item_wood: { rows: gridToRows(itemWoodGrid()), palette: PALETTE },
  item_stone: { rows: gridToRows(itemStoneGrid()), palette: PALETTE },
  item_copper: { rows: gridToRows(itemCopperGrid()), palette: PALETTE },
  item_turnip: { rows: gridToRows(turnipRipeGrid()), palette: PALETTE },
  item_sunflower: { rows: gridToRows(sunflowerRipeGrid()), palette: PALETTE },
  item_tomato: { rows: gridToRows(tomatoRipeGrid()), palette: PALETTE },

  f_woodFence: { rows: gridToRows(fWoodFenceGrid()), palette: PALETTE },
  f_woodPath: { rows: gridToRows(fWoodPathGrid()), palette: PALETTE },
  f_woodSign: { rows: gridToRows(fWoodSignGrid()), palette: PALETTE },
  f_woodBench: { rows: gridToRows(fWoodBenchGrid()), palette: PALETTE },
  f_woodDesk: { rows: gridToRows(fWoodDeskGrid()), palette: PALETTE },
  f_woodWorkbench: { rows: gridToRows(fWoodWorkbenchGrid()), palette: PALETTE },
  f_woodTower: { rows: gridToRows(fWoodTowerGrid()), palette: PALETTE },
  f_stonePath: { rows: gridToRows(fStonePathGrid()), palette: PALETTE },
  f_stoneFence: { rows: gridToRows(fStoneFenceGrid()), palette: PALETTE },
  f_stoneBench: { rows: gridToRows(fStoneBenchGrid()), palette: PALETTE },
  f_stoneOven: { rows: gridToRows(fStoneOvenGrid()), palette: PALETTE },
  f_stoneLantern: { rows: gridToRows(fStoneLanternGrid()), palette: PALETTE },
  f_copperLamp: { rows: gridToRows(fCopperLampGrid()), palette: PALETTE },
  f_flowerBed: { rows: gridToRows(fFlowerBedGrid()), palette: PALETTE },
  f_flowerPot: { rows: gridToRows(fFlowerPotGrid()), palette: PALETTE },
  f_fruitTable: { rows: gridToRows(fFruitTableGrid()), palette: PALETTE },
  f_veggieStand: { rows: gridToRows(fVeggieStandGrid()), palette: PALETTE },
  f_flowerArch: { rows: gridToRows(fFlowerArchGrid()), palette: PALETTE },
  f_stoneStatue: { rows: gridToRows(fStoneStatueGrid()), palette: PALETTE },

  player_down0: { rows: gridToRows(playerGrid('down', 0)), palette: PALETTE },
  player_down1: { rows: gridToRows(playerGrid('down', 1)), palette: PALETTE },
  player_up0: { rows: gridToRows(playerGrid('up', 0)), palette: PALETTE },
  player_up1: { rows: gridToRows(playerGrid('up', 1)), palette: PALETTE },
  player_left0: { rows: playerLeft0, palette: PALETTE },
  player_left1: { rows: playerLeft1, palette: PALETTE },
  player_right0: { rows: mirrorRows(playerLeft0), palette: PALETTE },
  player_right1: { rows: mirrorRows(playerLeft1), palette: PALETTE },

  tool_axe: { rows: gridToRows(toolAxeGrid()), palette: PALETTE },
  tool_pick: { rows: gridToRows(toolPickGrid()), palette: PALETTE },
  tool_hoe: { rows: gridToRows(toolHoeGrid()), palette: PALETTE },

  slot_bench: { rows: gridToRows(slotBenchGrid()), palette: PALETTE },
  slot_landmark: { rows: gridToRows(slotLandmarkGrid()), palette: PALETTE },
  slot_path: { rows: gridToRows(slotPathGrid()), palette: PALETTE },
  slot_workbench: { rows: gridToRows(slotWorkbenchGrid()), palette: PALETTE },
  slot_kitchen: { rows: gridToRows(slotKitchenGrid()), palette: PALETTE },
  slot_desk: { rows: gridToRows(slotDeskGrid()), palette: PALETTE },
  slot_decor: { rows: gridToRows(slotDecorGrid()), palette: PALETTE },
  slot_fence: { rows: gridToRows(slotFenceGrid()), palette: PALETTE },
};

// ---------------------------------------------------------------------------
// 焼く（Canvas API を使うのはここだけ。呼ぶまで実行されない＝遅延）

export interface BakedSprite {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** ワールドピクセル単位（2 倍後）の幅・高さ。1 マス = 32 なので幅は常に 32。 */
  w: number;
  h: number;
}

const SCALE = 2;

const bakedCache = new Map<SpriteName, BakedSprite>();
const dataUrlCache = new Map<SpriteName, string>();

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (hasOffscreenCanvas()) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** アトラスから焼く（Kenney 素材モード）。対応する名前が無ければ null。 */
function bakeFromAtlas(name: SpriteName): BakedSprite | null {
  if (!atlasImage) return null;
  const rect = ATLAS[name];
  if (!rect) return null;

  const w = rect.w * SCALE;
  const h = rect.h * SCALE;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasImage, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  }
  return { canvas, w, h };
}

/** コード定義のドット絵から焼く（仮素材モード・フォールバック）。 */
function bakeFromCode(name: SpriteName): BakedSprite {
  const def = SPRITE_DEFS[name];
  const srcH = def.rows.length;
  const srcW = def.rows[0]?.length ?? 0;
  const w = srcW * SCALE;
  const h = srcH * SCALE;

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < srcH; y++) {
      const row = def.rows[y] ?? '';
      for (let x = 0; x < srcW; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue;
        const color = def.palette[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
  }
  return { canvas, w, h };
}

function bake(name: SpriteName): BakedSprite {
  if (getArtMode() === 'kenney') {
    const fromAtlas = bakeFromAtlas(name);
    if (fromAtlas) return fromAtlas;
  }
  return bakeFromCode(name);
}

/** 名前でスプライトを引く。初回だけ焼いてキャッシュする。 */
export function getSprite(name: SpriteName): BakedSprite {
  let baked = bakedCache.get(name);
  if (!baked) {
    baked = bake(name);
    bakedCache.set(name, baked);
  }
  return baked;
}

export function spriteNames(): SpriteName[] {
  return Object.keys(SPRITE_DEFS) as SpriteName[];
}

/** `<img>` などで使うための data URL。こちらも遅延生成・キャッシュ。 */
export function spriteDataUrl(name: SpriteName): string {
  const cached = dataUrlCache.get(name);
  if (cached) return cached;

  const baked = getSprite(name);
  let canvas: HTMLCanvasElement;
  if (typeof HTMLCanvasElement !== 'undefined' && baked.canvas instanceof HTMLCanvasElement) {
    canvas = baked.canvas;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = baked.w;
    canvas.height = baked.h;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(baked.canvas as OffscreenCanvas, 0, 0);
  }
  const url = canvas.toDataURL();
  dataUrlCache.set(name, url);
  return url;
}
