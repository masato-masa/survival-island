// Kenney の CC0 素材パックを refs/kenney/ にダウンロードして展開する。
// refs/ は gitignore 済み（配布物を持たない）。既に展開済みならスキップする。
//
// Windows では unzip が無いことがあるので、tar（Windows 10+ 標準搭載）で展開する。

import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'refs', 'kenney');

const PACKS = [
  {
    name: 'kenney_tiny-town',
    url: 'https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip',
    // 展開後にこのファイルがあれば済んでいるとみなす
    check: 'Tilemap/tilemap_packed.png',
  },
  {
    name: 'kenney_roguelike-rpg-pack',
    url: 'https://kenney.nl/media/pages/assets/roguelike-rpg-pack/12c03cd78b-1677697420/kenney_roguelike-rpg-pack.zip',
    check: 'Spritesheet/roguelikeSheet_transparent.png',
  },
  {
    name: 'kenney_roguelike-characters',
    url: 'https://kenney.nl/media/pages/assets/roguelike-characters/53ffff4133-1729196490/kenney_roguelike-characters.zip',
    check: 'Spritesheet/roguelikeChar_transparent.png',
  },
];

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dest, buf);
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // tar は Windows 10 1803+ / macOS / Linux のいずれにも入っている。
  execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const pack of PACKS) {
    const packDir = path.join(OUT_DIR, pack.name);
    const checkFile = path.join(packDir, pack.check);
    if (existsSync(checkFile)) {
      console.log(`[skip] ${pack.name} は既にある`);
      continue;
    }

    const zipPath = path.join(OUT_DIR, `${pack.name}.zip`);
    if (!existsSync(zipPath)) {
      console.log(`[fetch] ${pack.name} をダウンロード中…`);
      await download(pack.url, zipPath);
    }

    console.log(`[unzip] ${pack.name} を展開中…`);
    extractZip(zipPath, packDir);

    if (!existsSync(checkFile)) {
      throw new Error(`${pack.name} の展開後に ${pack.check} が見つからない。zip の中身を確認して。`);
    }
  }

  console.log('すべての素材パックが refs/kenney/ にそろっています。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
