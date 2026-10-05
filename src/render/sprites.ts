// スプライト（pigg 風のやわらかい絵）。React・DOM に依存しない「定義」と、Canvas へ焼く部分を分けている。
//
// 絵の出どころ:
//   0. ChatGPT で生成した素材シートの切り出し（src/assets/gen/*.png、scripts/slice-gen.mjs）。GEN_TARGET。最優先。
//   1. ユーザー提供の素材シート（src/assets/refimg/*.png ・ src/assets/pigg/*.png）
//   2. 下の painters に書いた「コードで描く滑らかなベクター絵」（作物・アイテム・道具・エフェクトなど、
//      提供素材に無いもの）。ドット絵は 1 つも使わない。
//
// `getSprite('tree')` のように名前で引く。焼くのは初回アクセス時（遅延）なので、
// このファイル自体は Canvas の無いテスト環境でも import できる。
//
// 1 マス = 32 ワールドピクセル。w/h はワールド px（描画側が scale 倍する）。
// 縦に長いスプライト（木など）はタイルの「下辺・中央」に合わせて描く。

import { drawAvatar, idlePose, type AvatarDir } from './avatar';
import { FURNITURE_MODEL_IDS, furnitureTiles, paintModelIcon } from './models';
import {
  paintAncientTree,
  paintAncientTree2,
  paintBigTree,
  paintCedarTree,
  paintFlower,
  paintFlowerSprout,
  paintItemFlowerSeed,
  paintItemPetal,
  paintItemSapling,
  paintGateCedar,
  paintGateOak,
  paintSapling,
  paintStump,
  paintStumpAncient,
  paintStumpCedar,
  paintStumpOak,
  paintTree,
} from './plantArt';

export type SpriteName =
  // 木は斧の必要段階ごとの樹種（plantArt.ts）: Lv0 若木 / Lv1 カシ / Lv2 スギ / Lv5 森の主。gate* は境界の木（ツタ付き）
  | 'tree'
  | 'bigTree'
  | 'gateOak'
  | 'cedarTree'
  | 'gateCedar'
  | 'ancientTree'
  | 'ancientTree2'
  | 'rock'
  | 'hardRock'
  | 'borderRock'
  | 'stump'
  | 'stumpOak'
  | 'stumpCedar'
  | 'stumpAncient'
  | 'rubble'
  | 'palm'
  | 'decor_rubble'
  | 'decor_brokenStone'
  | 'decor_pillar'
  | 'decor_ship'
  | 'decor_arch'
  | 'decor_campfire'
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
  | 'f_ruinPillar'
  | 'player_down0'
  | 'player_down1'
  | 'player_down2'
  | 'player_up0'
  | 'player_up1'
  | 'player_up2'
  | 'player_left0'
  | 'player_left1'
  | 'player_left2'
  | 'player_right0'
  | 'player_right1'
  | 'player_right2'
  | 'tool_axe'
  | 'tool_pick'
  | 'tool_hoe'
  | 'fx_sparkle'
  | 'fx_leaf'
  | 'fx_dust'
  | 'slot_bench'
  | 'slot_landmark'
  | 'slot_path'
  | 'slot_workbench'
  | 'slot_kitchen'
  | 'slot_desk'
  | 'slot_decor'
  | 'slot_fence'
  | 'deco_0'
  | 'deco_1'
  | 'deco_2'
  | 'deco_3'
  | 'deco_4'
  | 'deco_5'
  | 'deco_6'
  | 'deco_7'
  | 'deco_pebble'
  | 'deco_mossy'
  | 'deco_lily0'
  | 'deco_lily1'
  | 'deco_lily2'
  | 'deco_lily3'
  | 'deco_lily4'
  | 'deco_reed0'
  | 'deco_reed1'
  | 'deco_reed2'
  | 'deco_log'
  | 'deco_tuft0'
  | 'deco_tuft1'
  | 'sapling'
  | 'flower0'
  | 'flower1'
  | 'flower2'
  | 'flower3'
  | 'flowerSprout'
  | 'item_sapling'
  | 'item_flowerSeed'
  | 'item_petal'
  | 'f_campfire'
  | 'f_ruinArch'
  | 'f_oldPillar';

