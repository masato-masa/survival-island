// 主人公（アメーバピグ／ピグライフ風）をコードで描く。素材は使わず、比率と描き方だけを実測値に合わせる。
//
// ── 実測した参考（数値はそのまま下の寸法に使っている）────────────────────────────
// 1) ピグの素体（CyberAgent 開発者ブログ「アバターのシンボル位置」図 960×510 の右半分、全高 306px）
//    - 頭: 高さ 163px = 全高の 53%、幅 186px = 全高の 61%（幅/高さ = 1.14、横に広い）
//    - 頭の最大幅は頭頂から 59% の位置（ほお側がふくらむ「下ぶくれ」の卵形）。あごは広く丸い
//    - 首: 幅 34px = 頭幅の 18%（ほぼ見えない）
//    - 胴: 高さ 82px = 全高の 27%、幅 43→51px = 頭幅の 27%（頭に比べてかなり細い）
//    - 脚: 高さ 60px = 全高の 20%、1 本の幅 16〜17px、左右の間 18px。足先は少し外へ開く
//    - 腕: 細い（幅 12px 前後）。手は頭頂から 76% の高さ（腰の横）、体から外へ約 30° 開いて垂れる
//    - 手は指のない丸（直径 20px 前後）
//    - 肌 #fce6d6、影・奥の手足 #f7d2b9。素体に濃い輪郭線は無い（同系色の 1 段暗い線だけ）
// 2) ピグライフのプレイ画面（作物を育てる場面のアバター、拡大して計測）
//    - 目は顔の下寄り（頭頂から約 63%）、中心は顔の中心から左右に頭幅の ±24%
//    - 目の大きさ: 幅 = 頭幅の約 17〜19%、縦は幅の約 1.2 倍。色つきの虹彩・上まぶたの濃い線・大きな白い光 2 つ
//    - 口は目の間の下、幅は頭幅の 7% ほどの小さな笑み。鼻は描かない
//    - ほおの赤みは目の外下に横長のぼかし
//    - 輪郭線は部位ごとに「その色の暗い色」で細く引く（髪は濃い茶、肌は赤茶）。塗りはベタ＋つや 1 段
//    - 髪は頭の上半分を大きなかたまりで覆い、前髪は太い毛束で目の上まで。横髪がほおの外側にかかる
// 3) アメーバピグ（旧版）の部屋の画面: 頭は全高の約 55%、手足は細い棒で短い。どの向きでも顔は正面寄り
//    （真横ではなく斜め 3/4 で描かれる）ので、横向きも 3/4 の顔にしている。
//
// 40 ワールド px に換算（306px → 40px、×0.1307）。髪の厚みを足して全高 ≒ 41、頭（髪込み）は全高の約 58%。
// ───────────────────────────────────────────────────────────────────────────
//
// 座標はワールド px（1 マス = 32）。足元の中央を原点にして、上がマイナス。
// 毎フレーム呼ばれるので、Canvas を作らず・配列も作らず、パスだけで描く（グラデーションも使わない）。
//
// 向き: down = 正面、up = 背面（顔なし）、right = 斜め 3/4 の横向き、left = right の左右反転。
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
// 配色（部位ごとに「塗り」と「1 段暗い輪郭」）

