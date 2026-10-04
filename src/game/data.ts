// ゲームの数値と定義はすべてここ。調整するときはこのファイルだけを触る。

import type {
  AreaDef,
  AreaId,
  CropDef,
  CropId,
  FurnitureDef,
  FurnitureId,
  InitialFurniture,
  ItemDef,
  ItemId,
  NodeDef,
  NodeKind,
  SeriesId,
  SkillDef,
  SkillId,
  SlotAttr,
  StationKind,
} from './types';

// ---------------------------------------------------------------------------
// スタミナ・時間

export const STAMINA_BASE = 30;
export const STAMINA_PER_LEVEL = 5; // staminaMax 1 段階ごと
export const STAMINA_REGEN_MS = 3 * 60 * 1000; // 3 分で 1 回復
export const XP_PER_STAMINA = 1; // 経験値は消費スタミナに比例

/**
 * 時間のかかる行動（ピグライフ風）。タップすると約 3 秒かけて 1 段階ぶん作業し、終わったときに結果が出る。
 * 伐採・採掘は速度スキル 1 段階ごとに SPEED_PER_LEVEL ずつ短くなる。採取（花）・畑は一定。
 */
export const CHOP_ACTION_MS = 3000;
export const GATHER_ACTION_MS = 3000;
export const FARM_ACTION_MS = 3000;
export const SPEED_PER_LEVEL = 0.1;

/** 苗木・花の種を植えてから育ちきるまで。 */
export const TREE_GROW_MS = 10 * 60 * 1000;
export const FLOWER_GROW_MS = 3 * 60 * 1000;
/** 花は何回摘むと消えるか。 */
export const FLOWER_GATHERS = 3;
/** 植えるときのスタミナ。 */
export const PLANT_STAMINA = 1;

/** アクション対象を探す半径（マス）。「体の中心」から対象マスの中心まで。 */
export const TARGET_RADIUS = 1.0;
/** 体の中心 = 足元から上へこれだけ。スプライトは足元から上に伸びるので、
 *  足元で測ると「見た目は木に触れているのに届かない」になる。 */
export const TARGET_ORIGIN_UP = 0.5;

export const WALK_SPEED = 3; // マス / 秒（1 マスを物体 2 個ぶんに大きくしたので、画面上の速さは旧 6 マス/秒と同じ）

// ---------------------------------------------------------------------------
// 島レベル

/** index = 島レベル - 1。その島レベルになるのに必要な島ポイントの過去最大。 */
export const ISLAND_LEVEL_POINTS = [0, 10, 30, 60, 100];

/** 統一ボーナス: エリア内の同じシリーズの家具数 → ボーナス。数が多い段から判定する。 */
export const SERIES_BONUS: { count: number; bonus: number }[] = [
  { count: 8, bonus: 10 },
  { count: 5, bonus: 5 },
  { count: 3, bonus: 2 },
];

/** スキル段階の上限 = 島レベル（ただし各スキルの maxLevel まで）。 */
export const skillCapForIslandLevel = (level: number) => level;

/** スキルの各段階に必要な経験値。index 0 が Lv1。 */
export const SKILL_COST = [10, 25, 50, 90, 150];

// ---------------------------------------------------------------------------

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: '木材', kind: 'material' },
  stone: { id: 'stone', name: '石', kind: 'material' },
  copper: { id: 'copper', name: '銅鉱石', kind: 'material' },
  sapling: { id: 'sapling', name: '苗木', kind: 'plant' },
  flowerSeed: { id: 'flowerSeed', name: '花の種', kind: 'plant' },
  petal: { id: 'petal', name: '花びら', kind: 'plant' },
  turnip: { id: 'turnip', name: 'カブ', kind: 'crop' },
  sunflower: { id: 'sunflower', name: 'ヒマワリ', kind: 'crop' },
  tomato: { id: 'tomato', name: 'トマト', kind: 'crop' },
};