export interface BakedSprite {
  // 素材シート由来は元画像をそのまま返すことがあるので HTMLImageElement も許す。
  // ctx.drawImage は 3 つとも同じ CanvasImageSource として扱えるので描画側の分岐は要らない。
  canvas: HTMLCanvasElement | OffscreenCanvas | HTMLImageElement;
  /** ワールドピクセル単位の幅・高さ。 */
  w: number;
  h: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const bakedCache = new Map<string, BakedSprite>();
const dataUrlCache = new Map<string, string>();

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------------------------------------------------------------------
// 素材シートの読み込み（refimg / pigg）。glob は静的に URL 一覧を集めるだけで通信しない。

const refimgUrls = import.meta.glob('../assets/refimg/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const piggUrls = import.meta.glob('../assets/pigg/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
// ChatGPT で生成した素材シートを切り出したもの（scripts/slice-gen.mjs）。
const genUrls = import.meta.glob('../assets/gen/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const sheetImages = new Map<string, HTMLImageElement>();

function urlForSheet(name: string): string | undefined {
  const suffix = `/${name}.png`;
  for (const path in refimgUrls) if (path.endsWith(suffix)) return refimgUrls[path];
  for (const path in piggUrls) if (path.endsWith(suffix)) return piggUrls[path];
  for (const path in genUrls) if (path.endsWith(suffix)) return genUrls[path];
  return undefined;
}

function loadSheetImages(names: readonly string[]): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const url = urlForSheet(name);
          if (!url) return resolve();
          const img = new Image();
          img.onload = () => {
            sheetImages.set(name, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  ).then(() => undefined);
}

/** 素材を読み込む。main.tsx から最初の描画前に await される（失敗しても止まらない）。 */
export function loadArt(): Promise<void> {
  const names = Array.from(new Set([...Object.values(SHEET_TARGET), ...Object.values(GEN_TARGET)].map((spec) => spec.src)));
  return loadSheetImages(names).then(() => {
    bakedCache.clear();
    dataUrlCache.clear();
  });
}

// ---------------------------------------------------------------------------
// 素材シートへの対応表。worldW は「ワールド px（1 マス = 32）」での目標幅、高さは元画像の比率から出す。

interface SheetSpec {
  src: string;
  worldW: number;
  /** 指定すると高さで大きさを決める（向きごとに余白がちがう絵の大きさをそろえる用。worldW は無視）。 */
  worldH?: number;
  /** worldW と worldH の両方をそのまま使う（縦に伸ばした木など。既定は worldH から幅を出す）。 */
  stretch?: boolean;
  /** 左右反転（右向き 1 枚から左向きを作る）。 */
  flip?: boolean;
  tint?: string; // 乗算合成で色違いを作る
  /** 元画像 1px あたりのワールド px（同じシートから切った絵の大きさの差をそのまま保つ。worldW・worldH より優先）。 */
  scale?: number;
  /** 長辺をこのワールド px に合わせる（アイコン用。scale より優先）。 */
  fit?: number;
}

const BORDER_TINT = '#a99bd0'; // 境界ノード: 淡い紫がかった色
const STONE_TINT = '#a7afba'; // 石材家具用（暖色の木目を寒色の石灰岩っぽく）
const COPPER_TINT = '#e59a58'; // 銅ランプ

const SHEET_TARGET: Partial<Record<SpriteName, SheetSpec>> = {
  palm: { src: 'furn_palm_tree', worldW: 40 },
  rock: { src: 'rock_medium', worldW: 34 },
  hardRock: { src: 'rock_medium', worldW: 36, tint: '#8b97a3' },
  borderRock: { src: 'rock_medium', worldW: 36, tint: BORDER_TINT },

  rubble: { src: 'rock_pebble', worldW: 26 },
  chest: { src: 'furn_chest', worldW: 34 },
  chestOpen: { src: 'furn_chest', worldW: 34 },

  decor_campfire: { src: 'furn_campfire', worldW: 36 },
  decor_rubble: { src: 'rock_pile', worldW: 38 },
  decor_brokenStone: { src: 'rock_collapsed', worldW: 40 },
  decor_arch: { src: 'cave_entrance', worldW: 50 },
  decor_pillar: { src: 'rock_cliff', worldW: 42 },
  // ChatGPT で生成した pigg 風の帆船（scripts/import-generated.mjs で取り込み）。7×8 マスの用地に収まる大きさ。
  decor_ship: { src: 'pigg_ship', worldW: 84 },
  f_woodTower: { src: 'pigg_tower', worldW: 84 },
  f_flowerArch: { src: 'pigg_arch', worldW: 84 },
  station_ruins: { src: 'rock_fossil', worldW: 46 },
  station_workbench: { src: 'furn_workbench_blueprint', worldW: 48 },

  f_woodFence: { src: 'furn_fence_wood', worldW: 40 },
  f_woodSign: { src: 'furn_signpost', worldW: 30 },
  f_woodBench: { src: 'furn_bench_log', worldW: 42 },
  f_woodDesk: { src: 'furn_desk_dining', worldW: 42 },
  f_woodWorkbench: { src: 'furn_workbench', worldW: 44 },
  f_stoneFence: { src: 'furn_fence_white', worldW: 40 },
  f_stoneBench: { src: 'furn_bench', worldW: 42, tint: STONE_TINT },
  f_stoneOven: { src: 'furn_pizza_oven', worldW: 40 },
  f_stoneLantern: { src: 'furn_torch', worldW: 24 },
  f_copperLamp: { src: 'furn_torch', worldW: 24, tint: COPPER_TINT },
  f_flowerBed: { src: 'furn_flower_bed', worldW: 38 },
  f_flowerPot: { src: 'plant_02', worldW: 28 },
  f_fruitTable: { src: 'furn_barrel_table', worldW: 38 },
  f_veggieStand: { src: 'furn_fish_table', worldW: 42 },
  f_stoneStatue: { src: 'rock_big', worldW: 48, tint: STONE_TINT },
  f_ruinPillar: { src: 'rock_cliff', worldW: 42 },

  // 地面の飾り（当たり判定なし）。参考シートの花・草を色違いで混ぜる。
  // plant_10/16/54/59 は市松模様の抜き残りが出るので使わない。
  deco_0: { src: 'plant_01', worldW: 26 },
  deco_1: { src: 'plant_05', worldW: 26 },
  deco_2: { src: 'plant_12', worldW: 24 },
  deco_3: { src: 'plant_18', worldW: 26 },
  deco_4: { src: 'plant_22', worldW: 24 },
  deco_5: { src: 'plant_29', worldW: 26 },
  deco_6: { src: 'plant_33', worldW: 24 },
  deco_7: { src: 'plant_40', worldW: 26 },
  // 水面と岸の飾り（睡蓮・葦・丸太）
  deco_lily0: { src: 'plant_45', worldW: 58 },
  deco_lily1: { src: 'plant_47', worldW: 64 },
  deco_lily2: { src: 'plant_48', worldW: 52 },
  deco_lily3: { src: 'plant_52', worldW: 58 },
  deco_lily4: { src: 'plant_46', worldW: 50 },
  deco_reed0: { src: 'plant_49', worldW: 36 },
  deco_reed1: { src: 'plant_50', worldW: 38 },
  deco_reed2: { src: 'plant_38', worldW: 32 },
  deco_log: { src: 'plant_57', worldW: 44 },
  deco_pebble: { src: 'rock_pebble', worldW: 14 },
  deco_mossy: { src: 'rock_mossy', worldW: 22 },

  // 家具（素材シートから）
  f_campfire: { src: 'furn_campfire', worldW: 36 },
  f_ruinArch: { src: 'cave_entrance', worldW: 50 },
  f_oldPillar: { src: 'rock_cliff', worldW: 42 },
};

// ChatGPT で生成した素材（src/assets/gen/、scripts/slice-gen.mjs で切り出し）。PAINTERS より優先し、
// 画像が無いときだけ PAINTERS のコード描画に戻る。
// 作物は 1 枚のシートを同じ倍率で切っているので scale で大きさの差（成長段階）を保つ。土の山 166px ≈ 21 ワールド px。
const CROP_SCALE = 0.125;
const ICON_FIT = 22;
const GEN_TARGET: Partial<Record<SpriteName, SheetSpec>> = {
  turnip0: { src: 'turnip0', worldW: 0, scale: CROP_SCALE },
  turnip1: { src: 'turnip1', worldW: 0, scale: CROP_SCALE },
  turnip2: { src: 'turnip2', worldW: 0, scale: CROP_SCALE },
  sunflower0: { src: 'sunflower0', worldW: 0, scale: CROP_SCALE },
  sunflower1: { src: 'sunflower1', worldW: 0, scale: CROP_SCALE },
  sunflower2: { src: 'sunflower2', worldW: 0, scale: CROP_SCALE },
  tomato0: { src: 'tomato0', worldW: 0, scale: CROP_SCALE },
  tomato1: { src: 'tomato1', worldW: 0, scale: CROP_SCALE },
  tomato2: { src: 'tomato2', worldW: 0, scale: CROP_SCALE },
  item_turnip: { src: 'item_turnip', worldW: 0, fit: ICON_FIT },
  item_sunflower: { src: 'item_sunflower', worldW: 0, fit: ICON_FIT },
  item_tomato: { src: 'item_tomato', worldW: 0, fit: ICON_FIT },
  item_wood: { src: 'item_wood', worldW: 0, fit: ICON_FIT },
  item_stone: { src: 'item_stone', worldW: 0, fit: ICON_FIT },
  item_copper: { src: 'item_copper', worldW: 0, fit: ICON_FIT },
  item_sapling: { src: 'item_sapling', worldW: 0, fit: ICON_FIT },
  item_flowerSeed: { src: 'item_flowerSeed', worldW: 0, fit: ICON_FIT },
  item_petal: { src: 'item_petal', worldW: 0, fit: ICON_FIT },
  // 花・苗・幹（下辺中央が根元）。幅は今までのコード描画と同じにそろえる。
  flower0: { src: 'flower0', worldW: 0, fit: 25 },
  flower1: { src: 'flower1', worldW: 0, fit: 25 },
  flower2: { src: 'flower2', worldW: 0, fit: 25 },
  flower3: { src: 'flower3', worldW: 0, fit: 25 },
  flowerSprout: { src: 'flowerSprout', worldW: 0, fit: 14 },
  sapling: { src: 'sapling', worldW: 0, fit: 22 },
  stump: { src: 'stump', worldW: 22 },
  stumpOak: { src: 'stumpOak', worldW: 28 },
  stumpCedar: { src: 'stumpCedar', worldW: 26 },
  stumpAncient: { src: 'stumpAncient', worldW: 31 },
};

// ---------------------------------------------------------------------------
// コードで描くベクター絵。Canvas 座標はワールド px、内部は SUPERSAMPLE 倍の解像度で焼く。

const SUPERSAMPLE = 5;

type Painter = (ctx: Ctx2D) => void;
type Fill = string | CanvasGradient;

interface PainterSpec {
  w: number;
  h: number;
  paint: Painter;
}

// 配色（やさしい暖色の輪郭 + 明るいパステル）
const OUTLINE = '#6b4a35';
const LEAF = '#7fc45a';
const LEAF_DARK = '#4f9a43';
const SOIL = '#8a5a3c';

function ellipse(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number, fill: Fill, stroke?: string, lw = 0.7, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function roundedRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRR(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number, fill: Fill, stroke?: string, lw = 0.7): void {
  roundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function vgrad(ctx: Ctx2D, y0: number, y1: number, c0: string, c1: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

/** 葉 1 枚。(x,y) が付け根、ang は上向きが 0（ラジアン、右が正）、len が長さ。 */
function leaf(ctx: Ctx2D, x: number, y: number, len: number, ang: number, wid: number, fill = LEAF, stroke = LEAF_DARK): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.08);
  ctx.lineTo(0, -len * 0.82);
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.restore();
}

function moundOfSoil(ctx: Ctx2D, cx: number, cy: number, rx: number): void {
  ellipse(ctx, cx, cy, rx, rx * 0.42, vgrad(ctx, cy - rx * 0.4, cy + rx * 0.4, '#a67552', SOIL));
}

function star(ctx: Ctx2D, cx: number, cy: number, r: number, inner: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// --- 作物 -----------------------------------------------------------------

function paintTurnip(stage: 0 | 1 | 2): Painter {
  return (ctx) => {
    const cx = 16;
    const gy = 28;
    moundOfSoil(ctx, cx, gy, 9);
    if (stage === 0) {
      leaf(ctx, cx, gy - 1, 8, -0.5, 2.2);
      leaf(ctx, cx, gy - 1, 8, 0.5, 2.2);
      return;
    }
    if (stage === 2) {
      // 土から頭を出したかぶ
      ellipse(ctx, cx, gy - 3, 6.2, 5.4, vgrad(ctx, gy - 9, gy + 1, '#fffaf2', '#f0cfe0'), '#c9a0b4', 0.6);
      ellipse(ctx, cx - 1.6, gy - 5.2, 2, 1.3, 'rgba(255,255,255,0.75)');
      moundOfSoil(ctx, cx, gy + 1.4, 8);
    }
    const base = stage === 2 ? gy - 7 : gy - 1;
    const len = stage === 2 ? 15 : 11;
    for (const a of [-0.95, -0.5, 0, 0.5, 0.95]) leaf(ctx, cx, base, len * (1 - Math.abs(a) * 0.18), a, stage === 2 ? 3.2 : 2.6);
  };
}

function paintSunflower(stage: 0 | 1 | 2): Painter {
  return (ctx) => {
    const cx = 16;
    const gy = 29;
    moundOfSoil(ctx, cx, gy, 8);
    if (stage === 0) {
      leaf(ctx, cx, gy - 1, 7, -0.7, 2);
      leaf(ctx, cx, gy - 1, 7, 0.7, 2);
      return;
    }
    const top = stage === 2 ? gy - 22 : gy - 13;
    ctx.beginPath();
    ctx.moveTo(cx, gy - 1);
    ctx.quadraticCurveTo(cx + 1, (gy + top) / 2, cx, top);
    ctx.lineWidth = 2;
    ctx.strokeStyle = LEAF_DARK;
    ctx.stroke();
    leaf(ctx, cx, gy - 6, 10, -1.1, 3.2);
    leaf(ctx, cx, gy - 10, 10, 1.1, 3.2);
    if (stage === 1) {
      ellipse(ctx, cx, top, 3.2, 3.2, '#8fce5f', LEAF_DARK, 0.6);
      return;
    }
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14;
      ellipse(ctx, cx + Math.cos(a) * 5.6, top + Math.sin(a) * 5.6, 3.3, 1.7, i % 2 ? '#ffd23f' : '#ffc21a', '#d99a0a', 0.4, a);
    }
    ellipse(ctx, cx, top, 4.2, 4.2, vgrad(ctx, top - 4, top + 4, '#8a5a2b', '#5a3a1e'), '#4a2f18', 0.5);
    ellipse(ctx, cx - 1.2, top - 1.3, 1.1, 0.9, 'rgba(255,220,160,0.5)');
  };
}

function paintTomato(stage: 0 | 1 | 2): Painter {
  return (ctx) => {
    const cx = 16;
    const gy = 29;
    moundOfSoil(ctx, cx, gy, 9);
    if (stage === 0) {
      leaf(ctx, cx, gy - 1, 7, -0.7, 2.2);
      leaf(ctx, cx, gy - 1, 7, 0.7, 2.2);
      return;
    }
    const spread = stage === 2 ? 1 : 0.7;
    for (const a of [-1.2, -0.75, -0.3, 0.3, 0.75, 1.2]) leaf(ctx, cx, gy - 2, 13 * spread * (1 - Math.abs(a) * 0.12), a, 3.6 * spread + 0.4);
    if (stage === 1) {
      for (const [dx, dy] of [[-4, -12], [3, -15]] as const) ellipse(ctx, cx + dx, gy + dy, 1.2, 1.2, '#ffe36a');
      return;
    }
    for (const [dx, dy, r] of [[-6, -9, 3.6], [5, -11, 3.9], [-1, -16, 3.4], [7, -5, 3.2]] as const) {
      const x = cx + dx;
      const y = gy + dy;
      ellipse(ctx, x, y, r, r * 0.93, vgrad(ctx, y - r, y + r, '#ff7a5c', '#d8362c'), '#a8231c', 0.5);
      ellipse(ctx, x - r * 0.35, y - r * 0.4, r * 0.32, r * 0.22, 'rgba(255,255,255,0.7)');
      leaf(ctx, x, y - r * 0.7, r * 0.9, -0.4, r * 0.4, '#5fae4a', '#3d7a34');
      leaf(ctx, x, y - r * 0.7, r * 0.9, 0.4, r * 0.4, '#5fae4a', '#3d7a34');
    }
  };
}

// --- アイテムアイコン -------------------------------------------------------

function log(ctx: Ctx2D, x: number, y: number, len: number, r: number): void {
  fillRR(ctx, x, y - r, len, r * 2, r * 0.5, vgrad(ctx, y - r, y + r, '#c99a63', '#96683d'), '#6f4a2a', 0.6);
  ellipse(ctx, x + len, y, r * 0.55, r, '#e6c18a', '#6f4a2a', 0.6);
  ellipse(ctx, x + len, y, r * 0.28, r * 0.5, 'rgba(150,100,60,0.5)');
}

const paintItemWood: Painter = (ctx) => {
  log(ctx, 3, 15, 14, 3.6);
  log(ctx, 5, 8.5, 14, 3.6);
  log(ctx, 2, 21.5, 15, 3.4);
};

const paintItemStone: Painter = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(4, 18);
  ctx.quadraticCurveTo(3, 9, 10, 6.5);
  ctx.quadraticCurveTo(17, 4, 20, 11);
  ctx.quadraticCurveTo(23, 19, 17, 20.5);
  ctx.quadraticCurveTo(8, 22, 4, 18);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 5, 22, '#e2e4e7', '#9a9fa6');
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#6f757c';
  ctx.stroke();
  ellipse(ctx, 9.5, 10.5, 3.2, 1.6, 'rgba(255,255,255,0.65)', undefined, 0, -0.5);
};

const paintItemCopper: Painter = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(4, 17);
  ctx.lineTo(7, 8);
  ctx.lineTo(15, 5);
  ctx.lineTo(21, 10);
  ctx.lineTo(20, 18);
  ctx.lineTo(12, 21.5);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 5, 22, '#f0a26a', '#b25a2c');
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#7d3c1c';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7, 8);
  ctx.lineTo(13, 12);
  ctx.lineTo(15, 5);
  ctx.moveTo(13, 12);
  ctx.lineTo(12, 21.5);
  ctx.moveTo(13, 12);
  ctx.lineTo(21, 10);
  ctx.strokeStyle = 'rgba(125,60,28,0.55)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  star(ctx, 17, 8, 2.4, 0.8, 'rgba(255,255,255,0.85)');
};

