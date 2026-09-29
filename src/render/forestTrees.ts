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
  sprite: SpriteName; // 'wallOak' | 'wallPine'。森の壁＝進入不可・非対話であることが分かるよう、
  // 資源ノードの tree/bigTree とは別の（暗く冷たい色調の）スプライト名を使う。
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

const STEP_X = 1.2;
const STEP_Y = 0.8;
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

/** 森の北の縁（北隣が森でない＝開けた地面のすぐ南）かどうか。
 *  木の見上げ高さは ~4.4 マスあるので、ここに幹を置くと梢が開けた地面（広場・遺跡など）
 *  に大きくかぶってしまう。1 列奥（南）の木の梢がここを覆うので、この列には幹を置かない。 */
function isNorthEdge(world: World, tx: number, ty: number): boolean {
  return isForest(world, tx, ty) && !isForest(world, tx, ty - 1);
}

function pickSpecies(tx: number, ty: number): SpriteName {
  const n = valueNoise2D(tx, ty, 501, PINE_CLUSTER_WAVELEN);
  return (n < PINE_CLUSTER_THRESHOLD ? 'wallPine' : 'wallOak') as SpriteName;
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
      if (isNorthEdge(world, tx, ty)) continue; // 開けた地面のすぐ南＝ここには幹を置かない
      // 南の縁に近いインスタンスは、幹が開けた地面側から見えるよう少し南へ寄せる。
      const southBias = isSouthEdge(world, tx, ty) ? 0.28 : 0;
      push(fx, Math.min(ty + 0.92, fy + southBias), tx, ty);
    }
  }

  // 2) 縁のタイルは必ず 1 本（グリッドが薄く当たって隙間になるのを防ぐ）
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      if (!isForestEdge(world, tx, ty)) continue;
      if (isNorthEdge(world, tx, ty)) continue; // 開けた地面のすぐ南＝ここには幹を置かない
      const jx = (hash2i(tx, ty, 611) - 0.5) * 0.5;
      const southEdge = isSouthEdge(world, tx, ty);
      const fy = southEdge ? ty + 0.85 : ty + 0.5 + (hash2i(tx, ty, 612) - 0.5) * 0.4;
      push(tx + 0.5 + jx, fy, tx, ty);
    }
  }

  return instances;
}

// ---------------------------------------------------------------------------
// 地面の飾り（花・草・小石）。ゲームロジックには存在しない見た目だけの物体で、当たり判定は無い。
// 参考画像は「開けた草地に花や草がほどよく散っている」ので、草・砂タイルの一部に
// 決定的なハッシュで散らす。ノード・設備・畑・配置スペース・置物の上とそのすぐ隣には置かない。

const DECO_DENSITY_GRASS = 0.17;
const DECO_DENSITY_SAND = 0.07;
const DECO_DENSITY_TUFT = 0.55; // 草タイルの何割に葉先を置くか（花・草が乗らないタイルだけ）
const DECO_PLANTS: SpriteName[] = ['deco_0', 'deco_1', 'deco_2', 'deco_3', 'deco_4', 'deco_5', 'deco_6', 'deco_7'];

// renderer.ts の見た目だけの置物（アーチ・かがり火）の位置。ここを避ける。
const KEEP_CLEAR: { x: number; y: number }[] = [
  { x: 7, y: 14 },
  { x: 15, y: 17 },
];

export function buildGroundDecor(world: World): TreeInstance[] {
  const blocked = new Set<number>();
  const block = (x: number, y: number, w = 1, h = 1, pad = 1) => {
    for (let yy = y - pad; yy < y + h + pad; yy++) {
      for (let xx = x - pad; xx < x + w + pad; xx++) {
        if (xx >= 0 && yy >= 0 && xx < world.width && yy < world.height) blocked.add(yy * world.width + xx);
      }
    }
  };
  for (const n of world.nodes) block(n.x, n.y, 1, 1, 0);
  for (const s of world.slots) block(s.x, s.y, s.w ?? 1, s.h ?? 1, 1);
  for (const p of world.plots) {
    block(p.sign.x, p.sign.y);
    for (const t of p.tiles) block(t.x, t.y);
  }
  for (const c of world.chests) block(c.x, c.y);
  for (const st of world.stations) block(st.x, st.y);
  for (const d of world.decor ?? []) block(d.x, d.y, d.w, d.h, 1);
  for (const k of KEEP_CLEAR) block(k.x, k.y, 1, 1, 1);
  block(world.start.x, world.start.y, 1, 1, 1);

  const out: TreeInstance[] = [];
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      const idx = ty * world.width + tx;
      if (blocked.has(idx)) continue;
      const g = world.ground[idx];
      const r = hash2i(tx, ty, 701);
      let sprite: SpriteName;
      if (g === 'grass' && hash2i(tx, ty, 711) < DECO_DENSITY_TUFT && r >= DECO_DENSITY_GRASS) {
        sprite = hash2i(tx, ty, 712) < 0.5 ? 'deco_tuft0' : 'deco_tuft1';
      } else if (g === 'grass' && r < DECO_DENSITY_GRASS) {
        const pick = hash2i(tx, ty, 702);
        sprite = pick < 0.08 ? 'deco_mossy' : pick < 0.2 ? 'deco_pebble' : DECO_PLANTS[Math.floor(hash2i(tx, ty, 703) * DECO_PLANTS.length)]!;
      } else if (g === 'sand' && r < DECO_DENSITY_SAND) {
        sprite = 'deco_pebble';
      } else continue;
      out.push({
        x: tx + 0.2 + hash2i(tx, ty, 704) * 0.6,
        y: ty + 0.55 + hash2i(tx, ty, 705) * 0.4,
        sprite,
      });
    }
  }
  return out;
}
