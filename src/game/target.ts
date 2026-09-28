// プレイヤー位置からアクション対象を選ぶ。歩けるかの当たり判定もここ。

import { FURNITURE_BY_ID, TARGET_ORIGIN_UP, TARGET_RADIUS } from './data';
import { canHit, nodeAlive } from './rules';
import { isReady } from './time';
import { key, worldIndex } from './world';
import type { Dir, Fail, SaveState, Target, World } from './types';

const DIR_VECTOR: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

interface Candidate {
  dist: number;
  x: number;
  y: number;
  target: Target;
  blocked?: Fail;
}

/** 体の中心（足元から TARGET_ORIGIN_UP 上）から、マス (x, y) の中心までの距離。 */
function dist(px: number, py: number, x: number, y: number): number {
  const dx = x + 0.5 - px;
  const dy = y + 0.5 - (py - TARGET_ORIGIN_UP);
  return Math.sqrt(dx * dx + dy * dy);
}

export function findTarget(
  world: World,
  save: SaveState,
  px: number,
  py: number,
  dir: Dir,
  now: number,
): (Target & { blocked?: Fail }) | null {
  const candidates: Candidate[] = [];

  for (const node of world.nodes) {
    if (!nodeAlive(save, node, now)) continue;
    const d = dist(px, py, node.x, node.y);
    if (d > TARGET_RADIUS) continue;
    candidates.push({
      dist: d,
      x: node.x,
      y: node.y,
      target: { kind: 'node', x: node.x, y: node.y, node },
      blocked: canHit(save, node) ? undefined : 'needSkill',
    });
  }

  for (const plot of world.plots) {
    const d = dist(px, py, plot.sign.x, plot.sign.y);
    if (d <= TARGET_RADIUS) {
      candidates.push({
        dist: d,
        x: plot.sign.x,
        y: plot.sign.y,
        target: { kind: 'sign', x: plot.sign.x, y: plot.sign.y, plot },
      });
    }

    const state = save.plots[plot.id];
    for (const tile of plot.tiles) {
      const td = dist(px, py, tile.x, tile.y);
      if (td > TARGET_RADIUS) continue;
      const existing = state?.tiles[key(tile.x, tile.y)];
      if (existing) {
        if (!isReady(existing, now)) continue; // 成長中は候補にしない
        candidates.push({
          dist: td,
          x: tile.x,
          y: tile.y,
          target: { kind: 'farm', x: tile.x, y: tile.y, plot, action: 'harvest' },
        });
      } else if (state?.selected) {
        candidates.push({
          dist: td,
          x: tile.x,
          y: tile.y,
          target: { kind: 'farm', x: tile.x, y: tile.y, plot, action: 'plant' },
        });
      }
    }
  }

  for (const chest of world.chests) {
    if (save.chestsOpened.includes(chest.id)) continue;
    const d = dist(px, py, chest.x, chest.y);
    if (d <= TARGET_RADIUS) {
      candidates.push({ dist: d, x: chest.x, y: chest.y, target: { kind: 'chest', x: chest.x, y: chest.y, chest } });
    }
  }

  if (candidates.length === 0) return null;

  let minDist = Infinity;
  for (const c of candidates) if (c.dist < minDist) minDist = c.dist;
  const nearest = candidates.filter((c) => c.dist - minDist < 1e-6);

  let best = nearest[0];
  if (best && nearest.length > 1) {
    const [dvx, dvy] = DIR_VECTOR[dir];
    let bestScore = -Infinity;
    for (const c of nearest) {
      const dx = c.x + 0.5 - px;
      const dy = c.y + 0.5 - py;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const score = (dx / len) * dvx + (dy / len) * dvy;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }

  if (!best) return null;
  return { ...best.target, blocked: best.blocked };
}

/** そのマスが歩けないか（水・立っている資源・看板・宝箱・置いた家具（道以外）・範囲外）。 */
export function isSolidTile(world: World, save: SaveState, x: number, y: number, now: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
  const idx = worldIndex(x, y, world.width);
  if (world.ground[idx] === 'water') return true;

  for (const node of world.nodes) {
    if (node.x === x && node.y === y && nodeAlive(save, node, now)) return true;
  }
  for (const plot of world.plots) {
    if (plot.sign.x === x && plot.sign.y === y) return true;
  }
  for (const chest of world.chests) {
    if (chest.x === x && chest.y === y) return true;
  }
  for (const slot of world.slots) {
    if (slot.x !== x || slot.y !== y) continue;
    const furnitureId = save.placements[slot.id];
    if (!furnitureId) continue;
    const def = FURNITURE_BY_ID[furnitureId];
    if (def && def.attr !== 'path') return true;
  }
  return false;
}

const FEET_HALF_WIDTH = 0.3; // 幅 0.6 マスの半分
const FEET_HALF_HEIGHT = 0.175; // 高さ 0.35 マスの半分

function collides(world: World, save: SaveState, now: number, cx: number, cy: number): boolean {
  const left = cx - FEET_HALF_WIDTH;
  const right = cx + FEET_HALF_WIDTH;
  const top = cy - FEET_HALF_HEIGHT;
  const bottom = cy + FEET_HALF_HEIGHT;
  const minX = Math.floor(left);
  const maxX = Math.floor(right - 1e-9);
  const minY = Math.floor(top);
  const maxY = Math.floor(bottom - 1e-9);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isSolidTile(world, save, tx, ty, now)) return true;
    }
  }
  return false;
}

/** x, y を別々に動かして壁に沿って滑る。 */
export function tryMove(
  world: World,
  save: SaveState,
  now: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (dx !== 0) {
    const candidate = x + dx;
    if (!collides(world, save, now, candidate, y)) nx = candidate;
  }
  if (dy !== 0) {
    const candidate = y + dy;
    if (!collides(world, save, now, nx, candidate)) ny = candidate;
  }
  return { x: nx, y: ny };
}
