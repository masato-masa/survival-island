# ChatGPT で作る素材の指示文

同じ会話の中で続けて頼むと、絵柄・1 ドットの大きさ・色がそろいやすい。
新しい会話で始めるときは、下の「最初の 1 枚」をそのまま送ってから続ける。

生成した画像は `refs/gen/` に置き、`scripts/gen-sheets.mjs` に名前を足して
`node scripts/slice-gen.mjs` で切り出す（マゼンタ背景 → 透明、影 → 半透明の黒）。

## 最初の 1 枚（木と岩）— `refs/gen/trees-rocks.png`

> Create a pixel art sprite sheet image for a top-down farming game in the style of Stardew Valley.
> Conditions: (1) True pixel art on a strict pixel grid, every art pixel is an exact square block of
> the same size, no anti-aliasing, no blur, no gradients, limited soft warm palette, dark (not black)
> outlines. (2) Background is a flat solid pure magenta #FF00FF everywhere, no shadows on the
> background, no border, no text, no labels. (3) Arrange 6 objects in a 3 columns x 2 rows grid with
> lots of empty magenta space between them, each fully inside its own cell, not touching others:
> top row: a big leafy oak tree (round lush canopy, visible trunk and roots, about 3 tiles wide and
> 4 tiles tall where a tile is 16 art pixels), a tall pine tree (same scale), a tropical palm tree
> with coconuts (same scale). Bottom row: a grey boulder rock with small highlights (1 tile), a darker
> hard rock with orange copper ore specks (1 tile), a tree stump (1 tile). (4) Light comes from the
> top-left, soft cast shadow drawn as a darker oval directly under each object only. (5) View is the
> classic 3/4 top-down RPG view.

## 遺跡 — `refs/gen/ruins.png`

> Perfect style. Now make another sheet in exactly the same style, scale, palette, light direction and
> magenta #FF00FF background (flat, no text, lots of empty space, objects not touching): ancient
> mysterious ruins set for the same game. 3 columns x 2 rows. Top row: (a) a mysterious ancient stone
> monolith / altar about 2 tiles wide and 3 tiles tall, weathered grey-green stone with moss and
> vines, carved with a softly glowing teal rune symbol, (b) an ancient stone column pillar, broken at
> the top, moss, 1 tile wide and 2.5 tiles tall, (c) a crumbled ruined stone archway fragment, 2 tiles
> wide 2 tiles tall. Bottom row: (d) a fallen broken square stone block with cracks and moss, 1 tile,
> (e) a small pile of rubble and pebbles, 1 tile, flat on the ground, (f) a wooden mooring post with
> coiled rope, 1 tile wide 1.5 tiles tall. Each object has only a small darker oval shadow directly
> under it.

## 船・作業台など — `refs/gen/ship-props.png`

> Great. Another sheet, exactly the same style, pixel scale, palette, light and flat magenta #FF00FF
> background, no text, objects well separated. Row 1 (big): (a) a wooden merchant sailing ship seen in
> the same 3/4 top-down view, moored and floating (draw only the ship, no water), about 7 tiles wide and
> 8 tiles tall, warm brown hull with a lighter deck, one mast with a furled cream sail, a small red
> pennant flag, crates and barrels on the deck, a lantern. Row 2 (small, each about 1-2 tiles):
> (b) a sturdy wooden crafting workbench with a saw, hammer and planks on top, 2 tiles wide 1.5 tiles
> tall, (c) a wooden farm signpost with a blank board, (d) a wooden treasure chest closed, (e) the same
> chest open with a glint of gold, (f) a campfire with stones around it.

## 主人公 — `refs/gen/player.png`

