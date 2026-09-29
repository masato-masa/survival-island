// スパイク: 「Pigg Island 風の質感」で実際に動いて触れるか確かめる試作フィールド。
//
// ゲーム本体（src/game）・Canvas 描画（src/render）には一切つながっていない。
// DOM（画像 <img> ＋ transform）だけで動かす別実装。テスト用メニューからだけ開ける。
//
// 操作の手ざわりは本編と同じにしたいので、浮くスティックの計算（本編 src/input/pointer.ts）
// だけをそのまま再利用する。カメラは「プレイヤーを画面中心に固定し、世界を逆に動かす」方式
// （Canvas を使わないのでこれが一番簡単で滑らか）。
//
// 主人公の絵は ChatGPT 生成の正面立ち絵が 1 枚だけ用意できた（歩きコマはまだ無い）。
// 岩・木・草花は refs/image0〜3.png（ユーザー提供の参考シート）から切り出した新素材
// （scripts/slice-refimg.mjs → src/assets/refimg/）を使い、既存の Pigg 試作素材
// （ヤシ・岩・砂）と並べて質感・スケール感が合うか確かめる。
//
// --- タイル・ブロック方式（今回の改修） -------------------------------------
// ユーザー指示で「世界は 5×5 マス程度の『ブロック』が連なってできている」
// 「物体はタイルに揃える（プレイヤーの移動自体は連続座標のまま）」に変更した。
// 静物（ヤシ・木・岩・家具・草花）は必ず TILE=100 の格子の中心に立ち、
// 1 タイルにつき 1 個まで（Set<string> による本物のグリッド占有判定）。
// ブロックごとの地面種別・飾りテーマは piggGround.ts の getBlocks() が持つ
// BlockInfo を単一の情報源として使う（地面の塗り絵と物体配置が食い違わないように）。
// プレイヤーの物理・当たり判定・ジョイスティック計算はいっさい変えていない。

import { useEffect, useRef, useState } from 'react';

import { dragStickAnchor, isDrag, JOYSTICK_DRAG_RADIUS_PX, keyToDir, stickVector, vectorFromKeys } from '@/input/pointer';
import type { KeyDir } from '@/input/pointer';
import { getBlocks, groundKindAt, paintPiggGroundAsync, TILE } from '@/render/piggGround';
import type { BlockInfo, GroundKind } from '@/render/piggGround';

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

// 世界の大きさ（世界 px）。TILE=100 なので 26×20 マスのタイル格子になる
// （ちょうど 5 列 × 4 行のブロック分割と割り切れる大きさ。piggGround.ts の BLOCK_COLS/ROWS 参照）。
const WORLD_W = 2600;
const WORLD_H = 2000;
const SPEED = 260; // 世界 px / 秒（本編の 6 マス/秒 ×TILE 相当のスケール感に合わせた値）。
// ズームしても移動の速さ自体（世界座標上の速度）は変えない。画面上で動く距離が
// 相対的に小さくなるのはズームアウトした結果として正しい挙動。
const PLAYER_RADIUS = 22; // 当たり判定（見た目の主人公絵とだいたい合わせた半径）
// カメラのズーム倍率は固定値ではなく、「画面の横幅いっぱいに TILE×ZOOM_TILES_ACROSS マスが
// 入る」ことから毎フレーム逆算する（lead 指示）。ウィンドウ幅が変わっても画角の見え方
// （何マス見えるか）が一定になる。
const ZOOM_TILES_ACROSS = 20;

// 主人公の立ち絵の表示サイズ（元画像は 465x557 の縦長）。
const PLAYER_W = 56;
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

// 新しい木（参考シート由来）。斜め見下ろし視点のゲームなので、正面/横向きの木は
// 中サイズ・小サイズだけを使い、上から見た木（tree_top_down）はアクセントとして少数混ぜる。
const TREE_SPRITES = [treeMedium, treeMedium, treeSmall, treeTopDown];

// 草花はただの地面の飾り（当たり判定なし）。参考シートの色違いを多く混ぜて賑やかさを出す。
// plant_10/16/54/59 は市松模様の抜き残りがわずかに出るため、意図して外している。
const PLANT_SPRITES_LAND = [plant01, plant05, plant12, plant18, plant22, plant29, plant33, plant40];