const paintItemTurnip: Painter = (ctx) => {
  for (const a of [-0.6, 0, 0.6]) leaf(ctx, 12, 9.5, 8, a, 2.4);
  ellipse(ctx, 12, 15.5, 6.6, 6.2, vgrad(ctx, 9, 22, '#fffaf2', '#ecc3d8'), '#b98aa2', 0.6);
  ellipse(ctx, 9.6, 12.8, 2, 1.3, 'rgba(255,255,255,0.75)');
};

const paintItemSunflower: Painter = (ctx) => {
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    ellipse(ctx, 12 + Math.cos(a) * 6.6, 12 + Math.sin(a) * 6.6, 3.6, 1.9, i % 2 ? '#ffd23f' : '#ffc21a', '#d99a0a', 0.4, a);
  }
  ellipse(ctx, 12, 12, 4.6, 4.6, vgrad(ctx, 7, 17, '#8a5a2b', '#5a3a1e'), '#4a2f18', 0.5);
};

const paintItemTomato: Painter = (ctx) => {
  ellipse(ctx, 12, 13.5, 7.8, 7.2, vgrad(ctx, 6, 21, '#ff7a5c', '#d8362c'), '#a8231c', 0.6);
  ellipse(ctx, 9, 10.5, 2.4, 1.5, 'rgba(255,255,255,0.7)');
  for (const a of [-1.1, -0.4, 0.4, 1.1]) leaf(ctx, 12, 7.2, 4.6, a, 1.6, '#5fae4a', '#3d7a34');
};

