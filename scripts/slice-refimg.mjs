// refs/image0..4.png（ユーザー提供の参考画像シート）を個別スプライトへ切り出す常設スクリプト。
//
// 背景は一見チェッカー柄の透過に見えるが、sharp のメタデータで確認すると実際は
// hasAlpha:false（本物の透明度ではない）。市松模様がそのままピクセルとして
// 焼き込まれているだけなので、マゼンタキーのような単純な色抜きは使えない。
//
// アルゴリズム:
//   1. 背景だけの行（全幅が薄いグレー系）を探し、そこから市松の 2 色（A/B）と
//      マス目の一辺のサイズを推定する。
//   2. 位相（チェッカーの原点ズレ）を小さい範囲で総当たりし、実際の背景行に
//      一番合う ox / oy を選ぶ（「その座標なら本来何色のはずか」を位置から計算できる
//      ようにするため）。
//   3. 各ピクセルについて「その位置なら市松模様として何色のはずか」を計算し、
//      実際の色との距離が小さければ背景とみなす。さらに A-B を結ぶ線分上に
//      乗っている色（市松の境界がぼけてできる中間グレー）も背景寄りとして拾う。
//   4. 画像端から 4 近傍 BFS で「背景色に見えるピクセル」をたどり、実際に外周と
//      つながっている領域だけを透明にする（位置ベースの判定だけだと白い花びらの
//      ような真っ白な絵柄を誤って抜いてしまうことがあるため、"外側とつながっているか"
//      で最終判定する＝連結性チェック）。
//   5. 残った不透明の塊を 8 近傍连结成分でグルーピングし、ラベル（濃い角丸の
//      日本語キャプション帯）らしき横長で低い塊は除外して、アイテムだけを
//      個別 PNG として書き出す。
//
// image3（木）だけは背景が単色のフラットなグレーなので、市松検出はせず
// 単純な色距離キーを使う。
//
//   node scripts/slice-refimg.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(root, 'refs');
const OUT = join(root, 'src', 'assets', 'refimg');
mkdirSync(OUT, { recursive: true });

// ---------- 共通ユーティリティ ----------