export const CROPS: Record<CropId, CropDef> = {
  turnip: { id: 'turnip', name: 'カブ', growMs: 2 * 60 * 1000, unlockLevel: 1 },
  sunflower: { id: 'sunflower', name: 'ヒマワリ', growMs: 4 * 60 * 1000, unlockLevel: 2 },
  tomato: { id: 'tomato', name: 'トマト', growMs: 6 * 60 * 1000, unlockLevel: 3 },
};

export const NODES: Record<NodeKind, NodeDef> = {
  // 木は復活しない（幹を切ると苗木が出るので、それを植えて増やす）。
  tree: { kind: 'tree', name: '若木', hp: 2, drops: { wood: 2 }, respawnMs: null, tool: 'axe' },
  bigTree: { kind: 'bigTree', name: 'カシの木', hp: 4, drops: { wood: 5 }, respawnMs: null, tool: 'axe' },
  rock: { kind: 'rock', name: '岩', hp: 2, drops: { stone: 2 }, respawnMs: 10 * 60 * 1000, tool: 'pick' },
  hardRock: {
    kind: 'hardRock',
    name: '硬い岩',
    hp: 4,
    drops: { stone: 3, copper: 1 },
    respawnMs: 15 * 60 * 1000,
    tool: 'pick',
  },
  borderTree: { kind: 'borderTree', name: '境界の木', hp: 3, drops: { wood: 4 }, respawnMs: null, tool: 'axe' },
  borderRock: { kind: 'borderRock', name: '境界の大岩', hp: 3, drops: { stone: 4 }, respawnMs: null, tool: 'pick' },
  forestTree: { kind: 'forestTree', name: '森の主', hp: 4, drops: { wood: 3 }, respawnMs: null, tool: 'axe' },
  // 花は 1 回摘むごとに drops が出て、hp（= 摘める回数）が 1 減る。
  flower: { kind: 'flower', name: '花', hp: FLOWER_GATHERS, drops: { petal: 2, flowerSeed: 1 }, respawnMs: null, tool: 'gather' },
};

/**
 * 木の樹種。切るのに要る axePower の段階ごとに決まっていて、絵（plantArt.ts）もこれで描き分ける。
 * 段階が上がるほど大きく・古く・暗い木になるので、見ただけで必要な段階が分かる。
 * 境界の木は、そのエリアの段階の樹種（ツタが巻いている）。
 */
export const TREE_SPECIES: Readonly<Record<number, string>> = { 0: '若木', 1: 'カシの木', 2: 'スギの大木', 5: '森の主' };

/** その段階で切れる木の樹種名（段階ちょうどの樹種が無ければ、それより下で一番近いもの）。 */
export function treeSpeciesName(level: number): string {
  for (let l = level; l >= 0; l--) {
    const name = TREE_SPECIES[l];
    if (name) return name;
  }
  return '木';
}

/** カシの木・硬い岩を叩くのに必要な段階。境界は AREAS 側で決める。 */
export const NODE_REQUIRES: Partial<Record<NodeKind, { skill: SkillId; level: number }>> = {
  bigTree: { skill: 'axePower', level: 1 },
  hardRock: { skill: 'pickHard', level: 1 },
  // 森の主は、いちばん高い段階の斧（パワーアップの最大）でしか切れない。
  forestTree: { skill: 'axePower', level: 5 },
};

/** 1 回叩いたときに減る体力。パワー系スキル 2 段階ごとに +1。 */
export const damageForLevel = (level: number) => 1 + Math.floor(level / 2);

/** 収穫量。farmYield 1 段階で 2、3 段階で 3、5 段階で 4。 */
export const harvestAmount = (yieldLevel: number) => 1 + Math.ceil(yieldLevel / 2);

/** farmRange の段階ごとの範囲（対象マスからの相対位置。同じ畑のマスだけに効く）。 */
export const FARM_RANGE: [number, number][][] = [
  [[0, 0]],
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
];

