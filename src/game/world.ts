// MAP（ASCII）から World を組み立てる。エリア判定・畑の区画・配置スペースなど。
// マップの記号の意味は data.ts の MAP コメントを見る。

import { AREAS, CHEST_RECIPES, MAP, SLOT_CHARS, STATION_CHARS } from './data';
import type { AreaId, Chest, Ground, MapNode, NodeKind, Plot, Slot, Station, World } from './types';

/** "x,y" 形式のキーを作る。 */
export const key = (x: number, y: number): string => `${x},${y}`;

/** ground 配列 / area 配列のフラットインデックス。 */
export const worldIndex = (x: number, y: number, width: number): number => y * width + x;

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 境界の記号 ('1' '2' '3' …) → その先に開くエリア。AREAS の borderChar から逆引きする。 */
function areaByBorderChar(): Map<string, AreaId> {
  const m = new Map<string, AreaId>();
  for (const area of Object.values(AREAS)) {
    if (area.borderChar != null) m.set(area.borderChar, area.id);
  }
  return m;
}

function isBorderChar(ch: string): boolean {
  return ch >= '1' && ch <= '9';
}

function groundOf(ch: string): Ground {
  if (ch === '~') return 'water';
  if (ch === ',') return 'sand';
  if (ch === 'f') return 'soil';
  return 'grass';
}

function buildFrom(map: string[]): World {
  const height = map.length;
  const width = map[0]?.length ?? 0;
  const grid = map;
  const at = (x: number, y: number): string => grid[y]?.[x] ?? '~';

  const ground: Ground[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ground[worldIndex(x, y, width)] = groundOf(at(x, y));
    }
  }
  // 物や配置スペースの下の地面は記号から分からないので、左右の地面に合わせる
  // （砂浜の岩の下だけ草になるのを防ぐ）。
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = worldIndex(x, y, width);
      if (ground[i] !== 'grass' || at(x, y) === '.') continue;
      if (at(x - 1, y) === ',' || at(x + 1, y) === ',') ground[i] = 'sand';
    }
  }

  // --- エリア判定（4 近傍のフラッドフィル。境界文字は水と同じく越えられない） ---
  const area: (AreaId | null)[] = new Array(width * height).fill(null);
  const setArea = (x: number, y: number, a: AreaId) => {
    area[worldIndex(x, y, width)] = a;
  };
  const getArea = (x: number, y: number): AreaId | null => area[worldIndex(x, y, width)] ?? null;

  const floodFill = (seeds: { x: number; y: number }[], a: AreaId) => {
    const stack = [...seeds];
    for (const s of seeds) setArea(s.x, s.y, a);
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur) continue;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ch = at(nx, ny);
        if (ch === '~') continue;
        if (isBorderChar(ch)) continue; // 境界は越えない（自分自身は seed として先に塗ってある）
        if (getArea(nx, ny) != null) continue;
        setArea(nx, ny, a);
        stack.push({ x: nx, y: ny });
      }
    }
  };

  let start = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) === '@') start = { x, y };
    }
  }
  floodFill([start], 'beach');

  const borderCharToArea = areaByBorderChar();
  for (const ch of ['1', '2', '3']) {
    const a = borderCharToArea.get(ch);
    if (!a) continue;
    const seeds: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (at(x, y) === ch) seeds.push({ x, y });
      }
    }
    floodFill(seeds, a);
  }

  // --- ノード（資源・境界） ---
  const nodes: MapNode[] = [];
  const nodeKindFor = (ch: string, a: AreaId | null): NodeKind | null => {
    if (ch === 'T') return 'tree';
    if (ch === 't') return 'bigTree';
    if (ch === 'R') return 'rock';
    if (ch === 'H') return 'hardRock';
    if (isBorderChar(ch) && a) return AREAS[a].border?.kind ?? null;
    return null;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      const a = getArea(x, y);
      const kind = nodeKindFor(ch, a);
      if (kind && a) {
        nodes.push({ id: key(x, y), x, y, kind, area: a });
      }
    }
  }

  // --- 畑の区画（'f' の連結成分。看板 's' が隣接するものがその区画の看板） ---
  const plots: Plot[] = [];
  const visited = new Array<boolean>(width * height).fill(false);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== 'f' || visited[worldIndex(x, y, width)]) continue;
      const tiles: { x: number; y: number }[] = [];
      const stack = [{ x, y }];
      visited[worldIndex(x, y, width)] = true;
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        tiles.push(cur);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (at(nx, ny) !== 'f' || visited[worldIndex(nx, ny, width)]) continue;
          visited[worldIndex(nx, ny, width)] = true;
          stack.push({ x: nx, y: ny });
        }
      }
      let sign: { x: number; y: number } | null = null;
      for (const t of tiles) {
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = t.x + dx;
          const ny = t.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (at(nx, ny) === 's') sign = { x: nx, y: ny };
        }
      }
      if (!sign) continue; // 仕様上あり得ないが、型のために防御
      const first = tiles[0];
      const a = first ? getArea(first.x, first.y) : null;
      if (!a) continue;
      plots.push({ id: key(sign.x, sign.y), sign, tiles, area: a });
    }
  }

  // --- 宝箱 ---
  const chests: Chest[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== 'c') continue;
      const a = getArea(x, y);
      if (!a) continue;
      const recipe = CHEST_RECIPES[a];
      if (!recipe) continue;
      chests.push({ id: key(x, y), x, y, area: a, recipe });
    }
  }

  // --- 設備（遺跡・作業台） ---
  const stations: Station[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = STATION_CHARS[at(x, y)];
      if (!kind) continue;
      const a = getArea(x, y);
      if (!a) continue;
      stations.push({ id: key(x, y), x, y, kind, area: a });
    }
  }

  // --- 配置スペース ---
  const slots: Slot[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      const attr = SLOT_CHARS[ch];
      if (!attr) continue;
      const a = getArea(x, y);
      if (!a) continue;
      slots.push({ id: key(x, y), x, y, attr, area: a });
    }
  }

  return { width, height, ground, area, nodes, slots, plots, chests, stations, start };
}

export function buildWorld(map: string[] = MAP): World {
  return buildFrom(map);
}

let cached: World | null = null;

/** 既定マップの World を一度だけ構築して使い回す。 */
export function getWorld(): World {
  if (!cached) cached = buildWorld();
  return cached;
}
