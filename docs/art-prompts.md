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
