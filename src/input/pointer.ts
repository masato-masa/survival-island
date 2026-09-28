// ポインタ入力：ドラッグ＝移動（浮くスティック）、タップ＝アクション、ピンチ＝ズーム、
// ホイール／キーボードにも対応する。DOM 依存部分と純粋な計算部分を分けて、
// 計算部分（しきい値判定・スティックのベクトル）だけを vitest でテストできるようにする。

export const TAP_THRESHOLD_PX = 7; // これ未満の移動はタップ扱い
export const TAP_MAX_MS = 450; // これを超えて押し続けたらタップにしない
export const JOYSTICK_FULL_RADIUS_PX = 40; // ここまでで最大速度
export const JOYSTICK_DRAG_RADIUS_PX = 70; // これを超えたら中心を指へ引きずる（浮くスティック）

// ---------------------------------------------------------------------------
// 純粋関数（テスト対象）

export interface Vec2 {
  x: number;
  y: number;
}

/** 開始点と現在点から、ドラッグとみなすかどうか。 */
export function isDrag(startX: number, startY: number, curX: number, curY: number): boolean {
  const dx = curX - startX;
  const dy = curY - startY;
  return Math.sqrt(dx * dx + dy * dy) >= TAP_THRESHOLD_PX;
}

/** タップと判定してよいか（移動量としきい値、経過時間の両方を見る）。 */
export function isTap(startX: number, startY: number, endX: number, endY: number, elapsedMs: number): boolean {
  return !isDrag(startX, startY, endX, endY) && elapsedMs <= TAP_MAX_MS;
}

/**
 * 浮くスティックの中心を、指の位置に応じて更新する。
 * 指が中心から JOYSTICK_DRAG_RADIUS_PX を超えたら、その分だけ中心を指の方向へ引きずる。
 * 戻り値は新しい中心。
 */
export function dragStickAnchor(anchor: Vec2, finger: Vec2): Vec2 {
  const dx = finger.x - anchor.x;
  const dy = finger.y - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= JOYSTICK_DRAG_RADIUS_PX) return anchor;
  const excess = dist - JOYSTICK_DRAG_RADIUS_PX;
  const ratio = excess / dist;
  return { x: anchor.x + dx * ratio, y: anchor.y + dy * ratio };
}

/**
 * スティックの中心と指の位置から、移動方向ベクトル（8 方向に丸めない、
 * 大きさ 0..1）を作る。JOYSTICK_FULL_RADIUS_PX で最大速度になる。
 */
export function stickVector(anchor: Vec2, finger: Vec2): Vec2 {
  const dx = finger.x - anchor.x;
  const dy = finger.y - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: 0, y: 0 };
  const mag = Math.min(1, dist / JOYSTICK_FULL_RADIUS_PX);
  return { x: (dx / dist) * mag, y: (dy / dist) * mag };
}

/** 2 点間の距離（ピンチのスケール計算に使う）。 */
export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** ピンチ操作から新しいズーム倍率を作る（開始時の距離・ズームからの比率）。 */
export function pinchZoom(startDistance: number, currentDistance: number, startZoom: number): number {
  if (startDistance <= 0) return startZoom;
  return startZoom * (currentDistance / startDistance);
}

/** ホイールのデルタからズーム倍率の増分を作る（下 = 縮小、上 = 拡大）。 */
export function wheelZoomDelta(deltaY: number): number {
  const factor = 0.0015;
  return Math.pow(2, -deltaY * factor);
}

// ---------------------------------------------------------------------------
// キーボード → 方向ベクトル

export type KeyDir = 'up' | 'down' | 'left' | 'right';

const KEY_MAP: Record<string, KeyDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

export function keyToDir(key: string): KeyDir | null {
  return KEY_MAP[key] ?? null;
}

export function isActionKey(key: string): boolean {
  return key === ' ' || key === 'Spacebar' || key === 'Enter';
}

/** 押されているキー方向の集合から移動ベクトル（正規化済み）を作る。 */
export function vectorFromKeys(dirs: Set<KeyDir>): Vec2 {
  let x = 0;
  let y = 0;
  if (dirs.has('left')) x -= 1;
  if (dirs.has('right')) x += 1;
  if (dirs.has('up')) y -= 1;
  if (dirs.has('down')) y += 1;
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.sqrt(x * x + y * y);
  return { x: x / len, y: y / len };
}

// ---------------------------------------------------------------------------
// DOM 結線（PointerController）。WorldView から使う。副作用があるためテストしない。

export interface PointerControllerCallbacks {
  /** 現フレームの移動方向ベクトル（大きさ 0..1）を毎フレーム読むための state を更新する。 */
  onMoveVector: (v: Vec2) => void;
  /** タップ確定時。screen 座標（canvas 内の css px）。 */
  onTap: (screenX: number, screenY: number) => void;
  /** ズーム倍率を絶対値でセット。 */
  onZoomChange: (zoom: number) => void;
  /** ジョイスティックの見た目更新用（null で非表示）。 */
  onStickVisual: (v: { anchor: Vec2; finger: Vec2 } | null) => void;
  getZoom: () => number;
}

