// スパイク: 「Pigg Island 風の質感」で実際に動いて触れるか確かめる試作フィールド。
//
// ゲーム本体（src/game）・Canvas 描画（src/render）には一切つながっていない。
// DOM（画像 <img> ＋ transform）だけで動かす別実装。テスト用メニューからだけ開ける。
//
// 操作の手ざわりは本編と同じにしたいので、浮くスティックの計算（本編 src/input/pointer.ts）
// だけをそのまま再利用する。カメラは「プレイヤーを画面中心に固定し、世界を逆に動かす」方式
// （Canvas を使わないのでこれが一番簡単で滑らか）。
//
// 主人公の絵は ChatGPT 生成の正面立ち絵が 1 枚だけ用意できた（歩きコマはまだ無い）。
// 岩・木・草花は refs/image0〜3.png（ユーザー提供の参考シート）から切り出した新素材
// （scripts/slice-refimg.mjs → src/assets/refimg/）を使い、既存の Pigg 試作素材
// （ヤシ・岩・砂）と並べて質感・スケール感が合うか確かめる。

import { useEffect, useRef, useState } from 'react';

import { dragStickAnchor, isDrag, JOYSTICK_DRAG_RADIUS_PX, keyToDir, stickVector, vectorFromKeys } from '@/input/pointer';
import type { KeyDir } from '@/input/pointer';
import { groundKindAt, paintPiggGroundAsync } from '@/render/piggGround';
import type { GroundKind } from '@/render/piggGround';

import piggChest from '@/assets/pigg/pigg_chest.png?url';
import piggPalm from '@/assets/pigg/pigg_palm.png?url';
import piggPlayerDown0 from '@/assets/pigg/pigg_player_down0.png?url';
import piggRock from '@/assets/pigg/pigg_rock.png?url';
import furnBenchLog from '@/assets/refimg/furn_bench_log.png?url';
import furnCrate from '@/assets/refimg/furn_crate.png?url';
import furnFlowerBed from '@/assets/refimg/furn_flower_bed.png?url';
import furnSignpost from '@/assets/refimg/furn_signpost.png?url';
import furnTorch from '@/assets/refimg/furn_torch.png?url';
import oreCopper from '@/assets/refimg/ore_copper.png?url';
import plant01 from '@/assets/refimg/plant_01.png?url';
import plant05 from '@/assets/refimg/plant_05.png?url';
import plant12 from '@/assets/refimg/plant_12.png?url';
import plant18 from '@/assets/refimg/plant_18.png?url';
import plant22 from '@/assets/refimg/plant_22.png?url';
import plant29 from '@/assets/refimg/plant_29.png?url';
import plant33 from '@/assets/refimg/plant_33.png?url';
import plant40 from '@/assets/refimg/plant_40.png?url';
import plant45 from '@/assets/refimg/plant_45.png?url';
import plant47 from '@/assets/refimg/plant_47.png?url';
import plant51 from '@/assets/refimg/plant_51.png?url';
import plant53 from '@/assets/refimg/plant_53.png?url';
import rockFlatGround from '@/assets/refimg/rock_flat_ground.png?url';
import rockMossy from '@/assets/refimg/rock_mossy.png?url';
import rockPebble from '@/assets/refimg/rock_pebble.png?url';
import refRockMedium from '@/assets/refimg/rock_medium.png?url';
import refRockSmall from '@/assets/refimg/rock_small.png?url';
import treeMedium from '@/assets/refimg/tree_medium.png?url';
import treeSmall from '@/assets/refimg/tree_small.png?url';
import treeTopDown from '@/assets/refimg/tree_top_down.png?url';

// 世界の大きさ（世界 px。1 世界 px ≒ 画面 1px 相当で作る）。
const WORLD_W = 2600;
const WORLD_H = 2000;
const SPEED = 260; // 世界 px / 秒（本編の 6 マス/秒 ×TILE 相当のスケール感に合わせた値）
const PLAYER_RADIUS = 22; // 当たり判定（見た目の主人公絵とだいたい合わせた半径）

// 主人公の立ち絵の表示サイズ（元画像は 465x557 の縦長）。
const PLAYER_W = 56;
const PLAYER_H = Math.round(PLAYER_W * (557 / 465));