const LW = 0.55; // 輪郭の太さ（ワールド px）。素体 306px で 2px 前後 → 40px で 0.3 だが、縮小表示で消えないよう少し太め
const SKIN = '#fce6d6'; // 実測
const SKIN_BACK = '#f7d2b9'; // 実測（素体の影色）。奥の手足
const SKIN_LINE = '#d9a088';
const HAIR = '#a0663f';
const HAIR_DARK = '#87532f'; // 後ろ髪の内側
const HAIR_HI = '#c99668';
const HAIR_LINE = '#6b3f25';
const SHIRT = '#ffb3c3';
const SHIRT_BACK = '#f297ab';
const SHIRT_LINE = '#cf7088';
const SHIRT_HI = 'rgba(255,255,255,0.5)';
const COLLAR = '#ffffff';
const SHORTS = '#86a8e0';
const SHORTS_LINE = '#5675b0';
const SHOE = '#f27c62';
const SHOE_BACK = '#d9664e';
const SHOE_LINE = '#b24f3b';
const SOLE = '#fff6ec';
const EYE_LINE = '#3a221b';
const IRIS = '#5a3424';
const IRIS_LOW = '#a8714b';
const MOUTH = '#b25a55';
const BLUSH = 'rgba(255,135,145,0.42)';
const PIN = '#ffd84a';
const PIN_CENTER = '#ff8a5c';
const PIN_LINE = '#d49a2a';
const WOOD = '#d39a5e';
const WOOD_DARK = '#a8703f';
const WOOD_LINE = '#7d4f28';
const METAL = '#e3e8ee';
const METAL_DARK = '#9aa4ae';
const METAL_LINE = '#5f6b78';

// ---------------------------------------------------------------------------
// 寸法（実測の比率 × 40px）

const HEAD_TOP = -38.6; // 顔（素肌）の頭頂
const HEAD_W = 12.0; // 顔の半幅（頭幅 24 = 全高の 59%）
const HEAD_MID = -26.2; // 最大幅の高さ（頭頂から 59%）
const CHIN = -17.6; // あご（頭の高さ 21 = 全高の 52%）
const HAIR_TOP = -40.6;
const HAIR_W = 13.3;
const EYE_Y = -25.2; // 頭頂から 63%
const EYE_DX = 5.7; // 頭幅の ±24%
const EYE_RX = 2.05; // 幅 4.1 = 頭幅の 17%
const EYE_RY = 2.5;
const SHOULDER_Y = -16.4;
const HIP_Y = -7.4; // 脚の付け根（脚の高さ ≒ 全高の 19%）
const LEG_W = 2.1; // 1 本の幅（16.5px × 0.1307）
const LEG_X = 1.9; // 脚の中心（間 2.4 + 幅の半分）
const ARM_W = 1.55;
const HAND_R = 1.3;
const ARM = 7.0; // 肩から手まで（手が腰の横に来る長さ）

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
  headTilt: 0,
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
  swing: 0, // 正面・背面の歩きの腕振り（-1..1）
  tool: null as null | 'axe' | 'hoe',
};

function computeState(pose: AvatarPose): void {
  S.by = 0;
  // 呼吸: 1.7 秒周期で胴より上がわずかに上下する
  const breath = Math.sin((pose.idleT / 1700) * Math.PI * 2);
  S.headBob = breath * 0.3;
  S.headTilt = 0;
  S.lean = 0;
  S.squash = breath * 0.008;
  S.liftL = 0;
  S.liftR = 0;
  S.legNear = 0;
  S.legFar = 0;
  S.armA = 0.1 + breath * 0.02;
  S.armB = 0.1 + breath * 0.02;
  S.armLenA = 1;
  S.armLenB = 1;
  S.swing = 0;
  S.tool = null;

  const act = pose.action;
  if (act) {
    const tt = Math.min(0.9999, Math.max(0, act.t)) * STRIKES;
    const u = tt - Math.floor(tt);
    const tool = act.tool;
    S.squash = 0;
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
      S.armLenA = 0.85;
      S.armLenB = 0.85;
      S.headTilt = S.lean * 0.6;
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
      S.armLenA = 0.78; // 短い腕で両手持ちに見えるよう、肘を曲げたぶん縮める
      S.armLenB = 0.7;
      S.tool = tool;
    }
    S.headBob *= 0.3;
    return;
  }

  const ph = pose.walkPhase;
  if (ph !== null) {
    // ピグの歩き: 小さな歩幅で、1 歩ごとにぽんと弾む。腕は小さく前後に振る
    const s = Math.sin(ph);
    const bounce = Math.abs(Math.cos(ph));
    S.by = -bounce * 1.1 + 0.55;
    S.squash = (bounce - 0.5) * -0.03;
    S.liftL = Math.max(0, s) * 1.4;
    S.liftR = Math.max(0, -s) * 1.4;
    S.legNear = s * 0.5;
    S.legFar = -s * 0.5;
    S.armA = 0.1 - s * 0.55;
    S.armB = 0.1 + s * 0.55;
    S.armLenA = 1 - s * 0.1;
    S.armLenB = 1 + s * 0.1;
    S.swing = s;
    S.headTilt = s * 0.03;
    S.headBob *= 0.3;
  }
}

