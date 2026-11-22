// 見ているだけで和む「島の空気」。ゲームの状態は持たず、すべて時刻 now と位置から決まる（決定的・保存不要）。
//
//   - 風: ゆっくりした揺れ（周期 3.6〜6 秒）に、ときどき島を横切る突風の波が重なる。
//     木・花・作物・草・葦は、絵を横の帯に切って、根元からの高さの 2 乗に比例して横へずらす（根元は動かない）。
//     どんな絵にも効くので、素材を差し替えてもそのまま揺れる。
//   - 雲の影: 大きなやわらかい影が 3 つ、風下へゆっくり流れる。
//   - 蝶: 花のまわりを数匹がふわふわ飛ぶ。
//   - 落ち葉: 一部の木から、ときどき 1 枚ひらひら落ちる。
//   - 岸の波: 岸近くの水面に、白い小さな波の線が寄せては消える。
//   - 光の呼吸: 画面全体のあたたかい光が、9 秒周期でごくわずかに強まる・弱まる。
//
// どれも 1 フレームに数十回の drawImage / 図形で済む量にしてある（スマホで 60fps を守る）。

import { effectiveScale, GROUND_DEPTH, HEIGHT_SCALE, project3, TILE, worldToScreen, type CameraState, type Viewport } from './camera';

import rainDropUrl from '@/assets/gen/rain_drop.png';
import rainRippleUrl from '@/assets/gen/rain_ripple.png';

type Ctx = CanvasRenderingContext2D;

function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// 風

/** 突風の波が島を渡る速さ（ワールド px/秒）と間隔（ワールド px）。1 か所を通るのはおよそ 11 秒に 1 回。 */
const GUST_SPEED = 3.2 * TILE;
const GUST_SPACING = 36 * TILE;
/** 突風の幅（間隔に対する割合）。 */
const GUST_WIDTH = 0.07;

/**
 * (wx, wy) での風による傾き。おおむね -0.8..+1.6（+ が風下 = 右）。
 * 近い物ほど位相がそろい、島を横切って揺れが流れていくように見える。
 */
export function windAt(wx: number, wy: number, now: number): number {
  const t = now / 1000;
  // 位置で位相をずらす（となりどうしは少しだけずれる）
  const ph = wx * 0.011 + wy * 0.006;
  const base = Math.sin(TAU * (t / 4.3) - ph) * 0.55 + Math.sin(TAU * (t / 6.1) - ph * 1.7 + 1.3) * 0.3;
  // 突風：右へ流れる波。通るあいだは風下へ傾き、細かく震える
  const f = (((t * GUST_SPEED - wx - wy * 0.35) / GUST_SPACING) % 1 + 1) % 1;
  const d = (f - 0.5) / GUST_WIDTH;
  const gust = Math.exp(-d * d);
  return base + gust * (0.9 + 0.25 * Math.sin(t * 7.5 + ph * 3));
}

/** 風の強さの全体の目安（0..1）。雲の流れや落ち葉の横流れに使う。 */
export function gustAt(wx: number, wy: number, now: number): number {
  const t = now / 1000;
  const f = (((t * GUST_SPEED - wx - wy * 0.35) / GUST_SPACING) % 1 + 1) % 1;
  const d = (f - 0.5) / GUST_WIDTH;
  return Math.exp(-d * d);
}

/**
 * 揺れの大きさ（梢のてっぺんが動くワールド px）。名前で引く（絵を差し替えても名前は変わらない）。
 * 揺らさない物は 0。大きな古い木ほど硬く、草花ほどよく揺れる。
 */
export function swayAmpFor(name: string): number {
  if (name.startsWith('stump') || name === 'rubble') return 0;
  if (name === 'ancientTree' || name === 'ancientTree2') return 1.3;
  if (name === 'cedarTree' || name === 'gateCedar') return 1.6;
  if (name === 'bigTree' || name === 'gateOak') return 1.9;
  if (name === 'palm') return 2.8;
  if (name === 'tree') return 2.3;
  if (name === 'sapling' || name === 'flowerSprout') return 1.6;
  if (name.startsWith('flower')) return 1.9;
  if (name.startsWith('deco_reed')) return 2.4;
  if (name.startsWith('deco_tuft')) return 1.5;
  if (/^(turnip|tomato|sunflower|carrot|wheat|potato|pumpkin|strawberry)\d$/.test(name)) return name.startsWith('sunflower') ? 2 : 1.1;
  return 0;
}

