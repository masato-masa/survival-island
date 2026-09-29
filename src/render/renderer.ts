// Canvas 描画。draw(ctx, state) を毎フレーム呼ぶだけで盤面全体を描く。
// トースト・パーティクルは時間で消えるアニメーションなので、モジュール内の
// effects オブジェクトが state を持つ（store.onEvents から push してもらう）。

import type {
  DecorKind,
  Fail,
  GameEvent,
  ItemId,
  MapNode,
  NodeKind,
  SaveState,
  SlotAttr,
  StationKind,
  Target,
  World,
} from '@/game/types';
import { CROPS, FURNITURE_BY_ID, FURNITURE_DISPLAY_SIZE, ITEMS, NODES, STATIONS } from '@/game/data';
import { cropProgress } from '@/game/time';
import { nodeAlive } from '@/game/rules';
import { store } from '@/game/store';

import { followFactor, TILE, type CameraState, type Viewport, worldToScreen } from './camera';
import { getGroundFurnitureSprite, getSprite, type SpriteName } from './sprites';
import type { PaintedTerrain } from './terrain';
import { TERRAIN_PX } from './terrainCore';
import type { TreeInstance } from './forestTrees';

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
  /** 森タイルに撒いた木のインスタンス（WorldView が一度だけ生成して渡す）。 */
  forestTrees: TreeInstance[];
  /** 草地に散らした花・草・小石（見た目だけ。WorldView が一度だけ生成して渡す）。 */
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
          const isStone = ev.kind === 'rock' || ev.kind === 'hardRock' || ev.kind === 'borderRock';
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.5) * TILE, (isStone ? 'fx_dust' : 'fx_leaf') as SpriteName, now, 4);
          break;
        }
        case 'broke': {
          const isStone = ev.kind === 'rock' || ev.kind === 'hardRock' || ev.kind === 'borderRock';
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.5) * TILE, (isStone ? 'fx_dust' : 'fx_leaf') as SpriteName, now, 6);
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
          this.pushToast(`+${ev.amount} EXP`, store.world.start.x * TILE, store.world.start.y * TILE, now);
          break;
        }
        case 'areaOpened': {
          const areaName = ev.area;
          this.pushToast(`${areaName} がひらけた！`, -1, -1, now, true);
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
// Stardew 風の「見え隠れ」：プレイヤーが木の梢の後ろ（北側）に重なったら半透明にする。
// 木・柱・モノリスのような背の高いオブジェクトは、プレイヤーが幹より奥（北）にいて
// かつスプライト同士の矩形が重なるときだけ対象。個体ごとに現在の透明度を持ち、
// 目標値へ 150ms のイージングで近づける（対象を跨いでも key で状態を引き継ぐ）。

const OCCLUSION_ALPHA = 0.45;
const OCCLUSION_HALF_LIFE_SEC = 0.15;
const occlusionAlpha = new Map<string, number>();
let lastFrameNow: number | null = null;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** key ごとの現在の透明度を更新して返す。anchorX/anchorY はスプライトの下辺中央（ワールド px）。 */
function updateOcclusionAlpha(
  key: string,
  sprite: SpriteName,
  anchorX: number,
  anchorY: number,
  playerRect: Rect,
  playerBaseY: number,
  easeFactor: number,
): number {
  const spr = getSprite(sprite);
  const rect: Rect = { left: anchorX - spr.w / 2, right: anchorX + spr.w / 2, top: anchorY - spr.h, bottom: anchorY };
  const behind = playerBaseY < anchorY; // プレイヤーの足元が対象の根元より奥（北）
  const target = behind && rectsOverlap(playerRect, rect) ? OCCLUSION_ALPHA : 1;
  const prev = occlusionAlpha.get(key) ?? 1;
  const next = prev + (target - prev) * easeFactor;
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

function round(n: number): number {
  return Math.round(n);
}

const FALLBACK_COLOR: Record<string, string> = {
  water: '#6cc3dc',
  grass: '#93cc6f',
  sand: '#f0e0ac',
  soil: '#7a5036',
  dirt: '#e4c18e',
  paving: '#d6d2c8',
  forest: '#74b454',
  dock: '#d6ac74',
  foundation: '#e4c18e',
};

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

// ---------------------------------------------------------------------------
// 模様替え（配置）モードの床：参考画像（pigg 風の家の庭）を実測したダイヤ格子。
// 「もようがえ」中だけ、地面の代わりにこの格子を敷く（このゲームは斜めではなく縦横なので、格子も正方形）（水面は敷かず、下の地面テクスチャを
// そのまま見せる＝池には置けないのが一目で分かる）。マス目 1 つ＝タイル 1 個に対応させ、
// 4 辺の中点を結んだ菱形を並べるので、隣同士は角で接し継ぎ目のない格子になる。

const DIAMOND_LIGHT: readonly [number, number, number] = [147, 204, 111];
const DIAMOND_DARK: readonly [number, number, number] = [119, 184, 81];
const DIAMOND_LINE = 'rgba(221, 237, 201, 0.85)';

function drawDecorateFloorGrid(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: CameraState,
  viewport: Viewport,
  scale: number,
  minTx: number,
  minTy: number,
  maxTx: number,
  maxTy: number
): void {
  ctx.save();
  ctx.lineWidth = Math.max(1, scale * 0.9);
  ctx.strokeStyle = DIAMOND_LINE;
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const g = world.ground[ty * world.width + tx];
      if (g === undefined || g === 'water') continue;
      const tl = worldToScreen(tx * TILE, ty * TILE, camera, viewport);
      const size = TILE * scale;
      const light = (tx + ty) % 2 === 0;
      const rgb = light ? DIAMOND_LIGHT : DIAMOND_DARK;
      ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.fillRect(tl.x, tl.y, size, size);
      ctx.strokeRect(tl.x, tl.y, size, size);
    }
  }
  ctx.restore();
}

