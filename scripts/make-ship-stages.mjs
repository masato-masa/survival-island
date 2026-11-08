// 商船の修理の段階絵（SI-14）。pigg_ship.png（完成した船）から、段階ごとの絵を作る。
//   0 壊れた船: 帆・旗・帆柱の上半分が無く、灰色がかって暗い
//   1 船体を直した: 色が戻る（帆柱は低いまま）
//   2 帆柱を立てた: 帆柱と横木が全部立つ（帆はまだ無い）
//   3 下の帆を張った   4 上の帆を張った   5（完成。旗つき）は元の pigg_ship.png そのまま
// 使い方: node scripts/make-ship-stages.mjs   （何度走らせても同じ結果）
import sharp from 'sharp';

const SRC = 'src/assets/pigg/pigg_ship.png';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = (x, y) => (y * w + x) * 4;

// 旗: 赤い画素（左上の旗）
const isRed = (r, g, b, x, y) => y < 150 && x > 430 && r > 150 && g < 110 && b < 110;
// 帆: 明るくて彩度が低い画素（布）。帆のある範囲（左の斜め線より上）だけ。船体の明るい板を拾わない
const isSail = (r, g, b, x, y) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx >= 185 && mx - mn <= 66 && b >= 135 && x > 110 && x < 650 && y < 700 + (x - 130) * 0.3 + 10 && y < 860;
};

const sail = new Uint8Array(w * h);
const flag = new Uint8Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = px(x, y);
    if (data[i + 3] < 40) continue;
    if (isRed(data[i], data[i + 1], data[i + 2], x, y)) flag[y * w + x] = 1;
    else if (isSail(data[i], data[i + 1], data[i + 2], x, y)) sail[y * w + x] = 1;
  }
}
// 帆のふち（縫い目・影）まで消えるよう、膨らませる
function dilate(m, r) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && dx * dx + dy * dy <= r * r) o[yy * w + xx] = 1;
        }
      }
    }
  }
  return o;
}
const sailD = dilate(sail, 7);
const flagD = dilate(flag, 6);

// 上の帆と下の帆の境目（y）。上の帆は y < SPLIT の帆、下の帆はそれ以外
const SPLIT = 440;
// 低い帆柱（壊れた船・船体だけ直した船）: この高さより上の帆柱・横木は無い
const STUB_Y = 640;

const mastX = (y) => 440 - 0.035 * y;
const MAST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <g stroke-linecap="round" stroke-linejoin="round">
    <line x1="${mastX(30)}" y1="30" x2="${mastX(900)}" y2="900" stroke="#6d3a17" stroke-width="50"/>
    <line x1="${mastX(30)}" y1="30" x2="${mastX(900)}" y2="900" stroke="#b66f33" stroke-width="38"/>
    <line x1="${mastX(30) + 10}" y1="30" x2="${mastX(900) + 10}" y2="900" stroke="#cf8b4a" stroke-width="10"/>
    <line x1="262" y1="150" x2="640" y2="268" stroke="#6d3a17" stroke-width="46"/>
    <line x1="262" y1="150" x2="640" y2="268" stroke="#b66f33" stroke-width="34"/>
    <line x1="168" y1="378" x2="640" y2="535" stroke="#6d3a17" stroke-width="46"/>
    <line x1="168" y1="378" x2="640" y2="535" stroke="#b66f33" stroke-width="34"/>
  </g></svg>`;

async function render(stage) {
  const out = Buffer.from(data);
  const base = Buffer.from(data);
  const dark = [118, 72, 36];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(x, y);
      const m = y * w + x;
      const cut = (y < 600 && x < 690) || (y < 640 && x < 600) || flagD[m];
      if (cut) {
        out[i + 3] = 0;
      } else if (sailD[m] && y < 752) {
        out[i + 3] = 0; // 帆に隠れていた上の部分は空けておく
      } else if (sailD[m]) {
        // 帆に隠れていた船のなかみは、暗い板で埋める
        out[i] = dark[0];
        out[i + 1] = dark[1];
        out[i + 2] = dark[2];
      }
      if (stage === 0 && out[i + 3] > 0) {
        const g = 0.3 * out[i] + 0.59 * out[i + 1] + 0.11 * out[i + 2];
        out[i] = Math.round((out[i] * 0.35 + g * 0.65) * 0.72);
        out[i + 1] = Math.round((out[i + 1] * 0.35 + g * 0.65) * 0.72);
        out[i + 2] = Math.round((out[i + 2] * 0.35 + g * 0.65) * 0.74);
      }
      void base;
    }
  }
  const layers = [];
  const img = (buf) => sharp(buf, { raw: { width: w, height: h, channels: 4 } });
  let canvas = await img(out).png().toBuffer();
  if (stage >= 2) layers.push({ input: Buffer.from(MAST_SVG) });
  // 帆: 元の絵から帆の画素だけを重ねる
  const sails = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = y * w + x;
      if (!sailD[m]) continue;
      if (y < SPLIT || (x > 470 && y < 530) ? stage < 4 : stage < 3) continue;
      const i = m * 4;
      sails[i] = data[i];
      sails[i + 1] = data[i + 1];
      sails[i + 2] = data[i + 2];
      sails[i + 3] = data[i + 3];
    }
  }
  if (stage >= 3) layers.push({ input: await img(sails).png().toBuffer() });
  if (layers.length) canvas = await sharp(canvas).composite(layers).png().toBuffer();
  return canvas;
}

// 帆柱を低くした船は、切り口が斜めのぎざぎざになるよう、STUB_Y の近くを少し削る
for (let s = 0; s <= 4; s++) {
  const buf = await render(s);
  await sharp(buf).resize({ width: 460 }).png({ compressionLevel: 9 }).toFile(`src/assets/pigg/pigg_ship${s}.png`);
}
console.log('ok', w, h);