export const SKILLS: Record<SkillId, SkillDef> = {
  axePower: {
    id: 'axePower',
    branch: 'axe',
    name: 'パワーアップ',
    maxLevel: 5,
    levelText: [
      'カシの木（深緑の広葉樹。森の入口の木も）を切れる',
      'スギの大木（赤い幹の針葉樹。丘の入口の木も）を切れる／叩く回数が減る',
      '叩く回数が減る',
      '叩く回数がさらに減る',
      '森の主（森を囲む黒い巨木）を切れる／叩く回数がさらに減る',
    ],
  },
  axeSpeed: {
    id: 'axeSpeed',
    branch: 'axe',
    name: '伐採速度アップ',
    maxLevel: 5,
    levelText: ['伐採が 10% 速い', '伐採が 20% 速い', '伐採が 30% 速い', '伐採が 40% 速い', '伐採が 50% 速い'],
  },
  pickHard: {
    id: 'pickHard',
    branch: 'pick',
    name: '硬い岩を掘れる',
    maxLevel: 5,
    levelText: ['硬い岩と岩場の境界の大岩を掘れる', '叩く回数が減る', '叩く回数が減る', '叩く回数がさらに減る', '叩く回数がさらに減る'],
  },
  pickSpeed: {
    id: 'pickSpeed',
    branch: 'pick',
    name: '採掘速度アップ',
    maxLevel: 5,
    levelText: ['採掘が 10% 速い', '採掘が 20% 速い', '採掘が 30% 速い', '採掘が 40% 速い', '採掘が 50% 速い'],
  },
  farmRange: {
    id: 'farmRange',
    branch: 'farm',
    name: '範囲の拡大',
    maxLevel: 2,
    levelText: ['十字の 5 マスにまとめて種まき・収穫', '周り 9 マスにまとめて種まき・収穫'],
  },
  farmYield: {
    id: 'farmYield',
    branch: 'farm',
    name: '収穫量アップ',
    maxLevel: 5,
    levelText: ['1 マスから 2 個', '1 マスから 2 個', '1 マスから 3 個', '1 マスから 3 個', '1 マスから 4 個'],
  },
  staminaMax: {
    id: 'staminaMax',
    branch: 'common',
    name: 'スタミナ上限アップ',
    maxLevel: 5,
    levelText: ['上限 +5', '上限 +10', '上限 +15', '上限 +20', '上限 +25'],
  },
};

export const SKILL_BRANCHES: { id: 'axe' | 'pick' | 'farm' | 'common'; name: string; skills: SkillId[] }[] = [
  { id: 'axe', name: '木こり', skills: ['axePower', 'axeSpeed'] },
  { id: 'pick', name: '採掘', skills: ['pickHard', 'pickSpeed'] },
  { id: 'farm', name: '農具', skills: ['farmRange', 'farmYield'] },
  { id: 'common', name: '共通', skills: ['staminaMax'] },
];

export const SERIES: Record<SeriesId, string> = {
  wood: '木製シリーズ',
  stone: '石造りシリーズ',
  garden: 'ガーデンシリーズ',
};

/** 幹（切り株）の体力と、切り取ったときの木材。木は切ると幹になり、幹を切ると消える。 */
export const STUMP_HP = 2;
export const STUMP_DROPS = { wood: 1 } as const;
/** 幹を切って木が消えるときに出る苗木（STUMP_DROPS に足す）。 */
export const SAPLING_DROPS: Partial<Record<NodeKind, number>> = { tree: 1, bigTree: 2, forestTree: 1, borderTree: 1 };

/** 家具が占めるマス数（1 辺）。ランドマークだけ 2×2、ほかは 1×1。 */
export const furnitureSize = (attr: SlotAttr): number => (attr === 'landmark' ? 2 : 1);

export const SLOT_ATTRS: Record<SlotAttr, string> = {
  bench: 'ベンチ',
  landmark: 'ランドマーク',
  path: '道',
  workbench: '作業台',
  kitchen: 'キッチン',
  desk: '机',
  decor: '飾り',
  fence: '柵',
};

const F = (d: FurnitureDef) => d;