// 池の岸を縁取る、丈の高い草・白黄の花クラスター。
const EDGE_FLORA_SPRITES = [plant18, plant29, plant33, plant40, plant55, plant56];

// 家具は完全な飾り（当たり判定なし）。ゲームロジックには一切繋がらない。
const FURNITURE_SPRITES: { sprite: string; baseWidth: number }[] = [
  { sprite: furnCrate, baseWidth: 46 },
  { sprite: furnBenchLog, baseWidth: 64 },
  { sprite: furnTorch, baseWidth: 30 },
  { sprite: furnSignpost, baseWidth: 34 },
  { sprite: furnFlowerBed, baseWidth: 52 },
];

// ---------------------------------------------------------------------------
// タイル占有（本物のグリッド判定。以前の「円で重なりを避けつつ最大 16 回振り直す」方式を廃止）。
//
// 「小さな草花 1 本まで、1 タイルにつき 1 個まで」というユーザーの明示指示があるので、
// 装飾も含め、置いた物体は必ず occupied に積む。密度は物体の重なりではなく
// 「520 マス中どれだけのマスを飾るか」で決まる。

type TileKey = `${number},${number}`;
function tileKey(gx: number, gy: number): TileKey {
  return `${gx},${gy}`;
}
function tileCenter(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE };
}

/** モジュール直下の共有状態。テスト用フィールドを閉じて再度開く（再マウント）たびにリセットする。 */
const occupied = new Set<TileKey>();

/**
 * ブロック範囲内で、指定した地面種別に合う空きタイルをランダムに探す（最大 24 回試す）。
 * 見つからなければ、ブロック内を線形走査して条件に合う空きタイルを探し、
 * それも無ければ地面種別を無視して空きタイルを探す（＝最終段は必ず成功する梯子。
 * ブロックが完全に埋まっている場合だけ null を返し、呼び出し側はその 1 個をあきらめる）。
 */
function pickFreeTileInBlock(seed: number, block: BlockInfo, kinds: readonly GroundKind[]): { x: number; y: number } | null {
  const w = block.gx1 - block.gx0;
  const h = block.gy1 - block.gy0;
  for (let attempt = 0; attempt < 24; attempt++) {
    const hx = hash(seed * 7.13 + attempt * 3.71 + 1);
    const hy = hash(seed * 5.37 + attempt * 2.19 + 2);
    const gx = block.gx0 + Math.min(w - 1, Math.floor(hx * w));
    const gy = block.gy0 + Math.min(h - 1, Math.floor(hy * h));
    if (occupied.has(tileKey(gx, gy))) continue;
    const c = tileCenter(gx, gy);
    if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
    occupied.add(tileKey(gx, gy));
    return c;
  }
  // 梯子 2 段目: 地面種別に合う空きタイルを線形走査。
  for (let gy = block.gy0; gy < block.gy1; gy++) {
    for (let gx = block.gx0; gx < block.gx1; gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      const c = tileCenter(gx, gy);
      if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
      occupied.add(tileKey(gx, gy));
      return c;
    }
  }
  // 梯子 3 段目（最終段）: 地面種別を無視して、とにかく空いているタイルを使う。
  for (let gy = block.gy0; gy < block.gy1; gy++) {
    for (let gx = block.gx0; gx < block.gx1; gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      occupied.add(tileKey(gx, gy));
      return tileCenter(gx, gy);
    }
  }
  return null; // ブロックが完全に埋まっている（想定densityでは起きない）
}

