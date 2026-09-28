// ゲーム全体で使う型。描画にも React にも依存しない。
// 座標はすべて「マス」単位。1 マス = 32 ワールドピクセル（描画側の都合）。

export type ItemId =
  // 素材
  | 'wood'
  | 'stone'
  | 'copper'
  // 作物
  | 'turnip'
  | 'sunflower'
  | 'tomato';

export type CropId = 'turnip' | 'sunflower' | 'tomato';

export type SkillId =
  | 'axePower' // 木こり: パワーアップ（太い木・境界の大木を切れる、叩く回数が減る）
  | 'axeSpeed' // 木こり: 伐採速度アップ
  | 'pickHard' // 採掘: 硬い岩を掘れる（叩く回数も減る）
  | 'pickSpeed' // 採掘: 採掘速度アップ
  | 'farmRange' // 農具: 一度に種まき・収穫できる範囲
  | 'farmYield' // 農具: 収穫量アップ
  | 'staminaMax'; // 共通: スタミナ上限アップ

export type SkillBranch = 'axe' | 'pick' | 'farm' | 'common';

/** 配置スペースの属性。家具はどれか 1 つの属性を持ち、同じ属性のスペースにだけ置ける。 */
export type SlotAttr =
  | 'bench' // ベンチ
  | 'landmark' // ランドマーク
  | 'path' // 道
  | 'workbench' // 作業台
  | 'kitchen' // キッチン
  | 'desk' // 机
  | 'decor' // 飾り
  | 'fence'; // 柵

export type SeriesId = 'wood' | 'stone' | 'garden';

export type AreaId = 'beach' | 'forest' | 'rocks' | 'hill';

/** マップ上の資源（叩いて壊すもの）。 */
export type NodeKind =
  | 'tree' // 木
  | 'bigTree' // 太い木（axePower 1 以上）
  | 'rock' // 岩
  | 'hardRock' // 硬い岩（pickHard 1 以上）
  | 'borderTree' // 境界の大木（エリアごとに必要 Lv が違う）
  | 'borderRock'; // 境界の大岩

export type Dir = 'up' | 'down' | 'left' | 'right';

// ---------------------------------------------------------------------------
// 静的データ（data.ts で定義）

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'material' | 'crop';
}

export interface CropDef {
  id: CropId;
  name: string;
  growMs: number; // 植えてから収穫できるまで
  unlockLevel: number; // この島レベルで種を覚える
}

export interface SkillDef {
  id: SkillId;
  branch: SkillBranch;
  name: string;
  maxLevel: number;
  /** 各段階の説明。index 0 が Lv1。 */
  levelText: string[];
}

export interface FurnitureDef {
  id: FurnitureId;
  name: string;
  attr: SlotAttr;
  series: SeriesId;
  points: number;
  cost: Partial<Record<ItemId, number>>;
  stamina: number; // 作るときのスタミナ消費
  /** 覚え方。島レベル到達で覚えるか、宝箱で覚えるか。 */
  learn: { level: number } | { chest: string };
}

export type FurnitureId = string;

export interface NodeDef {
  kind: NodeKind;
  name: string;
  hp: number; // 叩くと減る。0 で壊れる
  drops: Partial<Record<ItemId, number>>;
  /** 壊してから復活するまで。null は復活しない（境界）。 */
  respawnMs: number | null;
  tool: 'axe' | 'pick';
}

export interface AreaDef {
  id: AreaId;
  name: string;
  /** このエリアに入るために壊す境界。初期エリアは null。 */
  border: { kind: 'borderTree' | 'borderRock'; skill: SkillId; level: number } | null;
  /** マップの境界マスの記号（'1' '2' '3'）。初期エリアは null。 */
  borderChar: string | null;
}

// ---------------------------------------------------------------------------
// マップ（map.ts の ASCII から world.ts が組み立てる）

export type Ground = 'water' | 'grass' | 'sand' | 'soil';

export interface Slot {
  id: string; // "x,y"
  x: number;
  y: number;
  attr: SlotAttr;
  area: AreaId;
}

