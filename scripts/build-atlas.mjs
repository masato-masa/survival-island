// KENNEY_MAP（scripts/kenney-map.mjs）を読んで、必要なタイルを refs/kenney/ から
// 切り出し、1 枚のアトラス画像 + 座標 JSON にまとめる常設スクリプト。
// `npm run atlas` で実行する。素材が無ければ fetch-kenney.mjs のヒントを出して落ちる。
//
// 出力は 16px ソース単位の座標（2 倍等の拡大は描画側 sprites.ts が担当）。
// 名前順に並べるだけの決定的な単純行パッキングなので、毎回同じ画像が出る。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { KENNEY_MAP } from './kenney-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// このリポジトリは sharp を devDependencies に持つ（npm i -D sharp 済み）。
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const SHEETS = {
  R: {
    file: path.join(ROOT, 'refs/kenney/kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png'),
    step: 17, // 16px タイル + 1px 隙間
    hint: 'npm run atlas より先に `node scripts/fetch-kenney.mjs` を実行して kenney_roguelike-rpg-pack を用意して。',
  },
  T: {
    file: path.join(ROOT, 'refs/kenney/kenney_tiny-town/Tilemap/tilemap_packed.png'),
    step: 16, // 隙間なし
    hint: 'npm run atlas より先に `node scripts/fetch-kenney.mjs` を実行して kenney_tiny-town を用意して。',
  },
};

const OUT_PNG = path.join(ROOT, 'src/assets/kenney-atlas.png');
const OUT_JSON = path.join(ROOT, 'src/assets/kenney-atlas.json');

function checkSources() {
  for (const [key, sheet] of Object.entries(SHEETS)) {
    if (!existsSync(sheet.file)) {
      throw new Error(`素材が見つからない: ${sheet.file}\n${sheet.hint}`);
    }
  }
}

async function extractTile(sheetKey, c, r) {
  const sheet = SHEETS[sheetKey];
  if (!sheet) throw new Error(`未知のシート指定: ${sheetKey}`);
  const left = c * sheet.step;
  const top = r * sheet.step;
  return sharp(sheet.file).extract({ left, top, width: 16, height: 16 }).png().toBuffer();
}

async function main() {
  checkSources();
  mkdirSync(path.dirname(OUT_PNG), { recursive: true });

  const names = Object.keys(KENNEY_MAP).sort(); // 決定的な順序
  const atlas = {}; // name -> {x,y,w,h}
  const comps = [];

  // 単純な行パッキング: 1 行に固定本数、名前ごとに高さは 16×積み枚数。
  const COLS = 8;
  const CELL_W = 16;
  let maxRowHeightForRow = 0;
  let cursorX = 0;
  let cursorY = 0;
  let colInRow = 0;

  for (const name of names) {
    const parts = KENNEY_MAP[name];
    const h = 16 * parts.length;

    if (colInRow >= COLS) {
      cursorX = 0;
      cursorY += maxRowHeightForRow;
      colInRow = 0;
      maxRowHeightForRow = 0;
    }

    const x = cursorX;
    const y = cursorY;

    let yoff = 0;
    for (const [sheetKey, c, r] of parts) {
      const buf = await extractTile(sheetKey, c, r);
      comps.push({ input: buf, left: x, top: y + yoff });
      yoff += 16;
    }

    atlas[name] = { x, y, w: 16, h };

    cursorX += CELL_W;
    colInRow += 1;
    maxRowHeightForRow = Math.max(maxRowHeightForRow, h);
  }

  const width = COLS * CELL_W;
  const height = cursorY + maxRowHeightForRow;

  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toFile(OUT_PNG);

  writeFileSync(OUT_JSON, JSON.stringify(atlas, null, 2) + '\n');

  console.log(`アトラス書き出し: ${OUT_PNG} (${width}x${height})`);
  console.log(`座標 JSON: ${OUT_JSON} (${names.length} 個)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
