// ChatGPT で作ったシートと、その中の物の名前（左上から右へ、上の行から）。
// 元画像は refs/gen/ に置く（git 管理外）。切り出し結果は src/assets/gen/ に入り、そちらはコミットする。
//
// 生成に使った指示文は docs/art-prompts.md に残す（同じ絵柄で描き足すため）。
//
// block は「元画像の何 px が 1 ドットか」。生成画像は格子が完全には揃っていないので
// 自動推定は外れることがある。ブロックの中心色で塗り直したときの誤差が
// 局所的に小さくなる値を測って決め、ここに書く（trees 7.5、ruins 8）。

export const SHEETS = [
  {
    id: 'trees',
    file: 'trees-rocks.png',
    block: 7.5,
    names: ['gen_oak', 'gen_pine', 'gen_palm', 'gen_rock', 'gen_hardRock', 'gen_stump'],
  },
  {
    id: 'ruins',
    file: 'ruins.png',
    block: 8,
    names: ['gen_monolith', 'gen_pillar', 'gen_arch', 'gen_brokenStone', 'gen_rubble', 'gen_mooring'],
  },
  {
    id: 'ship',
    file: 'ship-props.png',
    block: 7,
    names: ['gen_ship', 'gen_workbench', 'gen_sign', 'gen_chest', 'gen_chestOpen', 'gen_campfire'],
  },
  {
    // 主人公。4 行（下・上・左・右）× 3 列（立ち・一歩目・二歩目）の升目。
    id: 'player',
    file: 'player.png',
    block: 7,
    grid: { cols: 3, rows: 4 },
    names: [
      'gen_player_down0', 'gen_player_down1', 'gen_player_down2',
      'gen_player_up0', 'gen_player_up1', 'gen_player_up2',
      'gen_player_left0', 'gen_player_left1', 'gen_player_left2',
      'gen_player_right0', 'gen_player_right1', 'gen_player_right2',
    ],
  },
  {
    // 地面のテクスチャ見本（64×64 ドット、繰り返して敷く）。
    id: 'textures',
    file: 'textures.png',
    swatch: 64,
    names: ['tex_grass', 'tex_grassFlowers', 'tex_dirt', 'tex_sand', 'tex_wetSand', 'tex_paving', 'tex_dock', 'tex_water'],
  },
  {
    // 家具。f_<家具 id> の絵として使う（名前は gen_f_<家具 id>）。
    id: 'furniture',
    file: 'furniture.png',
    block: 7,
    names: [
      'gen_f_woodFence', 'gen_f_woodPath', 'gen_f_woodSign', 'gen_f_woodBench', 'gen_f_woodDesk',
      'gen_f_woodWorkbench', 'gen_f_woodTower', 'gen_f_stonePath', 'gen_f_stoneFence', 'gen_f_stoneBench',
      'gen_f_stoneOven', 'gen_f_stoneLantern', 'gen_f_copperLamp', 'gen_f_ruinPillar', 'gen_f_stoneStatue',
      'gen_f_flowerBed', 'gen_f_flowerPot', 'gen_f_fruitTable', 'gen_f_veggieStand', 'gen_f_flowerArch',
    ],
  },
  {
    // 作物の成長段階・演出・アイテムのアイコン。上から左→右の順。
    // きらめきは星が 2 つに分かれて塊が 1 つ多くなる（小さい方は大きい順で落ちる）。
    id: 'crops',
    file: 'crops.png',
    block: 9,
    names: [
      'gen_turnip0', 'gen_turnip1', 'gen_turnip2', 'gen_sunflower0', 'gen_sunflower1', 'gen_sunflower2',
      'gen_tomato0', 'gen_tomato1', 'gen_tomato2', 'gen_fx_sparkle', 'gen_fx_dust', 'gen_fx_leaf',
      'gen_item_wood', 'gen_item_stone', 'gen_item_copper', 'gen_item_turnip', 'gen_item_sunflower', 'gen_item_tomato',
    ],
  },
];