// --- 道具 -----------------------------------------------------------------
// 描画側は「下辺中央を握り手（回転の中心）」にして回すので、持ち手の下端を (w/2, h) に置く。

function handle(ctx: Ctx2D, x: number, y0: number, y1: number): void {
  fillRR(ctx, x - 1.5, y1, 3, y0 - y1, 1.5, vgrad(ctx, y1, y0, '#c99a63', '#8a5a3c'), '#6f4a2a', 0.5);
}

const paintToolAxe: Painter = (ctx) => {
  handle(ctx, 11, 28, 5);
  ctx.beginPath();
  ctx.moveTo(11, 4.5);
  ctx.quadraticCurveTo(15, 0.5, 20.5, 2.5);
  ctx.quadraticCurveTo(22, 8, 20, 11);
  ctx.quadraticCurveTo(15, 10, 11, 10);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 1, 11, '#eef1f4', '#9aa2ab');
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#5f6770';
  ctx.stroke();
};

const paintToolPick: Painter = (ctx) => {
  handle(ctx, 11, 28, 6);
  ctx.beginPath();
  ctx.moveTo(1.5, 8);
  ctx.quadraticCurveTo(11, -1, 20.5, 8);
  ctx.quadraticCurveTo(11, 3.6, 1.5, 8);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 0, 8, '#eef1f4', '#8f979f');
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#5f6770';
  ctx.stroke();
};

