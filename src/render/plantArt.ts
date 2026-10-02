// 木・花・苗など植物のベクター絵（ピグ風: ふっくら丸い樹冠、太く短い幹、やわらかい輪郭）。
// sprites.ts の PAINTERS から呼ばれる。座標はワールド px、スプライトの「下辺中央」が根元。

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Palette {
  out: string;
  shade: string;
  base: string;
  hi: string;
}

const OL = 0.85; // 輪郭の太さ

const GREEN: Palette = { out: '#3f7f34', shade: '#5fb447', base: '#86d65c', hi: '#c2f08e' };
const BIG_GREEN: Palette = { out: '#3c7a33', shade: '#56aa44', base: '#7ccf55', hi: '#b8ec88' };
const DEEP_GREEN: Palette = { out: '#2f6a3a', shade: '#4a9c4e', base: '#68bd5c', hi: '#a6e08a' };
const PINE_GREEN: Palette = { out: '#235f4a', shade: '#3b9268', base: '#55b47f', hi: '#93deaa' };
const LILAC: Palette = { out: '#6f4c94', shade: '#b48ad8', base: '#d6b0f0', hi: '#f3e0ff' };

const BARK = '#c08a55';
const BARK_DARK = '#94633a';
const BARK_OUT = '#6b4630';

// ---------------------------------------------------------------------------

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

type Puff = readonly [number, number, number];

/**
 * ふっくらした樹冠。puff（円）を重ねた外形に輪郭を付け、下側に影、左上に光を入れる。
 */
