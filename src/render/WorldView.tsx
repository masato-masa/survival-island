// マップ全体を描く Canvas。React はこのコンポーネントの外側の大きさだけを決め、
// 中身（カメラ追従・入力・描画）は 1 本の requestAnimationFrame ループが持つ。
// ゲームロジックへは store 経由でのみアクセスする（ここに判定ロジックを書かない）。

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { store } from '@/game/store';
import { isBuildable, placementAt } from '@/game/rules';
import type { Fail, GameEvent, StationKind, Target } from '@/game/types';

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
import { paintTerrainAsync, type PaintedTerrain } from './terrain';
import { buildGroundDecor, type TreeInstance } from './forestTrees';
import { PointerController } from '@/input/pointer';

export interface WorldViewProps {
  decorate: boolean;
  onSignTap: (plotId: string) => void;
  onSlotTap: (x: number, y: number) => void;
  onStationTap: (kind: StationKind) => void;
  paused: boolean;
}

const MAX_DT_MS = 50;

// pigg 風の低いカメラ: プレイヤーを画面中央ではなくやや下に固定し、進行方向側を
// 広く見せる。PiggTestField（絵柄テスト）で詰めた値をそのまま本編にも適用する。
const CAMERA_ANCHOR_Y = 0.62;

export function WorldView(props: WorldViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [terrainReady, setTerrainReady] = useState(false);

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
    // セーブに残っている現在位置から始める（開始位置から動かしていると、読み込みのたびにカメラが滑って見える）。
    camera.x = store.get().player.x * TILE;
    camera.y = store.get().player.y * TILE;

    // 地面レイヤーを一度だけ焼く。焼いている間は draw() 側が terrain=null を見て
    // フォールバックのベタ塗りを出すので、画面が固まって見えることはない。
    let terrain: PaintedTerrain | null = null;
    let cancelled = false;
    const groundDecor: TreeInstance[] = buildGroundDecor(world);
    paintTerrainAsync(world).then((result) => {
      if (cancelled) return;
      terrain = result;
      setTerrainReady(true);
      // eslint-disable-next-line no-console
      console.info(`[terrain] prerender ${result.width}x${result.height} tiles in ${result.paintMs.toFixed(1)}ms`);
      (window as unknown as { __terrainStats?: unknown }).__terrainStats = {
        tiles: result.width * result.height,
        paintMs: result.paintMs,
      };
    });

    let viewport: Viewport = { widthCssPx: 0, heightCssPx: 0, baseScale: 1 };
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      dpr = window.devicePixelRatio || 1;
      viewport = { widthCssPx: w, heightCssPx: h, baseScale: baseScaleFor(w, h), anchorY: CAMERA_ANCHOR_Y };
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

    const handleTapAt = (screenX: number, screenY: number) => {
      const decorate = propsRef.current.decorate;
      if (decorate) {
        const w = screenToWorld(screenX, screenY, camera, viewport);
        const tx = Math.floor(w.x / TILE);
        const ty = Math.floor(w.y / TILE);
        if (isBuildable(store.world, store.get(), tx, ty) || placementAt(store.get(), tx, ty)) propsRef.current.onSlotTap(tx, ty);
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
        0.09, // halfLifeSec（既定値。以前と同じ追従の締まり具合）
        0.5, // anchorX（左右は今までどおり中央）
        CAMERA_ANCHOR_Y,
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
        terrain,
        groundDecor,
      };
      draw(ctx, state);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
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
      {!terrainReady ? (
        // 地面を焼いている間の「無言で固まる」を避けるための最小限のローディング表示。
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            color: '#fffbe6',
            fontSize: 14,
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            background: 'rgba(20,30,26,0.25)',
          }}
        >
          島をえがいています…
        </div>
      ) : null}
    </div>
  );
}
