// 主人公（ピグ風）をコードで描く。大きな丸い頭・小さな体・短い手足・やわらかいパステル。
//
// 座標はワールド px（1 マス = 32）。足元の中央を原点にして、上がマイナス。全高はおよそ 38。
// 毎フレーム呼ばれるので、Canvas を作らず・配列も作らず、パスだけで描く（グラデーションも使わない）。
//
// 向き: down = 正面、up = 背面（顔なし）、right = 横、left = right の左右反転。
// 腕・道具の角度は「矢状面の角度 α」で考える（0 = 真下に垂らす、π/2 = 前へ水平、π = 真上）。
// 画面上の回転 φ（0 = 上向き、時計回りが正）へは向きごとに写す（sideAngle / frontAngle / backAngle）。

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type AvatarDir = 'up' | 'down' | 'left' | 'right';
export type AvatarTool = 'axe' | 'hand' | 'hoe';

export interface AvatarPose {
  dir: AvatarDir;
  /** 歩きの位相（ラジアン）。null = 立ち止まり。 */
  walkPhase: number | null;
  /** 呼吸用の時計（ms）。 */
  idleT: number;
  /** 作業中の動き。t は動作全体（約 3 秒）の進み 0..1。 */
  action: null | { tool: AvatarTool; t: number };
}

// ---------------------------------------------------------------------------
// 配色

const OUT = '#5b3a2c';
const LW = 0.8; // 輪郭の太さ（ワールド px）
const SKIN = '#ffe3cb';
const SKIN_BACK = '#f3c9a9'; // 奥の手足
const HAIR = '#9b623d';
const HAIR_HI = '#c48c60';
const HAIR_LINE = '#7a4528';
const SHIRT = '#ffb4c4';
const SHIRT_BACK = '#f294aa';
const SHIRT_HI = 'rgba(255,255,255,0.45)';
const SHORTS = '#7fa8e6';
const SHOE = '#f0785e';
const SHOE_BACK = '#d9654d';
const SOLE = '#fff6ec';
const EYE = '#3b2620';
const BLUSH = 'rgba(255,128,128,0.42)';
const PIN = '#ffd84a';
const PIN_CENTER = '#ff8a5c';
const WOOD = '#d39a5e';
const WOOD_DARK = '#a8703f';
const METAL = '#e3e8ee';
const METAL_DARK = '#9aa4ae';

// ---------------------------------------------------------------------------
// 動作のタイミング

const STRIKES = 3;
const WIND_END = 0.45; // 振りかぶり終わり
const HIT = 0.6; // 当たる瞬間（1 回ぶんの中の位置）
const HOLD_END = 0.72;

