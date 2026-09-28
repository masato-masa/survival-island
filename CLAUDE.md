# むじんとうスローライフ（survival-island）

元の仕様書（ドラフト v0.2、Unity/iOS 想定）を **Web で試作** している。
操作感とゲームバランスをここで詰め、固まってから Unity へ移す前提。

- 設計: `docs/spec-m1.md`（M1 = 核のループ）。数値は `src/game/data.ts`、型は `src/game/types.ts`。
- 公開: https://masato-masa.github.io/survival-island/ （`npm run deploy` で gh-pages へ）
- **共通 UI（shared-ui）は使わない。** 画面全体がフィールドで、HUD を上に浮かせる独自の構成（ユーザー指定）。
  ホーム画面・戻るボタンは無い。スキルは島の「謎の遺跡」、クラフトは「作業台」に触れて開く。

## 守ること

- `src/game/` は純粋な TS。React・DOM・Canvas を import しない。時刻は必ず `now` を引数で受ける
  （`Date.now()` を呼んでよいのは `store.ts` だけ）。開発者メニューの「時間を進める」がこれで成立する。
- 実時間の処理（スタミナ回復・作物・資源の復活）はタイマーで回さず、**保存時刻からの経過で計算**する。
- スプライトは名前で引く（`getSprite('tree')`）。素材を差し替えるときは `src/render/sprites.ts` の中身だけを変える。
- 数値を変えたら `npm test` の進行テスト（全エリア開放・島レベル 3 到達までの時間）を見て、テンポを確かめる。

## 素材

Kenney の CC0 パック（16×16 を 2 倍で 32×32）。対応が無いものはコードで描いた仮素材にフォールバックする。

```bash
node scripts/fetch-kenney.mjs   # refs/kenney/ へ取得（refs/ は git 管理外）
npm run atlas                   # scripts/kenney-map.mjs の対応表から src/assets/kenney-atlas.* を作る
```

対応表を変えたら `npm run atlas` を必ず走らせる。ChatGPT で作る素材も同じ流れ（スクリプトで切り出す）に乗せる。
