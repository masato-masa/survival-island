// スプライトを一覧できる開発用プレビュー。`sprites.html` から読み込まれる。
// 本番ビルドには含めない（index.html だけがビルド対象）。
//
// Kenney アトラスの読み込みを待ってから、Kenney 版・仮素材（コード）版を
// 並べて表示する（差し替えマッピングの見直し用）。

import { getSprite, loadArt, setArtMode, spriteNames, type SpriteName } from './sprites';

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

const ZOOM = 3;

function renderCell(name: SpriteName): HTMLElement {
  const baked = getSprite(name);

  const cell = document.createElement('div');
  cell.style.display = 'flex';
  cell.style.flexDirection = 'column';
  cell.style.alignItems = 'center';
  cell.style.gap = '4px';
  cell.style.padding = '4px';

  const box = document.createElement('div');
  box.style.width = `${32 * ZOOM}px`;
  box.style.height = `${baked.h * ZOOM}px`;
  box.style.display = 'flex';
  box.style.alignItems = 'flex-end';
  box.style.justifyContent = 'center';
  box.style.background = 'repeating-conic-gradient(#f0efe6 0% 25%, #f6f5ef 0% 50%) 50% / 12px 12px';

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

  cell.appendChild(box);
  return cell;
}

function renderRow(name: SpriteName): HTMLElement {
  const row = document.createElement('div');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '120px 1fr 1fr';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.padding = '4px 8px';
  row.style.borderBottom = '1px solid #e5e2d8';

  const label = document.createElement('div');
  label.textContent = name;
  label.style.fontSize = '11px';
  label.style.fontFamily = 'monospace';
  label.style.color = '#3d2b2e';
  label.style.wordBreak = 'break-all';
  row.appendChild(label);

  setArtMode('kenney');
  row.appendChild(renderCell(name));

  setArtMode('code');
  row.appendChild(renderCell(name));

  return row;
}

async function main() {
  await loadArt();

  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = '120px 1fr 1fr';
  header.style.gap = '8px';
  header.style.padding = '8px';
  header.style.fontFamily = 'sans-serif';
  header.style.fontWeight = 'bold';
  header.style.fontSize = '12px';
  header.style.color = '#3d2b2e';
  header.innerHTML = '<div>name</div><div>Kenney</div><div>仮素材（コード）</div>';
  root!.appendChild(header);

  const list = document.createElement('div');
  root!.appendChild(list);

  for (const name of spriteNames()) {
    list.appendChild(renderRow(name));
  }

  // プレビュー終了後は既定（kenney）に戻す。
  setArtMode('kenney');
}

main();