function hash(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** 0〜1 の乱数値から配列の要素を選ぶ（呼び出し側の配列は必ず 1 個以上ある前提）。 */
function pick<T>(arr: readonly T[], t: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] as T;
}

/**
 * すでに置いた「当たり判定つき」の物体（幹・岩など）。placeOnGround が重ならないように
 * 参照する。木や岩は見た目も大きいので、地面の種別が合っているだけでは、たまたま同じ場所に
 * 何本も生えて不自然に重なることがある（実際に発生していた不具合）。
 */
const placedSolids: { x: number; y: number; r: number }[] = [];

/**
 * 指定した地面種別（砂/草/水）の上、かつ既存の物体と重ならない座標になるまで振り直す
 * （最大 16 回）。焼き込んだ地面（piggGround.ts）と同じ判定式を使うので、必ず見た目と一致する。
 * 16 回試しても見つからなければ最後の候補で諦める（無限ループにしない＝最終段は必ず成功する）。
 * solidRadius > 0 のときだけ placedSolids に積んで、以後の配置が避けるようにする。
 */
function placeOnGround(
  seed: number,
  kinds: readonly GroundKind[],
  marginX = 50,
  marginY = 50,
  solidRadius = 0,
): { x: number; y: number } {
  let candidate = { x: WORLD_W / 2, y: WORLD_H / 2 };
  for (let attempt = 0; attempt < 16; attempt++) {
    const hx = hash(seed * 7.13 + attempt * 3.71 + 1);
    const hy = hash(seed * 5.37 + attempt * 2.19 + 2);
    candidate = {
      x: marginX + hx * (WORLD_W - marginX * 2),
      y: marginY + hy * (WORLD_H - marginY * 2),
    };
    if (!kinds.includes(groundKindAt(candidate.x, candidate.y, WORLD_W, WORLD_H))) continue;
    const overlaps = placedSolids.some((s) => {
      const dx = candidate.x - s.x;
      const dy = candidate.y - s.y;
      const min = s.r + solidRadius;
      return dx * dx + dy * dy < min * min;
    });
    if (!overlaps) break;
  }
  if (solidRadius > 0) placedSolids.push({ x: candidate.x, y: candidate.y, r: solidRadius });
  return candidate;
}

interface Obj {
  x: number;
  y: number;
  scale: number;
  solidRadius: number; // 0 なら当たらない（見た目だけ）
  sprite: string;
  baseWidth: number; // 表示基準幅（scale 倍する前の px）
}

// 陸（砂・草）に置いてよい物体の地面種別。水辺の池には立たせない。
const LAND_KINDS: readonly GroundKind[] = ['sand', 'grass'];
const WATER_KINDS: readonly GroundKind[] = ['water'];

// 岩は既存の Pigg 岩に加え、参考シートから切り出した岩・鉱石を混ぜて単調さを消す。
const ROCK_SPRITES = [piggRock, refRockMedium, refRockSmall, rockPebble, rockMossy, rockFlatGround, oreCopper];

// 見た目の絵は当たり判定の円よりだいぶ大きい（葉が広がる等）ので、重なり判定には
// 見た目の半分くらいの余裕（PLACE_PAD）を足す。当たり判定そのもの（solidRadius）は
// 操作性のために小さく保ちたいので、両者を分けている。
const PLACE_PAD = 34;

function buildPalms(): Obj[] {
  // このモジュール読み込み中は複数回マウントされうる（例: テスト用フィールドを閉じて再度開く）。
  // placedSolids はモジュール直下の共有配列なので、置く物体の先頭（このあと rocks/trees と続く）
  // で必ずリセットする。そうしないと前回ぶんが残って、2 回目以降だけ配置がおかしくなる。
  placedSolids.length = 0;
  return Array.from({ length: 22 }, (_, i) => {
    const { x, y } = placeOnGround(i * 11 + 900, LAND_KINDS, 50, 50, 26 + PLACE_PAD);
    return {
      x,
      y,
      scale: 0.75 + hash(i * 2 + 5) * 0.55,
      solidRadius: 26,
      sprite: piggPalm,
      baseWidth: 170,
    };
  });
}

