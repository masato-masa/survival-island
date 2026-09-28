// スパイク: 「Pigg Island 風の質感」で実際に動いて触れるか確かめる試作フィールド。
//
// ゲーム本体（src/game）・Canvas 描画（src/render）には一切つながっていない。
// DOM（画像 <img> ＋ transform）だけで動かす別実装。テスト用メニューからだけ開ける。
//
// 操作の手ざわりは本編と同じにしたいので、浮くスティックの計算（本編 src/input/pointer.ts）
// だけをそのまま再利用する。カメラは「プレイヤーを画面中心に固定し、世界を逆に動かす」方式
// （Canvas を使わないのでこれが一番簡単で滑らか）。
//
// 主人公の絵はまだ無い（Pigg 風はヤシ・岩・砂までしか作っていない）ので、
// 動きだけ先に確かめられるよう、仮の目印（丸い影＋帽子色の円）で代用する。

import { useEffect, useRef } from 'react';

import { dragStickAnchor, isDrag, JOYSTICK_DRAG_RADIUS_PX, keyToDir, stickVector, vectorFromKeys } from '@/input/pointer';
import type { KeyDir } from '@/input/pointer';

import piggPalm from '@/assets/pigg/pigg_palm.png?url';
import piggRock from '@/assets/pigg/pigg_rock.png?url';
import piggSand from '@/assets/pigg/pigg_sand.png?url';

// 世界の大きさ（世界 px。1 世界 px ≒ 画面 1px 相当で作る）。
const WORLD_W = 2600;
const WORLD_H = 2000;
const SPEED = 260; // 世界 px / 秒（本編の 6 マス/秒 ×TILE 相当のスケール感に合わせた値）
const PLAYER_RADIUS = 22; // 当たり判定（仮の目印の半径）

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Obj {
  x: number;
  y: number;
  scale: number;
  solidRadius: number; // 0 なら当たらない（見た目だけ）
}

function buildPalms(): Obj[] {
  return Array.from({ length: 14 }, (_, i) => ({
    x: 80 + hash(i * 2) * (WORLD_W - 160),
    y: 60 + hash(i * 2 + 1) * 260,
    scale: 0.8 + hash(i * 2 + 5) * 0.5,
    solidRadius: 26,
  }));
}

function buildRocks(): Obj[] {
  return Array.from({ length: 10 }, (_, i) => ({
    x: 60 + hash(i * 3 + 100) * (WORLD_W - 120),
    y: 340 + hash(i * 3 + 101) * (WORLD_H - 400),
    scale: 0.5 + hash(i * 3 + 105) * 0.5,
    solidRadius: 20,
  }));
}