/** 望ましい世界座標に一番近い、ブロック内の空きタイルを探す（池の周りの手作業配置用）。 */
function nearestFreeTileInBlock(desired: { x: number; y: number }, block: BlockInfo, kinds: readonly GroundKind[]): { x: number; y: number } | null {
  let best: { gx: number; gy: number; d: number } | null = null;
  for (let gy = block.gy0; gy < block.gy1; gy++) {
    for (let gx = block.gx0; gx < block.gx1; gx++) {
      if (occupied.has(tileKey(gx, gy))) continue;
      const c = tileCenter(gx, gy);
      if (!kinds.includes(groundKindAt(c.x, c.y, WORLD_W, WORLD_H))) continue;
      const d = (c.x - desired.x) ** 2 + (c.y - desired.y) ** 2;
      if (!best || d < best.d) best = { gx, gy, d };
    }
  }
  if (!best) {
    // 梯子: 地面種別を無視して一番近い空きタイル。
    for (let gy = block.gy0; gy < block.gy1; gy++) {
      for (let gx = block.gx0; gx < block.gx1; gx++) {
        if (occupied.has(tileKey(gx, gy))) continue;
        const c = tileCenter(gx, gy);
        const d = (c.x - desired.x) ** 2 + (c.y - desired.y) ** 2;
        if (!best || d < best.d) best = { gx, gy, d };
      }
    }
  }
  if (!best) return null;
  occupied.add(tileKey(best.gx, best.gy));
  return tileCenter(best.gx, best.gy);
}

// ---------------------------------------------------------------------------
// ジャングル池ブロック: 池の楕円（block.pond、piggGround.ts が世界配置ずみ）の周りに
// 木立の壁・岸辺の草花・睡蓮・ハス・ランドマークを手配置する。以前は世界全体に対する
// 角度指定だったが、今は「そのブロックの pond」だけを見ればよい。
// タイル数がブロック 1 個ぶん（このレイアウトでは 6×5=30 マス）しか無いので、
// 元の密度（睡蓮 16 本など）をそのまま持ち込むと入り切らない。1 タイル 1 個の制約に
// 合わせて個数を間引いた。

function pondPointFor(block: BlockInfo, angleDeg: number, rxMul: number, ryMul: number): { x: number; y: number } {
  const pond = block.pond!;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: pond.cx + pond.rx * rxMul * Math.cos(rad),
    y: pond.cy + pond.ry * ryMul * Math.sin(rad),
  };
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

function buildJunglePondBlock(block: BlockInfo, out: Bucket): void {
  // 木立の壁（池の左奥、角度 155°→305°）。solidRadius を持つので当たり判定に使われる。
  const treelineCount = 9;
  for (let i = 0; i < treelineCount; i++) {
    const t = treelineCount > 1 ? i / (treelineCount - 1) : 0;
    const angle = 155 + t * 150;
    const desired = pondPointFor(block, angle, 1.15, 1.2);
    const c = nearestFreeTileInBlock(desired, block, LAND_KINDS);
    if (!c) continue;
    out.palms.push({
      x: c.x,
      y: c.y,
      scale: 1.0 + hash(i * 5 + 813) * 0.3,
      solidRadius: 26,
      sprite: furnPalmTree,
      baseWidth: 150,
    });
  }
  // 岸の縁取り（丈の高い草・白黄の花クラスター）。角度 -70°→150°＝手前〜右側。
  const edgeCount = 7;
  for (let i = 0; i < edgeCount; i++) {
    const angle = -70 + (i / (edgeCount - 1)) * 220;
    const desired = pondPointFor(block, angle, 1.0, 1.0);
    const c = nearestFreeTileInBlock(desired, block, LAND_KINDS);
    if (!c) continue;
    out.plants.push({
      x: c.x,
      y: c.y,
      scale: 0.7 + hash(i * 9 + 953) * 0.5,
      solidRadius: 0,
      sprite: pick(EDGE_FLORA_SPRITES, hash(i * 11 + 954)),
      baseWidth: 52,
    });
  }
  // 池のアクセント: 睡蓮（緑の葉）を多め、ハス（ピンク、主役）を少数。
  const lilyCount = 7;
  for (let i = 0; i < lilyCount; i++) {
    const angle = hash(i * 7 + 900) * 360;
    const rMul = 0.15 + hash(i * 11 + 901) * 0.7;
    const desired = pondPointFor(block, angle, rMul, rMul);
    const c = nearestFreeTileInBlock(desired, block, WATER_KINDS);
    if (!c) continue;
    out.waterPlants.push({
      x: c.x,
      y: c.y,
      scale: 0.7 + hash(i * 9 + 902) * 0.5,
      solidRadius: 0,
      sprite: pick([plant47, plant51, plant53], hash(i * 13 + 903)),
      baseWidth: 56,
    });
  }
  const lotusCount = 2;
  for (let i = 0; i < lotusCount; i++) {
    const angle = 40 + i * 140 + (hash(i * 3 + 910) - 0.5) * 24;
    const rMul = 0.3 + hash(i * 5 + 911) * 0.3;
    const desired = pondPointFor(block, angle, rMul, rMul);
    const c = nearestFreeTileInBlock(desired, block, WATER_KINDS);
    if (!c) continue;
    out.waterPlants.push({ x: c.x, y: c.y, scale: 0.9 + hash(i * 7 + 912) * 0.3, solidRadius: 0, sprite: plant45, baseWidth: 82 });
  }
  // ランドマーク: 水際の浮き丸太、岸の道しるべ（各 1 個）。
  const log = pondPointFor(block, 215, 1.0, 1.02);
  const logC = nearestFreeTileInBlock(log, block, LAND_KINDS);
  if (logC) out.furniture.push({ x: logC.x, y: logC.y, scale: 1.1, solidRadius: 0, sprite: furnBenchLog, baseWidth: 100 });
  const sign = pondPointFor(block, -15, 1.4, 1.4);
  const signC = nearestFreeTileInBlock(sign, block, LAND_KINDS);
  if (signC) out.furniture.push({ x: signC.x, y: signC.y, scale: 1.0, solidRadius: 0, sprite: furnSignpost, baseWidth: 52 });
  // 岩を 2 個だけ、余った陸タイルに。
  for (let i = 0; i < 2; i++) {
    const c = pickFreeTileInBlock(block.bi * 97 + block.bj * 131 + i * 17 + 4000, block, LAND_KINDS);
    if (!c) continue;
    out.rocks.push({ x: c.x, y: c.y, scale: 0.5 + hash(i * 3 + 4005) * 0.5, solidRadius: 20, sprite: pick(ROCK_SPRITES, hash(i * 3 + 4006)), baseWidth: 70 });
  }
}

