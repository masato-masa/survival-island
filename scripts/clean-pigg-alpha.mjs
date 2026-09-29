// pigg 素材（src/assets/pigg/*.png）の縁にある薄い半透明のにじみ（背景抜きの残り）を消す。
// alpha が LOW 未満のピクセルは完全に透明にする。何度走らせても結果は同じ。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = new URL('../src/assets/pigg/', import.meta.url);
const LOW = 56;

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.png')) continue;
  const file = path.join(DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1'), f);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let cleared = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0 && data[i] < LOW) {
      data[i] = 0;
      cleared++;
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file + '.tmp');
  fs.renameSync(file + '.tmp', file);
  console.log(f, 'cleared', cleared);
}
