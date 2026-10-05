// 家具・設備・宝箱・看板を「コードで組んだ 3D の模型」として描く。
//
// 素材シートの家具はアイソメ（斜め 45°）で描かれていて、北を真っすぐ見るこのゲームのカメラに置くと
// 回って見える。ピグのようにマス目にぴったり沿った物にするため、箱・円柱・角錐などの単純な形を
// ワールド座標で組み、各頂点を本物のカメラ（camera.ts の worldToScreen）で投影して面を塗る。
//
// 座標は「家具の左上のマスの左上の角」を原点にしたワールド px（1 マス = 32）。z は地面からの高さ（px）。
// 投影は P(x, y, z) → 画面（camera.ts の project3）。斜め上から見下ろすので、地面の奥行きは sin(仰角)、
// 高さ z は cos(仰角) に縮む。だから箱の上面が見える。
//
// 見えるのは外向きの面だけ（投影した多角形の向きで判定するので、左にある物は右の面が、右にある物は
// 左の面が見える）。凸な立体どうしは layer → 手前の縁 (sortY) → 下端 (sortZ) の順に重ねる。
//
// 塗り: 面ごとに平らな淡い色。光は左手前の上から（上面がいちばん明るく、手前・左・右の順に暗い）。
// 輪郭は暖かい焦げ茶の細い線。外周だけ太く、面の境目は面の色を少し暗くした線。
//
// React・DOM に依存しない（Canvas の 2D コンテキストだけを受け取る）。

import { FURNITURE_BY_ID, furnitureSize } from '@/game/data';

import { TILE } from './camera';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type V3 = readonly [number, number, number];
export interface Pt {
  x: number;
  y: number;
}
/** ローカル座標（px）→ 画面座標。 */
export type Project = (x: number, y: number, z: number) => Pt;

export interface ModelExtra {
  /** 作業台が作業中（または完成して受け取り待ち）。 */
  craft?: { startedAt: number; endsAt: number } | null;
}

export interface DrawEnv {
  ctx: Ctx;
  P: Project;
  /** 模型の中心での倍率（1 ワールド px が何画面 px か）。線の太さ・小物の大きさに使う。 */
  k: number;
  now: number;
  extra?: ModelExtra;
}

interface Face {
  pts: V3[];
  fill: string;
  edge: string;
  lines: V3[][];
  /** 面の境目に線を引くか（円柱の側面どうしは引かない）。 */
  edged: boolean;
}

interface Op {
  layer: number;
  sortY: number;
  sortZ: number;
  faces?: Face[];
  outline?: boolean;
  alpha?: number;
  custom?: (e: DrawEnv) => void;
}

export interface Model {
  ops: Op[];
  /** 接地影の矩形（ローカル px）。 */
  shadow: [number, number, number, number][];
  /** アイコンの枠合わせに使う点（立体の頂点＋小物の届く範囲）。 */
  bounds: V3[];
}

// ---------------------------------------------------------------------------
// 色

const OUTLINE = 'rgba(92,58,42,0.95)';
const OUTLINE_RGB: [number, number, number] = [92, 58, 42];
const SHADE_RGB: [number, number, number] = [74, 46, 66]; // 影は黒でなく、紫がかった焦げ茶に寄せる