/** 1 回の動作（t ∈ [0,1]）の中で、道具が当たる（手で引く）瞬間の t。木の揺れ・音を合わせる用。 */
export function chopImpactTimes(): number[] {
  const out: number[] = [];
  for (let i = 0; i < STRIKES; i++) out.push((i + HIT) / STRIKES);
  return out;
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
const easeIn = (x: number) => x * x;
const easeInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 1 フレームぶんの姿勢（使い回して確保しない）
const S = {
  by: 0, // 胴より上の縦ずれ（下が正）
  headBob: 0,
  lean: 0, // 足元を中心にした傾き（前が正）
  squash: 0,
  liftL: 0, // 正面・背面: 足の持ち上げ
  liftR: 0,
  legNear: 0, // 横向き: 脚の角度（前が正）
  legFar: 0,
  armA: 0, // 道具を持つ腕（手前・画面右）の α
  armB: 0, // もう片方の腕の α
  armLenA: 1,
  armLenB: 1,
  tool: null as null | 'axe' | 'hoe',
};

function computeState(pose: AvatarPose): void {
  S.by = 0;
  S.headBob = Math.sin((pose.idleT / 1700) * Math.PI * 2) * 0.28;
  S.lean = 0;
  S.squash = 0;
  S.liftL = 0;
  S.liftR = 0;
  S.legNear = 0;
  S.legFar = 0;
  S.armA = 0.12;
  S.armB = 0.12;
  S.armLenA = 1;
  S.armLenB = 1;
  S.tool = null;

  const act = pose.action;
  if (act) {
    const tt = Math.min(0.9999, Math.max(0, act.t)) * STRIKES;
    const u = tt - Math.floor(tt);
    const tool = act.tool;
    if (tool === 'hand') {
      // しゃがんで手を伸ばし、ぐっと引く × 3
      const REST = 0.35;
      const REACH = 1.35;
      const PULL = 0.15;
      let a: number;
      let crouch: number;
      if (u < 0.42) {
        const e = easeOut(u / 0.42);
        a = lerp(REST, REACH, e);
        crouch = lerp(0.6, 1.6, e);
        S.lean = lerp(0, 0.1, e);
      } else if (u < HIT) {
        const e = easeIn((u - 0.42) / (HIT - 0.42));
        a = REACH;
        crouch = 1.6;
        S.lean = 0.1;
        S.squash = 0.03 * e;
      } else if (u < 0.78) {
        const e = easeOut((u - HIT) / (0.78 - HIT));
        a = lerp(REACH, PULL, e);
        crouch = lerp(1.6, 0.4, e);
        S.lean = lerp(0.1, -0.08, e);
      } else {
        const e = easeInOut((u - 0.78) / 0.22);
        a = lerp(PULL, REST, e);
        crouch = lerp(0.4, 0.6, e);
        S.lean = lerp(-0.08, 0, e);
      }
      S.by = crouch;
      S.armA = a;
      S.armB = a * 0.8;
      S.armLenA = 1.05;
    } else {
      const REST = tool === 'axe' ? 0.75 : 0.65;
      const UP = tool === 'axe' ? 2.95 : 2.7;
      const DOWN = tool === 'axe' ? 1.3 : 0.75;
      let a: number;
      if (u < WIND_END) {
        const e = easeOut(u / WIND_END);
        a = lerp(REST, UP, e);
        S.lean = lerp(0, -0.09, e);
        S.by = lerp(0, -0.5, e);
      } else if (u < HIT) {
        const e = easeIn((u - WIND_END) / (HIT - WIND_END));
        a = lerp(UP, DOWN, e);
        S.lean = lerp(-0.09, 0.12, e);
        S.by = lerp(-0.5, 0.9, e);
      } else if (u < HOLD_END) {
        const e = (u - HIT) / (HOLD_END - HIT);
        a = DOWN + Math.sin(e * Math.PI) * 0.14; // 当たった反動
        S.lean = 0.12;
        S.by = 0.9;
        S.squash = 0.06 * (1 - e);
      } else {
        const e = easeInOut((u - HOLD_END) / (1 - HOLD_END));
        a = lerp(DOWN, REST, e);
        S.lean = lerp(0.12, 0, e);
        S.by = lerp(0.9, 0, e);
      }
      S.armA = a;
      S.armB = a * 0.85;
      S.tool = tool;
    }
    S.headBob *= 0.3;
    return;
  }

  const ph = pose.walkPhase;
  if (ph !== null) {
    const s = Math.sin(ph);
    S.by = -Math.abs(Math.cos(ph)) * 0.9 + 0.45;
    S.liftL = Math.max(0, s) * 1.6;
    S.liftR = Math.max(0, -s) * 1.6;
    S.legNear = s * 0.55;
    S.legFar = -s * 0.55;
    S.armA = 0.12 - s * 0.62;
    S.armB = 0.12 + s * 0.62;
    S.armLenA = 1 - s * 0.16;
    S.armLenB = 1 + s * 0.16;
    S.headBob *= 0.3;
  }
}

// ---------------------------------------------------------------------------
// 小さな描画部品

function ell(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline = true, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.lineWidth = LW;
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }
}

