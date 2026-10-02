// 地面の飾り（草むら・葦）を散らす。ゲームロジックには存在しない見た目だけの物体で、当たり判定は無い。
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

const DECO_DENSITY_TUFT = 0.45; // 草タイルの何割に葉先を置くか（砂・道・水には置かない）
const DECO_DENSITY_REED = 0.35; // 水に接する草タイルの葦

/** 草・花を置いてよい地面（草地だけ。砂浜・道・石畳には置かない）。 */
function isOpenGround(g: string | undefined): boolean {
  return g === 'grass';
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
  block(world.start.x, world.start.y, 1, 1, 1);

  const out: TreeInstance[] = [];
  const isWater = (x: number, y: number) => world.ground[y * world.width + x] === 'water' && x >= 0 && y >= 0 && x < world.width && y < world.height;
  for (let ty = 0; ty < world.height; ty++) {
    for (let tx = 0; tx < world.width; tx++) {
      const idx = ty * world.width + tx;
      if (blocked.has(idx)) continue;
      const g = world.ground[idx];
      if (!isOpenGround(g)) continue;
      // 岸の草地: 水に接するマスに葦
      if ((isWater(tx - 1, ty) || isWater(tx + 1, ty) || isWater(tx, ty - 1) || isWater(tx, ty + 1)) && hash2i(tx, ty, 741) < DECO_DENSITY_REED) {
        out.push({ x: tx + 0.5, y: ty + 0.95, sprite: (['deco_reed0', 'deco_reed1', 'deco_reed2'] as const)[Math.floor(hash2i(tx, ty, 742) * 3)]! });
        continue;
      }
      if (hash2i(tx, ty, 711) >= DECO_DENSITY_TUFT) continue;
      const sprite: SpriteName = hash2i(tx, ty, 712) < 0.5 ? 'deco_tuft0' : 'deco_tuft1';
      // マスの中心にぴったり置く（マスに沿った配置）
      out.push({ x: tx + 0.5, y: ty + 0.8, sprite });
    }
  }
  return out;
}