async function loadRaw(file) {
  const { data, info } = await sharp(join(SRC_DIR, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function isGrayish([r, g, b], minV = 215, maxDelta = 6) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx - mn <= maxDelta && mx >= minV;
}

function px(img, x, y) {
  const o = (y * img.w + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** チェッカー柄の 2 色・マスサイズ・位相を推定する。 */
function detectChecker(img) {
  const { w, h } = img;
  // 全幅がグレー系な行を探す（アイコンの隙間＝純粋な背景の帯）
  const bgRows = [];
  for (let y = 0; y < h; y++) {
    let ok = true;
    for (let x = 0; x < w; x += 5) {
      if (!isGrayish(px(img, x, y))) {
        ok = false;
        break;
      }
    }
    if (ok) bgRows.push(y);
  }
  if (bgRows.length === 0) throw new Error('pure background row not found');
  const row0 = bgRows[0];

  // row0 の値から明色 A・暗色 B をクラスタリング（中間値で二分）
  const vals = [];
  for (let x = 0; x < w; x++) vals.push(px(img, x, row0)[0]);
  const mid = (Math.max(...vals) + Math.min(...vals)) / 2;
  const hi = vals.filter((v) => v >= mid);
  const lo = vals.filter((v) => v < mid);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const A = [avg(hi), avg(hi), avg(hi)];
  const B = [avg(lo), avg(lo), avg(lo)];

  // マスサイズ推定: row0 で「A 側に十分近い」連続run の長さの最頻値を使う
  const closeToA = vals.map((v) => Math.abs(v - A[0]) < Math.abs(v - B[0]));
  const runs = [];
  let runLen = 1;
  for (let x = 1; x < vals.length; x++) {
    if (closeToA[x] === closeToA[x - 1]) runLen++;
    else {
      runs.push(runLen);
      runLen = 1;
    }
  }
  runs.push(runLen);
  const longRuns = runs.filter((r) => r >= 6 && r <= 40);
  const counts = new Map();
  for (const r of longRuns) counts.set(r, (counts.get(r) || 0) + 1);
  let S = 14;
  let bestCount = 0;
  for (const [r, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      S = r;
    }
  }

  // x 位相を総当たりで fit
  const expectA = (x, y, ox, oy) => (Math.floor((x + ox) / S) + Math.floor((y + oy) / S)) % 2 === 0;
  let bestOx = 0;
  let bestErr = Infinity;
  for (let ox = 0; ox < S; ox++) {
    let err = 0;
    for (let x = 0; x < vals.length; x++) {
      const exp = expectA(x, row0, ox, 0) ? A[0] : B[0];
      err += Math.abs(vals[x] - exp);
    }
    if (err < bestErr) {
      bestErr = err;
      bestOx = ox;
    }
  }

  // y 位相を、見つかった全ての純背景行を使って総当たり fit
  let bestOy = 0;
  bestErr = Infinity;
  for (let oy = 0; oy < S; oy++) {
    let err = 0;
    for (const y of bgRows) {
      for (let x = 0; x < w; x += 9) {
        const exp = expectA(x, y, bestOx, oy) ? A[0] : B[0];
        err += Math.abs(px(img, x, y)[0] - exp);
      }
    }
    if (err < bestErr) {
      bestErr = err;
      bestOy = oy;
    }
  }

  return { A, B, S, ox: bestOx, oy: bestOy };
}

/** 市松モデルを使って背景っぽさを判定する alpha マスクを作る（0=背景候補, 255=絵柄）。 */
function keyChecker(img, model) {
  const { w, h } = img;
  const { A, B, S, ox, oy } = model;
  const TOL = 16; // 期待色からの許容距離
  const LINE_TOL = 10; // A-B を結ぶ線分からの垂直距離の許容量（境界のにじみ対策）
  const alpha = new Uint8Array(w * h);
  const AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const abLen2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2 || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px(img, x, y);
      const isA = (Math.floor((x + ox) / S) + Math.floor((y + oy) / S)) % 2 === 0;
      const expected = isA ? A : B;
      const other = isA ? B : A;
      const dExp = colorDist(c, expected);
      const dOther = colorDist(c, other);
      // A-B 線分への射影 t と垂線距離（中間グレーのにじみを拾う）
      const v = [c[0] - A[0], c[1] - A[1], c[2] - A[2]];
      const t = (v[0] * AB[0] + v[1] * AB[1] + v[2] * AB[2]) / abLen2;
      const proj = [A[0] + AB[0] * t, A[1] + AB[1] * t, A[2] + AB[2] * t];
      const perpDist = colorDist(c, proj);
      const onLine = t > -0.25 && t < 1.25 && perpDist < LINE_TOL;
      const bg = dExp < TOL || dOther < TOL || onLine;
      alpha[y * w + x] = bg ? 0 : 255;
    }
  }
  return alpha;
}

/**
 * keyChecker が出した「背景候補」マスクの連結成分ごとに、本当に背景かどうかを
 * 構造で判定する（0=背景, 255=絵柄）。
 *
 * - 画像の外周とつながっている成分は、そのまま背景（シート全体の地）として扱う。
 * - 外周とつながっていない孤立した成分（物体に囲まれた「穴」）は、
 *   実際に A 色・B 色の両方がある程度の割合で混ざっているか（＝本物の市松模様が
 *   続いているか）を確認する。丸太ベンチの隙間やデッキチェアの網目はここを通る。
 *   一方、白い花びらのような真っ白な絵柄の一部がたまたま A 色に近いだけの場合は
 *   B 色がほとんど含まれないので、ここで「絵柄」に差し戻される。
 */
function classifyChecker(mask, img, model, minArea = 20) {
  const { w, h } = img;
  const { A, B, S } = model;
  const TOL = 16;
  const smallHoleMax = S * S * 2.5; // 市松 2〜3 マス分。これ以下なら単色でも「穴」として信頼する
  const visited = new Uint8Array(w * h);
  const finalAlpha = new Uint8Array(w * h).fill(255);
  for (let start = 0; start < w * h; start++) {
    if (visited[start] || mask[start] !== 0) continue;
    const stack = [start];
    visited[start] = 1;
    const members = [start];
    let touchesBorder = false;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      const nbrs = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of nbrs) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!visited[j] && mask[j] === 0) {
          visited[j] = 1;
          stack.push(j);
          members.push(j);
        }
      }
    }
    if (members.length < minArea) continue; // 小さすぎるノイズは絵柄として残す
    let isBg = touchesBorder;
    if (!isBg) {
      let countA = 0, countB = 0;
      for (const i of members) {
        const x = i % w, y = (i - x) / w;
        const c = px(img, x, y);
        if (colorDist(c, A) < TOL) countA++;
        else if (colorDist(c, B) < TOL) countB++;
      }
      // 本物の市松模様なら（マス目をまたぐ大きさなら）A・B が両方ある程度出るはず
      // （縁のアンチエイリアスで両方とも厳密な TOL から外れがちなので、しきい値は緩め）
      isBg = countA >= members.length * 0.12 && countB >= members.length * 0.12;
    }
    if (isBg) for (const i of members) finalAlpha[i] = 0;
  }
  return finalAlpha;
}