function buildRocks(): Obj[] {
  return Array.from({ length: 20 }, (_, i) => {
    const { x, y } = placeOnGround(i * 13 + 1100, LAND_KINDS, 50, 50, 20 + PLACE_PAD * 0.6);
    return {
      x,
      y,
      scale: 0.5 + hash(i * 3 + 105) * 0.6,
      solidRadius: 20,
      sprite: pick(ROCK_SPRITES, hash(i * 3 + 102)),
      baseWidth: 70,
    };
  });
}

// 新しい木（参考シート由来）。斜め見下ろし視点のゲームなので、正面/横向きの木は
// 中サイズ・小サイズだけを使い、上から見た木（tree_top_down）はアクセントとして少数混ぜる。
const TREE_SPRITES = [treeMedium, treeMedium, treeSmall, treeTopDown];

function buildTrees(): Obj[] {
  return Array.from({ length: 16 }, (_, i) => {
    const { x, y } = placeOnGround(i * 17 + 1300, LAND_KINDS, 50, 50, 24 + PLACE_PAD);
    return {
      x,
      y,
      scale: 0.75 + hash(i * 5 + 205) * 0.45,
      solidRadius: 24,
      sprite: pick(TREE_SPRITES, hash(i * 5 + 207)),
      baseWidth: 150,
    };
  });
}

// 草花はただの地面の飾り（当たり判定なし）。参考シートの色違いを多く混ぜて賑やかさを出す。
// plant_10/16/54/59 は市松模様の抜き残りがわずかに出るため、意図して外している。
const PLANT_SPRITES_LAND = [plant01, plant05, plant12, plant18, plant22, plant29, plant33, plant40];

function buildPlants(): Obj[] {
  return Array.from({ length: 55 }, (_, i) => {
    const { x, y } = placeOnGround(i * 19 + 1700, LAND_KINDS, 30, 30);
    return {
      x,
      y,
      scale: 0.55 + hash(i * 7 + 305) * 0.55,
      solidRadius: 0,
      sprite: pick(PLANT_SPRITES_LAND, hash(i * 7 + 309)),
      baseWidth: 46,
    };
  });
}

// 睡蓮っぽい草花は池（水）の上だけに置く。地面の焼き込み（piggGround.ts）と
// 同じ groundKindAt() で判定するので、常に水面の上に乗る。
const PLANT_SPRITES_WATER = [plant45, plant47, plant51, plant53];

function buildWaterPlants(): Obj[] {
  return Array.from({ length: 12 }, (_, i) => {
    const { x, y } = placeOnGround(i * 23 + 2100, WATER_KINDS, 20, 20);
    return {
      x,
      y,
      scale: 0.6 + hash(i * 9 + 405) * 0.5,
      solidRadius: 0,
      sprite: pick(PLANT_SPRITES_WATER, hash(i * 9 + 409)),
      baseWidth: 52,
    };
  });
}

// 家具は完全な飾り（当たり判定なし）。ゲームロジックには一切繋がらない。
const FURNITURE_SPRITES: { sprite: string; baseWidth: number }[] = [
  { sprite: furnCrate, baseWidth: 46 },
  { sprite: furnBenchLog, baseWidth: 64 },
  { sprite: furnTorch, baseWidth: 30 },
  { sprite: furnSignpost, baseWidth: 34 },
  { sprite: furnFlowerBed, baseWidth: 52 },
];

function buildFurniture(): Obj[] {
  return Array.from({ length: 12 }, (_, i) => {
    const { x, y } = placeOnGround(i * 29 + 2500, LAND_KINDS);
    const f = FURNITURE_SPRITES[i % FURNITURE_SPRITES.length]!;
    return {
      x,
      y,
      scale: 0.8 + hash(i * 11 + 505) * 0.3,
      solidRadius: 0,
      sprite: f.sprite,
      baseWidth: f.baseWidth,
    };
  });
}

