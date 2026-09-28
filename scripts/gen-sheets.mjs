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
];
