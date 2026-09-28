// ChatGPT で作ったドット絵のシートを、ゲームで使える 1 枚ずつの PNG に切り出す。
//
//   node scripts/slice-gen.mjs            すべてのシート
//   node scripts/slice-gen.mjs trees      名前で 1 枚だけ
//
// 生成画像は「ドット絵ふう」の大きな絵で、1 ドットが 8px 前後の四角になっている。
// 手で切ると大きさも位置もばらつくので、ここで機械的に:
//   1. マゼンタ (#FF00FF) の背景を透明にする
//   2. 背景に落ちた影（暗いマゼンタ）は「半透明の黒」に置き換える（地面の色に馴染む）
//   3. 1 ドットの大きさと格子のずれを推定し、各ドットの中央付近の最頻色で 1px に縮める
//   4. つながった塊ごとに切り出し、左上から順に名前を付けて src/assets/gen/ に書く
//
// どのシートの何番目が何かは scripts/gen-sheets.mjs が決める（唯一の出どころ）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHEETS } from './gen-sheets.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'assets', 'gen');
mkdirSync(OUT, { recursive: true });

/** 背景（マゼンタ）か。生成画像は圧縮で色が揺れるので幅を持たせる。 */
const isBg = (r, g, b) => r > 190 && b > 190 && g < 90;
/** 背景に落ちた影（暗いマゼンタ）か。 */
const isShadow = (r, g, b) => r > 70 && b > 70 && g < 60 && Math.abs(r - b) < 60 && !isBg(r, g, b);

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** 横方向の「同じ色が続く長さ」から 1 ドットの大きさを推定する。 */
function estimateBlock(img) {
  const { data, w, h } = img;
  const hist = new Map();
  for (let y = 0; y < h; y += 3) {
    let run = 1;
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = i - 4;
      const same =
        Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) < 24;
      if (same) run++;
      else {
        if (run >= 3 && run <= 24) hist.set(run, (hist.get(run) ?? 0) + 1);
        run = 1;
      }
    }
  }
  // 長さ n の山は 2n・3n にも出るので、候補 b ごとに「b の倍数に近い長さ」の数で採点する
  let best = 8;
  let bestScore = -1;
  for (let b = 4; b <= 16; b += 0.25) {
    let score = 0;
    for (const [len, count] of hist) {
      const k = Math.round(len / b);
      if (k >= 1 && k <= 4 && Math.abs(len - k * b) <= 0.6) score += count * (k === 1 ? 1.5 : 1);
    }
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/** 格子のずれ（0..block）を、ブロック内の色のばらつきが最小になる位置で選ぶ。 */
function estimateOffset(img, block) {
  const { data, w, h } = img;
  let best = { ox: 0, oy: 0, cost: Infinity };
  const step = Math.max(1, Math.floor(block / 4));
  for (let oy = 0; oy < block; oy += step)
    for (let ox = 0; ox < block; ox += step) {
      let cost = 0;
      for (let by = oy; by + block <= h; by += block * 3)
        for (let bx = ox; bx + block <= w; bx += block * 3) {
          // ブロックの四隅と中央の差
          const pts = [
            [bx + 1, by + 1],
            [bx + block - 2, by + 1],
            [bx + 1, by + block - 2],
            [bx + block - 2, by + block - 2],
          ];
          const c = ((Math.floor(by + block / 2) * w + Math.floor(bx + block / 2)) * 4) | 0;
          for (const [px, py] of pts) {
            const i = ((Math.floor(py) * w + Math.floor(px)) * 4) | 0;
            cost += Math.abs(data[i] - data[c]) + Math.abs(data[i + 1] - data[c + 1]) + Math.abs(data[i + 2] - data[c + 2]);
          }
        }
      if (cost < best.cost) best = { ox, oy, cost };
    }
  return best;
}

/** 大きな絵 → 1 ドット 1px の小さな絵（RGBA）。 */
function downsample(img, block, ox, oy) {
  const { data, w, h } = img;
  const cols = Math.floor((w - ox) / block);
  const rows = Math.floor((h - oy) / block);
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      // ブロックの中央 60% だけを見る（縁は隣の色がにじんでいる）
      const x0 = Math.round(ox + cx * block + block * 0.2);
      const x1 = Math.round(ox + cx * block + block * 0.8);
      const y0 = Math.round(oy + cy * block + block * 0.2);
      const y1 = Math.round(oy + cy * block + block * 0.8);
      const counts = new Map();
      let bg = 0;
      let shadow = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          n++;
          if (isBg(r, g, b)) {
            bg++;
            continue;
          }
          if (isShadow(r, g, b)) {
            shadow++;
            continue;
          }
          // 近い色をまとめて数える（4 段階で丸める）
          const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          const e = counts.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
          e.n++;
          e.r += r;
          e.g += g;
          e.b += b;
          counts.set(k, e);
        }
      const o = (cy * cols + cx) * 4;
      const solid = n - bg - shadow;
      if (bg >= solid && bg >= shadow) continue; // 透明
      if (shadow > solid) {
        out[o + 3] = 90; // 影は半透明の黒
        continue;
      }
      let top = null;
      for (const e of counts.values()) if (!top || e.n > top.n) top = e;
      out[o] = Math.round(top.r / top.n);
      out[o + 1] = Math.round(top.g / top.n);
      out[o + 2] = Math.round(top.b / top.n);
      out[o + 3] = 255;
    }
  return { data: out, w: cols, h: rows };
}

