// スパイク: 「Pigg Island 風の質感」で実際に動いて触れるか確かめる試作フィールド。
//
// ゲーム本体（src/game）・Canvas 描画（src/render）には一切つながっていない。
// DOM（画像 <img> ＋ transform）だけで動かす別実装。テスト用メニューからだけ開ける。
//
// 操作の手ざわりは本編と同じにしたいので、浮くスティックの計算（本編 src/input/pointer.ts）
// だけをそのまま再利用する。カメラは「プレイヤーを画面中心に固定し、世界を逆に動かす」方式
// （Canvas を使わないのでこれが一番簡単で滑らか）。
//
// --- タイル方式（今回の改修） -------------------------------------------------
// 一度「5×5 マス程度のブロックが連なる世界」を試したが、ユーザーから
// 「ブロック分けは無視してよい、参考画像 1 枚を忠実に再現してほしい」との
// 指示で撤回した。地面は piggGround.ts の単一ジオメトリ（斜めの渚＋池ひとつ）に戻し、
// 物体（ヤシ・木・岩・家具・草花）だけは引き続き TILE=100 の格子の中心に、
// 1 タイル 1 個までで配置する（プレイヤーの移動自体は連続座標のまま、指示通り）。
// 物体の大きさ・プレイヤーの大きさは「だいたい 1 マス」に収まるよう縮小した
// （以前は木が 1.5〜2 マス分あり、「1 マスが 1 巨大オブジェクト」に見えてしまっていた）。

import { useEffect, useRef, useState } from 'react';

import { dragStickAnchor, isDrag, JOYSTICK_DRAG_RADIUS_PX, keyToDir, stickVector, vectorFromKeys } from '@/input/pointer';
import type { KeyDir } from '@/input/pointer';
import { getPond, groundKindAt, paintPiggGroundAsync, TILE } from '@/render/piggGround';
import type { GroundKind } from '@/render/piggGround';

import piggChest from '@/assets/pigg/pigg_chest.png?url';
import piggPlayerDown0 from '@/assets/pigg/pigg_player_down0.png?url';
import piggRock from '@/assets/pigg/pigg_rock.png?url';
import furnBenchLog from '@/assets/refimg/furn_bench_log.png?url';
import furnCrate from '@/assets/refimg/furn_crate.png?url';
import furnFlowerBed from '@/assets/refimg/furn_flower_bed.png?url';
import furnPalmTree from '@/assets/refimg/furn_palm_tree.png?url';
import furnSignpost from '@/assets/refimg/furn_signpost.png?url';
import furnTorch from '@/assets/refimg/furn_torch.png?url';
import oreCopper from '@/assets/refimg/ore_copper.png?url';
import plant01 from '@/assets/refimg/plant_01.png?url';
import plant05 from '@/assets/refimg/plant_05.png?url';
import plant12 from '@/assets/refimg/plant_12.png?url';
import plant18 from '@/assets/refimg/plant_18.png?url';
import plant22 from '@/assets/refimg/plant_22.png?url';
import plant29 from '@/assets/refimg/plant_29.png?url';
import plant33 from '@/assets/refimg/plant_33.png?url';
import plant40 from '@/assets/refimg/plant_40.png?url';
import plant45 from '@/assets/refimg/plant_45.png?url';
import plant47 from '@/assets/refimg/plant_47.png?url';
import plant51 from '@/assets/refimg/plant_51.png?url';
import plant53 from '@/assets/refimg/plant_53.png?url';
import plant55 from '@/assets/refimg/plant_55.png?url';
import plant56 from '@/assets/refimg/plant_56.png?url';
import rockFlatGround from '@/assets/refimg/rock_flat_ground.png?url';
import rockMossy from '@/assets/refimg/rock_mossy.png?url';
import rockPebble from '@/assets/refimg/rock_pebble.png?url';
import refRockMedium from '@/assets/refimg/rock_medium.png?url';
import refRockSmall from '@/assets/refimg/rock_small.png?url';
import treeMedium from '@/assets/refimg/tree_medium.png?url';
import treeSmall from '@/assets/refimg/tree_small.png?url';
import treeTopDown from '@/assets/refimg/tree_top_down.png?url';

