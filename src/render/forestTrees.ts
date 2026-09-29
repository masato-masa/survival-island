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
  sprite: SpriteName;
  /** 水面に浮くもの（睡蓮など）。他の物より必ず下に描く。 */
  flat?: boolean; // 'wallOak' | 'wallPine'。森の壁＝進入不可・非対話であることが分かるよう、
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

function isForest(world: World, tx: number, ty: number): boolean {
  return world.ground[ty * world.width + tx] === 'forest' && tx >= 0 && ty >= 0 && tx < world.width && ty < world.height;
}

const PINE_CLUSTER_WAVELEN = 3.2; // タイル単位。この波長のノイズが低い場所を「小ぶりの木のかたまり」にする
const PINE_CLUSTER_THRESHOLD = 0.32;

function pickSpecies(tx: number, ty: number): SpriteName {
  const n = valueNoise2D(tx, ty, 501, PINE_CLUSTER_WAVELEN);
  return (n < PINE_CLUSTER_THRESHOLD ? 'wallPine' : 'wallOak') as SpriteName;
}

/**
 * 森のマス 1 つにつき木を 1 本、マスの中心（下辺）にぴったり置く。マスに沿って並ぶので格子状に見える。
 * 周りが全部森のマスは他の木に隠れて見えないので省く。
 */
export function buildForestTrees(world: World): TreeInstance[] {
  const out: TreeInstance[] = [];
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      if (!isForest(world, tx, ty)) continue;
      let inner = true;
      for (let dy = -1; dy <= 1 && inner; dy++)
        for (let dx = -1; dx <= 1; dx++) if (!isForest(world, tx + dx, ty + dy)) { inner = false; break; }
      if (inner) continue;
      out.push({ x: tx + 0.5, y: ty + 1, sprite: pickSpecies(tx, ty) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 地面の飾り（花・草・小石）。ゲームロジックには存在しない見た目だけの物体で、当たり判定は無い。
// 参考画像は「開けた草地に花や草がほどよく散っている」ので、草・砂タイルの一部に
// 決定的なハッシュで散らす。ノード・設備・畑・配置スペース・置物の上とそのすぐ隣には置かない。

const DECO_DENSITY_GRASS = 0.3;
const DECO_DENSITY_TUFT = 0.8; // 草タイルの何割に葉先を置くか（花・草が乗らないタイルだけ）
const DECO_PLANTS: SpriteName[] = ['deco_0', 'deco_1', 'deco_2', 'deco_3', 'deco_4', 'deco_5', 'deco_6', 'deco_7'];

// renderer.ts の見た目だけの置物（アーチ・かがり火）の位置。ここを避ける。
const KEEP_CLEAR: { x: number; y: number }[] = [
  { x: 7, y: 14 },
  { x: 15, y: 17 },
];

/** 草原として塗られる地面（砂・道・石畳・家の跡地も今は草原）。 */
function isOpenGround(g: string | undefined): boolean {
  return g === 'grass' || g === 'sand' || g === 'dirt' || g === 'paving' || g === 'foundation';
}

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
  const isWater = (x: number, y: number) => world.ground[y * world.width + x] === 'water' && x >= 0 && y >= 0 && x < world.width && y < world.height;
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      const idx = ty * world.width + tx;
      if (blocked.has(idx)) continue;
      const g = world.ground[idx];
      // 水面: 岸に近いところに睡蓮、ときどき丸太
      if (g === 'water') {
        const shore = !isWater(tx - 1, ty) || !isWater(tx + 1, ty) || !isWater(tx, ty - 1) || !isWater(tx, ty + 1) ||
          !isWater(tx - 1, ty - 1) || !isWater(tx + 1, ty + 1) || !isWater(tx - 2, ty) || !isWater(tx + 2, ty) || !isWater(tx, ty + 2) || !isWater(tx, ty - 2);
        const lr = hash2i(tx, ty, 731);
        if (shore && lr < 0.3) {
          const pick = hash2i(tx, ty, 732);
          const lily = (['deco_lily0', 'deco_lily1', 'deco_lily2', 'deco_lily3', 'deco_lily4'] as const)[Math.floor(pick * 5)]!;
          out.push({ x: tx + 0.5, y: ty + 0.75, sprite: lr < 0.015 ? 'deco_log' : lily, flat: true });
        }
        continue;
      }
      // 岸の草地: 水に接するマスに葦・草むら
      if (isOpenGround(g) && (isWater(tx - 1, ty) || isWater(tx + 1, ty) || isWater(tx, ty - 1) || isWater(tx, ty + 1)) && hash2i(tx, ty, 741) < 0.6) {
        out.push({ x: tx + 0.5, y: ty + 0.95, sprite: (['deco_reed0', 'deco_reed1', 'deco_reed2'] as const)[Math.floor(hash2i(tx, ty, 742) * 3)]! });
        continue;
      }
      const r = hash2i(tx, ty, 701);
      let sprite: SpriteName;
      if (isOpenGround(g) && hash2i(tx, ty, 711) < DECO_DENSITY_TUFT && r >= DECO_DENSITY_GRASS) {
        sprite = hash2i(tx, ty, 712) < 0.5 ? 'deco_tuft0' : 'deco_tuft1';
      } else if (isOpenGround(g) && r < DECO_DENSITY_GRASS) {
        const pick = hash2i(tx, ty, 702);
        sprite = pick < 0.08 ? 'deco_mossy' : pick < 0.2 ? 'deco_pebble' : DECO_PLANTS[Math.floor(hash2i(tx, ty, 703) * DECO_PLANTS.length)]!;
      } else continue;
      // マスの中心にぴったり置く（マスに沿った配置）
      out.push({ x: tx + 0.5, y: ty + 0.8, sprite });
    }
  }
  return out;
}
