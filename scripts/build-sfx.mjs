// 効果音の候補（refs/sfx/<名前>_<番号>.ogg）から 1 本ずつ選び、整えて src/assets/sfx/<名前>.wav に書き出す（常設スクリプト）。
//
//   node scripts/build-sfx.mjs              全部作り直す（候補を測って自動で選ぶ）
//   node scripts/build-sfx.mjs chop=3       chop だけ候補 3 に決め打ちする（scripts/sfx-picks.json に記録して次回も使う）
//   node scripts/build-sfx.mjs collect=pop_1  別の音の候補で代用する
//
// 候補の出どころ: ElevenLabs の Web 版（Sound Effects）で、下の PROMPTS の指示文から 1 回 4 本ずつ生成したもの。
// refs/ は git 管理外なので、作り直すときは同じ指示文で生成し直す。
//
// 選び方: 頭と終わりの無音を除いた「実際に鳴っている長さ」と「打音の数」を測り、音ごとの目標（TARGET）に
// いちばん近いものを選ぶ（耳で選び直したいときは sfx-picks.json で決め打ちする）。
// 整え方: 頭の無音を切る → ピークを 0.9 にそろえる → 最大長（TARGET.max）で切って終わりをフェード → 32kHz・16bit・モノラルの WAV。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OggOpusDecoder } from 'ogg-opus-decoder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAND_DIR = join(ROOT, 'refs', 'sfx');
const OUT_DIR = join(ROOT, 'src', 'assets', 'sfx');
const PICKS_FILE = join(ROOT, 'scripts', 'sfx-picks.json');
const OUT_RATE = 32000;

// 生成に使った指示文（記録）。どれも末尾に ", cute cozy casual mobile game sound effect, clean, no music" 系を付けた。
export const PROMPTS = {
  chop: 'single crisp wooden axe chop into a small tree trunk, short knock',
  mine: 'single small pickaxe hitting stone, bright clink',
  fell: 'small cartoon tree falling over, leaves rustling and a soft wooden thump on the ground',
  pop: 'soft cartoon bubble pop, light and bouncy, single short pop',
  pick: 'gently plucking a flower from a plant, soft leafy rustle and tiny snap',
  dig: 'small garden hoe digging into soft soil, single soft earthy thud',
  plant: 'planting a seed into soft soil with hands, two soft pats',
  harvest: 'cheerful vegetable harvest pickup, bright bouncy two-note pluck',
  collect: 'item collected, tiny sparkly bubble pop ding, very short',
  craft: 'crafting complete, two cheerful wooden hammer taps followed by a little sparkle chime',
  place: 'placing a small wooden furniture on the floor, single soft satisfying thunk',
  levelUp: 'level up jingle, short bright marimba and glockenspiel fanfare, happy and cute',
  fail: 'gentle soft error boop, two low cute descending notes, not harsh',
  tap: 'tiny soft UI button tap, bubbly click, very short',
};

/** 目標の長さ（ms）・打音の数・最大長（ms）。 */
const TARGET = {
  chop: { ms: 350, hits: 1, max: 450 },
  mine: { ms: 400, hits: 1, max: 550 },
  fell: { ms: 1500, hits: 2, max: 1800 },
  pop: { ms: 300, hits: 1, max: 400 },
  pick: { ms: 450, hits: 1, max: 600 },
  dig: { ms: 400, hits: 1, max: 500 },
  plant: { ms: 600, hits: 2, max: 800 },
  harvest: { ms: 600, hits: 2, max: 800 },
  collect: { ms: 400, hits: 1, max: 500 },
  craft: { ms: 1100, hits: 3, max: 1400 },
  place: { ms: 400, hits: 1, max: 500 },
  levelUp: { ms: 1600, hits: 4, max: 2200 },
  fail: { ms: 600, hits: 2, max: 800 },
  tap: { ms: 150, hits: 1, max: 220 },
};

function mono(channelData) {
  if (channelData.length === 1) return channelData[0];
  const out = new Float32Array(channelData[0].length);
  for (const ch of channelData) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channelData.length;
  return out;
}