const paintToolHoe: Painter = (ctx) => {
  handle(ctx, 11, 28, 5);
  ctx.beginPath();
  ctx.moveTo(11, 4);
  ctx.lineTo(21, 3);
  ctx.lineTo(19.5, 10.5);
  ctx.lineTo(11, 8);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 3, 10, '#eef1f4', '#8f979f');
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#5f6770';
  ctx.stroke();
};

// --- エフェクト -------------------------------------------------------------

const paintFxLeaf: Painter = (ctx) => leaf(ctx, 5, 9, 8, 0.6, 3);

const paintFxDust: Painter = (ctx) => {
  const g = ctx.createRadialGradient(5, 5, 0.5, 5, 5, 5);
  g.addColorStop(0, 'rgba(255,248,230,0.95)');
  g.addColorStop(1, 'rgba(230,205,160,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(5, 5, 5, 0, Math.PI * 2);
  ctx.fill();
};

const paintFxSparkle: Painter = (ctx) => {
  const g = ctx.createRadialGradient(8, 8, 0.5, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,220,0.9)');
  g.addColorStop(1, 'rgba(255,230,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(8, 8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 0.5);
  ctx.quadraticCurveTo(8.8, 7.2, 15.5, 8);
  ctx.quadraticCurveTo(8.8, 8.8, 8, 15.5);
  ctx.quadraticCurveTo(7.2, 8.8, 0.5, 8);
  ctx.quadraticCurveTo(7.2, 7.2, 8, 0.5);
  ctx.closePath();
  ctx.fillStyle = '#fff6c2';
  ctx.fill();
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = '#f0c33a';
  ctx.stroke();
};

// --- 看板・宝箱まわり ---------------------------------------------------------

const paintSign: Painter = (ctx) => {
  fillRR(ctx, 10.5, 14, 3.4, 18, 1.2, vgrad(ctx, 14, 32, '#b98a58', '#8a5a3c'), OUTLINE, 0.5);
  fillRR(ctx, 2, 3, 20, 13, 2.6, vgrad(ctx, 3, 16, '#e8c48c', '#c9955c'), OUTLINE, 0.7);
  ctx.strokeStyle = 'rgba(111,74,42,0.35)';
  ctx.lineWidth = 0.5;
  for (const y of [7.5, 11.5]) {
    ctx.beginPath();
    ctx.moveTo(4.5, y);
    ctx.lineTo(19.5, y);
    ctx.stroke();
  }
  ellipse(ctx, 4.6, 5.6, 0.8, 0.8, '#7a5a3c');
  ellipse(ctx, 19.4, 5.6, 0.8, 0.8, '#7a5a3c');
  ellipse(ctx, 12, 33, 6, 1.6, 'rgba(0,0,0,0.0)');
  leaf(ctx, 15, 32, 5, 0.9, 1.6);
  leaf(ctx, 9, 32, 5, -0.9, 1.6);
};

// --- 船・桟橋・大物 ----------------------------------------------------------

const paintDock: Painter = (ctx) => {
  // 係留杭（ロープを巻いた丸い杭）
  fillRR(ctx, 6, 8, 12, 22, 5, vgrad(ctx, 8, 30, '#b98a58', '#7d5232'), OUTLINE, 0.7);
  ellipse(ctx, 12, 8.5, 6, 2.6, '#dcb47c', OUTLINE, 0.7);
  ctx.strokeStyle = '#e8d6a4';
  ctx.lineWidth = 1.6;
  for (const y of [15, 19.5]) {
    ctx.beginPath();
    ctx.ellipse(12, y, 6.4, 2, 0, 0, Math.PI);
    ctx.stroke();
  }
};

// --- 配置スロットの記号 -------------------------------------------------------

function badge(ctx: Ctx2D, color: string, draw: (ctx: Ctx2D) => void): void {
  ellipse(ctx, 10, 10, 9, 9, 'rgba(255,255,255,0.88)', color, 1);
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  draw(ctx);
  ctx.restore();
}

const SLOT_COLOR = {
  bench: '#c97b4a',
  landmark: '#d64550',
  path: '#b8a06a',
  workbench: '#5d8fc9',
  kitchen: '#e0a72e',
  desk: '#7a5ac9',
  decor: '#3fae7a',
  fence: '#7a8a3f',
} as const;

function slotPainter(kind: keyof typeof SLOT_COLOR): Painter {
  const color = SLOT_COLOR[kind];
  return (ctx) =>
    badge(ctx, color, (c) => {
      switch (kind) {
        case 'bench':
          c.fillRect(5, 8, 10, 2.6);
          c.fillRect(5.6, 10.6, 1.6, 4);
          c.fillRect(12.8, 10.6, 1.6, 4);
          break;
        case 'landmark':
          c.fillRect(6.6, 4.5, 1.4, 11);
          c.beginPath();
          c.moveTo(8, 4.5);
          c.lineTo(15, 7.2);
          c.lineTo(8, 10);
          c.fill();
          break;
        case 'path':
          for (const [x, y] of [[6.5, 13], [10, 9.6], [13.5, 6.4]] as const) ellipse(c, x, y, 2.2, 1.7, color);
          break;
        case 'workbench':
          c.save();
          c.translate(10, 10);
          c.rotate(0.7);
          c.fillRect(-0.9, -6, 1.8, 12);
          c.fillRect(-4, -6.5, 8, 3.4);
          c.restore();
          break;
        case 'kitchen':
          fillRR(c, 5, 8, 10, 6.4, 2.2, color);
          c.fillRect(3.4, 8.6, 2, 1.4);
          c.fillRect(14.6, 8.6, 2, 1.4);
          c.beginPath();
          c.arc(10, 6.6, 1.5, 0, Math.PI * 2);
          c.fill();
          break;
        case 'desk':
          c.fillRect(4.6, 7.4, 10.8, 2);
          c.fillRect(5.6, 9.4, 1.6, 5);
          c.fillRect(12.8, 9.4, 1.6, 5);
          break;
        case 'decor':
          for (let k = 0; k < 5; k++) {
            const a = (Math.PI * 2 * k) / 5 - Math.PI / 2;
            ellipse(c, 10 + Math.cos(a) * 3.3, 10 + Math.sin(a) * 3.3, 2.2, 2.2, color);
          }
          ellipse(c, 10, 10, 1.6, 1.6, '#fff6c2');
          break;
        case 'fence':
          for (const x of [5.4, 9.2, 13]) fillRR(c, x, 5.4, 1.9, 9, 0.8, color);
          c.fillRect(4.6, 8, 11, 1.3);
          c.fillRect(4.6, 11.2, 11, 1.3);
          break;
      }
    });
}

// --- 道タイル（クラフト画面・持ち物のアイコン。ワールドの敷石は renderer が同じ絵を敷く） --------

const paintWoodPath: Painter = (ctx) => {
  const rows = 4;
  const rh = 32 / rows;
  const tones = ['#d9b27a', '#cfa46a', '#dcb680', '#c99b62'];
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const joint = 6 + ((r * 13) % 20);
    for (const [x0, x1] of [[0, joint], [joint, 32]] as const) {
      ctx.fillStyle = tones[(r + (x0 ? 1 : 0)) % tones.length]!;
      ctx.fillRect(x0, y, x1 - x0, rh);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x0, y, x1 - x0, 1);
    }
    ctx.fillStyle = 'rgba(90,58,30,0.5)';
    ctx.fillRect(0, y + rh - 0.8, 32, 0.8);
    ctx.fillRect(joint - 0.4, y, 0.8, rh);
  }
};

