// マップ全体を描く Canvas。React はこのコンポーネントの外側の大きさだけを決め、
// 中身（カメラ追従・入力・描画）は 1 本の requestAnimationFrame ループが持つ。
// ゲームロジックへは store 経由でのみアクセスする（ここに判定ロジックを書かない）。

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';

import { store } from '@/game/store';
import type { Fail, GameEvent, Slot, StationKind, Target } from '@/game/types';

import {
  baseScaleFor,
  clampZoom,
  createCamera,
  screenToWorld,
  stepCamera,
  TILE,
  type CameraState,
  type Viewport,
} from './camera';
import { draw, effects, type RenderState, type Vec2 } from './renderer';
import { PointerController } from '@/input/pointer';

export interface WorldViewProps {
  decorate: boolean;
  onSignTap: (plotId: string) => void;
  onSlotTap: (slotId: string) => void;
  onStationTap: (kind: StationKind) => void;
  paused: boolean;
}

const MAX_DT_MS = 50;

export function WorldView(props: WorldViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 毎フレーム参照する最新の props（rAF ループを作り直したくないので ref に流す）。
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const camera: CameraState = createCamera();
    const world = store.world;
    camera.x = (world.start.x + 0.5) * TILE;
    camera.y = (world.start.y + 0.5) * TILE;

    let viewport: Viewport = { widthCssPx: 0, heightCssPx: 0, baseScale: 1 };
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      dpr = window.devicePixelRatio || 1;
      viewport = { widthCssPx: w, heightCssPx: h, baseScale: baseScaleFor(w, h) };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // --- 入力状態 ---
    let moveVector: Vec2 = { x: 0, y: 0 };
    let stickVisual: { anchor: Vec2; finger: Vec2 } | null = null;
    let zoom = 1;
    let queuedTap: { screenX: number; screenY: number } | null = null;

    const findSlotAt = (tx: number, ty: number) =>
      store.world.slots.find((s: Slot) => s.x === Math.floor(tx) && s.y === Math.floor(ty)) ?? null;

    const handleTapAt = (screenX: number, screenY: number) => {
      const decorate = propsRef.current.decorate;
      if (decorate) {
        const w = screenToWorld(screenX, screenY, camera, viewport);
        const slot = findSlotAt(w.x / TILE, w.y / TILE);
        if (slot) propsRef.current.onSlotTap(slot.id);
        return;
      }
      const target = store.target();
      if (!target) return;
      if (target.kind === 'sign') {
        propsRef.current.onSignTap(target.plot.id);
        return;
      }
      if (target.kind === 'station') {
        propsRef.current.onStationTap(target.station.kind);
        return;
      }
      if (store.cooldownUntil() > store.now()) {
        // クールダウン中：1 件だけキューに積んで、明けたら自動で撃つ（連打のリズムを崩さない）。
        queuedTap = { screenX, screenY };
        return;
      }
      store.actOnTarget();
    };

    const pointerCtl = new PointerController(canvas, {
      onMoveVector: (v) => {
        moveVector = v;
      },
      onTap: (x, y) => handleTapAt(x, y),
      onZoomChange: (z) => {
        zoom = clampZoom(z);
      },
      onStickVisual: (v) => {
        stickVisual = v;
      },
      getZoom: () => zoom,
    });

    const unsubEvents = store.onEvents((events: GameEvent[]) => {
      effects.pushEvents(events, store.now());
    });

    let raf = 0;
    let lastT = performance.now();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dtMs = Math.min(MAX_DT_MS, t - lastT);
      lastT = t;
      const dtSec = dtMs / 1000;
      const now = store.now();

      const paused = propsRef.current.paused;

      if (!paused) {
        // キューされたタップ：クールダウンが明けたら発火
        if (queuedTap && store.cooldownUntil() <= now) {
          const q = queuedTap;
          queuedTap = null;
          const target = store.target();
          if (target && target.kind === 'station') propsRef.current.onStationTap(target.station.kind);
          else if (target && target.kind !== 'sign') store.actOnTarget();
          void q;
        }

        const kbVector = pointerCtl.getKeyboardVector();
        const dx = moveVector.x !== 0 || moveVector.y !== 0 ? moveVector.x : kbVector.x;
        const dy = moveVector.x !== 0 || moveVector.y !== 0 ? moveVector.y : kbVector.y;
        if (dx !== 0 || dy !== 0) store.move(dx, dy, dtSec);

        if (pointerCtl.consumeAction()) {
          const target = store.target();
          if (target) {
            if (target.kind === 'sign') propsRef.current.onSignTap(target.plot.id);
            else if (target.kind === 'station') propsRef.current.onStationTap(target.station.kind);
            else if (store.cooldownUntil() <= now) store.actOnTarget();
          }
        }
      }

      const player = store.get().player;
      const moving = !paused && (moveVector.x !== 0 || moveVector.y !== 0 || pointerCtl.getKeyboardVector().x !== 0 || pointerCtl.getKeyboardVector().y !== 0);

      const newCam = stepCamera(
        camera,
        (player.x) * TILE,
        (player.y) * TILE,
        dtSec,
        world.width * TILE,
        world.height * TILE,
        viewport.widthCssPx,
        viewport.heightCssPx,
      );
      camera.x = newCam.x;
      camera.y = newCam.y;
      camera.zoom = zoom;

      effects.prune(now);

      const target: (Target & { blocked?: Fail }) | null = propsRef.current.decorate ? null : store.target();

      const state: RenderState = {
        world,
        save: store.get(),
        now,
        camera,
        viewport,
        decorate: propsRef.current.decorate,
        target,
        moving,
        dpr,
        stick: stickVisual,
      };
      draw(ctx, state);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      pointerCtl.dispose();
      unsubEvents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }} />
    </div>
  );
}
