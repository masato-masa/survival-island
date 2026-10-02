// 島のマップを組み立てて src/game/map.ts に書き出す（設計は細かい 64×70、書き出しは 2×2 にまとめた 32×35）。
//
//   node scripts/build-map.mjs
//
// 手で 64×70 の ASCII を打つと、道の曲がりや森の縁のゆらぎを直すたびに
// 全部ずれる。ここでは「形」（矩形・ゆらいだ縁・道）で描いて ASCII を生成する。
// 乱数は固定のシードから作るので、何度走らせても同じマップになる。
//
// 記号の意味は src/game/data.ts の MAP_LEGEND を見る。

import { writeFileSync } from 'node:fs';

const W = 64;
const H = 70;

// ---------------------------------------------------------------------------
// 決定的なノイズ

function hash(x, y, seed = 1) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 1 次元のなめらかなゆらぎ（縁をがたつかせる）。-amp..amp */
function wobble(t, seed, amp, period = 5) {
  const i = Math.floor(t / period);
  const f = t / period - i;
  const a = hash(i, 0, seed) * 2 - 1;
  const b = hash(i + 1, 0, seed) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return Math.round((a + (b - a) * s) * amp);
}

// ---------------------------------------------------------------------------
// キャンバス

const tile = Array.from({ length: H }, () => Array(W).fill('~'));
const area = Array.from({ length: H }, () => Array(W).fill(' '));

const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, ch) => {
  if (inside(x, y)) tile[y][x] = ch;
};
const get = (x, y) => (inside(x, y) ? tile[y][x] : '~');
const setArea = (x, y, a) => {
  if (inside(x, y)) area[y][x] = a;
};
const rect = (x0, y0, x1, y1, ch) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
};
const areaRect = (x0, y0, x1, y1, a) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setArea(x, y, a);
};
/** 1 マス幅 w の道を点列に沿って引く（縦横の折れ線）。 */
const path = (points, ch, w = 2) => {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let x = ax;
    let y = ay;
    for (;;) {
      for (let k = 0; k < w; k++) {
        if (dx !== 0) set(x, y + k, ch);
        else set(x + k, y, ch);
      }
      if (x === bx && y === by) break;
      x += dx;
      y += dy;
    }
  }
};
/** ch のマスだけを置き換える。 */
const replaceIn = (x0, y0, x1, y1, from, to) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(x, y) === from) set(x, y, to);
};
const put = (list, ch) => {
  for (const [x, y] of list) set(x, y, ch);
};

// ---------------------------------------------------------------------------
// 1. 島の外形。北は森、南は砂浜、その下が海。

// 陸地（森で埋めてから、開けた場所を掘る）
for (let x = 2; x < W - 2; x++) {
  const top = 2 + Math.max(0, wobble(x, 11, 1));
  const shore = 58 + wobble(x, 12, 2, 6); // 砂浜の南の端
  for (let y = top; y <= shore; y++) set(x, y, '#');
}
// 東西の端もゆらす
for (let y = 2; y < 60; y++) {
  const l = 2 + Math.max(0, wobble(y, 13, 1));
  const r = W - 3 - Math.max(0, wobble(y, 14, 1));
  for (let x = 0; x < l; x++) set(x, y, '~');
  for (let x = r + 1; x < W; x++) set(x, y, '~');
}

// ---------------------------------------------------------------------------
// 2. 砂浜（y 49〜海）。北の縁は森とゆらいで接する。

for (let x = 2; x < W - 2; x++) {
  const top = 49 + wobble(x, 21, 1, 4);
  for (let y = top; y < H; y++) {
    if (get(x, y) === '#') set(x, y, ',');
    setArea(x, y, 's');
  }
}

// 船着き場：砂浜の左下から海へ突き出す桟橋と、横付けした商船
path([[9, 55], [9, 64]], 'D', 2);
rect(9, 64, 12, 65, 'D');
set(12, 64, 'Q'); // 桟橋の先の係留柱（触ると「商船」の説明）
rect(13, 60, 18, 65, 'S'); // 商船（6×6。ChatGPT の船の絵が約 5.4×6 マス）
areaRect(8, 55, 20, 68, 's');

// 開始位置
set(32, 53, '@');

// 砂浜には木を置かない（砂の上の木は無し。粗くしたあとにも砂の上の木を消す）。
// 流木代わりの岩（粗くするときにフィールドの岩は消える）
put([[18, 55], [38, 56], [55, 55], [41, 51]], 'R');

// ---------------------------------------------------------------------------
// 3. 森の小道（y 38〜48）。周りは深い森。道の両脇だけ少し開けて木と岩がある。