const paintStonePath: Painter = (ctx) => {
  ctx.fillStyle = '#b9b4a8';
  ctx.fillRect(0, 0, 32, 32);
  const stones: [number, number, number, number, string][] = [
    [1, 1, 14, 14, '#dad6cb'], [17, 1, 14, 14, '#cfcbbf'],
    [1, 17, 14, 14, '#cfcbbf'], [17, 17, 14, 14, '#dad6cb'],
  ];
  for (const [x, y, w, h, c] of stones) {
    fillRR(ctx, x, y, w, h, 4, c, 'rgba(120,114,100,0.6)', 0.6);
    ellipse(ctx, x + 4.5, y + 4, 3, 1.6, 'rgba(255,255,255,0.45)');
  }
};

// 草の葉先。ピグライフの地面の印と同じ、輪郭なしの細いギザギザ（「W」の字）を 1 色だけで描く。
// 色は実測 #78b862（地の草 #92cb6e より一段だけ濃い）。
function paintTuft(variant: 0 | 1): Painter {
  return (ctx) => {
    const pts: [number, number][] =
      variant === 0
        ? [[3, 11], [5.2, 4], [7.6, 10], [9.6, 2.4], [12, 10], [14.2, 5], [16, 11]]
        : [[4, 11], [6.4, 3.4], [9, 10], [11.4, 4.6], [14, 11]];
    ctx.save();
    ctx.strokeStyle = '#78b862';
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();
  };
}