// 世界の大きさ（世界 px）。TILE=100 なので 26×20 マスのタイル格子になる。
const WORLD_W = 2600;
const WORLD_H = 2000;
const SPEED = 260; // 世界 px / 秒。
const PLAYER_RADIUS = 16; // 当たり判定（1 マス=100px の半分よりだいぶ小さい、人 1 人ぶん）。
// カメラのズーム倍率は「画面の横幅いっぱいに TILE×ZOOM_TILES_ACROSS マスが入る」ことから
// 毎フレーム逆算する。数式自体は前回から変えていない（vw/(20*TILE) は寸法的に正しい）。
// ズレて見えていた原因は数式ではなく、物体が 1 マスに対して大きすぎたこと
// （下の baseWidth を「だいたい 1 マス」に収まる値へ縮小した）。
const ZOOM_TILES_ACROSS = 20;

// 主人公の立ち絵の表示サイズ（元画像は 465x557 の縦長）。「基本 1×1」の指示どおり、
// 1 マス（TILE=100）よりわずかに小さいくらいに縮める（人がマス目いっぱいだと窮屈なので）。
const PLAYER_W = Math.round(TILE * 0.68);
const PLAYER_H = Math.round(PLAYER_W * (557 / 465));

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** 0〜1 の乱数値から配列の要素を選ぶ（呼び出し側の配列は必ず 1 個以上ある前提）。 */
function pick<T>(arr: readonly T[], t: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] as T;
}

interface Obj {
  x: number;
  y: number;
  scale: number;
  solidRadius: number; // 0 なら当たらない（見た目だけ）
  sprite: string;
  baseWidth: number; // 表示基準幅（scale 倍する前の px）
}

// 陸（砂・草）に置いてよい物体の地面種別。水辺の池には立たせない。
const LAND_KINDS: readonly GroundKind[] = ['sand', 'grass'];
const WATER_KINDS: readonly GroundKind[] = ['water'];

// 岩は既存の Pigg 岩に加え、参考シートから切り出した岩・鉱石を混ぜて単調さを消す。
const ROCK_SPRITES = [piggRock, refRockMedium, refRockSmall, rockPebble, rockMossy, rockFlatGround, oreCopper];

// 木（参考シート由来）。斜め見下ろし視点なので、正面/横向きの木は中サイズ・小サイズだけを使い、
// 上から見た木（tree_top_down）はアクセントとして少数混ぜる。
const TREE_SPRITES = [treeMedium, treeMedium, treeSmall, treeTopDown];

// 草花はただの地面の飾り（当たり判定なし）。参考シートの色違いを多く混ぜて賑やかさを出す。
// plant_10/16/54/59 は市松模様の抜き残りがわずかに出るため、意図して外している。
const PLANT_SPRITES_LAND = [plant01, plant05, plant12, plant18, plant22, plant29, plant33, plant40];

// 池の岸を縁取る、丈の高い草・白黄の花クラスター。
const EDGE_FLORA_SPRITES = [plant18, plant29, plant33, plant40, plant55, plant56];

// 家具は完全な飾り（当たり判定なし）。ゲームロジックには一切繋がらない。
const FURNITURE_SPRITES: { sprite: string; baseWidth: number }[] = [
  { sprite: furnCrate, baseWidth: 32 },
  { sprite: furnBenchLog, baseWidth: 68 },
  { sprite: furnTorch, baseWidth: 22 },
  { sprite: furnSignpost, baseWidth: 26 },
  { sprite: furnFlowerBed, baseWidth: 40 },
];

// 「基本 1×1」の指示に合わせて、見た目のサイズをだいたい 1 マス（TILE=100）前後に縮小した。
// 以前は木 150・ヤシ 170・岩 70 で、拡大すると 1 マスの 1.5〜2 倍近くになり
// 「1 マス＝1 個の巨大な物体」に見えてしまっていた。
const PALM_BASE_W = 108;
const TREE_BASE_W = 104;
const ROCK_BASE_W = 52;
const PLANT_BASE_W = 34;

