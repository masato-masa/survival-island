// スプライトを一覧できる開発用プレビュー。`sprites.html` から読み込まれる。
// 本番ビルドには含めない（index.html だけがビルド対象）。

import { getSprite, loadArt, spriteNames, type SpriteName } from './sprites';

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

const ZOOM = 3;

function renderCell(name: SpriteName): HTMLElement {
  const baked = getSprite(name);

  const cell = document.createElement('div');
  cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px';

  const box = document.createElement('div');
  box.style.cssText = `min-width:${32 * ZOOM}px;display:flex;align-items:flex-end;justify-content:center;background:repeating-conic-gradient(#e9f3dc 0% 25%, #f4f9ec 0% 50%) 50% / 12px 12px`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(baked.w * ZOOM * 2);
  canvas.height = Math.round(baked.h * ZOOM * 2);
  canvas.style.width = `${baked.w * ZOOM}px`;
  canvas.style.height = `${baked.h * ZOOM}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(baked.canvas as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  }
  box.appendChild(canvas);
  cell.appendChild(box);

  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = 'font:11px monospace;color:#3d2b2e';
  cell.appendChild(label);
  return cell;
}

async function main() {
  await loadArt();
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px';
  root!.appendChild(list);
  for (const name of spriteNames()) list.appendChild(renderCell(name));
}

void main();