> Excellent. Now the player character sprite sheet, same style, same pixel scale, same palette, flat
> magenta #FF00FF background, no text. The character: a cheerful young castaway islander, chibi
> proportions like Stardew Valley farmers (about 1 tile wide and 2 tiles tall, big head), straw hat,
> short brown hair, white tank top with a small blue scarf, rolled-up brown shorts, barefoot sandals,
> dark outline. Layout: a strict grid of 4 rows x 3 columns, every cell the same size, generous magenta
> spacing, the character centred in each cell at exactly the same size and same feet position in every
> cell. Row 1: facing down (toward the viewer) - standing, walking step with left foot forward, walking
> step with right foot forward. Row 2: facing up (back view) - standing, left step, right step. Row 3:
> facing left (side view) - standing, step A, step B. Row 4: facing right (side view) - standing,
> step A, step B. Keep the character identical across all 12 frames except the pose. Small dark oval
> shadow under the feet.

## 地面のテクスチャ — `refs/gen/textures.png`（`swatch: 64` で 64×64 に取り直す）

> Wonderful. Now ground textures for the same game, same pixel scale and palette (Stardew Valley look).
> Make a sheet of 8 SQUARE seamless tileable texture swatches arranged 4 columns x 2 rows, each swatch
> exactly 64x64 art pixels, fully filled edge to edge (no outline, no border, no frame, no rounded
> corners, no drop shadow, no objects), separated by thin flat magenta #FF00FF gaps, no text. The
> texture must repeat seamlessly when tiled. Row 1: (1) lush green grass - mostly calm even green with
> subtle darker and lighter pixel clusters and a few tiny grass blade tufts, low contrast so it does not
> look busy, (2) the same grass with a few tiny white and yellow wildflowers, (3) packed brown dirt path
> with a few small pebbles, (4) warm light beach sand with subtle grain. Row 2: (5) darker wet sand near
> the sea, (6) old weathered stone paving - irregular flagstones of varied sizes with thin dark gaps, a
> little moss and grass in the cracks, (7) weathered wooden dock planks running horizontally with nail
> dots, (8) calm shallow turquoise sea water with small light ripple highlights.

## 家具 20 点 — `refs/gen/furniture.png`（block 7）

> Perfect. Now a furniture and decoration sheet for the island, same style, same pixel scale (1 tile =
> 16 art pixels), same palette, flat magenta #FF00FF background, no text, every object well separated
> with small oval shadow under it. Grid 5 columns x 4 rows, 1 object per cell, each about 1 tile unless
> noted. Row 1 (wooden series, warm brown wood): wooden fence segment, wooden plank path tile (flat on
> the ground), decorative log stump sign, wooden bench (2 tiles wide), wooden table. Row 2 (wooden &
> stone): wooden workbench table with tools, tall wooden lookout tower (1.5 tiles wide, 3 tiles tall),
> stone path tile (flat flagstones on the ground), low stone wall fence segment, stone bench (2 tiles
> wide). Row 3 (stone series): stone oven / cooking hearth with a small fire, stone lantern
> (Japanese-style toro, 1.5 tiles tall), copper lamp post with a warm light (1.5 tiles tall), ancient
> stone pillar decoration with moss (2 tiles tall), stone statue of a guardian (2 tiles tall). Row 4
> (garden series, flowers and fruit): flower bed border with red and yellow flowers, clay flower pot
> with blooming flowers, wooden table with a basket of fruit, small vegetable market stand with a cloth
> awning (2 tiles wide), wooden flower arch covered in roses (2 tiles wide 2.5 tiles tall).

生成された家具は指定より大きめ（1 マスの物が 1.5〜2 マス）。縮小するとドット絵が崩れるので
そのままの密度で使い、道の家具だけ地面テクスチャから 1 マスを切り取って使う。

## 作物・アイコン・演出 — `refs/gen/crops.png`（block 9）

