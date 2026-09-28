// Kenney 素材のどのタイルをどの名前に使うかの単一の定義（唯一の情報源）。
// build-atlas.mjs と（将来の）検証スクリプトの両方がここを読む。
//
// R = kenney_roguelike-rpg-pack のシート（16×16、1px の隙間あり。tile(c,r) は
//     x = c*17, y = r*17）
// T = kenney_tiny-town のタイルマップ（16×16、隙間なし。tile(c,r) は x=c*16, y=r*16）
//
// 値は [シート, 列, 行] のタプルの配列。複数指定すると上から順に縦積みして
// 16×(16×個数) のスプライトを作る（例: 高さ2の木）。
//
// 見た目は refs/verify-map.png 等で実際に確認済み。f_woodSign だけ、当初案の
// R(53,18) がダンジョン家具の「樽」だったため、屋外の矢印サインボード
// R(20,0) に変更した（signGrid の R(19,0) とは別デザインで区別が付く）。

export const KENNEY_MAP = {
  grass: [['R', 5, 0]],
  grass2: [['R', 5, 1]],
  sand: [['R', 8, 0]],
  water: [['R', 0, 0]],
  water2: [['R', 1, 0]],
  soil: [['R', 6, 0]],

  tree: [['R', 13, 10], ['R', 13, 11]],
  bigTree: [['R', 15, 10], ['R', 15, 11]],
  rock: [['R', 55, 21]],
  hardRock: [['R', 55, 19]],
  stump: [['R', 53, 19]],

  sign: [['R', 19, 0]],
  chest: [['R', 49, 18]],
  chestOpen: [['R', 49, 21]],

  turnip0: [['R', 22, 11]],
  sunflower0: [['R', 22, 11]],
  tomato0: [['R', 22, 11]],
  turnip1: [['R', 22, 10]],
  sunflower1: [['R', 22, 10]],
  tomato1: [['R', 22, 10]],
  sunflower2: [['R', 25, 10]],
  tomato2: [['R', 23, 10]],

  item_wood: [['T', 10, 8]],

  f_woodFence: [['R', 48, 23]],
  f_woodPath: [['R', 8, 2]],
  // 当初案の R(53,18) は「樽」だったため、屋外の矢印サインボードに変更。
  f_woodSign: [['R', 20, 0]],
  f_woodBench: [['R', 18, 4]],
  f_woodDesk: [['R', 21, 6]],
  f_woodWorkbench: [['R', 11, 4]],

  f_stonePath: [['R', 6, 2]],
  f_stoneBench: [['R', 23, 3]],
  f_stoneOven: [['R', 54, 10]],
  f_stoneLantern: [['R', 17, 8]],
  f_copperLamp: [['R', 21, 8]],

  f_flowerBed: [['R', 1, 6]],
  f_flowerPot: [['R', 32, 9]],
  f_fruitTable: [['R', 13, 6]],
  f_veggieStand: [['R', 15, 6]],

  tool_axe: [['T', 7, 10]],
  tool_pick: [['T', 7, 9]],
  tool_hoe: [['T', 9, 10]],
};

// KEEP CODE（コードのままにする名前。ここには登場しない）:
// shoreN/S/E/W, borderTree, borderRock, rubble, turnip2,
// item_stone, item_copper, item_turnip, item_sunflower, item_tomato,
// f_woodTower, f_stoneFence, f_flowerArch, f_stoneStatue,
// player_*, slot_*
