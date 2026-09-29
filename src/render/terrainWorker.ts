// 地面のピクセル計算を Web Worker で行う。メインスレッドを止めず、描画ループが回り続ける。
// 入力: { width, height, ground }（タイル数と地面種別の配列）
// 出力: { rgba }（幅 = width*TERRAIN_PX の RGBA。転送）

import { buildTerrainState, paintRows, TERRAIN_PX } from './terrainCore';

interface Req {
  width: number;
  height: number;
  ground: string[];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { width, height, ground } = e.data;
  const st = buildTerrainState(width, height, ground);
  const canvasW = width * TERRAIN_PX;
  const canvasH = height * TERRAIN_PX;
  const data = new Uint8ClampedArray(canvasW * canvasH * 4);
  paintRows(st, 0, canvasH, data);
  (self as unknown as Worker).postMessage({ rgba: data.buffer }, [data.buffer]);
};