/**
 * 絵を横の帯に切って、根元からの高さの 2 乗だけ横へずらして描く（根元は止まったまま、梢ほど大きく揺れる）。
 * 帯どうしは斜めに傾けてつなぐので、継ぎ目で絵が切れない。(left, top, w, h) は今の座標系での描画先、swayPx は梢のずれ。
 */
export function blitSway(ctx: Ctx, img: CanvasImageSource, left: number, top: number, w: number, h: number, swayPx: number): void {
  const src = img as { width: number; height: number };
  const cw = src.width;
  const ch = src.height;
  if (Math.abs(swayPx) < 0.08 || !cw || !ch) {
    ctx.drawImage(img, left, top, w, h);
    return;
  }
  // 帯の数：背の高い絵ほど細かく（画面 30px ごと、2〜4 本）。帯ごとに斜めに傾けてつなぐので、4 本でも曲がって見える。
  // 10px ごと（最大 9 本）では描画が 1.4ms 増えた（PC、390×844・DPR 2、木 100 本ほど）ので減らした。
  const n = Math.max(2, Math.min(4, Math.round(h / 30)));
  const offAt = (i: number) => {
    const hf = 1 - i / n; // 根元 = 0、てっぺん = 1
    return swayPx * hf * hf;
  };
  const m = ctx.getTransform();
  for (let i = 0; i < n; i++) {
    const y0 = top + (h * i) / n;
    const y1 = top + (h * (i + 1)) / n;
    const o0 = offAt(i); // 帯の上の縁のずれ
    const o1 = offAt(i + 1); // 下の縁のずれ
    const skew = (o0 - o1) / (y0 - y1); // y が 1 下がるごとの横ずれ
    // x' = x + o1 + skew·(y − y1)  （帯の上下の縁で隣の帯とぴったり合う）
    ctx.transform(1, 0, skew, 1, o1 - skew * y1, 0);
    // 継ぎ目のすき間を埋めるため、帯の下側を少しだけ重ねる
    const pad = i < n - 1 ? 0.6 : 0;
    const sy0 = (ch * i) / n;
    const sh = Math.min(ch - sy0, (ch / n) * (1 + (pad * n) / h));
    ctx.drawImage(img, 0, sy0, cw, sh, left, y0, w, (sh / ch) * h);
    ctx.setTransform(m);
  }
}

// ---------------------------------------------------------------------------
// 雲の影

let cloudCanvas: HTMLCanvasElement | null = null;

/** ふちのぼけた雲の形（円をいくつか重ねたもの）を 1 度だけ焼く。 */
function getCloud(): HTMLCanvasElement {
  if (cloudCanvas) return cloudCanvas;
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const g = c.getContext('2d')!;
  const puffs: [number, number, number][] = [
    [70, 70, 44],
    [112, 60, 50],
    [146, 76, 36],
    [96, 86, 40],
    [48, 82, 28],
  ];
  for (const [x, y, r] of puffs) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.32)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  // 白の濃さを影の色に置き換える（重なりの濃淡は残す）
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgb(24,48,70)';
  g.fillRect(0, 0, c.width, c.height);
  cloudCanvas = c;
  return c;
}

const CLOUDS = [
  { x: 0.1, y: 0.2, size: 15, speed: 1.0 },
  { x: 0.55, y: 0.55, size: 19, speed: 0.8 },
  { x: 0.85, y: 0.85, size: 13, speed: 1.15 },
];
const CLOUD_ALPHA = 0.1;
/** 雲の流れる速さ（ワールド px/秒）。 */
const CLOUD_SPEED = 0.42 * TILE;