// ---------------------------------------------------------------------------
// 小さな描画部品

function ell(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, line: string | null, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.lineWidth = LW;
    ctx.strokeStyle = line;
    ctx.stroke();
  }
}

/** 太い線（手足・柄）。先に輪郭色で太く、上から本体色で細く引く。 */
function limb(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, fill: string, line: string): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = w + LW * 2;
  ctx.strokeStyle = line;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

function fillStroke(ctx: Ctx, fill: string, line: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = LW;
  ctx.strokeStyle = line;
  ctx.stroke();
}

function stroke(ctx: Ctx, color: string, w: number): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** 腕。肩 (sx,sy) から画面角 φ（0 = 上、時計回り）へ伸ばす。手の位置を HX/HY に返す。 */
let HX = 0;
let HY = 0;
function arm(ctx: Ctx, sx: number, sy: number, phi: number, len: number, back: boolean): void {
  const dx = Math.sin(phi);
  const dy = -Math.cos(phi);
  HX = sx + dx * len;
  HY = sy + dy * len;
  limb(ctx, sx, sy, HX, HY, ARM_W, back ? SKIN_BACK : SKIN, SKIN_LINE);
  // 半袖（肩口の丸い袖）
  ell(ctx, sx + dx * 1.0, sy + dy * 1.0, 1.55, 1.75, back ? SHIRT_BACK : SHIRT, SHIRT_LINE, phi);
  ell(ctx, HX, HY, HAND_R, HAND_R * 1.05, back ? SKIN_BACK : SKIN, SKIN_LINE);
}

/** 道具。握り (hx,hy) から画面角 φ の向きへ柄を伸ばし、刃は時計回りの進行側（ローカル +x）。 */
function tool(ctx: Ctx, kind: 'axe' | 'hoe', hx: number, hy: number, phi: number, scale: number): void {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(phi);
  ctx.scale(scale, scale);
  const top = kind === 'axe' ? -11 : -13;
  limb(ctx, 0, 2.2, 0, top + 0.5, 1.4, WOOD, WOOD_LINE);
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
    fillStroke(ctx, METAL, METAL_LINE);
    // 刃先の光
    ctx.beginPath();
    ctx.moveTo(5.2, top - 1.4);
    ctx.quadraticCurveTo(5.9, top + 1.4, 5.1, top + 4.1);
    stroke(ctx, '#ffffff', 0.9);
    ell(ctx, 0.7, top + 1, 0.55, 0.55, METAL_DARK, null);
  } else {
    ctx.moveTo(-0.6, top - 0.8);
    ctx.lineTo(1.2, top - 1.1);
    ctx.lineTo(6, top + 0.2);
    ctx.quadraticCurveTo(6.8, top + 2.2, 6, top + 3.6);
    ctx.lineTo(1.2, top + 1.8);
    ctx.lineTo(-0.6, top + 1.6);
    ctx.closePath();
    fillStroke(ctx, METAL, METAL_LINE);
    ctx.beginPath();
    ctx.moveTo(5.6, top + 0.8);
    ctx.lineTo(5.9, top + 3);
    stroke(ctx, '#ffffff', 0.8);
    ell(ctx, 0.3, top + 0.4, 0.5, 0.5, WOOD_DARK, null);
  }
  ctx.restore();
}

/** 髪どめ（小さな花）。 */
function hairPin(ctx: Ctx, x: number, y: number): void {
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ell(ctx, x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, 0.95, 0.95, PIN, PIN_LINE);
  }
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ell(ctx, x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, 0.62, 0.62, PIN, null);
  }
  ell(ctx, x, y, 0.72, 0.72, PIN_CENTER, null);
  ell(ctx, x - 0.22, y - 0.26, 0.26, 0.26, '#fff3c0', null);
}