// ---------------------------------------------------------------------------
// タイル占有（本物のグリッド判定）。
//
// 「小さな草花 1 本まで、1 タイルにつき 1 個まで」というユーザーの明示指示があるので、
// 装飾も含め、置いた物体は必ず occupied に積む。密度は物体の重なりではなく
// 「520 マス中どれだけのマスを飾るか」で決まる。ブロック分けを撤回したので、
// 全 26×20 マスをまとめて 1 つのグリッドとして扱う（マス数が少ないので全走査で十分軽い）。

type TileKey = `${number},${number}`;
const GX_COUNT = Math.round(WORLD_W / TILE);
const GY_COUNT = Math.round(WORLD_H / TILE);

function tileKey(gx: number, gy: number): TileKey {
  return `${gx},${gy}`;
}
function tileCenter(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE };
}

/** モジュール直下の共有状態。テスト用フィールドを閉じて再度開く（再マウント）たびにリセットする。 */
const occupied = new Set<TileKey>();

/**
 * 指定した地面種別に合う空きタイルをランダムに探す（最大 40 回）。
 * 見つからなければ全グリッドを線形走査、それも無ければ地面種別を無視して探す
 * （＝最終段は必ず成功する梯子。グリッドが完全に埋まっている場合だけ null）。
 */
function pickFreeTileAnywhere(seed: number, kinds: readonly GroundKind[]): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const hx = hash(seed * 7.13 + attempt * 3.71 + 1);
    const hy = hash(seed * 5.37 + attempt * 2.19 + 2);
    const gx = Math.min(GX_COUNT - 1, Math.floor(hx * GX_COUNT));
    const gy = Math.min(GY_COUNT - 1, Math.floor(hy * GY_COUNT));
    if (occupied.has(tileKey(gx, gy))) continue;
    const c = tileCenter(gx, gy);
    if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
    occupied.add(tileKey(gx, gy));
    return c;
  }
  for (let gy = 0; gy < GY_COUNT; gy++) {
    for (let gx = 0; gx < GX_COUNT; gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      const c = tileCenter(gx, gy);
      if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
      occupied.add(tileKey(gx, gy));
      return c;
    }
  }
  for (let gy = 0; gy < GY_COUNT; gy++) {
    for (let gx = 0; gx < GX_COUNT; gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      occupied.add(tileKey(gx, gy));
      return tileCenter(gx, gy);
    }
  }
  return null;
}

/** 望ましい世界座標に一番近い空きタイルを探す（池の周りの手作業配置用）。探索範囲はタイル数で絞って軽くする。 */
function nearestFreeTile(desired: { x: number; y: number }, kinds: readonly GroundKind[], searchTiles = 8): { x: number; y: number } | null {
  const dgx = Math.floor(desired.x / TILE);
  const dgy = Math.floor(desired.y / TILE);
  let best: { gx: number; gy: number; d: number } | null = null;
  for (let gy = Math.max(0, dgy - searchTiles); gy < Math.min(GY_COUNT, dgy + searchTiles); gy++) {
    for (let gx = Math.max(0, dgx - searchTiles); gx < Math.min(GX_COUNT, dgx + searchTiles); gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      const c = tileCenter(gx, gy);
      if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
      const d = (c.x - desired.x) ** 2 + (c.y - desired.y) ** 2;
      if (!best || d < best.d) best = { gx, gy, d };
    }
  }
  if (!best) return pickFreeTileAnywhere(desired.x * 13 + desired.y * 7, kinds);
  occupied.add(tileKey(best.gx, best.gy));
  return tileCenter(best.gx, best.gy);
}

// ---------------------------------------------------------------------------
// ジャングル池コーナー: 参考画像（アメーバピグの池コーナー）を意識した手配置。
// 木立の壁・岸辺の草花・睡蓮・ハス・浮き丸太・看板を、池（piggGround.ts の getPond）の
// 周りに置く。

function pondPointFor(pond: { cx: number; cy: number; rx: number; ry: number }, angleDeg: number, rxMul: number, ryMul: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: pond.cx + pond.rx * rxMul * Math.cos(rad), y: pond.cy + pond.ry * ryMul * Math.sin(rad) };
}

interface Bucket {
  palms: Obj[];
  rocks: Obj[];
  trees: Obj[];
  plants: Obj[];
  waterPlants: Obj[];
  furniture: Obj[];
  chest: { x: number; y: number };
}