/** 不透明な塊（影も含む）を 8 近傍でつなげて、外接矩形の一覧を返す（上から、左から）。 */
function components(small) {
  const { data, w, h } = small;
  const seen = new Uint8Array(w * h);
  const boxes = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || data[i * 4 + 3] === 0) continue;
      let x0 = x,
        x1 = x,
        y0 = y,
        y1 = y,
        count = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        const jx = j % w;
        const jy = (j - jx) / w;
        count++;
        x0 = Math.min(x0, jx);
        x1 = Math.max(x1, jx);
        y0 = Math.min(y0, jy);
        y1 = Math.max(y1, jy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx;
            const ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const k = ny * w + nx;
            if (!seen[k] && data[k * 4 + 3] !== 0) {
              seen[k] = 1;
              stack.push(k);
            }
          }
      }
      if (count >= 12) boxes.push({ x0, y0, x1, y1, count });
    }
  // 行ごとに並べる：下端（接地している高さ）が近いもの同士を同じ行とみなす。
  // 中心で比べると、同じ行でも背の高い物（ヒマワリ）と低い物（芽）で中心がずれて行が割れる。
  boxes.sort((a, b) => a.y1 - b.y1);
  const rowsOut = [];
  for (const b of boxes) {
    const cy = b.y1;
    const row = rowsOut.find((r) => Math.abs(r.cy - cy) < 12);
    if (row) row.items.push(b);
    else rowsOut.push({ cy, items: [b] });
  }
  return rowsOut.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
}

/** 小さな絵の一部を PNG に書く。 */
async function writeCrop(small, x0, y0, cw, ch, name) {
  const buf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= small.w || sy >= small.h) continue;
      const s = (sy * small.w + sx) * 4;
      const d = (y * cw + x) * 4;
      buf[d] = small.data[s];
      buf[d + 1] = small.data[s + 1];
      buf[d + 2] = small.data[s + 2];
      buf[d + 3] = small.data[s + 3];
    }
  await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(join(OUT, `${name}.png`));
}

/**
 * 格子に並んだコマ（歩きのアニメーションなど）。生成画像は升の中心に正確には置かれないので、
 * コマごとに「頭（上 40%）の左右中央」と「足元（最下段）」を基準点にして揃える。
 * 塊の外接矩形で切るだけだと、歩くたびに体が左右・上下にガタつく。
 */
async function sliceGrid(sheet, small) {
  const { cols, rows } = sheet.grid;
  const cellW = small.w / cols;
  const cellH = small.h / rows;
  const frames = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx0 = Math.floor(c * cellW);
      const cy0 = Math.floor(r * cellH);
      const cx1 = Math.floor((c + 1) * cellW);
      const cy1 = Math.floor((r + 1) * cellH);
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -1,
        y1 = -1;
      for (let y = cy0; y < cy1; y++)
        for (let x = cx0; x < cx1; x++) {
          if (small.data[(y * small.w + x) * 4 + 3] === 0) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      // 頭の左右中央（上 40% の不透明な画素の外接矩形の中央）
      const headBottom = y0 + Math.round((y1 - y0) * 0.4);
      let hx0 = Infinity,
        hx1 = -1;
      for (let y = y0; y <= headBottom; y++)
        for (let x = x0; x <= x1; x++) {
          if (small.data[(y * small.w + x) * 4 + 3] === 0) continue;
          hx0 = Math.min(hx0, x);
          hx1 = Math.max(hx1, x);
        }
      frames.push({ x0, y0, x1, y1, ax: Math.round((hx0 + hx1) / 2), ay: y1 });
    }
  // 基準点から見た左右・上の最大の張り出しで、全コマ共通の大きさを決める
  let left = 0,
    right = 0,
    up = 0;
  for (const f of frames) {
    left = Math.max(left, f.ax - f.x0);
    right = Math.max(right, f.x1 - f.ax);
    up = Math.max(up, f.ay - f.y0);
  }
  const cw = left + right + 1;
  const ch = up + 1;
  const manifest = {};
  for (let k = 0; k < frames.length; k++) {
    const name = sheet.names[k];
    if (!name) continue;
    const f = frames[k];
    await writeCrop(small, f.ax - left, f.ay - up, cw, ch, name);
    manifest[name] = { w: cw, h: ch };
  }
  console.log(`  ${sheet.names.length} コマ: ${cw}×${ch}`);
  return manifest;
}