// ---------------------------------------------------------------------------
// 胴・脚

function shorts(ctx: Ctx, hw: number, y0: number, y1: number, fill: string): void {
  // 腰で少し細く、裾は左右の脚に分かれる短パン
  ctx.beginPath();
  ctx.moveTo(-hw + 0.3, y0);
  ctx.lineTo(hw - 0.3, y0);
  ctx.quadraticCurveTo(hw + 0.5, y0 + 1.2, hw + 0.4, y1);
  ctx.lineTo(0.5, y1);
  ctx.lineTo(0, y1 - 1.1);
  ctx.lineTo(-0.5, y1);
  ctx.lineTo(-hw - 0.4, y1);
  ctx.quadraticCurveTo(-hw - 0.5, y0 + 1.2, -hw + 0.3, y0);
  ctx.closePath();
  fillStroke(ctx, fill, SHORTS_LINE);
}

/** T シャツ。肩幅 hw、裾幅 bw。cx だけ横へずらせる（3/4 の向き用）。 */
function shirt(ctx: Ctx, cx: number, hw: number, bw: number, y0: number, y1: number, collar: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - hw, y0);
  ctx.lineTo(cx + hw, y0);
  ctx.quadraticCurveTo(cx + hw + 0.6, y0 + 0.3, cx + bw, y1 - 0.8);
  ctx.quadraticCurveTo(cx + bw, y1, cx + bw - 0.8, y1);
  ctx.lineTo(cx - bw + 0.8, y1);
  ctx.quadraticCurveTo(cx - bw, y1, cx - bw, y1 - 0.8);
  ctx.quadraticCurveTo(cx - hw - 0.6, y0 + 0.3, cx - hw, y0);
  ctx.closePath();
  fillStroke(ctx, SHIRT, SHIRT_LINE);
  // 左上のつや
  ell(ctx, cx - bw * 0.42, y0 + 2.6, bw * 0.24, 1.3, SHIRT_HI, null, -0.2);
  if (collar > 0) {
    // 白い丸えり（あごの下から少しだけ見える）
    ctx.beginPath();
    ctx.ellipse(cx + collar * 0, y0 + 0.2, 2.1, 1.1, 0, 0, Math.PI);
    ctx.fillStyle = COLLAR;
    ctx.fill();
    stroke(ctx, SHIRT_LINE, LW * 0.8);
  }
}

function frontLegs(ctx: Ctx, by: number, back: boolean): void {
  for (let side = -1; side <= 1; side += 2) {
    const lift = side < 0 ? S.liftL : S.liftR;
    const x = side * LEG_X;
    const fy = -1.3 - lift;
    limb(ctx, x, HIP_Y + 0.6 + by, x, fy, LEG_W, SKIN, SKIN_LINE);
    // 靴（つま先が少し外へ開く）
    ell(ctx, x + side * 0.35, -1.0 - lift, 1.95, 1.2, SHOE, SHOE_LINE, side * 0.12);
    if (!back) ell(ctx, x - 0.3 + side * 0.3, -1.45 - lift, 0.75, 0.38, 'rgba(255,255,255,0.6)', null);
    else {
      ctx.beginPath();
      ctx.ellipse(x + side * 0.35, -1.0 - lift, 1.6, 0.85, 0, 0.15 * Math.PI, 0.85 * Math.PI);
      stroke(ctx, SOLE, 0.6);
    }
  }
}

// ---------------------------------------------------------------------------
// 頭

/** 顔（素肌）の外形。下ぶくれの卵形（最大幅が頭頂から 59%）。cx だけ横へずらせる。 */
function facePath(ctx: Ctx, cx: number): void {
  const w = HEAD_W;
  ctx.beginPath();
  ctx.moveTo(cx, HEAD_TOP);
  ctx.bezierCurveTo(cx + w * 0.58, HEAD_TOP, cx + w, HEAD_MID - 7.4, cx + w, HEAD_MID);
  ctx.bezierCurveTo(cx + w, HEAD_MID + 5.6, cx + w * 0.6, CHIN, cx, CHIN);
  ctx.bezierCurveTo(cx - w * 0.6, CHIN, cx - w, HEAD_MID + 5.6, cx - w, HEAD_MID);
  ctx.bezierCurveTo(cx - w, HEAD_MID - 7.4, cx - w * 0.58, HEAD_TOP, cx, HEAD_TOP);
  ctx.closePath();
}