// ---------------------------------------------------------------------------
// 通常ブロック（beach / meadow / grove）は「テーマごとの密度」でタイルを埋める。
// 密度は合計 1.0 を超えないようにしてあり（空きタイルも残る＝過密にしない）、
// grove だけ木を濃くして「密な木立」のバリエーションを出す。

interface ThemeConfig {
  palmDensity: number;
  treeDensity: number;
  rockDensity: number;
  plantDensity: number;
  furnitureDensity: number;
}

const THEME_CONFIG: Record<'beach' | 'meadow' | 'grove', ThemeConfig> = {
  beach: { palmDensity: 0.06, treeDensity: 0, rockDensity: 0.2, plantDensity: 0.1, furnitureDensity: 0.04 },
  meadow: { palmDensity: 0.02, treeDensity: 0.08, rockDensity: 0.06, plantDensity: 0.35, furnitureDensity: 0.04 },
  grove: { palmDensity: 0.02, treeDensity: 0.35, rockDensity: 0.1, plantDensity: 0.15, furnitureDensity: 0.01 },
};

function buildGenericBlock(block: BlockInfo, out: Bucket): void {
  const cfg = THEME_CONFIG[block.theme as 'beach' | 'meadow' | 'grove'];
  const tileCount = (block.gx1 - block.gx0) * (block.gy1 - block.gy0);
  const seedBase = block.bi * 1301 + block.bj * 6151;

  const palmCount = Math.round(tileCount * cfg.palmDensity);
  for (let i = 0; i < palmCount; i++) {
    const c = pickFreeTileInBlock(seedBase + i * 11 + 100, block, LAND_KINDS);
    if (!c) continue;
    out.palms.push({ x: c.x, y: c.y, scale: 0.75 + hash(seedBase + i * 2 + 5) * 0.55, solidRadius: 26, sprite: furnPalmTree, baseWidth: 150 });
  }

  const treeCount = Math.round(tileCount * cfg.treeDensity);
  for (let i = 0; i < treeCount; i++) {
    const c = pickFreeTileInBlock(seedBase + i * 17 + 300, block, LAND_KINDS);
    if (!c) continue;
    out.trees.push({
      x: c.x,
      y: c.y,
      scale: 0.75 + hash(seedBase + i * 5 + 205) * 0.45,
      solidRadius: 24,
      sprite: pick(TREE_SPRITES, hash(seedBase + i * 5 + 207)),
      baseWidth: 150,
    });
  }

  const rockCount = Math.round(tileCount * cfg.rockDensity);
  for (let i = 0; i < rockCount; i++) {
    const c = pickFreeTileInBlock(seedBase + i * 13 + 500, block, LAND_KINDS);
    if (!c) continue;
    out.rocks.push({
      x: c.x,
      y: c.y,
      scale: 0.5 + hash(seedBase + i * 3 + 105) * 0.6,
      solidRadius: 20,
      sprite: pick(ROCK_SPRITES, hash(seedBase + i * 3 + 102)),
      baseWidth: 70,
    });
  }

  const plantCount = Math.round(tileCount * cfg.plantDensity);
  for (let i = 0; i < plantCount; i++) {
    const c = pickFreeTileInBlock(seedBase + i * 19 + 700, block, LAND_KINDS);
    if (!c) continue;
    out.plants.push({
      x: c.x,
      y: c.y,
      scale: 0.55 + hash(seedBase + i * 7 + 305) * 0.55,
      solidRadius: 0,
      sprite: pick(PLANT_SPRITES_LAND, hash(seedBase + i * 7 + 309)),
      baseWidth: 46,
    });
  }

  const furnitureCount = Math.round(tileCount * cfg.furnitureDensity);
  for (let i = 0; i < furnitureCount; i++) {
    const c = pickFreeTileInBlock(seedBase + i * 29 + 900, block, LAND_KINDS);
    if (!c) continue;
    const f = FURNITURE_SPRITES[(seedBase + i) % FURNITURE_SPRITES.length]!;
    out.furniture.push({ x: c.x, y: c.y, scale: 0.8 + hash(seedBase + i * 11 + 505) * 0.3, solidRadius: 0, sprite: f.sprite, baseWidth: f.baseWidth });
  }
}

