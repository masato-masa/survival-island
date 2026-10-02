// MAP（ASCII）から World を組み立てる。エリア判定・畑の区画・配置スペースなど。
// マップの記号の意味は data.ts の MAP_LEGEND を見る。
// マップと AREA_MAP そのものは map.ts（scripts/build-map.mjs の生成物）から来る。

import { AREAS, CHEST_RECIPES, EXTRA_INITIAL_FURNITURE, FURNITURE_CHARS, STATION_CHARS } from './data';
import { AREA_MAP, MAP } from './map';
import type { AreaId, Chest, Decor, DecorKind, Ground, InitialFurniture, MapNode, NodeKind, Plot, Station, World } from './types';

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

function isBorderChar(ch: string): boolean {
  return ch >= '1' && ch <= '9';
}

/** AREA_MAP の文字 → AreaId。水は別途 null にする。 */
const AREA_CHAR: Record<string, AreaId> = {
  s: 'beach',
  w: 'woods',
  p: 'plaza',
  u: 'ruins',
  f: 'forest',
  r: 'rocks',
  h: 'hill',
};

/** MAP の文字から直接決まる地面。それ以外（物・配置スペースなど）は周りの地面から決める。 */
const DIRECT_GROUND: Record<string, Ground> = {
  '~': 'water',
  ',': 'sand',
  '.': 'grass',
  ':': 'dirt',
  '=': 'paving',
  '#': 'grass', // 森の木は資源（ノード）。切ったあとは歩ける草地
  v: 'grass', // 花の下は草
  D: 'dock',
  F: 'foundation',
  f: 'soil',
  L: 'paving',
  Q: 'dock',
  S: 'water', // 商船（Decor）の下は海
  p: 'dirt', // 道の配置スペースは道の上にある（周りの多数決だと草になって道が途切れる）
};

const WALKABLE_GROUND: Ground[] = ['grass', 'sand', 'dirt', 'paving', 'dock', 'foundation'];

/** 4 連結の連結成分を集める（'L' の 4x4 ランドマーク領域、'S' の商船、'F' の家の跡地に使う）。 */
function connectedComponents(
  width: number,
  height: number,
  at: (x: number, y: number) => string,
  match: (ch: string) => boolean,
): { x: number; y: number }[][] {
  const visited = new Array<boolean>(width * height).fill(false);
  const comps: { x: number; y: number }[][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = worldIndex(x, y, width);
      if (visited[idx] || !match(at(x, y))) continue;
      const tiles: { x: number; y: number }[] = [];
      const stack = [{ x, y }];
      visited[idx] = true;
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        tiles.push(cur);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = worldIndex(nx, ny, width);
          if (visited[nIdx] || !match(at(nx, ny))) continue;
          visited[nIdx] = true;
          stack.push({ x: nx, y: ny });
        }
      }
      comps.push(tiles);
    }
  }
  return comps;
}