> Great. Next sheet, same style, same pixel scale (1 tile = 16 art pixels), same palette, flat magenta
> #FF00FF background, no text, objects well separated. Grid 6 columns x 3 rows, each object at most 1
> tile (16x16 art pixels), drawn as it would sit in a tilled soil farm tile but WITHOUT the soil (plant
> only, no ground, no shadow). Row 1: turnip growth stages - (1) tiny seedling sprout, (2) young leafy
> plant, (3) ripe turnip with white-purple root visible and big leaves; then sunflower stages (4)
> sprout, (5) tall green stem with bud, (6) full bloom yellow sunflower (may be 1 tile wide, 2 tiles
> tall). Row 2: tomato stages (1) sprout, (2) bushy plant with small green tomatoes, (3) plant with ripe
> red tomatoes; then (4) a sparkle / glint effect star, (5) a small puff of dust cloud, (6) a small
> leaf particle. Row 3: inventory item icons, each 16x16 with dark outline, no shadow: (1) a chopped
> wood log, (2) a grey stone chunk, (3) a copper ore nugget, (4) a harvested turnip, (5) a sunflower
> head, (6) a red tomato.

## スパイク: Pigg Island 風（試作、texture/pigg/ 配下）

普段の Kenney/ChatGPT ドット絵パイプラインとは別の絵柄を試すためのもの。
マゼンタ背景 → `node scripts/slice-pigg-spike.mjs` で透過に変換（脱色にじみ処理つき）。

> Create a single object illustration in the art style of the mobile social game "Pigg Island" / Ameba
> Pigg: a soft, rounded, semi-flat cel-shaded 2.5D cartoon illustration (NOT pixel art, no visible pixel
> grid, smooth anti-aliased edges), warm saturated tropical colors, simple gradient shading with a clear
> soft drop shadow underneath, a subtle dark outline around the silhouette, gentle rim-light highlight on
> the top-left edges. [木の説明]... Background: flat solid pure magenta #FF00FF (2 回目以降。1 回目は
> transparent 指定で縁ににじみが出て失敗した)。

砂は `docs/art-prompts.md` の別プロンプトで、マゼンタ無しの敷き詰めテクスチャとして生成。

## 主人公（正面立ち）と宝箱 — `refs/gen/pigg/char-chest.png`

> Same soft cel-shaded Pigg-Island cartoon style as before, but two changes: ... (視点を上げる指示は不採用。斜め上からの角度はそのまま)
> Give me 2 separate objects with plenty of magenta gap between them: (1) a cheerful chibi castaway
> character, front-facing, big head small body proportions, straw hat, white tank top, small blue neck
> scarf, rolled-up brown shorts, bare feet, simple friendly smiling face, standing pose, full body
> visible, about the same scale as the palm tree relative to a real island (so noticeably smaller than
> the tree). (2) a simple wooden treasure chest, closed, brown wood with metal corner braces, small
> padlock, same style.

**視点についての決定:** 「もう少し上からの視点に」という指示を、真上に近い角度と誤解して
`terrain-angle.png` を作ったが、ユーザーの意図はアメーバピグと同じ斜め上からの角度を保つこと
だった（真上視点は不採用）。`palm-rock.png` や上記のキャラクター・宝箱、ユーザー提供の
`refs/image0〜4.png`（岩・家具・植物・木）はどれもこの角度で統一されている。**今後の生成は
すべてこの角度を維持する。**

## ユーザー提供の参考シート — `refs/image0.png`〜`image4.png`

ユーザーが用意した高品質な素材（出どころ不明、本人が用意したものとして扱う）。
背景は透過ではなく市松模様が焼き込まれているため、`scripts/slice-refimg.mjs` で
市松模様の位置ベースの色差分によりアルファに変換して切り出す（マゼンタキーではない）。

- image0: 岩・鉱石（大小の岩、鉱石、欠片、洞窟入口など）
- image1: 家具・小物（作業台、机、椅子、調理器具、柵など）
- image2: 花・植物（ラベル無し、装飾用）
- image3: 木（大中小・苗木のサイズ違い、4方向+上から見た図+切り株）
- image4: 地面タイル（アイソメ〈斜め45度〉投影。今のゲームは真上寄りの見下ろし格子なので
  そのままは使えない。逆アフィン変換で平面化を試みる、うまくいかなければ見送り）