const woodsPath = [
  [35, 37],
  [35, 41],
  [33, 41],
  [33, 45],
  [31, 45],
  [31, 50],
];
// 小道の脇の開け（草）
for (const [x0, y0, x1, y1] of [
  [32, 38, 38, 41],
  [30, 41, 36, 45],
  [28, 45, 34, 48],
]) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (hash(x, y, 31) < 0.85) set(x, y, '.');
    }
}
path(woodsPath, ':', 2);
areaRect(22, 37, 44, 48, 'w');
put([[32, 39], [37, 42], [29, 44], [35, 46], [28, 47]], 'T');
put([[30, 42]], 't');
put([[37, 39], [34, 47]], 'R');

// ---------------------------------------------------------------------------
// 4. 開けた土地（拠点）。x 20〜51, y 15〜37。ゆらいだ縁の楕円に近い形。

const PX0 = 20,
  PX1 = 51,
  PY0 = 15,
  PY1 = 37;
for (let y = PY0; y <= PY1; y++) {
  for (let x = PX0; x <= PX1; x++) {
    const inset = Math.max(0, wobble(x + y * 3, 41, 2, 3));
    const nx = (x - (PX0 + PX1) / 2) / ((PX1 - PX0) / 2);
    const ny = (y - (PY0 + PY1) / 2) / ((PY1 - PY0) / 2);
    const r = nx * nx * 0.6 + ny * ny * 0.6 + (nx * nx * ny * ny) * 0.9;
    if (r <= 1 - inset * 0.06) set(x, y, '.');
  }
}
areaRect(PX0 - 1, PY0 - 1, PX1 + 1, PY1, 'p');

// 家の跡地（北の開け）：崩れた土台
rect(32, 17, 39, 21, 'F');
// 中央のランドマーク（4×4）と、それを囲む石畳の輪
rect(32, 24, 39, 31, '=');
rect(34, 26, 37, 29, 'L');

// 道：南の入口 → 輪、輪 → 家の跡地、輪 → 西（遺跡へ）、輪 → 北西・北東の出口
path([[35, 32], [35, 37]], ':', 2); // 南
path([[35, 22], [35, 23]], ':', 2); // 北（家へ）
path([[31, 27], [16, 27]], ':', 2); // 西（遺跡へ）
path([[32, 24], [26, 24], [26, 18], [23, 18], [23, 13]], ':', 2); // 北西
path([[39, 24], [45, 24], [45, 18], [48, 18], [48, 13]], ':', 2); // 北東

// 輪の周りの配置スペース
put([[34, 23], [37, 23], [34, 32], [37, 32]], 'b'); // ベンチ
put([[31, 23], [40, 23], [31, 32], [40, 32]], 'o'); // 飾り（輪の四隅）
put([[31, 25], [31, 30], [40, 25], [40, 30]], 'o'); // 飾り（輪の東西）
put([[30, 29], [41, 26], [41, 29]], 'd'); // 机
put([[35, 34], [36, 34], [35, 35], [36, 35]], 'p'); // 道（南の入口の石畳）
put([[31, 19], [40, 19]], 'e'); // 柵（家の跡地の両脇）
put([[30, 17], [41, 17]], 'e');
put([[42, 21]], 'k'); // キッチン
put([[29, 21]], 'w'); // 作業台の置き場

// 作業台（クラフト）と看板つきの畑
set(28, 33, 'W');
// 畑は粗くした地図で 3×3 マス（A）と 2×2 マス（B）になる大きさにする（範囲まきに 3×3 が要る）
rect(44, 26, 49, 31, 'f');
set(43, 28, 's');
rect(44, 34, 47, 37, 'f');
set(43, 35, 's');

// 昔の人の暮らしの名残：崩れた石・瓦礫・折れた柱
put([[23, 21], [47, 20], [46, 33], [24, 31], [41, 36]], 'B');
put([[24, 22], [25, 21], [46, 21], [27, 30], [43, 24], [23, 33], [48, 33], [29, 35], [41, 35], [33, 20]], 'r');
put([[21, 26], [21, 29]], 'P'); // 西の道の入口に立つ柱

// 資源：開けた土地の縁の木と岩
put([[22, 24], [50, 25], [22, 33], [49, 22], [27, 16], [44, 16]], 'T');
put([[51, 29]], 't');
put([[25, 34], [47, 24], [28, 19], [43, 20]], 'R');
put([[50, 34]], 'H');

// ---------------------------------------------------------------------------
// 5. 西の遺跡（x 3〜16, y 20〜34）。石畳の広場に、柱の輪と崩れた石。