function buildJunglePond(out: Bucket): void {
  const pond = getPond(WORLD_W, WORLD_H);
  // 木立の壁（池の左奥、角度 150°→320°）。solidRadius を持つので当たり判定に使われる。
  const treelineCount = 12;
  for (let i = 0; i < treelineCount; i++) {
    const t = treelineCount > 1 ? i / (treelineCount - 1) : 0;
    const angle = 150 + t * 170;
    const desired = pondPointFor(pond, angle, 1.2, 1.25);
    const c = nearestFreeTile(desired, LAND_KINDS, 6);
    if (!c) continue;
    out.palms.push({ x: c.x, y: c.y, scale: 0.95 + hash(i * 5 + 813) * 0.25, solidRadius: 20, sprite: furnPalmTree, baseWidth: PALM_BASE_W });
  }
  // 岸の縁取り（丈の高い草・白黄の花クラスター）。角度 -80°→150°＝手前〜右側。
  const edgeCount = 10;
  for (let i = 0; i < edgeCount; i++) {
    const angle = -80 + (i / (edgeCount - 1)) * 230;
    const desired = pondPointFor(pond, angle, 1.0, 1.0);
    const c = nearestFreeTile(desired, LAND_KINDS, 6);
    if (!c) continue;
    out.plants.push({ x: c.x, y: c.y, scale: 0.7 + hash(i * 9 + 953) * 0.4, solidRadius: 0, sprite: pick(EDGE_FLORA_SPRITES, hash(i * 11 + 954)), baseWidth: PLANT_BASE_W });
  }
  // 池のアクセント: 睡蓮（緑の葉）を多め、ハス（ピンク、主役）を少数。
  const lilyCount = 9;
  for (let i = 0; i < lilyCount; i++) {
    const angle = hash(i * 7 + 900) * 360;
    const rMul = 0.15 + hash(i * 11 + 901) * 0.72;
    const desired = pondPointFor(pond, angle, rMul, rMul);
    const c = nearestFreeTile(desired, WATER_KINDS, 6);
    if (!c) continue;
    out.waterPlants.push({ x: c.x, y: c.y, scale: 0.65 + hash(i * 9 + 902) * 0.4, solidRadius: 0, sprite: pick([plant47, plant51, plant53], hash(i * 13 + 903)), baseWidth: 40 });
  }
  const lotusCount = 2;
  for (let i = 0; i < lotusCount; i++) {
    const angle = 40 + i * 140 + (hash(i * 3 + 910) - 0.5) * 24;
    const rMul = 0.3 + hash(i * 5 + 911) * 0.3;
    const desired = pondPointFor(pond, angle, rMul, rMul);
    const c = nearestFreeTile(desired, WATER_KINDS, 6);
    if (!c) continue;
    out.waterPlants.push({ x: c.x, y: c.y, scale: 0.85 + hash(i * 7 + 912) * 0.25, solidRadius: 0, sprite: plant45, baseWidth: 58 });
  }
  // ランドマーク: 水際の浮き丸太、岸の道しるべ（各 1 個）。
  const log = pondPointFor(pond, 220, 1.0, 1.05);
  const logC = nearestFreeTile(log, LAND_KINDS, 6);
  if (logC) out.furniture.push({ x: logC.x, y: logC.y, scale: 1.0, solidRadius: 0, sprite: furnBenchLog, baseWidth: 68 });
  const sign = pondPointFor(pond, -20, 1.5, 1.5);
  const signC = nearestFreeTile(sign, LAND_KINDS, 6);
  if (signC) out.furniture.push({ x: signC.x, y: signC.y, scale: 1.0, solidRadius: 0, sprite: furnSignpost, baseWidth: 26 });
  // 岩を数個、余った陸タイルに。
  for (let i = 0; i < 3; i++) {
    const desired = pondPointFor(pond, i * 90 + 30, 1.3, 1.3);
    const c = nearestFreeTile(desired, LAND_KINDS, 6);
    if (!c) continue;
    out.rocks.push({ x: c.x, y: c.y, scale: 0.5 + hash(i * 3 + 4005) * 0.4, solidRadius: 16, sprite: pick(ROCK_SPRITES, hash(i * 3 + 4006)), baseWidth: ROCK_BASE_W });
  }
}

