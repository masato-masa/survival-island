// スプライトを一覧できる開発用プレビュー。`sprites.html` から読み込まれる。
// 本番ビルドには含めない（index.html だけがビルド対象）。

import { chopImpactTimes, drawAvatar, type AvatarDir, type AvatarPose, type AvatarTool } from './avatar';
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
  // ?avatar で主人公だけを大きく並べる（見た目の確認用）。?avatar=10 のように倍率も指定できる。
  const q = new URLSearchParams(location.search);
  if (q.has('avatar')) {
    root!.appendChild(avatarZoom(Number(q.get('avatar')) || 9));
    return;
  }
  await loadArt();
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px';
  root!.appendChild(list);
  for (const name of spriteNames()) list.appendChild(renderCell(name));
  root!.appendChild(avatarSheet());
}

// 主人公（avatar.ts）の姿勢一覧と、動くデモ。
const DIRS: AvatarDir[] = ['down', 'right', 'up', 'left'];
const AK = 3;
const CW = 44 * AK;
const CH = 50 * AK;

function poseCanvas(pose: AvatarPose, label: string): HTMLElement {
  const cell = document.createElement('div');
  cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;font:10px monospace;color:#3d2b2e';
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  c.style.cssText = `width:${CW}px;height:${CH}px;background:#bfe3a0`;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(CW / 2, CH - 8 * AK, 9 * AK, 3 * AK, 0, 0, Math.PI * 2);
  ctx.fill();
  drawAvatar(ctx, CW / 2, CH - 8 * AK, AK, pose);
  cell.appendChild(c);
  cell.append(label);
  return cell;
}

/** 主人公を大きく描く（正面・3/4・背面の立ち姿と、歩き・作業の代表ポーズ）。 */
function avatarZoom(K: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px';
  const impact = chopImpactTimes()[0]!;
  const poses: AvatarPose[] = [
    ...DIRS.slice(0, 3).map((dir) => ({ dir, walkPhase: null, idleT: 0, action: null })),
    { dir: 'down', walkPhase: Math.PI / 2, idleT: 0, action: null },
    { dir: 'right', walkPhase: Math.PI / 2, idleT: 0, action: null },
    { dir: 'right', walkPhase: null, idleT: 0, action: { tool: 'axe', t: 0.14 } },
    { dir: 'right', walkPhase: null, idleT: 0, action: { tool: 'axe', t: impact } },
    { dir: 'down', walkPhase: null, idleT: 0, action: { tool: 'axe', t: 0.14 } },
    { dir: 'down', walkPhase: null, idleT: 0, action: { tool: 'hoe', t: impact } },
    { dir: 'up', walkPhase: null, idleT: 0, action: { tool: 'axe', t: impact } },
    { dir: 'right', walkPhase: null, idleT: 0, action: { tool: 'hand', t: impact } },
    { dir: 'down', walkPhase: null, idleT: 0, action: { tool: 'hand', t: 0.12 } },
  ];
  for (const pose of poses) {
    const c = document.createElement('canvas');
    c.width = 46 * K;
    c.height = 50 * K;
    c.style.cssText = `width:${46 * K}px;height:${50 * K}px;background:#bfe3a0`;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(c.width / 2, c.height - 5 * K, 9 * K, 3 * K, 0, 0, Math.PI * 2);
    ctx.fill();
    drawAvatar(ctx, c.width / 2, c.height - 5 * K, K, pose);
    wrap.appendChild(c);
  }
  return wrap;
}

function avatarSheet(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.id = 'avatar-sheet';
  wrap.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:8px';
  const impacts = chopImpactTimes();
  const rows: [string, (dir: AvatarDir) => AvatarPose[]][] = [
    ['idle / walk', (dir) => [null, 0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((p) => ({ dir, walkPhase: p, idleT: 0, action: null }))],
    ...(['axe', 'hoe', 'hand'] as AvatarTool[]).map(
      (tool) =>
        [tool, (dir: AvatarDir) => [0.02, 0.1, 0.15, 0.18, impacts[0]!, 0.24, 0.3].map((t) => ({ dir, walkPhase: null, idleT: 0, action: { tool, t } }))] as [
          string,
          (dir: AvatarDir) => AvatarPose[],
        ],
    ),
  ];
  for (const [name, make] of rows) {
    for (const dir of DIRS) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
      for (const pose of make(dir)) {
        const desc = pose.action ? `${pose.action.tool} ${pose.action.t.toFixed(2)}` : pose.walkPhase === null ? 'idle' : `walk ${pose.walkPhase.toFixed(1)}`;
        row.appendChild(poseCanvas(pose, `${dir} ${desc}`));
      }
      row.dataset.row = `${name}-${dir}`;
      wrap.appendChild(row);
    }
  }
  // 動くデモ
  const live = document.createElement('canvas');
  live.width = CW * 4;
  live.height = CH;
  live.style.cssText = `width:${CW * 4}px;height:${CH}px;background:#bfe3a0`;
  wrap.appendChild(live);
  const lctx = live.getContext('2d')!;
  const t0 = performance.now();
  const loop = (now: number) => {
    const ms = now - t0;
    lctx.clearRect(0, 0, live.width, live.height);
    const mode = Math.floor(ms / 3000) % 4;
    DIRS.forEach((dir, i) => {
      const x = CW * i + CW / 2;
      const pose: AvatarPose =
        mode === 0
          ? { dir, walkPhase: (ms / 1000) * Math.PI * 2 * 1.6, idleT: ms, action: null }
          : { dir, walkPhase: null, idleT: ms, action: { tool: (['axe', 'hoe', 'hand'] as const)[mode - 1]!, t: (ms % 3000) / 3000 } };
      drawAvatar(lctx, x, CH - 8 * AK, AK, pose);
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return wrap;
}

void main();