/** 単色フラット背景（image3）向けの簡易キー。 */
function keyFlat(img, bgColor, tol = 22) {
  const { w, h } = img;
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = colorDist(px(img, x, y), bgColor);
      alpha[y * w + x] = d < tol ? 0 : 255;
    }
  return alpha;
}

/**
 * 「背景っぽいマスク」(0=背景候補) を 4 近傍の連結成分にまとめ、
 * ある程度の面積（minArea）を持つ塊だけを実際に透明化する。
 *
 * 外周とつながっている大きな背景領域はもちろん、丸太ベンチの隙間や
 * デッキチェアの網目のように物体の輪郭に囲まれて孤立した「穴」も、
 * 同じ市松モデルで検証済みの本物の背景色である以上は透明にしたい
 * （逆に、白い花びらの内側などにできるごく小さな誤検出の点は
 * minArea 未満のノイズとして無視し、絵柄を守る）。
 */
function componentizeBackground(alphaMask, w, h, minArea = 20) {
  const visited = new Uint8Array(w * h);
  const finalAlpha = new Uint8Array(w * h).fill(255);
  for (let start = 0; start < w * h; start++) {
    if (visited[start] || alphaMask[start] !== 0) continue;
    const stack = [start];
    visited[start] = 1;
    const members = [start];
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      const nbrs = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of nbrs) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!visited[j] && alphaMask[j] === 0) {
          visited[j] = 1;
          stack.push(j);
          members.push(j);
        }
      }
    }
    if (members.length >= minArea) {
      for (const i of members) finalAlpha[i] = 0;
    }
  }
  return finalAlpha;
}

/** 8 近傍連結成分の外接矩形を左上→右へ、行ごとにまとめて返す。 */
function components(alpha, w, h, minArea = 250, minSide = 18) {
  const seen = new Uint8Array(w * h);
  const boxes = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || alpha[i] < 40) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y;
      const stack = [i];
      seen[i] = 1;
      let area = 0;
      while (stack.length) {
        const j = stack.pop();
        area++;
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
            if (!seen[k] && alpha[k] >= 40) {
              seen[k] = 1;
              stack.push(k);
            }
          }
      }
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      if (bw * bh >= minArea && bw >= minSide && bh >= minSide) boxes.push({ x0, y0, x1, y1, bw, bh, area });
    }
  return boxes;
}

/**
 * 穴あきキー処理（丸太ベンチの脚の間など）によって 1 つの物体が複数の
 * 破片に分かれてしまうことがあるので、近接する箱同士を併合する。
 * ラベル帯との間隔（通常もっと広い）まで飲み込まないよう、隙間は小さめに取る。
 */
