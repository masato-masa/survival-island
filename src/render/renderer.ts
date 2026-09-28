// Canvas 描画。draw(ctx, state) を毎フレーム呼ぶだけで盤面全体を描く。
// トースト・パーティクルは時間で消えるアニメーションなので、モジュール内の
// effects オブジェクトが state を持つ（store.onEvents から push してもらう）。

import type {
  Fail,
  GameEvent,
  ItemId,
  MapNode,
  NodeKind,
  SaveState,
  SlotAttr,
  Target,
  World,
} from '@/game/types';
import { CROPS, FURNITURE_BY_ID, ITEMS, NODES, STATIONS } from '@/game/data';
import { cropProgress } from '@/game/time';
import { nodeAlive } from '@/game/rules';
import { store } from '@/game/store';

import { TILE, type CameraState, type Viewport, worldToScreen } from './camera';
import { getSprite, type SpriteName } from './sprites';

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
}

// ---------------------------------------------------------------------------
// パーティクル・トースト（時間経過で消える）

interface Particle {
  x: number; // ワールド px
  y: number;
  vx: number;
  vy: number;
  color: string;
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

const WOOD_BROWN = '#8a5a34';
const STONE_GREY = '#8b8b8f';
const LEAF_GREEN = '#5a9a4a';

class Effects {
  particles: Particle[] = [];
  toasts: Toast[] = [];

