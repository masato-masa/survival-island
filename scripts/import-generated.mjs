// ChatGPT で生成した画像（背景が市松模様の見本として焼き込まれている）を素材にする。
// 使い方: node scripts/import-generated.mjs <入力.png> <出力.png>
// 本物のアルファがあれば薄い光のにじみ（alpha < 110）を消す。アルファが無く市松模様が焼き込まれていれば、
// 画像の縁から辿れる「無彩色で明るい画素」を透明にし、縁の灰色を 2 回削る。最後に余白を切り詰める。
import sharp from 'sharp';

const [inp, out] = process.argv.slice(2);
const { data, info } = await sharp(inp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const isChecker = (i) => {
  const mx = Math.max(data[i], data[i + 1], data[i + 2]);
  const mn = Math.min(data[i], data[i + 1], data[i + 2]);
  return mx - mn < 14 && mn >= 176;
};
const hasRealAlpha = data[3] === 0;
const seen = new Uint8Array(w * h);
const q = [];
for (let x = 0; x < w; x++) for (const y of [0, h - 1]) q.push(y * w + x);
for (let y = 0; y < h; y++) for (const x of [0, w - 1]) q.push(y * w + x);
// 本物のアルファがある画像でも、輪の内側などに市松模様が不透明で残ることがあるので、透明画素も種にする
for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] === 0) q.push(p);
for (const p of q) seen[p] = 1;
for (let head = 0; head < q.length; head++) {
  const p = q[head];
  if (!isChecker(p * 4)) continue;
  data[p * 4 + 3] = 0;
  const x = p % w, y = (p / w) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const n = ny * w + nx;
    if (!seen[n]) { seen[n] = 1; q.push(n); }
  }
}
for (let i = 3; i < data.length; i += 4) if (data[i] < 110) data[i] = 0;
for (let iter = 0; iter < 2; iter++) {
  const kill = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] === 0 || !isChecker(i)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || data[(ny * w + nx) * 4 + 3] === 0) { kill.push(i); break; }
    }
  }
  for (const i of kill) data[i + 3] = 0;
}
await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toFile(out);
const m = await sharp(out).metadata();
console.log(out, m.width, m.height);
