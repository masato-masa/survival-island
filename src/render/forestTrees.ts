// 森（forest 地形）に立つ「本物の木」のインスタンスを生成する。
//
// 前は terrain.ts がクラウン（円）を地面レイヤーに直接焼いていたが、それだと
// プレイヤーが森のすぐ北を歩いても常に木の下に隠れてしまう（y ソートできない）。
// ここでは木を renderer.ts の y ソート対象と同じ「スプライト」として扱えるように、
// タイル単位ではなく tile 単位の浮動小数座標を持つインスタンス配列を作るだけにする。
// 実際の描画（gen_oak / gen_pine の baked sprite を貼る）は renderer.ts が行う。
//
// 決定的な乱数（ワールドから作るシード）でジッタさせるので、同じ World からは
// 何度呼んでも同じ配置になる。

import type { World } from '@/game/types';
import type { SpriteName } from './sprites';

export interface TreeInstance {
  x: number; // タイル単位（幹の位置＝スプライトの下辺中央を置く場所）
  y: number;
  sprite: SpriteName; // 'tree'（オーク）| 'bigTree'（松）。ground が砂なら renderer 側で palm に差し替わる。
}

function hash2i(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

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

const STEP_X = 1.6;
const STEP_Y = 1.1;
const PINE_CLUSTER_WAVELEN = 3.2; // タイル単位。この波長のノイズが低い場所を「松のかたまり」にする
const PINE_CLUSTER_THRESHOLD = 0.32; // ~30% がクラスタになるよう調整

function isForest(world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return false;
  return world.ground[ty * world.width + tx] === 'forest';
}

/** そのタイルが森の「縁」（4 近傍のどれかが森でない）かどうか。 */
function isForestEdge(world: World, tx: number, ty: number): boolean {
  if (!isForest(world, tx, ty)) return false;
  return (
    !isForest(world, tx - 1, ty) ||
    !isForest(world, tx + 1, ty) ||
    !isForest(world, tx, ty - 1) ||
    !isForest(world, tx, ty + 1)
  );
}

/** 森の南の縁（南隣が森でない）かどうか。トランクを開けた地面側へ見せるための判定。 */
function isSouthEdge(world: World, tx: number, ty: number): boolean {
  return isForest(world, tx, ty) && !isForest(world, tx, ty + 1);
}

function pickSpecies(tx: number, ty: number): SpriteName {
  const n = valueNoise2D(tx, ty, 501, PINE_CLUSTER_WAVELEN);
  return (n < PINE_CLUSTER_THRESHOLD ? 'bigTree' : 'tree') as SpriteName;
}

/**
 * 森タイル全体に木のインスタンスを撒く。ジッタ付きグリッド（横 ~1.6 マス・縦 ~1.1 マス間隔）
 * に加えて、縁のタイルには必ず 1 本置いて隙間ができないようにする。
 */
export function buildForestTrees(world: World): TreeInstance[] {
  const instances: TreeInstance[] = [];
  const seen = new Set<string>();

  const push = (fx: number, fy: number, tx: number, ty: number) => {
    const key = `${Math.round(fx * 100)},${Math.round(fy * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    instances.push({ x: fx, y: fy, sprite: pickSpecies(tx, ty) });
  };

  // 1) ジッタ付きグリッド
  let row = 0;
  for (let gy = 0.5; gy < world.height; gy += STEP_Y, row++) {
    let col = 0;
    for (let gx = 0.5; gx < world.width; gx += STEP_X, col++) {
      const jx = (hash2i(col, row, 601) - 0.5) * 0.9;
      const jy = (hash2i(col, row, 602) - 0.5) * 0.7;
      const fx = gx + jx;
      const fy = gy + jy;
      const tx = Math.floor(fx);
      const ty = Math.floor(fy);
      if (!isForest(world, tx, ty)) continue;
      // 南の縁に近いインスタンスは、幹が開けた地面側から見えるよう少し南へ寄せる。
      const southBias = isSouthEdge(world, tx, ty) ? 0.28 : 0;
      push(fx, Math.min(ty + 0.92, fy + southBias), tx, ty);
    }
  }

  // 2) 縁のタイルは必ず 1 本（グリッドが薄く当たって隙間になるのを防ぐ）
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      if (!isForestEdge(world, tx, ty)) continue;
      const jx = (hash2i(tx, ty, 611) - 0.5) * 0.5;
      const southEdge = isSouthEdge(world, tx, ty);
      const fy = southEdge ? ty + 0.85 : ty + 0.5 + (hash2i(tx, ty, 612) - 0.5) * 0.4;
      push(tx + 0.5 + jx, fy, tx, ty);
    }
  }

  return instances;
}