// 主人公（avatar.ts のコード描画）。アイコン・一覧用の立ち止まり姿。歩き・作業は renderer が drawAvatar で直接描く。
function paintPlayer(dir: AvatarDir): Painter {
  return (ctx) => drawAvatar(ctx, 15, 41, 1, idlePose(dir));
}
const PLAYER = (dir: AvatarDir): PainterSpec => ({ w: 30, h: 42, paint: paintPlayer(dir) });

const PAINTERS: Partial<Record<SpriteName, PainterSpec>> = {
  // 木・花（plantArt.ts）。下辺中央が根元。
  // 樹種（必要な斧の段階が上がるほど大きく・暗く）。梢の幅は描画側で 1.4 マス（44.8px）までに収まる。
  tree: { w: 32, h: 46, paint: paintTree },
  bigTree: { w: 42, h: 64, paint: paintBigTree },
  gateOak: { w: 42, h: 64, paint: paintGateOak },
  cedarTree: { w: 40, h: 82, paint: paintCedarTree },
  gateCedar: { w: 40, h: 82, paint: paintGateCedar },
  ancientTree: { w: 45, h: 80, paint: paintAncientTree },
  ancientTree2: { w: 45, h: 80, paint: paintAncientTree2 },
  stump: { w: 22, h: 16, paint: paintStump },
  stumpOak: { w: 28, h: 20, paint: paintStumpOak },
  stumpCedar: { w: 26, h: 20, paint: paintStumpCedar },
  stumpAncient: { w: 30, h: 24, paint: paintStumpAncient },
  sapling: { w: 20, h: 22, paint: paintSapling },
  flower0: { w: 26, h: 26, paint: paintFlower(0) },
  flower1: { w: 26, h: 26, paint: paintFlower(1) },
  flower2: { w: 26, h: 26, paint: paintFlower(2) },
  flower3: { w: 26, h: 26, paint: paintFlower(3) },
  flowerSprout: { w: 16, h: 14, paint: paintFlowerSprout },
  item_sapling: { w: 24, h: 24, paint: paintItemSapling },
  item_flowerSeed: { w: 24, h: 24, paint: paintItemFlowerSeed },
  item_petal: { w: 24, h: 24, paint: paintItemPetal },
  player_down0: PLAYER('down'),
  player_down1: PLAYER('down'),
  player_down2: PLAYER('down'),
  player_up0: PLAYER('up'),
  player_up1: PLAYER('up'),
  player_up2: PLAYER('up'),
  player_right0: PLAYER('right'),
  player_right1: PLAYER('right'),
  player_right2: PLAYER('right'),
  player_left0: PLAYER('left'),
  player_left1: PLAYER('left'),
  player_left2: PLAYER('left'),
  deco_tuft0: { w: 18, h: 12, paint: paintTuft(0) },
  deco_tuft1: { w: 18, h: 12, paint: paintTuft(1) },
  turnip0: { w: 32, h: 32, paint: paintTurnip(0) },
  turnip1: { w: 32, h: 32, paint: paintTurnip(1) },
  turnip2: { w: 32, h: 32, paint: paintTurnip(2) },
  sunflower0: { w: 32, h: 32, paint: paintSunflower(0) },
  sunflower1: { w: 32, h: 32, paint: paintSunflower(1) },
  sunflower2: { w: 32, h: 32, paint: paintSunflower(2) },
  tomato0: { w: 32, h: 32, paint: paintTomato(0) },
  tomato1: { w: 32, h: 32, paint: paintTomato(1) },
  tomato2: { w: 32, h: 32, paint: paintTomato(2) },
  item_wood: { w: 24, h: 24, paint: paintItemWood },
  item_stone: { w: 24, h: 24, paint: paintItemStone },
  item_copper: { w: 24, h: 24, paint: paintItemCopper },
  item_turnip: { w: 24, h: 24, paint: paintItemTurnip },
  item_sunflower: { w: 24, h: 24, paint: paintItemSunflower },
  item_tomato: { w: 24, h: 24, paint: paintItemTomato },
  tool_axe: { w: 22, h: 28, paint: paintToolAxe },
  tool_pick: { w: 22, h: 28, paint: paintToolPick },
  tool_hoe: { w: 22, h: 28, paint: paintToolHoe },
  fx_leaf: { w: 10, h: 10, paint: paintFxLeaf },
  fx_dust: { w: 10, h: 10, paint: paintFxDust },
  fx_sparkle: { w: 16, h: 16, paint: paintFxSparkle },
  sign: { w: 24, h: 34, paint: paintSign },
  station_dock: { w: 24, h: 32, paint: paintDock },
  f_woodPath: { w: 32, h: 32, paint: paintWoodPath },
  f_stonePath: { w: 32, h: 32, paint: paintStonePath },
  slot_bench: { w: 20, h: 20, paint: slotPainter('bench') },
  slot_landmark: { w: 20, h: 20, paint: slotPainter('landmark') },
  slot_path: { w: 20, h: 20, paint: slotPainter('path') },
  slot_workbench: { w: 20, h: 20, paint: slotPainter('workbench') },
  slot_kitchen: { w: 20, h: 20, paint: slotPainter('kitchen') },
  slot_desk: { w: 20, h: 20, paint: slotPainter('desk') },
  slot_decor: { w: 20, h: 20, paint: slotPainter('decor') },
  slot_fence: { w: 20, h: 20, paint: slotPainter('fence') },
};