/**
 * 地面のテクスチャ見本（正方形がマゼンタの隙間で並んでいる）。見本ごとに外接矩形を取り、
 * sheet.swatch × sheet.swatch ドットに、各セルの中央付近の平均色で取り直す。
 * 見本は 1 枚ごとに大きさがわずかに違うので、共通の block ではなく見本ごとの幅から割る。
 */
async function sliceSwatches(sheet, img) {
  const { data, w, h } = img;
  const N = sheet.swatch;
  // 背景でない画素の塊を、粗い格子（8px）で探す
  const G = 8;
  const gw = Math.floor(w / G);
  const gh = Math.floor(h / G);
  const solid = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = ((y * G + G / 2) * w + (x * G + G / 2)) * 4;
      solid[y * gw + x] = isBg(data[i], data[i + 1], data[i + 2]) ? 0 : 1;
    }
  const small = { data: new Uint8ClampedArray(gw * gh * 4), w: gw, h: gh };
  for (let k = 0; k < gw * gh; k++) small.data[k * 4 + 3] = solid[k] ? 255 : 0;
  const boxes = components(small);
  const manifest = {};
  for (let k = 0; k < sheet.names.length && k < boxes.length; k++) {
    const b = boxes[k];
    // 粗い格子の外接矩形を、元画像で 1px 単位に詰め直す（縁の半端なブロックを落とす）
    const x0 = b.x0 * G + G;
    const y0 = b.y0 * G + G;
    const x1 = (b.x1 + 1) * G - G;
    const y1 = (b.y1 + 1) * G - G;
    const cell = Math.min(x1 - x0, y1 - y0) / N;
    const buf = Buffer.alloc(N * N * 4);
    for (let cy = 0; cy < N; cy++)
      for (let cx = 0; cx < N; cx++) {
        let r = 0,
          g = 0,
          bl = 0,
          n = 0;
        for (let sy = 0.3; sy <= 0.7; sy += 0.2)
          for (let sx = 0.3; sx <= 0.7; sx += 0.2) {
            const px = Math.floor(x0 + (cx + sx) * cell);
            const py = Math.floor(y0 + (cy + sy) * cell);
            const i = (py * w + px) * 4;
            r += data[i];
            g += data[i + 1];
            bl += data[i + 2];
            n++;
          }
        const d = (cy * N + cx) * 4;
        buf[d] = Math.round(r / n);
        buf[d + 1] = Math.round(g / n);
        buf[d + 2] = Math.round(bl / n);
        buf[d + 3] = 255;
      }
    const name = sheet.names[k];
    await sharp(buf, { raw: { width: N, height: N, channels: 4 } }).png().toFile(join(OUT, `${name}.png`));
    manifest[name] = { w: N, h: N };
  }
  console.log(`${sheet.file}: 見本 ${boxes.length} 枚 → ${N}×${N}`);
  return manifest;
}

async function sliceSheet(sheet) {
  const img = await load(join(root, 'refs', 'gen', sheet.file));
  if (sheet.swatch) return sliceSwatches(sheet, img);
  const block = sheet.block ?? estimateBlock(img);
  const { ox, oy } = estimateOffset(img, block);
  const small = downsample(img, block, ox, oy);
  if (sheet.grid) {
    const m = await sliceGrid(sheet, small);
    console.log(`${sheet.file}: 1 ドット ≈ ${block}px, ずれ (${ox}, ${oy})`);
    return m;
  }
  const boxes = components(small);
  if (boxes.length !== sheet.names.length) {
    console.warn(
      `! ${sheet.file}: 塊が ${boxes.length} 個（名前は ${sheet.names.length} 個）。大きい順に名前を当てるので確認すること。`,
    );
  }
  // 塊の数が多すぎる（小さなゴミ）ときは、大きいものから名前の数だけ採る（並び順は保つ）
  const keep = [...boxes].sort((a, b) => b.count - a.count).slice(0, sheet.names.length);
  const ordered = boxes.filter((b) => keep.includes(b));
  const manifest = {};
  for (let k = 0; k < ordered.length; k++) {
    const name = sheet.names[k];
    if (!name) continue;
    const b = ordered[k];
    const cw = b.x1 - b.x0 + 1;
    const ch = b.y1 - b.y0 + 1;
    await writeCrop(small, b.x0, b.y0, cw, ch, name);
    manifest[name] = { w: cw, h: ch };
    console.log(`  ${name}: ${cw}×${ch}`);
  }
  console.log(`${sheet.file}: 1 ドット ≈ ${block}px, ずれ (${ox}, ${oy}), 塊 ${boxes.length}`);
  return manifest;
}

const only = process.argv[2];
const all = {};
for (const sheet of SHEETS) {
  if (only && sheet.id !== only) continue;
  Object.assign(all, await sliceSheet(sheet));
}
if (!only) writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(all, null, 2) + '\n');
