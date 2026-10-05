// ChatGPT で生成した素材シート（refs/gen/*.png、白い無地の背景に物体を格子状に並べたもの）を
// 1 枚ずつ切り出して src/assets/gen/<名前>.png に書き出す。何度走らせても同じ結果になる。
//
// 使い方: node scripts/slice-gen.mjs            （SHEETS の全部）
//         node scripts/slice-gen.mjs crops       （名前を指定したシートだけ）
//
// 手順:
//   1. 画像の縁から辿れる「白に近い画素」を背景として透明にする（輪郭の内側の白は残る）。
//   2. 背景に接する 3px の帯は「白からの色抜き」（color to alpha）で半透明にして、白いにじみを消す。
//   3. 不透明な画素を連結成分に分け、重心が入る格子のマスへ振り分ける（格子が少しずれていても切れる）。
//   4. マスごとに成分をまとめた外接矩形で切り出し、長辺を maxSize に縮めて保存する。
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

// names は行優先。null のマスは捨てる。maxSize は書き出しの長辺（px）、scale は全マス共通の縮小率（maxSize より優先）。
const SHEETS = {
  crops: {
    file: 'refs/gen/crops.png',
    cols: 4,
    rows: 3,
    scale: 0.8, // 土の山 ≈ 164px
    keepWhite: ['turnip1', 'turnip2', 'item_turnip'],
    names: ['turnip0', 'turnip1', 'turnip2', 'item_turnip', 'sunflower0', 'sunflower1', 'sunflower2', 'item_sunflower', 'tomato0', 'tomato1', 'tomato2', 'item_tomato'],
  },
  items: {
    file: 'refs/gen/items.png',
    cols: 3,
    rows: 2,
    maxSize: 256,
    names: ['item_wood', 'item_stone', 'item_copper', 'item_sapling', 'item_flowerSeed', 'item_petal'],
  },
  plants: {
    file: 'refs/gen/plants.png',
    cols: 5,
    rows: 2,
    maxSize: 256,
    names: ['flower0', 'flower1', 'flower2', 'flower3', 'flowerSprout', 'sapling', 'stump', 'stumpOak', 'stumpCedar', 'stumpAncient'],
  },
  trees: {
    file: 'refs/gen/trees.png',
    cols: 4,
    rows: 1,
    maxSize: 512,
    names: ['gen_tree', 'gen_bigTree', 'gen_cedarTree', 'gen_ancientTree'],
  },
  gates: {
    file: 'refs/gen/gates.png',
    cols: 3,
    rows: 1,
    maxSize: 512,
    names: ['gen_gateOak', 'gen_gateCedar', 'gen_ancientTree2'],
  },
};

const OUT_DIR = 'src/assets/gen';
const BG_MIN = 232; // これより明るく、彩度の低い画素を背景とみなす
const FRINGE = 3; // 背景に接する帯の幅（色抜きする範囲）

function isBg(d, i) {
  const mx = Math.max(d[i], d[i + 1], d[i + 2]);
  const mn = Math.min(d[i], d[i + 1], d[i + 2]);
  return mn >= BG_MIN && mx - mn < 18;
}