export function PiggTestField({ onClose }: { onClose: () => void }) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const palmsRef = useRef<Obj[]>(buildPalms());
  const rocksRef = useRef<Obj[]>(buildRocks());

  useEffect(() => {
    const root = rootRef.current;
    const world = worldRef.current;
    const player = playerRef.current;
    const stick = stickRef.current;
    if (!root || !world || !player || !stick) return;

    const pos = { x: WORLD_W / 2, y: WORLD_H / 2 };
    let moveVec = { x: 0, y: 0 };
    let moving = false;

    // --- 浮くスティック（本編と同じ計算式） ---
    let dragId: number | null = null;
    let anchor = { x: 0, y: 0 };
    let dragStart = { x: 0, y: 0 };
    let dragStartAt = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (dragId !== null) return;
      dragId = e.pointerId;
      root.setPointerCapture(e.pointerId);
      anchor = { x: e.clientX, y: e.clientY };
      dragStart = { x: e.clientX, y: e.clientY };
      dragStartAt = performance.now();
      stick.style.display = 'block';
      stick.style.left = `${anchor.x}px`;
      stick.style.top = `${anchor.y}px`;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      const finger = { x: e.clientX, y: e.clientY };
      anchor = dragStickAnchor(anchor, finger);
      const v = stickVector(anchor, finger);
      moveVec = v;
      stick.style.left = `${anchor.x}px`;
      stick.style.top = `${anchor.y}px`;
      const knob = stick.firstElementChild as HTMLDivElement;
      const dx = Math.max(-JOYSTICK_DRAG_RADIUS_PX, Math.min(JOYSTICK_DRAG_RADIUS_PX, finger.x - anchor.x));
      const dy = Math.max(-JOYSTICK_DRAG_RADIUS_PX, Math.min(JOYSTICK_DRAG_RADIUS_PX, finger.y - anchor.y));
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const endDrag = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      dragId = null;
      moveVec = { x: 0, y: 0 };
      stick.style.display = 'none';
      void isDrag; // 本編はタップ動作もここで判定するが、このスパイクは移動だけなので未使用
      void dragStart;
      void dragStartAt;
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.style.touchAction = 'none';

    // --- キーボード（PC 確認用） ---
    const keyDirs = new Set<KeyDir>();
    const onKeyDown = (e: KeyboardEvent) => {
      const d = keyToDir(e.key);
      if (d) keyDirs.add(d);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const d = keyToDir(e.key);
      if (d) keyDirs.delete(d);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // --- 当たり判定（仮の目印を円として、木の幹・岩と単純な円 vs 円） ---
    const solids = [...palmsRef.current, ...rocksRef.current].filter((o) => o.solidRadius > 0);
    const tryMove = (nx: number, ny: number) => {
      for (const s of solids) {
        const dx = nx - s.x;
        const dy = ny - s.y;
        const min = PLAYER_RADIUS + s.solidRadius;
        if (dx * dx + dy * dy < min * min) return false;
      }
      return true;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;

      const kv = vectorFromKeys(keyDirs);
      const vx = moveVec.x !== 0 || moveVec.y !== 0 ? moveVec.x : kv.x;
      const vy = moveVec.x !== 0 || moveVec.y !== 0 ? moveVec.y : kv.y;
      moving = vx !== 0 || vy !== 0;

      if (moving) {
        const nx = Math.max(20, Math.min(WORLD_W - 20, pos.x + vx * SPEED * dt));
        const ny = Math.max(20, Math.min(WORLD_H - 20, pos.y + vy * SPEED * dt));
        // 軸ごとに動かす（壁に沿って滑る。本編の tryMove と同じ考え方）
        if (tryMove(nx, pos.y)) pos.x = nx;
        if (tryMove(pos.x, ny)) pos.y = ny;
      }

      const vw = root.clientWidth;
      const vh = root.clientHeight;
      const camX = Math.max(0, Math.min(WORLD_W - vw, pos.x - vw / 2));
      const camY = Math.max(0, Math.min(WORLD_H - vh, pos.y - vh / 2));
      world.style.transform = `translate(${-camX}px, ${-camY}px)`;
      player.style.transform = `translate(${pos.x - camX - 20}px, ${pos.y - camY - 34}px) ${moving ? 'scale(1.05)' : ''}`;
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', endDrag);
      root.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="pigg-field" ref={rootRef}>
      <div className="pigg-world" ref={worldRef} style={{ width: WORLD_W, height: WORLD_H }}>
        <div
          className="pigg-field-ground"
          style={{ backgroundImage: `url(${piggSand})`, width: WORLD_W, height: WORLD_H }}
        />
        {rocksRef.current.map((r, i) => (
          <img
            key={`rock-${i}`}
            src={piggRock}
            className="pigg-obj"
            style={{ left: r.x, top: r.y, width: `${r.scale * 70}px` }}
            alt=""
          />
        ))}
        {palmsRef.current.map((p, i) => (
          <img
            key={`palm-${i}`}
            src={piggPalm}
            className="pigg-obj"
            style={{ left: p.x, top: p.y, width: `${p.scale * 170}px` }}
            alt=""
          />
        ))}
      </div>

      {/* 仮の主人公。絵はまだ無いので、影＋色の丸で代用（動きの確認が目的）。 */}
      <div className="pigg-player" ref={playerRef}>
        <div className="pigg-player-shadow" />
        <div className="pigg-player-mark" />
      </div>

      <div className="pigg-joystick" ref={stickRef} style={{ display: 'none' }}>
        <div className="pigg-joystick-knob" />
      </div>

      <div className="pigg-field-badge">
        絵柄テスト（試作・スパイク）
        <span>ドラッグ /矢印キーで動けます。主人公の絵は仮置き。ゲーム本体とは無関係</span>
      </div>
      <button className="pigg-field-close" onClick={onClose}>
        もどる
      </button>
    </div>
  );
}
