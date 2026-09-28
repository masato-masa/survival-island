// Pigg Island 風の試作素材を切り出す（使い捨てスクリプト。スパイク用）。
// マゼンタ背景をアルファへ変換し、縁の色にじみ（マゼンタの映り込み）を除去してから
// 中身の外接矩形で切り出す。滑らかな絵なので、いつもの slice-gen.mjs（ドット絵用）とは別処理。
//
//   node scripts/slice-pigg-spike.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'assets', 'pigg');
mkdirSync(OUT, { recursive: true });

const KEY = [255, 0, 255];
const THRESHOLD = 140; // この色距離までは「マゼンタ寄り」として透明にしていく

async function dechroma(file) {
  const { data, info } = await sharp(join(root, 'refs', 'gen', 'pigg', file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const dist = Math.sqrt((r - KEY[0]) ** 2 + (g - KEY[1]) ** 2 + (b - KEY[2]) ** 2);
    const alpha = Math.max(0, Math.min(255, Math.round((dist / THRESHOLD) * 255)));
    data[o + 3] = alpha;
    if (alpha > 0 && alpha < 255) {
      // 色の脱汚染: 半透明の縁に残ったマゼンタ成分を引き、不透明だった場合の元色を推定する
      const a = alpha / 255;
      data[o] = Math.max(0, Math.min(255, Math.round((r - (1 - a) * KEY[0]) / a)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round((g - (1 - a) * KEY[1]) / a)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round((b - (1 - a) * KEY[2]) / a)));
    }
  }
  return { data, w, h };
}

/** 不透明な塊を 8 近傍でつなげて外接矩形の一覧を返す（左から順）。 */
function components(img) {
  const { data, w, h } = img;
  const seen = new Uint8Array(w * h);
  const boxes = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || data[i * 4 + 3] < 20) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        const jx = j % w;
        const jy = (j - jx) / w;
        x0 = Math.min(x0, jx);
        x1 = Math.max(x1, jx);
        y0 = Math.min(y0, jy);
        y1 = Math.max(y1, jy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx, ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const k = ny * w + nx;
            if (!seen[k] && data[k * 4 + 3] >= 20) {
              seen[k] = 1;
              stack.push(k);
            }
          }
      }
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      // 細長い帯（圧縮ノイズなど）は物体ではないので弾く
      if (bw * bh >= 400 && bw >= 30 && bh >= 30) boxes.push({ x0, y0, x1, y1 });
    }
  boxes.sort((a, b) => a.x0 - b.x0);
  return boxes;
}

async function cropAndSave(img, box, name, pad = 6) {
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const cw = Math.min(img.w - x0, box.x1 - box.x0 + 1 + pad * 2);
  const ch = Math.min(img.h - y0, box.y1 - box.y0 + 1 + pad * 2);
  const buf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const s = ((y0 + y) * img.w + (x0 + x)) * 4;
      const d = (y * cw + x) * 4;
      buf[d] = img.data[s];
      buf[d + 1] = img.data[s + 1];
      buf[d + 2] = img.data[s + 2];
      buf[d + 3] = img.data[s + 3];
    }
  await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(join(OUT, `${name}.png`));
  console.log(`  ${name}: ${cw}×${ch}`);
}

// palm.png（1 枚目の試作）は透過縁ににじみが出ていたので使わない。
// palm-rock.png（マゼンタ背景でやり直したもの）だけを使う。
const img2 = await dechroma('palm-rock.png');
const boxes2 = components(img2);
console.log('palm-rock.png:', boxes2.length, '個', boxes2.map((b) => `${b.x1 - b.x0}x${b.y1 - b.y0}`));
const names2 = ['pigg_palm', 'pigg_rock'];
for (let i = 0; i < boxes2.length && i < names2.length; i++) await cropAndSave(img2, boxes2[i], names2[i]);

// 砂のテクスチャはマゼンタ無し。縮小してそのままコピーするだけ。
await sharp(join(root, 'refs', 'gen', 'pigg', 'sand.png')).resize(512, 512).png().toFile(join(OUT, 'pigg_sand.png'));
console.log('pigg_sand: 512×512');

writeFileSync(
  join(OUT, 'README.md'),
  '生成物。scripts/slice-pigg-spike.mjs で作った試作素材（スパイク用、使い捨て）。\n' +
    '出どころ: refs/gen/pigg/（git 管理外）。指示文は docs/art-prompts.md の「Pigg Island 風の試作」を参照。\n',
);
