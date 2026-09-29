// 地面の事前描画（プリレンダー）レイヤー。
//
// マップ全体の「地面」だけを 1 枚のオフスクリーン Canvas に焼いておき、毎フレームは
// そこからカメラの可視範囲をスケールして貼るだけにする（renderer.ts 側）。
// 色の計算は terrainCore.ts（純粋関数）。重いので Web Worker（terrainWorker.ts）で走らせ、
// Worker が使えない環境ではメインスレッドで、時間予算を区切りながら塗る（画面を固めない）。

import type { World } from '@/game/types';
import { buildTerrainState, paintRows, TERRAIN_PX } from './terrainCore';

export interface PaintedTerrain {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tilePx: number;
  width: number; // タイル数
  height: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintInWorker(world: World): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ rgba: ArrayBuffer }>) => {
      resolve(new Uint8ClampedArray(e.data.rgba));
      worker.terminate();
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ width: world.width, height: world.height, ground: world.ground as string[] });
  });
}

/** Worker が使えないときの代替。1 回 12ms を目安に区切って、間に描画ループへ譲る。 */
function paintOnMainThread(world: World): Promise<Uint8ClampedArray> {
  const canvasW = world.width * TERRAIN_PX;
  const canvasH = world.height * TERRAIN_PX;
  const st = buildTerrainState(world.width, world.height, world.ground as string[]);
  const data = new Uint8ClampedArray(canvasW * canvasH * 4);
  return new Promise((resolve) => {
    let y = 0;
    const step = () => {
      const t0 = performance.now();
      while (y < canvasH && performance.now() - t0 < 12) {
        const to = Math.min(canvasH, y + 8);
        paintRows(st, y, to, data);
        y = to;
      }
      if (y < canvasH) setTimeout(step, 0);
      else resolve(data);
    };
    step();
  });
}

export function paintTerrainAsync(world: World): Promise<PaintedTerrain & { paintMs: number }> {
  const canvasW = world.width * TERRAIN_PX;
  const canvasH = world.height * TERRAIN_PX;
  const canvas = makeCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  const result = { canvas, tilePx: TERRAIN_PX, width: world.width, height: world.height, paintMs: 0 };
  if (!ctx) return Promise.resolve(result);

  const t0 = performance.now();
  const compute = typeof Worker !== 'undefined' ? paintInWorker(world).catch(() => paintOnMainThread(world)) : paintOnMainThread(world);
  return compute.then((rgba) => {
    ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, canvasW, canvasH), 0, 0);
    result.paintMs = performance.now() - t0;
    return result;
  });
}