  private spawnParticles(x: number, y: number, color: string, now: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 40;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        color,
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
          const color = ev.kind === 'rock' || ev.kind === 'hardRock' || ev.kind === 'borderRock' ? STONE_GREY : LEAF_GREEN;
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.5) * TILE, color, now, 4);
          break;
        }
        case 'broke': {
          const color = ev.kind === 'rock' || ev.kind === 'hardRock' || ev.kind === 'borderRock' ? STONE_GREY : WOOD_BROWN;
          this.spawnParticles((ev.x + 0.5) * TILE, (ev.y + 0.5) * TILE, color, now, 6);
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
// 小さなユーティリティ

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function round(n: number): number {
  return Math.round(n);
}

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

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, viewport.widthCssPx, viewport.heightCssPx);

  const scale = camera.zoom * viewport.baseScale;

  // 見えるマスの範囲だけ計算する
  const topLeft = { x: camera.x - viewport.widthCssPx / 2 / scale, y: camera.y - viewport.heightCssPx / 2 / scale };
  const bottomRight = { x: camera.x + viewport.widthCssPx / 2 / scale, y: camera.y + viewport.heightCssPx / 2 / scale };
  const minTx = Math.max(0, Math.floor(topLeft.x / TILE) - 1);
  const minTy = Math.max(0, Math.floor(topLeft.y / TILE) - 1);
  const maxTx = Math.min(world.width - 1, Math.ceil(bottomRight.x / TILE) + 1);
  const maxTy = Math.min(world.height - 1, Math.ceil(bottomRight.y / TILE) + 1);

  const drawSpriteAtTile = (name: SpriteName, tx: number, ty: number, anchorBottom = true) => {
    const spr = getSprite(name);
    const feetX = (tx + 0.5) * TILE;
    const feetY = anchorBottom ? (ty + 1) * TILE : (ty + 0.5) * TILE;
    const s = worldToScreen(feetX, feetY, camera, viewport);
    const w = spr.w * scale;
    const h = spr.h * scale;
    ctx.drawImage(spr.canvas, round(s.x - w / 2), round(s.y - h), round(w), round(h));
  };

  const drawSpriteAtWorld = (name: SpriteName, worldX: number, worldY: number, anchorBottom = true) => {
    const spr = getSprite(name);
    const s = worldToScreen(worldX, worldY, camera, viewport);
    const w = spr.w * scale;
    const h = spr.h * scale;
    const top = anchorBottom ? s.y - h : s.y - h / 2;
    ctx.drawImage(spr.canvas, round(s.x - w / 2), round(top), round(w), round(h));
  };

  // --- 地面 ---
  const isLand = (x: number, y: number) => {
    const g = world.ground[y * world.width + x];
    return g !== undefined && g !== 'water';
  };

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const g = world.ground[ty * world.width + tx];
      if (g === undefined) continue;
      let name: SpriteName;
      if (g === 'water') {
        const phase = Math.floor(hash2(tx, ty) * 600);
        const frame = Math.floor((now + phase) / 600) % 2;
        name = (frame === 0 ? 'water' : 'water2') as SpriteName;
      } else if (g === 'grass') {
        name = (hash2(tx, ty) < 0.25 ? 'grass2' : 'grass') as SpriteName;
      } else if (g === 'sand') {
        name = 'sand' as SpriteName;
      } else {
        name = 'soil' as SpriteName;
      }
      const spr = getSprite(name);
      const s = worldToScreen(tx * TILE, ty * TILE, camera, viewport);
      ctx.drawImage(spr.canvas, round(s.x), round(s.y), round(TILE * scale), round(TILE * scale));

      if (g === 'water') {
        // 陸に接する側だけ shore を重ねる
        if (ty > 0 && isLand(tx, ty - 1)) drawShore('shoreN' as SpriteName, tx, ty);
        if (ty < world.height - 1 && isLand(tx, ty + 1)) drawShore('shoreS' as SpriteName, tx, ty);
        if (tx > 0 && isLand(tx - 1, ty)) drawShore('shoreW' as SpriteName, tx, ty);
        if (tx < world.width - 1 && isLand(tx + 1, ty)) drawShore('shoreE' as SpriteName, tx, ty);
      }
    }
  }

  function drawShore(name: SpriteName, tx: number, ty: number) {
    const spr = getSprite(name);
    const s = worldToScreen(tx * TILE, ty * TILE, camera, viewport);
    ctx.drawImage(spr.canvas, round(s.x), round(s.y), round(TILE * scale), round(TILE * scale));
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
      drawSpriteAtTile(name, t.x, t.y);
      if (stage === 2) {
        // 収穫可能：控えめなスパークル
        const s = worldToScreen((t.x + 0.5) * TILE, t.y * TILE, camera, viewport);
        const twinkle = 0.4 + 0.4 * Math.sin(now / 180 + hash2(t.x, t.y) * 10);
        ctx.fillStyle = `rgba(255,255,200,${twinkle.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- 看板（選んでいる作物のアイコンを小さく載せる） ---
  for (const plot of world.plots) {
    drawSpriteAtTile('sign' as SpriteName, plot.sign.x, plot.sign.y);
    const ps = save.plots[plot.id];
    if (ps?.selected) {
      const s = worldToScreen((plot.sign.x + 0.5) * TILE, plot.sign.y * TILE + TILE * 0.35, camera, viewport);
      const spr = getSprite(`item_${ps.selected}` as SpriteName);
      const w = spr.w * scale * 0.5;
      const h = spr.h * scale * 0.5;
      ctx.drawImage(spr.canvas, round(s.x - w / 2), round(s.y - h / 2), round(w), round(h));
    }
  }

  // --- decorate: スロット枠 ---
  if (state.decorate) {
    for (const slot of world.slots) {
      const placed = save.placements[slot.id];
      if (placed) {
        drawSpriteAtTile(`f_${placed}` as SpriteName, slot.x, slot.y);
      }
      const s = worldToScreen(slot.x * TILE, slot.y * TILE, camera, viewport);
      const size = TILE * scale;
      ctx.strokeStyle = SLOT_COLORS[slot.attr];
      ctx.lineWidth = Math.max(1, 2 * scale * 0.5);
      roundRect(ctx, s.x + 2, s.y + 2, size - 4, size - 4, 4 * scale);
      ctx.stroke();
      if (!placed) {
        const spr = getSprite(`slot_${slot.attr}` as SpriteName);
        const w = spr.w * scale * 0.6;
        const h = spr.h * scale * 0.6;
        ctx.drawImage(spr.canvas, round(s.x + size / 2 - w / 2), round(s.y + size / 2 - h / 2), round(w), round(h));
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

  // --- 設備（遺跡・作業台）。遺跡は紋様が常にゆっくり明滅する（発見しやすさのため）。 ---
  for (const station of world.stations) {
    const spriteName = (station.kind === 'ruins' ? 'station_ruins' : 'station_workbench') as SpriteName;
    drawables.push({
      y: station.y,
      draw: () => {
        drawSpriteAtTile(spriteName, station.x, station.y);
        if (station.kind === 'ruins') drawRuinsGlow(station.x, station.y, now, camera, viewport, scale);
      },
    });
  }

  if (!state.decorate) {
    for (const [slotId, furnitureId] of Object.entries(save.placements)) {
      const slot = world.slots.find((s) => s.id === slotId);
      if (!slot) continue;
      drawables.push({ y: slot.y, draw: () => drawSpriteAtTile(`f_${furnitureId}` as SpriteName, slot.x, slot.y) });
    }
  }

  // プレイヤー
  const moving = state.moving;
  const frame = moving ? Math.floor(now / 150) % 2 : 0;
  const playerSprite = `player_${save.player.dir}${frame}` as SpriteName;
  drawables.push({
    y: save.player.y,
    draw: () => drawSpriteAtWorld(playerSprite, save.player.x * TILE, save.player.y * TILE),
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

  // --- パーティクル ---
  for (const p of effects.particles) {
    const t = (now - p.startedAt) / p.lifeMs;
    if (t > 1) continue;
    const px = p.x + p.vx * (t * p.lifeMs) / 1000;
    const py = p.y + p.vy * (t * p.lifeMs) / 1000 + 60 * t * t; // 簡易重力
    const s = worldToScreen(px, py, camera, viewport);
    const size = Math.max(1, 3 * scale * (1 - t * 0.5));
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.fillRect(round(s.x - size / 2), round(s.y - size / 2), round(size), round(size));
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

  const ctx = getCurrentCtx();
  if (ctx && shakeX !== 0) {
    ctx.save();
    ctx.translate(shakeX, 0);
    drawSpriteAtTile(node.kind as SpriteName, node.x, node.y);
    ctx.restore();
  } else {
    drawSpriteAtTile(node.kind as SpriteName, node.x, node.y);
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