/** ボブの後ろ髪（顔の後ろに見える部分／背面では頭全体）。dx で横にずらす。 */
function backHair(ctx: Ctx, dx: number, bottom: number, fill: string): void {
  const w = HAIR_W;
  ctx.beginPath();
  ctx.moveTo(dx - w + 0.6, bottom);
  ctx.bezierCurveTo(dx - w - 1.4, -27, dx - w - 0.6, HAIR_TOP, dx, HAIR_TOP);
  ctx.bezierCurveTo(dx + w + 0.6, HAIR_TOP, dx + w + 1.4, -27, dx + w - 0.6, bottom);
  // 裾はふんわり内巻き（3 つのふくらみ）
  ctx.quadraticCurveTo(dx + w * 0.62, bottom + 1.3, dx + w * 0.34, bottom + 0.1);
  ctx.quadraticCurveTo(dx, bottom + 1.4, dx - w * 0.34, bottom + 0.1);
  ctx.quadraticCurveTo(dx - w * 0.62, bottom + 1.3, dx - w + 0.6, bottom);
  ctx.closePath();
  fillStroke(ctx, fill, HAIR_LINE);
}

/** 頭頂の天使の輪っか。 */
function hairShine(ctx: Ctx, cx: number, w: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, -35.4, w, 3.2, 0, Math.PI * 1.1, Math.PI * 1.9);
  stroke(ctx, HAIR_HI, 1.3);
}

/**
 * 前髪＋頭頂のかたまり（顔の上に重ねる）。sh は 3/4 の向きでの横ずれ（0 = 正面）。
 * 前髪の毛先は太い 5 束、横髪はほおの外側に下りる。
 */
function frontHair(ctx: Ctx, sh: number, faceX: number): void {
  // 前髪の落ち影（肌の 1 段暗い色を少し下へずらして先に塗る）
  ctx.save();
  facePath(ctx, faceX);
  ctx.clip();
  ctx.translate(0, 0.75);
  frontHairPath(ctx, sh);
  ctx.fillStyle = SKIN_BACK;
  ctx.fill();
  ctx.restore();
  frontHairPath(ctx, sh);
  fillStroke(ctx, HAIR, HAIR_LINE);
  const cx = sh;
  const L = -HAIR_W + sh * 0.25;
  const R = HAIR_W + sh * 0.25;
  // 毛の流れ
  ctx.beginPath();
  ctx.moveTo(cx - 2.6, -38.4);
  ctx.quadraticCurveTo(cx - 3.8, -34.2, cx - 2.4, -30.8);
  ctx.moveTo(cx + 3.0, -38.2);
  ctx.quadraticCurveTo(cx + 4.4, -34.2, cx + 3.6, -30.8);
  ctx.moveTo(L + 0.6, -27.8);
  ctx.quadraticCurveTo(L + 1.0, -24.4, L + 2.0, -22.2);
  ctx.moveTo(R - 0.6, -27.8);
  ctx.quadraticCurveTo(R - 1.0, -24.4, R - 2.0, -22.2);
  stroke(ctx, HAIR_LINE, 0.4);
  hairShine(ctx, cx * 0.6 - 0.8, 7.0);
}