// ---------------------------------------------------------------------------
// 残りの土地は、地面種別ごとの単一の密度でまばらに埋める（ブロックごとのテーマ分けは撤回）。
// 参考画像は「開けた草地に木・岩・花がほどよく散っている」程度の密度なので、
// 全体を埋め尽くさず、空いた地面がちゃんと見えるくらいに抑える。

const GRASS_TILE_COUNT_APPROX = GX_COUNT * GY_COUNT * 0.55; // だいたいの草タイル数（密度計算の目安）

function buildScatter(out: Bucket): void {
  const treeCount = Math.round(GRASS_TILE_COUNT_APPROX * 0.07);
  for (let i = 0; i < treeCount; i++) {
    const c = pickFreeTileAnywhere(i * 17 + 300, LAND_KINDS);
    if (!c) continue;
    out.trees.push({ x: c.x, y: c.y, scale: 0.85 + hash(i * 5 + 205) * 0.3, solidRadius: 18, sprite: pick(TREE_SPRITES, hash(i * 5 + 207)), baseWidth: TREE_BASE_W });
  }
  const palmCount = Math.round(GRASS_TILE_COUNT_APPROX * 0.02);
  for (let i = 0; i < palmCount; i++) {
    const c = pickFreeTileAnywhere(i * 11 + 900, LAND_KINDS);
    if (!c) continue;
    out.palms.push({ x: c.x, y: c.y, scale: 0.85 + hash(i * 2 + 5) * 0.3, solidRadius: 18, sprite: furnPalmTree, baseWidth: PALM_BASE_W });
  }
  const rockCount = Math.round(GRASS_TILE_COUNT_APPROX * 0.06);
  for (let i = 0; i < rockCount; i++) {
    const c = pickFreeTileAnywhere(i * 13 + 500, LAND_KINDS);
    if (!c) continue;
    out.rocks.push({ x: c.x, y: c.y, scale: 0.55 + hash(i * 3 + 105) * 0.4, solidRadius: 14, sprite: pick(ROCK_SPRITES, hash(i * 3 + 102)), baseWidth: ROCK_BASE_W });
  }
  const plantCount = Math.round(GRASS_TILE_COUNT_APPROX * 0.18);
  for (let i = 0; i < plantCount; i++) {
    const c = pickFreeTileAnywhere(i * 19 + 700, LAND_KINDS);
    if (!c) continue;
    out.plants.push({ x: c.x, y: c.y, scale: 0.6 + hash(i * 7 + 305) * 0.45, solidRadius: 0, sprite: pick(PLANT_SPRITES_LAND, hash(i * 7 + 309)), baseWidth: PLANT_BASE_W });
  }
  const furnitureCount = Math.round(GRASS_TILE_COUNT_APPROX * 0.015);
  for (let i = 0; i < furnitureCount; i++) {
    const c = pickFreeTileAnywhere(i * 29 + 900, LAND_KINDS);
    if (!c) continue;
    const f = FURNITURE_SPRITES[i % FURNITURE_SPRITES.length]!;
    out.furniture.push({ x: c.x, y: c.y, scale: 0.85 + hash(i * 11 + 505) * 0.25, solidRadius: 0, sprite: f.sprite, baseWidth: f.baseWidth });
  }
}

/** 世界全体を組み立てる。マウントのたびに occupied をリセットしてから、池コーナー→残りの順で埋める。 */
function buildWorld(): Bucket {
  occupied.clear();
  const out: Bucket = { palms: [], rocks: [], trees: [], plants: [], waterPlants: [], furniture: [], chest: { x: 0, y: 0 } };
  buildJunglePond(out); // 空きタイルが一番豊富なうちに、細かい手配置を先に確定させる。
  buildScatter(out);
  // 宝箱もタイル占有システムに乗せる（他の物体と同じ 1 タイル 1 個のルールを守るため）。
  const chestPos = nearestFreeTile({ x: WORLD_W * 0.55, y: WORLD_H * 0.35 }, LAND_KINDS, 10);
  out.chest = chestPos ?? tileCenter(Math.floor(GX_COUNT / 2), Math.floor(GY_COUNT / 2));
  return out;
}