for (let y = 20; y <= 34; y++) {
  for (let x = 3; x <= 17; x++) {
    const nx = (x - 10) / 7;
    const ny = (y - 27) / 7;
    if (nx * nx + ny * ny <= 1.05 + (hash(x, y, 51) - 0.5) * 0.25) set(x, y, '.');
  }
}
for (let y = 23; y <= 31; y++) {
  for (let x = 6; x <= 14; x++) {
    const nx = (x - 10) / 4.5;
    const ny = (y - 27) / 4.5;
    if (nx * nx + ny * ny <= 1 && hash(x, y, 52) < 0.8) set(x, y, '=');
  }
}
path([[16, 27], [13, 27]], '=', 2);
areaRect(2, 19, 19, 35, 'u');
set(10, 26, 'X'); // 謎の遺跡（本体）
put([[7, 23], [13, 23], [5, 27], [15, 27], [7, 31], [13, 31]], 'P'); // 柱の輪
put([[9, 22], [4, 25], [12, 33], [16, 31]], 'B');
put([[6, 25], [11, 24], [14, 29], [8, 30], [5, 30], [12, 21]], 'r');
set(4, 29, 'c'); // 宝箱

// ---------------------------------------------------------------------------
// 6. 北の封じられた土地（仮）。北西＝森、北＝丘、北東＝岩場。

// 北西の森（x 4〜19, y 3〜12）
for (let y = 3; y <= 12; y++) for (let x = 4; x <= 19; x++) if (hash(x, y, 61) < 0.9) set(x, y, '.');
put([[6, 5], [9, 4], [12, 6], [16, 5], [7, 9], [14, 10], [18, 8]], 'T');
put([[10, 8], [5, 11], [17, 11]], 't');
set(12, 3, 'c');
areaRect(3, 2, 20, 12, 'f');
// 北西の出口の障害物（パワーアップ Lv1）
// 道は 2 マス幅（x 23〜24）なので、障害物も 2 マスでふさぐ
set(23, 13, '1');
set(24, 13, '1');
path([[23, 12], [23, 10], [19, 10]], ':', 1);
setArea(23, 13, 'f');
setArea(24, 13, 'f');

// 北東の岩場（x 44〜60, y 3〜12）
for (let y = 3; y <= 12; y++) for (let x = 44; x <= 60; x++) if (hash(x, y, 62) < 0.9) set(x, y, '.');
put([[46, 5], [52, 4], [57, 6], [49, 9], [55, 10]], 'R');
put([[50, 6], [58, 9], [45, 11]], 'H');
set(59, 4, 'c');
areaRect(43, 2, 61, 12, 'r');
set(47, 13, '2');
set(48, 13, '2');
path([[48, 12], [48, 10], [44, 10]], ':', 1);
setArea(47, 13, 'r');
setArea(48, 13, 'r');

// 北の丘（x 26〜40, y 3〜11）：北西の森から（パワーアップ Lv2）
for (let y = 3; y <= 11; y++) for (let x = 26; x <= 40; x++) if (hash(x, y, 63) < 0.92) set(x, y, '.');
put([[29, 5], [36, 4], [33, 9]], 't');
put([[39, 8], [27, 10]], 'H');
path([[19, 6], [25, 6]], ':', 1);
// 粗くしたあとも 2 マス幅（縦に 2 ブロック）になるよう、y 4〜7 を壁でなく境界の通路にする
set(21, 4, '3');
set(21, 6, '3');
for (const y of [2, 3, 8, 9]) set(21, y, '#');
set(21, 5, '3');
set(21, 7, '3');
areaRect(21, 2, 41, 12, 'h');

// ---------------------------------------------------------------------------
// 7. 森の中の「#」のうち、開けた場所に接するものの一部を切れる木にする
//    （森の壁は通れないが、縁の木だけは資源になる）。境界の周りは除く。

// （森の縁は描画側でふくらませて見せるので、ここでは記号を変えない）

// たどり着けない歩ける場所（森や木・岩に閉じ込められたポケット）は森で埋める。
// 開始位置から塗り広げる。境界（1 2 3）は壊せる前提で通れるものとして扱う。
{
  const SOLID = new Set(['#', '~', 'S', 'B', 'P', 'Q', 'X', 'W', 'T', 't', 'R', 'H', 's', 'c']);
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const stack = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (get(x, y) === '@') stack.push([x, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!inside(x, y) || seen[y][x] || SOLID.has(get(x, y))) continue;
    seen[y][x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (!seen[y][x] && !SOLID.has(get(x, y)) && get(x, y) !== 'D') set(x, y, '#');
}

// 領域の記号が空のところは、周りの領域で埋める（森の中も「近いエリア」に属させる）
for (let pass = 0; pass < 20; pass++) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (area[y][x] !== ' ') continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = inside(x + dx, y + dy) ? area[y + dy][x + dx] : ' ';
        if (a !== ' ') {
          area[y][x] = a;
          break;
        }
      }
    }
}