export function PiggTestField({ onClose }: { onClose: () => void }) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const palmsRef = useRef<Obj[]>(buildPalms());
  const rocksRef = useRef<Obj[]>(buildRocks());
  const treesRef = useRef<Obj[]>(buildTrees());
  const plantsRef = useRef<Obj[]>(buildPlants());
  const waterPlantsRef = useRef<Obj[]>(buildWaterPlants());
  const furnitureRef = useRef<Obj[]>(buildFurniture());
  // 宝箱は飾り 1 個だけ（当たり判定なし）。ワールド中央寄りの分かりやすい位置に置く。
  const chestRef = useRef<{ x: number; y: number }>({ x: WORLD_W / 2 + 160, y: WORLD_H / 2 + 40 });
  // 地面は 1 枚の Canvas へ事前に焼く（piggGround.ts）。焼き終わるまではローディングを出す
  // （CLAUDE.md: 「無言で固まる 1 秒は許容しない」）。
  const [groundReady, setGroundReady] = useState(false);

  useEffect(() => {
    const canvas = groundCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    paintPiggGroundAsync(canvas).then(() => {
      if (!cancelled) setGroundReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

    // --- 当たり判定（主人公を円として、木の幹・岩と単純な円 vs 円） ---
    const solids = [...palmsRef.current, ...rocksRef.current, ...treesRef.current].filter((o) => o.solidRadius > 0);
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
      // 歩きコマがまだ1枚しか無いので、動いている間だけ軽くバウンドさせて
      // 「歩いている感」だけ出す（本格的な歩行アニメは別途）。
      const bounce = moving ? Math.abs(Math.sin(t / 90)) * 4 : 0;
      player.style.transform =
        `translate(${pos.x - camX - PLAYER_W / 2}px, ${pos.y - camY - PLAYER_H * 0.94 - bounce}px)`;
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
        {/* 地面は piggGround.ts が焼いた 1 枚の Canvas（砂・草・水をなめらかにブレンド）。 */}
        <canvas ref={groundCanvasRef} className="pigg-field-ground" width={WORLD_W} height={WORLD_H} />
        {waterPlantsRef.current.map((p, i) => (
          <img
            key={`waterplant-${i}`}
            src={p.sprite}
            className="pigg-obj pigg-obj-flat"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
        {plantsRef.current.map((p, i) => (
          <img
            key={`plant-${i}`}
            src={p.sprite}
            className="pigg-obj pigg-obj-flat"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
        {furnitureRef.current.map((f, i) => (
          <img
            key={`furn-${i}`}
            src={f.sprite}
            className="pigg-obj"
            style={{ left: f.x, top: f.y, width: `${f.scale * f.baseWidth}px` }}
            alt=""
          />
        ))}
        {rocksRef.current.map((r, i) => (
          <img
            key={`rock-${i}`}
            src={r.sprite}
            className="pigg-obj"
            style={{ left: r.x, top: r.y, width: `${r.scale * r.baseWidth}px` }}
            alt=""
          />
        ))}
        <img
          src={piggChest}
          className="pigg-obj"
          style={{ left: chestRef.current.x, top: chestRef.current.y, width: '64px' }}
          alt=""
        />
        {treesRef.current.map((tr, i) => (
          <img
            key={`tree-${i}`}
            src={tr.sprite}
            className="pigg-obj"
            style={{ left: tr.x, top: tr.y, width: `${tr.scale * tr.baseWidth}px` }}
            alt=""
          />
        ))}
        {palmsRef.current.map((p, i) => (
          <img
            key={`palm-${i}`}
            src={piggPalm}
            className="pigg-obj"
            style={{ left: p.x, top: p.y, width: `${p.scale * p.baseWidth}px` }}
            alt=""
          />
        ))}
      </div>

      {/* 主人公（ChatGPT 生成の正面立ち絵。影は絵に内蔵済みなので別で描かない）。 */}
      <div className="pigg-player" ref={playerRef} style={{ width: PLAYER_W, height: PLAYER_H }}>
        <img src={piggPlayerDown0} className="pigg-player-sprite" alt="" />
      </div>

      <div className="pigg-joystick" ref={stickRef} style={{ display: 'none' }}>
        <div className="pigg-joystick-knob" />
      </div>

      <div className="pigg-field-badge">
        絵柄テスト（試作・スパイク）
        <span>ドラッグ / 矢印キーで動けます。歩きコマは正面立ち絵1枚のみ。ゲーム本体とは無関係</span>
      </div>
      <button className="pigg-field-close" onClick={onClose}>
        もどる
      </button>

      {/* 地面の Canvas を焼いている間だけ出す（無言で固まらせない）。 */}
      {!groundReady && (
        <div className="pigg-loading">
          <span>島を準備中…</span>
        </div>
      )}
    </div>
  );
}
