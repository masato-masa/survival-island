// 効果音を ElevenLabs の Sound Effects API で生成する（常設スクリプト）。
//
//   node scripts/gen-sfx.mjs                 全部の候補を作る（既にある候補は作り直さない）
//   node scripts/gen-sfx.mjs chop fell       指定した音だけ作る
//   node scripts/gen-sfx.mjs --force chop    作り直す
//   node scripts/gen-sfx.mjs --pick chop=2   候補 2 を採用して src/assets/sfx/chop.mp3 にコピーする
//
// API キーは環境変数 ELEVENLABS_API_KEY から読む（ファイルに書かない）。
// 候補は refs/sfx/<名前>_<番号>.mp3（git 管理外）。npm run dev 中に /survival-island/sfx.html で聴き比べる。
// 採用した音だけが src/assets/sfx/ に入って公開される（まだ採用していない音は候補 1 を仮に採用する）。無い音は sound.ts が WebAudio の合成音で代わりに鳴らす。
//
// 無音の切り詰め・音量そろえは、読み込み時に sound.ts が AudioBuffer に対して行う（ffmpeg 不要）。

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAND_DIR = join(ROOT, 'refs', 'sfx');
const OUT_DIR = join(ROOT, 'src', 'assets', 'sfx');

/** 1 つの音につき作る候補の数（API は 1 回 1 本なので、この回数だけ呼ぶ）。 */
const CANDIDATES = 3;

// 音の一覧。名前は sound.ts の SAMPLE_NAMES と一致させる。
// 指示文は「かわいい・カートゥーン・短い・単発」をそろえて、ゲーム全体の質感を合わせる。
const STYLE = 'cute cozy casual mobile game sound effect, clean, no music, no voice, no reverb tail';
export const SFX = {
  chop: { text: `single crisp wooden axe chop into a small tree trunk, short knock, ${STYLE}`, duration: 0.6 },
  mine: { text: `single small pickaxe hitting stone, bright clink, ${STYLE}`, duration: 0.6 },
  fell: { text: `small cartoon tree falling over with leaves rustling and a soft wooden thump, ${STYLE}`, duration: 1.2 },
  pop: { text: `soft cartoon pop as a small stump disappears, light and bubbly, ${STYLE}`, duration: 0.5 },
  pick: { text: `gently plucking a flower, soft leafy rustle and tiny snap, ${STYLE}`, duration: 0.6 },
  dig: { text: `small garden hoe digging into soft soil, soft earthy thud, ${STYLE}`, duration: 0.6 },
  plant: { text: `planting a seed into soft soil, soft pat pat, ${STYLE}`, duration: 0.6 },
  harvest: { text: `cheerful harvest pickup, bright bouncy two-note pluck, ${STYLE}`, duration: 0.6 },
  collect: { text: `item collected, tiny sparkly bubble pop ding, very short, ${STYLE}`, duration: 0.5 },
  craft: { text: `crafting complete, cheerful wooden hammer taps followed by a little sparkle chime, ${STYLE}`, duration: 1.0 },
  place: { text: `placing a small wooden furniture on the floor, soft satisfying thunk, ${STYLE}`, duration: 0.5 },
  levelUp: { text: `level up jingle, short bright marimba and glockenspiel fanfare, happy, ${STYLE}`, duration: 1.6 },
  fail: { text: `gentle soft error boop, two low cute notes, not harsh, ${STYLE}`, duration: 0.5 },
  tap: { text: `tiny soft UI button tap, bubbly click, very short, ${STYLE}`, duration: 0.5 },
};

async function generate(name, index) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('環境変数 ELEVENLABS_API_KEY がありません');
  const spec = SFX[name];
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: spec.text, duration_seconds: spec.duration, prompt_influence: 0.6 }),
  });
  if (!res.ok) throw new Error(`${name}_${index}: HTTP ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(CAND_DIR, `${name}_${index}.mp3`);
  writeFileSync(file, buf);
  console.log(`作成 ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const args = process.argv.slice(2);
  const pickIdx = args.indexOf('--pick');
  if (pickIdx >= 0) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const pair of args.slice(pickIdx + 1)) {
      const [name, n] = pair.split('=');
      if (!SFX[name]) throw new Error(`知らない音: ${name}`);
      const src = join(CAND_DIR, `${name}_${n}.mp3`);
      if (!existsSync(src)) throw new Error(`候補がありません: ${src}`);
      copyFileSync(src, join(OUT_DIR, `${name}.mp3`));
      console.log(`採用 ${name} ← 候補 ${n}`);
    }
    return;
  }
  const force = args.includes('--force');
  const names = args.filter((a) => !a.startsWith('--'));
  const targets = names.length ? names : Object.keys(SFX);
  for (const n of targets) if (!SFX[n]) throw new Error(`知らない音: ${n}`);
  mkdirSync(CAND_DIR, { recursive: true });
  for (const name of targets) {
    for (let i = 1; i <= CANDIDATES; i++) {
      if (!force && existsSync(join(CAND_DIR, `${name}_${i}.mp3`))) continue;
      await generate(name, i);
    }
    // まだ採用していなければ候補 1 を仮に採用する（聴き比べて --pick で差し替える）
    const out = join(OUT_DIR, `${name}.mp3`);
    if (!existsSync(out) && existsSync(join(CAND_DIR, `${name}_1.mp3`))) {
      mkdirSync(OUT_DIR, { recursive: true });
      copyFileSync(join(CAND_DIR, `${name}_1.mp3`), out);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
