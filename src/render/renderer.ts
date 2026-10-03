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
  LiveNode,
  NodeKind,
  SaveState,
  StationKind,
  Target,
  TimedAction,
  World,
} from '@/game/types';
import { FURNITURE_BY_ID, FURNITURE_DISPLAY_SIZE, ITEMS, NODES, STATIONS } from '@/game/data';
import { cropProgress } from '@/game/time';
import { allNodes, isBuildable, nodeAlive, placementRect } from '@/game/rules';
import { store } from '@/game/store';

import { followFactor, screenToWorld, TILE, TILT_DEG, type CameraState, type Viewport, worldToScreen } from './camera';
import { getGroundFurnitureSprite, getSprite, type SpriteName } from './sprites';
import type { PaintedTerrain } from './terrain';
import { TERRAIN_PX } from './terrainCore';
import type { TreeInstance } from './forestTrees';
import { chopImpactTimes, drawAvatar, type AvatarDir, type AvatarPose, type AvatarTool } from './avatar';

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
  /** 今やっている時間のかかる行動（伐採・採取・畑）。無ければ null。 */
  action: TimedAction | null;
  dpr: number;
  stick: { anchor: Vec2; finger: Vec2 } | null;
  /** 事前描画した地面レイヤー（WorldView がロード時に焼いて渡す）。まだ無ければ null。 */
  terrain: PaintedTerrain | null;
  /** 草地・水面・岸に置く花・草・睡蓮など（見た目だけ。WorldView が一度だけ生成して渡す）。 */
  groundDecor: TreeInstance[];
}

// ---------------------------------------------------------------------------
// 行動のタイミング（道具が当たる瞬間）。木の揺れ・音・パーティクルをここに合わせる。

/** 1 回の行動の中で道具が当たる瞬間（0..1）。 */
export const IMPACT_TIMES: readonly number[] = chopImpactTimes();

/** i 回目の当たりの実時刻。 */
export function impactAt(a: TimedAction, i: number): number {
  return a.startedAt + IMPACT_TIMES[i]! * (a.endsAt - a.startedAt);
}

/** 行動の道具（主人公の動き）。 */
export function toolForAction(a: TimedAction): AvatarTool {
  if (a.kind === 'gather') return 'hand';
  if (a.kind === 'farm') return 'hoe';
  return 'axe';
}

const TREE_KIND_SET = new Set<NodeKind>(['tree', 'bigTree', 'borderTree', 'forestTree']);
const isStoneKind = (k: NodeKind) => k === 'rock' || k === 'hardRock' || k === 'borderRock';

/** 揺れが続く時間と形（減衰振動）。 */
const SWAY_MS = 1500;
const SWAY_DECAY_MS = 300;
const SWAY_HZ = 2.6;

/** 叩かれたあとの揺れ。当たるたびに外へ押され、ばねのように戻る。おおむね -1..1。 */
function swayFor(a: TimedAction, now: number): number {
  let s = 0;
  for (let i = 0; i < IMPACT_TIMES.length; i++) {
    const dt = now - impactAt(a, i);
    if (dt < 0 || dt > SWAY_MS) continue;
    s += Math.exp(-dt / SWAY_DECAY_MS) * Math.sin((dt / 1000) * Math.PI * 2 * SWAY_HZ);
  }
  return s;
}

/** 花を引っぱったときの伸び縮み。+ で縦に伸びる。 */
function tugFor(a: TimedAction, now: number): number {
  let s = 0;
  for (let i = 0; i < IMPACT_TIMES.length; i++) {
    const dt = now - impactAt(a, i);
    if (dt < -120 || dt > 900) continue;
    if (dt < 0) s -= (1 + dt / 120) * 0.5; // 引く直前は少しつぶれる（ため）
    else s += Math.exp(-dt / 160) * Math.cos((dt / 1000) * Math.PI * 2 * 4.5);
  }
  return s;
}

// ---------------------------------------------------------------------------
// パーティクル・トースト・ドロップ（時間経過で消える）

interface Particle {
  x: number; // ワールド px（地面の位置）
  y: number;
  z: number; // 地面からの高さ（ワールド px）
  vx: number;
  vy: number;
  vz: number;
  gravity: number; // z 方向の重力（ワールド px/s²）。木の葉は小さく、ひらひら落ちる
  flutter: number; // 横ゆれの強さ
  sprite: SpriteName;
  size: number;
  startedAt: number;
  lifeMs: number;
}

interface Toast {
  text: string;
  x: number; // ワールド px（生成時のアンカー）。-1 なら画面中央の大きな文字
  y: number;
  startedAt: number;
  big: boolean;
  /** プレイヤーの頭の上について行く（拾ったアイテム）。 */
  follow?: { item: ItemId; n: number };
}

/** 「コン」の当たり表現（星形の閃光と小さな文字）。 */
interface Burst {
  x: number;
  y: number;
  z: number;
  text: string | null;
  /** 文字を出す側（+1 = 右）。 */
  side: number;
  startedAt: number;
}

/** 倒れる木・消える幹や花の残像。 */
interface Fell {
  sprite: SpriteName;
  x: number; // 根元（ワールド px）
  y: number;
  tileY: number;
  kind: 'topple' | 'pop';
  sign: number; // 倒れる向き（+1 = 右）
  maxTiles: number | null;
  crown: boolean;
  startedAt: number;
}

/** 出てきたアイテム 1 個ぶん。飛び出す → 地面で弾む → 3 秒置かれる → プレイヤーへ吸い込まれる。 */
interface DropIcon {
  item: ItemId;
  ox: number; // 出どころ（ワールド px）
  oy: number;
  oz: number;
  lx: number; // 着地点
  ly: number;
  startedAt: number;
  /** 群れの最初の 1 個に「×n」を出す。 */
  badge: number | null;
  /** 群れの最後の 1 個が届いたら「+n 名前」を出す。 */
  arriveToast: number | null;
  arrived: boolean;
  seed: number;
}