function mergeNearbyBoxes(boxes, gap = 30, fragmentMaxArea = 6000) {
  let list = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        // 通常サイズのアイコン同士（どちらも十分大きい）は絶対に融合しない。
        // ここで拾いたいのは「本体から千切れた小さな破片」だけ。
        if (a.area > fragmentMaxArea && b.area > fragmentMaxArea) continue;
        // キャプション帯そのものは絶対にアイコン側へ吸収しない
        if (isLabelBox(a) || isLabelBox(b)) continue;
        const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1); // 正なら離れている
        const gapY = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
        const overlapYamount = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const overlapXamount = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const minH = Math.min(a.bh, b.bh);
        const minW = Math.min(a.bw, b.bw);
        // 横方向にほぼ並んでいて（縦の重なりが大きい）、隙間が小さいときだけ融合する
        // ＝同じ物体が穴でわずかに分断されたケースだけを拾い、別のアイコン同士は融合しない
        const nearHoriz = gapX <= gap && overlapYamount >= minH * 0.3;
        const nearVert = gapY <= gap && overlapXamount >= minW * 0.3;
        if (nearHoriz || nearVert) {
          const nx0 = Math.min(a.x0, b.x0);
          const ny0 = Math.min(a.y0, b.y0);
          const nx1 = Math.max(a.x1, b.x1);
          const ny1 = Math.max(a.y1, b.y1);
          list.splice(j, 1);
          list.splice(i, 1);
          list.push({ x0: nx0, y0: ny0, x1: nx1, y1: ny1, bw: nx1 - nx0 + 1, bh: ny1 - ny0 + 1, area: a.area + b.area });
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/** 日本語キャプション帯（横長で低い、濃い単色の塊）らしきものを除外する。 */
function isLabelBox(b) {
  const aspect = b.bw / b.bh;
  const fillRatio = b.area / (b.bw * b.bh);
  // 短い1文字ラベル（「大」など）は縦横比が小さめになるので、しきい値は控えめに。
  return b.bh <= 55 && aspect >= 1.3 && fillRatio > 0.75;
}

/**
 * アイコンと下のキャプション帯がすき間なく接触して 1 つの連結成分に
 * なってしまった場合（例: 花壇の花がラベルの角丸ボックスに触れている）に、
 * 箱の下端から上へ走査して「濃い単色・高い充填率」の帯を見つけ、
 * その分だけ箱を上に縮める。見つからなければ何もしない。
 * 通常サイズのアイコン（コール鉱石など、単に濃い色をした物体）を
 * 誤って削らないよう、明らかに縦長すぎる箱にだけ適用する。
 */
function trimMergedLabel(img, alpha, box) {
  const { w } = img;
  const bandMaxHeight = 60;
  let cut = -1;
  for (let dy = 0; dy < bandMaxHeight && box.y1 - dy > box.y0; dy++) {
    const y = box.y1 - dy;
    let opaque = 0;
    let sum = [0, 0, 0];
    let sumSq = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      const i = y * w + x;
      if (alpha[i] < 40) continue;
      opaque++;
      const c = px(img, x, y);
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
      sumSq += c[0] * c[0];
    }
    const total = box.x1 - box.x0 + 1;
    const fillRatio = opaque / total;
    if (opaque === 0) continue;
    const meanR = sum[0] / opaque;
    const variance = sumSq / opaque - meanR * meanR;
    const meanBrightness = (sum[0] + sum[1] + sum[2]) / (3 * opaque);
    const isLabelRow = fillRatio > 0.8 && variance < 60 && meanBrightness < 110;
    if (isLabelRow) cut = dy;
    else if (cut >= 0) break; // ラベル帯を通り過ぎて絵柄に戻った
  }
  if (cut >= 14) {
    // 見つかったラベル帯を実際に透明化し、箱の下端を縮める
    for (let y = box.y1 - cut; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) alpha[y * w + x] = 0;
    return { ...box, y1: box.y1 - cut - 1, bh: box.y1 - cut - 1 - box.y0 + 1 };
  }
  return box;
}

/** 行ごとにグルーピングして読み順（上→下・左→右）に並べる。 */
function sortReadingOrder(boxes) {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const b of sorted) {
    let row = rows.find((r) => Math.abs(r.y - b.y0) < b.bh * 0.6);
    if (!row) {
      row = { y: b.y0, items: [] };
      rows.push(row);
    }
    row.items.push(b);
  }
  rows.sort((a, b) => a.y - b.y);
  const out = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x0 - b.x0);
    out.push(...row.items);
  }
  return out;
}