/** 家具。並び順がクラフト画面の並び順。 */
export const FURNITURE: FurnitureDef[] = [
  // 木製シリーズ（島レベル 1）
  F({ id: 'woodFence', name: '木の柵', attr: 'fence', series: 'wood', points: 1, cost: { wood: 2 }, stamina: 1, learn: { level: 1 } }),
  F({ id: 'woodPath', name: '木の道板', attr: 'path', series: 'wood', points: 1, cost: { wood: 2 }, stamina: 1, learn: { level: 1 } }),
  F({ id: 'woodSign', name: '丸太の飾り', attr: 'decor', series: 'wood', points: 2, cost: { wood: 3 }, stamina: 1, learn: { level: 1 } }),
  F({ id: 'woodBench', name: '木のベンチ', attr: 'bench', series: 'wood', points: 3, cost: { wood: 5 }, stamina: 2, learn: { level: 1 } }),
  F({ id: 'woodDesk', name: '木の机', attr: 'desk', series: 'wood', points: 3, cost: { wood: 6 }, stamina: 2, learn: { level: 1 } }),
  F({ id: 'woodWorkbench', name: '木の作業台', attr: 'workbench', series: 'wood', points: 4, cost: { wood: 8, stone: 2 }, stamina: 2, learn: { level: 1 } }),
  F({ id: 'woodTower', name: '丸太の見張り台', attr: 'landmark', series: 'wood', points: 8, cost: { wood: 20 }, stamina: 3, learn: { chest: 'forest' } }),
  // 石造りシリーズ（島レベル 2）
  F({ id: 'stonePath', name: '石畳', attr: 'path', series: 'stone', points: 1, cost: { stone: 2 }, stamina: 1, learn: { level: 2 } }),
  F({ id: 'stoneFence', name: '石の柵', attr: 'fence', series: 'stone', points: 2, cost: { stone: 3 }, stamina: 1, learn: { level: 2 } }),
  F({ id: 'stoneBench', name: '石のベンチ', attr: 'bench', series: 'stone', points: 4, cost: { stone: 6 }, stamina: 2, learn: { level: 2 } }),
  F({ id: 'stoneOven', name: 'かまど', attr: 'kitchen', series: 'stone', points: 5, cost: { stone: 8, copper: 1 }, stamina: 2, learn: { level: 2 } }),
  F({ id: 'stoneLantern', name: '石灯籠', attr: 'decor', series: 'stone', points: 4, cost: { stone: 5, copper: 1 }, stamina: 2, learn: { level: 2 } }),
  F({ id: 'copperLamp', name: '銅のランタン', attr: 'decor', series: 'stone', points: 4, cost: { stone: 2, copper: 2 }, stamina: 1, learn: { chest: 'rocks' } }),
  // ガーデンシリーズ（島レベル 3）
  F({ id: 'flowerBed', name: '花壇', attr: 'fence', series: 'garden', points: 2, cost: { wood: 2, petal: 3 }, stamina: 1, learn: { level: 3 } }),
  F({ id: 'flowerPot', name: '花の鉢', attr: 'decor', series: 'garden', points: 3, cost: { wood: 2, petal: 4 }, stamina: 1, learn: { level: 3 } }),
  F({ id: 'fruitTable', name: '果物の台', attr: 'desk', series: 'garden', points: 4, cost: { wood: 4, tomato: 2 }, stamina: 2, learn: { level: 3 } }),
  F({ id: 'veggieStand', name: '野菜の屋台', attr: 'kitchen', series: 'garden', points: 5, cost: { wood: 6, turnip: 3, tomato: 1 }, stamina: 2, learn: { level: 3 } }),
  F({ id: 'flowerArch', name: '花のアーチ', attr: 'landmark', series: 'garden', points: 7, cost: { wood: 8, sunflower: 4 }, stamina: 3, learn: { level: 3 } }),
  // 島レベル 4
  F({ id: 'stoneStatue', name: '石の像', attr: 'landmark', series: 'stone', points: 10, cost: { stone: 15, copper: 3 }, stamina: 3, learn: { level: 4 } }),
  // 遺跡の宝箱で覚える
  F({ id: 'ruinPillar', name: '古代の石柱', attr: 'decor', series: 'stone', points: 5, cost: { stone: 6, copper: 1 }, stamina: 2, learn: { chest: 'ruins' } }),
  // 作れない（島に最初から置いてある）。動かす・しまうことはできる。クラフト画面には出さない。
  F({ id: 'campfire', name: 'たき火', attr: 'decor', series: 'wood', points: 0, cost: {}, stamina: 0, learn: { none: true } }),
  F({ id: 'ruinArch', name: '遺跡のアーチ', attr: 'decor', series: 'stone', points: 0, cost: {}, stamina: 0, learn: { none: true } }),
  F({ id: 'oldPillar', name: '古い柱', attr: 'decor', series: 'stone', points: 0, cost: {}, stamina: 0, learn: { none: true } }),
];

