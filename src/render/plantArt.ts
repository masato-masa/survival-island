// 木・花・苗など植物のベクター絵（ピグライフ風: 葉のかたまりを重ねた樹冠、根の張った幹、やわらかい輪郭）。
// sprites.ts の PAINTERS から呼ばれる。座標はワールド px、スプライトの「下辺中央」が根元。
//
// 木は「斧の必要段階」を見た目だけで読めるよう、段階ごとに樹種を分けている（data.ts の TREE_SPECIES）。
// 段階が上がるほど 大きく・古く・暗く なる:
//   Lv0 若木      … 小さく明るい黄緑の丸い木、細い幹
//   Lv1 カシの木  … 背が高い深緑の広葉樹、太い幹と根張り
//   Lv2 スギの大木 … 濃い青緑の針葉樹（段になった枝葉）、赤みのある樹皮
//   Lv5 森の主    … 黒に近い緑の巨木、ねじれた太い幹・大きな根・苔と垂れ下がる苔

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const OL = 0.85; // 輪郭の太さ（花・小物）

// ---------------------------------------------------------------------------
// 基本の形

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function ell(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, stroke?: string, lw = OL, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function fillStroke(ctx: Ctx, fill: string, stroke: string, lw = OL): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** 葉 1 枚。(x,y) が付け根、ang は上向きが 0（右が正）。 */
function leaf(ctx: Ctx, x: number, y: number, len: number, ang: number, wid: number, fill: string, stroke: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
  ctx.closePath();
  fillStroke(ctx, fill, stroke, 0.6);
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.12);
  ctx.lineTo(0, -len * 0.7);
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
  ctx.restore();
}