/** 太い線（手足・柄）。先に輪郭色で太く、上から本体色で細く引く。 */
function limb(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = w + LW * 2;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

function fillStroke(ctx: Ctx, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = LW;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

/** 腕。肩 (sx,sy) から画面角 φ（0 = 上、時計回り）へ伸ばす。手の位置を HX/HY に返す。 */
let HX = 0;
let HY = 0;
function arm(ctx: Ctx, sx: number, sy: number, phi: number, len: number, back: boolean, sleeve = true): void {
  const dx = Math.sin(phi);
  const dy = -Math.cos(phi);
  HX = sx + dx * len;
  HY = sy + dy * len;
  limb(ctx, sx, sy, HX, HY, 2.4, back ? SKIN_BACK : SKIN);
  if (sleeve) ell(ctx, sx + dx * 0.9, sy + dy * 0.9, 1.9, 2.15, back ? SHIRT_BACK : SHIRT, true, phi);
  ell(ctx, HX, HY, 1.55, 1.55, back ? SKIN_BACK : SKIN);
}

/** 道具。握り (hx,hy) から画面角 φ の向きへ柄を伸ばし、刃は時計回りの進行側（ローカル +x）。 */
function tool(ctx: Ctx, kind: 'axe' | 'hoe', hx: number, hy: number, phi: number, scale: number): void {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(phi);
  ctx.scale(scale, scale);
  const top = kind === 'axe' ? -11 : -13;
  limb(ctx, 0, 2.2, 0, top + 0.5, 1.5, WOOD);
  ctx.beginPath();
  if (kind === 'axe') {
    ctx.moveTo(-0.4, top - 0.9);
    ctx.lineTo(1.8, top - 1.2);
    ctx.quadraticCurveTo(4.2, top - 2.6, 5.6, top - 2.4);
    ctx.quadraticCurveTo(6.6, top + 1.4, 5.6, top + 5.2);
    ctx.quadraticCurveTo(4, top + 4.9, 1.8, top + 3.2);
    ctx.lineTo(-0.4, top + 3);
    ctx.quadraticCurveTo(-1.9, top + 1, -0.4, top - 0.9);
    ctx.closePath();
    fillStroke(ctx, METAL);
    // 刃先の光
    ctx.beginPath();
    ctx.moveTo(5.2, top - 1.4);
    ctx.quadraticCurveTo(5.9, top + 1.4, 5.1, top + 4.1);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ell(ctx, 0.7, top + 1, 0.55, 0.55, METAL_DARK, false);
  } else {
    ctx.moveTo(-0.6, top - 0.8);
    ctx.lineTo(1.2, top - 1.1);
    ctx.lineTo(6, top + 0.2);
    ctx.quadraticCurveTo(6.8, top + 2.2, 6, top + 3.6);
    ctx.lineTo(1.2, top + 1.8);
    ctx.lineTo(-0.6, top + 1.6);
    ctx.closePath();
    fillStroke(ctx, METAL);
    ctx.beginPath();
    ctx.moveTo(5.6, top + 0.8);
    ctx.lineTo(5.9, top + 3);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ell(ctx, 0.3, top + 0.4, 0.5, 0.5, WOOD_DARK, false);
  }
  ctx.restore();
}

/** 髪どめ（小さな花）。 */
function hairPin(ctx: Ctx, x: number, y: number): void {
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ell(ctx, x + Math.cos(a) * 1.35, y + Math.sin(a) * 1.35, 1.05, 1.05, PIN);
  }
  ell(ctx, x, y, 0.85, 0.85, PIN_CENTER, false);
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ell(ctx, x + Math.cos(a) * 1.35, y + Math.sin(a) * 1.35, 0.68, 0.68, PIN, false);
  }
  ell(ctx, x, y, 0.75, 0.75, PIN_CENTER, false);
  ell(ctx, x - 0.25, y - 0.3, 0.28, 0.28, '#fff3c0', false);
}

// ---------------------------------------------------------------------------
// 胴・脚