async function cropAndSave(img, alpha, box, name, pad = 6) {
  const { w, h } = img;
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const cw = Math.min(w - x0, box.x1 - box.x0 + 1 + pad * 2);
  const ch = Math.min(h - y0, box.y1 - box.y0 + 1 + pad * 2);
  const buf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      const s = (sy * w + sx) * 4;
      const d = (y * cw + x) * 4;
      const a = alpha[sy * w + sx];
      buf[d] = img.data[s];
      buf[d + 1] = img.data[s + 1];
      buf[d + 2] = img.data[s + 2];
      buf[d + 3] = a;
    }
  await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(join(OUT, `${name}.png`));
  return { w: cw, h: ch };
}

// ---------- シートごとの設定 ----------

const ROCK_NAMES = [
  // row1: 大きさ違いの岩
  'rock_big', 'rock_medium', 'rock_small', 'rock_pebble', 'rock_flat_ground', 'rock_pointed', 'rock_cliff',
  // row2: 鉱石
  'ore_iron', 'ore_copper', 'ore_silver', 'ore_gold', 'crystal', 'ore_magic', 'coal', 'ore_rare',
  // row3: かけら
  'chunk_stone', 'chunk_iron', 'chunk_copper', 'chunk_silver', 'chunk_gold', 'chunk_crystal', 'chunk_magic', 'chunk_rare',
  // row4: 特殊な岩
  'rock_mossy', 'rock_vine', 'rock_water', 'cave_entrance', 'rock_pile', 'rock_collapsed', 'rock_fossil', 'ore_vein_big',
];

const FURN_NAMES = [
  'furn_workbench', 'furn_workbench_blueprint', 'furn_workbench_forge', 'furn_desk_office', 'furn_desk_dining', 'furn_table_low', 'furn_table_round',
  'furn_chair_wood', 'furn_stool', 'furn_chair_cushion', 'furn_bench', 'furn_bench_log', 'furn_deck_chair', 'furn_crate', 'furn_chest',
  'furn_stove', 'furn_pizza_oven', 'furn_campfire', 'furn_drying_rack', 'furn_fish_table', 'furn_barrel_table', 'furn_water_barrel', 'furn_bucket',
  'furn_fence_white', 'furn_fence_wood', 'furn_torch', 'furn_banner', 'furn_palm_tree', 'furn_flower_bed', 'furn_postbox', 'furn_signpost',
];

const TREE_NAMES = [
  'tree_big', 'tree_medium', 'tree_small', 'tree_sapling',
  'tree_front', 'tree_right', 'tree_back', 'tree_left', 'tree_top_down', 'tree_stump',
];

async function sliceChecker(file, namesInOrder, outManifest) {
  const img = await loadRaw(file);
  const model = detectChecker(img);
  console.log(`${file}: checker A=${model.A[0].toFixed(0)} B=${model.B[0].toFixed(0)} size=${model.S} phase=(${model.ox},${model.oy})`);
  const mask = keyChecker(img, model);
  const alpha = classifyChecker(mask, img, model);
  // image2（ラベル無しの花・植物）は小さい個体が多く、破片救済の併合が逆に
  // 別々の株をくっつけてしまうので、名前リストがあるラベル付きシートだけに限定する。
  let raw = components(alpha, img.w, img.h);
  raw = namesInOrder ? mergeNearbyBoxes(raw) : raw;
  let boxes = raw.filter((b) => !isLabelBox(b));
  boxes = boxes.map((b) => trimMergedLabel(img, alpha, b));
  const ordered = sortReadingOrder(boxes);
  console.log(`  ${ordered.length} 個検出 (名前リスト ${namesInOrder ? namesInOrder.length : '自動連番'})`);
  if (process.env.DEBUG_BOXES) {
    for (const b of ordered) console.log('   box', b.x0, b.y0, b.x1, b.y1, `${b.bw}x${b.bh}`, 'area=', b.area);
  }
  let idx = 0;
  for (const box of ordered) {
    const name = namesInOrder ? namesInOrder[idx] : `plant_${String(idx + 1).padStart(2, '0')}`;
    if (!name) {
      console.warn(`  警告: 名前リストが足りません (idx=${idx})`);
      idx++;
      continue;
    }
    const { w, h } = await cropAndSave(img, alpha, box, name);
    outManifest[name] = { w, h };
    idx++;
  }
  return { img, alpha, count: ordered.length };
}