// ---------------------------------------------------------------------------
// 8. 粗くする（2×2 マス → 1 マス）。
//
// 絵の物体・人が大きく見える（参考画像くらい）ように、ゲームの 1 マスを「今の物体 1 個ぶん×2」にした。
// 上までは細かい 64×70 で設計してあるので、ここで 2×2 ごとに 1 文字へまとめて 32×35 にする。
// 物体（木・岩・柱）は道の上に落ちると道をふさぐので、ブロックの地面が道ならばその物体は捨てる。

const PATHY = new Set([':', '=', 'D']);
const SPECIAL = ['@', 'X', 'W', 'Q', 'c', 's'];
const BORDERS = ['1', '2', '3'];
const SLOTS = ['b', 'o', 'd', 'e', 'k', 'w', 'p'];
const NODES = ['t', 'H', 'T', 'R', 'v']; // 花（v）は木より後回し
const DECOS = ['B', 'P'];
const TERRAIN_ORDER = [':', '=', 'D', 'F', '.', ',', 'S', '#', '~'];

function coarsen() {
  // 岩（R H）と崩れた石・瓦礫（B r）はフィールドに置かない（岩は今後追加する洞窟で出す）。
  // 配置スペース（b o d e k w p）とランドマーク用地（L）は廃止した（家具は歩ける全マスに自由に置く）。
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ('RHBrbodekwpL'.includes(tile[y][x])) tile[y][x] = '.';
  const cw = W / 2;
  const ch = H / 2;
  const ct = Array.from({ length: ch }, () => Array(cw).fill('~'));
  const ca = Array.from({ length: ch }, () => Array(cw).fill(' '));
  for (let by = 0; by < ch; by++) {
    for (let bx = 0; bx < cw; bx++) {
      const cells = [];
      const areas = {};
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          cells.push(tile[by * 2 + dy][bx * 2 + dx]);
          const a = area[by * 2 + dy][bx * 2 + dx];
          if (a !== ' ') areas[a] = (areas[a] ?? 0) + 1;
        }
      const count = (c) => cells.filter((x) => x === c).length;
      const first = (list) => list.find((c) => count(c) > 0);
      // 地面（物体の下は分からないので草として数える）
      const tcount = {};
      for (const c of cells) {
        const g = TERRAIN_ORDER.includes(c) ? c : '.';
        tcount[g] = (tcount[g] ?? 0) + 1;
      }
      const ground = TERRAIN_ORDER.slice().sort((a, b) => (tcount[b] ?? 0) - (tcount[a] ?? 0) || TERRAIN_ORDER.indexOf(a) - TERRAIN_ORDER.indexOf(b))[0];

      let out;
      if ((out = first(SPECIAL))) {
        /* そのまま */
      } else if (count('L') > 0) out = 'L';
      else if ((out = first(BORDERS))) {
        /* そのまま */
      } else if ((out = first(SLOTS))) {
        /* そのまま */
      } else if (count('f') >= 2) out = 'f';
      else if (count('S') >= 2) out = 'S';
      else if (!PATHY.has(ground) && (out = first(NODES))) {
        /* そのまま */
      } else if (!PATHY.has(ground) && (out = first(DECOS))) {
        /* そのまま */
      } else if (count('r') > 0 && !PATHY.has(ground) && ground !== '~') out = 'r';
      else out = ground === 'S' ? '.' : ground;
      ct[by][bx] = out;
      const best = Object.entries(areas).sort((a, b) => b[1] - a[1])[0];
      if (best) ca[by][bx] = best[0];
    }
  }
  return { ct, ca, cw, ch };
}

const { ct, ca, cw, ch } = coarsen();

// 砂の上の木を消す（world.ts と同じく、物の下の地面は上下左右の歩ける地面の多数決。同数なら草以外が勝つ）
{
  const GROUND_OF = { ',': 'sand', '.': 'grass', '#': 'grass', v: 'grass', ':': 'dirt', '=': 'paving', D: 'dock', F: 'foundation' };
  let removed = 0;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      if (ct[y][x] !== 'T' && ct[y][x] !== 't') continue;
      const counts = {};
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const g = GROUND_OF[ct[y + dy]?.[x + dx]];
        if (g) counts[g] = (counts[g] ?? 0) + 1;
      }
      const sand = counts.sand ?? 0;
      if (sand > 0 && Object.entries(counts).every(([g, c]) => g === 'sand' || c <= sand)) {
        ct[y][x] = ',';
        removed++;
      }
    }
  console.error(`砂の上の木 ${removed} 本を消した`);
}