// 家具・宝箱・看板のアイコン（models.ts の 3D 模型を 3/4 の固定視点で描く。盤面と同じ形になる）。
// 素材シートの同名エントリより PAINTERS が優先される。
for (const id of FURNITURE_MODEL_IDS) {
  PAINTERS[`f_${id}` as SpriteName] = { w: 40, h: 40, paint: (ctx) => paintModelIcon(ctx, id, furnitureTiles(id), 40, 40) };
}
for (const name of ['chest', 'chestOpen', 'sign'] as const) PAINTERS[name] = { w: 34, h: 34, paint: (ctx) => paintModelIcon(ctx, name, 1, 34, 34) };

function bakePainted(spec: PainterSpec): BakedSprite {
  const canvas = makeCanvas(Math.ceil(spec.w * SUPERSAMPLE), Math.ceil(spec.h * SUPERSAMPLE));
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (ctx) {
    ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    spec.paint(ctx);
  }
  return { canvas, w: spec.w, h: spec.h };
}

function bakeTinted(img: HTMLImageElement, tint: string): HTMLCanvasElement | OffscreenCanvas {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (ctx) {
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  return canvas;
}

function bakeFlipped(img: HTMLImageElement): HTMLCanvasElement | OffscreenCanvas {
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (ctx) {
    ctx.translate(img.naturalWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
  }
  return canvas;
}

function bakeFromSheet(spec: SheetSpec | undefined): BakedSprite | null {
  if (!spec) return null;
  const img = sheetImages.get(spec.src);
  if (!img) return null;
  const aspect = img.naturalHeight / img.naturalWidth;
  const source: CanvasImageSource = spec.tint ? bakeTinted(img, spec.tint) : spec.flip ? bakeFlipped(img) : img;
  if (spec.fit) {
    const f = spec.fit / Math.max(img.naturalWidth, img.naturalHeight);
    return { canvas: source, w: img.naturalWidth * f, h: img.naturalHeight * f };
  }
  if (spec.scale) return { canvas: source, w: img.naturalWidth * spec.scale, h: img.naturalHeight * spec.scale };
  const w = spec.worldH && !spec.stretch ? spec.worldH / aspect : spec.worldW;
  const h = spec.worldH ?? spec.worldW * aspect;
  return { canvas: source, w, h };
}

const EMPTY: BakedSprite = { canvas: makeEmpty(), w: 1, h: 1 };

function makeEmpty(): HTMLCanvasElement | OffscreenCanvas {
  // Canvas の無い環境（テスト）でも import できるよう、遅延せず作るのは 1×1 だけ。
  try {
    return makeCanvas(1, 1);
  } catch {
    return {} as HTMLCanvasElement;
  }
}

function bake(name: SpriteName): BakedSprite | null {
  const generated = bakeFromSheet(GEN_TARGET[name]);
  if (generated) return generated;
  const painted = PAINTERS[name];
  if (painted) return bakePainted(painted);
  return bakeFromSheet(SHEET_TARGET[name]);
}

/** 名前でスプライトを引く。初回だけ焼いてキャッシュする（素材の読み込み前は空の 1×1 を返し、キャッシュしない）。 */
export function getSprite(name: SpriteName): BakedSprite {
  const cached = bakedCache.get(name);
  if (cached) return cached;
  const baked = bake(name);
  if (!baked) return EMPTY;
  bakedCache.set(name, baked);
  return baked;
}

/** 道の家具（f_woodPath / f_stonePath）。1 マスで縦横に継ぎ目なく連なる絵なので、座標に依らず同じものを返す。 */
export function getGroundFurnitureSprite(id: 'woodPath' | 'stonePath', _worldTx: number, _worldTy: number): BakedSprite {
  return getSprite(id === 'woodPath' ? 'f_woodPath' : 'f_stonePath');
}

export function spriteNames(): SpriteName[] {
  return Array.from(new Set([...Object.keys(GEN_TARGET), ...Object.keys(SHEET_TARGET), ...Object.keys(PAINTERS)])) as SpriteName[];
}

/** `<img>` などで使うための data URL（アイコン用に 3 倍の解像度で出す）。遅延生成・キャッシュ。 */
export function spriteDataUrl(name: SpriteName): string {
  const cached = dataUrlCache.get(name);
  if (cached) return cached;

  const baked = getSprite(name);
  const canvas = document.createElement('canvas');
  const k = 3;
  canvas.width = Math.max(1, Math.round(baked.w * k));
  canvas.height = Math.max(1, Math.round(baked.h * k));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked.canvas as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  }
  const url = canvas.toDataURL();
  dataUrlCache.set(name, url);
  return url;
}