export const FURNITURE_BY_ID: Record<string, FurnitureDef> = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

/**
 * クラフトにかかる実時間（ms）。ピグライフの作業台と同じく「始める → 待つ → 受け取る」。
 * 島ポイントに比例させる（1pt = 30 秒。1pt の柵が 30 秒、ランドマーク 8〜10pt が 4〜5 分）。
 * 1 度に作れるのは 1 つ。ポイントの高い家具ほど待つので、置くものを選ぶ意味が出る。
 */
export const CRAFT_MS_PER_POINT = 30_000;
export function craftMs(furnitureId: FurnitureId): number {
  const def = FURNITURE_BY_ID[furnitureId];
  return def ? Math.max(1, def.points) * CRAFT_MS_PER_POINT : 0;
}

/** 触ると画面が開く家具（模様替えでないときに対象になる）。 */
export const FURNITURE_FUNCTION: Partial<Record<FurnitureId, 'craft'>> = { woodWorkbench: 'craft' };

/** 地図の記号以外で、最初から置く家具（既定マップのときだけ。W = 作業台、P = 古い柱は MAP の記号から決まる）。 */
export const EXTRA_INITIAL_FURNITURE: InitialFurniture[] = [
  { x: 15, y: 17, furniture: 'campfire' }, // 開けた土地の南西
  { x: 7, y: 14, furniture: 'ruinArch' }, // 遺跡の広場
];

// ---------------------------------------------------------------------------
// 家具の「表示サイズ」（タイル単位、デザインで決め打ち・art px 数から逆算しない）。
//
// ChatGPT 生成の家具シートは 1 枚ごとにドットの密度がバラバラなので、素材の
// 生ピクセルサイズのまま描くと「柵・見張り台・像」が無関係な大きさになってしまう
// （特にランドマークの 4×4 枠の中で、標準サイズのままだと小さく浮いて見える）。
// ここで種類ごとに「盤面でどう見えてほしいか」を直接指定し、renderer.ts 側は
// これに contain-fit（アスペクト比を保ったまま収める）で描く。
export const FURNITURE_DISPLAY_SIZE: Record<FurnitureId, { w: number; h: number }> = {
  // 地面に貼りつくフラットなもの（1 マス）
  woodFence: { w: 1, h: 1 },
  woodPath: { w: 1, h: 1 },
  stonePath: { w: 1, h: 1 },
  stoneFence: { w: 1, h: 1 },
  flowerBed: { w: 1, h: 1 },
  // 机・ベンチ・台・作業台など、横に少し広い什器
  woodSign: { w: 1.2, h: 1.3 },
  woodBench: { w: 1.6, h: 1.1 },
  woodDesk: { w: 1.6, h: 1.2 },
  woodWorkbench: { w: 1.6, h: 1.3 },
  stoneBench: { w: 1.6, h: 1.1 },
  stoneOven: { w: 1.5, h: 1.5 },
  fruitTable: { w: 1.6, h: 1.2 },
  veggieStand: { w: 1.7, h: 1.4 },
  // 背の高い単体の置物
  stoneLantern: { w: 1, h: 1.8 },
  copperLamp: { w: 1, h: 1.6 },
  ruinPillar: { w: 1.1, h: 1.9 },
  flowerPot: { w: 1, h: 1.4 },
  // ランドマーク（2×2 用地。小さな余白を残して枠いっぱいに見せる）
  woodTower: { w: 1.7, h: 1.7 },
  flowerArch: { w: 1.7, h: 1.7 },
  stoneStatue: { w: 1.7, h: 1.7 },
  // 島に最初からある置物
  campfire: { w: 0.9, h: 1.2 },
  ruinArch: { w: 0.9, h: 1.2 },
  oldPillar: { w: 0.9, h: 1.2 },
};