const PARTICLE_LIFE_MS = 650;
const TOAST_LIFE_MS = 900;
const FOLLOW_TOAST_MS = 1300;
const BURST_MS = 520;
const TOPPLE_MS = 680;
const POP_MS = 420;

const DROP_POP_MS = 520; // 弧を描いて飛ぶ
const DROP_BOUNCE_MS = 200; // 小さく 1 回弾む
const DROP_REST_END_MS = 3000; // ここまで地面に置いておく
const DROP_SUCK_MS = 430; // プレイヤーへ吸い込まれる
const DROP_STAGGER_MS = 70;
const DROP_MAX_ICONS = 6;
const DROP_ICON_SCALE = 0.72;
const CHEST_Z = 20; // 吸い込み先（胸の高さ、ワールド px）

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

class Effects {
  particles: Particle[] = [];
  toasts: Toast[] = [];
  bursts: Burst[] = [];
  fells: Fell[] = [];
  drops: DropIcon[] = [];
  /** アイテムがプレイヤーに届いたとき（WorldView が音を鳴らす）。 */
  onCollect: (() => void) | null = null;

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    sprite: SpriteName,
    now: number,
    count: number,
    opts: { speed?: number; up?: number; gravity?: number; flutter?: number; size?: number; delay?: number; life?: number; dirX?: number } = {},
  ): void {
    const speed = opts.speed ?? 40;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * sp + (opts.dirX ?? 0),
        vy: Math.sin(angle) * sp * 0.5,
        vz: (opts.up ?? 40) * (0.6 + Math.random() * 0.8),
        gravity: opts.gravity ?? 260,
        flutter: opts.flutter ?? 0,
        sprite,
        size: (opts.size ?? 0.6) * (0.75 + Math.random() * 0.5),
        startedAt: now + (opts.delay ?? 0) + Math.random() * 40,
        lifeMs: (opts.life ?? PARTICLE_LIFE_MS) * (0.8 + Math.random() * 0.4),
      });
    }
  }

  private pushToast(text: string, x: number, y: number, now: number, big = false): void {
    this.toasts.push({ text, x, y, startedAt: now, big });
  }

  /** 道具が当たった瞬間（WorldView が当たりの時刻を越えたときに呼ぶ）。 */
  impact(a: TimedAction, i: number, now: number): void {
    const cx = (a.x + 0.5) * TILE;
    const cy = (a.y + BASE_IN_TILE) * TILE;
    const player = store.get().player;
    const side = player.x * TILE < cx ? -1 : 1; // 当たる面（プレイヤーのいる側）
    if (a.kind === 'farm') {
      this.spawnParticles(cx, (a.y + 0.6) * TILE, 2, 'fx_dust' as SpriteName, now, 6, { speed: 34, up: 30, gravity: 200, size: 0.7 });
      return;
    }
    if (a.kind === 'gather') {
      this.spawnParticles(cx, cy - 2, 10, 'fx_leaf' as SpriteName, now, 3, { speed: 26, up: 50, gravity: 120, flutter: 10, size: 0.45 });
      this.bursts.push({ x: cx, y: cy, z: 12, text: i === IMPACT_TIMES.length - 1 ? 'ポン' : null, side, startedAt: now });
      return;
    }
    const kind = a.nodeKind ?? 'tree';
    const stump = a.nodeId ? store.get().nodes[a.nodeId]?.stump === true : false;
    if (isStoneKind(kind)) {
      this.spawnParticles(cx + side * 6, cy, 10, 'fx_dust' as SpriteName, now, 5, { speed: 40, up: 50, size: 0.6, dirX: side * 20 });
      this.bursts.push({ x: cx + side * 8, y: cy, z: 12, text: 'カン', side, startedAt: now });
      return;
    }
    if (TREE_KIND_SET.has(kind) && !stump) {
      // 梢から葉が舞い、幹に「コン」
      this.spawnParticles(cx - 14, cy, 40, 'fx_leaf' as SpriteName, now, 4, { speed: 36, up: 24, gravity: 60, flutter: 16, size: 1.1, life: 1400, dirX: -18 });
      this.spawnParticles(cx + 14, cy, 40, 'fx_leaf' as SpriteName, now, 4, { speed: 36, up: 24, gravity: 60, flutter: 16, size: 1.1, life: 1400, dirX: 18 });
      this.spawnParticles(cx + side * 7, cy, 9, 'fx_dust' as SpriteName, now, 3, { speed: 30, up: 40, size: 0.45, dirX: side * 24 });
      this.bursts.push({ x: cx + side * 8, y: cy, z: 10, text: 'コン', side, startedAt: now });
    } else {
      // 幹（切り株）・その他
      this.spawnParticles(cx + side * 5, cy, 6, 'fx_dust' as SpriteName, now, 4, { speed: 36, up: 45, size: 0.55, dirX: side * 20 });
      this.bursts.push({ x: cx + side * 6, y: cy, z: 6, text: 'コン', side, startedAt: now });
    }
  }

  /** 出てきたアイテムを、1 個ずつ（同じ種類は最大 6 個）弧を描いて飛ばす。 */
  private spawnDrops(tx: number, ty: number, items: Partial<Record<ItemId, number>>, now: number, fromTree: boolean): void {
    const ox = (tx + 0.5) * TILE;
    const oy = (ty + BASE_IN_TILE) * TILE;
    const player = store.get().player;
    // プレイヤーのいる側の左右（斜め手前）へ交互に散らす。物の向こう側は物や森の陰に隠れ、
    // プレイヤーの真上は主人公に重なるので避ける。
    const toward = Math.atan2(player.y * TILE - oy, player.x * TILE - ox);
    const entries = Object.entries(items).filter(([, n]) => (n ?? 0) > 0) as [ItemId, number][];
    let k = 0;
    for (const [item, n] of entries) {
      const icons = Math.min(DROP_MAX_ICONS, n);
      for (let j = 0; j < icons; j++) {
        const side = k % 2 === 0 ? 1 : -1;
        const ring = Math.floor(k / 2);
        const fan = 1.1 + ring * 0.3;
        const ang = toward + side * fan + (Math.random() - 0.5) * 0.25;
        const r = TILE * (0.6 + Math.random() * 0.3 + ring * 0.08);
        this.drops.push({
          item,
          ox,
          oy,
          oz: fromTree ? 22 : 8,
          lx: ox + Math.cos(ang) * r,
          ly: oy + Math.sin(ang) * r * 0.8,
          startedAt: now + k * DROP_STAGGER_MS,
          badge: j === 0 && n > icons ? n : null,
          arriveToast: j === icons - 1 ? n : null,
          arrived: false,
          seed: Math.random() * 10,
        });
        k++;
      }
    }
  }

  /** 倒れる木・消える物の残像を作る。イベント処理の時点でセーブは更新済みなので、今の状態から「何だったか」を逆算する。 */
  private spawnFell(ev: { x: number; y: number; kind: NodeKind }, now: number): void {
    const world = store.world;
    const save = store.get();
    const player = save.player;
    const x = (ev.x + 0.5) * TILE;
    const y = (ev.y + BASE_IN_TILE) * TILE;
    const sign = player.x * TILE < x ? 1 : -1; // プレイヤーと反対へ倒れる
    if (TREE_KIND_SET.has(ev.kind)) {
      const node = allNodes(world, save, now).find((n) => n.x === ev.x && n.y === ev.y);
      const nowStump = node && nodeAlive(save, node, now) && save.nodes[node.id]?.stump === true;
      if (nowStump) {
        const tall = TALL_NODES.has(ev.kind);
        this.fells.push({ sprite: spriteForNode(ev.kind, ev.x, ev.y, world), x, y, tileY: ev.y, kind: 'topple', sign, maxTiles: tall ? CROWN_FIT_TILES : 1, crown: tall, startedAt: now });
        // 梢が地面に着くころに葉が舞う
        this.spawnParticles(x + sign * 34, y, 6, 'fx_leaf' as SpriteName, now, 9, { speed: 50, up: 40, gravity: 120, flutter: 12, size: 0.85, delay: TOPPLE_MS * 0.55, life: 900 });
        this.spawnParticles(x + sign * 30, y, 2, 'fx_dust' as SpriteName, now, 6, { speed: 46, up: 30, size: 0.8, delay: TOPPLE_MS * 0.55 });
      } else {
        this.fells.push({ sprite: 'stump' as SpriteName, x, y, tileY: ev.y, kind: 'pop', sign, maxTiles: 1, crown: false, startedAt: now });
        this.spawnParticles(x, y, 6, 'fx_dust' as SpriteName, now, 7, { speed: 44, up: 50, size: 0.75 });
      }
    } else if (ev.kind === 'flower') {
      this.fells.push({ sprite: flowerSprite(ev.x, ev.y), x, y, tileY: ev.y, kind: 'pop', sign, maxTiles: 1, crown: false, startedAt: now });
      this.spawnParticles(x, y, 8, 'fx_leaf' as SpriteName, now, 5, { speed: 30, up: 50, gravity: 120, flutter: 10, size: 0.5 });
    } else {
      this.spawnParticles(x, y, 8, (isStoneKind(ev.kind) ? 'fx_dust' : 'fx_leaf') as SpriteName, now, 7, { speed: 44, up: 50, size: 0.7 });
    }
  }

  pushEvents(events: GameEvent[], now: number): void {
    // 木から出たものは梢の高さから飛ぶ
    const brokeTree = events.some((e) => e.type === 'broke' && TREE_KIND_SET.has(e.kind));
    for (const ev of events) {
      switch (ev.type) {
        case 'broke':
          this.spawnFell(ev, now);
          break;
        case 'dropped':
          this.spawnDrops(ev.x, ev.y, ev.items, now, brokeTree);
          break;
        case 'areaOpened':
          this.pushToast(`${ev.area} がひらけた！`, -1, -1, now, true);
          break;
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

  /** アイテムがプレイヤーに届いた。同じアイテムの直前のトーストがあれば数を足す。 */
  collected(item: ItemId, n: number, now: number): void {
    const prev = this.toasts.find((t) => t.follow?.item === item && now - t.startedAt < 500);
    if (prev && prev.follow) {
      prev.follow.n += n;
      prev.startedAt = now;
      prev.text = `+${prev.follow.n} ${ITEMS[item]?.name ?? item}`;
    } else {
      this.toasts.push({ text: `+${n} ${ITEMS[item]?.name ?? item}`, x: 0, y: 0, startedAt: now, big: false, follow: { item, n } });
    }
    this.onCollect?.();
  }

  prune(now: number): void {
    this.particles = this.particles.filter((p) => now - p.startedAt < p.lifeMs);
    this.toasts = this.toasts.filter((t) => now - t.startedAt < (t.follow ? FOLLOW_TOAST_MS : TOAST_LIFE_MS));
    this.bursts = this.bursts.filter((b) => now - b.startedAt < BURST_MS);
    this.fells = this.fells.filter((f) => now - f.startedAt < (f.kind === 'topple' ? TOPPLE_MS : POP_MS));
    for (const d of this.drops) {
      if (!d.arrived && now - d.startedAt >= DROP_REST_END_MS + DROP_SUCK_MS) {
        d.arrived = true;
        if (d.arriveToast != null) this.collected(d.item, d.arriveToast, now);
      }
    }
    this.drops = this.drops.filter((d) => !d.arrived);
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

/** キャンバスに描く文字の書体。HUD と同じピグの丸ゴシック（index.html で読み込む）。 */
const CANVAS_FONT = "'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', sans-serif";

const OCEAN = '#1b96d5'; // 地図の外（海）。terrainCore.ts の WATER_DEEP と同じ色

const DECOR_SPRITE: Record<DecorKind, SpriteName> = {
  rubble: 'decor_rubble' as SpriteName,
  brokenStone: 'decor_brokenStone' as SpriteName,
  ship: 'decor_ship' as SpriteName,
};

const STATION_SPRITE: Partial<Record<StationKind, SpriteName>> = {
  ruins: 'station_ruins' as SpriteName,
  dock: 'station_dock' as SpriteName,
};

// 模様替えのマス目（ピグの模様替えのように、うすい白の面にくっきりした白線）
const GRID_FILL = 'rgba(255, 255, 255, 0.22)';
const GRID_LINE = 'rgba(255, 255, 255, 0.85)';

/** 立つ物の足元の幅の上限（マス幅に対する割合）。はみ出すときは全体を一様に縮める。 */
const FOOT_FIT = 0.92;
/** 背の高い木は梢がマスより広くてよい（上限は 1.4 マス幅）。 */
const CROWN_FIT_TILES = 1.4;
/** 物の足元をマスの手前の縁から少し内側（マス内 y+0.92）に置く。 */
const BASE_IN_TILE = 0.92;

// 落ち影（光は左手前から → 影は右奥へ伸びる）。スプライトのシルエットを 1 度だけ焼いて使い回す。
const CAST_SHEAR = 0.5;
const CAST_SQUASH = 0.3;
const CAST_ALPHA = 0.22;
const CAST_BAKE_SCALE = 0.5;
const silhouetteCache = new WeakMap<object, HTMLCanvasElement>();

function getSilhouette(src: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  let c = silhouetteCache.get(src);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * CAST_BAKE_SCALE));
  c.height = Math.max(1, Math.round(src.height * CAST_BAKE_SCALE));
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgb(40, 60, 40)';
  g.fillRect(0, 0, c.width, c.height);
  silhouetteCache.set(src, c);
  return c;
}

// 壊れて復活待ちの岩に残す瓦礫。木は「幹（stump 状態）を切ると消える」ので、消えたあとには何も残さない
// （前はここで幹を描いていて、切れない幹に見えていた）。
const NODE_TO_STUMP: Partial<Record<NodeKind, SpriteName>> = {
  rock: 'rubble' as SpriteName,
  hardRock: 'rubble' as SpriteName,
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

  /** 立つ物の落ち影（シルエットを右奥へ倒す）。(sx,sy) は足元、w,h は描画サイズ（画面 px）。 */
  const drawCastShadow = (canvas: CanvasImageSource, sx: number, sy: number, w: number, h: number, strength = 1) => {
    const sil = getSilhouette(canvas as CanvasImageSource & { width: number; height: number });
    ctx.save();
    ctx.globalAlpha = CAST_ALPHA * strength;
    ctx.transform(1, 0, -CAST_SHEAR, CAST_SQUASH, sx, sy);
    ctx.drawImage(sil, -w / 2, -h, w, h);
    ctx.restore();
  };

  /**
   * スプライトを足元 (wx,wy)（ワールド px）にまっすぐ立てて描く。
   * 幅が maxTiles マス × FOOT_FIT（木の梢は maxTiles をそのまま）を超えるなら、全体を一様に縮める。
   */
  const drawUpright = (name: SpriteName, wx: number, wy: number, shadow = true, alpha = 1, maxTiles: number | null = 1, crown = false, xf: SpriteXf | null = null) => {
    const spr = getSprite(name);
    const p = worldToScreen(wx, wy, camera, viewport);
    let w = spr.w * p.k;
    let h = spr.h * p.k;
    if (maxTiles != null) {
      const allowed = maxTiles * TILE * p.k * (crown ? 1 : FOOT_FIT);
      if (w > allowed) {
        const f = allowed / w;
        w *= f;
        h *= f;
      }
    }
    if (p.x + w / 2 < 0 || p.x - w / 2 > W || p.y - h > H || p.y < 0) return;
    if (shadow) {
      const foot = Math.min(w, (maxTiles ?? 1) * TILE * p.k * FOOT_FIT);
      drawCastShadow(spr.canvas, p.x, p.y, w, h, alpha);
      drawShadow(p.x, p.y - h * 0.01, foot * 0.9, 1.1);
    }
    if (xf) {
      // 根元を軸に回す・伸び縮みさせる（揺れ・倒れる・ぽんと消える）。影は地面に残す。
      ctx.save();
      ctx.globalAlpha = alpha * (xf.alpha ?? 1);
      ctx.translate(p.x + (xf.dx ?? 0) * p.k, p.y);
      if (xf.rot) ctx.rotate(xf.rot);
      ctx.scale(xf.sx ?? 1, xf.sy ?? 1);
      ctx.drawImage(spr.canvas, -w / 2, -h, w, h);
      ctx.restore();
      return;
    }
    if (alpha < 0.999) ctx.globalAlpha = alpha;
    ctx.drawImage(spr.canvas, p.x - w / 2, p.y - h, w, h);
    if (alpha < 0.999) ctx.globalAlpha = 1;
  };

  const drawAtTile = (name: SpriteName, tx: number, ty: number, shadow = true, alpha = 1, xf: SpriteXf | null = null) =>
    drawUpright(name, (tx + 0.5) * TILE, (ty + BASE_IN_TILE) * TILE, shadow, alpha, 1, false, xf);

  /** 見え隠れつきで描く（プレイヤーが後ろに重なれば半透明）。 */
  const drawOccludable = (key: string, name: SpriteName, wx: number, wy: number, shadow = true, maxTiles: number | null = 1, crown = false, xf: SpriteXf | null = null) => {
    const spr = getSprite(name);
    const p = worldToScreen(wx, wy, camera, viewport);
    const rect: Rect = { left: p.x - (spr.w * p.k) / 2, right: p.x + (spr.w * p.k) / 2, top: p.y - spr.h * p.k, bottom: p.y };
    const alpha = occlusionFor(key, rect, wy, save.player.y * TILE, playerRect, occlusionEase);
    drawUpright(name, wx, wy, shadow, alpha, maxTiles, crown, xf);
  };

  /** 家具を「デザインで決めた表示サイズ」に contain-fit して、footprint の下辺中央 (wx,wy) に立てる。幅は footprint(size マス)×0.92 以内。 */
  const drawFurnitureAtWorld = (furnitureId: string, wx: number, wy: number, tiles: number) => {
    const spr = getSprite(`f_${furnitureId}` as SpriteName);
    const size = FURNITURE_DISPLAY_SIZE[furnitureId] ?? { w: 1, h: 1 };
    const p = worldToScreen(wx, wy, camera, viewport);
    const boxW = Math.min(size.w, tiles) * TILE * p.k;
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
    const allowed = tiles * TILE * p.k * FOOT_FIT;
    if (drawW > allowed) {
      const f = allowed / drawW;
      drawW *= f;
      drawH *= f;
    }
    drawCastShadow(spr.canvas, p.x, p.y, drawW, drawH);
    drawShadow(p.x, p.y - drawH * 0.01, drawW * 0.9, 1.1);
    ctx.drawImage(spr.canvas, p.x - drawW / 2, p.y - drawH, drawW, drawH);
  };

  /** 出てきたアイテム 1 個。age は飛び出してからの ms。 */
  const drawDrop = (d: DropIcon, age: number) => {
    const spr = getSprite(`item_${d.item}` as SpriteName);
    const restZ = 1.5 + 1.5 * Math.sin((age / 1000) * Math.PI * 2 * 0.9 + d.seed);
    let gx = d.lx;
    let gy = d.ly;
    let z = restZ;
    let sx = 1;
    let sy = 1;
    let alpha = 1;
    let shadow = true;
    if (age < DROP_POP_MS) {
      // 物から弧を描いて飛び出す
      const u = age / DROP_POP_MS;
      const e = 1 - (1 - u) * (1 - u) * 0.6 - 0.4 * (1 - u); // ほぼ等速、着地前に少し減速
      gx = d.ox + (d.lx - d.ox) * e;
      gy = d.oy + (d.ly - d.oy) * e;
      z = d.oz * (1 - u) + 4 * 22 * u * (1 - u);
      const grow = Math.min(1, 0.55 + u * 1.5);
      sx = grow;
      sy = grow;
    } else if (age < DROP_POP_MS + DROP_BOUNCE_MS) {
      // 着地して小さく 1 回弾む（着いた瞬間は少しつぶれる）
      const u = (age - DROP_POP_MS) / DROP_BOUNCE_MS;
      z = 4 * 6 * u * (1 - u);
      const sq = u < 0.25 ? (0.25 - u) * 0.8 : 0;
      sx = 1 + sq;
      sy = 1 - sq;
    } else if (age >= DROP_REST_END_MS) {
      // プレイヤーの胸へ、だんだん速く吸い込まれて小さくなる
      const u = clamp01((age - DROP_REST_END_MS) / DROP_SUCK_MS);
      const e = u ** 2.4;
      gx = d.lx + (save.player.x * TILE - d.lx) * e;
      gy = d.ly + (save.player.y * TILE - d.ly) * e;
      z = restZ + (CHEST_Z - restZ) * e + Math.sin(u * Math.PI) * 10;
      sx = sy = 1 - 0.55 * e;
      alpha = u > 0.85 ? (1 - u) / 0.15 : 1;
      shadow = u < 0.5;
    }
    const p = worldToScreen(gx, gy, camera, viewport);
    const w = spr.w * DROP_ICON_SCALE * p.k;
    const h = spr.h * DROP_ICON_SCALE * p.k;
    if (shadow) drawShadow(p.x, p.y, w * 1.25, Math.max(0.35, 1 - z / 30));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y - z * p.k * TILT_COS);
    ctx.scale(sx, sy);
    ctx.drawImage(spr.canvas, -w / 2, -h, w, h);
    ctx.restore();
    if (d.badge != null && age < DROP_REST_END_MS) {
      ctx.save();
      ctx.font = `800 ${Math.round(Math.max(11, 12 * p.k))}px ${CANVAS_FONT}`;
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(70,45,30,0.85)';
      ctx.fillStyle = '#fffbe6';
      const tx = p.x + w * 0.3;
      const ty = p.y - z * p.k * TILT_COS - h * 0.75;
      ctx.strokeText(`×${d.badge}`, tx, ty);
      ctx.fillText(`×${d.badge}`, tx, ty);
      ctx.restore();
    }
  };

  // プレイヤーの画面上の矩形（見え隠れ判定用。主人公はおよそ 30×42 ワールド px）
  const pp = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
  const playerRect: Rect = {
    left: pp.x - (PLAYER_BOX_W * pp.k) / 2,
    right: pp.x + (PLAYER_BOX_W * pp.k) / 2,
    top: pp.y - PLAYER_BOX_H * pp.k,
    bottom: pp.y,
  };

  // 行動の揺れは、行動が終わってもしばらく続ける（最後の当たりの余韻）
  if (state.action) recentAction = state.action;
  else if (recentAction && now - recentAction.endsAt > SWAY_MS) recentAction = null;
  const swayAction = recentAction;

  // 歩きの位相（歩いた時間だけ進める）
  if (state.moving && !state.action) walkPhase += occlusionDtSec * WALK_RAD_PER_SEC;

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
    ctx.fillStyle = GRID_FILL;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!isBuildable(world, save, tx, ty)) continue;
        polygonPath(ctx, tileQuad(tx, ty, 1, 1, camera, viewport));
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --- 狙っているマスの印（地面に敷く）。ピグライフの置き場所の印と同じ、黄緑 #d3ea2e の平らなマス。
  //     地面に貼るので、木や人の足元に隠れる（上から枠を描くと物に重なって浮いて見える）。
  if (!state.decorate && state.target) {
    const t = state.target;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.save();
    polygonPath(ctx, tileQuad(t.x, t.y, 1, 1, camera, viewport), 0.06);
    ctx.globalAlpha = 0.78 + 0.17 * pulse;
    ctx.fillStyle = t.blocked ? '#ff9c99' : '#d3ea2e';
    ctx.fill();
    polygonPath(ctx, tileQuad(t.x, t.y, 1, 1, camera, viewport), 0.26);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = t.blocked ? '#ffd0ce' : '#ecf695';
    ctx.fill();
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

  for (const node of allNodes(world, save, now)) {
    if (node.x < minTx - 1 || node.x > maxTx + 1 || node.y < minTy - 3 || node.y > maxTy + 1) continue;
    const alive = nodeAlive(save, node, now);
    if (alive) {
      const acting = swayAction && swayAction.x === node.x && swayAction.y === node.y ? swayAction : null;
      drawables.push({
        y: node.y + 1,
        draw: () => drawNode(node, now, state, acting, drawOccludable, drawAtTile),
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
    const wy = (d.y + d.h - (1 - BASE_IN_TILE)) * TILE;
    const fit = d.kind === 'ship' ? null : Math.max(1, d.w); // 船は大物なので縮めない
    drawables.push({ y: d.y + d.h, draw: () => drawUpright(name, wx, wy, true, 1, fit) });
  }

  // --- 設備（遺跡・船着き場・家の跡地）。作業台・たき火などは置いた家具として下で描く ---
  for (const station of world.stations) {
    const spriteName = STATION_SPRITE[station.kind];
    drawables.push({
      y: station.y + 1,
      draw: () => {
        if (spriteName) {
          if (station.kind === 'ruins') drawOccludable(`station:${station.x},${station.y}`, spriteName, (station.x + 0.5) * TILE, (station.y + BASE_IN_TILE) * TILE);
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
      draw: () => drawFurnitureAtWorld(furnitureId, (r.x + r.size / 2) * TILE, (r.y + r.size - (1 - BASE_IN_TILE)) * TILE, r.size),
    });
  }

  // --- 地面の飾り（花・草・睡蓮・葦。可視範囲だけ描く） ---
  for (const d of state.groundDecor) {
    if (d.x < minTx - 2 || d.x > maxTx + 3 || d.y < minTy - 2 || d.y > maxTy + 3) continue;
    drawables.push({ y: d.flat ? -1000 : d.y - 0.5, draw: () => drawUpright(d.sprite, d.x * TILE, d.y * TILE, false) });
  }

  // --- 倒れる木・ぽんと消える幹や花（幹の絵より手前に重ねる） ---
  for (const f of effects.fells) {
    const t = clamp01((now - f.startedAt) / (f.kind === 'topple' ? TOPPLE_MS : POP_MS));
    drawables.push({
      y: f.tileY + 1.01,
      draw: () => {
        if (f.kind === 'topple') {
          // 根元を軸に、最初はゆっくり・だんだん速く倒れ、地面で小さく跳ねて消える
          const fallT = clamp01(t / 0.72);
          let rot = f.sign * 1.42 * fallT ** 2.2;
          if (t > 0.72) rot -= f.sign * Math.sin(((t - 0.72) / 0.28) * Math.PI) * 0.1;
          const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
          drawUpright(f.sprite, f.x, f.y, false, 1, f.maxTiles, f.crown, { rot, alpha });
        } else {
          const sc = 1 + 0.35 * easeOutCubic(t);
          drawUpright(f.sprite, f.x, f.y, false, 1, f.maxTiles, f.crown, { sx: sc, sy: sc * (1 - 0.15 * t), alpha: 1 - t });
        }
      },
    });
  }

  // --- 出てきたアイテム（地面にあるあいだは y ソート。吸い込み中はプレイヤーの手前） ---
  for (const d of effects.drops) {
    const age = now - d.startedAt;
    if (age < 0) continue;
    const sucking = age >= DROP_REST_END_MS;
    drawables.push({
      y: sucking ? save.player.y + 0.01 : age < DROP_POP_MS ? d.ly / TILE + 0.6 : d.ly / TILE,
      draw: () => drawDrop(d, age),
    });
  }

  // プレイヤー（コードで描くピグ風の主人公）。行動中は対象のほうを向いて道具を振る。
  const act = state.action;
  drawables.push({
    y: save.player.y,
    draw: () => {
      const p = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
      let dir: AvatarDir = save.player.dir;
      let action: AvatarPose['action'] = null;
      if (act) {
        dir = facingDir(act.x + 0.5 - save.player.x, act.y + 0.5 - save.player.y, dir);
        action = { tool: toolForAction(act), t: clamp01((now - act.startedAt) / Math.max(1, act.endsAt - act.startedAt)) };
      }
      const walking = state.moving && !act;
      drawShadow(p.x, p.y - 0.5 * p.k, PLAYER_BOX_W * p.k * 1.05);
      drawAvatar(ctx, p.x, p.y, p.k, { dir, walkPhase: walking ? walkPhase : null, idleT: now, action });
    },
  });

  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) {
    try {
      d.draw();
    } catch (e) {
      // 1 個の描画の失敗で、残りの物が全部消えないようにする（初回だけ知らせる）
      const msg = String(e);
      if (!drawErrorLogged.has(msg)) {
        drawErrorLogged.add(msg);
        // eslint-disable-next-line no-console
        console.error('[render] drawable failed', e);
      }
    }
  }

  // --- ハイライト（通常モードのみ） ---
  if (!state.decorate && state.target) {
    // ピグライフの「出現位置」の矢印: 橙 #fe741b → 赤橙 #ff4536 の太い下向き矢印 + 白の縁。
    // 名前は色文字 + 白の太いふち（ピグの文字の付け方。黒いふちは使わない）。
    const t = state.target;
    const s = worldToScreen((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, camera, viewport);
    const topY = s.y - 0.55 * TILE * s.k - 1.1 * TILE * s.k * 0.35;
    const bounce = Math.sin(now / 140) * 3;
    const ay = topY - 8 - bounce; // 矢印の先
    const aw = 9; // 矢じりの半幅
    const ah = 9; // 矢じりの高さ
    const sw = 4; // 軸の半幅
    const sh = 7; // 軸の高さ
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, ay);
    ctx.lineTo(s.x - aw, ay - ah);
    ctx.lineTo(s.x - sw, ay - ah);
    ctx.lineTo(s.x - sw, ay - ah - sh);
    ctx.lineTo(s.x + sw, ay - ah - sh);
    ctx.lineTo(s.x + sw, ay - ah);
    ctx.lineTo(s.x + aw, ay - ah);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, ay - ah - sh, 0, ay);
    if (t.blocked) {
      g.addColorStop(0, '#b9b1a8');
      g.addColorStop(1, '#8f867d');
    } else {
      g.addColorStop(0, '#fe741b');
      g.addColorStop(1, '#ff4536');
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    const label = targetLabel(t);
    if (label) {
      ctx.save();
      ctx.font = `800 14px ${CANVAS_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(label, s.x, ay - ah - sh - 6);
      ctx.fillStyle = '#8a6640';
      ctx.fillText(label, s.x, ay - ah - sh - 6);
      ctx.restore();
    }
  }

  // --- パーティクル（木の葉・木くず・土ぼこり）。地面の位置 (x,y) と高さ z で飛ばす ---
  for (const p of effects.particles) {
    const ageMs = now - p.startedAt;
    if (ageMs < 0) continue;
    const t = ageMs / p.lifeMs;
    if (t > 1) continue;
    const sec = ageMs / 1000;
    const drag = p.flutter > 0 ? 1 - Math.min(0.7, sec * 0.9) : 1;
    const px = p.x + p.vx * sec * drag + (p.flutter ? Math.sin(sec * 9 + p.startedAt) * p.flutter * Math.min(1, sec * 3) : 0);
    const py = p.y + p.vy * sec * drag;
    const z = Math.max(0, p.z + p.vz * sec - 0.5 * p.gravity * sec * sec);
    const s = worldToScreen(px, py, camera, viewport);
    const spr = getSprite(p.sprite);
    const shrink = 1 - t * 0.35;
    const w = Math.max(1, spr.w * s.k * p.size * shrink);
    const h = Math.max(1, spr.h * s.k * p.size * shrink);
    ctx.save();
    ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.translate(s.x, s.y - z * s.k * TILT_COS);
    if (p.flutter) ctx.rotate(Math.sin(sec * 7 + p.startedAt) * 0.8);
    ctx.drawImage(spr.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // --- 当たりの閃光（「コン」） ---
  for (const b of effects.bursts) {
    const t = (now - b.startedAt) / BURST_MS;
    if (t < 0 || t > 1) continue;
    const s = worldToScreen(b.x, b.y, camera, viewport);
    const cx = s.x;
    const cy = s.y - b.z * s.k * TILT_COS;
    const tl = Math.min(1, t * 1.6); // 閃光は文字より早く消える
    const r0 = 4 * s.k + 10 * s.k * easeOutCubic(tl);
    ctx.save();
    ctx.globalAlpha = 1 - tl;
    ctx.strokeStyle = '#fff6c8';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, 2.2 * s.k * (1 - tl * 0.5));
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.2;
      const len = i % 2 === 0 ? 1 : 0.6;
      ctx.moveTo(cx + Math.cos(ang) * r0 * 0.45, cy + Math.sin(ang) * r0 * 0.45);
      ctx.lineTo(cx + Math.cos(ang) * r0 * len, cy + Math.sin(ang) * r0 * len);
    }
    ctx.stroke();
    if (b.text) {
      const fs = Math.round(Math.max(12, 13 * s.k));
      ctx.font = `800 ${fs}px ${CANVAS_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(90,55,30,0.9)';
      // 文字はプレイヤーと反対側の斜め上へ（顔や頭の上のゲージと重ならないように）。消えるのは最後だけ
      const ty = cy - r0 - fs * 0.6 - 12 * easeOutCubic(t);
      const pop = t < 0.15 ? 0.7 + 2 * t : 1;
      ctx.globalAlpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      ctx.translate(cx - b.side * (r0 * 0.6 + fs * 0.8), ty);
      ctx.scale(pop, pop);
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = '#fffbe6';
      ctx.fillText(b.text, 0, 0);
    }
    ctx.restore();
  }

  // --- 作業中のまるいゲージ（プレイヤーの頭の上） ---
  if (state.action) {
    const a = state.action;
    const t = clamp01((now - a.startedAt) / Math.max(1, a.endsAt - a.startedAt));
    const s = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
    const r = Math.max(8, 7.5 * s.k);
    const gx = s.x;
    const gy = s.y - (PLAYER_BOX_H + 3) * s.k - r;
    ctx.save();
    ctx.fillStyle = 'rgba(255,251,236,0.95)';
    ctx.strokeStyle = 'rgba(110,75,50,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8fd16a';
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.arc(gx, gy, r - 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- トースト ---
  let followIndex = 0;
  for (const toast of effects.toasts) {
    const t = (now - toast.startedAt) / (toast.follow ? FOLLOW_TOAST_MS : TOAST_LIFE_MS);
    if (t > 1) continue;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    let sx: number;
    let sy: number;
    if (toast.follow) {
      // 拾ったアイテム：頭の上に「+n 名前」。複数あれば上へ積む
      const s = worldToScreen(save.player.x * TILE, save.player.y * TILE, camera, viewport);
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.4 : 1;
      sx = s.x;
      sy = s.y - (PLAYER_BOX_H + 2) * s.k - 18 * t - followIndex * 24;
      followIndex++;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(sx, sy);
      ctx.scale(pop, pop);
      const icon = getSprite(`item_${toast.follow.item}` as SpriteName);
      ctx.font = `800 18px ${CANVAS_FONT}`;
      const tw = ctx.measureText(toast.text).width;
      const iw = 24;
      const left = -(tw + iw + 3) / 2;
      ctx.drawImage(icon.canvas, left, -iw + 6, iw, iw);
      ctx.textAlign = 'left';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(80,50,30,0.85)';
      ctx.strokeText(toast.text, left + iw + 3, 0);
      ctx.fillStyle = '#fffbe6';
      ctx.fillText(toast.text, left + iw + 3, 0);
      ctx.restore();
      continue;
    }
    if (toast.x < 0) {
      sx = W / 2;
      sy = H * 0.3;
      ctx.font = `800 22px ${CANVAS_FONT}`;
    } else {
      const s = worldToScreen(toast.x, toast.y, camera, viewport);
      sx = s.x;
      sy = s.y - 24 * t - 0.8 * TILE * s.k;
      ctx.font = `700 15px ${CANVAS_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.max(0, alpha);
    // ピグの文字の付け方: 茶の色文字 + 白の太いふち
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(toast.text, sx, sy);
    ctx.fillStyle = '#8a6640';
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
  if (t.kind === 'furniture') return FURNITURE_BY_ID[t.furnitureId]?.name ?? null;
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

/** 描画の失敗は、同じ内容を 1 度だけ知らせる。 */
const drawErrorLogged = new Set<string>();

/** 花の見た目は場所で 4 種にばらす。 */
function flowerSprite(x: number, y: number): SpriteName {
  return `flower${Math.min(3, (hash2(x, y) * 4) | 0)}` as SpriteName;
}

/** 見た目の選び分け：砂浜の木はヤシ、森の木は 2 種を場所でばらす。 */
function spriteForNode(kind: NodeKind, x: number, y: number, world: World): SpriteName {
  if (kind === 'tree') {
    const g = world.ground[y * world.width + x];
    if (g === 'sand') return 'palm' as SpriteName;
  }
  if (kind === 'forestTree') return (hash2(x, y) < 0.32 ? 'wallPine' : 'wallOak') as SpriteName;
  if (kind === 'flower') return flowerSprite(x, y);
  return kind as SpriteName;
}

/** 根元を軸にした変形（揺れ・倒れる・伸び縮み）。dx はワールド px の横ずれ。 */
interface SpriteXf {
  rot?: number;
  sx?: number;
  sy?: number;
  dx?: number;
  alpha?: number;
}

type OccludableDraw = (key: string, name: SpriteName, wx: number, wy: number, shadow?: boolean, maxTiles?: number | null, crown?: boolean, xf?: SpriteXf | null) => void;
type TileDraw = (name: SpriteName, tx: number, ty: number, shadow?: boolean, alpha?: number, xf?: SpriteXf | null) => void;

/** 資源を 1 つ描く。acting は「この資源に今（または直前まで）している行動」で、揺れに使う。 */
function drawNode(node: LiveNode, now: number, state: RenderState, acting: TimedAction | null, drawOccludable: OccludableDraw, drawAtTile: TileDraw): void {
  const stump = state.save.nodes[node.id]?.stump === true;
  let spriteName: SpriteName;
  if (node.growing) spriteName = (node.kind === 'flower' ? 'flowerSprout' : 'sapling') as SpriteName;
  else if (stump) spriteName = 'stump' as SpriteName;
  else spriteName = spriteForNode(node.kind, node.x, node.y, state.world);
  const standingTree = TALL_NODES.has(node.kind) && !stump && !node.growing;

  let xf: SpriteXf | null = null;
  if (acting) {
    if (node.kind === 'flower') {
      const tug = tugFor(acting, now);
      if (tug !== 0) xf = { sx: 1 - 0.12 * tug, sy: 1 + 0.22 * tug };
    } else {
      const sway = swayFor(acting, now);
      if (sway !== 0) {
        // 梢はプレイヤーと反対側へ傾く。幹・岩は横に小さく震える
        const away = state.save.player.x < node.x + 0.5 ? 1 : -1;
        if (standingTree) xf = { rot: away * sway * 0.075, sx: 1 + Math.abs(sway) * 0.01 };
        else xf = { dx: away * sway * 1.6 };
      }
    }
  }

  if (standingTree) {
    drawOccludable(`node:${node.id}`, spriteName, (node.x + 0.5) * TILE, (node.y + BASE_IN_TILE) * TILE, true, CROWN_FIT_TILES, true, xf);
  } else {
    drawAtTile(spriteName, node.x, node.y, true, 1, xf);
  }
}

/** 主人公の当たり判定の箱（ワールド px）。見え隠れ・ゲージの位置に使う。 */
const PLAYER_BOX_W = 30;
const PLAYER_BOX_H = 42;
/** 歩きの位相の進み（ラジアン/秒）。半周 = 1 歩。 */
const WALK_RAD_PER_SEC = 10.5;
let walkPhase = 0;
/** 揺れの余韻のために、最後の行動を少しのあいだ覚えておく。 */
let recentAction: TimedAction | null = null;

/** (dx,dy) の向き。ほぼ 0 なら今の向きのまま。 */
function facingDir(dx: number, dy: number, fallback: AvatarDir): AvatarDir {
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

// draw() 実行中だけ保持する現在の ctx（drawNode などへ引き回さないため）。
let currentCtx: CanvasRenderingContext2D | null = null;
