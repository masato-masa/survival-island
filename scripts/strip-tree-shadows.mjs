// 木の素材（src/assets/refimg/tree_*.png・furn_palm_tree.png）に焼き込まれている、右下に伸びる
// 灰色の影を消す。影はレンダラーが足元にやわらかく描くので、素材側の硬い影は要らない。
// 影の画素は「彩度が低く（灰色）、暗い」。葉は緑・幹は茶色で彩度が高いので区別できる。
// 何度走らせても結果は同じ（消えた画素は alpha 0 になり、対象から外れる）。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = new URL('../src/assets/refimg/', import.meta.url);
const base = DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const targets = fs.readdirSync(DIR).filter((f) => /^(tree_.*|furn_palm_tree)\.png$/.test(f));

for (const f of targets) {
  const file = path.join(base, f);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 20 && mx < 135) {
      data[i + 3] = 0;
      cleared++;
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file + '.tmp');
  fs.renameSync(file + '.tmp', file);
  console.log(f, 'cleared', cleared);
}
