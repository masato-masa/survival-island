// 効果音。ElevenLabs で生成して選んだ短い音声（src/assets/sfx/*.wav、scripts/build-sfx.mjs）を
// AudioContext を作った時点で読み込み、AudioBuffer にして WebAudio で鳴らす（再生の遅延はゼロ）。
// 読み込み時に頭の無音を切り、音量（ピーク）をそろえる。鳴らすたびに音程・音量を少しゆらして、
// 同じ音が続いても機械的に聞こえないようにする。音声が無い・読み込めていない音は合成音で代わりに鳴らす。
//
// AudioContext はページ読み込み時ではなく、最初にどれかの play* が呼ばれた
// タイミング（＝最初のユーザー操作）で作る。作れなかった場合・設定で切って
// ある場合は、何もせず黙って続行する（例外を投げない）。
//
// 音は互いにぶつかる。直前に鳴らした音から一定時間内は次を間引く
// （失敗音・レベルアップだけは必ず鳴らす）。

import { isSoundEnabled } from './settings';

let ctx: AudioContext | null = null;
let unavailable = false;

function getContext(): AudioContext | null {
  if (unavailable) return null;
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // 再開できなくても致命的ではない
      });
    }
    return ctx;
  }
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      return null;
    }
    ctx = new Ctor();
    loadSamples(ctx);
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 最初のユーザー操作（ホームの「はじめる」など）で、なるべく早く AudioContext を
 *  用意しておく。失敗しても何もしない。 */
export function primeAudio(): void {
  if (!isSoundEnabled()) return;
  try {
    getContext();
  } catch {
    // 何もしない
  }
}

// ---------------------------------------------------------------------------
// 生成した音声

const sampleUrls = import.meta.glob('../assets/sfx/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const samples = new Map<string, AudioBuffer>();

/** 音ごとの音量（ピークをそろえたあとに掛ける）。 */
const SAMPLE_GAIN: Record<string, number> = {
  chop: 0.7, mine: 0.6, fell: 0.6, pop: 0.5, pick: 0.55, dig: 0.55, plant: 0.5, harvest: 0.55,
  collect: 0.4, craft: 0.55, place: 0.55, levelUp: 0.6, fail: 0.45, tap: 0.3,
};

/** 音ごとの最大の長さ（ms）。生成した音は余韻が長いことがあるので、ここで切ってフェードする。 */
const SAMPLE_MAX_MS: Record<string, number> = {
  chop: 450, mine: 550, fell: 1800, pop: 400, pick: 600, dig: 500, plant: 800, harvest: 800,
  collect: 500, craft: 1400, place: 500, levelUp: 2200, fail: 800, tap: 220,
};

/** 頭の無音を切り、ピークを 1 にそろえた AudioBuffer を作る。 */
function tidy(c: AudioContext, buf: AudioBuffer, name: string): AudioBuffer {
  const ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  if (peak <= 0) return buf;
  const th = peak * 0.02;
  let start = 0;
  while (start < ch.length && Math.abs(ch[start]!) < th) start++;
  start = Math.max(0, start - Math.floor(buf.sampleRate * 0.004));
  let end = ch.length;
  while (end > start && Math.abs(ch[end - 1]!) < th * 0.5) end--;
  const maxLen = Math.floor((buf.sampleRate * (SAMPLE_MAX_MS[name] ?? 1500)) / 1000);
  const len = Math.max(1, Math.min(end - start, maxLen));
  const out = c.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let k = 0; k < buf.numberOfChannels; k++) {
    const src = buf.getChannelData(k);
    const dst = out.getChannelData(k);
    for (let i = 0; i < len; i++) dst[i] = src[start + i]! / peak;
    // 終わりをフェードアウト（切り口のプツ音を消す。長さで切ったときは長めに）
    const fade = Math.min(len, Math.floor(buf.sampleRate * (end - start > maxLen ? 0.12 : 0.015)));
    for (let i = 0; i < fade; i++) dst[len - 1 - i]! *= i / fade;
  }
  return out;
}

function loadSamples(c: AudioContext): void {
  for (const [path, url] of Object.entries(sampleUrls)) {
    const name = path.split('/').pop()!.replace(/\.wav$/, '');
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .then((buf) => samples.set(name, tidy(c, buf, name)))
      .catch(() => {
        // 読めなければ合成音のまま
      });
  }
}

/** 生成した音を鳴らす。無ければ false（呼び出し側が合成音で代わりに鳴らす）。 */
function sample(c: AudioContext, name: string, spread = 0.06): boolean {
  const buf = samples.get(name);
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
  const amp = c.createGain();
  amp.gain.value = (SAMPLE_GAIN[name] ?? 0.5) * (0.88 + Math.random() * 0.24);
  src.connect(amp);
  amp.connect(c.destination);
  src.start();
  return true;
}

let lastPlayedAt = 0;
const THROTTLE_MS = 55;

/** 直前の音から近すぎるときは間引く。force で強制的に鳴らす（失敗・レベルアップ用）。 */
function gate(force = false): boolean {
  const now = performance.now();
  if (!force && now - lastPlayedAt < THROTTLE_MS) return false;
  lastPlayedAt = now;
  return true;
}

interface ToneOptions {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  freqEnd?: number;
}