async function sliceFlat(file, namesInOrder, outManifest, bgColor) {
  const img = await loadRaw(file);
  const mask = keyFlat(img, bgColor);
  const alpha = componentizeBackground(mask, img.w, img.h);
  let boxes = mergeNearbyBoxes(components(alpha, img.w, img.h)).filter((b) => !isLabelBox(b));
  boxes = boxes.map((b) => trimMergedLabel(img, alpha, b));
  const ordered = sortReadingOrder(boxes);
  console.log(`${file}: ${ordered.length} 個検出`);
  let idx = 0;
  for (const box of ordered) {
    const name = namesInOrder[idx];
    if (!name) {
      console.warn(`  警告: 名前リストが足りません (idx=${idx})`);
      idx++;
      continue;
    }
    const { w, h } = await cropAndSave(img, alpha, box, name);
    outManifest[name] = { w, h };
    idx++;
  }
  return { img, alpha };
}

// ---------- image4: アイソメ地面タイルの逆変換（ベストエフォート） ----------
//
// アイソメの菱形タイルは「正方形を 45° 回転し、縦を約半分に圧縮したもの」。
// 4 隅の座標が分かれば、逆に「菱形の四隅 → 正方形の四隅」への射影変換で
// 展開できる。sharp 単体では任意四角形→正方形の射影変換はできないため、
// 出力側の各ピクセルについて逆写像（双一次補間）を自前で計算する。
function deIsoTile(img, diamond, outSize = 256) {
  // diamond: {top:[x,y], right:[x,y], bottom:[x,y], left:[x,y]} 菱形の4頂点
  const { top, right, bottom, left } = diamond;
  const out = Buffer.alloc(outSize * outSize * 4);
  const sample = (x, y) => {
    const xi = Math.max(0, Math.min(img.w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(img.h - 1, Math.round(y)));
    return px(img, xi, yi);
  };
  for (let v = 0; v < outSize; v++) {
    for (let u = 0; u < outSize; u++) {
      const fu = u / outSize; // 0..1 左→右
      const fv = v / outSize; // 0..1 上→下
      // 正方形の (fu,fv) を菱形内部へ双線形写像: 上下左右4頂点の重み付け
      // 菱形の座標系: 横方向 = (右-左), 縦方向 = (下-上) のブレンド
      const topX = top[0] + (right[0] - top[0]) * fu;
      const topY = top[1] + (right[1] - top[1]) * fu;
      const botX = left[0] + (bottom[0] - left[0]) * fu;
      const botY = left[1] + (bottom[1] - left[1]) * fu;
      const x = topX + (botX - topX) * fv;
      const y = topY + (botY - topY) * fv;
      const [r, g, b] = sample(x, y);
      const o = (v * outSize + u) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ---------- メイン処理 ----------

async function main() {
  const manifest = {};

  console.log('== image0: 岩・鉱石 ==');
  await sliceChecker('image0.png', ROCK_NAMES, manifest);

  console.log('== image1: 家具・設備 ==');
  await sliceChecker('image1.png', FURN_NAMES, manifest);

  console.log('== image2: 花・植物（ラベル無し, 連番） ==');
  await sliceChecker('image2.png', null, manifest);

  console.log('== image3: 木 ==');
  await sliceFlat('image3.png', TREE_NAMES, manifest, [73, 73, 73]);

  console.log('== image4: アイソメ地面（4 種の基本タイルを平面化・ベストエフォート） ==');
  const img4 = await loadRaw('image4.png');
  // 4 象限それぞれの左上（基本タイル）の中心をだいたいの座標で特定し、
  // 菱形の4頂点を決め打ちして逆写像する（deIsoTile 関数）。
  // 実際に試した結果: 階段状のジャギー、隣のタイルの映り込み、
  // ラベル帯の文字が水タイルに入り込む、といった目に見える劣化があり、
  // 「認識できる・そこそこ綺麗な」水準に届かなかったため採用を見送った。
  // 既存の src/assets/pigg/pigg_sand.png 等（ChatGPT 生成のシームレス
  // テクスチャ）を正とし、このブロックは today's report のとおり出力を保存しない。
  // 手法自体は再利用できるよう deIsoTile() は残してある。
  const SKIP_DEISO = true;
  if (!SKIP_DEISO) {
    const quadrants = [
      { name: 'ground_sand_deiso', cx: 95, cy: 100 },
      { name: 'ground_grass_deiso', cx: 863, cy: 100 },
      { name: 'ground_stone_deiso', cx: 95, cy: 590 },
      { name: 'ground_water_deiso', cx: 863, cy: 590 },
    ];
    for (const q of quadrants) {
      const halfW = 85;
      const halfH = 48;
      const diamond = {
        top: [q.cx, q.cy - halfH],
        right: [q.cx + halfW, q.cy],
        bottom: [q.cx, q.cy + halfH],
        left: [q.cx - halfW, q.cy],
      };
      const buf = deIsoTile(img4, diamond, 256);
      await sharp(buf, { raw: { width: 256, height: 256, channels: 4 } }).png().toFile(join(OUT, `${q.name}.png`));
      console.log(`  ${q.name}: 256x256`);
    }
  } else {
    console.log('  結果が粗かったため出力は見送り（pigg_sand.png 等を正とする）。詳細はレポート参照。');
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(
    join(OUT, 'README.md'),
    [
      '# refimg（ユーザー提供の参考画像シート由来の素材）',
      '',
      '出どころ: `refs/image0.png` 〜 `refs/image4.png`（ユーザー提供の参考シート、git 管理外）。',
      '切り出しは `scripts/slice-refimg.mjs` で行う。',
      '',
      '## 背景の透過キーについて',
      '',
      '5 枚とも見た目はチェッカー柄の透過だが、`sharp` の metadata では `hasAlpha:false`。',
      '市松模様がそのまま本物のピクセルとして焼き込まれているだけで、本物の透明度ではない。',
      'そのため単純な色置換（マゼンタキーなど）は使えず、',
      '「その座標なら市松模様として本来何色のはずか」を推定してから、期待値との色距離で',
      '背景かどうかを判定している（位置ベースのキー）。誤って絵柄側の白い花びらなどを',
      '抜いてしまわないよう、最終的には画像の外周と連結しているかどうか（フラッドフィル）で',
      '判定する。image3（木）だけは背景が単色グレーなので、素直な色距離キーのみを使う。',
      '',
      '## ファイル',
      '',
      '- `rock_*` / `ore_*` / `chunk_*` / `crystal` / `coal` / `cave_entrance` — image0 由来（岩・鉱石）',
      '- `furn_*` — image1 由来（家具・設備）',
      '- `plant_NN` — image2 由来（花・植物、ラベルが無いシートなので連番）',
      '- `tree_*` — image3 由来（木）',
      '',
      '`manifest.json` に各ファイルの幅・高さを記録している。',
      '',
      '## image4（アイソメ地面タイル）について',
      '',
      '4 種の基本タイル（砂浜・野原・石床・海の「基本」）を平面な正方形テクスチャへ',
      '逆変換する試みは行ったが、階段状のジャギー・隣接タイルの映り込み・ラベル文字の',
      '映り込みが出て「そこそこ綺麗」の水準に届かなかったため、成果物としては採用しなかった。',
      '地面テクスチャは既存の `src/assets/pigg/pigg_sand.png` などをそのまま正とする。',
      '手法（`deIsoTile()`）は `scripts/slice-refimg.mjs` に残してあるので、精度を上げて',
      '再挑戦したい場合はそこから始められる。',
    ].join('\n') + '\n',
  );
  console.log('manifest.json / README.md を書き出しました。');
}

await main();
