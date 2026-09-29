// Canvas 描画。draw(ctx, state) を毎フレーム呼ぶだけで盤面全体を描く。
// トースト・パーティクルは時間で消えるアニメーションなので、モジュール内の
// effects オブジェクトが state を持つ（store.onEvents から push してもらう）。
//
// 視点は「斜めから見下ろす」遠近法（camera.ts）。地面は画面の横線 1 本ぶんずつの帯に切って
// 奥ほど細く貼る（＝マスが台形になる）。立っている物は足元の投影点にまっすぐ立てて、
// その地点の倍率 k で描く。y（足元の奥行き）順に並べるので、背の高い物は後ろのマスを隠す。

import type {
  DecorKind,
  Fail,
  GameEvent,
  ItemId,
  MapNode,
  NodeKind,
  SaveState,
  StationKind,
  Target,
  World,
} from '@/game/types';
import { CROPS, FURNITURE_BY_ID, FURNITURE_DISPLAY_SIZE, ITEMS, NODES, STATIONS } from '@/game/data';
import { cropProgress } from '@/game/time';
import { isBuildable, nodeAlive, placementRect } from '@/game/rules';
import { store } from '@/game/store';

import { followFactor, screenToWorld, TILE, TILT_DEG, type CameraState, type Viewport, worldToScreen } from './camera';
import { getGroundFurnitureSprite, getSprite, type SpriteName } from './sprites';
import type { PaintedTerrain } from './terrain';
import { TERRAIN_PX } from './terrainCore';
import type { TreeInstance } from './forestTrees';

const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);

// ---------------------------------------------------------------------------
// 描画に渡す状態

export interface Vec2 {
  x: number;
  y: number;
}

export interface RenderState {
  world: World;
  save: SaveState;
  now: number;
  camera: CameraState;
  viewport: Viewport;
  decorate: boolean;
  target: (Target & { blocked?: Fail }) | null;
  moving: boolean;
  dpr: number;
  stick: { anchor: Vec2; finger: Vec2 } | null;
  /** 事前描画した地面レイヤー（WorldView がロード時に焼いて渡す）。まだ無ければ null。 */
  terrain: PaintedTerrain | null;
  /** 草地・水面・岸に置く花・草・睡蓮など（見た目だけ。WorldView が一度だけ生成して渡す）。 */
  groundDecor: TreeInstance[];
}

// ---------------------------------------------------------------------------
// パーティクル・トースト（時間経過で消える）

interface Particle {
  x: number; // ワールド px
  y: number;
  vx: number;
  vy: number;
  sprite: SpriteName; // fx_leaf（木）/ fx_dust（岩）
  startedAt: number;
  lifeMs: number;
}

interface Toast {
  text: string;
  x: number; // ワールド px（生成時のアンカー）
  y: number;
  startedAt: number;
  big: boolean;
}

const PARTICLE_LIFE_MS = 500;
const TOAST_LIFE_MS = 900;

const isStoneKind = (k: NodeKind) => k === 'rock' || k === 'hardRock' || k === 'borderRock';

class Effects {
  particles: Particle[] = [];
  toasts: Toast[] = [];

  private spawnParticles(x: number, y: number, sprite: SpriteName, now: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 40;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        sprite,
        startedAt: now,
        lifeMs: PARTICLE_LIFE_MS,
      });
    }
  }

  private pushToast(text: string, x: number, y: number, now: number, big = false): void {
    this.toasts.push({ text, x, y, startedAt: now, big });
  }

  pushEvents(events: GameEvent[], now: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'hit': {
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.6) * TILE, (isStoneKind(ev.kind) ? 'fx_dust' : 'fx_leaf') as SpriteName, now, 4);
          break;
        }
        case 'broke': {
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.6) * TILE, (isStoneKind(ev.kind) ? 'fx_dust' : 'fx_leaf') as SpriteName, now, 6);
          const parts = Object.entries(ev.drops)
            .filter(([, n]) => (n ?? 0) > 0)
            .map(([id, n]) => `${ITEMS[id as ItemId]?.name ?? id} +${n}`);
          if (parts.length) this.pushToast(parts.join(' '), (ev.x + 0.5) * TILE, ev.y * TILE, now);
          break;
        }
        case 'harvested': {
          const t = ev.tiles[0];
          if (t) {
            const name = CROPS[ev.crop]?.name ?? ev.crop;
            this.pushToast(`${name} +${ev.amount}`, (t.x + 0.5) * TILE, t.y * TILE, now);
          }
          break;
        }
        case 'xp': {
          this.pushToast(`+${ev.amount} EXP`, store.get().player.x * TILE, store.get().player.y * TILE, now);
          break;
        }
        case 'areaOpened': {
          this.pushToast(`${ev.area} がひらけた！`, -1, -1, now, true);
          break;
        }
        case 'chest': {
          const name = FURNITURE_BY_ID[ev.recipe]?.name ?? ev.recipe;
          this.pushToast(`レシピ：${name}`, (ev.x + 0.5) * TILE, ev.y * TILE, now);
          break;
        }
        default:
          break;
      }
    }
  }

  prune(now: number): void {
    this.particles = this.particles.filter((p) => now - p.startedAt < p.lifeMs);
    this.toasts = this.toasts.filter((t) => now - t.startedAt < TOAST_LIFE_MS);
  }
}