function crown(ctx: Ctx, cx: number, cy: number, puffs: readonly Puff[], pal: Palette): void {
  ctx.beginPath();
  for (const [dx, dy, r] of puffs) circle(ctx, cx + dx, cy + dy, r);
  ctx.lineWidth = OL * 2;
  ctx.strokeStyle = pal.out;
  ctx.stroke();
  ctx.fillStyle = pal.shade;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 明るい本体（左上へずらして重ねる → 右下に影の三日月が残る）
  ctx.beginPath();
  for (const [dx, dy, r] of puffs) circle(ctx, cx + dx - r * 0.1, cy + dy - r * 0.2, r * 0.9);
  ctx.fillStyle = pal.base;
  ctx.fill();
  // 下の方の puff の境目に、影の弧を入れて「もこもこ」を見せる
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = pal.shade;
  for (const [dx, dy, r] of puffs) {
    if (dy < -2) continue;
    ctx.beginPath();
    ctx.arc(cx + dx - r * 0.1, cy + dy - r * 0.2, r * 0.9, 0.15 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  }
  // 光
  ctx.fillStyle = pal.hi;
  for (const [dx, dy, r] of puffs) {
    if (dy > 2) continue;
    ctx.beginPath();
    ctx.ellipse(cx + dx - r * 0.32, cy + dy - r * 0.45, r * 0.38, r * 0.24, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 太く短い幹。根元 (cx, gy)、上端 ty、根元の幅 bw。 */
function trunk(ctx: Ctx, cx: number, gy: number, ty: number, bw: number): void {
  const tw = bw * 0.62;
  ctx.beginPath();
  ctx.moveTo(cx - tw / 2, ty);
  ctx.lineTo(cx + tw / 2, ty);
  ctx.quadraticCurveTo(cx + tw / 2, gy - 3, cx + bw / 2 + 1.4, gy - 0.6);
  ctx.quadraticCurveTo(cx + bw / 2 - 0.4, gy + 0.4, cx + bw * 0.18, gy - 0.4);
  ctx.quadraticCurveTo(cx, gy + 0.6, cx - bw * 0.18, gy - 0.4);
  ctx.quadraticCurveTo(cx - bw / 2 + 0.4, gy + 0.4, cx - bw / 2 - 1.4, gy - 0.6);
  ctx.quadraticCurveTo(cx - tw / 2, gy - 3, cx - tw / 2, ty);
  ctx.closePath();
  fillStroke(ctx, BARK, BARK_OUT);
  ctx.save();
  ctx.clip();
  // 右側の影と左の光
  ctx.fillStyle = BARK_DARK;
  ctx.fillRect(cx + tw * 0.18, ty, bw, gy - ty + 2);
  ctx.fillStyle = 'rgba(255,235,200,0.45)';
  ctx.fillRect(cx - tw * 0.36, ty, tw * 0.18, gy - ty);
  // 樹冠の落とす影
  ctx.fillStyle = 'rgba(60,40,20,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, ty + 1, bw, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 木目の小さな線
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.1, gy - 4);
  ctx.quadraticCurveTo(cx - tw * 0.2, gy - 6.5, cx - tw * 0.05, gy - 8.5);
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = BARK_OUT;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// 木

const ROUND_PUFFS: readonly Puff[] = [
  [0, -1, 11],
  [-9.5, 2, 8],
  [9.5, 2, 8],
  [-6, -9, 8.4],
  [6, -9.5, 8.4],
  [0, -13, 7],
  [-5, 7.5, 7.4],
  [5, 7.5, 7.4],
];

function paintRoundTree(pal: Palette = GREEN): (ctx: Ctx) => void {
  // 40 × 58
  return (ctx) => {
    trunk(ctx, 20, 57.4, 38, 11);
    crown(ctx, 20, 26.5, ROUND_PUFFS, pal);
  };
}

export const paintTree = paintRoundTree(GREEN);
export const paintBorderTree = (ctx: Ctx): void => {
  paintRoundTree(LILAC)(ctx);
  // 境界の木: 小さなきらめきで「通れる門」を示す
  for (const [x, y, r] of [[11, 16, 1.6], [28, 22, 1.3], [17, 33, 1.2]] as const) sparkle(ctx, x, y, r);
};
export const paintWallOak = paintRoundTree(DEEP_GREEN);

const BIG_PUFFS: readonly Puff[] = [
  [0, -1, 12.5],
  [-11, 2, 9.4],
  [11, 2, 9.4],
  [-7, -10.5, 9.6],
  [7, -11, 9.6],
  [0, -15.5, 8],
  [-6, 8.5, 8.4],
  [6, 8.5, 8.4],
];

export const paintBigTree = (ctx: Ctx): void => {
  // 46 × 68
  trunk(ctx, 23, 67.4, 46, 13);
  crown(ctx, 23, 31, BIG_PUFFS, BIG_GREEN);
  for (const [x, y] of [[13, 27.5], [31, 22.5], [22, 37.5], [33, 34.5], [17, 17.5]] as const) fruit(ctx, x, y);
};

function fruit(ctx: Ctx, x: number, y: number): void {
  ell(ctx, x, y, 2.3, 2.1, '#ff5d5d', '#a8302d', 0.6);
  ell(ctx, x - 0.7, y - 0.7, 0.7, 0.5, 'rgba(255,255,255,0.8)');
  ctx.beginPath();
  ctx.moveTo(x, y - 2);
  ctx.lineTo(x + 0.5, y - 3.1);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = '#6b4630';
  ctx.stroke();
}

function sparkle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.2, x + r * 1.6, y);
  ctx.quadraticCurveTo(x + r * 0.2, y + r * 0.2, x, y + r * 1.6);
  ctx.quadraticCurveTo(x - r * 0.2, y + r * 0.2, x - r * 1.6, y);
  ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x, y - r * 1.6);
  ctx.closePath();
  ctx.fillStyle = '#fffbea';
  ctx.fill();
}

/** 三角に重なった針葉樹（段ごとに下の縁が波打つ）。38 × 62 */
export const paintWallPine = (ctx: Ctx): void => {
  const cx = 19;
  trunk(ctx, cx, 61.4, 50, 9);
  const tiers: readonly [number, number, number][] = [
    // [上端 y, 下端 y, 半幅]
    [22, 52, 18],
    [12, 39, 14.5],
    [2, 26, 10.5],
  ];
  for (const [ty, by, hw] of tiers) tier(ctx, cx, ty, by, hw, PINE_GREEN);
};

function tierPath(ctx: Ctx, cx: number, ty: number, by: number, hw: number): void {
  const n = 4;
  ctx.beginPath();
  ctx.moveTo(cx, ty);
  ctx.quadraticCurveTo(cx + hw * 0.35, ty + (by - ty) * 0.25, cx + hw, by - 2.6);
  // 下の縁: 右から左へ、ふくらんだ波
  const step = (hw * 2) / n;
  for (let i = 0; i < n; i++) {
    const x0 = cx + hw - step * i;
    const x1 = x0 - step;
    ctx.bezierCurveTo(x0 + 0.4, by + 1.4, x1 - 0.4, by + 1.4, x1, by - 2.2 + (i === n - 1 ? -0.4 : 0));
  }
  ctx.quadraticCurveTo(cx - hw * 0.35, ty + (by - ty) * 0.25, cx, ty);
  ctx.closePath();
}

function tier(ctx: Ctx, cx: number, ty: number, by: number, hw: number, pal: Palette): void {
  tierPath(ctx, cx, ty, by, hw);
  ctx.lineWidth = OL;
  ctx.strokeStyle = pal.out;
  ctx.fillStyle = pal.base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 下側の影
  ctx.fillStyle = pal.shade;
  ctx.beginPath();
  ctx.ellipse(cx + hw * 0.25, by + 1, hw * 1.05, (by - ty) * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // 左上の光
  ctx.fillStyle = pal.hi;
  ctx.beginPath();
  ctx.ellipse(cx - hw * 0.32, ty + (by - ty) * 0.42, hw * 0.22, (by - ty) * 0.2, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  tierPath(ctx, cx, ty, by, hw);
  ctx.stroke();
}

/** 切り株（年輪つき）。26 × 18 */
export const paintStump = (ctx: Ctx): void => {
  const cx = 13;
  const gy = 17.4;
  const topY = 7;
  const rx = 8;
  const ry = 3.4;
  // 根っこ
  for (const [dx, w] of [[-8.4, -1], [8.4, 1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 0.7, gy - 5);
    ctx.quadraticCurveTo(cx + dx * 1.15, gy - 1.2, cx + dx * 1.35, gy - 0.2);
    ctx.quadraticCurveTo(cx + dx * 0.9, gy + 0.2, cx + dx * 0.7 - w, gy - 0.8);
    ctx.closePath();
    fillStroke(ctx, BARK_DARK, BARK_OUT);
  }
  // 側面
  ctx.beginPath();
  ctx.moveTo(cx - rx, topY);
  ctx.lineTo(cx - rx - 0.6, gy - 2.2);
  ctx.quadraticCurveTo(cx, gy + 1.6, cx + rx + 0.6, gy - 2.2);
  ctx.lineTo(cx + rx, topY);
  ctx.closePath();
  fillStroke(ctx, BARK, BARK_OUT);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BARK_DARK;
  ctx.fillRect(cx + 3, 0, 12, 20);
  ctx.fillStyle = 'rgba(255,235,200,0.4)';
  ctx.fillRect(cx - 6, 0, 1.6, 20);
  ctx.restore();
  // 切り口
  ell(ctx, cx, topY, rx, ry, '#f5d9a4', BARK_OUT);
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = '#c99a5e';
  for (const s of [0.68, 0.4]) {
    ctx.beginPath();
    ctx.ellipse(cx + 0.3, topY + 0.1, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ell(ctx, cx + 0.3, topY + 0.1, 0.8, 0.4, '#c99a5e');
  // 小さな新芽
  leaf(ctx, cx + rx - 0.6, topY + 3, 4.2, 0.7, 1.6, '#8fd65e', '#4f9a43');
  leaf(ctx, cx + rx - 0.6, topY + 3, 3.4, 1.5, 1.4, '#8fd65e', '#4f9a43');
};

function mound(ctx: Ctx, cx: number, cy: number, rx: number): void {
  ell(ctx, cx, cy, rx, rx * 0.4, '#a2714d', '#6b4630', 0.6);
  ell(ctx, cx - rx * 0.3, cy - rx * 0.12, rx * 0.35, rx * 0.12, 'rgba(255,230,200,0.35)');
}

/** 苗木（土の小山から葉 3 枚）。20 × 22 */
export const paintSapling = (ctx: Ctx): void => {
  const cx = 10;
  const gy = 19.5;
  mound(ctx, cx, gy, 7);
  ctx.beginPath();
  ctx.moveTo(cx, gy - 1);
  ctx.quadraticCurveTo(cx + 0.8, gy - 6, cx, gy - 11);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = '#4f9a43';
  ctx.stroke();
  leaf(ctx, cx, gy - 7, 7.5, -1.05, 3, '#8fd65e', '#4f9a43');
  leaf(ctx, cx, gy - 9, 7.5, 1.0, 3, '#8fd65e', '#4f9a43');
  leaf(ctx, cx, gy - 10.6, 8, 0.05, 3.2, '#9fe06c', '#4f9a43');
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