// たどり着けない歩ける場所を森で埋める（粗くしたあとの地図でもう一度）
const COARSE_SOLID = new Set(['#', '~', 'S', 'B', 'P', 'Q', 'X', 'W', 'T', 't', 'R', 'H', 's', 'c', 'v']);
{
  const SOLID = COARSE_SOLID;
  const seen = Array.from({ length: ch }, () => Array(cw).fill(false));
  const stack = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (ct[y][x] === '@') stack.push([x, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= cw || y >= ch || seen[y][x] || SOLID.has(ct[y][x])) continue;
    seen[y][x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  let filled = 0;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      if (!seen[y][x] && !SOLID.has(ct[y][x]) && ct[y][x] !== 'D') {
        ct[y][x] = '#';
        filled++;
      }
  console.error(`到達できない ${filled} マスを森で埋めた`);
}
for (let pass = 0; pass < 20; pass++)
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      if (ca[y][x] !== ' ') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = ca[y + dy]?.[x + dx];
        if (a && a !== ' ') {
          ca[y][x] = a;
          break;
        }
      }
    }

// ---------------------------------------------------------------------------
// 9. 花（v）を散らす。砂浜以外の草地（'.'）に、ハッシュで決定的に、草 12〜15 マスに 1 つくらい。
//    開始位置・看板・宝箱・作業台・遺跡・係留柱・柱・境界・畑・家の跡地、最初から置く家具
//    （data.ts の EXTRA_INITIAL_FURNITURE：たき火 15,17 と 遺跡のアーチ 7,14）の周り 1 マスには置かない。
//    花どうしは隣り合わせない（斜めも）。置くとたどり着けるマスが減る（道や通り道をふさぐ）なら置かない。
{
  const FLOWER_RATE = 1 / 13.5;
  const KEEP_CLEAR = new Set(['@', 's', 'c', 'W', 'X', 'Q', 'P', '1', '2', '3', 'f', 'F']);
  const RESERVED = [
    [15, 17],
    [7, 14],
  ];
  const reachableCount = () => {
    const seen = Array.from({ length: ch }, () => Array(cw).fill(false));
    const stack = [];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (ct[y][x] === '@') stack.push([x, y]);
    let n = 0;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= cw || y >= ch || seen[y][x] || COARSE_SOLID.has(ct[y][x])) continue;
      seen[y][x] = true;
      n++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return n;
  };
  // 草マスをハッシュの小さい順に並べ、条件を満たすものから目標数（草 ÷ 13.5）まで置く
  const candidates = [];
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) if (ct[y][x] === '.' && ca[y][x] !== 's') candidates.push([x, y, hash(x, y, 71)]);
  candidates.sort((a, b) => a[2] - b[2]);
  const grass = candidates.length;
  const target = Math.round(grass * FLOWER_RATE);
  let placed = 0;
  let rejected = 0;
  let reach = reachableCount();
  for (const [x, y] of candidates) {
      if (placed >= target) break;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1 && ok; dx++) {
          if (KEEP_CLEAR.has(ct[y + dy]?.[x + dx])) ok = false;
          if (RESERVED.some(([rx, ry]) => rx === x + dx && ry === y + dy)) ok = false;
        }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ct[y + dy]?.[x + dx] === 'v') ok = false;
      if (!ok) continue;
      ct[y][x] = 'v';
      const after = reachableCount();
      if (after < reach - 1) {
        ct[y][x] = '.';
        rejected++;
        continue;
      }
      reach = after;
      placed++;
    }
  console.error(`花 ${placed} 本（草 ${grass} マス、通り道をふさぐので見送り ${rejected}）`);
}

// ---------------------------------------------------------------------------
// 書き出し

const rows = ct.map((r) => r.join(''));
const arows = ca.map((r) => r.join(''));
const out = `// 生成物。直接編集しない。scripts/build-map.mjs を直して node scripts/build-map.mjs で作り直す。
// 記号の意味は data.ts の MAP_LEGEND。

export const MAP: string[] = [
${rows.map((r) => `  '${r}',`).join('\n')}
];

/** エリアの層。s 砂浜 / w 森の小道 / p 開けた土地 / u 遺跡 / f 北西の森 / r 北東の岩場 / h 北の丘 */
export const AREA_MAP: string[] = [
${arows.map((r) => `  '${r}',`).join('\n')}
];
`;
writeFileSync(new URL('../src/game/map.ts', import.meta.url), out);
console.log(rows.join('\n'));
