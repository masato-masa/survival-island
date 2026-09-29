# むじんとうスローライフ（survival-island）

元の仕様書（ドラフト v0.2、Unity/iOS 想定）を **Web で試作** している。
操作感とゲームバランスをここで詰め、固まってから Unity へ移す前提。

- 設計: `docs/spec-m1.md`（M1 = 核のループ）。数値は `src/game/data.ts`、型は `src/game/types.ts`。
- 公開: https://masato-masa.github.io/survival-island/ （`npm run deploy` で gh-pages へ）
- **共通 UI（shared-ui）は使わない。** 画面全体がフィールドで、HUD を上に浮かせる独自の構成（ユーザー指定）。
  ホーム画面・戻るボタンは無い。スキルは島の「謎の遺跡」、クラフトは「作業台」に触れて開く。

## 守ること

- **視点は斜め（遠近法）。** `camera.ts` の `TILT_DEG`・`CAMERA_DISTANCE`。地面は横線ごとの帯で奥ほど細く貼り、立つ物は足元に立てて `k` 倍で描く。
  マスの見た目は台形、背の高い物が後ろのマスを隠す。`worldToScreen` は `{x,y,k}`、`screenToWorld` はその逆。
- **森の木は資源（`forestTree`）。** 最高段階の斧（axePower 5）でだけ切れる。フィールドに岩は置かない（洞窟を追加するまで、石・銅の入手元は無い）。
  水辺は砂浜（`terrainCore.ts` の `classify`）。

- **1 マス = 物体 2 個ぶんの大きさ**（参考画像くらいに物体を大きく見せるため）。マップは `scripts/build-map.mjs` が細かい 64×70 で設計し、
  2×2 ごとに 1 文字へまとめて 32×35 で書き出す。ランドマークは 2×2 マス。人は物体ほど大きくしない（`sprites.ts` の `worldH`）。

- `src/game/` は純粋な TS。React・DOM・Canvas を import しない。時刻は必ず `now` を引数で受ける
  （`Date.now()` を呼んでよいのは `store.ts` だけ）。開発者メニューの「時間を進める」がこれで成立する。
- 実時間の処理（スタミナ回復・作物・資源の復活）はタイマーで回さず、**保存時刻からの経過で計算**する。
- スプライトは名前で引く（`getSprite('tree')`）。素材を差し替えるときは `src/render/sprites.ts` の中身だけを変える。
- 数値を変えたら `npm test` の進行テスト（全エリア開放・島レベル 3 到達までの時間）を見て、テンポを確かめる。

## 素材

絵柄は **pigg 風（やわらかい着色イラスト）**。ドット絵・Kenney・旧 ChatGPT ドット絵は 1 つも残していない。
出どころは 2 つだけ:

1. ユーザー提供の素材シート `src/assets/refimg/`（木・岩・家具・花）と `src/assets/pigg/`（主人公・宝箱・岩）。
   シートからの切り出しは `scripts/slice-refimg.mjs`。切り出し後の後処理は次の 3 本（どれも何度走らせても同じ結果）:
   `scripts/strip-tree-shadows.mjs`（木の焼き込み影を消す）、`scripts/clean-checker.mjs`（家具の市松模様の抜き残りを消す）、
   `scripts/clean-pigg-alpha.mjs`（pigg 素材の薄い半透明のにじみを消す）。
   **`slice-refimg.mjs` を走らせ直したら上の 3 本も走らせる**（`furn_flower_bed` は手で切り詰めてあるので、
   再切り出しで戻ってしまう。`git checkout` で戻すこと）。
   ChatGPT で生成した絵（`pigg_ship` `pigg_tower` `pigg_arch`）は、ダウンロードしたものを
   `node scripts/import-generated.mjs <入力> <出力>` で透過・トリミングして `src/assets/pigg/` に入れる（元画像は `refs/`）。
2. `src/render/sprites.ts` の `PAINTERS` に書いたコード描画のベクター絵（作物・アイテム・道具・エフェクト・看板・
   道タイルなど、提供素材に無いもの）。

地面は画像を使わず `src/render/terrainCore.ts` が色を計算する（重いので `terrainWorker.ts` = Web Worker で焼き、
使えない環境ではメインスレッドで区切って焼く）。草の葉先・花・小石は `forestTrees.ts` の `buildGroundDecor` が
見た目だけの物体として散らす。

- スプライトは名前で引く（`getSprite('tree')`）。対応表は `sprites.ts` の `SHEET_TARGET`（サイズはワールド px 幅）。
- 足りない絵は `PAINTERS` に描くか、素材シートに足して `SHEET_TARGET` に載せる。ChatGPT で作る場合も、
  スクリプトで切り出して `src/assets/refimg/` に入れる流れに乗せる。
- 確認用に `sprites.html`（`npm run dev` 中に `/survival-island/sprites.html`）で全スプライトを一覧できる。