function bboxOf(tiles: { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  return { minX, minY, maxX, maxY };
}

function buildFrom(map: string[], areaMap: string[], extraFurniture: InitialFurniture[]): World {
  const height = map.length;
  const width = map[0]?.length ?? 0;
  const at = (x: number, y: number): string => map[y]?.[x] ?? '~';
  const areaCh = (x: number, y: number): string => areaMap[y]?.[x] ?? '';

  // --- 地面。直接決まるものはそのまま、それ以外は周りの歩ける地面の多数決（既定は草）。 ---
  const ground: (Ground | null)[] = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = DIRECT_GROUND[at(x, y)];
      if (g) ground[worldIndex(x, y, width)] = g;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = worldIndex(x, y, width);
      if (ground[idx] != null) continue;
      const counts = new Map<Ground, number>();
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ng = ground[worldIndex(nx, ny, width)];
        if (!ng || !WALKABLE_GROUND.includes(ng)) continue;
        counts.set(ng, (counts.get(ng) ?? 0) + 1);
      }
      let best: Ground = 'grass';
      let bestCount = 0;
      for (const [g, c] of counts) {
        // 同数なら草より道・石畳・砂などを選ぶ（道の途中に置いた物の下が草にならないように）
        if (c > bestCount || (c === bestCount && best === 'grass')) {
          bestCount = c;
          best = g;
        }
      }
      ground[idx] = best;
    }
  }
  const resolvedGround = ground as Ground[];

  // --- エリア。AREA_MAP の文字からそのまま決まる（水だけ null）。 ---
  const area: (AreaId | null)[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = worldIndex(x, y, width);
      area[idx] = resolvedGround[idx] === 'water' ? null : AREA_CHAR[areaCh(x, y)] ?? null;
    }
  }
  const getArea = (x: number, y: number): AreaId | null => area[worldIndex(x, y, width)] ?? null;

  let start = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) === '@') start = { x, y };
    }
  }

  // --- ノード（資源・境界） ---
  const nodes: MapNode[] = [];
  const nodeKindFor = (ch: string, a: AreaId | null): NodeKind | null => {
    if (ch === 'T') return 'tree';
    if (ch === 't') return 'bigTree';
    if (ch === 'R') return 'rock';
    if (ch === 'H') return 'hardRock';
    if (ch === '#') return 'forestTree';
    if (ch === 'v') return 'flower';
    if (isBorderChar(ch) && a) return AREAS[a].border?.kind ?? null;
    return null;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      const a = getArea(x, y);
      const kind = nodeKindFor(ch, a);
      if (kind && a) nodes.push({ id: key(x, y), x, y, kind, area: a });
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

  // --- 設備（遺跡・船着き場の係留柱） ---
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
  // 家の跡地（'F' の連結成分ごとに、一番下の行の中央に 1 つ置く）
  const foundationComps = connectedComponents(width, height, at, (ch) => ch === 'F');
  for (const comp of foundationComps) {
    const { minX, maxX, maxY } = bboxOf(comp);
    const x = Math.floor((minX + maxX) / 2);
    const y = maxY;
    const a = getArea(x, y);
    if (!a) continue;
    stations.push({ id: key(x, y), x, y, kind: 'housePlot', area: a });
  }

  // --- 最初から置く家具（W 作業台・P 古い柱、と既定マップだけの追加分） ---
  const initialFurniture: InitialFurniture[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const furniture = FURNITURE_CHARS[at(x, y)];
      if (furniture) initialFurniture.push({ x, y, furniture });
    }
  }
  for (const f of extraFurniture) {
    if (f.x < 0 || f.y < 0 || f.x >= width || f.y >= height) continue;
    if (initialFurniture.some((g) => g.x === f.x && g.y === f.y)) continue;
    initialFurniture.push(f);
  }

  // --- 飾り（歩けない崩れた石、歩ける瓦礫、商船） ---
  const decor: Decor[] = [];
  const pushDecor = (x: number, y: number, w: number, h: number, kind: DecorKind, solid: boolean): void => {
    decor.push({ id: key(x, y), x, y, w, h, kind, solid });
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      if (ch === 'r') pushDecor(x, y, 1, 1, 'rubble', false);
      else if (ch === 'B') pushDecor(x, y, 1, 1, 'brokenStone', true);
    }
  }
  // 商船（7x8）：'S' の連結成分ごとに 1 つ
  const shipComps = connectedComponents(width, height, at, (ch) => ch === 'S');
  for (const comp of shipComps) {
    const { minX, minY, maxX, maxY } = bboxOf(comp);
    pushDecor(minX, minY, maxX - minX + 1, maxY - minY + 1, 'ship', true);
  }

  return { width, height, ground: resolvedGround, area, nodes, plots, chests, stations, decor, initialFurniture, start };
}

/** テスト用に小さな独立マップを渡すとき、area は省略できる（全マス beach 扱いにする）。 */
function defaultAreaMap(map: string[]): string[] {
  return map.map((row) => 's'.repeat(row.length));
}

export function buildWorld(map: string[] = MAP, areaMap?: string[]): World {
  const resolvedAreaMap = areaMap ?? (map === MAP ? AREA_MAP : defaultAreaMap(map));
  // たき火・遺跡のアーチは既定マップの座標で決め打ちなので、テスト用の小さなマップには置かない。
  return buildFrom(map, resolvedAreaMap, map === MAP ? EXTRA_INITIAL_FURNITURE : []);
}

let cached: World | null = null;

/** 既定マップの World を一度だけ構築して使い回す。 */
export function getWorld(): World {
  if (!cached) cached = buildWorld();
  return cached;
}