/** 世界全体を組み立てる。マウントのたびに occupied をリセットしてから、全ブロックを順に埋める。 */
function buildWorld(): Bucket {
  occupied.clear();
  const out: Bucket = { palms: [], rocks: [], trees: [], plants: [], waterPlants: [], furniture: [], chest: { x: 0, y: 0 } };
  const blocks = getBlocks(WORLD_W, WORLD_H);
  // jungle_pond を先に確定させる（池の周りは手作業配置の要求が細かいため、空きタイルが
  // 一番豊富なうちに埋めたい）。そのあと残りのブロックを埋める。
  for (const block of blocks) {
    if (block.theme === 'jungle_pond') buildJunglePondBlock(block, out);
  }
  for (const block of blocks) {
    if (block.theme !== 'jungle_pond') buildGenericBlock(block, out);
  }
  // 宝箱もタイル占有システムに乗せる（他の物体と同じ 1 タイル 1 個のルールを守るため、
  // 単独で座標を決め打ちしない）。ワールド中央のタイルを含むブロックの中から、
  // その中心に一番近い空きタイルを選ぶ。
  const cgx = Math.floor(WORLD_W / 2 / TILE);
  const cgy = Math.floor(WORLD_H / 2 / TILE);
  const centerBlock = blocks.find((b) => cgx >= b.gx0 && cgx < b.gx1 && cgy >= b.gy0 && cgy < b.gy1)!;
  const chestPos = nearestFreeTileInBlock({ x: WORLD_W / 2, y: WORLD_H / 2 }, centerBlock, LAND_KINDS);
  out.chest = chestPos ?? tileCenter(cgx, cgy);
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
  // 宝箱は飾り 1 個だけ（当たり判定なし）。buildWorld() 内でタイル占有を通して決めた位置。
  const chestRef = useRef<{ x: number; y: number }>(builtWorld.chest);
  // 地面は 1 枚の Canvas へ事前に焼く（piggGround.ts）。焼き終わるまではローディングを出す
  // （CLAUDE.md: 「無言で固まる 1 秒は許容しない」）。
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

    const pos = { x: WORLD_W / 2, y: WORLD_H / 2 };
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
        // 軸ごとに動かす（壁に沿って滑る。本編の tryMove と同じ考え方）
        if (tryMove(nx, pos.y)) pos.x = nx;
        if (tryMove(pos.x, ny)) pos.y = ny;
      }

      const vw = root.clientWidth;
      const vh = root.clientHeight;
      // ズーム倍率は固定値をやめ、「画面の横幅いっぱいに ZOOM_TILES_ACROSS マスが入る」
      // ことから毎フレーム逆算する（lead 指示）。毎フレーム root.clientWidth を読むので、
      // ウィンドウのリサイズやデバイス幅の違いにもそのまま追従する
      // （ResizeObserver を別途持たなくても、この rAF ループ自体が実質のポーリングになる）。
      const zoom = vw / (ZOOM_TILES_ACROSS * TILE);
      // カメラが向く世界座標上の焦点（プレイヤー位置を、ワールドの外が画面に映らないよう
      // クランプしたもの）。ズームしている分、画面に映る世界の半幅/半高は
      // viewportSize / (2*zoom) に広がるので、素の pos.x/pos.y をそのままクランプするのではなく
      // その半幅/半高でクランプする。ワールドがその半幅/半高より小さい向きは中央に固定する。
      const focusX =
        WORLD_W * zoom <= vw ? WORLD_W / 2 : Math.max(vw / (2 * zoom), Math.min(WORLD_W - vw / (2 * zoom), pos.x));
      const focusY =
        WORLD_H * zoom <= vh ? WORLD_H / 2 : Math.max(vh / (2 * zoom), Math.min(WORLD_H - vh / (2 * zoom), pos.y));
      world.style.transform = `translate(${vw / 2 - focusX * zoom}px, ${vh / 2 - focusY * zoom}px) scale(${zoom})`;
      // 歩きコマがまだ1枚しか無いので、動いている間だけ軽くバウンドさせて
      // 「歩いている感」だけ出す（本格的な歩行アニメは別途）。
      // プレイヤーは他の物体と同じく .pigg-world 直下の絶対配置（world 座標系）にしたので、
      // left/top はカメラに関係なく pos.x/pos.y のみで決まる（ズーム・パンは親の world 側の
      // transform が一括でやってくれる）。
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
        {/* 地面は piggGround.ts が焼いた 1 枚の Canvas（ブロックごとの砂・草・水をなめらかにブレンド）。 */}
        <canvas ref={groundCanvasRef} className="pigg-field-ground" width={WORLD_W} height={WORLD_H} />
        {waterPlantsRef.current.map((p, i) => (
          <img
            key={`waterplant-${i}`}
            src={p.sprite}
            className="pigg-obj pigg-obj-flat"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
        {plantsRef.current.map((p, i) => (
          <img
            key={`plant-${i}`}
            src={p.sprite}
            className="pigg-obj pigg-obj-flat"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
        {furnitureRef.current.map((f, i) => (
          <img
            key={`furn-${i}`}
            src={f.sprite}
            className="pigg-obj"
            style={{ left: f.x, top: f.y, width: `${f.scale * f.baseWidth}px` }}
            alt=""
          />
        ))}
        {rocksRef.current.map((r, i) => (
          <img
            key={`rock-${i}`}
            src={r.sprite}
            className="pigg-obj"
            style={{ left: r.x, top: r.y, width: `${r.scale * r.baseWidth}px` }}
            alt=""
          />
        ))}
        <img
          src={piggChest}
          className="pigg-obj"
          style={{ left: chestRef.current.x, top: chestRef.current.y, width: '64px' }}
          alt=""
        />
        {treesRef.current.map((tr, i) => (
          <img
            key={`tree-${i}`}
            src={tr.sprite}
            className="pigg-obj"
            style={{ left: tr.x, top: tr.y, width: `${tr.scale * tr.baseWidth}px` }}
            alt=""
          />
        ))}
        {palmsRef.current.map((p, i) => (
          <img
            key={`palm-${i}`}
            src={p.sprite}
            className="pigg-obj"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
        {/* 主人公（ChatGPT 生成の正面立ち絵。影は絵に内蔵済みなので別で描かない）。
            他の物体と同じ .pigg-world 直下の絶対配置にし、常に最後に描画することで
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

      {/* 地面の Canvas を焼いている間だけ出す（無言で固まらせない）。 */}
      {!groundReady && (
        <div className="pigg-loading">
          <span>島を準備中…</span>
        </div>
      )}
    </div>
  );
}
