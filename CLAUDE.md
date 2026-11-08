# むじんとうスローライフ（survival-island）

元の仕様書（ドラフト v0.2、Unity/iOS 想定）を **Web で試作** している。
操作感とゲームバランスをここで詰め、固まってから Unity へ移す前提。

- 設計: `Obsidian:Projects/survival-island/spec-m1.md`（M1 = 核のループ）。数値は `src/game/data.ts`、型は `src/game/types.ts`。
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
- **家具・設備・宝箱・看板は、コードで作った立体モデルをカメラで投影して描く**（`src/render/models.ts`）。足元はマスにぴったり沿う
  （素材シートの家具は斜め上からの絵で、正面向きのカメラでは傾いて見えるので使わない）。アイコンも同じモデル（`paintModelIcon`）。
- **木の樹種 = 必要な斧の段階**（`plantArt.ts`・`data.ts` の `TREE_SPECIES`）。若木(0) → カシの木(1) → スギの大木(2) → 森の主(5)。
  段階が上がるほど大きく・古く・暗い見た目にして、アイコンなしで見分けられるようにする。
- **クラフトは時間がかかる**（島ポイント × 30 秒、`craftMs`）。作業は 1 つずつ、できあがりは作業台で受け取る（`save.crafting`）。
- 設定とあそびかたは、左上の顔アイコンのメニュー（`MenuSheet.tsx`）から開く。画面に ? や歯車のボタンは置かない。
- **砂浜に木・花を置かない、海に睡蓮を置かない。** 地面の飾りは草の上の葉先と水辺の葦だけ。

- **視点は斜め上から（ピグくらい）。** `camera.ts` の `ELEV_DEG`（55°）・`GROUND_DEPTH`（sin）・`HEIGHT_SCALE`（cos）・`CAMERA_DISTANCE`（40 マス＝ほぼ平行投影）。
  3D の点は `project3(x, y, z)`、地面は `worldToScreen`（z=0）、逆は `screenToWorld`。地面は横線ごとの帯で貼り、立てて描く絵は足元に元の縦横比で置く。
  マス目は縦横そろい（ピグは 45° のひし形だが未対応）。
- **画面は見ているだけで癒やされるように動かす**（`ambient.ts`）。木・花・作物・草は風でゆっくり揺れる（絵を帯に切って根元から曲げるので、どの絵にも効く）。
  雲の影・蝶・落ち葉・岸の波・光の呼吸。`window.__ambientOff = true` で止めて比べられる。

- **森の木は資源（`forestTree`）。** 最高段階の斧（axePower 5）でだけ切れる。水辺は砂浜（`terrainCore.ts` の `classify`）。
- **島のフィールドに岩は置かない。石・銅は洞窟で掘る**（SI-6）。洞窟は地図の下に足した 32×20 の区画（`world.regions`）で、
  歩いてはつながらない。北東の岩場の入口（`E`、Station `caveEntrance`）に触れると洞窟の出口（`x`）の前へ移り、出口に触れると戻る
  （`actions.travel`）。岩場が開けば入れる（`AREAS.cave.entry`）。中は岩 6・硬い岩 2・銅の鉱脈 3（`copperVein`）で、どれも時間で戻る。
  カメラは今いる区画の中だけを映し、区画の外は塗りつぶす（`WorldView.tsx`・`renderer.ts`）。入口・出口は奥の壁ぎわに置く
  （体の中心は足元より上なので、下にある物には手が届きにくい）。数を変えたら `npm test` の「洞窟測定」を見る。

- **1 マス = 物体 2 個ぶんの大きさ**（参考画像くらいに物体を大きく見せるため）。マップは `scripts/build-map.mjs` が細かい 64×70 で設計し、
  2×2 ごとに 1 文字へまとめて 32×35 で書き出す（その下に洞窟 32×20 を足すので、地図全体は 32×55）。ランドマークは 2×2 マス。人は物体ほど大きくしない（`sprites.ts` の `worldH`）。

- `src/game/` は純粋な TS。React・DOM・Canvas を import しない。時刻は必ず `now` を引数で受ける
  （`Date.now()` を呼んでよいのは `store.ts` だけ）。開発者メニューの「時間を進める」がこれで成立する。
- 実時間の処理（スタミナ回復・作物・資源の復活）はタイマーで回さず、**保存時刻からの経過で計算**する。
- スプライトは名前で引く（`getSprite('tree')`）。素材を差し替えるときは `src/render/sprites.ts` の中身だけを変える。
- 数値を変えたら `npm test` の進行テスト（全エリア開放・島レベル 3 到達までの時間）を見て、テンポを確かめる。

## 素材

絵柄は **pigg 風（やわらかい着色イラスト）**。ドット絵・Kenney・旧 ChatGPT ドット絵は 1 つも残していない。
**コードで描いた絵は画面の質を下げるので、基本は生成した素材を使う**（ユーザー指定）。出どころは 3 つ:

0. **ChatGPT で生成した素材シート**（いちばん優先）。ユーザーの ChatGPT（Chrome）で、既存の生成素材（`refs/gen/crops.png` など）を
   画風の見本として添付し、「真っ白 #FFFFFF の無地背景・格子状に間隔をあけて並べる・線/文字/影なし・正面やや上から」で
   描かせる。元画像は `refs/gen/<シート名>.png`（git 管理外）、切り出しは `node scripts/slice-gen.mjs [シート名]`
   （縁から辿れる白を抜き、縁 3px を白から色抜き、連結成分を格子のマスへ振り分けて `src/assets/gen/<名前>.png` に書く）。
   シートの格子と名前は `slice-gen.mjs` の `SHEETS`。`sprites.ts` の `GEN_TARGET` が `PAINTERS` より優先され、
   画像が無いときだけコード描画に戻る。大きさは `scale`（同じシートの絵の大小をそのまま保つ。作物）か `fit`（長辺。アイコン）で決める。
   生成済み: 作物 3 種 × 3 段階、作物・資源のアイテムアイコン 9 個。花 4 種・芽・苗木・幹 4 種（`plants` シート、2026-11-07）。
   木 4 樹種（若木・カシ・スギ・森の主、`trees` シート、2026-11-08）。扉つきの木（`gates`）はまだコード描画。Chrome の窓が裏に回っている（`visibilityState: hidden`）と、生成画像の読み込みも
   ダウンロードも止まるので、窓を前に出してから取り出す。

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

**全アプリ共通の「WebAudio で合成・ファイルを持たない」の例外**（ユーザー指定）。ElevenLabs の Web 版（Sound Effects）で
生成した音を `src/assets/sfx/*.wav` に置き、`src/ui/sound.ts` が AudioBuffer に読み込んで WebAudio で鳴らす
（鳴らすたびに音程・音量を少しゆらす）。無い音は合成音で代わりに鳴らす。

- 候補: `refs/sfx/<名前>_<番号>.ogg`（git 管理外、1 つの音に 4 本）。指示文は `scripts/build-sfx.mjs` の `PROMPTS`。
- 選定と整形: `node scripts/build-sfx.mjs`。長さと打音の数を測って自動で選び、無音を切ってピークをそろえ、32kHz の WAV にする。
  耳で選び直すときは `node scripts/build-sfx.mjs chop=3`（`scripts/sfx-picks.json` に残る。`collect=pop_1` のように代用も書ける）。
- 聴き比べ: `npm run dev` 中に `/survival-island/sfx.html`。

- **料理（SI-8）。** 作業台のクラフト画面の上に「ごはん」の欄。畑の作物（カブ・ヒマワリ・トマト）を使い、その場で食べてスタミナを戻す
  （`actions.cook`・`data.ts` の `MEALS`。経験値は入らない。満タンなら断る）。島レベルで解禁（カブのスープ Lv1・ヒマワリのクッキー Lv2・畑のサラダ Lv3）。
  回復は「植える 1 ＋ 収穫 1」の消費の 1.2〜2.5 倍に収める（`__tests__/cooking.test.ts`）。作物は家具の材料とも取り合いになる。
- URL に `?mute` を付けると音を止める（確認用。保存された設定は変えない）。
- **釣り（SI-9）。** 桟橋の係留柱（船着き場）に触れると釣りの画面（`FishingSheet.tsx`）。浮きが左右に動き、中央で「つる！」。1 回 1 スタミナ（島の経験値も入る）。
  中央の狭いところ（perfect）だと半々で大物、広い緑（good）ならさかな、外れは逃げられる（`actions.fish`・`fishQuality`）。魚は「ごはん」の焼き魚（さかな 2）・魚のごった煮（大物 + カブ）になる。
  収支は `__tests__/cooking.test.ts`（魚 1 匹 = 1÷0.65 スタミナ、大物 = 5）。魚の絵は ChatGPT 製（`refs/gen/fish.png` → `slice-gen.mjs fish`。元画像は game-assets）。
- **島のおねがい（SI-11・12）と毎日のおねがい（SI-13）。** 固定の 5 件（`REQUESTS`）は順番に。終えたあとは日付（日本時間 0 時切替、`daily.ts` の `dailyDay`）から
  3 件（小 2 + 大 1。大は効き目 2 つ要求）が決まる（`DAILY_SMALL`/`DAILY_BIG`）。同じ作業が効き目の合うおねがい全部に数えられる。
  ごほうびは作業スタミナの 3〜9 割（`__tests__/requests.test.ts` が全部の型を測る）。数を変えたらそのテストを見る。
- **商船の修理（SI-14）。** 桟橋の隣の商船（`decor` の `ship`）に触れる（`world.ts` が左の列に Station `ship` を足す）と `ShipSheet`。
  5 段階（`SHIP_STAGES`・`ship.ts`）の素材を納めると船の絵が変わり（`pigg_ship0〜4.png` は `scripts/make-ship-stages.mjs` が `pigg_ship.png` から作る。5 = 旗つきの元絵）、
  直した段階ぶんのお届けが毎日 1 回受け取れる（`save.ship = { stage, giftDay }`、日付は `dailyDay`）。島レベル 3〜5 で順に取りかかれる。
  素材は木材・石・銅・花びら・作物・魚（他の遊びと取り合う）。全部で約 270 スタミナ（力もちなら約 185）、お届けは 1 日 17 相当で回収 16 日。`__tests__/ship.test.ts` が測る。
- URL に `?dev` を付けると公開版でも `window.__store` が出る（確認用）。

