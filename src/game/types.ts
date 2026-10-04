// ゲーム全体で使う型。描画にも React にも依存しない。
// 座標はすべて「マス」単位。1 マス = 32 ワールドピクセル（描画側の都合）。

export type ItemId =
  // 素材
  | 'wood'
  | 'stone'
  | 'copper'
  // 植物（植えられるもの・花から取れるもの）
  | 'sapling' // 苗木（切り株を切ると出る。植えると木になる）
  | 'flowerSeed' // 花の種（花を摘むと出る。植えると花になる）
  | 'petal' // 花びら（花を摘むと出る。花壇・花の鉢の素材）
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

/** 家具の種類（表示・分類用）。置ける場所の制限には使わない（どのマスにも自由に置ける）。 */
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

/** エリア。beach・woods・plaza・ruins は最初から入れる。forest・rocks・hill は境界を壊すと開く。 */
export type AreaId = 'beach' | 'woods' | 'plaza' | 'ruins' | 'forest' | 'rocks' | 'hill';

/** マップ上の資源（叩いて壊すもの）。 */
export type NodeKind =
  | 'tree' // 木
  | 'bigTree' // 太い木（axePower 1 以上）
  | 'rock' // 岩
  | 'hardRock' // 硬い岩（pickHard 1 以上）
  | 'borderTree' // 境界の大木（エリアごとに必要 Lv が違う）
  | 'borderRock' // 境界の大岩
  | 'forestTree' // 森の木（いちばん高い段階の斧でだけ切れる）
  | 'flower'; // 花（道具なしで摘める。FLOWER_GATHERS 回で消える）

export type Dir = 'up' | 'down' | 'left' | 'right';

// ---------------------------------------------------------------------------
// 静的データ（data.ts で定義）

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'material' | 'plant' | 'crop';
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
  /** 覚え方。島レベル到達で覚えるか、宝箱で覚えるか。none は作れない（島に最初から置いてあるだけの家具）。 */
  learn: { level: number } | { chest: string } | { none: true };
}

export type FurnitureId = string;