function shorts(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, fill: string): void {
  const r = 1.2;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
  ctx.lineTo(x1 + 0.2, y1 - 0.6);
  ctx.quadraticCurveTo(x1 + 0.2, y1, x1 - 0.6, y1);
  ctx.lineTo(x0 + 0.6, y1);
  ctx.quadraticCurveTo(x0 - 0.2, y1, x0 - 0.2, y1 - 0.6);
  ctx.lineTo(x0, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
  fillStroke(ctx, fill);
}

function shirt(ctx: Ctx, hw: number, bw: number, y0: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(-hw, y0);
  ctx.lineTo(hw, y0);
  ctx.quadraticCurveTo(hw + 1.2, y0 + 0.4, bw - 0.2, y0 + 3.2);
  ctx.lineTo(bw, y1 - 1);
  ctx.quadraticCurveTo(bw, y1, bw - 1, y1);
  ctx.lineTo(-bw + 1, y1);
  ctx.quadraticCurveTo(-bw, y1, -bw, y1 - 1);
  ctx.lineTo(-bw + 0.2, y0 + 3.2);
  ctx.quadraticCurveTo(-hw - 1.2, y0 + 0.4, -hw, y0);
  ctx.closePath();
  fillStroke(ctx, SHIRT);
  // 左上のつや
  ell(ctx, -bw * 0.45, y0 + 2.6, bw * 0.28, 1.2, SHIRT_HI, false, -0.2);
}

function frontLegs(ctx: Ctx, by: number, back: boolean): void {
  for (let side = -1; side <= 1; side += 2) {
    const lift = side < 0 ? S.liftL : S.liftR;
    const x = side * 2.3;
    const fy = -1.5 - lift;
    limb(ctx, x, -6.6 + by, x, fy, 2.7, SKIN);
    ell(ctx, x + side * 0.15, -1.25 - lift, 2.35, 1.45, SHOE);
    if (!back) ell(ctx, x - 0.5 + side * 0.15, -1.75 - lift, 0.8, 0.45, 'rgba(255,255,255,0.55)', false);
    else {
      ctx.beginPath();
      ctx.ellipse(x + side * 0.15, -1.25 - lift, 2.0, 1.1, 0, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = SOLE;
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// 頭（正面・背面・横）

const HEAD_CY = -25.4;

function backHairFront(ctx: Ctx, full: boolean): void {
  // ボブの外形（正面では顔の後ろ、背面では頭全体）
  const bottom = full ? -17.4 : -18.6;
  ctx.beginPath();
  ctx.moveTo(-11.2, bottom);
  ctx.bezierCurveTo(-14.6, -23, -15.4, -38.8, 0, -38.8);
  ctx.bezierCurveTo(15.4, -38.8, 14.6, -23, 11.2, bottom);
  ctx.quadraticCurveTo(9.6, bottom + 0.9, 8, bottom - 0.6);
  if (full) {
    ctx.quadraticCurveTo(4, bottom + 1, 0, bottom + 0.6);
    ctx.quadraticCurveTo(-4, bottom + 1, -8, bottom - 0.6);
  } else {
    ctx.lineTo(-8, bottom - 0.6);
  }
  ctx.quadraticCurveTo(-9.6, bottom + 0.9, -11.2, bottom);
  ctx.closePath();
  fillStroke(ctx, HAIR);
}

function hairShine(ctx: Ctx, cx: number, w: number): void {
  // 頭頂の天使の輪っか
  ctx.beginPath();
  ctx.ellipse(cx, -32.4, w, 3.6, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HAIR_HI;
  ctx.stroke();
}

function headFront(ctx: Ctx): void {
  backHairFront(ctx, false);
  // 顔
  ell(ctx, 0, HEAD_CY, 11.1, 9.8, SKIN);
  // 前髪（ぱっつん気味、毛先がふっくら）
  ctx.beginPath();
  ctx.moveTo(-11.4, -24.6);
  ctx.bezierCurveTo(-13, -33, -8.5, -37.4, 0, -37.4);
  ctx.bezierCurveTo(8.5, -37.4, 13, -33, 11.4, -24.6);
  ctx.quadraticCurveTo(10.6, -27.6, 9.4, -28.6);
  ctx.quadraticCurveTo(8, -27.2, 6.2, -28.4);
  ctx.quadraticCurveTo(4.4, -27.2, 2.2, -28.6);
  ctx.quadraticCurveTo(0, -27.4, -2.2, -28.6);
  ctx.quadraticCurveTo(-4.4, -27.2, -6.2, -28.4);
  ctx.quadraticCurveTo(-8, -27.2, -9.4, -28.6);
  ctx.quadraticCurveTo(-10.6, -27.6, -11.4, -24.6);
  ctx.closePath();
  fillStroke(ctx, HAIR);
  // 毛の流れ
  ctx.beginPath();
  ctx.moveTo(-3.2, -36.6);
  ctx.quadraticCurveTo(-4.4, -32.6, -2.2, -29.2);
  ctx.moveTo(3.4, -36.4);
  ctx.quadraticCurveTo(4.6, -32.6, 6.2, -29.2);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = HAIR_LINE;
  ctx.stroke();
  hairShine(ctx, -1, 7.6);
  hairPin(ctx, 8.6, -32.8);

  // 目（大きな縦長の楕円 + 白いハイライト）
  for (let side = -1; side <= 1; side += 2) {
    const ex = side * 4.3;
    ell(ctx, ex, -23.9, 1.6, 2.2, EYE, false);
    ell(ctx, ex - 0.55, -24.8, 0.7, 0.7, '#ffffff', false);
    ell(ctx, ex + 0.5, -23.0, 0.32, 0.32, '#ffffff', false);
    ell(ctx, side * 7.3, -20.9, 1.9, 1.05, BLUSH, false);
  }
  // 口（小さな笑み）
  ctx.beginPath();
  ctx.moveTo(-1.1, -20.4);
  ctx.quadraticCurveTo(0, -19.3, 1.1, -20.4);
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function headBack(ctx: Ctx): void {
  backHairFront(ctx, true);
  // 後ろ髪の毛束の線
  ctx.beginPath();
  ctx.moveTo(-1, -37.6);
  ctx.quadraticCurveTo(-5.6, -30, -5, -19);
  ctx.moveTo(2, -37.4);
  ctx.quadraticCurveTo(5.8, -30, 4.6, -19);
  ctx.moveTo(0.4, -30);
  ctx.quadraticCurveTo(0.6, -24, 0, -18.4);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = HAIR_LINE;
  ctx.stroke();
  hairShine(ctx, 0, 8.4);
  hairPin(ctx, -8.6, -32.8);
}

const SIDE_CX = 0.6;
const SIDE_RX = 11.9;
const SIDE_RY = 10.9;

function headSide(ctx: Ctx): void {
  const cy = HEAD_CY - 0.8;
  // 後ろ髪（ボブの裾が後ろへふくらむ）
  ctx.beginPath();
  ctx.moveTo(-1, -17.6);
  ctx.quadraticCurveTo(-8.6, -16.6, -11.6, -18.4);
  ctx.bezierCurveTo(-15.2, -23, -14.6, -33, -8, -36);
  ctx.lineTo(0, -30);
  ctx.closePath();
  fillStroke(ctx, HAIR);
  // 頭の丸（いったん髪色で塗る）
  ctx.beginPath();
  ctx.ellipse(SIDE_CX, cy, SIDE_RX, SIDE_RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = HAIR;
  ctx.fill();
  // 顔（前下側）を頭の丸の中に塗る
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(14, -29.4);
  ctx.lineTo(1.4, -29.4);
  ctx.quadraticCurveTo(-2.6, -27.6, -2.8, -22);
  ctx.quadraticCurveTo(-2.6, -17.4, -0.4, -14);
  ctx.lineTo(14, -14);
  ctx.closePath();
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(SIDE_CX, cy, SIDE_RX, SIDE_RY, 0, 0, Math.PI * 2);
  ctx.lineWidth = LW;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  // 横髪のふち（顔との境目）
  ctx.beginPath();
  ctx.moveTo(1.4, -29.2);
  ctx.quadraticCurveTo(-2.6, -27.6, -2.8, -22);
  ctx.quadraticCurveTo(-2.7, -18.4, -1.4, -15.8);
  ctx.lineWidth = LW;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  // 前髪（おでこにかかる毛先）
  ctx.beginPath();
  ctx.moveTo(12.3, -27.6);
  ctx.quadraticCurveTo(11.4, -29.6, 10, -28.4);
  ctx.quadraticCurveTo(8.6, -29.8, 6.8, -28.2);
  ctx.quadraticCurveTo(5, -29.8, 3.2, -28.2);
  ctx.quadraticCurveTo(1.6, -29.6, 0.4, -28.6);
  ctx.lineTo(1, -33);
  ctx.lineTo(11.4, -31.6);
  ctx.closePath();
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12.3, -27.6);
  ctx.quadraticCurveTo(11.4, -29.6, 10, -28.4);
  ctx.quadraticCurveTo(8.6, -29.8, 6.8, -28.2);
  ctx.quadraticCurveTo(5, -29.8, 3.2, -28.2);
  ctx.quadraticCurveTo(1.6, -29.6, 0.4, -28.6);
  ctx.lineWidth = LW;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  // 毛の流れ
  ctx.beginPath();
  ctx.moveTo(-5.6, -35.4);
  ctx.quadraticCurveTo(-9.6, -29, -8.2, -19.4);
  ctx.moveTo(2.6, -36.8);
  ctx.quadraticCurveTo(4.6, -33, 5.8, -29.6);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = HAIR_LINE;
  ctx.stroke();
  hairShine(ctx, -0.6, 7.4);
  hairPin(ctx, -6.2, -33.6);
  // 耳
  ell(ctx, -1.6, -22.2, 1.55, 1.95, SKIN);
  ctx.beginPath();
  ctx.arc(-1.4, -22.2, 0.75, -0.6 * Math.PI, 0.6 * Math.PI);
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  // 目・ほお・口
  ell(ctx, 6.6, -23.6, 1.45, 2.15, EYE, false);
  ell(ctx, 6.1, -24.5, 0.65, 0.65, '#ffffff', false);
  ell(ctx, 7.1, -22.7, 0.3, 0.3, '#ffffff', false);
  ell(ctx, 6.9, -20.3, 1.7, 1.0, BLUSH, false);
  ctx.beginPath();
  ctx.moveTo(8.6, -19.9);
  ctx.quadraticCurveTo(9.4, -19.1, 10.1, -20.0);
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// 向きごとの全身

// α → 画面角 φ（0 = 上、時計回り）
const sideAngle = (a: number) => Math.PI - a;
// 正面: 画面右の手で、頭の上（頭の後ろ）から右下（手前）へ振り下ろす
const frontAngle = (a: number) => 2.2 - 1.18 * (a - 1.3);
// 背面: 頭の上から、奥（画面の上）へ振り下ろす
const backAngle = (a: number) => 0.75 - 0.36 * (a - 1.3);

const TOOL_SCALE = 1.2; // 道具は少し大きめに（ピグの小物のように読みやすく）
const ARM = 4.4;

/** 腕を振り上げるほど少し伸ばす（短い腕でも頭の上まで届くように）。 */
function armLen(a: number, lenMul: number): number {
  return ARM * lenMul + Math.max(0, -Math.cos(a)) * 1.8;
}

function drawFrontOrBack(ctx: Ctx, back: boolean): void {
  const by = S.by;
  const shY = -14.9 + by;
  const tool = S.tool;
  const busy = tool !== null || S.armA > 0.9;
  // 作業中は α を画面角へ写す。歩き・立ち止まりは脇に垂らしたまま、前後の振りを長さ（遠近）で見せる。
  const REST = Math.PI - 0.5;
  const phiA = busy ? (back ? backAngle(S.armA) : frontAngle(S.armA)) : REST;
  const phiB = busy ? -(REST - 0.5 * Math.min(1, S.armB / 2)) : -REST;
  const lenA = armLen(S.armA, S.armLenA);
  // 道具が上を向いている（振りかぶり）ときは頭の後ろ。背面では振り下ろした道具が体の向こう側。
  const raised = Math.abs(phiA) < 0.75;
  const toolBehindHead = !back && raised;
  const armBehindBody = back && busy && !raised;
  if (armBehindBody) {
    arm(ctx, 4.5, shY, phiA, lenA, true);
    if (tool) tool_(ctx, tool, phiA, back ? 0.8 : 1);
  }
  frontLegs(ctx, by, back);
  shorts(ctx, -5.1, 5.1, -10.2 + by, -5.6 + by, SHORTS);
  ctx.beginPath();
  ctx.moveTo(0, -7.6 + by);
  ctx.lineTo(0, -5.8 + by);
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  shirt(ctx, 3.9, 5.5, -16.6 + by, -8.8 + by);
  arm(ctx, -4.5, shY, phiB, ARM * S.armLenB, false);
  if (toolBehindHead) {
    arm(ctx, 4.5, shY, phiA, lenA, false);
    if (tool) tool_(ctx, tool, phiA, 1);
  }

  ctx.save();
  ctx.translate(0, by + S.headBob);
  if (back) headBack(ctx);
  else headFront(ctx);
  ctx.restore();

  if (!armBehindBody && !toolBehindHead) {
    arm(ctx, 4.5, shY, phiA, lenA, false);
    if (tool) tool_(ctx, tool, phiA, 1);
  }
}

/** 手（HX,HY）に道具を持たせ、握った手を柄の上にもう一度描く。 */
function tool_(ctx: Ctx, kind: 'axe' | 'hoe', phi: number, scale: number): void {
  tool(ctx, kind, HX, HY, phi, TOOL_SCALE * scale);
  ell(ctx, HX, HY, 1.55, 1.55, SKIN);
}

function drawSide(ctx: Ctx): void {
  const by = S.by;
  const hipY = -6.4 + by;
  const LEG = hipY + 1.4; // 脚の長さ（腰から足裏）= -LEG
  // 奥の腕
  arm(ctx, -0.6, -14.6 + by, sideAngle(S.armB), armLen(S.armB, S.armLenB) - 0.2, true);
  // 奥の脚 → 手前の脚
  for (let i = 0; i < 2; i++) {
    const near = i === 1;
    const a = near ? S.legNear : S.legFar;
    const hx = near ? 0.5 : -0.7;
    const len = -LEG;
    const fx = hx + Math.sin(a) * len;
    const fy = hipY + Math.cos(a) * len;
    limb(ctx, hx, hipY, fx, fy, 2.6, near ? SKIN : SKIN_BACK);
    ell(ctx, fx + 0.9, fy + 0.15, 2.6, 1.4, near ? SHOE : SHOE_BACK);
    if (near) ell(ctx, fx + 0.6, fy - 0.35, 0.8, 0.4, 'rgba(255,255,255,0.5)', false);
  }
  shorts(ctx, -3.6, 3.8, -10.2 + by, -5.4 + by, SHORTS);
  shirt(ctx, 2.9, 4.1, -16.6 + by, -8.8 + by);

  // 手前の腕（と道具）。振りかぶって上を向いているあいだは頭の後ろへ回す。
  const phi = sideAngle(S.armA);
  const len = armLen(S.armA, S.armLenA);
  const behind = S.tool !== null && phi < 1.25;
  if (behind) {
    arm(ctx, 0.6, -14.4 + by, phi, len, false);
    tool_(ctx, S.tool!, phi, 1);
  }

  ctx.save();
  ctx.translate(0, by + S.headBob);
  headSide(ctx);
  ctx.restore();

  if (!behind) {
    arm(ctx, 0.6, -14.4 + by, phi, len, false);
    if (S.tool) tool_(ctx, S.tool, phi, 1);
  }
}

/**
 * 主人公を描く。footX/footY は足元中央の画面座標、k は 1 ワールド px あたりの画面 px。
 * ctx の状態（変換・線幅など）は呼び出し前に戻す。
 */
export function drawAvatar(ctx: Ctx, footX: number, footY: number, k: number, pose: AvatarPose): void {
  computeState(pose);
  ctx.save();
  ctx.translate(footX, footY);
  ctx.scale(pose.dir === 'left' ? -k : k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (pose.dir === 'left' || pose.dir === 'right') ctx.rotate(S.lean);
  else ctx.rotate(S.lean * 0.15);
  if (S.squash) ctx.scale(1 + S.squash, 1 - S.squash);
  if (pose.dir === 'down') drawFrontOrBack(ctx, false);
  else if (pose.dir === 'up') drawFrontOrBack(ctx, true);
  else drawSide(ctx);
  ctx.restore();
}

/** 立ち止まりの姿勢（アイコン・一覧用）。 */
export function idlePose(dir: AvatarDir): AvatarPose {
  return { dir, walkPhase: null, idleT: 0, action: null };
}
