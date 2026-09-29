// 素材シートの背景が「市松模様の透過見本」だったせいで、家具の脚の間などに白・薄灰色の
// 四角い抜き残りが不透明のまま残っている。透明画素とつながった「無彩色で明るい画素」を
// 透明にする（つながりを辿るので、絵柄の内側にある白い部分は消えない）。
// 対象は furn_*（白い柵 furn_fence_white は素材自体が白なので除く）。何度走らせても同じ結果。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = new URL('../src/assets/refimg/', import.meta.url);
const base = DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['furn_fence_white.png']);
const targets = fs.readdirSync(DIR).filter((f) => /^furn_.*\.png$/.test(f) && !SKIP.has(f));

const isChecker = (d, i) => {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return d[i + 3] > 0 && mx - mn < 14 && mn >= 176;
};

for (const f of targets) {
  const file = path.join(base, f);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const queue = [];
  const seen = new Uint8Array(w * h);
  // 透明画素に隣り合う「チェッカー色」画素を種にする（画像の縁も透明扱い）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3] !== 0) continue;
      seen[p] = 1;
      queue.push(p);
    }
  }
  let cleared = 0;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (seen[q]) continue;
      if (!isChecker(data, q * 4)) continue;
      seen[q] = 1;
      data[q * 4 + 3] = 0;
      cleared++;
      queue.push(q);
    }
  }
  // 縁に残る半端な灰色（アンチエイリアスの混色）を 2 回だけ削る
  for (let iter = 0; iter < 2; iter++) {
    const kill = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] === 0) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn >= 22 || mn < 150) continue;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || data[(ny * w + nx) * 4 + 3] === 0) edge = true;
        }
        if (edge) kill.push(i);
      }
    }
    for (const i of kill) {
      data[i + 3] = 0;
      cleared++;
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file + '.tmp');
  fs.renameSync(file + '.tmp', file);
  console.log(f, 'cleared', cleared);
}