function frontHairPath(ctx: Ctx, sh: number): void {
  const w = HAIR_W;
  const L = -w + sh * 0.25; // 左の外側
  const R = w + sh * 0.25;
  const cx = sh;
  ctx.beginPath();
  // 左の横髪の毛先から外側を回って頭頂、右の横髪の毛先へ
  ctx.moveTo(L + 1.6 - sh * 0.1, -20.6);
  ctx.bezierCurveTo(L - 0.6, -24, L - 1.0, HAIR_TOP + 2, cx * 0.6, HAIR_TOP);
  ctx.bezierCurveTo(R + 1.0, HAIR_TOP + 2, R + 0.6, -24, R - 1.6 - sh * 0.1, -20.6);
  // 右の横髪の内側を上へ
  ctx.quadraticCurveTo(R - 2.2 - sh * 0.15, -24.5, R - 2.8 - sh * 0.2, -28.2);
  // 前髪の毛先（右 → 左）。tip は下向きの束、間は上へくぼむ
  const x0 = R - 2.8 - sh * 0.2;
  const x1 = L + 2.8 - sh * 0.2;
  const span = x0 - x1;
  const N = 5;
  for (let i = 0; i < N; i++) {
    const a = x0 - (span * i) / N;
    const b = x0 - (span * (i + 1)) / N;
    const mid = (a + b) / 2;
    const tipY = -28.4 - (i === 1 || i === 3 ? 0.4 : 0) + (i === 2 ? 0.5 : 0);
    // 束の先（mid で一番下）
    ctx.quadraticCurveTo(a - (a - mid) * 0.2, tipY + 0.4, mid, tipY + 0.9);
    ctx.quadraticCurveTo(b + (mid - b) * 0.2, tipY + 0.4, b, -30.4);
  }
  // 左の横髪の内側を下へ
  ctx.quadraticCurveTo(L + 2.2 - sh * 0.15, -24.5, L + 1.6 - sh * 0.1, -20.6);
  ctx.closePath();
}

/** ピグライフ風の目。rx を細めると 3/4 の奥の目になる。flip = 外側（まつ毛のはね）の向き。 */
function eye(ctx: Ctx, ex: number, ey: number, rx: number, flip: number): void {
  const ry = EYE_RY;
  // 虹彩（濃い上半分 → 明るい下半分）
  ell(ctx, ex, ey, rx, ry, IRIS, null);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ell(ctx, ex, ey + ry * 0.75, rx * 1.05, ry * 0.72, IRIS_LOW, null);
  ctx.restore();
  // 瞳
  ell(ctx, ex, ey + 0.1, rx * 0.45, ry * 0.42, EYE_LINE, null);
  // 上まぶたの濃い線（目よりわずかに大きい弧）＋ 外側のまつ毛のはね
  ctx.beginPath();
  ctx.ellipse(ex, ey + 0.15, rx + 0.3, ry + 0.25, 0, Math.PI * 1.05, Math.PI * 1.95);
  stroke(ctx, EYE_LINE, 0.75);
  ctx.beginPath();
  const ox = ex + flip * (rx + 0.2);
  ctx.moveTo(ox, ey - ry * 0.55);
  ctx.quadraticCurveTo(ox + flip * 0.6, ey - ry * 0.8, ox + flip * 0.9, ey - ry * 1.05);
  stroke(ctx, EYE_LINE, 0.55);
  // 光（大きい丸を内側上、小さい丸を外側下）
  ell(ctx, ex - flip * rx * 0.32, ey - ry * 0.36, rx * 0.42, rx * 0.42, '#ffffff', null);
  ell(ctx, ex + flip * rx * 0.36, ey + ry * 0.42, rx * 0.2, rx * 0.2, '#ffffff', null);
}

function smile(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x, y + 1.1, x + w, y);
  stroke(ctx, MOUTH, 0.55);
}

function headFront(ctx: Ctx): void {
  backHair(ctx, 0, -19.6, HAIR_DARK);
  facePath(ctx, 0);
  fillStroke(ctx, SKIN, SKIN_LINE);
  // ほお・目・口（髪より先に描き、横髪がほおの端にかかる）
  ell(ctx, -8.0, -22.0, 2.0, 1.15, BLUSH, null);
  ell(ctx, 8.0, -22.0, 2.0, 1.15, BLUSH, null);
  eye(ctx, -EYE_DX, EYE_Y, EYE_RX, -1);
  eye(ctx, EYE_DX, EYE_Y, EYE_RX, 1);
  smile(ctx, 0, -21.0, 0.85);
  frontHair(ctx, 0, 0);
  hairPin(ctx, 8.4, -33.6);
}

