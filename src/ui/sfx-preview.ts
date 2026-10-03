// 効果音の候補を聴き比べる開発用ページ（sfx.html）。本番ビルドには含めない。
// 候補は refs/sfx/<名前>_<番号>.mp3、採用中は src/assets/sfx/<名前>.mp3（scripts/gen-sfx.mjs）。

const candidates = import.meta.glob('/refs/sfx/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const adopted = import.meta.glob('/src/assets/sfx/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const root = document.getElementById('root')!;
root.innerHTML = '<h1>効果音の聴き比べ</h1><p>採用するには <code>node scripts/gen-sfx.mjs --pick 名前=番号</code></p>';

const byName = new Map<string, { n: string; url: string }[]>();
for (const [path, url] of Object.entries(candidates)) {
  const m = /\/([^/]+)_(\d+)\.mp3$/.exec(path);
  if (!m) continue;
  const list = byName.get(m[1]!) ?? [];
  list.push({ n: m[2]!, url });
  byName.set(m[1]!, list);
}
if (byName.size === 0) root.insertAdjacentHTML('beforeend', '<p>候補がありません。<code>node scripts/gen-sfx.mjs</code> で作ってください。</p>');

// 採用中の音と同じ中身の候補を見つけるため、サイズで比べる（同じファイルのコピーなのでサイズが一致する）
async function size(url: string): Promise<number> {
  const r = await fetch(url);
  return (await r.arrayBuffer()).byteLength;
}

for (const [name, list] of [...byName].sort()) {
  list.sort((a, b) => Number(a.n) - Number(b.n));
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<div class="name">${name}</div><div class="cands"></div>`;
  const cands = row.querySelector('.cands')!;
  const adoptedUrl = adopted[`/src/assets/sfx/${name}.mp3`];
  const adoptedSize = adoptedUrl ? size(adoptedUrl) : Promise.resolve(-1);
  for (const c of list) {
    const el = document.createElement('div');
    el.className = 'cand';
    el.innerHTML = `<span>候補 ${c.n}</span><audio controls preload="auto" src="${c.url}"></audio>`;
    cands.appendChild(el);
    Promise.all([adoptedSize, size(c.url)]).then(([a, b]) => {
      if (a === b) el.classList.add('is-picked');
    });
  }
  root.appendChild(row);
}