/** 雲の影を地面に落とす（物の上にもかかる）。マップを右下へ流れて、端まで行くと反対側から戻ってくる。 */
export function drawCloudShadows(ctx: Ctx, camera: CameraState, viewport: Viewport, now: number, mapW: number, mapH: number): void {
  const img = getCloud();
  const t = now / 1000;
  const margin = 12 * TILE;
  const spanX = mapW + margin * 2;
  const spanY = mapH + margin * 2;
  ctx.save();
  ctx.globalAlpha = CLOUD_ALPHA;
  for (const c of CLOUDS) {
    const wx = ((((c.x * spanX + t * CLOUD_SPEED * c.speed) % spanX) + spanX) % spanX) - margin;
    const wy = ((((c.y * spanY + t * CLOUD_SPEED * c.speed * 0.35) % spanY) + spanY) % spanY) - margin;
    const s = worldToScreen(wx, wy, camera, viewport);
    const w = c.size * TILE * s.k;
    const h = w * (img.height / img.width) * GROUND_DEPTH;
    if (s.x + w / 2 < 0 || s.x - w / 2 > viewport.widthCssPx || s.y + h / 2 < 0 || s.y - h / 2 > viewport.heightCssPx) continue;
    ctx.drawImage(img, s.x - w / 2, s.y - h / 2, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 光の呼吸

let lightGrad: { w: number; h: number; g: CanvasGradient } | null = null;

/** 左上から差すあたたかい光を、9 秒周期でごくわずかに強める（強いときでも 6%）。 */
export function drawLightBreath(ctx: Ctx, w: number, h: number, now: number): void {
  if (!lightGrad || lightGrad.w !== w || lightGrad.h !== h) {
    const g = ctx.createRadialGradient(w * 0.2, -h * 0.1, 0, w * 0.2, -h * 0.1, Math.hypot(w, h) * 1.05);
    g.addColorStop(0, 'rgba(255,236,190,1)');
    g.addColorStop(0.55, 'rgba(255,236,190,0.35)');
    g.addColorStop(1, 'rgba(255,236,190,0)');
    lightGrad = { w, h, g };
  }
  const breath = 0.5 + 0.5 * Math.sin((TAU * now) / 9000);
  ctx.save();
  ctx.globalAlpha = 0.025 + 0.035 * breath;
  ctx.fillStyle = lightGrad.g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 岸の波

interface ShoreCell {
  x: number; // 波の線の中心（ワールド px）
  y: number;
  seed: number;
}
const shoreCache = new WeakMap<readonly string[], ShoreCell[]>();

/** 岸から 1〜2 マスの水のマス（波の線を置く場所）。地面ごとに 1 度だけ作る。 */
function shoreCells(width: number, height: number, ground: readonly string[]): ShoreCell[] {
  let cells = shoreCache.get(ground);
  if (cells) return cells;
  cells = [];
  const isWater = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || ground[y * width + x] === 'water';
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      if (!isWater(tx, ty)) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (!isWater(tx + dx, ty + dy)) near = true;
      if (!near) continue;
      const seed = hash2(tx, ty, 91);
      if (seed > 0.55) continue; // 全部に置くとうるさい
      cells.push({ x: (tx + 0.2 + 0.6 * hash2(tx, ty, 92)) * TILE, y: (ty + 0.2 + 0.6 * hash2(tx, ty, 93)) * TILE, seed });
    }
  }
  shoreCache.set(ground, cells);
  return cells;
}

const WAVE_PERIOD_MS = 4200;
const WAVE_BUCKETS = 6;

/** 岸近くの水面に、白い小さな波の線（〜）がゆっくり現れて横へ伸び、消える。透明度ごとにまとめて 1 本のパスで描く。 */
export function drawShoreWaves(
  ctx: Ctx,
  width: number,
  height: number,
  ground: readonly string[],
  camera: CameraState,
  viewport: Viewport,
  now: number,
  minTx: number,
  minTy: number,
  maxTx: number,
  maxTy: number,
): void {
  const cells = shoreCells(width, height, ground);
  const paths: Path2D[] = Array.from({ length: WAVE_BUCKETS }, () => new Path2D());
  const used = new Array<boolean>(WAVE_BUCKETS).fill(false);
  let lw = 1;
  for (const c of cells) {
    const tx = c.x / TILE;
    const ty = c.y / TILE;
    if (tx < minTx - 1 || tx > maxTx + 1 || ty < minTy - 1 || ty > maxTy + 1) continue;
    const u = ((now / WAVE_PERIOD_MS + c.seed * 7) % 1 + 1) % 1;
    const a = Math.sin(u * Math.PI); // 0 → 1 → 0
    if (a < 0.12) continue;
    const s = worldToScreen(c.x, c.y, camera, viewport);
    const half = TILE * s.k * (0.16 + 0.2 * u); // だんだん横へ伸びる
    const bump = TILE * s.k * 0.05 * GROUND_DEPTH;
    const b = Math.min(WAVE_BUCKETS - 1, Math.floor(a * WAVE_BUCKETS));
    const p = paths[b]!;
    // ゆるい 1 本の弧（2 つ山にすると鳥に見える）
    p.moveTo(s.x - half, s.y + bump);
    p.quadraticCurveTo(s.x, s.y - bump, s.x + half, s.y + bump);
    used[b] = true;
    lw = Math.max(1, 0.05 * TILE * s.k);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lw;
  for (let b = 0; b < WAVE_BUCKETS; b++) {
    if (!used[b]) continue;
    ctx.globalAlpha = ((b + 0.5) / WAVE_BUCKETS) * 0.45;
    ctx.stroke(paths[b]!);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 蝶

const BUTTERFLY_COLORS: [string, string][] = [
  ['#fff8dc', '#f3d27a'],
  ['#ffe066', '#f0a830'],
  ['#ffc2d4', '#f27ea0'],
  ['#c9e4ff', '#7fb2ea'],
];

/** 花のまわりを飛ぶ蝶の、今の位置（ワールド px と高さ z）。花 1 つにつき 0 か 1 匹（位置のハッシュで決まる）。 */
export function butterflyAt(fx: number, fy: number, now: number): { x: number; y: number; z: number; flap: number; color: number; dir: number } | null {
  const h = hash2(fx, fy, 501);
  if (h > 0.45) return null;
  const t = now / 1000 + h * 100;
  const ph = h * 37;
  const cx = (fx + 0.5) * TILE;
  const cy = (fy + 0.7) * TILE;
  const x = cx + 16 * Math.sin(t * 0.55 + ph) + 7 * Math.sin(t * 1.7 + ph * 2);
  const y = cy + 9 * Math.sin(t * 0.43 + ph * 3);
  const z = 13 + 6 * Math.sin(t * 1.1 + ph) + 2 * Math.sin(t * 3.1);
  const vx = 16 * 0.55 * Math.cos(t * 0.55 + ph) + 7 * 1.7 * Math.cos(t * 1.7 + ph * 2);
  return { x, y, z, flap: Math.abs(Math.sin(t * 11 + ph)), color: Math.floor(hash2(fx, fy, 502) * BUTTERFLY_COLORS.length), dir: vx >= 0 ? 1 : -1 };
}

/** 蝶を 1 匹描く（コードで描く小さな絵。羽は開閉する）。 */
export function drawButterfly(ctx: Ctx, b: NonNullable<ReturnType<typeof butterflyAt>>, camera: CameraState, viewport: Viewport): void {
  const g = worldToScreen(b.x, b.y, camera, viewport);
  const p = project3(b.x, b.y, b.z, camera, viewport);
  const s = 5.2 * p.k;
  // 地面の小さな影
  ctx.fillStyle = 'rgba(30,55,30,0.12)';
  ctx.beginPath();
  ctx.ellipse(g.x, g.y, s * 0.8, s * 0.8 * GROUND_DEPTH * 0.4, 0, 0, TAU);
  ctx.fill();
  const [light, dark] = BUTTERFLY_COLORS[b.color]!;
  const f = 0.22 + 0.78 * b.flap; // 羽の開き（1 = 全開）
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(b.dir * 0.12);
  ctx.lineWidth = Math.max(0.6, 0.18 * p.k);
  ctx.strokeStyle = 'rgba(92,58,42,0.75)';
  for (const side of [-1, 1]) {
    // 上の羽・下の羽
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(side * s * 0.52 * f, -s * 0.18, s * 0.55 * f + 0.3, s * 0.45, side * 0.35, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(side * s * 0.38 * f, s * 0.3, s * 0.36 * f + 0.3, s * 0.3, -side * 0.3, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(80,50,36,0.95)';
  ctx.lineWidth = Math.max(0.8, 0.3 * p.k);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.45);
  ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 落ち葉

const LEAF_FALL_MS = 3400;
const LEAF_REST_MS = 700;

/**
 * 木 (tx,ty) から今落ちている葉 1 枚（無ければ null）。一部の木だけが 9〜15 秒に 1 回落とす。
 * zFrac は梢の高さに対する今の高さ（1 = 梢、0 = 地面）。梢の高さは描く側が絵から決める（落ちている葉の分だけ計算すればよい）。
 */
export function leafAt(tx: number, ty: number, now: number): { x: number; y: number; zFrac: number; rot: number; alpha: number } | null {
  const h = hash2(tx, ty, 611);
  if (h > 0.4) return null;
  const period = 9000 + h * 15000;
  const cycle = Math.floor((now + h * 50000) / period);
  const age = ((now + h * 50000) % period + period) % period;
  if (age > LEAF_FALL_MS + LEAF_REST_MS) return null;
  const r = hash2(tx * 7 + cycle, ty, 612);
  const sec = Math.min(age, LEAF_FALL_MS) / 1000;
  const u = Math.min(1, age / LEAF_FALL_MS);
  const x0 = (tx + 0.5) * TILE + (r - 0.5) * TILE * 0.9;
  const y0 = (ty + 0.9) * TILE + (hash2(tx, ty * 5 + cycle, 613) - 0.2) * TILE * 0.5;
  // 風下（右）へ少し流れながら、左右に振れて落ちる
  const x = x0 + sec * 7 + Math.sin(sec * 2.6 + r * 6) * 7;
  const zFrac = (1 - u) * (0.75 + 0.25 * r);
  const rot = Math.sin(sec * 3.1 + r * 4) * 0.9;
  const alpha = age < 200 ? age / 200 : age > LEAF_FALL_MS ? 1 - (age - LEAF_FALL_MS) / LEAF_REST_MS : 1;
  return { x, y: y0, zFrac, rot, alpha };
}

/** 高さ z（ワールド px）を、立てた絵の画面上の高さと同じ縮みで持ち上げる量（画面 px）。 */
export function liftPx(z: number, k: number): number {
  return z * HEIGHT_SCALE * k;
}

// ---------------------------------------------------------------------------
// 天気（SI-18）。雨は斜めの線が落ちる。くもりは空気が灰色にくもる。晴れは光が少し強い（drawLightBreath 側）。

/** 雨の素材（ChatGPT 製、scripts/slice-gen.mjs の weather シート）。読み込めるまでは線で代わりに描く。 */
const rainDropImg = new Image();
rainDropImg.src = rainDropUrl;
const rainRippleImg = new Image();
rainRippleImg.src = rainRippleUrl;
const RAIN_DROPS = 46;
const RIPPLES = 14;

export function drawWeather(ctx: Ctx, w: number, h: number, now: number, weather: 'sunny' | 'cloudy' | 'rainy' | 'plain'): void {
  if (weather === 'cloudy') {
    ctx.save();
    ctx.fillStyle = 'rgba(120,135,150,0.14)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  if (weather !== 'rainy') return;
  ctx.save();
  ctx.fillStyle = 'rgba(70,90,115,0.2)';
  ctx.fillRect(0, 0, w, h);
  const t = now / 1000;
  const dropsReady = rainDropImg.complete && rainDropImg.naturalWidth > 0;
  // 水滴: 斜めに落ちる。手前（大きい）ほどはやい
  ctx.strokeStyle = 'rgba(240,248,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < RAIN_DROPS; i++) {
    const near = hash2(i, 3);
    const speed = 0.8 + near * 0.6;
    const fy = (hash2(i, 1) + t * speed * 0.75) % 1;
    const x = (hash2(i, 2) * (w + 40) - fy * 24) % (w + 20);
    const y = fy * (h + 40) - 20;
    if (dropsReady) {
      const dw = 6 + near * 5;
      const dh = dw * (rainDropImg.naturalHeight / rainDropImg.naturalWidth);
      ctx.globalAlpha = 0.55 + near * 0.3;
      ctx.drawImage(rainDropImg, x, y, dw, dh);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 13);
    }
  }
  if (!dropsReady) ctx.stroke();
  // 波紋: 画面の下 2/3 のあちこちに、ふくらんで消える
  if (rainRippleImg.complete && rainRippleImg.naturalWidth > 0) {
    for (let i = 0; i < RIPPLES; i++) {
      const life = (t * 0.6 + hash2(i, 5) * 7) % 1.6;
      if (life > 1) continue;
      const cycle = Math.floor((t * 0.6 + hash2(i, 5) * 7) / 1.6);
      const x = hash2(i + cycle * 31, 6) * w;
      const y = h * 0.34 + hash2(i + cycle * 17, 7) * h * 0.62;
      const rw = 10 + life * 26;
      ctx.globalAlpha = (1 - life) * 0.5;
      ctx.drawImage(rainRippleImg, x - rw / 2, y - rw * 0.2, rw, rw * 0.4);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// たから探しの光（SI-28）: ChatGPT 製の絵（光る土の山・きらめき・光の玉。scripts/slice-gen.mjs の treasure シート）。
// 近づくほどはっきり見える。遠く（GLINT_RANGE より外）では見えない。掘ると土しぶき（tr_dirt）が 0.8 秒ふくらんで消える。

import trMoundUrl from '@/assets/gen/tr_mound.png';
import trSparkleUrl from '@/assets/gen/tr_sparkle.png';
import trOrbUrl from '@/assets/gen/tr_orb.png';
import trDirtUrl from '@/assets/gen/tr_dirt.png';

const loadImg = (src: string) => {
  const i = new Image();
  i.src = src;
  return i;
};
const imgMound = loadImg(trMoundUrl);
const imgSparkle = loadImg(trSparkleUrl);
const imgOrb = loadImg(trOrbUrl);
const imgDirt = loadImg(trDirtUrl);
const ready = (i: HTMLImageElement) => i.complete && i.naturalWidth > 0;

/** 光が見え始める距離（マス）。これより近いと見える。 */
export const GLINT_RANGE = 9;

let digFx: { x: number; y: number; at: number } | null = null;
/** 掘った瞬間に呼ぶ（土しぶきの出どころ）。 */
export function triggerDig(x: number, y: number, now: number): void {
  digFx = { x, y, at: now };
}

export function drawTreasureGlint(
  ctx: Ctx,
  camera: CameraState,
  viewport: Viewport,
  now: number,
  spot: { x: number; y: number } | null,
  player: { x: number; y: number },
): void {
  const k = effectiveScale(camera, viewport.baseScale);
  if (digFx) {
    const life = (now - digFx.at) / 800;
    if (life >= 1 || life < 0) digFx = null;
    else if (ready(imgDirt)) {
      const p = worldToScreen((digFx.x + 0.5) * TILE, (digFx.y + 0.5) * TILE, camera, viewport);
      const w = TILE * (0.9 + 0.7 * life) * k;
      ctx.save();
      ctx.globalAlpha = 1 - life;
      ctx.drawImage(imgDirt, p.x - w / 2, p.y - w * 0.8 - life * TILE * 0.5 * k, w, w * (imgDirt.naturalHeight / imgDirt.naturalWidth));
      ctx.restore();
    }
  }
  if (!spot) return;
  const dist = Math.hypot(spot.x + 0.5 - player.x, spot.y + 0.5 - player.y);
  if (dist > GLINT_RANGE) return;
  const near = 1 - dist / GLINT_RANGE;
  const p = worldToScreen((spot.x + 0.5) * TILE, (spot.y + 0.5) * TILE, camera, viewport);
  const t = now / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(TAU * (t / 1.6));
  ctx.save();
  // 光る土の山（そばに寄るほど濃く、大きく）
  if (ready(imgMound)) {
    const w = TILE * (0.7 + 0.5 * near) * k;
    ctx.globalAlpha = 0.25 + 0.75 * near;
    ctx.drawImage(imgMound, p.x - w / 2, p.y - w * (imgMound.naturalHeight / imgMound.naturalWidth) * 0.8, w, w * (imgMound.naturalHeight / imgMound.naturalWidth));
  }
  // 光の玉（呼吸）
  if (ready(imgOrb)) {
    const w = TILE * (0.5 + 0.2 * pulse) * k;
    ctx.globalAlpha = (0.15 + 0.35 * near) * (0.6 + 0.4 * pulse);
    ctx.drawImage(imgOrb, p.x - w / 2, p.y - w / 2 - TILE * 0.2 * k, w, w);
  }
  // きらめき 2 つ（ゆっくり回る）
  if (ready(imgSparkle)) {
    for (let j = 0; j < 2; j++) {
      const w = TILE * (0.3 + 0.2 * near) * (0.7 + 0.3 * Math.sin(TAU * (t / 1.3 + j * 0.5))) * k;
      ctx.globalAlpha = 0.5 + 0.5 * near;
      ctx.drawImage(imgSparkle, p.x + (j ? 0.3 : -0.3) * TILE * k - w / 2, p.y - TILE * (0.45 + 0.2 * j) * k - w / 2, w, w);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 時間帯の光（SI-33）。端末の時刻（朝・昼・夕・夜）で、画面全体にごく薄い色を重ねる。新しい絵は使わない。
// 朝: 桃色のやわらかい光 / 昼: なし / 夕: 橙 / 夜: 青く暗い（見えなくならない程度。最大 0.2）。

/** 時刻（0〜24 の小数）→ 重ねる色と濃さ。昼は null。 */
export function daylightAt(hour: number): { rgb: [number, number, number]; alpha: number } | null {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const key: { h: number; rgb: [number, number, number]; a: number }[] = [
    { h: 0, rgb: [30, 45, 110], a: 0.2 },
    { h: 5, rgb: [30, 45, 110], a: 0.2 },
    { h: 6.5, rgb: [255, 190, 170], a: 0.1 },
    { h: 8, rgb: [255, 220, 190], a: 0.0 },
    { h: 16, rgb: [255, 220, 190], a: 0.0 },
    { h: 17.5, rgb: [255, 150, 70], a: 0.14 },
    { h: 19, rgb: [150, 90, 130], a: 0.16 },
    { h: 20.5, rgb: [30, 45, 110], a: 0.2 },
    { h: 24, rgb: [30, 45, 110], a: 0.2 },
  ];
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i + 1 < key.length; i++) {
    const a = key[i]!;
    const b = key[i + 1]!;
    if (h >= a.h && h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      const alpha = lerp(a.a, b.a, t);
      if (alpha < 0.005) return null;
      return { rgb: [lerp(a.rgb[0], b.rgb[0], t), lerp(a.rgb[1], b.rgb[1], t), lerp(a.rgb[2], b.rgb[2], t)], alpha };
    }
  }
  return null;
}

export function drawDaylight(ctx: Ctx, w: number, h: number, now: number): void {
  const d = new Date(now);
  const c = daylightAt(d.getHours() + d.getMinutes() / 60);
  if (!c) return;
  ctx.save();
  ctx.fillStyle = `rgba(${Math.round(c.rgb[0])},${Math.round(c.rgb[1])},${Math.round(c.rgb[2])},${c.alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