/** 先のとがった小さな筆跡（葉の光・影の「タッチ」）。中心 (x,y)、長さ len、向き ang（0 = 右）。 */
function dab(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, color: string): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const hx = (c * len) / 2;
  const hy = (s * len) / 2;
  ctx.beginPath();
  ctx.moveTo(x - hx, y - hy);
  ctx.quadraticCurveTo(x - s * wid, y + c * wid, x + hx, y + hy);
  ctx.quadraticCurveTo(x + s * wid, y - c * wid, x - hx, y - hy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** 決まった種からの乱数（同じ絵が毎回同じに焼ける）。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 2 色を t で混ぜる（#rrggbb どうし）。a は不透明度。 */
function mix(a: string, b: string, t: number, alpha = 1): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const r = Math.round(x[0] + (y[0] - x[0]) * t);
  const g = Math.round(x[1] + (y[1] - x[1]) * t);
  const bl = Math.round(x[2] + (y[2] - x[2]) * t);
  return alpha >= 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${alpha})`;
}

// ---------------------------------------------------------------------------
// 色

/** 葉の色。out = 輪郭、deep = かたまりの隙間の暗がり、hi = 一番明るい光。 */
interface Foliage {
  out: string;
  deep: string;
  shade: string;
  base: string;
  light: string;
  hi: string;
}

interface Bark {
  out: string;
  dark: string;
  base: string;
  light: string;
  /** 切り口の色と年輪の色。 */
  cut: string;
  ring: string;
}

// Lv0 若木: 明るい黄緑
const F_YOUNG: Foliage = { out: '#5b8a2c', deep: '#6c9c33', shade: '#84b540', base: '#a2cf55', light: '#c3e476', hi: '#e8f8ad' };
// Lv1 カシ: 深緑
const F_OAK: Foliage = { out: '#244f24', deep: '#2c5e2b', shade: '#3a7534', base: '#50903d', light: '#6dac50', hi: '#a3d17a' };
// Lv2 スギ: 濃い青緑
const F_CEDAR: Foliage = { out: '#12332c', deep: '#173f36', shade: '#1f5243', base: '#2a654f', light: '#3a7d5d', hi: '#68a37c' };
// Lv5 森の主: 黒に近い緑
const F_ANCIENT: Foliage = { out: '#0c1912', deep: '#11231a', shade: '#1b3626', base: '#264832', light: '#386243', hi: '#6a9460' };

const B_YOUNG: Bark = { out: '#6d4b2f', dark: '#916641', base: '#b98a5b', light: '#d8b17f', cut: '#f6dcab', ring: '#d3a96c' };
const B_OAK: Bark = { out: '#3f2a1b', dark: '#5c3e27', base: '#82593a', light: '#a67b52', cut: '#ecc993', ring: '#bf925a' };
const B_CEDAR: Bark = { out: '#431f15', dark: '#5f2c1f', base: '#8a4530', light: '#b06a4c', cut: '#f0c39c', ring: '#c98a62' };
const B_ANCIENT: Bark = { out: '#1d1612', dark: '#30271f', base: '#4b3e32', light: '#6c5c4b', cut: '#c9ab80', ring: '#94774f' };

const MOSS = '#5f7f34';
const MOSS_LIGHT = '#8eab4a';
const IVY = '#5aa83f';
const IVY_LIGHT = '#8fd263';

// ---------------------------------------------------------------------------
// 樹冠（葉のかたまりを重ねる）

/** [中心 x, 中心 y, 半径] */
type Puff = readonly [number, number, number];
type Circle = [number, number, number];

interface Clump {
  x: number;
  y: number;
  r: number;
  /** 外形を作る円（中心 1 つ + 周りのふくらみ）。 */
  circles: Circle[];
  /** ふくらみの角度（光の筆跡を置く位置）。 */
  bumps: number[];
}

function makeClumps(puffs: readonly Puff[], rnd: () => number, lumpy = 1): Clump[] {
  return puffs.map(([x, y, r]) => {
    // 縁は小さなふくらみをたくさん並べて「葉の房」に見せる
    const n = Math.max(9, Math.round(r * 1.25));
    const circles: Circle[] = [[x, y, r * 0.74]];
    const bumps: number[] = [];
    const off = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (Math.PI * 2 * i) / n + (rnd() - 0.5) * 0.3;
      const br = r * (0.24 + rnd() * 0.1 * lumpy);
      const d = r - br * (0.9 + rnd() * 0.25);
      circles.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.92, br]);
      bumps.push(a);
    }
    return { x, y, r, circles, bumps };
  });
}

function clumpPath(ctx: Ctx, c: Clump, dx = 0, dy = 0, grow = 0): void {
  for (const [x, y, r] of c.circles) circle(ctx, x + dx, y + dy, r + grow);
}

/**
 * 樹冠を描く。下（奥）のかたまりから順に重ね、上ほど明るく。かたまりは下のかたまりへ影を落とし、
 * 全体の外形にだけやわらかい輪郭が付く。かたまりの中は葉の形の筆跡で、光の側は明るく、影の側は暗く。
 */
function paintCrown(ctx: Ctx, clumps: readonly Clump[], pal: Foliage, rnd: () => number, opt: { outline?: number; dabs?: number } = {}): void {
  const top = Math.min(...clumps.map((c) => c.y - c.r));
  const bottom = Math.max(...clumps.map((c) => c.y + c.r));
  const span = bottom - top;
  const density = opt.dabs ?? 1;

  // 外形: 輪郭色で太めに塗ってから暗がり色で塗る（内側の線は消え、外周だけが残る）
  ctx.beginPath();
  for (const c of clumps) clumpPath(ctx, c, 0, 0, 0.2);
  ctx.lineWidth = opt.outline ?? 1.1;
  ctx.strokeStyle = mix(pal.out, pal.deep, 0.25, 0.9);
  ctx.stroke();
  ctx.fillStyle = pal.deep;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  for (const c of clumps) clumpPath(ctx, c, 0, 0, 0.2);
  ctx.clip();

  const order = [...clumps].sort((a, b) => b.y + b.r * 0.3 - (a.y + a.r * 0.3));
  for (const c of order) {
    const t = (c.y - top) / span; // 0 = 上
    // 下のかたまりへ落とす影
    ctx.beginPath();
    clumpPath(ctx, c, 0.8, 1.6, 0.3);
    ctx.fillStyle = mix(pal.deep, pal.out, 0.5, 0.5);
    ctx.fill();
    // 本体: 左上から光が当たる丸み
    const g = ctx.createRadialGradient(c.x - c.r * 0.42, c.y - c.r * 0.55, c.r * 0.05, c.x - c.r * 0.15, c.y - c.r * 0.15, c.r * 1.2);
    g.addColorStop(0, mix(pal.light, pal.hi, 0.45 * (1 - t)));
    g.addColorStop(0.4, mix(pal.base, pal.light, 0.55 * (1 - t)));
    g.addColorStop(0.8, mix(pal.shade, pal.base, 0.3 * (1 - t)));
    g.addColorStop(1, mix(pal.shade, pal.deep, 0.4 + 0.4 * t));
    // 左上の縁に光の三日月を残す: 明るい色で塗ってから、少し右下へずらした本体を重ねる
    ctx.save();
    ctx.beginPath();
    clumpPath(ctx, c);
    ctx.clip();
    ctx.fillStyle = mix(pal.light, pal.hi, 0.25 + 0.5 * (1 - t), 1);
    ctx.fill();
    ctx.beginPath();
    clumpPath(ctx, c, c.r * 0.1, c.r * 0.14);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // 葉の筆跡: 中心から外へ向いた小さな葉を散らし、場所の明るさで色を変える
    const n = Math.round(density * c.r * 2.4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = c.r * (0.25 + 0.68 * Math.sqrt(rnd()));
      const x = c.x + Math.cos(a) * d;
      const y = c.y + Math.sin(a) * d * 0.92;
      const lit = -(Math.cos(a) * 0.6 + Math.sin(a) * 0.8) * (d / c.r); // 左上ほど +
      const len = c.r * (0.2 + rnd() * 0.14);
      const ang = a + (rnd() - 0.5) * 0.9;
      let col: string;
      if (lit > 0.32) col = mix(pal.light, pal.hi, 0.5 + 0.4 * (1 - t), 0.8 - 0.35 * t);
      else if (lit > 0.05) col = mix(pal.base, pal.light, 0.6, 0.55);
      else if (lit > -0.35) col = mix(pal.shade, pal.base, 0.3, 0.45);
      else col = mix(pal.deep, pal.shade, 0.3, 0.55);
      dab(ctx, x, y, len, len * 0.3, ang, col);
    }
    // ふくらみの境目に暗い筋（葉の房の重なり）
    for (const a of c.bumps) {
      if (Math.sin(a) < 0.2) continue; // 下側だけ
      const d = c.r * 0.7;
      dab(ctx, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.92, c.r * 0.26, c.r * 0.05, a + Math.PI / 2, mix(pal.deep, pal.out, 0.3, 0.55));
    }
  }

  // 全体の下側を沈める（地面へ向かって暗く）
  const ug = ctx.createLinearGradient(0, top + span * 0.5, 0, bottom);
  ug.addColorStop(0, mix(pal.deep, pal.deep, 0, 0));
  ug.addColorStop(1, mix(pal.deep, pal.out, 0.3, 0.5));
  ctx.fillStyle = ug;
  ctx.fillRect(-100, top, 300, span + 2);
  ctx.restore();
  // 輪郭の外へ少しだけ出る葉先（硬い円の縁をやぶる）
  for (const c of clumps) {
    for (const a of c.bumps) {
      if (rnd() > 0.35) continue;
      const x = c.x + Math.cos(a) * (c.r + 0.1);
      const y = c.y + Math.sin(a) * (c.r + 0.1) * 0.92;
      if (clumps.some((o) => o !== c && Math.hypot(x - o.x, y - o.y) < o.r * 0.95)) continue; // 外周だけ
      const lit = -(Math.cos(a) * 0.6 + Math.sin(a) * 0.8);
      dab(ctx, x, y, c.r * 0.22, c.r * 0.06, a + (rnd() - 0.5) * 0.6, lit > 0.2 ? mix(pal.base, pal.light, 0.5) : pal.shade);
    }
  }
}

// ---------------------------------------------------------------------------
// 幹

interface TrunkOpt {
  /** 根元の左右へ張り出す量。 */
  flare: number;
  /** 樹皮の縦すじの本数。 */
  streaks: number;
  /** 幹の S 字のねじれ（px）。 */
  twist?: number;
  /** 梢へ伸びる 2 本の枝。 */
  branches?: boolean;
  /** 手前へ張り出す根（本数）。 */
  frontRoots?: number;
}

function trunkPath(ctx: Ctx, cx: number, gy: number, ty: number, bw: number, o: TrunkOpt): void {
  const tw = bw * 0.58;
  const tq = o.twist ?? 0;
  const f = o.flare;
  const midY = (ty + gy) / 2;
  ctx.beginPath();
  ctx.moveTo(cx - tw / 2, ty);
  ctx.lineTo(cx + tw / 2, ty);
  // 右の縁: ねじれ → 根元で張り出す
  ctx.bezierCurveTo(cx + tw / 2 + tq, midY, cx + bw / 2 - tq * 0.3, gy - bw * 0.55, cx + bw / 2 + f * 0.35, gy - bw * 0.18);
  ctx.quadraticCurveTo(cx + bw / 2 + f * 0.8, gy - 0.8, cx + bw / 2 + f, gy - 0.1);
  // 下の縁: 根のふくらみ
  ctx.quadraticCurveTo(cx + bw * 0.42, gy + 0.5, cx + bw * 0.2, gy - 0.5);
  ctx.quadraticCurveTo(cx, gy + 0.9, cx - bw * 0.2, gy - 0.5);
  ctx.quadraticCurveTo(cx - bw * 0.42, gy + 0.5, cx - bw / 2 - f, gy - 0.1);
  // 左の縁
  ctx.quadraticCurveTo(cx - bw / 2 - f * 0.8, gy - 0.8, cx - bw / 2 - f * 0.35, gy - bw * 0.18);
  ctx.bezierCurveTo(cx - bw / 2 - tq * 0.3, gy - bw * 0.55, cx - tw / 2 + tq, midY, cx - tw / 2, ty);
  ctx.closePath();
}

function paintTrunk(ctx: Ctx, cx: number, gy: number, ty: number, bw: number, bark: Bark, o: TrunkOpt, rnd: () => number): void {
  const f = o.flare;
  // 枝（幹より先に描き、梢に隠れる）
  if (o.branches) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * bw * 0.05, ty + (gy - ty) * 0.35);
      ctx.quadraticCurveTo(cx + s * bw * 0.35, ty + 1, cx + s * bw * 0.95, ty - (gy - ty) * 0.35);
      ctx.lineWidth = bw * 0.34;
      ctx.strokeStyle = bark.out;
      ctx.stroke();
      ctx.lineWidth = bw * 0.34 - 1.4;
      ctx.strokeStyle = s < 0 ? bark.base : bark.dark;
      ctx.stroke();
    }
  }
  trunkPath(ctx, cx, gy, ty, bw, o);
  const g = ctx.createLinearGradient(cx - bw / 2 - f, 0, cx + bw / 2 + f, 0);
  g.addColorStop(0, bark.base);
  g.addColorStop(0.22, bark.light);
  g.addColorStop(0.5, bark.base);
  g.addColorStop(0.9, bark.dark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 樹皮の縦すじ（根元で外へ開く）
  for (let i = 0; i < o.streaks; i++) {
    const u = (i + 0.5) / o.streaks - 0.5 + (rnd() - 0.5) * 0.12; // -0.5..0.5
    const x0 = cx + u * bw * 0.55;
    const x1 = cx + u * (bw + f * 1.6);
    const y0 = ty + rnd() * (gy - ty) * 0.25;
    const y1 = gy - rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + (o.twist ?? 0) * 0.6, (y0 + y1) / 2, x1 - u * 2, y1 - 4, x1, y1);
    ctx.lineWidth = 0.45 + rnd() * 0.35;
    ctx.strokeStyle = mix(bark.dark, bark.out, 0.5, u > 0.15 ? 0.75 : 0.5);
    ctx.stroke();
    if (u < 0) {
      ctx.beginPath();
      ctx.moveTo(x0 + 0.7, y0 + 2);
      ctx.bezierCurveTo(x0 + 0.7, (y0 + y1) / 2, x1 + 0.6, y1 - 5, x1 + 0.6, y1 - 1.5);
      ctx.lineWidth = 0.35;
      ctx.strokeStyle = mix(bark.light, '#ffffff', 0.25, 0.45);
      ctx.stroke();
    }
  }
  // 手前の根
  for (let i = 0; i < (o.frontRoots ?? 0); i++) {
    const u = ((i + 0.5) / (o.frontRoots ?? 1) - 0.5) * 1.1;
    const x = cx + u * bw;
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.12, gy - bw * 0.5);
    ctx.quadraticCurveTo(x + u * 2, gy - 1, x + u * 3, gy + 0.6);
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = mix(bark.dark, bark.out, 0.4, 0.8);
    ctx.stroke();
  }
  // 梢の落とす影
  const sg = ctx.createLinearGradient(0, ty, 0, ty + (gy - ty) * 0.55);
  sg.addColorStop(0, 'rgba(20,14,8,0.5)');
  sg.addColorStop(1, 'rgba(20,14,8,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cx - bw, ty - 1, bw * 2, gy - ty);
  ctx.restore();
  trunkPath(ctx, cx, gy, ty, bw, o);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = bark.out;
  ctx.stroke();
}

/** 幹に巻きつくツタ（境界の木の目印）。 */
function paintIvy(ctx: Ctx, cx: number, gy: number, ty: number, bw: number, rnd: () => number): void {
  const h = gy - ty;
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.45, gy - 1.5);
  ctx.bezierCurveTo(cx + bw * 0.5, gy - h * 0.25, cx - bw * 0.5, gy - h * 0.55, cx + bw * 0.25, ty + 2);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#3d6e2b';
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.4) / 6;
    const x = cx + Math.sin(t * Math.PI * 2.2 + 0.4) * bw * 0.38;
    const y = gy - 1.5 - t * (h - 3);
    const a = (rnd() - 0.5) * 1.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(0.8, 0.8);
    ctx.beginPath();
    ctx.moveTo(0, 1.4);
    ctx.bezierCurveTo(-2.4, 0, -1.6, -2.2, 0, -1);
    ctx.bezierCurveTo(1.6, -2.2, 2.4, 0, 0, 1.4);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? IVY : IVY_LIGHT;
    ctx.fill();
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = '#2f5a22';
    ctx.stroke();
    ctx.restore();
  }
}

/** 苔のかたまり（根・幹の上）。 */
function mossPatch(ctx: Ctx, x: number, y: number, rx: number, ry: number, rnd: () => number): void {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const u = (i / 4 - 0.5) * 2;
    circle(ctx, x + u * rx * 0.7, y + Math.abs(u) * ry * 0.3, ry * (0.75 + rnd() * 0.4));
  }
  ctx.fillStyle = MOSS;
  ctx.fill();
  for (let i = 0; i < 4; i++) dab(ctx, x + (rnd() - 0.6) * rx, y - ry * 0.3 + (rnd() - 0.5) * ry * 0.6, ry * 1.1, ry * 0.25, (rnd() - 0.5) * 0.8, MOSS_LIGHT);
}

/** 梢から垂れ下がる苔（森の主）。細い筋を 3 本、先ほど細く。 */
function hangingMoss(ctx: Ctx, x: number, y: number, len: number, rnd: () => number): void {
  for (let k = 0; k < 3; k++) {
    const l = len * (0.55 + rnd() * 0.45);
    const x0 = x + (k - 1) * 0.9;
    const sway = (rnd() - 0.5) * 2.4;
    ctx.beginPath();
    ctx.moveTo(x0, y - 1);
    ctx.bezierCurveTo(x0 + sway, y + l * 0.35, x0 - sway, y + l * 0.7, x0 + sway * 0.4 + (k - 1) * 0.8, y + l);
    ctx.lineWidth = 0.75 - k * 0.12;
    ctx.strokeStyle = k === 1 ? 'rgba(122,150,84,0.95)' : 'rgba(84,110,62,0.9)';
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// 樹種

/** Lv0 若木（32 × 46）: 小さく明るい丸い木。 */
export const paintTree = (ctx: Ctx): void => {
  const rnd = rng(11);
  paintTrunk(ctx, 16, 45.4, 30, 6.4, B_YOUNG, { flare: 1.6, streaks: 3, branches: false }, rnd);
  paintCrown(
    ctx,
    makeClumps(
      [
        [16, 26.5, 6.6],
        [9.8, 23.5, 6.8],
        [22.2, 23.5, 6.8],
        [16, 20.5, 9.2],
        [11.5, 14.5, 7.2],
        [20.5, 14, 7.2],
        [16, 9.5, 6.4],
      ],
      rnd,
    ),
    F_YOUNG,
    rnd,
    { outline: 1.0 },
  );
};

const OAK_PUFFS: readonly Puff[] = [
  [8.5, 38.5, 6.8],
  [33.5, 38.5, 6.8],
  [21, 40.5, 7.8],
  [10, 30.5, 8.6],
  [32, 30.5, 8.6],
  [21, 29, 10.5],
  [13, 20.5, 9],
  [29, 20, 9],
  [21, 15.5, 9],
  [14.5, 10.5, 6.6],
  [27.5, 10, 6.6],
];

function oak(ctx: Ctx, gate: boolean): void {
  // 42 × 64
  const rnd = rng(gate ? 23 : 21);
  paintTrunk(ctx, 21, 63.4, 42, 10.5, B_OAK, { flare: 3.4, streaks: 5, branches: true, frontRoots: 2, twist: 0.8 }, rnd);
  if (gate) paintIvy(ctx, 21, 63.4, 46, 10.5, rnd);
  paintCrown(ctx, makeClumps(OAK_PUFFS, rnd), F_OAK, rnd);
}

/** Lv1 カシの木（42 × 64）: 背の高い深緑の広葉樹。 */
export const paintBigTree = (ctx: Ctx): void => oak(ctx, false);
/** 境界の木（Lv1）: カシの木にツタ。 */
export const paintGateOak = (ctx: Ctx): void => oak(ctx, true);

// --- スギ（段になった枝葉） ---

/**
 * スギの 1 段。頂点から左右へ、枝先の房で波打つ縁を下ろし、下の縁は垂れた葉先の房。
 * 左右の幅・頂点の位置は段ごとに少しずらす（同じ rnd なら毎回同じ形）。
 */
function tierPath(ctx: Ctx, cx: number, ty: number, by: number, hw: number, droop: number, rnd: () => number, grow = 0): void {
  const ax = cx + (rnd() - 0.5) * 1.4;
  const hwR = hw * (0.9 + rnd() * 0.2) + grow;
  const hwL = hw * (0.9 + rnd() * 0.2) + grow;
  const h = by - ty;
  const side = (sgn: number, hw2: number, down: boolean) => {
    // 頂点 → 端（down=true）または 端 → 頂点
    const pts = [0.38, 0.7, 1];
    const at = (f: number): [number, number] => {
      // 外へふくらむ弧の上の点
      const x = ax + sgn * hw2 * f;
      const y = ty - grow + h * (Math.pow(f, 1.25) * 0.98);
      return [x, y];
    };
    const seq = down ? pts : [...pts].reverse().slice(1).concat([0]);
    let prevF = down ? 0 : 1;
    for (const f of seq) {
      const fm = (prevF + f) / 2;
      const [mx, my] = at(fm);
      const bulge = 1 + rnd() * 1.3 + grow;
      const [x, y] = at(f);
      ctx.quadraticCurveTo(mx + sgn * bulge, my + bulge * 0.6, x, y - (f === 0 || f === 1 ? 0 : 0.6));
      prevF = f;
    }
  };
  ctx.moveTo(ax, ty - grow);
  side(1, hwR, true);
  // 下の縁: 右から左へ、垂れた葉先の房
  const n = Math.max(4, Math.round((hwL + hwR) / 5.5));
  const xR = ax + hwR;
  const xL = ax - hwL;
  for (let i = 0; i < n; i++) {
    const x0 = xR + ((xL - xR) * i) / n;
    const x1 = xR + ((xL - xR) * (i + 1)) / n;
    const u0 = ((x0 - ax) / (x0 > ax ? hwR : hwL));
    const u1 = ((x1 - ax) / (x1 > ax ? hwR : hwL));
    const yOf = (u: number) => by + droop * (1 - u * u) - 1 + grow * 0.3;
    const jag = 1 + rnd() * 2.2 + grow;
    ctx.bezierCurveTo(x0 - 0.2, yOf(u0) + jag, x1 + 0.2, yOf(u1) + jag, x1, yOf(u1) - rnd() * 0.6);
  }
  side(-1, hwL, false);
  ctx.closePath();
}

function paintCedarTiers(ctx: Ctx, cx: number, tiers: readonly (readonly [number, number, number])[], pal: Foliage, rnd: () => number): void {
  const seeds = tiers.map(() => (rnd() * 1e9) | 0);
  // 外形の輪郭
  ctx.beginPath();
  tiers.forEach(([ty, by, hw], i) => tierPath(ctx, cx, ty, by, hw, 2.6, rng(seeds[i]!), 0.3));
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = mix(pal.out, pal.deep, 0.25, 0.9);
  ctx.stroke();
  ctx.fillStyle = pal.deep;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  tiers.forEach(([ty, by, hw], i) => tierPath(ctx, cx, ty, by, hw, 2.6, rng(seeds[i]!), 0.3));
  ctx.clip();
  const top = tiers[tiers.length - 1]![0];
  const bottom = tiers[0]![1];
  // 下の段から順に（上の段が下の段に影を落とす）
  tiers.forEach(([ty, by, hw], i) => {
    const t = (ty - top) / (bottom - top);
    // 影
    ctx.save();
    ctx.translate(0.8, 1.8);
    ctx.beginPath();
    tierPath(ctx, cx, ty, by, hw, 2.6, rng(seeds[i]!));
    ctx.fillStyle = mix(pal.deep, pal.out, 0.5, 0.6);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    tierPath(ctx, cx, ty, by, hw, 2.6, rng(seeds[i]!));
    const g = ctx.createLinearGradient(cx - hw, ty, cx + hw * 0.8, by + 2);
    g.addColorStop(0, mix(pal.light, pal.hi, 0.3 * (1 - t)));
    g.addColorStop(0.45, mix(pal.base, pal.light, 0.3 * (1 - t)));
    g.addColorStop(1, mix(pal.shade, pal.deep, 0.5));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 段の下側の暗がり
    ctx.fillStyle = mix(pal.deep, pal.out, 0.2, 0.55);
    ctx.beginPath();
    ctx.ellipse(cx + hw * 0.15, by + 3.2, hw * 1.05, (by - ty) * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // 枝葉のすじ（中心から外下へ流れる筆跡）
    const r2 = rng(seeds[i]! + 7);
    const n = Math.round(hw * 1.7);
    for (let k = 0; k < n; k++) {
      const u = (r2() - 0.5) * 2;
      const y = ty + (by - ty) * (0.35 + r2() * 0.55);
      const x = cx + u * hw * ((y - ty) / (by - ty)) * 0.9;
      const ang = Math.PI / 2 - u * 0.9;
      const lit = u < 0.1;
      dab(ctx, x, y, 2.6 + r2() * 2.2, 0.5, ang, lit ? mix(pal.light, pal.hi, 0.5, 0.7 - 0.3 * t) : mix(pal.shade, pal.deep, 0.5, 0.6));
    }
    // 下の縁に沿った葉先の房（下向きの短い筆跡）
    for (let x = cx - hw + 1.5; x < cx + hw - 1; x += 1.6 + r2()) {
      const u = (x - cx) / hw;
      const y = by + 2.6 * (1 - u * u) - 1.8 - r2() * 1.2;
      dab(ctx, x, y, 2.2 + r2() * 1.2, 0.45, Math.PI / 2 - u * 0.6 + (r2() - 0.5) * 0.5, u < -0.1 ? mix(pal.base, pal.light, 0.6, 0.8) : mix(pal.shade, pal.base, 0.3, 0.7));
    }
    ctx.restore();
  });
  ctx.restore();
}

function cedar(ctx: Ctx, gate: boolean): void {
  // 40 × 82
  const rnd = rng(gate ? 33 : 31);
  const cx = 20;
  paintTrunk(ctx, cx, 81.4, 58, 9, B_CEDAR, { flare: 3, streaks: 7, frontRoots: 2 }, rnd);
  if (gate) paintIvy(ctx, cx, 81.4, 64, 9, rnd);
  paintCedarTiers(
    ctx,
    cx,
    [
      [44, 65, 16.2],
      [34, 54, 14.2],
      [24.5, 43, 12],
      [15.5, 32, 9.6],
      [7.5, 21, 7],
      [1.6, 11.5, 4.2],
    ],
    F_CEDAR,
    rnd,
  );
}

/** Lv2 スギの大木（40 × 82）: 濃い青緑の段になった針葉樹、赤みのある樹皮。 */
export const paintCedarTree = (ctx: Ctx): void => cedar(ctx, false);
export const paintGateCedar = (ctx: Ctx): void => cedar(ctx, true);

// --- 森の主 ---

// 横に広いドーム形（上で大きく張り、下は枝と太い幹が見える）
const ANCIENT_PUFFS: readonly Puff[] = [
  [12.5, 41.5, 7.4],
  [33, 41, 7.8],
  [22.5, 43, 8.4],
  [5.8, 30.5, 6.4],
  [39.4, 31.5, 6.2],
  [13, 29, 10],
  [32.5, 28.5, 10],
  [22.5, 32, 11],
  [8.6, 19.5, 8.4],
  [37, 20.5, 8],
  [22.5, 18, 11.2],
  [14, 10.5, 7.6],
  [31, 11, 7.4],
  [22, 7.6, 7.2],
];

function ancient(ctx: Ctx, variant: 0 | 1): void {
  // 45 × 86（ancientAt で 6 上へずらす）
  const rnd = rng(variant ? 57 : 51);
  const cx = 22.5;
  const gy = 85.4;
  const ty = 55;
  const bw = 16;
  // 横へ這う大きな根
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * bw * 0.2, gy - 12);
    ctx.bezierCurveTo(cx + s * bw * 0.6, gy - 10, cx + s * (bw * 0.6 + 4), gy - 4, cx + s * (bw * 0.5 + 9.5), gy - 0.3);
    ctx.quadraticCurveTo(cx + s * (bw * 0.5 + 4), gy + 0.6, cx + s * bw * 0.15, gy - 1);
    ctx.closePath();
    const rg = ctx.createLinearGradient(0, gy - 12, 0, gy);
    rg.addColorStop(0, s < 0 ? B_ANCIENT.light : B_ANCIENT.base);
    rg.addColorStop(1, s < 0 ? B_ANCIENT.base : B_ANCIENT.dark);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = B_ANCIENT.out;
    ctx.stroke();
  }
  const twist = variant ? -3.2 : 3.2;
  paintTrunk(ctx, cx, gy, ty, bw, B_ANCIENT, { flare: 5, streaks: 9, twist, branches: true, frontRoots: 3 }, rnd);
  // うろ（幹の穴）
  const hx = cx + (variant ? 3 : -2.5);
  ell(ctx, hx, gy - 14, 2.1, 3.1, '#120d0a', B_ANCIENT.out, 0.6);
  ell(ctx, hx - 0.4, gy - 14.8, 1.1, 1.5, 'rgba(255,255,255,0.06)');
  // 苔
  mossPatch(ctx, cx - bw * 0.7, gy - 3.4, 4.4, 2, rnd);
  mossPatch(ctx, cx + bw * 0.75, gy - 2.8, 3.8, 1.7, rnd);
  mossPatch(ctx, cx + (variant ? -3 : 3), ty + 6, 3.4, 1.6, rnd);
  // 2 本目は左右反転した配置（光の向きは変えない）
  const puffs = ANCIENT_PUFFS.map(([x, y, r]) => [cx + (variant ? cx - x : x - cx) * 0.88, y + 7 + (rnd() - 0.5) * 1.6, r * (0.92 + rnd() * 0.1)] as const);
  paintCrown(ctx, makeClumps(puffs, rnd, 1.4), F_ANCIENT, rnd, { outline: 1.4, dabs: 0.9 });
  // 垂れ下がる苔
  for (const [x, y, len] of [
    [9.5, 53, 8],
    [16, 56, 6],
    [29.5, 56, 7],
    [36, 53.5, 9],
    [4.4, 42, 6],
    [40.6, 43, 5],
  ] as const) {
    hangingMoss(ctx, variant ? 45 - x : x, y, len, rnd);
  }
}

/** Lv5 森の主（45 × 80。86 の高さで描いて上の余白 6 を詰める）: 黒に近い緑の巨木。 */
function ancientAt(variant: 0 | 1): (ctx: Ctx) => void {
  return (ctx) => {
    ctx.save();
    ctx.translate(0, -6);
    ancient(ctx, variant);
    ctx.restore();
  };
}
export const paintAncientTree = ancientAt(0);
export const paintAncientTree2 = ancientAt(1);

// ---------------------------------------------------------------------------
// 切り株（樹種ごと。幹を切るのにも同じ段階が要るので、切り株でも樹種が分かるように）

interface StumpSpec {
  bark: Bark;
  /** 切り口の横半径。 */
  rx: number;
  /** 側面の高さ。 */
  h: number;
  flare: number;
  sprout?: boolean;
  moss?: boolean;
  mushroom?: boolean;
  streaks: number;
}

function paintStumpOf(s: StumpSpec, w: number, hgt: number): (ctx: Ctx) => void {
  return (ctx) => {
    const rnd = rng(Math.round(s.rx * 100));
    const cx = w / 2;
    const gy = hgt - 0.6;
    const ry = s.rx * 0.42;
    const topY = gy - s.h - ry * 0.3;
    const b = s.bark;
    // 側面（根元で張り出す）
    ctx.beginPath();
    ctx.moveTo(cx - s.rx, topY);
    ctx.quadraticCurveTo(cx - s.rx, gy - 2.5, cx - s.rx - s.flare, gy - 0.2);
    ctx.quadraticCurveTo(cx - s.rx * 0.5, gy + 0.4, cx - s.rx * 0.25, gy - 0.6);
    ctx.quadraticCurveTo(cx, gy + 1.1, cx + s.rx * 0.25, gy - 0.6);
    ctx.quadraticCurveTo(cx + s.rx * 0.5, gy + 0.4, cx + s.rx + s.flare, gy - 0.2);
    ctx.quadraticCurveTo(cx + s.rx, gy - 2.5, cx + s.rx, topY);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - s.rx - s.flare, 0, cx + s.rx + s.flare, 0);
    g.addColorStop(0, b.base);
    g.addColorStop(0.25, b.light);
    g.addColorStop(0.55, b.base);
    g.addColorStop(0.95, b.dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let i = 0; i < s.streaks; i++) {
      const u = (i + 0.5) / s.streaks - 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + u * s.rx * 1.8, topY + 1 + rnd() * 1.5);
      ctx.quadraticCurveTo(cx + u * s.rx * 1.9, gy - 2, cx + u * (s.rx + s.flare) * 2, gy);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = mix(b.dark, b.out, 0.5, 0.65);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = b.out;
    ctx.stroke();
    // 切り口
    ctx.beginPath();
    ctx.ellipse(cx, topY, s.rx, ry, 0, 0, Math.PI * 2);
    const cg = ctx.createRadialGradient(cx - s.rx * 0.3, topY - ry * 0.3, 0, cx, topY, s.rx);
    cg.addColorStop(0, mix(b.cut, '#ffffff', 0.25));
    cg.addColorStop(1, b.cut);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = b.out;
    ctx.stroke();
    // 樹皮の縁
    ctx.beginPath();
    ctx.ellipse(cx, topY, s.rx - 0.7, ry - 0.45, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = b.base;
    ctx.stroke();
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = b.ring;
    for (const k of [0.72, 0.5, 0.28]) {
      ctx.beginPath();
      ctx.ellipse(cx + 0.3, topY + 0.1, s.rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // ひび
    ctx.beginPath();
    ctx.moveTo(cx + 0.3, topY + 0.1);
    ctx.lineTo(cx + s.rx * 0.55, topY - ry * 0.35);
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = mix(b.ring, b.dark, 0.5);
    ctx.stroke();
    if (s.moss) {
      mossPatch(ctx, cx - s.rx * 0.55, topY + ry * 0.5, s.rx * 0.45, 1.6, rnd);
      mossPatch(ctx, cx + s.rx + s.flare * 0.4, gy - 1.6, 2.4, 1.3, rnd);
    }
    if (s.mushroom) {
      // 小さなキノコ
      const mx = cx + s.rx * 0.75;
      const my = gy - 2;
      ctx.beginPath();
      ctx.moveTo(mx - 0.7, my);
      ctx.lineTo(mx - 0.5, my - 2.6);
      ctx.lineTo(mx + 0.5, my - 2.6);
      ctx.lineTo(mx + 0.7, my);
      ctx.closePath();
      fillStroke(ctx, '#efe2c4', '#6b5640', 0.4);
      ctx.beginPath();
      ctx.ellipse(mx, my - 2.8, 2.2, 1.4, 0, Math.PI, 0);
      ctx.closePath();
      fillStroke(ctx, '#c9714c', '#5d2f1f', 0.45);
      ell(ctx, mx - 0.8, my - 3.4, 0.4, 0.3, 'rgba(255,240,220,0.9)');
    }
    if (s.sprout) {
      leaf(ctx, cx + s.rx - 0.8, topY + 2.6, 3.8, 0.7, 1.5, F_YOUNG.base, F_YOUNG.out);
      leaf(ctx, cx + s.rx - 0.8, topY + 2.6, 3.1, 1.5, 1.3, F_YOUNG.light, F_YOUNG.out);
    }
  };
}

/** 切り株。若木 22×16、カシ 28×20、スギ 26×20、森の主 30×24 */
export const paintStump = paintStumpOf({ bark: B_YOUNG, rx: 6, h: 4.5, flare: 1.4, sprout: true, streaks: 3 }, 22, 16);
export const paintStumpOak = paintStumpOf({ bark: B_OAK, rx: 8.6, h: 6, flare: 2.6, streaks: 5 }, 28, 20);
export const paintStumpCedar = paintStumpOf({ bark: B_CEDAR, rx: 7.8, h: 6.6, flare: 2.4, streaks: 7 }, 26, 20);
export const paintStumpAncient = paintStumpOf({ bark: B_ANCIENT, rx: 10.4, h: 7.5, flare: 3, moss: true, mushroom: true, streaks: 7 }, 30, 24);

function mound(ctx: Ctx, cx: number, cy: number, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, rx * 0.4, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - rx * 0.2, 0, cx, cy, rx);
  g.addColorStop(0, '#b4835a');
  g.addColorStop(1, '#8a5d3d');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#6b4630';
  ctx.stroke();
  ell(ctx, cx - rx * 0.3, cy - rx * 0.12, rx * 0.35, rx * 0.12, 'rgba(255,230,200,0.3)');
}

/** グラデーションの葉（苗木用）。 */
function softLeaf(ctx: Ctx, x: number, y: number, len: number, ang: number, wid: number, pal: Foliage): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid * 1.1, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
  ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid * 1.1, -len * 0.25, 0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(-wid, -len, wid, 0);
  g.addColorStop(0, pal.light);
  g.addColorStop(1, pal.shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = pal.out;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.1);
  ctx.quadraticCurveTo(wid * 0.15, -len * 0.5, 0, -len * 0.8);
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = mix(pal.hi, '#ffffff', 0.3, 0.7);
  ctx.stroke();
  ctx.restore();
}

/** 苗木（土の小山から細い幹と若葉。育つと若木になる）。20 × 22 */
export const paintSapling = (ctx: Ctx): void => {
  const cx = 10;
  const gy = 19.5;
  mound(ctx, cx, gy, 7);
  ctx.beginPath();
  ctx.moveTo(cx - 0.2, gy - 0.8);
  ctx.quadraticCurveTo(cx + 1, gy - 6.5, cx, gy - 12);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = B_YOUNG.out;
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = B_YOUNG.base;
  ctx.stroke();
  softLeaf(ctx, cx + 0.3, gy - 6, 6.5, -1.15, 2.6, F_YOUNG);
  softLeaf(ctx, cx + 0.5, gy - 8.2, 6.8, 1.05, 2.7, F_YOUNG);
  softLeaf(ctx, cx, gy - 11.2, 7.4, -0.35, 3, F_YOUNG);
  softLeaf(ctx, cx, gy - 11.2, 6.2, 0.45, 2.6, F_YOUNG);
};

// ---------------------------------------------------------------------------
// 花（採れる株。1 マスに 1 つ）。26 × 26、根元は (13, 25.5)

const STEM = '#4f9a43';
const FLEAF = '#7fcb58';

function stem(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + 0.6, (y0 + y1) / 2, x1, y1);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = STEM;
  ctx.stroke();
}

function baseLeaves(ctx: Ctx, cx: number, gy: number): void {
  ell(ctx, cx, gy - 0.6, 8.5, 2.2, 'rgba(70,120,50,0.25)');
  for (const [a, len] of [[-1.15, 8], [-0.6, 9.5], [0.6, 9.5], [1.15, 8], [0, 7]] as const) {
    leaf(ctx, cx, gy - 0.5, len, a, 2.8, FLEAF, STEM);
  }
}

function tulip(ctx: Ctx, x: number, y: number, col: string, dark: string): void {
  ctx.beginPath();
  ctx.moveTo(x - 3.2, y - 3.4);
  ctx.lineTo(x - 1.6, y - 1.6);
  ctx.lineTo(x, y - 3.8);
  ctx.lineTo(x + 1.6, y - 1.6);
  ctx.lineTo(x + 3.2, y - 3.4);
  ctx.quadraticCurveTo(x + 3.6, y + 2.6, x, y + 2.8);
  ctx.quadraticCurveTo(x - 3.6, y + 2.6, x - 3.2, y - 3.4);
  ctx.closePath();
  fillStroke(ctx, col, dark, 0.6);
  ell(ctx, x - 1.4, y - 0.3, 0.7, 1.4, 'rgba(255,255,255,0.55)');
}

function roundFlower(ctx: Ctx, x: number, y: number, r: number, petal: string, edge: string, center: string, n = 5): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    circle(ctx, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.5);
  }
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.fillStyle = petal;
  ctx.fill();
  ell(ctx, x, y, r * 0.34, r * 0.34, center);
  ell(ctx, x - r * 0.12, y - r * 0.12, r * 0.12, r * 0.12, 'rgba(255,255,255,0.7)');
}

function bell(ctx: Ctx, x: number, y: number): void {
  // 下向きの釣り鐘
  ctx.beginPath();
  ctx.moveTo(x - 0.9, y - 2.6);
  ctx.quadraticCurveTo(x - 2.8, y - 1.6, x - 2.6, y + 1.6);
  ctx.quadraticCurveTo(x - 1.3, y + 0.8, x, y + 1.8);
  ctx.quadraticCurveTo(x + 1.3, y + 0.8, x + 2.6, y + 1.6);
  ctx.quadraticCurveTo(x + 2.8, y - 1.6, x + 0.9, y - 2.6);
  ctx.closePath();
  fillStroke(ctx, '#8fb8ff', '#4b6fc4', 0.6);
  ell(ctx, x - 1, y - 0.8, 0.5, 1, 'rgba(255,255,255,0.6)');
}

export function paintFlower(variant: 0 | 1 | 2 | 3): (ctx: Ctx) => void {
  return (ctx) => {
    const cx = 13;
    const gy = 25.5;
    switch (variant) {
      case 0: {
        // ピンクのチューリップ
        for (const [x, y] of [[7.5, 11], [13, 7], [18.5, 11.5]] as const) stem(ctx, cx, gy - 1, x, y + 2);
        baseLeaves(ctx, cx, gy);
        tulip(ctx, 7.5, 11, '#ff9ec4', '#c95887');
        tulip(ctx, 18.5, 11.5, '#ffb3d1', '#c95887');
        tulip(ctx, 13, 7, '#ff86b4', '#c24a7c');
        break;
      }
      case 1: {
        // 黄色いデイジー
        for (const [x, y] of [[7, 12], [13.5, 7], [19, 12.5]] as const) stem(ctx, cx, gy - 1, x, y);
        baseLeaves(ctx, cx, gy);
        roundFlower(ctx, 7, 12, 5, '#ffe066', '#d7a21b', '#ff9a3d', 6);
        roundFlower(ctx, 19, 12.5, 4.6, '#fff0a0', '#d7a21b', '#ff9a3d', 6);
        roundFlower(ctx, 13.5, 7, 5.4, '#ffd84a', '#d7a21b', '#ff8a2d', 6);
        break;
      }
      case 2: {
        // 青い釣り鐘草
        ctx.lineWidth = 1;
        for (const [x0, y0, x1, y1] of [[cx, gy - 1, 8, 5], [cx, gy - 1, 19, 7]] as const) {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(x1 - (x1 - x0) * 0.2, y1 + 6, x1, y1);
          ctx.strokeStyle = STEM;
          ctx.stroke();
        }
        baseLeaves(ctx, cx, gy);
        for (const [x, y] of [[7.5, 9.5], [11, 13], [19.5, 11], [16, 14.5]] as const) bell(ctx, x, y);
        break;
      }
      case 3: {
        // 赤と白の小花
        for (const [x, y] of [[7, 13], [12, 7.5], [18.5, 10.5], [15, 15]] as const) stem(ctx, cx, gy - 1, x, y);
        baseLeaves(ctx, cx, gy);
        roundFlower(ctx, 7, 13, 4.6, '#ff6b6b', '#b8343a', '#ffe28a');
        roundFlower(ctx, 18.5, 10.5, 4.6, '#ffffff', '#c9a8a8', '#ffcf5a');
        roundFlower(ctx, 12, 7.5, 5, '#ff5a6a', '#b8343a', '#ffe28a');
        roundFlower(ctx, 15, 15.5, 3.8, '#fff4f4', '#c9a8a8', '#ffcf5a');
        break;
      }
    }
  };
}

/** 芽を出したばかりの花（つぼみ）。16 × 14、根元 (8, 13.5) */
export const paintFlowerSprout = (ctx: Ctx): void => {
  const cx = 8;
  const gy = 13.2;
  mound(ctx, cx, gy, 5.5);
  stem(ctx, cx, gy - 0.8, cx, gy - 8);
  leaf(ctx, cx, gy - 2, 5, -1.1, 2.2, FLEAF, STEM);
  leaf(ctx, cx, gy - 3, 5, 1.1, 2.2, FLEAF, STEM);
  ell(ctx, cx, gy - 9.4, 1.8, 2.4, '#ffa9c8', '#c95887', 0.55);
  leaf(ctx, cx, gy - 7.6, 2.6, -0.5, 1.2, FLEAF, STEM);
  leaf(ctx, cx, gy - 7.6, 2.6, 0.5, 1.2, FLEAF, STEM);
};

// ---------------------------------------------------------------------------
// アイテムのアイコン（24 × 24）

export const paintItemSapling: Painter = (ctx) => {
  // 麻布で包んだ根鉢 + 苗
  ctx.beginPath();
  ctx.moveTo(6, 13);
  ctx.quadraticCurveTo(5, 21.5, 12, 21.8);
  ctx.quadraticCurveTo(19, 21.5, 18, 13);
  ctx.quadraticCurveTo(12, 15, 6, 13);
  ctx.closePath();
  fillStroke(ctx, '#e3c28c', '#9a6f42', 0.6);
  ctx.beginPath();
  ctx.moveTo(6.4, 16);
  ctx.quadraticCurveTo(12, 18, 17.6, 16);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = '#c26b5a';
  ctx.stroke();
  ell(ctx, 12, 13.2, 6, 1.6, '#8a5a3c', '#9a6f42', 0.5);
  ctx.beginPath();
  ctx.moveTo(12, 13);
  ctx.quadraticCurveTo(12.8, 9, 12, 5.5);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = STEM;
  ctx.stroke();
  leaf(ctx, 12, 10, 6.5, -1.1, 2.6, '#8fd65e', STEM);
  leaf(ctx, 12, 8.5, 6.5, 1.05, 2.6, '#8fd65e', STEM);
  leaf(ctx, 12, 6, 5.5, 0, 2.4, '#9fe06c', STEM);
};

export const paintItemFlowerSeed: Painter = (ctx) => {
  // 花の絵の付いた種袋
  ctx.beginPath();
  ctx.moveTo(5.5, 6);
  ctx.lineTo(18.5, 6);
  ctx.lineTo(18, 20.5);
  ctx.quadraticCurveTo(12, 21.8, 6, 20.5);
  ctx.closePath();
  fillStroke(ctx, '#fff3dc', '#a5784c', 0.65);
  ctx.beginPath();
  ctx.moveTo(5.5, 6);
  ctx.lineTo(7, 3.5);
  ctx.lineTo(17, 3.5);
  ctx.lineTo(18.5, 6);
  ctx.closePath();
  fillStroke(ctx, '#ffd0de', '#a5784c', 0.65);
  roundFlower(ctx, 12, 12.6, 6, '#ff8fb3', '#c95887', '#ffd84a');
  leaf(ctx, 12, 19.5, 3.6, -0.9, 1.4, FLEAF, STEM);
  leaf(ctx, 12, 19.5, 3.6, 0.9, 1.4, FLEAF, STEM);
  // こぼれた種
  for (const [x, y, a] of [[19.5, 21.5, 0.6], [21.5, 19.8, -0.4], [3.4, 21, 0.2]] as const) {
    ell(ctx, x, y, 1.2, 0.75, '#b07a45', '#7a4f2a', 0.4, a);
  }
};

export const paintItemPetal: Painter = (ctx) => {
  for (const [x, y, a, c] of [
    [8.5, 13.5, -0.6, '#ffb3cc'],
    [15.5, 11, 0.5, '#ff94b6'],
    [12, 17, 0.1, '#ffc8da'],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-5, 2, -4.4, -4.6, -1.2, -5);
    ctx.quadraticCurveTo(0, -3.6, 1.2, -5);
    ctx.bezierCurveTo(4.4, -4.6, 5, 2, 0, 5);
    ctx.closePath();
    fillStroke(ctx, c, '#c95887', 0.6);
    ctx.beginPath();
    ctx.ellipse(-1.4, -1.5, 0.9, 2, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.restore();
  }
};

type Painter = (ctx: Ctx) => void;
