# むじんとうスローライフ（survival-island）

元の仕様書（ドラフト v0.2、Unity/iOS 想定）を **Web で試作** している。
操作感とゲームバランスをここで詰め、固まってから Unity へ移す前提。

- 設計: `docs/spec-m1.md`（M1 = 核のループ）。数値は `src/game/data.ts`、型は `src/game/types.ts`。
- 公開: https://masato-masa.github.io/survival-island/ （`npm run deploy` で gh-pages へ）
- 共通 UI: `src/ui/shared/` は `C:\claude\shared-ui` からの生成物。直接編集しない。

## 守ること

- `src/game/` は純粋な TS。React・DOM・Canvas を import しない。時刻は必ず `now` を引数で受ける
  （`Date.now()` を呼んでよいのは `store.ts` だけ）。開発者メニューの「時間を進める」がこれで成立する。
- 実時間の処理（スタミナ回復・作物・資源の復活）はタイマーで回さず、**保存時刻からの経過で計算**する。
- スプライトは名前で引く（`getSprite('tree')`）。素材を差し替えるときは `src/render/sprites.ts` の中身だけを変える。
- 数値を変えたら `npm test` の進行テスト（全エリア開放・島レベル 3 到達までの時間）を見て、テンポを確かめる。

## 素材

M1 はコードで描いた仮のドット絵（16×16 を 2 倍で 32×32）。
差し替え候補は Kenney の CC0 パック（16×16）と ChatGPT での生成。ダウンロードはユーザーに確認してから。