function headBack(ctx: Ctx): void {
  backHair(ctx, 0, -18.8, HAIR);
  // 後ろ髪の毛束の線
  ctx.beginPath();
  ctx.moveTo(-1.2, -39.6);
  ctx.quadraticCurveTo(-6.2, -31, -4.6, -19.4);
  ctx.moveTo(1.8, -39.4);
  ctx.quadraticCurveTo(6.4, -31, 4.6, -19.4);
  ctx.moveTo(0.3, -31);
  ctx.quadraticCurveTo(0.6, -24, 0, -18.4);
  ctx.moveTo(-10.2, -30);
  ctx.quadraticCurveTo(-11, -24, -9.4, -19.8);
  ctx.moveTo(10.2, -30);
  ctx.quadraticCurveTo(11, -24, 9.4, -19.8);
  stroke(ctx, HAIR_LINE, 0.4);
  hairShine(ctx, 0, 8.0);
  hairPin(ctx, -8.4, -33.6);
}

/** 斜め 3/4（右向き）の頭。顔の中心が向く側へ寄り、奥の目は細くなる。 */
const SIDE_SH = 3.0; // 顔の中心の横ずれ
function headSide(ctx: Ctx): void {
  // 後ろ髪は向きと反対（左）へ多く見える
  backHair(ctx, -1.6, -19.4, HAIR_DARK);
  facePath(ctx, 0.4);
  fillStroke(ctx, SKIN, SKIN_LINE);
  const c = SIDE_SH;
  ell(ctx, c - 6.6, -22.0, 1.9, 1.1, BLUSH, null);
  ell(ctx, c + 7.0, -22.2, 1.4, 1.05, BLUSH, null);
  eye(ctx, c - 4.9, EYE_Y, EYE_RX * 1.02, -1);
  eye(ctx, c + 5.0, EYE_Y, EYE_RX * 0.8, 1);
  smile(ctx, c + 0.6, -21.0, 0.8);
  frontHair(ctx, c, 0.4);
  hairPin(ctx, -6.4, -34.4);
}

// ---------------------------------------------------------------------------
// 向きごとの全身

// α → 画面角 φ（0 = 上、時計回り）
const sideAngle = (a: number) => Math.PI - a;
// 正面: 画面右の手で、頭の上（頭の後ろ）から右下（手前）へ振り下ろす
const frontAngle = (a: number) => 2.2 - 1.18 * (a - 1.3);
// 背面: 頭の上から、奥（画面の上）へ振り下ろす
const backAngle = (a: number) => 0.75 - 0.36 * (a - 1.3);

const TOOL_SCALE = 1.15; // 道具は少し大きめに（ピグの小物のように読みやすく）

/** 腕を振り上げるほど少し伸ばす（頭の上まで届くように）。 */
function armLen(a: number, lenMul: number): number {
  return ARM * lenMul + Math.max(0, -Math.cos(a)) * 1.2;
}

/** 手（HX,HY）に道具を持たせ、握った手を柄の上にもう一度描く。 */
function holdTool(ctx: Ctx, kind: 'axe' | 'hoe', phi: number, scale: number, back: boolean): void {
  tool(ctx, kind, HX, HY, phi, TOOL_SCALE * scale);
  ell(ctx, HX, HY, HAND_R, HAND_R * 1.05, back ? SKIN_BACK : SKIN, SKIN_LINE);
}