interface ActivePointer {
  id: number;
  startX: number;
  startY: number;
  startAt: number;
  anchor: Vec2;
  isJoystick: boolean;
  /** しきい値を超えて動いたか。超えるまでは歩かせない（タップのつもりの指ぶれで動かないように）。 */
  dragging: boolean;
}

/**
 * canvas へポインタイベントを結線する。1 本目の指はジョイスティック、
 * 2 本目が乗るとピンチズームに切り替わり、1 本目のジョイスティックは解除する。
 */
export class PointerController {
  private el: HTMLElement;
  private cb: PointerControllerCallbacks;
  private pointers = new Map<number, ActivePointer>();
  private pinch: { startDistance: number; startZoom: number } | null = null;
  private keyDirs = new Set<KeyDir>();
  private keyVector: Vec2 = { x: 0, y: 0 };

  constructor(el: HTMLElement, cb: PointerControllerCallbacks) {
    this.el = el;
    this.cb = cb;
    el.style.touchAction = 'none';
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** WorldView のループから毎フレーム呼ぶ：キーボード分の移動ベクトルを返す。 */
  getKeyboardVector(): Vec2 {
    return this.keyVector;
  }

  private localPos(e: PointerEvent): Vec2 {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown(e: PointerEvent): void {
    const pos = this.localPos(e);
    this.el.setPointerCapture(e.pointerId);

    const [first] = this.pointers.values();
    if (first) {
      // 2 本目 → ピンチ開始。1 本目のジョイスティックは解除。
      const firstPos = this.lastKnown.get(first.id) ?? this.firstPos(first);
      this.pinch = { startDistance: distance(pos, firstPos), startZoom: this.cb.getZoom() };
      first.isJoystick = false;
      this.cb.onStickVisual(null);
      this.cb.onMoveVector({ x: 0, y: 0 });
      this.lastKnown.set(e.pointerId, pos);
    } else if (this.pointers.size === 0) {
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        startX: pos.x,
        startY: pos.y,
        startAt: performance.now(),
        anchor: { ...pos },
        isJoystick: true,
        dragging: false,
      });
      this.cb.onStickVisual({ anchor: pos, finger: pos });
      return;
    }
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      startX: pos.x,
      startY: pos.y,
      startAt: performance.now(),
      anchor: { ...pos },
      isJoystick: false,
      dragging: false,
    });
  }

  private firstPos(p: ActivePointer): Vec2 {
    return { x: p.startX, y: p.startY };
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const pos = this.localPos(e);

    this.lastKnown.set(e.pointerId, pos);

    if (this.pointers.size === 2 && this.pinch) {
      const other = [...this.pointers.keys()].find((id) => id !== e.pointerId);
      const otherPos = other !== undefined ? this.lastKnown.get(other) ?? this.firstPos(this.pointers.get(other)!) : null;
      if (otherPos) {
        const dist = distance(pos, otherPos);
        this.cb.onZoomChange(pinchZoom(this.pinch.startDistance, dist, this.pinch.startZoom));
      }
      return;
    }

    if (p.isJoystick) {
      if (!p.dragging) {
        if (!isDrag(p.startX, p.startY, pos.x, pos.y)) return;
        p.dragging = true;
      }
      p.anchor = dragStickAnchor(p.anchor, pos);
      const v = stickVector(p.anchor, pos);
      this.cb.onMoveVector(v);
      this.cb.onStickVisual({ anchor: p.anchor, finger: pos });
    }
  }

  private lastKnown = new Map<number, Vec2>();

  private onPointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const pos = this.localPos(e);
    const elapsed = performance.now() - p.startAt;

    if (p.isJoystick) {
      if (!p.dragging && isTap(p.startX, p.startY, pos.x, pos.y, elapsed)) {
        this.cb.onTap(pos.x, pos.y);
      }
      this.cb.onMoveVector({ x: 0, y: 0 });
      this.cb.onStickVisual(null);
    }

    this.pointers.delete(e.pointerId);
    this.lastKnown.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;

    // 残った 1 本があればジョイスティックとして再開しない（仕様上、再度置き直す）。
  }

  private onWheel(e: WheelEvent): void {
    const cur = this.cb.getZoom();
    this.cb.onZoomChange(cur * wheelZoomDelta(e.deltaY));
  }

  private onKeyDown(e: KeyboardEvent): void {
    const dir = keyToDir(e.key);
    if (dir) {
      this.keyDirs.add(dir);
      this.keyVector = vectorFromKeys(this.keyDirs);
      return;
    }
    if (isActionKey(e.key)) {
      this.pendingAction = true;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const dir = keyToDir(e.key);
    if (dir) {
      this.keyDirs.delete(dir);
      this.keyVector = vectorFromKeys(this.keyDirs);
    }
  }

  /** Space/Enter が押された（1 フレーム限りのフラグ）。呼んだら消費する。 */
  pendingAction = false;

  consumeAction(): boolean {
    if (this.pendingAction) {
      this.pendingAction = false;
      return true;
    }
    return false;
  }
}