export const effects = new Effects();

// ---------------------------------------------------------------------------
// 見え隠れ：プレイヤーが背の高い物（木・柱）の後ろに隠れたら、その物を半透明にする。
// 判定は画面上の矩形の重なり（斜めの視点では、奥にいる人が手前の木の梢に隠れる）。
// 個体ごとに現在の透明度を持ち、150ms のイージングで目標値へ近づける。

const OCCLUSION_ALPHA = 0.5;
const OCCLUSION_HALF_LIFE_SEC = 0.15;
const occlusionAlpha = new Map<string, number>();
let lastFrameNow: number | null = null;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 2 つの矩形の重なりが、プレイヤー矩形の何割か。 */
function overlapRatio(a: Rect, player: Rect): number {
  const w = Math.min(a.right, player.right) - Math.max(a.left, player.left);
  const h = Math.min(a.bottom, player.bottom) - Math.max(a.top, player.top);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / ((player.right - player.left) * (player.bottom - player.top));
}

// 物は消さない。プレイヤーが物の「後ろ」（奥）にいて、物がプレイヤーの体を 1/4 以上おおうときだけ半透明にする。
function occlusionFor(key: string, rect: Rect, footWorldY: number, playerWorldY: number, playerRect: Rect, ease: number): number {
  const behind = playerWorldY < footWorldY - 0.2 * TILE; // プレイヤーの足元が対象の根元より奥（北）
  const target = behind && overlapRatio(rect, playerRect) > 0.25 ? OCCLUSION_ALPHA : 1;
  const prev = occlusionAlpha.get(key) ?? 1;
  const next = prev + (target - prev) * ease;
  occlusionAlpha.set(key, next);
  return next;
}

// ---------------------------------------------------------------------------
// 小さなユーティリティ

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const OCEAN = '#1b5f7c'; // 地図の外（海）

const DECOR_SPRITE: Record<DecorKind, SpriteName> = {
  rubble: 'decor_rubble' as SpriteName,
  brokenStone: 'decor_brokenStone' as SpriteName,
  pillar: 'decor_pillar' as SpriteName,
  ship: 'decor_ship' as SpriteName,
};

const STATION_SPRITE: Partial<Record<StationKind, SpriteName>> = {
  ruins: 'station_ruins' as SpriteName,
  workbench: 'station_workbench' as SpriteName,
  dock: 'station_dock' as SpriteName,
};

const DIAMOND_LIGHT: readonly [number, number, number] = [147, 204, 111];
const DIAMOND_DARK: readonly [number, number, number] = [119, 184, 81];
const GRID_LINE = 'rgba(221, 237, 201, 0.85)';

// 見た目だけの置物（ゲームロジック上は存在しない）。座標はタイル単位、スプライトの下辺中央がここに来る。
const RUINS_ARCH = { x: 7.5, y: 15 };
const PLAZA_CAMPFIRE = { x: 15.5, y: 18 };

// 壊れて復活待ちの岩に残す瓦礫。木は「幹（stump 状態）を切ると消える」ので、消えたあとには何も残さない
// （前はここで幹を描いていて、切れない幹に見えていた）。
const NODE_TO_STUMP: Partial<Record<NodeKind, SpriteName>> = {
  rock: 'rubble' as SpriteName,
  hardRock: 'rubble' as SpriteName,
};