export function PiggTestField({ onClose }: { onClose: () => void }) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRefData = useRef<Bucket | null>(null);
  if (!worldRefData.current) worldRefData.current = buildWorld();
  const builtWorld = worldRefData.current;
  const palmsRef = useRef<Obj[]>(builtWorld.palms);
  const rocksRef = useRef<Obj[]>(builtWorld.rocks);
  const treesRef = useRef<Obj[]>(builtWorld.trees);
  const plantsRef = useRef<Obj[]>(builtWorld.plants);
  const waterPlantsRef = useRef<Obj[]>(builtWorld.waterPlants);
  const furnitureRef = useRef<Obj[]>(builtWorld.furniture);
  const chestRef = useRef<{ x: number; y: number }>(builtWorld.chest);
  const [groundReady, setGroundReady] = useState(false);

  useEffect(() => {
    const canvas = groundCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    paintPiggGroundAsync(canvas).then(() => {
      if (!cancelled) setGroundReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const world = worldRef.current;
    const player = playerRef.current;
    const stick = stickRef.current;
    if (!root || !world || !player || !stick) return;

    // 池コーナーが見えやすい位置（池の少し南）から始める。
    const pond = getPond(WORLD_W, WORLD_H);
    const pos = { x: pond.cx + pond.rx * 0.3, y: pond.cy + pond.ry * 2.2 };
    let moveVec = { x: 0, y: 0 };
    let moving = false;

    // --- 浮くスティック（本編と同じ計算式） ---
    let dragId: number | null = null;
    let anchor = { x: 0, y: 0 };
    let dragStart = { x: 0, y: 0 };
    let dragStartAt = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (dragId !== null) return;
      dragId = e.pointerId;
      root.setPointerCapture(e.pointerId);
      anchor = { x: e.clientX, y: e.clientY };
      dragStart = { x: e.clientX, y: e.clientY };
      dragStartAt = performance.now();
      stick.style.display = 'block';
      stick.style.left = `${anchor.x}px`;
      stick.style.top = `${anchor.y}px`;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      const finger = { x: e.clientX, y: e.clientY };
      anchor = dragStickAnchor(anchor, finger);
      const v = stickVector(anchor, finger);
      moveVec = v;
      stick.style.left = `${anchor.x}px`;
      stick.style.top = `${anchor.y}px`;
      const knob = stick.firstElementChild as HTMLDivElement;
      const dx = Math.max(-JOYSTICK_DRAG_RADIUS_PX, Math.min(JOYSTICK_DRAG_RADIUS_PX, finger.x - anchor.x));
      const dy = Math.max(-JOYSTICK_DRAG_RADIUS_PX, Math.min(JOYSTICK_DRAG_RADIUS_PX, finger.y - anchor.y));
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const endDrag = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      dragId = null;
      moveVec = { x: 0, y: 0 };
      stick.style.display = 'none';
      void isDrag; // 本編はタップ動作もここで判定するが、このスパイクは移動だけなので未使用
      void dragStart;
      void dragStartAt;
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.style.touchAction = 'none';

    // --- キーボード（PC 確認用） ---
    const keyDirs = new Set<KeyDir>();
    const onKeyDown = (e: KeyboardEvent) => {
      const d = keyToDir(e.key);
      if (d) keyDirs.add(d);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const d = keyToDir(e.key);
      if (d) keyDirs.delete(d);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // --- 当たり判定（主人公を円として、木の幹・岩と単純な円 vs 円） ---
    const solids = [...palmsRef.current, ...rocksRef.current, ...treesRef.current].filter((o) => o.solidRadius > 0);
    const tryMove = (nx: number, ny: number) => {
      for (const s of solids) {
        const dx = nx - s.x;
        const dy = ny - s.y;
        const min = PLAYER_RADIUS + s.solidRadius;
        if (dx * dx + dy * dy < min * min) return false;
      }
      return true;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;

      const kv = vectorFromKeys(keyDirs);
      const vx = moveVec.x !== 0 || moveVec.y !== 0 ? moveVec.x : kv.x;
      const vy = moveVec.x !== 0 || moveVec.y !== 0 ? moveVec.y : kv.y;
      moving = vx !== 0 || vy !== 0;

      if (moving) {
        const nx = Math.max(20, Math.min(WORLD_W - 20, pos.x + vx * SPEED * dt));
        const ny = Math.max(20, Math.min(WORLD_H - 20, pos.y + vy * SPEED * dt));
        if (tryMove(nx, pos.y)) pos.x = nx;
        if (tryMove(pos.x, ny)) pos.y = ny;
      }

      const vw = root.clientWidth;
      const vh = root.clientHeight;
      const zoom = vw / (ZOOM_TILES_ACROSS * TILE);
      const focusX =
        WORLD_W * zoom <= vw ? WORLD_W / 2 : Math.max(vw / (2 * zoom), Math.min(WORLD_W - vw / (2 * zoom), pos.x));
      const focusY =
        WORLD_H * zoom <= vh ? WORLD_H / 2 : Math.max(vh / (2 * zoom), Math.min(WORLD_H - vh / (2 * zoom), pos.y));
      world.style.transform = `translate(${vw / 2 - focusX * zoom}px, ${vh / 2 - focusY * zoom}px) scale(${zoom})`;
      const bounce = moving ? Math.abs(Math.sin(t / 90)) * 4 : 0;
      player.style.left = `${pos.x}px`;
      player.style.top = `${pos.y}px`;
      player.style.transform = `translate(-50%, -94%) translateY(${-bounce}px)`;
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', endDrag);
      root.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="pigg-field" ref={rootRef}>
      <div className="pigg-world" ref={worldRef} style={{ width: WORLD_W, height: WORLD_H }}>
        {/* 地面は piggGround.ts が焼いた 1 枚の Canvas（砂・草・水をなめらかにブレンド）。 */}
        <canvas ref={groundCanvasRef} className="pigg-field-ground" width={WORLD_W} height={WORLD_H} />
        {waterPlantsRef.current.map((p, i) => (
          <img key={`waterplant-${i}`} src={p.sprite} className="pigg-obj pigg-obj-flat" style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }} alt="" />
        ))}
        {plantsRef.current.map((p, i) => (
          <img key={`plant-${i}`} src={p.sprite} className="pigg-obj pigg-obj-flat" style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }} alt="" />
        ))}
        {furnitureRef.current.map((f, i) => (
          <img key={`furn-${i}`} src={f.sprite} className="pigg-obj" style={{ left: f.x, top: f.y, width: `${f.scale * f.baseWidth}px` }} alt="" />
        ))}
        {rocksRef.current.map((r, i) => (
          <img key={`rock-${i}`} src={r.sprite} className="pigg-obj" style={{ left: r.x, top: r.y, width: `${r.scale * r.baseWidth}px` }} alt="" />
        ))}
        <img src={piggChest} className="pigg-obj" style={{ left: chestRef.current.x, top: chestRef.current.y, width: `${TILE * 0.7}px` }} alt="" />
        {treesRef.current.map((tr, i) => (
          <img key={`tree-${i}`} src={tr.sprite} className="pigg-obj" style={{ left: tr.x, top: tr.y, width: `${tr.scale * tr.baseWidth}px` }} alt="" />
        ))}
        {palmsRef.current.map((p, i) => (
          <img key={`palm-${i}`} src={p.sprite} className="pigg-obj" style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }} alt="" />
        ))}
        {/* 主人公。他の物体と同じ .pigg-world 直下の絶対配置にし、常に最後に描画することで
            重なり順を保証する（ズーム込みのカメラ transform は親の world 側で一括適用）。 */}
        <div className="pigg-player" ref={playerRef} style={{ width: PLAYER_W, height: PLAYER_H }}>
          <img src={piggPlayerDown0} className="pigg-player-sprite" alt="" />
        </div>
      </div>

      <div className="pigg-joystick" ref={stickRef} style={{ display: 'none' }}>
        <div className="pigg-joystick-knob" />
      </div>

      <div className="pigg-field-badge">
        絵柄テスト（試作・スパイク）
        <span>ドラッグ / 矢印キーで動けます。歩きコマは正面立ち絵1枚のみ。ゲーム本体とは無関係</span>
      </div>
      <button className="pigg-field-close" onClick={onClose}>
        もどる
      </button>

      {!groundReady && (
        <div className="pigg-loading">
          <span>島を準備中…</span>
        </div>
      )}
    </div>
  );
}
