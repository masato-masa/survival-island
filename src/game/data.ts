// ゲームの数値と定義はすべてここ。調整するときはこのファイルだけを触る。

import type {
  AreaDef,
  AreaId,
  CropDef,
  CropId,
  FurnitureDef,
  ItemDef,
  ItemId,
  NodeDef,
  NodeKind,
  SeriesId,
  SkillDef,
  SkillId,
  SlotAttr,
} from './types';

// ---------------------------------------------------------------------------
// スタミナ・時間

export const STAMINA_BASE = 30;
export const STAMINA_PER_LEVEL = 5; // staminaMax 1 段階ごと
export const STAMINA_REGEN_MS = 3 * 60 * 1000; // 3 分で 1 回復
export const XP_PER_STAMINA = 1; // 経験値は消費スタミナに比例

/** 叩く・植える・収穫の間隔（ミリ秒）。速度スキル 1 段階ごとに 10% 短くなる。 */
export const ACTION_COOLDOWN_MS = 420;
export const SPEED_PER_LEVEL = 0.1;

/** アクション対象を探す半径（マス）。「体の中心」から対象マスの中心まで。 */
export const TARGET_RADIUS = 1.5;
/** 体の中心 = 足元から上へこれだけ。スプライトは足元から上に伸びるので、
 *  足元で測ると「見た目は木に触れているのに届かない」になる。 */
export const TARGET_ORIGIN_UP = 0.35;

export const WALK_SPEED = 4; // マス / 秒

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
  tree: { kind: 'tree', name: '木', hp: 2, drops: { wood: 2 }, respawnMs: 10 * 60 * 1000, tool: 'axe' },
  bigTree: { kind: 'bigTree', name: '太い木', hp: 4, drops: { wood: 5 }, respawnMs: 15 * 60 * 1000, tool: 'axe' },
  rock: { kind: 'rock', name: '岩', hp: 2, drops: { stone: 2 }, respawnMs: 10 * 60 * 1000, tool: 'pick' },
  hardRock: {
    kind: 'hardRock',
    name: '硬い岩',
    hp: 4,
    drops: { stone: 3, copper: 1 },
    respawnMs: 15 * 60 * 1000,
    tool: 'pick',
  },
  borderTree: { kind: 'borderTree', name: '境界の大木', hp: 3, drops: { wood: 4 }, respawnMs: null, tool: 'axe' },
  borderRock: { kind: 'borderRock', name: '境界の大岩', hp: 3, drops: { stone: 4 }, respawnMs: null, tool: 'pick' },
};

/** 太い木・硬い岩を叩くのに必要な段階。境界は AREAS 側で決める。 */
export const NODE_REQUIRES: Partial<Record<NodeKind, { skill: SkillId; level: number }>> = {
  bigTree: { skill: 'axePower', level: 1 },
  hardRock: { skill: 'pickHard', level: 1 },
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
      '太い木と森の境界の大木を切れる',
      '叩く回数が減る／丘の境界の大木を切れる',
      '叩く回数が減る',
      '叩く回数がさらに減る',
      '叩く回数がさらに減る',
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
  F({ id: 'flowerBed', name: '花壇', attr: 'fence', series: 'garden', points: 2, cost: { stone: 2, sunflower: 1 }, stamina: 1, learn: { level: 3 } }),
  F({ id: 'flowerPot', name: '花の鉢', attr: 'decor', series: 'garden', points: 3, cost: { stone: 2, sunflower: 2 }, stamina: 1, learn: { level: 3 } }),
  F({ id: 'fruitTable', name: '果物の台', attr: 'desk', series: 'garden', points: 4, cost: { wood: 4, tomato: 2 }, stamina: 2, learn: { level: 3 } }),
  F({ id: 'veggieStand', name: '野菜の屋台', attr: 'kitchen', series: 'garden', points: 5, cost: { wood: 6, turnip: 3, tomato: 1 }, stamina: 2, learn: { level: 3 } }),
  F({ id: 'flowerArch', name: '花のアーチ', attr: 'landmark', series: 'garden', points: 7, cost: { wood: 8, sunflower: 4 }, stamina: 3, learn: { level: 3 } }),
  // 島レベル 4
  F({ id: 'stoneStatue', name: '石の像', attr: 'landmark', series: 'stone', points: 10, cost: { stone: 15, copper: 3 }, stamina: 3, learn: { level: 4 } }),
];

