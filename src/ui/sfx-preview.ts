// 効果音の候補を聴き比べる開発用ページ（sfx.html）。本番ビルドには含めない。
// 候補は refs/sfx/<名前>_<番号>.ogg、採用中は src/assets/sfx/<名前>.wav（scripts/build-sfx.mjs が選んで整えたもの）。
//
// 候補ごとに「実際に鳴っている長さ」（頭と終わりの無音を除いた長さ）と「打音の数」を測り、
// 音ごとの目標の長さに近く、打音の数が合っているものを「おすすめ」にする。
// 採用を変えるには node scripts/build-sfx.mjs chop=3

const candidates = import.meta.glob('/refs/sfx/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const adopted = import.meta.glob('/src/assets/sfx/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** 音ごとの目標の長さ（ms）と打音の数。 */
const TARGET: Record<string, { ms: number; hits: number }> = {
  chop: { ms: 350, hits: 1 },
  mine: { ms: 400, hits: 1 },
  fell: { ms: 1500, hits: 2 },
  pop: { ms: 300, hits: 1 },
  pick: { ms: 450, hits: 1 },
  dig: { ms: 400, hits: 1 },
  plant: { ms: 600, hits: 2 },
  harvest: { ms: 600, hits: 2 },
  collect: { ms: 400, hits: 1 },
  craft: { ms: 1100, hits: 3 },
  place: { ms: 400, hits: 1 },
  levelUp: { ms: 1600, hits: 4 },
  fail: { ms: 600, hits: 2 },
  tap: { ms: 150, hits: 1 },
};

interface Metrics {
  effMs: number;
  hits: number;
  score: number;
}

const ac = new AudioContext();

async function measure(url: string, name: string): Promise<Metrics> {
  const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  const th = peak * 0.02;
  let s = 0;
  while (s < ch.length && Math.abs(ch[s]!) < th) s++;
  let e = ch.length;
  while (e > s && Math.abs(ch[e - 1]!) < th * 0.5) e--;
  const effMs = ((e - s) / sr) * 1000;
  // 10ms ごとの RMS が急に立ち上がった回数 = 打音の数
  const win = Math.floor(sr * 0.01);
  let hits = 0;
  let prev = 0;
  let quietFor = 99;
  for (let i = s; i + win < e; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += ch[i + j]! * ch[i + j]!;
    const rms = Math.sqrt(sum / win) / peak;
    if (rms > 0.18 && rms > prev * 2.2 && quietFor >= 6) {
      hits++;
      quietFor = 0;
    } else quietFor++;
    prev = rms;
  }
  const t = TARGET[name] ?? { ms: 500, hits: 1 };
  const score = Math.abs(Math.log(Math.max(30, effMs) / t.ms)) + 0.35 * Math.abs(hits - t.hits);
  return { effMs, hits, score };
}

const root = document.getElementById('root')!;
root.innerHTML = '<h1>効果音の聴き比べ</h1><p>★ = 長さと打音の数で選んだおすすめ、枠 = 採用中。採用を変えるには <code>node scripts/build-sfx.mjs 名前=番号</code>（下の「採用中」は整えたあとの音）</p>';

const byName = new Map<string, { n: string; url: string }[]>();
for (const [path, url] of Object.entries(candidates)) {
  const m = /\/([^/]+)_(\d+)\.ogg$/.exec(path);
  if (!m) continue;
  const list = byName.get(m[1]!) ?? [];
  list.push({ n: m[2]!, url });
  byName.set(m[1]!, list);
}
if (byName.size === 0) root.insertAdjacentHTML('beforeend', '<p>候補がありません。</p>');

async function size(url: string): Promise<number> {
  return (await (await fetch(url)).arrayBuffer()).byteLength;
}

const picks: Record<string, number> = {};
(window as unknown as { __sfxPick: typeof picks }).__sfxPick = picks;
const jobs: Promise<void>[] = [];

for (const [name, list] of [...byName].sort()) {
  list.sort((a, b) => Number(a.n) - Number(b.n));
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<div class="name">${name}</div><div class="cands"></div>`;
  const cands = row.querySelector('.cands')!;
  const adoptedUrl = adopted[`/src/assets/sfx/${name}.wav`];
  const adoptedSize = Promise.resolve(-1);
  if (adoptedUrl) row.querySelector('.name')!.insertAdjacentHTML('beforeend', `<div class="cand"><small>採用中</small><audio controls src="${adoptedUrl}"></audio></div>`);
  const results: { n: string; m: Metrics; el: HTMLElement }[] = [];
  for (const c of list) {
    const el = document.createElement('div');
    el.className = 'cand';
    el.innerHTML = `<span>候補 ${c.n} <small></small></span><audio controls preload="auto" src="${c.url}"></audio>`;
    cands.appendChild(el);
    jobs.push(
      Promise.all([adoptedSize, size(c.url), measure(c.url, name)]).then(([a, b, m]) => {
        if (a === b) el.classList.add('is-picked');
        el.querySelector('small')!.textContent = `${Math.round(m.effMs)}ms・打音 ${m.hits}`;
        results.push({ n: c.n, m, el });
        if (results.length === list.length) {
          const best = results.reduce((x, y) => (y.m.score < x.m.score ? y : x));
          best.el.querySelector('span')!.insertAdjacentText('afterbegin', '★ ');
          picks[name] = Number(best.n);
        }
      }),
    );
  }
  root.appendChild(row);
}
Promise.all(jobs).then(() => document.body.setAttribute('data-ready', '1'));