export const AREAS: Record<AreaId, AreaDef> = {
  beach: { id: 'beach', name: 'はじまりの砂浜', border: null, borderChar: null },
  woods: { id: 'woods', name: '森の小道', border: null, borderChar: null },
  plaza: { id: 'plaza', name: '開けた土地', border: null, borderChar: null },
  ruins: { id: 'ruins', name: '謎の遺跡', border: null, borderChar: null },
  forest: { id: 'forest', name: '北西の森', border: { kind: 'borderTree', skill: 'axePower', level: 1 }, borderChar: '1' },
  rocks: { id: 'rocks', name: '北東の岩場', border: { kind: 'borderRock', skill: 'pickHard', level: 1 }, borderChar: '2' },
  hill: { id: 'hill', name: '北の丘', border: { kind: 'borderTree', skill: 'axePower', level: 2 }, borderChar: '3' },
};

export const AREA_ORDER: AreaId[] = ['beach', 'woods', 'plaza', 'ruins', 'forest', 'rocks', 'hill'];

/** 宝箱で覚えるレシピ。key は宝箱のあるエリア。 */
export const CHEST_RECIPES: Partial<Record<AreaId, string>> = {
  forest: 'woodTower',
  rocks: 'copperLamp',
  ruins: 'ruinPillar',
};

// ---------------------------------------------------------------------------
// マップ（実体は scripts/build-map.mjs が生成する src/game/map.ts の MAP / AREA_MAP）
//
// MAP_LEGEND
//   ~ 水   , 砂   . 草   : 土の道   = 古い石畳   # 深い森（地面 forest。通れない・伐採できない）
//   D 桟橋の板（地面 dock。歩ける）   F 家の跡台（地面 foundation。歩ける）
//   S 商船（地面は水。S の矩形全体を覆う 1 つの Decor 'ship'。通れない）
//   Q 桟橋の係留柱（地面 dock。Station 'dock'。通れない）
//   L ランドマーク用地（4x4。地面 paving。1 つの Slot attr 'landmark'、w=4,h=4、id は左上）
//   r 瓦礫の飾り（歩ける）   B 崩れた石の飾り（通れない）   P 古い柱（家具 oldPillar を最初から置く。動かせる）
//   T 木   t 太い木   R 岩   H 硬い岩   v 花（地面は草。摘める資源 'flower'）
//   1 2 3 境界（数字 = AREAS の borderChar）。ノードの種類は AREAS[area].border.kind
//   f 畑   s 看板（上下左右に接する畑の区画の看板になる）   c 宝箱
//   X 謎の遺跡（スキル）   W 作業台（家具 woodWorkbench を最初から置く。触るとクラフト。動かせる）   @ 開始位置
//   配置スペース（1x1）: b ベンチ  l ランドマーク  p 道  w 作業台  k キッチン  d 机  o 飾り  e 柵
//
// 物・配置スペース・設備・境界・開始位置の下の地面は、記号からは分からないので
// 周囲 4 マスの「歩ける地面」（grass/sand/dirt/paving/dock/foundation）の多数決で決める
// （既定は grass）。エリアは AREA_MAP の文字からそのまま決まる（水だけ null）。
//
// エリア文字（AREA_MAP）: s 砂浜  w 森の小道  p 開けた土地  u 遺跡  f 北西の森  r 北東の岩場  h 北の丘

export const STATION_CHARS: Record<string, StationKind> = { X: 'ruins', Q: 'dock' };

/** 最初から家具を置く地図の記号。 */
export const FURNITURE_CHARS: Record<string, FurnitureId> = { W: 'woodWorkbench', P: 'oldPillar' };

export const STATIONS: Record<StationKind, { name: string; hint: string }> = {
  ruins: { name: '謎の遺跡', hint: 'スキルを授かる' },
  housePlot: { name: '家の跡地', hint: 'いつか ここに家を建てられそうだ' },
  dock: { name: '船着き場', hint: 'ときどき商船が来るらしい（交易は準備中）' },
};

