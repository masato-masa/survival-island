// 地面の飾り（花・草・睡蓮・葦）を散らす。ゲームロジックには存在しない見た目だけの物体で、当たり判定は無い。
// 森の木は資源（ノード）として world に入っているので、ここでは扱わない。

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
        sprite = DECO_PLANTS[Math.floor(hash2i(tx, ty, 703) * DECO_PLANTS.length)]!;
      } else continue;
      // マスの中心にぴったり置く（マスに沿った配置）
      out.push({ x: tx + 0.5, y: ty + 0.8, sprite });
    }
  }
  return out;
}