const NODE_TOOL: Record<NodeKind, 'axe' | 'pick'> = {
  tree: 'axe',
  bigTree: 'axe',
  borderTree: 'axe',
  forestTree: 'axe',
  rock: 'pick',
  hardRock: 'pick',
  borderRock: 'pick',
};

/** 背が高く、後ろに人が隠れる物。 */
const TALL_NODES = new Set<NodeKind>(['tree', 'bigTree', 'borderTree', 'forestTree']);

// ---------------------------------------------------------------------------
// 地面（平らな画像）を斜め視点に貼る。画面の横線 BAND px ぶんの帯ごとに、その高さの地面を切り出して
// 奥ほど細く（倍率 k に合わせて）描く。terrain 全体でも、1 マスぶんの道タイルでも同じ関数で貼る。

const BAND = 2;

function drawGroundImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  wx0: number,
  wy0: number,
  wx1: number,
  wy1: number,
  camera: CameraState,
  viewport: Viewport,
): void {
  // この矩形が画面のどの高さに映るか
  const yTopScreen = worldToScreen(wx0, wy0, camera, viewport).y;
  const yBotScreen = worldToScreen(wx0, wy1, camera, viewport).y;
  const from = Math.max(0, Math.floor(Math.min(yTopScreen, yBotScreen)));
  const to = Math.min(viewport.heightCssPx, Math.ceil(Math.max(yTopScreen, yBotScreen)));
  const ww = wx1 - wx0;
  const wh = wy1 - wy0;
  for (let y = from; y < to; y += BAND) {
    const yb = Math.min(to, y + BAND);
    const top = screenToWorld(0, y, camera, viewport).y;
    const bot = screenToWorld(0, yb, camera, viewport).y;
    const sy0w = Math.max(wy0, top);
    const sy1w = Math.min(wy1, bot);
    if (sy1w <= sy0w) continue;
    const left = screenToWorld(0, (y + yb) / 2, camera, viewport).x;
    const right = screenToWorld(viewport.widthCssPx, (y + yb) / 2, camera, viewport).x;
    const sx0w = Math.max(wx0, left);
    const sx1w = Math.min(wx1, right);
    if (sx1w <= sx0w) continue;
    const a = worldToScreen(sx0w, sy0w, camera, viewport);
    const b = worldToScreen(sx1w, sy1w, camera, viewport);
    ctx.drawImage(
      image,
      ((sx0w - wx0) / ww) * imgW,
      ((sy0w - wy0) / wh) * imgH,
      ((sx1w - sx0w) / ww) * imgW,
      ((sy1w - sy0w) / wh) * imgH,
      a.x,
      a.y,
      b.x - a.x,
      b.y - a.y + 0.6,
    );
  }
}

/** タイル (tx,ty) の四隅を画面へ投影した台形。 */
function tileQuad(tx: number, ty: number, w: number, h: number, camera: CameraState, viewport: Viewport): Vec2[] {
  return [
    worldToScreen(tx * TILE, ty * TILE, camera, viewport),
    worldToScreen((tx + w) * TILE, ty * TILE, camera, viewport),
    worldToScreen((tx + w) * TILE, (ty + h) * TILE, camera, viewport),
    worldToScreen(tx * TILE, (ty + h) * TILE, camera, viewport),
  ];
}