export const FURNITURE_BY_ID: Record<string, FurnitureDef> = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

export const AREAS: Record<AreaId, AreaDef> = {
  beach: { id: 'beach', name: 'はじまりの浜', border: null, borderChar: null },
  forest: { id: 'forest', name: 'しずかな森', border: { kind: 'borderTree', skill: 'axePower', level: 1 }, borderChar: '1' },
  rocks: { id: 'rocks', name: 'ごつごつ岩場', border: { kind: 'borderRock', skill: 'pickHard', level: 1 }, borderChar: '2' },
  hill: { id: 'hill', name: 'みはらしの丘', border: { kind: 'borderTree', skill: 'axePower', level: 2 }, borderChar: '3' },
};

export const AREA_ORDER: AreaId[] = ['beach', 'forest', 'rocks', 'hill'];

/** 宝箱で覚えるレシピ。key は宝箱のあるエリア。 */
export const CHEST_RECIPES: Partial<Record<AreaId, string>> = {
  forest: 'woodTower',
  rocks: 'copperLamp',
};

// ---------------------------------------------------------------------------
// マップ
//
//   ~ 水   . 草   , 砂   @ 開始位置（草）
//   T 木   t 太い木   R 岩   H 硬い岩
//   1 2 3 境界（数字 = AREAS の borderChar）。1 と 2 と 3 の向こうが各エリア
//   f 畑   s 看板（上下左右に接する畑の区画の看板になる）   c 宝箱
//   配置スペース: b ベンチ  l ランドマーク  p 道  w 作業台  k キッチン  d 机  o 飾り  e 柵
//
// エリアの判定: '@' から水・境界を越えずに塗った範囲が beach。境界の数字 N のマスと、
// その先を（既に塗った範囲を除いて）塗った範囲が N のエリア。

export const SLOT_CHARS: Record<string, SlotAttr> = {
  b: 'bench',
  l: 'landmark',
  p: 'path',
  w: 'workbench',
  k: 'kitchen',
  d: 'desk',
  o: 'decor',
  e: 'fence',
};

export const MAP: string[] = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~.T..t....R....t..T..~~~~~~~~~~',
  '~~~~~~~~~~...l......o.....H...~~~~~~~~~~',
  '~~~~~~~~~~.t..fffs....b...t...~~~~~~~~~~',
  '~~~~~~~~~~....fff.....b..R....~~~~~~~~~~',
  '~~~~~~~~~~.R......o.....o...t.~~~~~~~~~~',
  '~~~~~~~~~~..T...e.e.e.e.....T.~~~~~~~~~~',
  '~~~~~~~~~~..........t.......R.~~~~~~~~~~',
  '~~~~~~~~~~~~~33~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~T..t.T.T.....t..T~~R..H...R...H..R..~~',
  '~~.t....o....T..t..~~..R...l.....R..H.~~',
  '~~T..ffs...b..c..T.~~.H...o...c...R...~~',
  '~~...ff....b....t..~~R...k...w...H...R~~',
  '~~...ff...d....T...~~..H.........R....~~',
  '~~T.....T...o...t.T~~.R...d...b...H...~~',
  '~~.R...t...T...R...~~...R.....R....R..~~',
  '~~..T..........T...~~H.....R........H.~~',
  '~~~~~~~~11~~~~~~~~~~~~~~~~~~~22~~~~~~~~~',
  '~~T...R........T......T............R..~~',
  '~~.....o....b....ppp....b.......o....T~~',
  '~~..sff.......w.....l.....k.........R.~~',
  '~~...ff.......d...........d........T..~~',
  '~~........eee.......@...........R.....~~',
  '~~..T.........R............sfff.......~~',
  '~~........o...........ee....fff.......~~',
  '~~.....T........b...........fff.......~~',
  '~~,,,,,,,,,,T,,,,,,,,,R,,,,,,,,,,,,,,,~~',
  '~~,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