export interface NodeDef {
  kind: NodeKind;
  name: string;
  hp: number; // 叩くと減る。0 で壊れる
  drops: Partial<Record<ItemId, number>>;
  /** 壊してから復活するまで。null は復活しない（木・境界・花。木は苗木を植えて増やす）。 */
  respawnMs: number | null;
  /** gather は道具なし（花を摘む）。 */
  tool: 'axe' | 'pick' | 'gather';
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

/** 地面。forest は通れない深い森（描画は木々のかたまり）。dock は海の上の桟橋（歩ける）。
 *  dirt は土の道、paving は古い石畳、foundation は家の跡地の土台。 */
export type Ground = 'water' | 'grass' | 'sand' | 'soil' | 'dirt' | 'paving' | 'forest' | 'dock' | 'foundation';

/** 飾りの置物。叩けない。rubble だけは上を歩ける。ship は w×h を占める 1 つの物。
 *  （柱は家具 oldPillar になった。動かせる） */
export type DecorKind = 'rubble' | 'brokenStone' | 'ship';

export interface Decor {
  id: string; // 左上の "x,y"
  x: number;
  y: number;
  w: number;
  h: number;
  kind: DecorKind;
  solid: boolean;
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

/** 島に据え付けの設備（動かせない）。触れると画面が開く。
 *  ruins = スキル、housePlot = 家の跡地（今は説明だけ）、dock = 船着き場（今は説明だけ。交易は M2）。
 *  作業台は設備ではなく家具 woodWorkbench（最初から置いてあり、動かせる。触れるとクラフト）。 */
export type StationKind = 'ruins' | 'housePlot' | 'dock';

export interface Station {
  id: string; // "x,y"
  x: number;
  y: number;
  kind: StationKind;
  area: AreaId;
}

/** 島に最初から置いてある家具（新規セーブ・古いセーブの移行で placements に入る）。 */
export interface InitialFurniture {
  x: number;
  y: number;
  furniture: FurnitureId;
}

export interface World {
  width: number;
  height: number;
  ground: Ground[]; // index = y * width + x
  area: (AreaId | null)[]; // 水は null
  nodes: MapNode[];
  plots: Plot[];
  chests: Chest[];
  stations: Station[];
  decor: Decor[];
  /** 最初から置いてある家具（作業台・古い柱・たき火・遺跡のアーチ）。 */
  initialFurniture: InitialFurniture[];
  start: { x: number; y: number };
}

/** 地図の資源と、植えた木・花をまとめた「いまフィールドにある資源」（rules.ts の allNodes）。 */
export interface LiveNode extends MapNode {
  /** 植えたもの（id は "p:x,y"）。 */
  planted: boolean;
  /** 植えて育っている途中（固いが、叩けない）。 */
  growing: boolean;
  /** 育ち具合 0..1（地図の資源は常に 1）。 */
  growth: number;
}

// ---------------------------------------------------------------------------
// セーブデータ（localStorage に JSON で入る）

export interface NodeState {
  hp: number; // 残り体力
  destroyedAt: number | null; // 壊れた時刻。null なら立っている
  /** 木を切り倒して幹（切り株）になっている。幹を切ると木は消える。 */
  stump?: boolean;
}

export interface CropTile {
  crop: CropId;
  plantedAt: number;
}

export interface PlotState {
  selected: CropId | null; // 看板で選んだ作物（次に植えるときから反映）
  tiles: Record<string, CropTile>; // key = "x,y"。空きマスは入れない
}

/** 植えた苗木・花の種。key は "x,y"。消えたら（幹を切る・摘み切る）エントリごと消す。 */
export interface PlantedState {
  kind: 'tree' | 'flower';
  plantedAt: number;
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
  placements: Record<string, FurnitureId>; // "x,y"（家具の左上のマス）→ 家具
  maxPoints: number; // 島ポイントの過去最大
  chestsOpened: string[];
  seenIntro: boolean;
  buffs: Buff[];
  /** 植えた苗木・花の種（"x,y" → 状態）。資源としての体力などは nodes["p:x,y"] に入る。 */
  planted: Record<string, PlantedState>;
  /** 最初から置く家具（作業台・柱など）を placements に入れ終えたか。古いセーブに一度だけ入れるための印。 */
  seededV2: boolean;
  /** 作業台で作っている最中の家具。1 度に 1 つだけ（M1 では枠 1。ピグライフの作業台も 1 台 1 つずつ作る）。 */
  crafting: CraftJob | null;
}

/** 作業台のクラフト作業。終わった（now >= endsAt）あと、受け取るまで残る。 */
export interface CraftJob {
  furnitureId: FurnitureId;
  startedAt: number;
  endsAt: number;
}

// ---------------------------------------------------------------------------
// 時間のかかる行動（伐採・採取・畑）。始めてから約 3 秒後に結果が出る。その間プレイヤーは動けない。

export interface TimedAction {
  kind: 'chop' | 'gather' | 'farm';
  /** 対象のマス */
  x: number;
  y: number;
  nodeId?: string;
  nodeKind?: NodeKind;
  startedAt: number;
  endsAt: number;
}

// ---------------------------------------------------------------------------
// 行動の結果。描画・効果音・トーストは events を見て出す。

export type GameEvent =
  | { type: 'hit'; x: number; y: number; kind: NodeKind; damage: number }
  | { type: 'broke'; x: number; y: number; kind: NodeKind; drops: Partial<Record<ItemId, number>> }
  /** 花を摘んだ。remaining = あと何回摘めるか（0 なら消えた）。 */
  | { type: 'gathered'; x: number; y: number; kind: NodeKind; remaining: number }
  /** アイテムが出た（見た目だけ。持ち物にはこの時点で入っている）。x, y は出どころのマス。 */
  | { type: 'dropped'; x: number; y: number; items: Partial<Record<ItemId, number>> }
  /** 時間のかかる行動を始めた。 */
  | { type: 'actionStarted'; action: TimedAction }
  /** 苗木・花の種を植えた。 */
  | { type: 'sowed'; x: number; y: number; plant: 'tree' | 'flower' }
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
  | 'cannotPlace'
  | 'busy'; // 作業台がクラフト中

export type Result =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: Fail; detail?: string };

/** プレイヤーの近くにある「タップで実行できる対象」。 */
export type Target =
  | { kind: 'node'; x: number; y: number; node: LiveNode }
  | { kind: 'farm'; x: number; y: number; plot: Plot; action: 'plant' | 'harvest' }
  | { kind: 'sign'; x: number; y: number; plot: Plot }
  | { kind: 'chest'; x: number; y: number; chest: Chest }
  | { kind: 'station'; x: number; y: number; station: Station }
  /** 機能のある家具（作業台）。anchor は家具の左上マスの "x,y"。 */
  | { kind: 'furniture'; x: number; y: number; furnitureId: FurnitureId; anchor: string };