function drawFrontOrBack(ctx: Ctx, back: boolean): void {
  const by = S.by;
  const shY = SHOULDER_Y + by;
  const tool = S.tool;
  const busy = tool !== null || S.armA > 0.9;
  // 立ち止まり: 体から外へ約 30° 開いて垂らす（実測）。歩き: 小さく振る。作業中は α を画面角へ写す。
  const REST = Math.PI - 0.5;
  const sw = S.swing * 0.14 * (back ? -1 : 1);
  const phiA = busy ? (back ? backAngle(S.armA) : frontAngle(S.armA)) : REST + sw;
  const phiB = busy ? -(REST - 0.5 * Math.min(1, S.armB / 2)) : -REST + sw;
  const lenA = busy ? armLen(S.armA, S.armLenA) : ARM * S.armLenA;
  // 道具が上を向いている（振りかぶり）ときは頭の後ろ。背面では振り下ろした道具が体の向こう側。
  const raised = Math.abs(phiA) < 0.75;
  const toolBehindHead = !back && raised;
  const armBehindBody = back && busy && !raised;
  if (armBehindBody) {
    arm(ctx, 3.0, shY, phiA, lenA, true);
    if (tool) holdTool(ctx, tool, phiA, 0.8, true);
  }
  frontLegs(ctx, by, back);
  shorts(ctx, 3.5, -10.6 + by, HIP_Y + 0.4 + by, SHORTS);
  if (toolBehindHead) {
    arm(ctx, 3.0, shY, phiA, lenA, false);
    if (tool) holdTool(ctx, tool, phiA, 1, false);
  }
  shirt(ctx, 0, 2.7, 3.5, SHOULDER_Y - 1.4 + by, -9.8 + by, back ? 0 : 1);
  // 胴の上に重ねる腕（左は常に手前。右は振りかぶり以外）
  arm(ctx, -3.0, shY, phiB, ARM * S.armLenB, false);

  ctx.save();
  ctx.translate(0, by + S.headBob);
  ctx.rotate(S.headTilt * (back ? -1 : 1));
  if (back) headBack(ctx);
  else headFront(ctx);
  ctx.restore();

  if (!armBehindBody && !toolBehindHead) {
    arm(ctx, 3.0, shY, phiA, lenA, false);
    if (tool) holdTool(ctx, tool, phiA, 1, false);
  }
}

function drawSide(ctx: Ctx): void {
  const by = S.by;
  const hipY = HIP_Y + by;
  const LEG = -(HIP_Y + 1.2); // 腰から足裏まで
  // 奥の腕
  arm(ctx, -1.4, SHOULDER_Y + 0.2 + by, sideAngle(S.armB), armLen(S.armB, S.armLenB) - 0.3, true);
  // 奥の脚 → 手前の脚
  for (let i = 0; i < 2; i++) {
    const near = i === 1;
    const a = near ? S.legNear : S.legFar;
    const hx = near ? 0.9 : -1.1;
    const fx = hx + Math.sin(a) * LEG;
    const fy = hipY + Math.cos(a) * LEG;
    limb(ctx, hx, hipY, fx, fy, LEG_W, near ? SKIN : SKIN_BACK, SKIN_LINE);
    ell(ctx, fx + 0.8, fy + 0.2, 2.1, 1.2, near ? SHOE : SHOE_BACK, SHOE_LINE);
    if (near) ell(ctx, fx + 0.6, fy - 0.25, 0.75, 0.35, 'rgba(255,255,255,0.55)', null);
  }
  shorts(ctx, 3.0, -10.6 + by, hipY + 0.6, SHORTS);
  shirt(ctx, 0.2, 2.3, 3.1, SHOULDER_Y - 1.4 + by, -9.8 + by, 0);

  // 手前の腕（と道具）。振りかぶって上を向いているあいだは頭の後ろへ回す。
  const phi = sideAngle(S.armA);
  const len = armLen(S.armA, S.armLenA);
  const behind = S.tool !== null && phi < 1.25;
  const sx = 1.4;
  const sy = SHOULDER_Y + 0.4 + by;
  if (behind) {
    arm(ctx, sx, sy, phi, len, false);
    holdTool(ctx, S.tool!, phi, 1, false);
  }

  ctx.save();
  ctx.translate(0, by + S.headBob);
  ctx.rotate(S.headTilt);
  headSide(ctx);
  ctx.restore();

  if (!behind) {
    arm(ctx, sx, sy, phi, len, false);
    if (S.tool) holdTool(ctx, S.tool, phi, 1, false);
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