function measure(x, sr, t) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.02;
  let s = 0;
  while (s < x.length && Math.abs(x[s]) < th) s++;
  let e = x.length;
  while (e > s && Math.abs(x[e - 1]) < th * 0.5) e--;
  const effMs = ((e - s) / sr) * 1000;
  const win = Math.floor(sr * 0.01);
  let hits = 0;
  let prev = 0;
  let quiet = 99;
  for (let i = s; i + win < e; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += x[i + j] * x[i + j];
    const rms = Math.sqrt(sum / win) / peak;
    if (rms > 0.18 && rms > prev * 2.2 && quiet >= 6) {
      hits++;
      quiet = 0;
    } else quiet++;
    prev = rms;
  }
  const score = Math.abs(Math.log(Math.max(30, effMs) / t.ms)) + 0.35 * Math.abs(hits - t.hits);
  return { peak, s, e, effMs, hits, score };
}

/** 切り詰め・正規化・フェード・リサンプル（簡単な低域通過つきの線形補間）。 */
function tidy(x, sr, m, maxMs) {
  const start = Math.max(0, m.s - Math.floor(sr * 0.004));
  const maxLen = Math.floor((sr * maxMs) / 1000);
  const cut = m.e - start > maxLen;
  const len = Math.min(m.e - start, maxLen);
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = (x[start + i] / m.peak) * 0.9;
  const fade = Math.min(len, Math.floor(sr * (cut ? 0.12 : 0.015)));
  for (let i = 0; i < fade; i++) y[len - 1 - i] *= i / fade;
  // 48k → 32k。3 タップの平均で軽く高域を落としてから間引く
  const ratio = sr / OUT_RATE;
  const outLen = Math.floor(len / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    const a = (y[k - 1] ?? y[k]) * 0.25 + y[k] * 0.5 + (y[k + 1] ?? y[k]) * 0.25;
    const b = y[k] * 0.25 + (y[k + 1] ?? y[k]) * 0.5 + (y[k + 2] ?? y[k + 1] ?? y[k]) * 0.25;
    out[i] = a + (b - a) * f;
  }
  return out;
}

function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

async function main() {
  const picks = existsSync(PICKS_FILE) ? JSON.parse(readFileSync(PICKS_FILE, 'utf8')) : {};
  for (const arg of process.argv.slice(2)) {
    const [name, n] = arg.split('=');
    if (!TARGET[name]) throw new Error(`知らない音: ${name}`);
    picks[name] = /^\d+$/.test(n) ? Number(n) : n;
  }
  writeFileSync(PICKS_FILE, JSON.stringify(picks, null, 2) + '\n');

  const decoder = new OggOpusDecoder();
  await decoder.ready;
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(CAND_DIR);
  let total = 0;
  console.log('音       候補: 長さms/打音 (★採用)');
  for (const name of Object.keys(TARGET)) {
    // 決め打ちに "pop_1" のように別の音の候補を書くと、それを使う（生成がうまくいかなかった音の代用）
    const alias = typeof picks[name] === 'string' ? picks[name] : null;
    const cands = alias ? [`${alias}.ogg`] : files.filter((f) => new RegExp(`^${name}_(\\d+)\\.ogg$`).test(f)).sort();
    if (cands.length === 0) {
      console.log(`${name}: 候補なし`);
      continue;
    }
    const results = [];
    for (const f of cands) {
      await decoder.reset();
      const { channelData, sampleRate } = await decoder.decodeFile(new Uint8Array(readFileSync(join(CAND_DIR, f))));
      const x = mono(channelData);
      results.push({ n: Number(/_(\d+)\./.exec(f)[1]), x, sr: sampleRate, m: measure(x, sampleRate, TARGET[name]) });
    }
    const best = alias ? results[0] : picks[name] ? results.find((r) => r.n === picks[name]) : results.reduce((a, b) => (b.m.score < a.m.score ? b : a));
    const out = wav(tidy(best.x, best.sr, best.m, TARGET[name].max), OUT_RATE);
    writeFileSync(join(OUT_DIR, `${name}.wav`), out);
    total += out.length;
    const line = results.map((r) => `${r.n === best.n ? '★' : ' '}${r.n}:${Math.round(r.m.effMs)}/${r.m.hits}`).join('  ');
    console.log(`${name.padEnd(8)} ${line}  → ${(out.length / 1024).toFixed(0)}KB${picks[name] ? '（決め打ち）' : ''}`);
  }
  decoder.free();
  console.log(`合計 ${(total / 1024).toFixed(0)}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