export interface Plot {
  id: string; // 看板の "x,y"
  sign: { x: number; y: number };
  tiles: { x: number; y: number }[];
  area: AreaId;
}

export interface MapNode {
  id: string; // "x,y"
  x: number;
  y: number;
  kind: NodeKind;
  area: AreaId; // 境界の場合は「壊すと開くエリア」
}

export interface Chest {
  id: string; // "x,y"
  x: number;
  y: number;
  area: AreaId;
  recipe: FurnitureId;
}

export interface World {
  width: number;
  height: number;
  ground: Ground[]; // index = y * width + x
  area: (AreaId | null)[]; // 水は null
  nodes: MapNode[];
  slots: Slot[];
  plots: Plot[];
  chests: Chest[];
  start: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// セーブデータ（localStorage に JSON で入る）

export interface NodeState {
  hp: number; // 残り体力
  destroyedAt: number | null; // 壊れた時刻。null なら立っている
}

export interface CropTile {
  crop: CropId;
  plantedAt: number;
}

export interface PlotState {
  selected: CropId | null; // 看板で選んだ作物（次に植えるときから反映）
  tiles: Record<string, CropTile>; // key = "x,y"。空きマスは入れない
}

export interface Buff {
  // M1 では料理が無いので使わないが、セーブ形式として先に持っておく
  id: string;
  until: number;
}

export interface SaveState {
  version: 1;
  player: { x: number; y: number; dir: Dir }; // マス単位の浮動小数（足元の中心）
  stamina: { value: number; updatedAt: number };
  xp: number; // 未使用の経験値
  totalXp: number;
  skills: Record<SkillId, number>;
  inventory: Partial<Record<ItemId, number>>;
  furniture: Record<FurnitureId, number>; // 持ち物の家具（置いていないもの）
  learnedRecipes: FurnitureId[]; // 宝箱などで覚えたもの（島レベルで覚えるものは含めない）
  nodes: Record<string, NodeState>; // 叩かれた・壊れた資源だけ入れる
  plots: Record<string, PlotState>;
  placements: Record<string, FurnitureId>; // slotId → 家具
  maxPoints: number; // 島ポイントの過去最大
  chestsOpened: string[];
  seenIntro: boolean;
  buffs: Buff[];
}

// ---------------------------------------------------------------------------
// 行動の結果。描画・効果音・トーストは events を見て出す。

export type GameEvent =
  | { type: 'hit'; x: number; y: number; kind: NodeKind; damage: number }
  | { type: 'broke'; x: number; y: number; kind: NodeKind; drops: Partial<Record<ItemId, number>> }
  | { type: 'areaOpened'; area: AreaId }
  | { type: 'planted'; tiles: { x: number; y: number }[] }
  | { type: 'harvested'; tiles: { x: number; y: number }[]; crop: CropId; amount: number }
  | { type: 'chest'; x: number; y: number; recipe: FurnitureId }
  | { type: 'xp'; amount: number }
  | { type: 'islandLevelUp'; level: number }
  | { type: 'crafted'; furniture: FurnitureId }
  | { type: 'placed'; slot: string; furniture: FurnitureId | null }
  | { type: 'skill'; skill: SkillId; level: number };

export type Fail =
  | 'noStamina'
  | 'needSkill' // 対象を壊すスキルが無い
  | 'cooldown'
  | 'noCrop' // 看板で作物を選んでいない
  | 'notReady'
  | 'notEnoughItems'
  | 'notLearned'
  | 'levelCap' // 島レベルの上限
  | 'maxLevel'
  | 'noXp'
  | 'wrongAttr';

export type Result =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: Fail; detail?: string };

/** プレイヤーの近くにある「タップで実行できる対象」。 */
export type Target =
  | { kind: 'node'; x: number; y: number; node: MapNode }
  | { kind: 'farm'; x: number; y: number; plot: Plot; action: 'plant' | 'harvest' }
  | { kind: 'sign'; x: number; y: number; plot: Plot }
  | { kind: 'chest'; x: number; y: number; chest: Chest };