function polygonPath(ctx: CanvasRenderingContext2D, pts: Vec2[], inset = 0): void {
  // inset: 中心へ寄せる割合（0〜0.5）
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = p.x + (cx - p.x) * inset;
    const y = p.y + (cy - p.y) * inset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// メイン描画

export function draw(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { world, save, now, camera, viewport, dpr } = state;
  currentCtx = ctx;

  const occlusionDtSec = lastFrameNow == null ? 0 : Math.max(0, Math.min(0.2, (now - lastFrameNow) / 1000));
  lastFrameNow = now;
  const occlusionEase = followFactor(occlusionDtSec, OCCLUSION_HALF_LIFE_SEC);

  const W = viewport.widthCssPx;
  const H = viewport.heightCssPx;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, W, H);

  // 見えるマスの範囲：画面の四隅を地面へ逆投影して囲む（奥の左右の隅がいちばん広い）
  const corners = [screenToWorld(0, 0, camera, viewport), screenToWorld(W, 0, camera, viewport), screenToWorld(0, H, camera, viewport), screenToWorld(W, H, camera, viewport)];
  const minTx = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) / TILE) - 1);
  const maxTx = Math.min(world.width - 1, Math.ceil(Math.max(...corners.map((c) => c.x)) / TILE) + 1);
  const minTy = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) / TILE) - 1);
  const maxTy = Math.min(world.height - 1, Math.ceil(Math.max(...corners.map((c) => c.y)) / TILE) + 3);

  const inView = (sx: number, sy: number, padX: number, padTop: number): boolean =>
    sx > -padX && sx < W + padX && sy > -20 && sy < H + padTop;

  // 足元のやわらかい影。sx,sy は足元の画面座標、w は絵の幅（画面 px）。
  const drawShadow = (sx: number, sy: number, w: number, strength = 1) => {
    const rx = w * 0.42;
    const ry = rx * 0.3;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    g.addColorStop(0, `rgba(30,55,30,${(0.28 * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(30,55,30,0)');
    ctx.save();
    ctx.translate(0, sy);
    ctx.scale(1, ry / rx);
    ctx.translate(0, -sy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** スプライトを足元 (wx,wy)（ワールド px）にまっすぐ立てて描く。 */
  const drawUpright = (name: SpriteName, wx: number, wy: number, shadow = true, alpha = 1) => {
    const spr = getSprite(name);
    const p = worldToScreen(wx, wy, camera, viewport);
    const w = spr.w * p.k;
    const h = spr.h * p.k;
    if (p.x + w / 2 < 0 || p.x - w / 2 > W || p.y - h > H || p.y < 0) return;
    if (shadow) drawShadow(p.x, p.y - h * 0.02, w * 0.9);
    if (alpha < 0.999) ctx.globalAlpha = alpha;
    ctx.drawImage(spr.canvas, p.x - w / 2, p.y - h, w, h);
    if (alpha < 0.999) ctx.globalAlpha = 1;
  };

  const drawAtTile = (name: SpriteName, tx: number, ty: number, shadow = true, alpha = 1) =>
    drawUpright(name, (tx + 0.5) * TILE, (ty + 1) * TILE, shadow, alpha);

  /** 見え隠れつきで描く（プレイヤーが後ろに重なれば半透明）。 */
  const drawOccludable = (key: string, name: SpriteName, wx: number, wy: number, shadow = true) => {
    const spr = getSprite(name);
    const p = worldToScreen(wx, wy, camera, viewport);
    const rect: Rect = { left: p.x - (spr.w * p.k) / 2, right: p.x + (spr.w * p.k) / 2, top: p.y - spr.h * p.k, bottom: p.y };
    const alpha = occlusionFor(key, rect, wy, save.player.y * TILE, playerRect, occlusionEase);
    drawUpright(name, wx, wy, shadow, alpha);
  };

  /** 家具を「デザインで決めた表示サイズ」に contain-fit して、footprint の下辺中央 (wx,wy) に立てる。 */
  const drawFurnitureAtWorld = (furnitureId: string, wx: number, wy: number) => {
    const spr = getSprite(`f_${furnitureId}` as SpriteName);
    const size = FURNITURE_DISPLAY_SIZE[furnitureId] ?? { w: 1, h: 1 };
    const p = worldToScreen(wx, wy, camera, viewport);
    const boxW = size.w * TILE * p.k;
    const boxH = size.h * TILE * p.k * 1.15; // 立てて見るぶん縦を少し高く取る
    const artAspect = spr.w / spr.h || 1;
    let drawW: number;
    let drawH: number;
    if (artAspect > boxW / boxH) {
      drawW = boxW;
      drawH = boxW / artAspect;
    } else {
      drawH = boxH;
      drawW = boxH * artAspect;
    }
    drawShadow(p.x, p.y - drawH * 0.03, drawW * 0.85);
    ctx.drawImage(spr.canvas, p.x - drawW / 2, p.y - drawH, drawW, drawH);
  };

  // プレイヤーの画面上の矩形（見え隠れ判定用）
  const playerSpr = getSprite(`player_${save.player.dir}0` as SpriteName);
  const pp = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
  const playerRect: Rect = {
    left: pp.x - (playerSpr.w * pp.k) / 2,
    right: pp.x + (playerSpr.w * pp.k) / 2,
    top: pp.y - playerSpr.h * pp.k,
    bottom: pp.y,
  };

  // --- 地面 ---
  if (state.terrain) {
    const t = state.terrain;
    drawGroundImage(ctx, t.canvas, t.width * TERRAIN_PX, t.height * TERRAIN_PX, 0, 0, t.width * TILE, t.height * TILE, camera, viewport);
    drawWaterSparkles(ctx, world, camera, viewport, now, minTx, minTy, maxTx, maxTy);
  }

  if (state.terrain && state.decorate) {
    // 模様替え中：家具を置けるマス（歩ける地面。水・畑・資源の上は除く）に、斜め視点で台形になるマス目を敷く
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = GRID_LINE;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!isBuildable(world, save, tx, ty)) continue;
        const rgb = (tx + ty) % 2 === 0 ? DIAMOND_LIGHT : DIAMOND_DARK;
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.92)`;
        polygonPath(ctx, tileQuad(tx, ty, 1, 1, camera, viewport));
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --- 畑の作物 ---
  for (const plot of world.plots) {
    const ps = save.plots[plot.id];
    if (!ps) continue;
    for (const t of plot.tiles) {
      const tile = ps.tiles[`${t.x},${t.y}`];
      if (!tile) continue;
      const progress = cropProgress(tile, now);
      const stage = progress < 0.34 ? 0 : progress < 1 ? 1 : 2;
      drawAtTile(`${tile.crop}${stage}` as SpriteName, t.x, t.y, false);
      if (stage === 2) {
        const s = worldToScreen((t.x + 0.5) * TILE, (t.y + 0.4) * TILE, camera, viewport);
        const twinkle = 0.4 + 0.4 * Math.sin(now / 180 + hash2(t.x, t.y) * 10);
        const spr = getSprite('fx_sparkle' as SpriteName);
        const w = spr.w * s.k * 0.7;
        const h = spr.h * s.k * 0.7;
        ctx.globalAlpha = twinkle;
        ctx.drawImage(spr.canvas, s.x - w / 2, s.y - h / 2, w, h);
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- 看板（選んでいる作物のアイコンを小さく載せる） ---
  for (const plot of world.plots) {
    drawAtTile('sign' as SpriteName, plot.sign.x, plot.sign.y);
    const ps = save.plots[plot.id];
    if (ps?.selected) {
      const s = worldToScreen((plot.sign.x + 0.5) * TILE, (plot.sign.y + 0.55) * TILE, camera, viewport);
      const spr = getSprite(`item_${ps.selected}` as SpriteName);
      const w = spr.w * s.k * 0.5;
      const h = spr.h * s.k * 0.5;
      ctx.drawImage(spr.canvas, s.x - w / 2, s.y - h / 2 - 0.6 * TILE * s.k * 0.6, w, h);
    }
  }

  // --- y ソート対象（資源・宝箱・置いた家具・飾り・プレイヤー）。sortY は足元のタイル y。 ---
  type Drawable = { y: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (const node of world.nodes) {
    if (node.x < minTx - 1 || node.x > maxTx + 1 || node.y < minTy - 3 || node.y > maxTy + 1) continue;
    const alive = nodeAlive(save, node, now);
    if (alive && save.nodes[node.id]?.stump) {
      drawables.push({ y: node.y + 1, draw: () => drawAtTile('stump' as SpriteName, node.x, node.y) });
    } else if (alive) {
      drawables.push({
        y: node.y + 1,
        draw: () => drawNode(node, now, state, drawOccludable, drawAtTile),
      });
    } else if (NODES[node.kind].respawnMs !== null) {
      const stump = NODE_TO_STUMP[node.kind];
      if (stump) drawables.push({ y: node.y + 1, draw: () => drawAtTile(stump, node.x, node.y) });
    }
  }

  for (const chest of world.chests) {
    const opened = save.chestsOpened.includes(chest.id);
    drawables.push({ y: chest.y + 1, draw: () => drawAtTile((opened ? 'chestOpen' : 'chest') as SpriteName, chest.x, chest.y) });
  }

  // --- 昔の暮らしの名残・商船。ship のような大物は w×h の矩形の下辺中央に据える。 ---
  for (const d of world.decor ?? []) {
    const name = DECOR_SPRITE[d.kind];
    const wx = (d.x + d.w / 2) * TILE;
    const wy = (d.y + d.h) * TILE;
    if (d.kind === 'pillar') {
      drawables.push({ y: d.y + d.h, draw: () => drawOccludable(`decor:${d.x},${d.y}`, name, wx, wy) });
    } else {
      drawables.push({ y: d.y + d.h, draw: () => drawUpright(name, wx, wy) });
    }
  }

  // --- 設備（遺跡・作業台・船着き場・家の跡地） ---
  for (const station of world.stations) {
    const spriteName = STATION_SPRITE[station.kind];
    drawables.push({
      y: station.y + 1,
      draw: () => {
        if (spriteName) {
          if (station.kind === 'ruins') drawOccludable(`station:${station.x},${station.y}`, spriteName, (station.x + 0.5) * TILE, (station.y + 1) * TILE);
          else drawAtTile(spriteName, station.x, station.y);
        }
        if (station.kind === 'ruins') drawRuinsGlow(station.x, station.y, now, camera, viewport);
      },
    });
  }

  // --- 置いた家具（左上のマス "x,y" から size×size を占める） ---
  for (const [anchor, furnitureId] of Object.entries(save.placements)) {
    const r = placementRect(anchor, furnitureId);
    if (r.x < minTx - 2 || r.x > maxTx + 2 || r.y < minTy - 3 || r.y > maxTy + 2) continue;
    if (furnitureId === 'woodPath' || furnitureId === 'stonePath') {
      // 道の家具は地面にぴったり敷く 1 マスの絵（台形に貼る）
      drawables.push({
        y: r.y - 100, // 地面と同じ高さ。他のすべての物の下
        draw: () => {
          const spr = getGroundFurnitureSprite(furnitureId, r.x, r.y);
          const iw = (spr.canvas as { width: number }).width || spr.w;
          const ih = (spr.canvas as { height: number }).height || spr.h;
          drawGroundImage(ctx, spr.canvas, iw, ih, r.x * TILE, r.y * TILE, (r.x + 1) * TILE, (r.y + 1) * TILE, camera, viewport);
        },
      });
      continue;
    }
    drawables.push({
      y: r.y + r.size,
      draw: () => drawFurnitureAtWorld(furnitureId, (r.x + r.size / 2) * TILE, (r.y + r.size) * TILE),
    });
  }

  // --- 地面の飾り（花・草・睡蓮・葦。可視範囲だけ描く） ---
  for (const d of state.groundDecor) {
    if (d.x < minTx - 2 || d.x > maxTx + 3 || d.y < minTy - 2 || d.y > maxTy + 3) continue;
    drawables.push({ y: d.flat ? -1000 : d.y - 0.5, draw: () => drawUpright(d.sprite, d.x * TILE, d.y * TILE, false) });
  }

  // --- 遺跡入口のアーチ・広場のかがり火（見た目だけの置物） ---
  drawables.push({ y: RUINS_ARCH.y, draw: () => drawUpright('decor_arch' as SpriteName, RUINS_ARCH.x * TILE, RUINS_ARCH.y * TILE) });
  drawables.push({ y: PLAZA_CAMPFIRE.y, draw: () => drawUpright('decor_campfire' as SpriteName, PLAZA_CAMPFIRE.x * TILE, PLAZA_CAMPFIRE.y * TILE) });

  // プレイヤー: 立ち絵は向きごとに 1 枚。歩行は「はずみ＋ゆれ」で表す（止まっているときはゆっくり呼吸）。
  const moving = state.moving;
  drawables.push({
    y: save.player.y,
    draw: () => {
      const spr = getSprite(`player_${save.player.dir}0` as SpriteName);
      const p = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
      const w = spr.w * p.k;
      const h = spr.h * p.k;
      const phase = now / 95;
      const bob = moving ? Math.abs(Math.sin(phase)) * 2.6 * p.k : Math.sin(now / 520) * 0.5 * p.k;
      const tilt = moving ? Math.sin(phase) * 0.07 : 0;
      const squash = moving ? 1 - Math.abs(Math.cos(phase)) * 0.03 : 1;
      drawShadow(p.x, p.y - h * 0.02, w * (moving ? 1.05 - bob / (p.k * 40) : 1.05));
      ctx.save();
      ctx.translate(p.x, p.y - bob);
      ctx.rotate(tilt);
      ctx.scale(1 / squash, squash);
      ctx.drawImage(spr.canvas, -w / 2, -h, w, h);
      ctx.restore();
    },
  });

  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) {
    try {
      d.draw();
    } catch (e) {
      // 1 個の描画の失敗で、残りの物が全部消えないようにする（初回だけ知らせる）
      if (!drawErrorLogged) {
        drawErrorLogged = true;
        // eslint-disable-next-line no-console
        console.error('[render] drawable failed', e);
      }
    }
  }

  // --- ハイライト（通常モードのみ） ---
  if (!state.decorate && state.target) {
    const t = state.target;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    ctx.save();
    ctx.strokeStyle = t.blocked ? `rgba(220,90,90,${0.65 + 0.3 * pulse})` : `rgba(255,250,230,${0.7 + 0.3 * pulse})`;
    ctx.lineWidth = 2.5;
    polygonPath(ctx, tileQuad(t.x, t.y, 1, 1, camera, viewport), 0.08);
    ctx.stroke();
    ctx.restore();

    const s = worldToScreen((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, camera, viewport);
    const topY = s.y - 0.55 * TILE * s.k - 1.1 * TILE * s.k * 0.35;
    const bounce = Math.sin(now / 140) * 3;
    const ay = topY - 10 - bounce;
    ctx.fillStyle = t.blocked ? '#d65a5a' : '#fffbe6';
    ctx.beginPath();
    ctx.moveTo(s.x, ay + 7);
    ctx.lineTo(s.x - 6, ay - 2);
    ctx.lineTo(s.x + 6, ay - 2);
    ctx.closePath();
    ctx.fill();

    const label = targetLabel(t);
    if (label) {
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, s.x, ay - 10);
      ctx.fillStyle = '#fffbe6';
      ctx.fillText(label, s.x, ay - 10);
    }
  }

  // --- パーティクル（木くず・土ぼこり） ---
  for (const p of effects.particles) {
    const t = (now - p.startedAt) / p.lifeMs;
    if (t > 1) continue;
    const px = p.x + (p.vx * (t * p.lifeMs)) / 1000;
    const py = p.y + (p.vy * (t * p.lifeMs)) / 1000 + 60 * t * t;
    const s = worldToScreen(px, py, camera, viewport);
    const spr = getSprite(p.sprite);
    const shrink = 1 - t * 0.4;
    const w = Math.max(1, spr.w * s.k * 0.6 * shrink);
    const h = Math.max(1, spr.h * s.k * 0.6 * shrink);
    ctx.globalAlpha = 1 - t;
    ctx.drawImage(spr.canvas, s.x - w / 2, s.y - h / 2, w, h);
    ctx.globalAlpha = 1;
  }

  // --- トースト ---
  for (const toast of effects.toasts) {
    const t = (now - toast.startedAt) / TOAST_LIFE_MS;
    if (t > 1) continue;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    let sx: number;
    let sy: number;
    if (toast.x < 0) {
      sx = W / 2;
      sy = H * 0.3;
      ctx.font = 'bold 22px sans-serif';
    } else {
      const s = worldToScreen(toast.x, toast.y, camera, viewport);
      sx = s.x;
      sy = s.y - 24 * t - 0.8 * TILE * s.k;
      ctx.font = '15px sans-serif';
    }
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(toast.text, sx, sy);
    ctx.fillStyle = '#fff';
    ctx.fillText(toast.text, sx, sy);
    ctx.globalAlpha = 1;
  }

  // --- ジョイスティック ---
  if (state.stick) {
    const { anchor, finger } = state.stick;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(finger.x, finger.y, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  void inView;
  ctx.restore();
  currentCtx = null;
}

/** 水面のきらめき（やわらかい楕円）。可視範囲の水タイルだけを軽く処理する。 */
function drawWaterSparkles(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: CameraState,
  viewport: Viewport,
  now: number,
  minTx: number,
  minTy: number,
  maxTx: number,
  maxTy: number,
): void {
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (world.ground[ty * world.width + tx] !== 'water') continue;
      const seed = hash2(tx, ty);
      if (seed > 0.45) continue;
      const t1 = (now / 2600 + seed * 3) % 1;
      const glow = Math.max(0, Math.sin(t1 * Math.PI * 2));
      if (glow < 0.08) continue;
      const s = worldToScreen((tx + 0.2 + 0.6 * ((seed * 7) % 1)) * TILE, (ty + 0.2 + 0.6 * ((seed * 13) % 1)) * TILE, camera, viewport);
      ctx.fillStyle = `rgba(255,255,255,${(glow * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, TILE * s.k * 0.2 * (0.6 + glow * 0.4), TILE * s.k * 0.2 * TILT_COS * 0.3 * (0.6 + glow * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** ハイライト中の相手が何をする場所かを一言で示す。木・岩・畑は見れば分かるので出さない。 */
function targetLabel(t: Target): string | null {
  if (t.kind === 'station') return STATIONS[t.station.kind].name;
  if (t.kind === 'sign') return '看板';
  if (t.kind === 'chest') return '宝箱';
  return null;
}

/** 遺跡の紋様をゆっくり明滅させる。 */
function drawRuinsGlow(tx: number, ty: number, now: number, camera: CameraState, viewport: Viewport): void {
  const ctx = currentCtx;
  if (!ctx) return;
  const s = worldToScreen((tx + 0.5) * TILE, (ty + 0.5) * TILE, camera, viewport);
  const pulse = 0.5 + 0.5 * Math.sin(now / 500);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * pulse;
  ctx.fillStyle = '#5fe3c9';
  ctx.beginPath();
  ctx.arc(s.x, s.y - 0.5 * TILE * s.k, (4 + 2 * pulse) * s.k * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

let drawErrorLogged = false;

const SWING_MS = 220;

/** 見た目の選び分け：砂浜の木はヤシ、森の木は 2 種を場所でばらす。 */
function spriteForNode(node: MapNode, world: World): SpriteName {
  if (node.kind === 'tree') {
    const g = world.ground[node.y * world.width + node.x];
    if (g === 'sand') return 'palm' as SpriteName;
  }
  if (node.kind === 'forestTree') return (hash2(node.x, node.y) < 0.32 ? 'wallPine' : 'wallOak') as SpriteName;
  return node.kind as SpriteName;
}

type OccludableDraw = (key: string, name: SpriteName, wx: number, wy: number, shadow?: boolean) => void;
type TileDraw = (name: SpriteName, tx: number, ty: number, shadow?: boolean, alpha?: number) => void;

function drawNode(node: MapNode, now: number, state: RenderState, drawOccludable: OccludableDraw, drawAtTile: TileDraw): void {
  const last = store.lastAction();
  const isTarget = last !== null && last.x === node.x && last.y === node.y && now - last.at < SWING_MS && last.kind === 'hit';
  const shakeT = isTarget ? 1 - (now - last!.at) / SWING_MS : 0;
  const shakeX = isTarget ? Math.sin(shakeT * Math.PI * 6) * 2 : 0;
  const spriteName = spriteForNode(node, state.world);

  const ctx = currentCtx;
  const draw = () => {
    if (TALL_NODES.has(node.kind)) drawOccludable(`node:${node.id}`, spriteName, (node.x + 0.5) * TILE, (node.y + 1) * TILE);
    else drawAtTile(spriteName, node.x, node.y);
  };
  if (ctx && shakeX !== 0) {
    ctx.save();
    ctx.translate(shakeX, 0);
    draw();
    ctx.restore();
  } else {
    draw();
  }

  if (isTarget && ctx) {
    const tool = NODE_TOOL[node.kind];
    const toolSprite = getSprite((tool === 'axe' ? 'tool_axe' : 'tool_pick') as SpriteName);
    const angle = (-Math.PI / 3) * (1 - shakeT);
    const s = worldToScreen((node.x + 0.85) * TILE, (node.y + 0.7) * TILE, state.camera, state.viewport);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    const w = toolSprite.w * s.k;
    const h = toolSprite.h * s.k;
    ctx.drawImage(toolSprite.canvas, -w / 2, -h, w, h);
    ctx.restore();
  }
}

// draw() 実行中だけ保持する現在の ctx（drawNode などへ引き回さないため）。
let currentCtx: CanvasRenderingContext2D | null = null;