/** 水面の動く演出（やわらかいきらめき）。可視範囲の水タイルだけを軽く処理する。渚の泡は地面レイヤーに焼いてある。 */
function drawWaterAnimated(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: CameraState,
  viewport: Viewport,
  scale: number,
  now: number,
  minTx: number,
  minTy: number,
  maxTx: number,
  maxTy: number,
  _isLand: (x: number, y: number) => boolean
): void {
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (world.ground[ty * world.width + tx] !== 'water') continue;
      const seed = hash2(tx, ty);
      if (seed > 0.45) continue; // 水面の半分弱のタイルにだけ
      const s = worldToScreen(tx * TILE, ty * TILE, camera, viewport);
      const size = TILE * scale;
      const t1 = (now / 2600 + seed * 3) % 1;
      const glow = Math.max(0, Math.sin(t1 * Math.PI * 2));
      if (glow < 0.08) continue;
      const gx = s.x + (0.2 + 0.6 * ((seed * 7) % 1)) * size;
      const gy = s.y + (0.2 + 0.6 * ((seed * 13) % 1)) * size;
      ctx.fillStyle = `rgba(255,255,255,${(glow * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, size * 0.16 * (0.6 + glow * 0.4), size * 0.045 * (0.6 + glow * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 見た目だけの置物（ゲームロジック上は存在しない）。座標はタイル単位、スプライトの
// 下辺中央がここに来る。遺跡入口のアーチは西の通路をまたぐ位置、かがり火は広場の
// 作業台のそばに置く。
const RUINS_ARCH = { x: 7.5, y: 15 };
const PLAZA_CAMPFIRE = { x: 15.5, y: 18 };

const SLOT_COLORS: Record<SlotAttr, string> = {
  bench: '#c97b4a',
  landmark: '#d64550',
  path: '#b8a06a',
  workbench: '#5d8fc9',
  kitchen: '#e0a72e',
  desk: '#7a5ac9',
  decor: '#3fae7a',
  fence: '#7a8a3f',
};

const NODE_TO_STUMP: Partial<Record<NodeKind, SpriteName>> = {
  tree: 'stump' as SpriteName,
  bigTree: 'stump' as SpriteName,
  rock: 'rubble' as SpriteName,
  hardRock: 'rubble' as SpriteName,
};

const NODE_TOOL: Record<NodeKind, 'axe' | 'pick'> = {
  tree: 'axe',
  bigTree: 'axe',
  borderTree: 'axe',
  rock: 'pick',
  hardRock: 'pick',
  borderRock: 'pick',
};

// ---------------------------------------------------------------------------
// メイン描画

export function draw(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { world, save, now, camera, viewport, dpr } = state;
  currentCtx = ctx;

  // 見え隠れイージング用の dt（フレーム間の壁時計時間）。
  const occlusionDtSec = lastFrameNow == null ? 0 : Math.max(0, Math.min(0.2, (now - lastFrameNow) / 1000));
  lastFrameNow = now;
  const occlusionEase = followFactor(occlusionDtSec, OCCLUSION_HALF_LIFE_SEC);

  // プレイヤーのスプライト矩形（見え隠れ判定用）。歩行フレームで縦横は大きく変わらないので
  // frame=0 の絵で近似してよい。
  const playerSpr0 = getSprite(`player_${save.player.dir}0` as SpriteName);
  const playerRect: Rect = {
    left: save.player.x * TILE - playerSpr0.w / 2,
    right: save.player.x * TILE + playerSpr0.w / 2,
    top: save.player.y * TILE - playerSpr0.h,
    bottom: save.player.y * TILE,
  };

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, viewport.widthCssPx, viewport.heightCssPx);

  const scale = camera.zoom * viewport.baseScale;

  // 見えるマスの範囲だけ計算する。anchorX/anchorY（既定 0.5）でカメラ中心が画面の
  // どこに固定されているかが変わるので、左右・上下で画面端までの距離が非対称になりうる
  // （pigg 風の低いカメラは anchorY > 0.5 でキャラを画面下寄りに置く）。中央対称決め打ちだと
  // 実際に見えている側の端の物体が描画対象から漏れる（ちらつき・消失）ので、worldToScreen と
  // 同じ anchor を使って計算する。
  const anchorX = viewport.anchorX ?? 0.5;
  const anchorY = viewport.anchorY ?? 0.5;
  const topLeft = {
    x: camera.x - (viewport.widthCssPx * anchorX) / scale,
    y: camera.y - (viewport.heightCssPx * anchorY) / scale,
  };
  const bottomRight = {
    x: camera.x + (viewport.widthCssPx * (1 - anchorX)) / scale,
    y: camera.y + (viewport.heightCssPx * (1 - anchorY)) / scale,
  };
  const minTx = Math.max(0, Math.floor(topLeft.x / TILE) - 1);
  const minTy = Math.max(0, Math.floor(topLeft.y / TILE) - 1);
  const maxTx = Math.min(world.width - 1, Math.ceil(bottomRight.x / TILE) + 1);
  const maxTy = Math.min(world.height - 1, Math.ceil(bottomRight.y / TILE) + 1);

  // 足元のやわらかい影（pigg 風の「地面に立っている」感じ）。sx,sy は足元の画面座標、w は絵の幅（画面 px）。
  const drawShadow = (sx: number, sy: number, w: number, strength = 1) => {
    const rx = w * 0.42;
    const ry = rx * 0.3;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    g.addColorStop(0, `rgba(40,70,35,${(0.26 * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(40,70,35,0)');
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

  const drawSpriteAtTile = (name: SpriteName, tx: number, ty: number, anchorBottom = true, shadow = true) => {
    const spr = getSprite(name);
    const feetX = (tx + 0.5) * TILE;
    const feetY = anchorBottom ? (ty + 1) * TILE : (ty + 0.5) * TILE;
    const s = worldToScreen(feetX, feetY, camera, viewport);
    const w = spr.w * scale;
    const h = spr.h * scale;
    if (shadow) drawShadow(s.x, s.y - h * 0.03, w * 0.9);
    ctx.drawImage(spr.canvas, s.x - w / 2, s.y - h, w, h);
  };

  const drawSpriteAtWorld = (name: SpriteName, worldX: number, worldY: number, anchorBottom = true, shadow = true) => {
    const spr = getSprite(name);
    const s = worldToScreen(worldX, worldY, camera, viewport);
    const w = spr.w * scale;
    const h = spr.h * scale;
    const top = anchorBottom ? s.y - h : s.y - h / 2;
    if (shadow && anchorBottom) drawShadow(s.x, s.y - h * 0.03, w * 0.9);
    ctx.drawImage(spr.canvas, s.x - w / 2, top, w, h);
  };

  // 家具を「デザインで決めた表示サイズ」に contain-fit（アスペクト比を保って矩形へ収める）
  // して描く。ChatGPT 生成素材は品目ごとにドット密度がバラバラで、素の art px のまま
  // 貼ると柵・見張り台・像が無関係な大きさになってしまうため（CLAUDE.md 参照の必要なし、
  // FURNITURE_DISPLAY_SIZE がそのままデザイン値）。footprint の下辺中央を worldX,worldY に
  // 合わせる（drawSpriteAtWorld の anchorBottom と同じ流儀）。
  const drawFurnitureAtWorld = (furnitureId: string, worldX: number, worldY: number) => {
    const spr = getSprite(`f_${furnitureId}` as SpriteName);
    const size = FURNITURE_DISPLAY_SIZE[furnitureId] ?? { w: 1, h: 1 };
    const boxW = size.w * TILE * scale;
    const boxH = size.h * TILE * scale;
    const artAspect = spr.w / spr.h || 1;
    const boxAspect = boxW / boxH;
    let drawW: number;
    let drawH: number;
    if (artAspect > boxAspect) {
      drawW = boxW;
      drawH = boxW / artAspect;
    } else {
      drawH = boxH;
      drawW = boxH * artAspect;
    }
    const s = worldToScreen(worldX, worldY, camera, viewport);
    drawShadow(s.x, s.y - drawH * 0.03, drawW * 0.85);
    ctx.drawImage(spr.canvas, s.x - drawW / 2, s.y - drawH, drawW, drawH);
  };

  // --- 地面（事前描画したレイヤーを可視範囲だけ貼る。無ければ焼き上がるまで簡易フォールバック） ---
  const isLand = (x: number, y: number) => {
    const g = world.ground[y * world.width + x];
    return g !== undefined && g !== 'water';
  };

  if (state.terrain) {
    const srcX = minTx * TERRAIN_PX;
    const srcY = minTy * TERRAIN_PX;
    const srcW = (maxTx - minTx + 1) * TERRAIN_PX;
    const srcH = (maxTy - minTy + 1) * TERRAIN_PX;
    const dst = worldToScreen(minTx * TILE, minTy * TILE, camera, viewport);
    const destW = (maxTx - minTx + 1) * TILE * scale;
    const destH = (maxTy - minTy + 1) * TILE * scale;
    ctx.drawImage(state.terrain.canvas, srcX, srcY, srcW, srcH, dst.x, dst.y, destW, destH);
    drawWaterAnimated(ctx, world, camera, viewport, scale, now, minTx, minTy, maxTx, maxTy, isLand);
    if (state.decorate) drawDecorateFloorGrid(ctx, world, camera, viewport, scale, minTx, minTy, maxTx, maxTy);
  } else {
    // フォールバック（焼いている最中）：ベタ塗りだけで地面種別が分かるようにする
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const g = world.ground[ty * world.width + tx];
        if (g === undefined) continue;
        const s = worldToScreen(tx * TILE, ty * TILE, camera, viewport);
        ctx.fillStyle = FALLBACK_COLOR[g] ?? '#8bc36a';
        ctx.fillRect(round(s.x), round(s.y), round(TILE * scale) + 1, round(TILE * scale) + 1);
      }
    }
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
      const name = `${tile.crop}${stage}` as SpriteName;
      drawSpriteAtTile(name, t.x, t.y, true, false);
      if (stage === 2) {
        // 収穫可能：控えめなスパークル（gen_fx_sparkle。無ければコード版の星形にフォールバック）
        const s = worldToScreen((t.x + 0.5) * TILE, t.y * TILE, camera, viewport);
        const twinkle = 0.4 + 0.4 * Math.sin(now / 180 + hash2(t.x, t.y) * 10);
        const spr = getSprite('fx_sparkle' as SpriteName);
        const w = spr.w * scale * 0.6;
        const h = spr.h * scale * 0.6;
        ctx.globalAlpha = twinkle;
        ctx.drawImage(spr.canvas, round(s.x - w / 2), round(s.y - h / 2), round(w), round(h));
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- 看板（選んでいる作物のアイコンを小さく載せる） ---
  for (const plot of world.plots) {
    drawSpriteAtTile('sign' as SpriteName, plot.sign.x, plot.sign.y, true, true);
    const ps = save.plots[plot.id];
    if (ps?.selected) {
      const s = worldToScreen((plot.sign.x + 0.5) * TILE, plot.sign.y * TILE + TILE * 0.35, camera, viewport);
      const spr = getSprite(`item_${ps.selected}` as SpriteName);
      const w = spr.w * scale * 0.5;
      const h = spr.h * scale * 0.5;
      ctx.drawImage(spr.canvas, round(s.x - w / 2), round(s.y - h / 2), round(w), round(h));
    }
  }

  // --- decorate: スロット枠（w×h に対応。ランドマークの 4×4 は 1 枚の大きな枠になる） ---
  if (state.decorate) {
    for (const slot of world.slots) {
      const sw = slot.w ?? 1;
      const sh = slot.h ?? 1;
      const placed = save.placements[slot.id];
      if (placed) {
        drawFurnitureAtWorld(placed, (slot.x + sw / 2) * TILE, (slot.y + sh) * TILE);
      }
      const s = worldToScreen(slot.x * TILE, slot.y * TILE, camera, viewport);
      const boxW = TILE * scale * sw;
      const boxH = TILE * scale * sh;
      ctx.strokeStyle = SLOT_COLORS[slot.attr];
      ctx.lineWidth = Math.max(1, 2 * scale * 0.5);
      roundRect(ctx, s.x + 2, s.y + 2, boxW - 4, boxH - 4, 4 * scale);
      ctx.stroke();
      if (!placed) {
        const spr = getSprite(`slot_${slot.attr}` as SpriteName);
        const w = spr.w * scale * (sw > 1 ? 0.9 : 0.5);
        const h = spr.h * scale * (sh > 1 ? 0.9 : 0.5);
        ctx.drawImage(spr.canvas, round(s.x + boxW / 2 - w / 2), round(s.y + boxH / 2 - h / 2), round(w), round(h));
      }
    }
  }

  // --- y ソート対象（資源・宝箱・置いた家具・プレイヤー） ---
  type Drawable = { y: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (const node of world.nodes) {
    const alive = nodeAlive(save, node, now);
    if (alive) {
      drawables.push({
        y: node.y,
        draw: () => drawNodeWithSwing(node, now, state, drawSpriteAtTile),
      });
    } else if (NODES[node.kind].respawnMs !== null) {
      const stump = NODE_TO_STUMP[node.kind];
      if (stump) drawables.push({ y: node.y, draw: () => drawSpriteAtTile(stump, node.x, node.y) });
    }
  }

  for (const chest of world.chests) {
    const opened = save.chestsOpened.includes(chest.id);
    drawables.push({
      y: chest.y,
      draw: () => drawSpriteAtTile((opened ? 'chestOpen' : 'chest') as SpriteName, chest.x, chest.y),
    });
  }

  // --- 昔の暮らしの名残（瓦礫・崩れた石・柱・商船）。ship のような大物は w×h の矩形の
  //     下辺中央に据える。 ---
  for (const d of world.decor ?? []) {
    const name = DECOR_SPRITE[d.kind];
    const anchorX = (d.x + d.w / 2) * TILE;
    const anchorY = (d.y + d.h) * TILE;
    if (d.kind === 'pillar') {
      // 柱は背が高いので木と同じく見え隠れの対象にする。
      const key = `decor:${d.x},${d.y}`;
      drawables.push({
        y: d.y + d.h - 1,
        draw: () => {
          const alpha = updateOcclusionAlpha(key, name, anchorX, anchorY, playerRect, save.player.y * TILE, occlusionEase);
          if (alpha < 0.999) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawSpriteAtWorld(name, anchorX, anchorY);
            ctx.restore();
          } else {
            drawSpriteAtWorld(name, anchorX, anchorY);
          }
        },
      });
      continue;
    }
    drawables.push({
      y: d.y + d.h - 1,
      draw: () => drawSpriteAtWorld(name, anchorX, anchorY),
    });
  }

  // --- 設備（遺跡・作業台・船着き場・家の跡地）。遺跡は紋様が常にゆっくり明滅する（発見しやすさのため）。 ---
  for (const station of world.stations) {
    const spriteName = STATION_SPRITE[station.kind];
    const anchorX = (station.x + 0.5) * TILE;
    const anchorY = (station.y + 1) * TILE;
    const isTall = station.kind === 'ruins'; // モノリスは背が高いので見え隠れの対象にする
    const key = `station:${station.x},${station.y}`;
    drawables.push({
      y: station.y,
      draw: () => {
        const alpha =
          isTall && spriteName
            ? updateOcclusionAlpha(key, spriteName, anchorX, anchorY, playerRect, save.player.y * TILE, occlusionEase)
            : 1;
        if (spriteName) {
          if (alpha < 0.999) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawSpriteAtTile(spriteName, station.x, station.y);
            ctx.restore();
          } else {
            drawSpriteAtTile(spriteName, station.x, station.y);
          }
        }
        if (station.kind === 'ruins') drawRuinsGlow(station.x, station.y, now, camera, viewport, scale);
      },
    });
  }

  if (!state.decorate) {
    for (const [slotId, furnitureId] of Object.entries(save.placements)) {
      const slot = world.slots.find((s) => s.id === slotId);
      if (!slot) continue;
      const sw = slot.w ?? 1;
      const sh = slot.h ?? 1;
      if (furnitureId === 'woodPath' || furnitureId === 'stonePath') {
        // 道系の家具だけは地面にぴったり敷く 1 マスのテクスチャ（隣の道・石畳とつながって
        // 見えるよう、ワールド座標に応じてテクスチャの切り出し位置をずらす）。
        drawables.push({
          y: slot.y - 0.5, // 地面とほぼ同じ高さ。他の資源・プレイヤーの下に来てよい
          draw: () => {
            const spr = getGroundFurnitureSprite(furnitureId, slot.x, slot.y);
            const topLeft = worldToScreen(slot.x * TILE, slot.y * TILE, camera, viewport);
            const w = TILE * scale;
            const h = TILE * scale;
            const x0 = Math.floor(topLeft.x);
            const y0 = Math.floor(topLeft.y);
            ctx.drawImage(spr.canvas, x0, y0, Math.ceil(topLeft.x + w) - x0, Math.ceil(topLeft.y + h) - y0);
          },
        });
        continue;
      }
      drawables.push({
        y: slot.y + sh - 1,
        draw: () => drawFurnitureAtWorld(furnitureId, (slot.x + sw / 2) * TILE, (slot.y + sh) * TILE),
      });
    }
  }

  // --- 森の木（本物のスプライト。地面レイヤーには焼かず、プレイヤーと同じ y ソートに乗せる
  //     ことで「北側を歩くと梢に隠れ、南側を歩くと手前に出る」を成立させる）。
  //     可視範囲 ±2 マスの余裕を持たせて、画面端で木が急に消えないようにする。 ---
  {
    const treeMinX = minTx - 2;
    const treeMaxX = maxTx + 2;
    const treeMinY = minTy - 3;
    const treeMaxY = maxTy + 1;
    let treeIdx = 0;
    for (const t of state.forestTrees) {
      const idx = treeIdx++;
      if (t.x < treeMinX || t.x > treeMaxX || t.y < treeMinY || t.y > treeMaxY) continue;
      const anchorX = t.x * TILE;
      const anchorY = t.y * TILE;
      const key = `tree:${idx}`;
      drawables.push({
        y: t.y,
        draw: () => {
          const alpha = updateOcclusionAlpha(key, t.sprite, anchorX, anchorY, playerRect, save.player.y * TILE, occlusionEase);
          if (alpha < 0.999) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawSpriteAtWorld(t.sprite, anchorX, anchorY, true, false);
            ctx.restore();
          } else {
            drawSpriteAtWorld(t.sprite, anchorX, anchorY, true, false);
          }
        },
      });
    }
  }

  // --- 地面の飾り（花・草・小石。影なし・見え隠れなし。可視範囲だけ描く） ---
  for (const d of state.groundDecor) {
    if (d.x < minTx - 1 || d.x > maxTx + 2 || d.y < minTy - 1 || d.y > maxTy + 2) continue;
    drawables.push({ y: d.flat ? -1000 : d.y - 0.6, draw: () => drawSpriteAtWorld(d.sprite, d.x * TILE, d.y * TILE, true, false) });
  }

  // --- 遺跡入口のアーチ・広場のかがり火（見た目だけの置物。ゲームロジックには存在しない）。 ---
  drawables.push({
    y: RUINS_ARCH.y,
    draw: () => drawSpriteAtWorld('decor_arch' as SpriteName, RUINS_ARCH.x * TILE, RUINS_ARCH.y * TILE),
  });
  drawables.push({
    y: PLAZA_CAMPFIRE.y,
    draw: () => drawSpriteAtWorld('decor_campfire' as SpriteName, PLAZA_CAMPFIRE.x * TILE, PLAZA_CAMPFIRE.y * TILE),
  });

  // プレイヤー: 立ち絵は正面 1 枚だけなので、歩行は「はずみ＋ゆれ」で表す（止まっているときはゆっくり呼吸）。
  const moving = state.moving;
  const playerSprite = `player_${save.player.dir}0` as SpriteName;
  drawables.push({
    y: save.player.y,
    draw: () => {
      const spr = getSprite(playerSprite);
      const s0 = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
      const w = spr.w * scale;
      const h = spr.h * scale;
      const phase = now / 95;
      const bob = moving ? Math.abs(Math.sin(phase)) * 2.6 * scale : Math.sin(now / 520) * 0.5 * scale;
      const tilt = moving ? Math.sin(phase) * 0.07 : 0;
      const squash = moving ? 1 - Math.abs(Math.cos(phase)) * 0.03 : 1;
      drawShadow(s0.x, s0.y - h * 0.02, w * (moving ? 1.05 - bob / (scale * 40) : 1.05));
      ctx.save();
      ctx.translate(s0.x, s0.y - bob);
      ctx.rotate(tilt);
      ctx.scale(1 / squash, squash);
      ctx.drawImage(spr.canvas, -w / 2, -h, w, h);
      ctx.restore();
    },
  });

  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  // --- ハイライト（通常モードのみ） ---
  if (!state.decorate && state.target) {
    const t = state.target;
    const s = worldToScreen((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, camera, viewport);
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    ctx.strokeStyle = t.blocked ? `rgba(220,90,90,${0.6 + 0.3 * pulse})` : `rgba(255,250,230,${0.6 + 0.3 * pulse})`;
    ctx.lineWidth = 2;
    const size = TILE * scale * 0.9;
    roundRect(ctx, s.x - size / 2, s.y - size / 2, size, size, 6 * scale);
    ctx.stroke();

    const bounce = Math.sin(now / 140) * 3;
    const ay = s.y - size / 2 - 10 * scale - bounce;
    ctx.fillStyle = t.blocked ? '#d65a5a' : '#fffbe6';
    ctx.beginPath();
    ctx.moveTo(s.x, ay + 6);
    ctx.lineTo(s.x - 5, ay - 2);
    ctx.lineTo(s.x + 5, ay - 2);
    ctx.closePath();
    ctx.fill();

    // --- 発見してほしい相手には、何をする場所かを名前で示す（遺跡・作業台・看板・宝箱）。 ---
    const label = targetLabel(t);
    if (label) {
      ctx.font = `bold ${Math.round(13 * Math.max(1, scale))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, s.x, ay - 12 * scale);
      ctx.fillStyle = '#fffbe6';
      ctx.fillText(label, s.x, ay - 12 * scale);
    }
  }

  // --- パーティクル（木くず・土ぼこり。小さく数個、フェードしながら飛ぶ） ---
  for (const p of effects.particles) {
    const t = (now - p.startedAt) / p.lifeMs;
    if (t > 1) continue;
    const px = p.x + p.vx * (t * p.lifeMs) / 1000;
    const py = p.y + p.vy * (t * p.lifeMs) / 1000 + 60 * t * t; // 簡易重力
    const s = worldToScreen(px, py, camera, viewport);
    const spr = getSprite(p.sprite);
    const shrink = 1 - t * 0.4;
    const w = Math.max(1, spr.w * scale * 0.5 * shrink);
    const h = Math.max(1, spr.h * scale * 0.5 * shrink);
    ctx.globalAlpha = 1 - t;
    ctx.drawImage(spr.canvas, round(s.x - w / 2), round(s.y - h / 2), round(w), round(h));
    ctx.globalAlpha = 1;
  }

  // --- トースト ---
  ctx.font = `${Math.round(13 * Math.max(1, scale))}px sans-serif`;
  ctx.textAlign = 'center';
  for (const toast of effects.toasts) {
    const t = (now - toast.startedAt) / TOAST_LIFE_MS;
    if (t > 1) continue;
    const rise = 24 * t;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    let sx: number;
    let sy: number;
    if (toast.x < 0) {
      sx = viewport.widthCssPx / 2;
      sy = viewport.heightCssPx * 0.3;
      ctx.font = `bold ${Math.round(20 * Math.max(1, scale))}px sans-serif`;
    } else {
      const s = worldToScreen(toast.x, toast.y, camera, viewport);
      sx = s.x;
      sy = s.y - rise;
    }
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

  ctx.restore();
  currentCtx = null;
}

/** ハイライト中の相手が何をする場所かを一言で示す。木・岩・畑は見れば分かるので出さない。 */
function targetLabel(t: Target): string | null {
  if (t.kind === 'station') return STATIONS[t.station.kind].name;
  if (t.kind === 'sign') return '看板';
  if (t.kind === 'chest') return '宝箱';
  return null;
}

/** 遺跡の紋様をゆっくり明滅させる（「古代・魔法」を静止画より伝えるための最小限の演出）。 */
function drawRuinsGlow(
  tx: number,
  ty: number,
  now: number,
  camera: CameraState,
  viewport: Viewport,
  scale: number,
): void {
  const ctx = getCurrentCtx();
  if (!ctx) return;
  const s = worldToScreen((tx + 0.5) * TILE, (ty + 0.47) * TILE, camera, viewport);
  const pulse = 0.5 + 0.5 * Math.sin(now / 500);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * pulse;
  ctx.fillStyle = '#5fe3c9';
  ctx.beginPath();
  ctx.arc(s.x, s.y, (4 + 2 * pulse) * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const SWING_MS = 220;

/** 砂浜の木はヤシとして描く（見た目だけの差し替え。ゲームロジックは変わらない）。 */
function spriteForNode(node: MapNode, world: World): SpriteName {
  if (node.kind === 'tree') {
    const g = world.ground[node.y * world.width + node.x];
    if (g === 'sand') return 'palm' as SpriteName;
  }
  return node.kind as SpriteName;
}

function drawNodeWithSwing(
  node: MapNode,
  now: number,
  state: RenderState,
  drawSpriteAtTile: (name: SpriteName, tx: number, ty: number) => void,
): void {
  const last = store.lastAction();
  const isTarget =
    last !== null && last.x === node.x && last.y === node.y && now - last.at < SWING_MS && last.kind === 'hit';

  const shakeT = isTarget ? 1 - (now - last!.at) / SWING_MS : 0;
  const shakeX = isTarget ? Math.sin(shakeT * Math.PI * 6) * 2 : 0;
  const spriteName = spriteForNode(node, state.world);

  const ctx = getCurrentCtx();
  if (ctx && shakeX !== 0) {
    ctx.save();
    ctx.translate(shakeX, 0);
    drawSpriteAtTile(spriteName, node.x, node.y);
    ctx.restore();
  } else {
    drawSpriteAtTile(spriteName, node.x, node.y);
  }

  if (isTarget && ctx) {
    const tool = NODE_TOOL[node.kind];
    const toolSprite = getSprite((tool === 'axe' ? 'tool_axe' : 'tool_pick') as SpriteName);
    const angle = (-Math.PI / 3) * (1 - shakeT);
    const worldX = (node.x + 0.8) * TILE;
    const worldY = (node.y + 0.5) * TILE;
    const s = worldToScreen(worldX, worldY, state.camera, state.viewport);
    const scale = state.camera.zoom * state.viewport.baseScale;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    const w = toolSprite.w * scale;
    const h = toolSprite.h * scale;
    ctx.drawImage(toolSprite.canvas, -w / 2, -h, w, h);
    ctx.restore();
  }
}

// renderer 内で ctx を state 越しに渡すのが面倒なので、draw() 実行中だけ保持する。
let currentCtx: CanvasRenderingContext2D | null = null;
function getCurrentCtx(): CanvasRenderingContext2D | null {
  return currentCtx;
}