function tone(audioCtx: AudioContext, opts: ToneOptions): void {
  const { freq, duration, type = 'sine', gain = 0.16, delay = 0, freqEnd } = opts;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  const t0 = audioCtx.currentTime + delay;
  osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
  }
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0005), t0 + Math.min(0.014, duration / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

/** ノイズバースト（木を叩く・岩を砕くなど、質感のある音に使う）。 */
function noiseBurst(audioCtx: AudioContext, duration: number, gain: number, delay = 0): void {
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const amp = audioCtx.createGain();
  const t0 = audioCtx.currentTime + delay;
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);
  src.connect(amp);
  amp.connect(audioCtx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

/** 呼び出し全体を try/catch で包む。鳴らせなくても例外は外に出さない。 */
function play(force: boolean, body: (audioCtx: AudioContext) => void): void {
  if (!isSoundEnabled()) return;
  if (!gate(force)) return;
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    body(audioCtx);
  } catch {
    // 鳴らせなくても続行
  }
}

/** 木を叩く: 乾いた木質のノック音 */
export function playChop(): void {
  play(false, (c) => {
    if (sample(c, 'chop')) return;
    noiseBurst(c, 0.05, 0.2);
    tone(c, { freq: 210, freqEnd: 140, duration: 0.09, type: 'triangle', gain: 0.14 });
  });
}

/** 岩を叩く: 石の硬いクリック音 */
export function playMine(): void {
  play(false, (c) => {
    if (sample(c, 'mine')) return;
    noiseBurst(c, 0.03, 0.16);
    tone(c, { freq: 900, freqEnd: 500, duration: 0.05, type: 'square', gain: 0.06 });
  });
}

/** 植える: 土に触れる柔らかい音 */
export function playPlant(): void {
  play(false, (c) => {
    if (sample(c, 'plant')) return;
    tone(c, { freq: 340, freqEnd: 260, duration: 0.1, type: 'sine', gain: 0.11 });
  });
}

/** 収穫: 明るく弾む音 */
export function playHarvest(): void {
  play(false, (c) => {
    if (sample(c, 'harvest')) return;
    [660, 880].forEach((freq, i) => {
      tone(c, { freq, duration: 0.11, type: 'triangle', gain: 0.13, delay: i * 0.06 });
    });
  });
}

/** クラフト・宝箱・スキル獲得: 達成感のある短いフレーズ */
export function playCraft(): void {
  play(false, (c) => {
    if (sample(c, 'craft')) return;
    tone(c, { freq: 500, duration: 0.09, type: 'sine', gain: 0.13 });
    tone(c, { freq: 760, duration: 0.14, type: 'triangle', gain: 0.12, delay: 0.07 });
  });
}

/** 家具を置く・しまう: 軽く「コトッ」と収まる音 */
export function playPlace(): void {
  play(false, (c) => {
    if (sample(c, 'place')) return;
    tone(c, { freq: 300, freqEnd: 220, duration: 0.08, type: 'sine', gain: 0.14 });
  });
}

/** 島レベルアップ・境界の開放: 明るいアルペジオ */
export function playLevelUp(): void {
  play(true, (c) => {
    if (sample(c, 'levelUp', 0)) return;
    [520, 660, 780, 1040].forEach((freq, i) => {
      tone(c, { freq, duration: 0.22, type: 'triangle', gain: 0.14, delay: i * 0.09 });
    });
  });
}

/** 失敗: 短く低い、不快でない拒否音 */
export function playFail(): void {
  play(true, (c) => {
    if (sample(c, 'fail')) return;
    tone(c, { freq: 220, duration: 0.08, type: 'triangle', gain: 0.1 });
    tone(c, { freq: 180, duration: 0.09, type: 'triangle', gain: 0.1, delay: 0.09 });
  });
}

/** ボタン・タップ全般: ごく短い、軽いクリック */
export function playUiTap(): void {
  play(false, (c) => {
    if (sample(c, 'tap')) return;
    tone(c, { freq: 900, duration: 0.04, type: 'triangle', gain: 0.06 });
  });
}

/** 木が倒れる（伐採で幹になったとき）。 */
export function playFell(): void {
  play(true, (c) => {
    if (sample(c, 'fell', 0.04)) return;
    noiseBurst(c, 0.25, 0.18);
    tone(c, { freq: 140, freqEnd: 55, duration: 0.3, type: 'sine', gain: 0.16, delay: 0.12 });
  });
}

/** 幹・花が消える: ポンと弾ける。 */
export function playPop(): void {
  play(false, (c) => {
    if (sample(c, 'pop')) return;
    tone(c, { freq: 420, freqEnd: 900, duration: 0.1, type: 'sine', gain: 0.12 });
  });
}

/** 花を摘む。 */
export function playPick(): void {
  play(false, (c) => {
    if (sample(c, 'pick', 0.08)) return;
    noiseBurst(c, 0.05, 0.08);
    tone(c, { freq: 620, freqEnd: 760, duration: 0.07, type: 'sine', gain: 0.09 });
  });
}

/** 鍬で土を掘る。 */
export function playDig(): void {
  play(false, (c) => {
    if (sample(c, 'dig')) return;
    noiseBurst(c, 0.07, 0.14);
    tone(c, { freq: 180, freqEnd: 120, duration: 0.08, type: 'sine', gain: 0.1 });
  });
}

/** 落ちたアイテムが主人公に吸い込まれる。 */
export function playCollect(): void {
  play(false, (c) => {
    if (sample(c, 'collect', 0.1)) return;
    tone(c, { freq: 1180, freqEnd: 1560, duration: 0.07, type: 'sine', gain: 0.07 });
  });
}
