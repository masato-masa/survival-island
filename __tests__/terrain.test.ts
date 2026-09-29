import { describe, expect, it } from 'vitest';

import { buildTerrainState, paintRows, TERRAIN_PX } from '@/render/terrainCore';

// 6×4 マス: 上 2 行が水、下 2 行が草。左下に砂。
const W = 6;
const H = 4;
const GROUND: string[] = [
  'water', 'water', 'water', 'water', 'water', 'water',
  'water', 'water', 'water', 'water', 'water', 'water',
  'sand', 'grass', 'grass', 'grass', 'grass', 'grass',
  'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
];

function render(): Uint8ClampedArray {
  const st = buildTerrainState(W, H, GROUND);
  const data = new Uint8ClampedArray(W * TERRAIN_PX * H * TERRAIN_PX * 4);
  paintRows(st, 0, H * TERRAIN_PX, data);
  return data;
}

function pixel(data: Uint8ClampedArray, tx: number, ty: number): [number, number, number, number] {
  const px = Math.floor((tx + 0.5) * TERRAIN_PX);
  const py = Math.floor((ty + 0.5) * TERRAIN_PX);
  const o = (py * W * TERRAIN_PX + px) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

describe('terrainCore', () => {
  const data = render();

  it('全画素が不透明', () => {
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('水は青系・草は緑系・砂は黄系に塗られる', () => {
    const [wr, , wb] = pixel(data, 2, 0);
    expect(wb).toBeGreaterThan(wr);
    const [gr, gg, gb] = pixel(data, 3, 3);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    const [sr, sg, sb] = pixel(data, 0, 2);
    expect(sr).toBeGreaterThan(sb + 40);
    expect(sg).toBeGreaterThan(sb + 30);
  });

  it('同じ入力からは同じ絵が出る（決定的）', () => {
    expect(Buffer.from(render())).toEqual(Buffer.from(data));
  });
});
