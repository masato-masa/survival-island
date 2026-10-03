# むじんとうスローライフ（survival-island）

元の仕様書（ドラフト v0.2、Unity/iOS 想定）を **Web で試作** している。
操作感とゲームバランスをここで詰め、固まってから Unity へ移す前提。

- 設計: `docs/spec-m1.md`（M1 = 核のループ）。数値は `src/game/data.ts`、型は `src/game/types.ts`。
- 公開: https://masato-masa.github.io/survival-island/ （`npm run deploy` で gh-pages へ）
- **共通 UI（shared-ui）は使わない。** 画面全体がフィールドで、HUD を上に浮かせる独自の構成（ユーザー指定）。
  ホーム画面・戻るボタンは無い。スキルは島の「謎の遺跡」、クラフトは「作業台」に触れて開く。

## 守ること

- **家具はどの種類でも、歩ける全マスに自由に置ける**（配置スペースと属性の制限は廃止）。ランドマークだけ 2×2。
  `rules.ts` の `isBuildable` / `canPlaceAt` / `placementAt`。セーブの `placements` は `"x,y"`（左上）→ 家具。
- **木は切ると幹（切り株）になり、幹を切ると消える。** 木は 1 本も復活しない。幹を消すと苗木が出て、模様替えでマスを選んで植え直す（`save.planted`）。跡地には家具を置ける。
- **フィールドの物はすべて「採取できる物」か「動かせる家具」。** 花も資源（`flower`、3 回摘むと消えて花びら・種を落とす）。作業台・たき火・遺跡のアーチ・古い柱は最初から置いてある家具。固定なのは遺跡・看板/畑・宝箱・桟橋・船だけ。
- **行動は約 3 秒（ピグ風）。** `store.actOnTarget()` で始まり `store.update()`（毎フレーム）で終わる。その間は動けない。手に入れた物は地面にアイコンで落ち、3 秒後に主人公へ吸い込まれる（見た目だけ。持ち物には終わった時点で入る）。
- **主人公はアメーバピグ風で、コードで描く**（`src/render/avatar.ts` の `drawAvatar`）。木・花・苗木も `plantArt.ts` のベクター絵。
- **砂浜に木・花を置かない、海に睡蓮を置かない。** 地面の飾りは草の上の葉先と水辺の葦だけ。

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
2. `src/render/sprites.ts` の `PAINTERS` に書いたコード描画のベクター絵（主人公・木・花・作物・アイテム・道具・エフェクト・看板・
   道タイルなど、提供素材に無いもの）。

地面は画像を使わず `src/render/terrainCore.ts` が色を計算する（重いので `terrainWorker.ts` = Web Worker で焼き、
使えない環境ではメインスレッドで区切って焼く）。草の葉先・葦は `forestTrees.ts` の `buildGroundDecor` が
見た目だけの物体として散らす。

- スプライトは名前で引く（`getSprite('tree')`）。対応表は `sprites.ts` の `SHEET_TARGET`（サイズはワールド px 幅）。
- 足りない絵は `PAINTERS` に描くか、素材シートに足して `SHEET_TARGET` に載せる。ChatGPT で作る場合も、
  スクリプトで切り出して `src/assets/refimg/` に入れる流れに乗せる。
- 確認用に `sprites.html`（`npm run dev` 中に `/survival-island/sprites.html`）で全スプライトを一覧できる。

## 効果音

**全アプリ共通の「WebAudio で合成・ファイルを持たない」の例外**（ユーザー指定）。ElevenLabs の Sound Effects API で生成した
短い mp3 を `src/assets/sfx/` に置き、`src/ui/sound.ts` が AudioBuffer に読み込んで WebAudio で鳴らす
（頭の無音を切り、ピークをそろえ、鳴らすたびに音程・音量を少しゆらす）。無い音は合成音で代わりに鳴らす。

- 生成: `node scripts/gen-sfx.mjs`（API キーは環境変数 `ELEVENLABS_API_KEY`。指示文の一覧はスクリプト内の `SFX`）。
  候補は `refs/sfx/`（git 管理外）に 3 本ずつ。未採用の音は候補 1 が仮に入る。
- 聴き比べ: `npm run dev` 中に `/survival-island/sfx.html`。採用は `node scripts/gen-sfx.mjs --pick chop=2`。