function hexRgb(c: string): [number, number, number] {
  const h = c.replace('#', '');
  const v = h.length === 3 ? h.split('').map((s) => s + s).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function mixRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
export function mix(a: string, b: string, t: number): string {
  return mixRgb(hexRgb(a), hexRgb(b), t);
}

// 光（左手前の上から）
const LIGHT = (() => {
  const v: [number, number, number] = [-0.36, 0.5, 0.84];
  const l = Math.hypot(...v);
  return v.map((c) => c / l) as [number, number, number];
})();
const AMB = 0.56;
const TOP_LIT = AMB + (1 - AMB) * LIGHT[2];

function shadeAmount(n: V3): number {
  const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const b = AMB + (1 - AMB) * lit;
  return Math.max(0, Math.min(1, 1 - b / TOP_LIT));
}

// ---------------------------------------------------------------------------
// ベクトル

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
function avg(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / pts.length, y / pts.length, z / pts.length];
}
function newell(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}
function dedupe(pts: readonly V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-6) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6) out.pop();
    else break;
  }
  return out;
}
function area2(q: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ---------------------------------------------------------------------------
// 組み立て

type FaceName = 'top' | 'front' | 'back' | 'left' | 'right';
interface FaceSpec {
  pts: V3[];
  color: string;
  lines?: V3[][];
  edged?: boolean;
}
interface SolidOpt {
  layer?: number;
  outline?: boolean;
  /** 陰影をつけない（光る面など）。 */
  flat?: boolean;
  sortY?: number;
}
interface BoxOpt extends SolidOpt {
  top?: string;
  front?: string;
  side?: string;
  lines?: Partial<Record<FaceName, V3[][]>>;
  /** 上面に x 方向の板目（本数）。 */
  topPlanks?: number;
  /** 上面に y 方向の板目（本数）。 */
  topPlanksY?: number;
  /** 手前の面に横の板目。 */
  frontPlanks?: number;
  /** 手前の面に縦の板目。 */
  frontBoards?: number;
  /** 側面に横の板目。 */
  sidePlanks?: number;
  /** 石積み（手前の面にずらした目地）。行数。 */
  bricks?: number;
}
interface CylOpt extends SolidOpt {
  n?: number;
  cap?: string;
  /** 終わりの半径（円錐台）。 */
  r1?: number;
  /** 上半分だけ（横向きの円柱で、+z 側）。 */
  half?: boolean;
  /** 年輪（両端の面に同心円）。 */
  rings?: boolean;
  /** 縦の溝（側面の本数）。 */
  flutes?: boolean;
}

class Builder {
  ops: Op[] = [];
  shadow: [number, number, number, number][] = [];
  bounds: V3[] = [];
  layer = 0;

  solid(faces: FaceSpec[], o: SolidOpt = {}): void {
    const all = faces.flatMap((f) => f.pts);
    if (all.length === 0) return;
    const c = avg(all);
    const out: Face[] = [];
    for (const f of faces) {
      let pts = dedupe(f.pts);
      if (pts.length < 3) continue;
      let n = newell(pts);
      if (len(n) < 1e-9) continue;
      if (dot(n, sub(avg(pts), c)) < 0) {
        pts = pts.slice().reverse();
        n = mul(n, -1);
      }
      n = nrm(n);
      const base = hexRgb(f.color);
      const fill = o.flat ? mixRgb(base, base, 0) : mixRgb(base, SHADE_RGB, shadeAmount(n));
      const fillRgb = hexRgb(rgbToHex(fill));
      out.push({ pts, fill, edge: mixRgb(fillRgb, OUTLINE_RGB, 0.32), lines: f.lines ?? [], edged: f.edged ?? true });
    }
    let maxY = -Infinity;
    let minZ = Infinity;
    for (const p of all) {
      if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2];
    }
    this.bounds.push(...all);
    this.ops.push({ layer: o.layer ?? this.layer, sortY: o.sortY ?? maxY, sortZ: minZ, faces: out, outline: o.outline ?? true });
  }

  /** 角錐台（下の矩形 → 上の矩形）。上を下と同じにすれば箱。 */
  frustum(x0: number, y0: number, x1: number, y1: number, z0: number, tx0: number, ty0: number, tx1: number, ty1: number, z1: number, color: string, o: BoxOpt = {}): void {
    const a: V3 = [x0, y0, z0];
    const b: V3 = [x1, y0, z0];
    const c: V3 = [x1, y1, z0];
    const d: V3 = [x0, y1, z0];
    const e: V3 = [tx0, ty0, z1];
    const f: V3 = [tx1, ty0, z1];
    const g: V3 = [tx1, ty1, z1];
    const h: V3 = [tx0, ty1, z1];
    const L = o.lines ?? {};
    const top: V3[][] = [...(L.top ?? [])];
    const front: V3[][] = [...(L.front ?? [])];
    const left: V3[][] = [...(L.left ?? [])];
    const right: V3[][] = [...(L.right ?? [])];
    const lerp = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    if (o.topPlanks) for (let i = 1; i <= o.topPlanks; i++) top.push([lerp(e, h, i / (o.topPlanks + 1)), lerp(f, g, i / (o.topPlanks + 1))]);
    if (o.topPlanksY) for (let i = 1; i <= o.topPlanksY; i++) top.push([lerp(e, f, i / (o.topPlanksY + 1)), lerp(h, g, i / (o.topPlanksY + 1))]);
    if (o.frontPlanks) for (let i = 1; i <= o.frontPlanks; i++) front.push([lerp(d, h, i / (o.frontPlanks + 1)), lerp(c, g, i / (o.frontPlanks + 1))]);
    if (o.frontBoards) for (let i = 1; i <= o.frontBoards; i++) front.push([lerp(d, c, i / (o.frontBoards + 1)), lerp(h, g, i / (o.frontBoards + 1))]);
    if (o.sidePlanks)
      for (let i = 1; i <= o.sidePlanks; i++) {
        left.push([lerp(a, e, i / (o.sidePlanks + 1)), lerp(d, h, i / (o.sidePlanks + 1))]);
        right.push([lerp(b, f, i / (o.sidePlanks + 1)), lerp(c, g, i / (o.sidePlanks + 1))]);
      }
    if (o.bricks) {
      const rows = o.bricks;
      for (let r = 1; r < rows; r++) front.push([lerp(d, h, r / rows), lerp(c, g, r / rows)]);
      const w = len(sub(c, d));
      const cols = Math.max(2, Math.round(w / 9));
      for (let r = 0; r < rows; r++) {
        const off = r % 2 === 0 ? 0 : 0.5;
        for (let i = 0; i < cols; i++) {
          const t = (i + off) / cols;
          if (t <= 0.02 || t >= 0.98) continue;
          const lo = lerp(lerp(d, h, r / rows), lerp(c, g, r / rows), t);
          const hi = lerp(lerp(d, h, (r + 1) / rows), lerp(c, g, (r + 1) / rows), t);
          front.push([lo, hi]);
        }
        for (const [p, q, list] of [[a, d, left], [b, c, right]] as const) {
          const e2 = p === a ? e : f;
          const h2 = p === a ? h : g;
          if (r > 0) list.push([lerp(p, e2, r / rows), lerp(q, h2, r / rows)]);
        }
      }
    }
    const side = o.side ?? color;
    this.solid(
      [
        { pts: [e, f, g, h], color: o.top ?? color, lines: top },
        { pts: [d, c, g, h], color: o.front ?? color, lines: front },
        { pts: [a, b, f, e], color: side, lines: L.back },
        { pts: [a, d, h, e], color: side, lines: left },
        { pts: [b, c, g, f], color: side, lines: right },
        { pts: [a, b, c, d], color },
      ],
      o,
    );
  }

  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: string, o: BoxOpt = {}): void {
    this.frustum(x0, y0, x1, y1, z0, x0, y0, x1, y1, z1, color, o);
  }

  /** 円柱（p0→p1 の軸、半径 r）。r1 で円錐台、half で上半分。 */
  cyl(p0: V3, p1: V3, r: number, color: string, o: CylOpt = {}): void {
    const n = o.n ?? 14;
    const r1 = o.r1 ?? r;
    const ax = nrm(sub(p1, p0));
    const u = Math.abs(ax[2]) < 0.9 ? nrm(cross(ax, [0, 0, 1])) : ([1, 0, 0] as V3);
    const v = nrm(cross(u, ax));
    const a0 = o.half ? 0 : 0;
    const span = o.half ? Math.PI : Math.PI * 2;
    const steps = o.half ? Math.ceil(n / 2) : n;
    const ring = (c: V3, rr: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i <= steps - (o.half ? 0 : 1); i++) {
        const t = a0 + (span * i) / steps;
        out.push(add(c, add(mul(u, Math.cos(t) * rr), mul(v, Math.sin(t) * rr))));
      }
      return out;
    };
    const A = ring(p0, r);
    const B = ring(p1, r1);
    const faces: FaceSpec[] = [];
    const cnt = A.length;
    const segs = o.half ? cnt - 1 : cnt;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % cnt;
      const lines: V3[][] = [];
      if (o.flutes && i % 2 === 0) {
        const m0 = mul(add(A[i]!, A[j]!), 0.5);
        const m1 = mul(add(B[i]!, B[j]!), 0.5);
        lines.push([add(mul(m0, 0.9), mul(m1, 0.1)), add(mul(m0, 0.1), mul(m1, 0.9))]);
      }
      faces.push({ pts: [A[i]!, A[j]!, B[j]!, B[i]!], color, edged: false, lines });
    }
    const capLines = (c: V3, pts: V3[]): V3[][] => {
      if (!o.rings) return [];
      const out: V3[][] = [];
      for (const s of [0.62, 0.3]) out.push([...pts.map((p) => add(c, mul(sub(p, c), s))), add(c, mul(sub(pts[0]!, c), s))]);
      return out;
    };
    faces.push({ pts: A, color: o.cap ?? color, lines: capLines(p0, A) });
    faces.push({ pts: B, color: o.cap ?? color, lines: capLines(p1, B) });
    if (o.half) faces.push({ pts: [A[0]!, A[cnt - 1]!, B[cnt - 1]!, B[0]!], color });
    this.solid(faces, o);
  }

  /** 縦軸まわりの回転体（profile は下から上へ [半径, 高さ]）。ドーム・つぼなど。凸な形にすること。 */
  lathe(cx: number, cy: number, profile: [number, number][], color: string, o: SolidOpt & { n?: number; cap?: string } = {}): void {
    const n = o.n ?? 18;
    const rings = profile.map(([r, z]) => {
      const out: V3[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]);
      }
      return out;
    });
    const faces: FaceSpec[] = [];
    for (let j = 0; j < rings.length - 1; j++) {
      const A = rings[j]!;
      const B = rings[j + 1]!;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        faces.push({ pts: [A[i]!, A[k]!, B[k]!, B[i]!], color, edged: false });
      }
    }
    faces.push({ pts: rings[0]!, color });
    const last = profile[profile.length - 1]!;
    if (last[0] > 0.01) faces.push({ pts: rings[rings.length - 1]!, color: o.cap ?? color });
    this.solid(faces, o);
  }

  /** 上の多角形を下へ dz だけ押し出した板（傾いた屋根・看板など）。 */
  extrude(topPts: V3[], dz: number, color: string, o: SolidOpt & { top?: string; lines?: V3[][] } = {}): void {
    const bot = topPts.map((p) => [p[0], p[1], p[2] - dz] as V3);
    const faces: FaceSpec[] = [
      { pts: topPts, color: o.top ?? color, lines: o.lines },
      { pts: bot.slice().reverse(), color },
    ];
    for (let i = 0; i < topPts.length; i++) {
      const j = (i + 1) % topPts.length;
      faces.push({ pts: [topPts[i]!, topPts[j]!, bot[j]!, bot[i]!], color });
    }
    this.solid(faces, o);
  }

  /** 切妻屋根（棟が x 方向）。 */
  gable(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: string, o: SolidOpt & { gableColor?: string; lines?: number } = {}): void {
    const ym = (y0 + y1) / 2;
    const a: V3 = [x0, y0, z0];
    const b: V3 = [x1, y0, z0];
    const c: V3 = [x1, y1, z0];
    const d: V3 = [x0, y1, z0];
    const r0: V3 = [x0, ym, z1];
    const r1: V3 = [x1, ym, z1];
    const slopeLines: V3[][] = [];
    for (let i = 1; i <= (o.lines ?? 0); i++) {
      const t = i / ((o.lines ?? 0) + 1);
      const x = x0 + (x1 - x0) * t;
      slopeLines.push([[x, y1, z0], [x, ym, z1]]);
    }
    this.solid(
      [
        { pts: [d, c, r1, r0], color, lines: slopeLines },
        { pts: [a, b, r1, r0], color },
        { pts: [a, d, r0], color: o.gableColor ?? color },
        { pts: [b, c, r1], color: o.gableColor ?? color },
        { pts: [a, b, c, d], color },
      ],
      o,
    );
  }

  custom(sortY: number, draw: (e: DrawEnv) => void, o: { layer?: number; sortZ?: number; bounds?: V3[] } = {}): void {
    if (o.bounds) this.bounds.push(...o.bounds);
    this.ops.push({ layer: o.layer ?? this.layer, sortY, sortZ: o.sortZ ?? 0, custom: draw });
  }

  /** mark 以降に足した立体の頂点を f で動かす（開いたふたの回転など）。 */
  mark(): number {
    return this.ops.length;
  }
  mapSince(m: number, f: (p: V3) => V3, layer?: number): void {
    for (let i = m; i < this.ops.length; i++) {
      const op = this.ops[i]!;
      if (!op.faces) continue;
      const all: V3[] = [];
      for (const face of op.faces) {
        face.pts = face.pts.map(f);
        face.lines = face.lines.map((l) => l.map(f));
        all.push(...face.pts);
      }
      op.sortY = Math.max(...all.map((p) => p[1]));
      op.sortZ = Math.min(...all.map((p) => p[2]));
      if (layer != null) op.layer = layer;
      this.bounds.push(...all);
    }
  }

  build(): Model {
    const ops = this.ops.slice().sort((a, b) => a.layer - b.layer || a.sortY - b.sortY || a.sortZ - b.sortZ);
    return { ops, shadow: this.shadow, bounds: this.bounds };
  }
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0, 3).map((s) => Number(s).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 描画

/** 模型を描く。P はローカル px → 画面。 */
export function drawModel(env: DrawEnv, m: Model, alpha = 1): void {
  const { ctx, P, k } = env;
  const ref = area2([P(0, 0, 0), P(TILE, 0, 0), P(0, TILE, 0)]);
  const sign = ref >= 0 ? 1 : -1;
  const ow = Math.max(0.8, 0.42 * k);
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 接地影（足元のやわらかい影。ふちを 2 段にしてぼかして見せる）
  // 角の丸い楕円をぼかして、足元の矩形にほぼ沿わせる（板のような四角い影にしない）
  for (const [x0, y0, x1, y1] of m.shadow) {
    const c = P((x0 + x1) / 2 + 1, (y0 + y1) / 2 + 0.5, 0);
    const a = P(x0, (y0 + y1) / 2, 0);
    const b = P(x1, (y0 + y1) / 2, 0);
    const t = P((x0 + x1) / 2, y0, 0);
    const d = P((x0 + x1) / 2, y1, 0);
    const rx = ((b.x - a.x) / 2) * 1.12;
    const ry = ((d.y - t.y) / 2) * 1.12;
    if (rx <= 0 || ry <= 0) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(36,58,34,0.30)');
    g.addColorStop(0.62, 'rgba(36,58,34,0.22)');
    g.addColorStop(1, 'rgba(36,58,34,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const op of m.ops) {
    if (op.custom) {
      op.custom(env);
      continue;
    }
    const faces = op.faces!;
    const vis: { f: Face; q: Pt[] }[] = [];
    for (const f of faces) {
      const q = f.pts.map((p) => P(p[0], p[1], p[2]));
      if (area2(q) * sign > 0.05) vis.push({ f, q });
    }
    if (vis.length === 0) continue;
    if (op.outline) {
      ctx.beginPath();
      for (const { q } of vis) {
        q.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
      }
      ctx.lineWidth = ow * 2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    for (const { f, q } of vis) {
      ctx.beginPath();
      q.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      // 隣の面との継ぎ目のすき間を埋める
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = f.fill;
      ctx.stroke();
    }
    ctx.lineWidth = ow * 0.75;
    for (const { f, q } of vis) {
      if (!f.edged) continue;
      ctx.beginPath();
      q.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = f.edge;
      ctx.stroke();
    }
    ctx.lineWidth = ow * 0.6;
    for (const { f } of vis) {
      if (f.lines.length === 0) continue;
      ctx.strokeStyle = f.edge;
      ctx.beginPath();
      for (const l of f.lines) {
        l.forEach((p, i) => {
          const s = P(p[0], p[1], p[2]);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 画面上で模型が占める矩形（見え隠れの判定用）。 */
export function modelScreenRect(m: Model, P: Project): { left: number; right: number; top: number; bottom: number } {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of m.bounds) {
    const s = P(p[0], p[1], p[2]);
    if (s.x < left) left = s.x;
    if (s.x > right) right = s.x;
    if (s.y < top) top = s.y;
    if (s.y > bottom) bottom = s.y;
  }
  return { left, right, top, bottom };
}

// ---------------------------------------------------------------------------
// 小物（板に立てて描く絵：花・実・炎・光）

function circle(e: DrawEnv, x: number, y: number, z: number, r: number, fill: string, outline = true): Pt {
  const p = e.P(x, y, z);
  e.ctx.beginPath();
  e.ctx.arc(p.x, p.y, Math.max(0.5, r * e.k), 0, Math.PI * 2);
  if (outline) {
    e.ctx.lineWidth = Math.max(0.7, 0.36 * e.k);
    e.ctx.strokeStyle = OUTLINE;
    e.ctx.stroke();
  }
  e.ctx.fillStyle = fill;
  e.ctx.fill();
  return p;
}

/** 実・玉（ハイライトつき）。 */
function ball(e: DrawEnv, x: number, y: number, z: number, r: number, color: string): void {
  const p = circle(e, x, y, z, r, color);
  const rr = r * e.k;
  e.ctx.beginPath();
  e.ctx.arc(p.x - rr * 0.35, p.y - rr * 0.35, rr * 0.32, 0, Math.PI * 2);
  e.ctx.fillStyle = 'rgba(255,255,255,0.55)';
  e.ctx.fill();
}

/** 花 1 輪（5 枚の花びら + 黄色い芯）。 */
function flower(e: DrawEnv, x: number, y: number, z: number, r: number, color: string): void {
  const { ctx, k } = e;
  const p = e.P(x, y, z);
  const rr = r * k;
  ctx.save();
  ctx.lineWidth = Math.max(0.6, 0.3 * k);
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.moveTo(p.x + Math.cos(a) * rr * 0.55 + rr * 0.48, p.y + Math.sin(a) * rr * 0.5);
    ctx.arc(p.x + Math.cos(a) * rr * 0.55, p.y + Math.sin(a) * rr * 0.5, rr * 0.48, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, rr * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd84a';
  ctx.fill();
  ctx.restore();
}

/** 葉のかたまり（ふわっとした丸の集まり）。 */
function leafBlob(e: DrawEnv, x: number, y: number, z: number, r: number, color = '#86cc62'): void {
  const { ctx, k } = e;
  const p = e.P(x, y, z);
  const rr = r * k;
  const offs: [number, number, number][] = [
    [-0.55, 0.15, 0.6],
    [0.55, 0.15, 0.6],
    [0, -0.25, 0.7],
    [0, 0.25, 0.65],
  ];
  ctx.save();
  ctx.beginPath();
  for (const [ox, oy, s] of offs) {
    ctx.moveTo(p.x + ox * rr + s * rr, p.y + oy * rr);
    ctx.arc(p.x + ox * rr, p.y + oy * rr, s * rr, 0, Math.PI * 2);
  }
  ctx.lineWidth = Math.max(0.8, 0.4 * k) * 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x - rr * 0.2, p.y - rr * 0.35, rr * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.restore();
}

function stem(e: DrawEnv, x: number, y: number, z0: number, z1: number, color = '#5d9e45'): void {
  const a = e.P(x, y, z0);
  const b = e.P(x, y, z1);
  e.ctx.beginPath();
  e.ctx.moveTo(a.x, a.y);
  e.ctx.lineTo(b.x, b.y);
  e.ctx.lineWidth = Math.max(0.8, 0.7 * e.k);
  e.ctx.strokeStyle = color;
  e.ctx.stroke();
}

/** やわらかい光（加算）。 */
function glow(e: DrawEnv, x: number, y: number, z: number, r: number, color: string, a: number): void {
  const p = e.P(x, y, z);
  const rr = r * e.k;
  const g = e.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
  g.addColorStop(0, color.replace('A', String(a)));
  g.addColorStop(1, color.replace('A', '0'));
  e.ctx.save();
  e.ctx.globalCompositeOperation = 'lighter';
  e.ctx.fillStyle = g;
  e.ctx.beginPath();
  e.ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
  e.ctx.fill();
  e.ctx.restore();
}

/** 面（y = 一定の平面）に貼った光る窓。 */
function windowGlow(e: DrawEnv, x0: number, x1: number, y: number, z0: number, z1: number, flick: number): void {
  const q = [e.P(x0, y, z0), e.P(x1, y, z0), e.P(x1, y, z1), e.P(x0, y, z1)];
  const ctx = e.ctx;
  ctx.beginPath();
  q.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  const g = ctx.createLinearGradient(0, q[3]!.y, 0, q[0]!.y);
  g.addColorStop(0, `rgba(255,236,150,${0.9 * flick})`);
  g.addColorStop(1, `rgba(255,170,70,${0.95 * flick})`);
  ctx.fillStyle = '#7a4a2e';
  ctx.fill();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, 0.3 * e.k);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function flickerAt(now: number, seed = 0): number {
  return 0.82 + 0.1 * Math.sin(now / 90 + seed) + 0.08 * Math.sin(now / 37 + seed * 3);
}

/** 炎（重ねたしずく形）。 */
function flame(e: DrawEnv, x: number, y: number, z: number, h: number, w: number): void {
  const { ctx, k, now } = e;
  const p = e.P(x, y, z);
  const layers: [string, number, number][] = [
    ['#ff7a3a', 1, 0],
    ['#ffb238', 0.72, 1.7],
    ['#fff1a0', 0.42, 3.1],
  ];
  ctx.save();
  for (const [c, s, seed] of layers) {
    const hh = h * k * s * (0.9 + 0.12 * Math.sin(now / 80 + seed));
    const ww = w * k * s;
    const lean = Math.sin(now / 130 + seed) * ww * 0.25;
    ctx.beginPath();
    ctx.moveTo(p.x - ww, p.y);
    ctx.quadraticCurveTo(p.x - ww * 1.05, p.y - hh * 0.55, p.x + lean, p.y - hh);
    ctx.quadraticCurveTo(p.x + ww * 1.05, p.y - hh * 0.55, p.x + ww, p.y);
    ctx.quadraticCurveTo(p.x, p.y + ww * 0.4, p.x - ww, p.y);
    ctx.fillStyle = c;
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 色見本（ピグ風のやわらかい淡色）

const WOOD = '#ecbe85';
const WOOD_MID = '#dca46a';
const WOOD_DARK = '#b98152';
const BARK = '#a8744c';
const LOG_END = '#f4d9a4';
const WHITE_WOOD = '#fbf3e4';
const STONE = '#e4dfd4';
const STONE_D = '#cbc3b4';
const STONE_DD = '#b2a99a';
const IRON = '#8f949b';
const IRON_D = '#6f6c6e';
const COPPER = '#e8a065';
const GOLD = '#f6cd55';
const SOIL = '#93603f';
const MOSS = '#9cc76b';
const TERRACOTTA = '#e5946a';
const ROOF = '#e07b62';
const CLOTH_A = '#f07f7a';
const CLOTH_B = '#fff6ea';

const FLOWERS = ['#ff9cba', '#ffd65a', '#ffffff', '#c3a6ff', '#ff8a78'];

// ---------------------------------------------------------------------------
// 個々の模型。S はマス数ぶんの px。足元はマスの縁から 2px（≒0.06 マス）内側。

const I = 2;

type ModelFn = (b: Builder, S: number) => void;

const workbench: ModelFn = (b) => {
  // 胴（引き出しつきの箱）＋ 厚い天板。マスにちょうど収まる立方体。
  b.shadow.push([I + 1, 5, 32 - I - 1, 30]);
  b.box(4, 6, 28, 28, 0, 19, WOOD_MID, {
    frontPlanks: 0,
    lines: {
      front: [
        [[6, 28, 3], [26, 28, 3]],
        [[6, 28, 10], [26, 28, 10]],
        [[16, 28, 10], [16, 28, 17]],
        [[6, 28, 17], [26, 28, 17]],
      ],
    },
    sidePlanks: 2,
  });
  // 取っ手
  b.custom(28.1, (e) => {
    circle(e, 11, 28, 13.5, 0.9, GOLD);
    circle(e, 21, 28, 13.5, 0.9, GOLD);
    circle(e, 16, 28, 6.5, 0.9, GOLD);
  });
  b.layer = 1;
  b.box(I, 4, 32 - I, 30, 19, 25, WOOD, { topPlanks: 3, frontPlanks: 0 });
  b.layer = 2;
  // 万力（左手前の角。天板の縁にかかる小さな金具とハンドル）
  b.box(5, 27.5, 10, 30.6, 20, 24.5, IRON_D, { top: IRON });
  b.cyl([4, 30.8, 21.5], [11, 30.8, 21.5], 0.7, IRON, { n: 6, layer: 3 });
  // 道具：のこぎり・かなづち・板きれ（天板に寝かせて置く）
  b.extrude([[6, 8.5, 26], [17.5, 7.5, 26], [17.5, 12.5, 26], [8, 13, 26]], 0.8, '#d7dde2', { top: '#e6ebef', lines: [[[7, 12.6, 26], [17, 12.2, 26]]] });
  b.box(17.5, 7.8, 21.5, 12.4, 25, 27.5, '#d9705a');
  b.box(13, 18.6, 23, 20.2, 25, 26.6, WOOD_DARK);
  b.box(22, 16.8, 25, 22, 25, 27.6, IRON, { top: '#b4b8be' });
  b.box(5, 17, 11.5, 25, 25, 26.8, '#f6d6a6', { topPlanksY: 1 });
  b.box(24.5, 9, 28, 12.5, 25, 26.2, '#f6d6a6');
  b.layer = 3;
  b.custom(31, craftingFx, { layer: 3, bounds: [] });
};

/** 作業台の作業中の演出：小さなかなづちがトントン、木くずとキラキラ。 */
function craftingFx(e: DrawEnv): void {
  const job = e.extra?.craft;
  if (!job) return;
  const { ctx, k, now } = e;
  const done = now >= job.endsAt;
  if (done) {
    // 完成：天板の上できらきら
    for (let i = 0; i < 3; i++) {
      const t = ((now / 900 + i / 3) % 1 + 1) % 1;
      const p = e.P(8 + i * 8, 14 + (i % 2) * 6, 28 + t * 10);
      star(ctx, p.x, p.y, (1.2 + 1.8 * Math.sin(t * Math.PI)) * k, `rgba(255,248,200,${Math.sin(t * Math.PI)})`);
    }
    return;
  }
  const PERIOD = 560;
  const ph = ((now - job.startedAt) % PERIOD) / PERIOD;
  // 振り上げ（ゆっくり）→ 振り下ろし（速く）→ 当たって少し跳ね返る
  let ang: number;
  if (ph < 0.62) ang = -1.05 * Math.sin((ph / 0.62) * (Math.PI / 2));
  else if (ph < 0.78) ang = -1.05 * (1 - (ph - 0.62) / 0.16);
  else ang = -0.12 * Math.sin(((ph - 0.78) / 0.22) * Math.PI);
  const pivot = e.P(19, 21, 34);
  const L = 9 * k;
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  // 柄
  ctx.lineWidth = 2.6 * k * 0.6 + 1.6;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-L, 0);
  ctx.stroke();
  ctx.lineWidth = 2.6 * k * 0.6;
  ctx.strokeStyle = WOOD_DARK;
  ctx.stroke();
  // 頭
  const hw = 2.2 * k;
  const hh = 3.6 * k;
  ctx.beginPath();
  ctx.roundRect?.(-L - hw, -hh / 2 + hh * 0.5, hw * 2, hh, 0.8 * k);
  if (!ctx.roundRect) ctx.rect(-L - hw, -hh / 2 + hh * 0.5, hw * 2, hh);
  ctx.fillStyle = '#9aa1a8';
  ctx.lineWidth = Math.max(0.8, 0.42 * k);
  ctx.strokeStyle = OUTLINE;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // 当たった瞬間から木くず・キラキラ
  if (ph >= 0.78) {
    const t = (ph - 0.78) / 0.22;
    const hit = e.P(10, 21, 27);
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.7;
      const d = (2 + t * 7) * k;
      ctx.beginPath();
      ctx.arc(hit.x + Math.cos(a) * d, hit.y + Math.sin(a) * d * 0.8, (1.4 - t) * k * 0.9 + 0.3, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? `rgba(246,214,166,${1 - t})` : `rgba(255,255,255,${0.9 * (1 - t)})`;
      ctx.fill();
    }
    star(ctx, hit.x + 4 * k, hit.y - 5 * k - t * 3 * k, (2.2 * (1 - t) + 0.6) * k, `rgba(255,246,190,${1 - t})`);
  }
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.32;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const woodFence: ModelFn = (b) => {
  b.shadow.push([3, 13, 29, 20]);
  for (const z of [7, 16]) b.box(5, 14.5, 27, 17.5, z, z + 4, WOOD, { frontPlanks: 0 });
  for (const x of [3, 24]) {
    b.box(x, 13, x + 5, 19, 0, 24, WOOD_MID, { frontBoards: 1 });
    b.frustum(x, 13, x + 5, 19, 24, x + 2.5, 16, x + 2.5, 16, 28, WOOD_MID);
  }
};

const stoneFence: ModelFn = (b) => {
  b.shadow.push([2, 11, 30, 22]);
  b.box(3, 12, 29, 21, 0, 12, STONE_D, { bricks: 2 });
  b.box(I, 11, 32 - I, 22, 12, 15.5, STONE, { topPlanksY: 2 });
};

const woodSign: ModelFn = (b) => {
  // 丸太を 3 本積んだ飾り
  b.shadow.push([3, 9, 29, 27]);
  // 切り口（年輪）が手前を向くように、丸太は奥行き方向に寝かせる
  for (const x of [9.5, 22.5]) b.cyl([x, 9, 6.5], [x, 27, 6.5], 6.5, BARK, { cap: LOG_END, rings: true, n: 14 });
  b.cyl([16, 10, 17.5], [16, 25.5, 17.5], 6.5, BARK, { cap: LOG_END, rings: true, n: 14, layer: 1 });
  b.custom(20, (e) => leafBlob(e, 20, 12, 24, 2.6), { layer: 2 });
};

const woodBench: ModelFn = (b) => {
  b.shadow.push([3, 9, 29, 24]);
  for (const x of [5, 24]) b.box(x, 10, x + 3, 13, 0, 26, WOOD_MID);
  b.box(3, 10.5, 29, 12.5, 16, 25, WOOD, { frontPlanks: 1 });
  for (const x of [5, 24]) b.box(x, 15, x + 3, 22, 0, 11, WOOD_MID);
  b.box(3, 13, 29, 23.5, 11, 14, WOOD, { topPlanks: 2, layer: 1 });
};

const woodDesk: ModelFn = (b) => {
  b.shadow.push([I, 6, 32 - I, 28]);
  for (const [x, y] of [
    [4, 8],
    [25, 8],
    [4, 23],
    [25, 23],
  ] as const)
    b.box(x, y, x + 3, y + 3, 0, 20, WOOD_MID);
  b.box(5, 9, 27, 25, 15, 20, WOOD_MID, { lines: { front: [[[10, 25, 17.5], [22, 25, 17.5]]] }, layer: 1 });
  b.box(I, 6, 32 - I, 28, 20, 24, WOOD, { topPlanksY: 3, layer: 2 });
};

const stoneBench: ModelFn = (b) => {
  b.shadow.push([3, 11, 29, 25]);
  for (const x of [5, 21]) b.box(x, 13, x + 6, 23, 0, 9, STONE_D);
  b.box(I + 1, 12, 32 - I - 1, 24, 9, 14, STONE, { layer: 1, lines: { top: [[[9, 15, 14], [13, 18, 14]]] } });
};

const stoneOven: ModelFn = (b) => {
  b.shadow.push([I + 1, 5, 32 - I - 1, 30]);
  b.box(I + 1, 6, 32 - I - 1, 29, 0, 14, STONE_D, { bricks: 2, top: STONE });
  // 煙突（奥の右）
  b.box(20, 8, 26, 14, 14, 40, STONE_DD, { bricks: 4, layer: 1 });
  // ドーム（半球を 4 段の円錐台で近似）
  b.lathe(16, 18, [0, 20, 38, 54, 68, 80, 90].map((d) => [Math.max(0, 11 * Math.cos((d * Math.PI) / 180)), 14 + 13 * Math.sin((d * Math.PI) / 180)] as [number, number]), STONE, { layer: 1 });
  // 焚き口（手前の面のアーチ）と火
  b.custom(29.1, (e) => {
    const { ctx } = e;
    const f = flickerAt(e.now);
    const pts: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI;
      pts.push(e.P(16 + Math.cos(a) * 6, 29, 5 + Math.sin(a) * 6));
    }
    pts.push(e.P(22, 29, 1.5), e.P(10, 29, 1.5));
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = '#4c2c22';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, 0.42 * e.k);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    flame(e, 16, 29, 1.5, 7 * f, 3.2);
    glow(e, 16, 30, 4, 12, 'rgba(255,150,60,A)', 0.35 * f);
  }, { layer: 2 });
  // 煙突の口の火の粉
  b.custom(14, (e) => {
    for (let i = 0; i < 2; i++) {
      const t = ((e.now / 1600 + i * 0.5) % 1 + 1) % 1;
      const p = e.P(23 + Math.sin(t * 6 + i) * 1.5, 11, 41 + t * 12);
      e.ctx.beginPath();
      e.ctx.arc(p.x, p.y, (1.5 + t * 2.5) * e.k, 0, Math.PI * 2);
      e.ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - t)})`;
      e.ctx.fill();
    }
  }, { layer: 3, bounds: [[23, 11, 46]] });
};

const stoneLantern: ModelFn = (b) => {
  b.shadow.push([8, 10, 24, 24]);
  b.box(8, 10, 24, 24, 0, 5, STONE_D);
  b.cyl([16, 17, 5], [16, 17, 18], 3.6, STONE, { n: 12, r1: 3 });
  b.box(10, 12, 22, 22, 18, 21, STONE_D);
  b.box(11, 13, 21, 21, 21, 29, STONE);
  b.custom(21.05, (e) => {
    const f = flickerAt(e.now, 1);
    windowGlow(e, 13.5, 18.5, 21, 22.5, 27.5, f);
    glow(e, 16, 22, 25, 16, 'rgba(255,190,90,A)', 0.32 * f);
  }, { layer: 1 });
  b.frustum(6, 9, 26, 25, 29, 13, 14, 19, 20, 34, STONE_D, { top: STONE, layer: 2 });
  b.cyl([16, 17, 34], [16, 17, 37.5], 2.2, STONE, { r1: 1.2, n: 10, layer: 3 });
};

const copperLamp: ModelFn = (b) => {
  b.shadow.push([11, 13, 21, 22]);
  b.box(11.5, 13, 20.5, 22, 0, 3, IRON_D);
  b.cyl([16, 17.5, 3], [16, 17.5, 30], 1.6, IRON_D, { n: 10 });
  b.box(12, 13.5, 20, 21.5, 30, 31.5, COPPER, { layer: 1 });
  b.box(12.8, 14.3, 19.2, 20.7, 31.5, 39, '#f7e3b0', { flat: true, layer: 1 });
  b.custom(20.75, (e) => {
    const f = flickerAt(e.now, 2);
    windowGlow(e, 13.4, 18.6, 20.7, 32, 38.4, f);
    flame(e, 16, 20.8, 32.5, 4.5 * f, 1.6);
    glow(e, 16, 20.8, 35, 15, 'rgba(255,190,90,A)', 0.36 * f);
  }, { layer: 2 });
  for (const [x, y] of [
    [12, 13.5],
    [18.8, 13.5],
    [12, 20.3],
    [18.8, 20.3],
  ] as const)
    b.box(x, y, x + 1.2, y + 1.2, 31.5, 39, COPPER, { layer: 3 });
  b.frustum(11, 12.5, 21, 22.5, 39, 15, 16.5, 17, 18.5, 44, COPPER, { layer: 4 });
  b.cyl([16, 17.5, 44], [16, 17.5, 46], 1.6, COPPER, { n: 10, layer: 5 });
};

const flowerBed: ModelFn = (b) => {
  b.shadow.push([I, 7, 32 - I, 27]);
  b.box(4, 10, 28, 24, 0, 7, SOIL, { top: '#a06b48' });
  b.box(I, 8, 32 - I, 10, 0, 9, WOOD);
  b.box(I, 10, 4, 24, 0, 9, WOOD);
  b.box(28, 10, 32 - I, 24, 0, 9, WOOD);
  b.box(I, 24, 32 - I, 26, 0, 9, WOOD, { frontBoards: 3 });
  let i = 0;
  for (const y of [13, 17.5, 21.5]) {
    for (const x of [7.5, 13, 19, 24.5]) {
      const xx = x + (y === 17.5 ? 2.5 : 0);
      if (xx > 26) continue;
      const c = FLOWERS[i++ % FLOWERS.length]!;
      b.custom(y + 0.1, (e) => {
        stem(e, xx, y, 7, 12);
        leafBlob(e, xx, y, 9, 1.8, '#7cc35c');
        flower(e, xx, y, 13, 2.4, c);
      }, { layer: 1, bounds: [[xx, y, 16]] });
    }
  }
};

const flowerPot: ModelFn = (b) => {
  b.shadow.push([8, 10, 24, 25]);
  b.cyl([16, 18, 0], [16, 18, 13], 6.5, TERRACOTTA, { r1: 8.5, n: 16 });
  b.cyl([16, 18, 13], [16, 18, 17], 9.6, '#efa47b', { n: 16, cap: SOIL });
  b.custom(19, (e) => {
    leafBlob(e, 12, 17, 20, 4.2, '#7cc35c');
    leafBlob(e, 20, 17, 21, 4.4, '#86cc62');
    leafBlob(e, 16, 19, 25, 4.8, '#92d46c');
    flower(e, 12, 19, 24, 2.6, FLOWERS[0]!);
    flower(e, 19.5, 19, 27, 2.6, FLOWERS[4]!);
    flower(e, 16, 20, 31, 2.8, FLOWERS[1]!);
  }, { layer: 1, bounds: [[16, 18, 36], [8, 18, 22], [24, 18, 22]] });
};

const fruitTable: ModelFn = (b) => {
  b.shadow.push([I, 7, 32 - I, 28]);
  for (const [x, y] of [
    [4, 9],
    [25, 9],
    [4, 23],
    [25, 23],
  ] as const)
    b.box(x, y, x + 3, y + 3, 0, 15, WOOD_MID);
  b.box(I, 7, 32 - I, 27, 15, 18.5, WOOD, { topPlanks: 2, layer: 1 });
  b.box(5, 9, 17, 18, 18.5, 25, WOOD_DARK, { frontPlanks: 1, top: '#8a5a3c', layer: 2 });
  b.custom(18.2, (e) => {
    for (const [x, y] of [
      [8, 12],
      [12, 12],
      [10, 15],
      [14.5, 15],
    ] as const)
      ball(e, x, y, 27, 2.6, '#f2664f');
    ball(e, 11, 13, 30, 2.6, '#ff8a4a');
  }, { layer: 3, bounds: [[11, 13, 33]] });
  b.custom(25, (e) => {
    for (const [x, y] of [
      [21, 18],
      [25, 18],
      [23, 22],
    ] as const)
      ball(e, x, y, 21, 2.7, '#ffb347');
    ball(e, 23, 20, 24.5, 2.7, '#ffd04d');
    leafBlob(e, 8, 22, 20.5, 2.4, '#7cc35c');
  }, { layer: 3 });
};

const veggieStand: ModelFn = (b) => {
  b.shadow.push([I, 5, 32 - I, 29]);
  for (const x of [3, 26]) b.box(x, 5, x + 3, 8, 0, 41, WOOD_MID);
  b.box(3, 12, 29, 28, 0, 14, WOOD_MID, { frontBoards: 4 });
  b.box(I, 11, 32 - I, 29, 14, 16.5, WOOD, { layer: 1 });
  // かご（野菜入り）
  b.box(5, 14, 15, 24, 16.5, 21, '#d9b27a', { frontPlanks: 1, top: '#7a5236', layer: 2 });
  b.box(17, 14, 27, 24, 16.5, 21, '#d9b27a', { frontPlanks: 1, top: '#7a5236', layer: 2 });
  b.custom(24.1, (e) => {
    for (const [x, y] of [
      [7.5, 17],
      [12, 17],
      [9.5, 21],
    ] as const) {
      leafBlob(e, x, y, 26, 1.4, '#6fbd57');
      ball(e, x, y, 22.5, 2.6, '#f7f0f6');
    }
    for (const [x, y] of [
      [19.5, 17],
      [24, 17],
      [21.5, 21],
      [25, 21],
    ] as const)
      ball(e, x, y, 22.5, 2.5, '#f05a48');
  }, { layer: 3 });
  // しましまの日よけ（奥が高い）
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x0 = I + ((32 - 2 * I) * i) / n;
    const x1 = I + ((32 - 2 * I) * (i + 1)) / n;
    b.extrude(
      [
        [x0, 3, 44],
        [x1, 3, 44],
        [x1, 23, 35],
        [x0, 23, 35],
      ],
      1.5,
      i % 2 === 0 ? CLOTH_A : CLOTH_B,
      { layer: 4, outline: true },
    );
  }
  // 日よけの垂れ（波形）
  b.custom(23.2, (e) => {
    const { ctx } = e;
    const pts: Pt[] = [];
    for (let i = 0; i <= n * 2; i++) pts.push(e.P(I + ((32 - 2 * I) * i) / (n * 2), 23, i % 2 ? 31 : 33.5));
    for (let i = 0; i < n; i++) {
      const a = e.P(I + ((32 - 2 * I) * i) / n, 23, 35);
      const c = e.P(I + ((32 - 2 * I) * (i + 1)) / n, 23, 35);
      const m = e.P(I + ((32 - 2 * I) * (i + 0.5)) / n, 23, 30.5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.quadraticCurveTo(c.x, m.y, m.x, m.y);
      ctx.quadraticCurveTo(a.x, m.y, a.x, a.y);
      ctx.closePath();
      ctx.fillStyle = mix(i % 2 === 0 ? CLOTH_A : CLOTH_B, '#7a4e5a', 0.12);
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, 0.42 * e.k);
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    void pts;
  }, { layer: 5 });
};

const woodTower: ModelFn = (b, S) => {
  // 丸太の見張り台（2×2）。4 本柱・床・手すり・はしご・屋根。
  b.shadow.push([I + 2, I + 2, S - I - 2, S - I]);
  const posts: [number, number][] = [
    [9, 9],
    [S - 9, 9],
    [9, S - 11],
    [S - 9, S - 11],
  ];
  for (const [x, y] of posts) b.cyl([x, y, 0], [x, y, 44], 4, BARK, { n: 12, cap: LOG_END });
  // すじかい
  b.box(9, 7.5, S - 9, 10.5, 18, 22, WOOD_DARK);
  b.layer = 1;
  b.box(I + 1, I + 1, S - I - 1, S - I - 4, 44, 50, WOOD, { topPlanksY: 6, frontPlanks: 1 });
  b.layer = 2;
  for (const [x, y] of posts) b.cyl([x, y, 50], [x, y, 84], 3, BARK, { n: 12, cap: LOG_END });
  b.box(I + 3, I + 3, S - I - 3, I + 5.5, 58, 62, WOOD_MID);
  b.box(I + 3, I + 5.5, I + 5.5, S - I - 6, 58, 62, WOOD_MID);
  b.box(S - I - 5.5, I + 5.5, S - I - 3, S - I - 6, 58, 62, WOOD_MID);
  b.box(I + 3, S - I - 8.5, 24, S - I - 6, 58, 62, WOOD_MID);
  b.box(40, S - I - 8.5, S - I - 3, S - I - 6, 58, 62, WOOD_MID);
  // はしご
  for (const x of [25, 37]) b.box(x, S - 6, x + 2.5, S - 3.5, 0, 52, WOOD_DARK);
  for (let z = 7; z < 50; z += 8) b.box(27.5, S - 5.6, 37, S - 4, z, z + 2, WOOD_MID);
  b.layer = 3;
  b.frustum(I, I - 1, S - I, S - I - 3, 84, S / 2 - 2, S / 2 - 3, S / 2 + 2, S / 2 + 1, 106, ROOF, {
    lines: {
      front: [
        [[18, S - I - 3, 84], [S / 2 - 1, S / 2 + 1, 106]],
        [[S - 18, S - I - 3, 84], [S / 2 + 1, S / 2 + 1, 106]],
      ],
    },
  });
  b.cyl([S / 2, S / 2 - 1, 106], [S / 2, S / 2 - 1, 112], 1, IRON_D, { n: 8, layer: 4 });
  b.custom(S / 2, (e) => {
    const { ctx, now } = e;
    const p = e.P(S / 2 + 1, S / 2 - 1, 111);
    const wave = Math.sin(now / 260) * 1.2 * e.k;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + 5 * e.k, p.y + 1 * e.k + wave, p.x + 10 * e.k, p.y + 2 * e.k);
    ctx.lineTo(p.x, p.y + 6 * e.k);
    ctx.closePath();
    ctx.fillStyle = '#ffd65a';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, 0.42 * e.k);
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }, { layer: 5, bounds: [[S / 2 + 11, S / 2, 112]] });
};

const flowerArch: ModelFn = (b, S) => {
  b.shadow.push([I + 2, 24, 16, 40]);
  b.shadow.push([S - 16, 24, S - I - 2, 40]);
  // 足元の植え込み
  for (const x0 of [I + 2, S - 16]) b.box(x0, 25, x0 + 12, 39, 0, 7, '#c99a6a', { frontBoards: 2, top: SOIL });
  // 格子の柱
  for (const x0 of [6, S - 14]) {
    b.box(x0, 28, x0 + 8, 36, 7, 52, WHITE_WOOD, { frontPlanks: 5, frontBoards: 1, layer: 1 });
  }
  // 半円のアーチ
  const cx = S / 2;
  const R0 = 18;
  const R1 = 26;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI - (Math.PI * i) / n;
    const a1 = Math.PI - (Math.PI * (i + 1)) / n;
    const pts = (y: number): V3[] => [
      [cx + Math.cos(a0) * R0, y, 52 + Math.sin(a0) * R0],
      [cx + Math.cos(a1) * R0, y, 52 + Math.sin(a1) * R0],
      [cx + Math.cos(a1) * R1, y, 52 + Math.sin(a1) * R1],
      [cx + Math.cos(a0) * R1, y, 52 + Math.sin(a0) * R1],
    ];
    const f = pts(36);
    const bk = pts(28);
    b.solid(
      [
        { pts: f, color: WHITE_WOOD },
        { pts: bk, color: WHITE_WOOD },
        { pts: [f[0]!, f[1]!, bk[1]!, bk[0]!], color: WHITE_WOOD },
        { pts: [f[2]!, f[3]!, bk[3]!, bk[2]!], color: WHITE_WOOD },
        { pts: [f[1]!, f[2]!, bk[2]!, bk[1]!], color: WHITE_WOOD },
        { pts: [f[3]!, f[0]!, bk[0]!, bk[3]!], color: WHITE_WOOD },
      ],
      { layer: 2 },
    );
  }
  // つる・花
  b.custom(37, (e) => {
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI - (Math.PI * i) / 12;
      const x = cx + Math.cos(a) * 22;
      const z = 52 + Math.sin(a) * 22;
      leafBlob(e, x, 37, z, 2.6, i % 2 ? '#7cc35c' : '#8fd06a');
      if (i % 2 === 0) flower(e, x + 1.5, 38, z + 1, 2.6, FLOWERS[(i / 2) % FLOWERS.length]!);
    }
    for (const x of [10, S - 10]) {
      for (const z of [14, 26, 38]) leafBlob(e, x + (z === 26 ? 2 : -1), 37, z, 2.4, '#7cc35c');
      flower(e, x + 1, 38, 30, 2.4, FLOWERS[0]!);
      flower(e, x - 1, 38, 44, 2.4, FLOWERS[3]!);
      leafBlob(e, x, 39, 9, 4, '#86cc62');
      flower(e, x - 3, 40, 11, 2.4, FLOWERS[1]!);
      flower(e, x + 3, 40, 10, 2.4, FLOWERS[4]!);
    }
  }, { layer: 3, bounds: [[cx, 37, 52 + 26 + 4], [I, 37, 40], [S - I, 37, 40]] });
};

const stoneStatue: ModelFn = (b, S) => {
  // 石の像（2×2）。2 段の台座の上に、ころんとした石の顔。
  b.shadow.push([I + 2, I + 6, S - I - 2, S - I]);
  b.box(I + 2, I + 8, S - I - 2, S - I - 1, 0, 8, STONE_D, { bricks: 1 });
  b.box(I + 8, I + 14, S - I - 8, S - I - 7, 8, 16, STONE);
  b.layer = 1;
  b.frustum(18, 20, S - 18, S - 20, 16, 20, 22, S - 20, S - 22, 66, '#d6d0c4', { top: '#e2ddd2' });
  b.layer = 2;
  b.box(17, S - 22, S - 17, S - 18.5, 48, 54, '#cdc6b9'); // 眉
  b.frustum(29, S - 22, 35, S - 17, 30, 29.5, S - 22, 34.5, S - 19, 48, '#d2cbbe'); // 鼻
  b.box(26, S - 22, 38, S - 20, 24, 27, '#bdb5a7'); // 口
  for (const x of [15, S - 19]) b.box(x, 32, x + 4, 40, 34, 50, '#cdc6b9'); // 耳
  b.custom(S - 21, (e) => {
    // 苔
    for (const [x, z, r] of [
      [22, 64, 3],
      [40, 62, 2.4],
      [13, 9, 2.6],
      [S - 12, 7, 2.2],
    ] as const)
      leafBlob(e, x, S - 20, z, r, MOSS);
  }, { layer: 3 });
};

const ruinPillar: ModelFn = (b) => {
  b.shadow.push([5, 7, 27, 29]);
  b.box(5, 7, 27, 29, 0, 6, STONE_D, { top: STONE });
  b.cyl([16, 18, 6], [16, 18, 44], 7.5, STONE, { n: 16, flutes: true, r1: 7 });
  b.box(4, 6, 28, 30, 44, 50, STONE_D, { top: STONE, layer: 1 });
  b.custom(29, (e) => {
    leafBlob(e, 10, 29, 4, 2.6, MOSS);
    leafBlob(e, 25, 28, 48, 2, MOSS);
  }, { layer: 2 });
};

const campfire: ModelFn = (b) => {
  b.shadow.push([5, 7, 27, 28]);
  b.custom(0, (e) => glow(e, 16, 18, 0, 22, 'rgba(255,170,80,A)', 0.28 * flickerAt(e.now)), { layer: -1 });
  const stones = 9;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const x = 16 + Math.cos(a) * 10;
    const y = 18 + Math.sin(a) * 8.5;
    b.cyl([x, y, 0], [x, y, 4.5], 3.1, i % 2 ? STONE_D : STONE, { n: 7, r1: 2.4 });
  }
  b.cyl([8, 22, 1.5], [17, 16.5, 12], 2.1, BARK, { cap: LOG_END, n: 10, sortY: 20 });
  b.cyl([24, 22, 1.5], [15, 16.5, 12], 2.1, BARK, { cap: LOG_END, n: 10, sortY: 20.5 });
  b.cyl([16, 11, 1.5], [16, 17.5, 12], 2.1, WOOD_DARK, { cap: LOG_END, n: 10, sortY: 14 });
  b.custom(21, (e) => {
    const f = flickerAt(e.now);
    flame(e, 16, 18.5, 2, 15 * f, 5.5);
    glow(e, 16, 18.5, 8, 14, 'rgba(255,200,110,A)', 0.4 * f);
  }, { bounds: [[16, 18, 20]] });
};

const ruinArch: ModelFn = (b) => {
  b.shadow.push([2, 11, 30, 23]);
  for (const x of [3, 22]) b.box(x, 12, x + 7, 22, 0, 32, STONE, { bricks: 4, top: STONE });
  b.box(1.5, 11, 30.5, 23, 32, 39, STONE_D, { top: STONE, layer: 1, lines: { front: [[[12, 23, 39], [14, 23, 35], [13, 23, 32]]] } });
  b.custom(23.2, (e) => {
    leafBlob(e, 5, 23, 39, 2.8, MOSS);
    leafBlob(e, 27, 23, 34, 2.2, MOSS);
    leafBlob(e, 8, 23, 3, 2.4, MOSS);
  }, { layer: 2 });
};

const oldPillar: ModelFn = (b) => {
  b.shadow.push([6, 8, 26, 28]);
  b.box(6, 8, 26, 28, 0, 5, STONE_D, { top: STONE });
  b.cyl([16, 18, 5], [16, 18, 26], 7, STONE, { n: 14, flutes: true });
  // 欠けた頭（斜めのかけら）
  b.frustum(10.5, 13, 21.5, 23, 26, 12, 14, 17, 22, 32, STONE, { top: '#d7d0c3' });
  b.custom(28.5, (e) => {
    leafBlob(e, 9.5, 27, 3.5, 2.6, MOSS);
    leafBlob(e, 21, 25, 22, 2, MOSS);
    leafBlob(e, 13, 24, 30, 1.8, MOSS);
  }, { layer: 2 });
};

// ---- 設備・宝箱・看板 ----

const ruinsAltar: ModelFn = (b) => {
  b.shadow.push([I, 4, 32 - I, 30]);
  b.box(I, 4, 32 - I, 30, 0, 5, STONE_D, { top: STONE, bricks: 1 });
  b.box(6, 8, 26, 26, 5, 10, STONE, { top: '#ece8de' });
  b.box(10, 13, 22, 21, 10, 40, '#d4cdbf', { top: '#e2ddd2', layer: 1 });
  b.custom(21.1, (e) => {
    const { ctx, now } = e;
    const pulse = 0.5 + 0.5 * Math.sin(now / 500);
    // 紋様（光る丸と線）
    const c = e.P(16, 21, 30);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(e, 16, 22, 30, 12, 'rgba(95,227,201,A)', 0.3 + 0.3 * pulse);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3.2 * e.k, 0, Math.PI * 2);
    const a = e.P(16, 21, 14);
    ctx.moveTo(c.x, c.y + 3.2 * e.k);
    ctx.lineTo(a.x, a.y);
    ctx.lineWidth = Math.max(1, 0.8 * e.k);
    ctx.strokeStyle = `rgba(95,227,201,${0.6 + 0.4 * pulse})`;
    ctx.stroke();
    leafBlob(e, 7, 26, 9, 2.4, MOSS);
    leafBlob(e, 21, 21, 39, 2, MOSS);
  }, { layer: 2 });
};

const dockPost: ModelFn = (b) => {
  b.shadow.push([3, 8, 29, 28]);
  b.box(I, 8, 32 - I, 28, 0, 3, WOOD, { topPlanksY: 4 });
  b.cyl([16, 18, 3], [16, 18, 30], 4.6, BARK, { n: 14, cap: LOG_END, rings: true, layer: 1 });
  b.cyl([16, 18, 17], [16, 18, 20], 5.3, '#e3cc94', { n: 14, layer: 2 });
  b.cyl([16, 18, 22], [16, 18, 24.5], 5.3, '#e3cc94', { n: 14, layer: 2 });
};

function chestModel(opened: boolean): ModelFn {
  return (b) => {
    b.shadow.push([5, 9, 27, 27]);
    const x0 = 6;
    const x1 = 26;
    const y0 = 11;
    const y1 = 25;
    const zb = 12;
    b.box(x0, y0, x1, y1, 0, zb, '#c98a52', { frontPlanks: 1, top: opened ? '#5a3524' : '#c98a52' });
    for (const bx of [9, 21]) b.box(bx, y1 - 0.2, bx + 2, y1 + 0.8, 0, zb, IRON, { layer: 1 });
    // ふた（半円筒）。開いたらうしろの蝶番まわりに倒す
    const r = (y1 - y0) / 2;
    const m = b.mark();
    b.cyl([x0, (y0 + y1) / 2, zb], [x1, (y0 + y1) / 2, zb], r, '#d89a5f', { half: true, n: 12, layer: 3 });
    for (const bx of [9, 21]) b.cyl([bx, (y0 + y1) / 2, zb], [bx + 2, (y0 + y1) / 2, zb], r + 0.6, IRON, { half: true, n: 12, layer: 4 });
    if (opened) {
      const ang = (-105 * Math.PI) / 180;
      const cy = y0;
      const cz = zb;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      b.mapSince(m, (p) => {
        const dy = p[1] - cy;
        const dz = p[2] - cz;
        return [p[0], cy + dy * cs - dz * sn, cz + dy * sn + dz * cs];
      }, -1);
      b.custom(y1, (e) => {
        glow(e, 16, 18, zb + 3, 14, 'rgba(255,230,140,A)', 0.4);
        for (const [x, y] of [
          [11, 16],
          [16, 19],
          [21, 16],
        ] as const)
          ball(e, x, y, zb + 1.5, 2, GOLD);
      }, { layer: 5 });
    } else {
      // 錠前（ふたの手前の縁にかかる小さな金具）
      b.box(14, y1 - 0.5, 18, y1 + 1.3, zb - 3.5, zb + 1.5, GOLD, { layer: 5 });
      b.custom(y1 + 1.4, (e) => circle(e, 16, y1 + 1.3, zb - 1.2, 0.6, '#7a5236', false), { layer: 6 });
    }
  };
}

const farmSign: ModelFn = (b) => {
  b.shadow.push([12, 14, 20, 21]);
  b.box(14, 15.5, 18, 19.5, 0, 22, WOOD_DARK);
  b.box(4, 17, 28, 20, 12, 29, WOOD, { frontPlanks: 1, layer: 1 });
};

/** 看板の板の手前の面の中心（作物のアイコンを貼る場所、ローカル px）。 */
export const SIGN_ICON_AT: V3 = [16, 20, 20.5];

// ---------------------------------------------------------------------------
// 表

const FURNITURE_MODELS: Record<string, ModelFn> = {
  woodFence,
  woodSign,
  woodBench,
  woodDesk,
  woodWorkbench: workbench,
  woodTower,
  stoneFence,
  stoneBench,
  stoneOven,
  stoneLantern,
  copperLamp,
  flowerBed,
  flowerPot,
  fruitTable,
  veggieStand,
  flowerArch,
  stoneStatue,
  ruinPillar,
  campfire,
  ruinArch,
  oldPillar,
};

const OTHER_MODELS: Record<string, ModelFn> = {
  'station:ruins': ruinsAltar,
  'station:dock': dockPost,
  chest: chestModel(false),
  chestOpen: chestModel(true),
  sign: farmSign,
};

const modelCache = new Map<string, Model>();

/** 模型を引く。name は家具 id か 'station:ruins' 'station:dock' 'chest' 'chestOpen' 'sign'。無ければ null。 */
export function getModel(name: string, sizeTiles = 1): Model | null {
  const key = `${name}|${sizeTiles}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const fn = FURNITURE_MODELS[name] ?? OTHER_MODELS[name];
  if (!fn) return null;
  const b = new Builder();
  fn(b, sizeTiles * TILE);
  const m = b.build();
  modelCache.set(key, m);
  return m;
}

export function hasFurnitureModel(id: string): boolean {
  return id in FURNITURE_MODELS;
}

export const FURNITURE_MODEL_IDS: readonly string[] = Object.keys(FURNITURE_MODELS);

/** 家具が占めるマス数（ランドマークは 2）。 */
export function furnitureTiles(id: string): number {
  const def = FURNITURE_BY_ID[id];
  return def ? furnitureSize(def.attr) : 1;
}

// ---------------------------------------------------------------------------
// アイコン（持ち物・クラフト画面）。ゲーム内と同じ模型を、少し右から見た 3/4 の固定視点で描く。

const ICON_SHEAR = 0.3;
const ICON_DEPTH = 0.62;

/** w×h（ワールド px）の枠に収めて描く。 */
export function paintModelIcon(ctx: Ctx, name: string, sizeTiles: number, w: number, h: number, pad = 1.5): void {
  const m = getModel(name, sizeTiles);
  if (!m) return;
  const S = sizeTiles * TILE;
  const raw: Project = (x, y, z) => ({ x: x - ICON_SHEAR * (y - S / 2), y: ICON_DEPTH * y - z });
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of m.bounds) {
    const s = raw(p[0], p[1], p[2]);
    x0 = Math.min(x0, s.x);
    x1 = Math.max(x1, s.x);
    y0 = Math.min(y0, s.y);
    y1 = Math.max(y1, s.y);
  }
  const sc = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
  const ox = w / 2 - ((x0 + x1) / 2) * sc;
  const oy = h - pad - y1 * sc;
  const P: Project = (x, y, z) => {
    const s = raw(x, y, z);
    return { x: ox + s.x * sc, y: oy + s.y * sc };
  };
  drawModel({ ctx, P, k: sc, now: 0 }, m);
}

// ---------------------------------------------------------------------------
// 作業台の吹き出し（作っている家具のアイコン + 進みの輪 + 残り時間。完成したら「できた！」で弾む）

export function drawCraftBubble(
  ctx: Ctx,
  x: number,
  y: number,
  scale: number,
  icon: CanvasImageSource | null,
  progress: number,
  remainingMs: number,
  now: number,
  font: string,
): void {
  const done = progress >= 1;
  const bounce = done ? Math.abs(Math.sin(now / 260)) * 6 * scale : Math.sin(now / 600) * 1.2 * scale;
  const label = done ? 'できた！' : formatMs(remainingMs);
  ctx.save();
  ctx.translate(x, y - bounce);
  ctx.scale(scale, scale);
  ctx.font = `800 13px ${font}`;
  const tw = ctx.measureText(label).width;
  const R = 15; // 輪の半径
  const W = R * 2 + 10 + tw + 14;
  const H = 40;
  const left = -W / 2;
  const top = -H - 8;
  // 吹き出し
  ctx.beginPath();
  roundRectPath(ctx, left, top, W, H, 14);
  ctx.moveTo(-6, top + H - 0.5);
  ctx.lineTo(0, top + H + 8);
  ctx.lineTo(6, top + H - 0.5);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(120,82,56,0.95)';
  ctx.stroke();
  ctx.fillStyle = done ? '#fff7d6' : '#fffdf6';
  ctx.fill();
  // 輪（進み）
  const cx = left + 7 + R;
  const cy = top + H / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#efe6d6';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
  ctx.closePath();
  ctx.fillStyle = done ? '#ffc94a' : '#9fd877';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (icon) {
    const s = (R - 4) * 2;
    ctx.drawImage(icon, cx - s / 2, cy - s / 2, s, s);
  }
  // 文字
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = done ? '#f0782f' : '#8a6640';
  ctx.fillText(label, cx + R + 8, cy + 1);
  if (done) {
    const t = (now / 700) % 1;
    star(ctx, left + W - 6, top + 4, 5 * (0.6 + 0.4 * Math.sin(t * Math.PI * 2)), '#ffd84a');
    star(ctx, left + 4, top + H - 6, 3.5 * (0.6 + 0.4 * Math.cos(t * Math.PI * 2)), '#ffd84a');
  }
  ctx.restore();
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