async function sliceSheet(key, sheet) {
  const { data, info } = await sharp(sheet.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;

  // 1. 縁からの塗りつぶしで背景を求める
  const bg = new Uint8Array(n);
  const q = new Int32Array(n);
  let qt = 0;
  const push = (p) => {
    if (bg[p] || !isBg(data, p * 4)) return;
    bg[p] = 1;
    q[qt++] = p;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  for (let head = 0; head < qt; head++) {
    const p = q[head];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }

  // 1b. 輪郭に囲まれた白い隙間（茎と葉のあいだなど）も背景にする。白い物（カブ）のマスは keepWhite で外す。
  const keep = new Set(sheet.keepWhite ?? []);
  const isHole = (i) => {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    return mn >= 244 && mx - mn < 10;
  };
  const seenHole = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (bg[s0] || seenHole[s0] || !isHole(s0 * 4)) continue;
    const comp = [s0];
    seenHole[s0] = 1;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k];
      const x = p % w;
      for (const m of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (m < 0 || m >= n || seenHole[m] || bg[m] || !isHole(m * 4)) continue;
        seenHole[m] = 1;
        comp.push(m);
      }
    }
    if (comp.length < 40) continue;
    const p0 = comp[0];
    const col = Math.min(sheet.cols - 1, Math.floor(((p0 % w) / w) * sheet.cols));
    const row = Math.min(sheet.rows - 1, Math.floor((((p0 / w) | 0) / h) * sheet.rows));
    if (keep.has(sheet.names[row * sheet.cols + col])) continue;
    for (const p of comp) bg[p] = 1;
  }

  // 2. 背景からの距離（4 近傍、FRINGE まで）
  const dist = new Uint8Array(n).fill(255);
  let frontier = [];
  for (let p = 0; p < n; p++) if (bg[p]) { dist[p] = 0; frontier.push(p); }
  for (let d = 1; d <= FRINGE; d++) {
    const next = [];
    for (const p of frontier) {
      const x = p % w;
      for (const m of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (m < 0 || m >= n || dist[m] !== 255) continue;
        dist[m] = d;
        next.push(m);
      }
    }
    frontier = next;
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; continue; }
    if (dist[p] > FRINGE) continue;
    // 白から色抜き: c = a*f + (1-a)*255 として、いちばん暗い成分が保てる最小の a を取る
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    const a = Math.min(1, (255 - mn) / (255 - 90));
    if (a < 0.08) { data[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - a) * 255) / a)));
    data[i + 3] = Math.round(a * 255);
  }

  // 3. 連結成分 → 格子のマスへ
  const label = new Int32Array(n).fill(-1);
  const cells = Array.from({ length: sheet.cols * sheet.rows }, () => ({ x0: w, y0: h, x1: -1, y1: -1, area: 0 }));
  const minArea = Math.max(30, Math.round(n * 0.00002));
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || data[s * 4 + 3] === 0) continue;
    let head = 0, tail = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    q[tail++] = s;
    label[s] = s;
    const members = [];
    while (head < tail) {
      const p = q[head++];
      members.push(p);
      const x = p % w, y = (p / w) | 0;
      sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const m of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (m < 0 || m >= n || label[m] !== -1 || data[m * 4 + 3] === 0) continue;
        label[m] = s;
        q[tail++] = m;
      }
    }
    if (members.length < minArea) {
      for (const p of members) data[p * 4 + 3] = 0; // 小さなごみは消す
      continue;
    }
    const cx = sx / members.length, cy = sy / members.length;
    const col = Math.min(sheet.cols - 1, Math.floor((cx / w) * sheet.cols));
    const row = Math.min(sheet.rows - 1, Math.floor((cy / h) * sheet.rows));
    const cell = cells[row * sheet.cols + col];
    cell.x0 = Math.min(cell.x0, x0); cell.y0 = Math.min(cell.y0, y0);
    cell.x1 = Math.max(cell.x1, x1); cell.y1 = Math.max(cell.y1, y1);
    cell.area += members.length;
    // マス番号を成分に覚えさせる（隣のマスにはみ出した成分を切り抜きに混ぜないため）
    for (const p of members) label[p] = -2 - (row * sheet.cols + col);
  }

  // 4. 書き出し
  mkdirSync(OUT_DIR, { recursive: true });
  for (let c = 0; c < cells.length; c++) {
    const name = sheet.names[c];
    const cell = cells[c];
    if (!name) continue;
    if (cell.x1 < 0) { console.warn(`${key}: ${name} のマスに何も無い`); continue; }
    const cw = cell.x1 - cell.x0 + 1, ch = cell.y1 - cell.y0 + 1;
    const buf = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = (cell.y0 + y) * w + cell.x0 + x;
      if (label[p] !== -2 - c) continue;
      data.copy(buf, (y * cw + x) * 4, p * 4, p * 4 + 4);
    }
    // scale を決めたシートは全マス同じ倍率（作物の成長段階・樹種の大きさの差を保つ）。無ければマスごとに長辺 maxSize へ。
    const scale = sheet.scale ?? Math.min(1, sheet.maxSize / Math.max(cw, ch));
    const out = `${OUT_DIR}/${name}.png`;
    await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } })
      .resize(Math.max(1, Math.round(cw * scale)), Math.max(1, Math.round(ch * scale)), { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(out, Math.round(cw * scale), Math.round(ch * scale));
  }
}

const only = process.argv.slice(2);
for (const [key, sheet] of Object.entries(SHEETS)) {
  if (only.length && !only.includes(key)) continue;
  try {
    await sliceSheet(key, sheet);
  } catch (e) {
    console.warn(`${key}: ${sheet.file} を読めない (${e.message})`);
  }
}
