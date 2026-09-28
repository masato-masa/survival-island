// スプライトを一覧できる開発用プレビュー。`sprites.html` から読み込まれる。
// 本番ビルドには含めない（index.html だけがビルド対象）。

import { getSprite, spriteNames } from './sprites';

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

const ZOOM = 3;

const grid = document.createElement('div');
grid.style.display = 'grid';
grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
grid.style.gap = '12px';
grid.style.padding = '16px';
root.appendChild(grid);

for (const name of spriteNames()) {
  const baked = getSprite(name);

  const cell = document.createElement('div');
  cell.style.display = 'flex';
  cell.style.flexDirection = 'column';
  cell.style.alignItems = 'center';
  cell.style.gap = '4px';
  cell.style.padding = '8px';
  cell.style.background = '#fff';
  cell.style.borderRadius = '8px';
  cell.style.border = '1px solid #e5e2d8';

  const box = document.createElement('div');
  box.style.width = `${32 * ZOOM}px`;
  box.style.height = `${baked.h * ZOOM}px`;
  box.style.display = 'flex';
  box.style.alignItems = 'flex-end';
  box.style.justifyContent = 'center';
  box.style.background =
    'repeating-conic-gradient(#f0efe6 0% 25%, #f6f5ef 0% 50%) 50% / 12px 12px';

  const canvas = document.createElement('canvas');
  canvas.width = baked.w;
  canvas.height = baked.h;
  canvas.style.width = `${baked.w * ZOOM}px`;
  canvas.style.height = `${baked.h * ZOOM}px`;
  (canvas.style as CSSStyleDeclaration).imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked.canvas as CanvasImageSource, 0, 0);
  }
  box.appendChild(canvas);

  const label = document.createElement('div');
  label.textContent = name;
  label.style.fontSize = '11px';
  label.style.fontFamily = 'monospace';
  label.style.color = '#3d2b2e';
  label.style.textAlign = 'center';
  label.style.wordBreak = 'break-all';

  cell.appendChild(box);
  cell.appendChild(label);
  grid.appendChild(cell);
}
